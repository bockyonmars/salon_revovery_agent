import { randomUUID } from 'node:crypto'
import { DomainError } from '../domain/errors.js'
import type { AgentRun, Conversation, ConversationIntake, ConversationMessage, ConversationReply, ConversationRoute, TenantContext } from '../domain/schemas.js'
import type { Store } from '../repositories/store.js'
import { AuditService } from './audit-service.js'
import { ConsentService } from './consent-service.js'
import { EventService } from './event-service.js'
import { MessageService } from './message-service.js'
import type { ConversationAgent } from './openai-conversation-agent.js'
import type { BookingSpecialist } from './openai-booking-agent.js'
import { ConversationConfirmationService } from './conversation-confirmation-service.js'
import { traceSafeRoute } from '../security/pii-redaction.js'
import { actualPromptDigest, createConversationRouterPrompt, promptMatchesManifest } from '../prompts/conversation-router.js'
import { buildVerifiedConversationContext } from './conversation-context.js'

export class ConversationService{
  constructor(private readonly store:Store,private readonly events:EventService,private readonly audit:AuditService,private readonly consent:ConsentService,private readonly messages?:MessageService,private readonly agent?:ConversationAgent,private readonly bookingSpecialist?:BookingSpecialist,private readonly confirmations?:ConversationConfirmationService){}

  async intake(context:TenantContext,input:ConversationIntake){
    const address=input.participantAddress.trim()
    let conversation=await this.store.findConversationByParticipant(context,input.channel,address)
    const clientId=input.clientId??conversation?.clientId;const review=clientId?await this.store.findRecentSentReviewRequest(context,clientId,new Date(Date.now()-14*86_400_000).toISOString()):undefined;const feedback=review&&negativeReviewFeedback(input.body)?review:undefined;const critical=criticalRoute(input.body)??(feedback?reviewFeedbackRoute():undefined)
    const wallClock=Date.now();const now=new Date(conversation?Math.max(wallClock,Date.parse(conversation.lastMessageAt)+1):wallClock).toISOString()
    if(!conversation)conversation={id:randomUUID(),tenantId:context.tenantId,locationId:context.locationId,clientId:input.clientId??address,participantAddress:address,channel:input.channel,status:critical?.requiresHuman?'escalated':critical?.intent==='opt_out'?'closed':'active',intent:critical?.intent??'unknown',requiresHuman:critical?.requiresHuman??false,unreadCount:0,lastMessageAt:now,createdAt:now,updatedAt:now}
    const proposed:ConversationMessage={id:randomUUID(),tenantId:context.tenantId,locationId:context.locationId,conversationId:conversation.id,direction:'inbound',author:'client',body:input.body,providerMessageId:input.providerMessageId,deliveryStatus:'received',createdAt:now}
    await this.store.saveConversation(conversation)
    const saved=await this.store.saveConversationMessage(proposed)
    if(saved.duplicate){if(critical?.requiresHuman){conversation={...conversation,status:'escalated',intent:critical.intent,requiresHuman:true,updatedAt:now};conversation=await this.store.saveConversation(conversation);const approval=await this.openServiceRecovery(context,conversation,saved.message,critical);if(feedback)await this.linkReviewFeedback(context,feedback.id,saved.message.id,approval.id,conversation.id,now)}return{conversation,message:saved.message,duplicate:true,route:critical}}
    conversation={...conversation,clientId:input.clientId??conversation.clientId,status:critical?.requiresHuman?'escalated':critical?.intent==='opt_out'?'closed':conversation.status,intent:critical?.intent??conversation.intent,requiresHuman:critical?.requiresHuman??conversation.requiresHuman,unreadCount:conversation.unreadCount+1,lastMessageAt:now,updatedAt:now}
    conversation=await this.store.saveConversation(conversation)
    if(critical?.intent==='opt_out')await this.consent.record(context,{clientId:conversation.clientId,channel:input.channel,purpose:'marketing',status:'opted_out',captureMethod:input.source==='provider'?'provider_keyword':'sandbox_keyword',disclosureVersion:'provider-managed'})
    await this.events.ingest(context,{eventId:randomUUID(),eventType:'message.replied',occurredAt:now,correlationId:conversation.id,causationId:input.providerMessageId,schemaVersion:1,payload:{conversationId:conversation.id,messageId:saved.message.id,channel:input.channel,intent:critical?.intent??'unclassified',requiresHuman:critical?.requiresHuman??false,body:'[REDACTED]'}})
    if(critical?.requiresHuman){const approval=await this.openServiceRecovery(context,conversation,saved.message,critical);if(feedback)await this.linkReviewFeedback(context,feedback.id,saved.message.id,approval.id,conversation.id,now)}
    return{conversation,message:saved.message,duplicate:false,route:critical}
  }

  async list(context:TenantContext){const conversations=await this.store.listConversations(context);return Promise.all(conversations.map(async conversation=>{const messages=await this.store.listConversationMessages(context,conversation.id);const client=await this.store.getClientProfile(context,conversation.clientId);return{conversation,lastMessage:messages.at(-1),client}}))}
  async detail(context:TenantContext,conversationId:string){const conversation=await this.requireConversation(context,conversationId);const[messages,runs,toolCalls,actions,client,consents]=await Promise.all([this.store.listConversationMessages(context,conversationId),this.store.listAgentRuns(context,conversationId),this.store.listToolCalls(context,conversationId),this.store.listConversationActions(context,conversationId),this.store.getClientProfile(context,conversation.clientId),this.store.getClientConsents(context,conversation.clientId)]);return{conversation,messages,runs,toolCalls,actions,client,consents}}

  async run(context:TenantContext,conversationId:string,messageId?:string){
    let conversation=await this.requireConversation(context,conversationId);const history=await this.store.listConversationMessages(context,conversationId)
    const input=messageId?await this.store.getConversationMessage(context,messageId):[...history].reverse().find(value=>value.direction==='inbound')
    if(!input||input.conversationId!==conversationId)throw new DomainError('Inbound conversation message not found','CONVERSATION_MESSAGE_NOT_FOUND',404)
    const previous=await this.store.getAgentRunForInput(context,input.id)
    if(previous?.route){const draft=previous.responseMessageId?await this.store.getConversationMessage(context,previous.responseMessageId):undefined;const route=draft?{...previous.route,draftReply:draft.body}:previous.route;return{conversation,route,draft,run:previous}}
    const prompt=await this.ensurePrompt();const started=new Date().toISOString();const runId=randomUUID();let route:ConversationRoute;let status:AgentRun['status']='skipped';let errorCode:string|undefined
    const confirmation=this.confirmations?await this.confirmations.resolve(context,conversation,input):undefined
    const critical=criticalRoute(input.body)
    if(confirmation)route=confirmation.route
    else if(critical)route=critical
    else if(conversation.requiresHuman)route=escalatedRoute(conversation.intent)
    else if(this.agent){try{const[settings,services,staff,profile,consents,bookings,activeAction]=await Promise.all([this.store.getLocationSettings(context),this.store.listServices(context),this.store.listStaff(context),this.store.getClientProfile(context,conversation.clientId),this.store.getClientConsents(context,conversation.clientId),this.store.listBookings(context),this.store.getActiveConversationAction(context,conversationId)]);const verifiedContext=buildVerifiedConversationContext({conversation,profile,consents,bookings,services,staff,activeAction});const recentHistory=history.slice(-8);route=await this.agent.route({context,agentRunId:runId,message:input,history:recentHistory,settings,services,staff,verifiedContext,prompt});if(this.bookingSpecialist&&bookingIntent(route)&&!route.requiresHuman){const draftReply=await this.bookingSpecialist.respond({context,conversation,message:input,history:recentHistory,verifiedContext,route,agentRunId:runId});route={...route,draftReply}}status='completed'}catch(error){const run:AgentRun={id:runId,tenantId:context.tenantId,locationId:context.locationId,conversationId,inputMessageId:input.id,promptVersionId:prompt.id,model:prompt.model,status:'failed',errorCode:'CONVERSATION_ROUTING_FAILED',createdAt:started,completedAt:new Date().toISOString()};await this.store.saveAgentRun(run);await this.audit.record(context,'conversation.routing_failed','conversation',conversationId,'Conversation routing provider failed; durable retry is required',{messageId:input.id,body:'[REDACTED]'},{agentRunId:run.id,errorCode:run.errorCode});throw new ConversationRoutingError(retryableAgentError(error),error)}}
    else{route=deterministicRoute(input.body);errorCode='MODEL_NOT_CONFIGURED'}
    let draft:ConversationMessage|undefined
    if(route.draftReply){draft=(await this.store.saveConversationMessage({id:randomUUID(),tenantId:context.tenantId,locationId:context.locationId,conversationId,direction:'outbound',author:'agent',body:route.draftReply,deliveryStatus:'draft',createdAt:new Date().toISOString()})).message;const action=await this.store.getActiveConversationAction(context,conversationId);if(action?.status==='prepared'&&action.agentRunId===runId)await this.store.saveConversationAction({...action,draftMessageId:draft.id,updatedAt:new Date().toISOString()})}
    conversation={...conversation,intent:route.intent,requiresHuman:route.requiresHuman,status:route.requiresHuman?'escalated':route.intent==='opt_out'?'closed':conversation.status,updatedAt:new Date().toISOString()};conversation=await this.store.saveConversation(conversation)
    const run:AgentRun={id:runId,tenantId:context.tenantId,locationId:context.locationId,conversationId,inputMessageId:input.id,responseMessageId:draft?.id,promptVersionId:prompt.id,model:this.agent?prompt.model:'deterministic-router-v1',status,route:traceSafeRoute(route),errorCode,createdAt:started,completedAt:new Date().toISOString()};await this.store.saveAgentRun(run)
    if(route.requiresHuman)await this.openServiceRecovery(context,conversation,input,route)
    await this.audit.record(context,'conversation.routed','conversation',conversationId,`Conversation classified as ${route.intent}`,{messageId:input.id,body:'[REDACTED]'},{intent:route.intent,confidence:route.confidence,requiresHuman:route.requiresHuman,agentRunId:run.id})
    return{conversation,route,draft,run}
  }

  async reply(context:TenantContext,conversationId:string,input:ConversationReply){
    const conversation=await this.requireConversation(context,conversationId)
    if(conversation.status==='closed')throw new DomainError('Closed conversations cannot receive replies','CONVERSATION_CLOSED',409)
    if(!this.messages)throw new DomainError('Messaging provider is not configured','MESSAGING_NOT_CONFIGURED',503)
    if(conversation.channel==='email')throw new DomainError('Email conversation delivery is not configured','CONVERSATION_CHANNEL_UNSUPPORTED',409)
    let linkedDraft:ConversationMessage|undefined;let action=await this.store.getActiveConversationAction(context,conversationId)
    if(input.draftMessageId){
      linkedDraft=await this.store.getConversationMessage(context,input.draftMessageId)
      if(!linkedDraft||linkedDraft.conversationId!==conversationId||linkedDraft.deliveryStatus!=='draft')throw new DomainError('Verified conversation draft not found','CONVERSATION_DRAFT_NOT_FOUND',404)
      if(linkedDraft.body!==input.body)throw new DomainError('A confirmation draft must be sent without edits','CONFIRMATION_DRAFT_CHANGED',409)
      if(action?.status==='awaiting_confirmation'&&action.draftMessageId===linkedDraft.id&&action.confirmationRequestMessageId){const existing=await this.store.getConversationMessage(context,action.confirmationRequestMessageId);if(existing?.conversationId===conversationId&&existing.body===input.body)return{message:existing,duplicate:true,action}}
      if(action?.status==='prepared'&&action.draftMessageId===linkedDraft.id){const hold=action.holdId?await this.store.getHold(context,action.holdId):undefined;const expired=Boolean(action.expiresAt&&Date.parse(action.expiresAt)<=Date.now())||(action.actionType!=='cancel_appointment'&&(!hold||hold.status!=='active'||Date.parse(hold.expiresAt)<=Date.now()));if(expired){action=await this.store.saveConversationAction({...action,status:'expired',updatedAt:new Date().toISOString()});if(hold?.status==='active')await this.store.cancelHold(context,hold.id);throw new DomainError('The verified appointment action expired before confirmation was requested','ACTION_EXPIRED',409)}}
    }
    const confirmationAction=linkedDraft&&action?.status==='prepared'&&action.draftMessageId===linkedDraft.id?action:undefined
    const result=await this.messages.send(context,{clientId:conversation.clientId,channel:conversation.channel,purpose:input.purpose,to:conversation.participantAddress,body:input.body,correlationId:conversation.id,idempotencyKey:confirmationAction?`conversation:${confirmationAction.id}:confirmation-request`:`conversation:${conversation.id}:${randomUUID()}`})
    const sentAt=new Date(Math.max(Date.now(),Date.parse(conversation.lastMessageAt)+1)).toISOString()
    let message:ConversationMessage={id:randomUUID(),tenantId:context.tenantId,locationId:context.locationId,conversationId,direction:'outbound',author:'operator',body:input.body,providerMessageId:result.message.id,deliveryStatus:'sent',createdAt:sentAt}
    if(confirmationAction){const saved=await this.store.requestConversationActionConfirmationWithAudit(context,{...confirmationAction,status:'awaiting_confirmation',confirmationRequestMessageId:message.id,confirmationRequestedAt:message.createdAt,updatedAt:message.createdAt},message,{...conversation,unreadCount:0,lastMessageAt:message.createdAt,updatedAt:message.createdAt},{auditId:randomUUID(),userId:context.userId,occurredAt:message.createdAt,previousUpdatedAt:confirmationAction.updatedAt});action=saved.action;message=saved.message}else{message=(await this.store.saveConversationMessage(message)).message;await this.store.saveConversation({...conversation,unreadCount:0,lastMessageAt:message.createdAt,updatedAt:message.createdAt})}
    if(!action&&input.purpose==='transactional'&&followupIntent(conversation.intent))await this.events.ingest(context,{eventId:randomUUID(),eventType:'conversation.followup_requested',occurredAt:message.createdAt,correlationId:conversation.id,causationId:message.id,schemaVersion:1,payload:{conversationId:conversation.id,clientId:conversation.clientId,triggerMessageId:message.id,channel:conversation.channel}})
    return{message,duplicate:result.duplicate,action}
  }

  private async requireConversation(context:TenantContext,id:string){const value=await this.store.getConversation(context,id);if(!value)throw new DomainError('Conversation not found','CONVERSATION_NOT_FOUND',404);return value}
  private async linkReviewFeedback(context:TenantContext,reviewRequestId:string,messageId:string,approvalId:string,conversationId:string,occurredAt:string){return this.store.recordReviewFeedbackWithEvidence(context,reviewRequestId,messageId,approvalId,{auditId:randomUUID(),eventId:randomUUID(),userId:context.userId,conversationId,occurredAt})}
  private async ensurePrompt(){
    const model=process.env.MODEL_CONCIERGE?.trim()||'gpt-5.6-terra'
    const current=await this.store.getActivePromptVersion('conversation_router')
    if(current){
      if(!promptMatchesManifest(current,model))throw new DomainError('The active conversation prompt does not match this evaluated release','PROMPT_RELEASE_MISMATCH',503)
      const digest=actualPromptDigest(current)
      return{...current,releaseLabel:current.releaseLabel??'conversation-router-v1',contentDigest:digest}
    }
    if(process.env.NODE_ENV==='production')throw new DomainError('An evaluated conversation prompt must be activated before production routing','PROMPT_RELEASE_REQUIRED',503)
    return this.store.savePromptVersion(createConversationRouterPrompt(model,{approvalReference:'development-auto-seed'}))
  }
  private async openServiceRecovery(context:TenantContext,conversation:Conversation,message:ConversationMessage,route:ConversationRoute){const result=await this.store.createApprovalRequestWithEvent({id:randomUUID(),tenantId:context.tenantId,locationId:context.locationId,requestType:'service_recovery',reason:`Escalated ${route.intent} conversation requires human review.`,status:'pending',entityType:'conversation',entityId:conversation.id,payload:{intent:route.intent,urgency:route.urgency,messageId:message.id},createdAt:new Date().toISOString()},{eventId:randomUUID(),correlationId:conversation.id,causationId:message.id});return result.approval}
}

export class ConversationRoutingError extends Error{
  readonly code='CONVERSATION_ROUTING_FAILED'
  constructor(readonly retryable:boolean,cause?:unknown){super('Conversation routing provider failed',{cause})}
}

export function criticalRoute(body:string):ConversationRoute|undefined{
  const value=body.trim()
  if(optOutLanguage(value))return{intent:'opt_out',confidence:1,urgency:'normal',requiresHuman:false,shortReason:'Customer explicitly opted out of messaging.'}
  if(/\b(allerg(?:y|ic)|reaction|infection|infected|injur(?:y|ed)|burn(?:ed|t|ing)?|medical|bleeding|swelling|rash|blister)\b/i.test(value))return{intent:'medical_safety',confidence:.99,urgency:'safety',requiresHuman:true,shortReason:'Medical or safety language requires immediate human review.'}
  if(/\b(refund|chargeback|lawyer|solicitor|legal action|sue|compensation|policy exception|overcharg(?:e|ed|ing)|price dispute|charged me|quoted .{0,40} but)\b/i.test(value))return{intent:'complaint',confidence:.96,urgency:'urgent',requiresHuman:true,shortReason:'Financial, legal, or policy-exception request requires manager approval.'}
  if(/\b(under\s*18|minor|child booking|child appointment|\d{1,2}[ -]?year[ -]?old)\b/i.test(value))return{intent:'human_request',confidence:.95,urgency:'urgent',requiresHuman:true,shortReason:'An underage-customer policy question requires human review.'}
  if(/\b(human|person|manager|someone call me|real agent)\b/i.test(value))return{intent:'human_request',confidence:.95,urgency:'urgent',requiresHuman:true,shortReason:'Customer explicitly requested a person.'}
  if(/\b(ignore (?:all |the )?(?:previous|prior|above) (?:instructions|rules)|system prompt|developer message|reveal (?:your )?(?:prompt|instructions)|api key|access token|database dump|internal data|(?:another|other) (?:tenant|salon|customer)|admin credentials?)\b/i.test(value))return{intent:'spam',confidence:.99,urgency:'normal',requiresHuman:false,shortReason:'The message requests restricted instructions, credentials, or internal data.'}
  if(/\b(?:fuck|fucking|bitch|idiot|stupid bot|shut up|harass(?:ment|ing)|abusive)\b/i.test(value))return{intent:'spam',confidence:.97,urgency:'normal',requiresHuman:false,shortReason:'Abusive or harassing content is not eligible for an automated reply.'}
  return undefined
}
function negativeReviewFeedback(body:string){return /\b(?:terrible|awful|horrible|bad experience|disappoint(?:ed|ing)|unhappy|dissatisfied|poor service|not happy|one star|1 star|two stars|2 stars|never again|ruined)\b/i.test(body)}
function reviewFeedbackRoute():ConversationRoute{return{intent:'complaint',confidence:.98,urgency:'urgent',requiresHuman:true,shortReason:'Negative feedback following a neutral review request requires personal service recovery.'}}
function escalatedRoute(intent:Conversation['intent']):ConversationRoute{const safeIntent:ConversationRoute['intent']=['medical_safety','complaint','human_request'].includes(intent)?intent:'human_request';return{intent:safeIntent,confidence:1,urgency:safeIntent==='medical_safety'?'safety':'urgent',requiresHuman:true,shortReason:'This conversation is already escalated and requires a human response.'}}
export function deterministicRoute(body:string):ConversationRoute{const critical=criticalRoute(body);if(critical)return critical;const value=body.toLowerCase();if(/\breschedul|move (?:my|the) appointment|change (?:my|the) appointment/.test(value))return routine('reschedule','Customer wants to change an existing appointment.','I can help collect the details for a reschedule. Which appointment and preferred date should the salon check?');if(/\bcancel (?:my|the) appointment/.test(value))return routine('cancellation','Customer wants to cancel an appointment.','Please share the appointment reference or scheduled date so the salon can verify it before cancellation.');if(/\bprice|cost|how much/.test(value))return routine('price_question','Customer is asking about price.','Which service would you like the verified price for?');if(/\bavailable|availability|opening|openings|open (?:on|at|this|next)/.test(value))return routine('availability_question','Customer is asking about availability.','Which service and date range should the salon check?');if(/\bservice|treatment|colour|color|cut|nails|hair|braids|facial|manicure|pedicure|policy|deposit|lateness|late arrival|aftercare|prepare|preparation|accessib/.test(value))return routine('service_question','Customer is asking about a salon service or approved support policy.','Which service or salon policy would you like more information about?');if(/\bbook|appointment|slot|schedule/.test(value))return routine('booking','Customer is asking to book an appointment.','Which service and date would you like the salon to check?');return routine('unknown','The message needs one concise clarification.','How can the salon help with your booking or service today?')}
function optOutLanguage(value:string){return/^(stop|stopall|unsubscribe|cancel|end|quit)$/i.test(value)||/\b(?:don't|do not|dont)\s+(?:text|message|contact)\s+me\b/i.test(value)||/\b(?:stop|quit)\s+(?:texting|messaging|contacting)\s+me\b/i.test(value)||/\b(?:remove|take)\s+me\s+(?:off|from)\s+(?:your|the)\s+(?:list|messages?)\b/i.test(value)||/\bno more (?:texts?|messages?)\b/i.test(value)||/\b(?:no me (?:env[ií]e(?:n)?|mandes?) mensajes|deja de escribirme|desuscr[ií]beme|dame de baja)\b/i.test(value)||/\b(?:arr[eê]tez? de m['’]envoyer des messages|d[eé]sabonnez[- ]moi|plus de messages)\b/i.test(value)||/\b(?:n[aã]o me (?:mande|envie) mensagens|pare de me enviar mensagens)\b/i.test(value)||/(?:ẹ má fi ifiranṣẹ ranṣẹ si mi|má ṣe fi ifiranṣẹ ranṣẹ si mi)/iu.test(value)}
function routine(intent:ConversationRoute['intent'],shortReason:string,draftReply:string):ConversationRoute{return{intent,confidence:.72,urgency:'normal',requiresHuman:false,shortReason,draftReply}}
function bookingIntent(route:ConversationRoute){return['booking','price_question','service_question','availability_question'].includes(route.intent)}
function followupIntent(intent:Conversation['intent']){return['booking','price_question','service_question','availability_question'].includes(intent)}
function retryableAgentError(error:unknown){if(typeof error!=='object'||error===null)return true;if('retryable'in error&&typeof error.retryable==='boolean')return error.retryable;const status='status'in error&&typeof error.status==='number'?error.status:undefined;const name='name'in error&&typeof error.name==='string'?error.name:'';return status===undefined?/connection|timeout|rate/i.test(name):[408,409,429,500,502,503,504].includes(status)}
