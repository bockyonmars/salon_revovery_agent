import { createHash } from 'node:crypto'
import OpenAI from 'openai'
import { ConversationRouteSchema, type ConversationMessage, type ConversationRoute, type LocationSettings, type PromptVersion, type ServiceRecord, type StaffRecord, type TenantContext } from '../domain/schemas.js'
import { redactText } from '../security/pii-redaction.js'
import type { ProviderCircuitBreakerService } from './provider-circuit-breaker-service.js'
import type { ModelUsageService } from './model-usage-service.js'
import type { VerifiedConversationContext } from './conversation-context.js'
import { openAIRuntimePolicy } from './openai-runtime-policy.js'

export type ConversationAgentInput={context:TenantContext;agentRunId:string;message:ConversationMessage;history:ConversationMessage[];settings?:LocationSettings;services:ServiceRecord[];staff:StaffRecord[];verifiedContext:VerifiedConversationContext;prompt:PromptVersion}
export interface ConversationAgent{route(input:ConversationAgentInput):Promise<ConversationRoute>}

export class OpenAIConversationAgent implements ConversationAgent{
  private readonly client:OpenAI
  constructor(apiKey:string,private readonly model=process.env.MODEL_CONCIERGE??'gpt-5.6-terra',private readonly providerCircuits?:ProviderCircuitBreakerService,private readonly usage?:ModelUsageService,client?:OpenAI){this.client=client??new OpenAI({apiKey,...openAIRuntimePolicy()})}
  async route(input:ConversationAgentInput){
    const facts={salonName:input.settings?.salonName??'the salon',timezone:input.settings?.timezone,brandVoice:input.settings?.brandVoice?redactText(input.settings.brandVoice):undefined,services:input.services.filter(value=>value.active).slice(0,40).map(value=>({name:value.name,variation:value.variationName,durationMinutes:value.durationMinutes,priceMinor:value.priceMinor,currency:value.currency})),staff:input.staff.filter(value=>value.bookable).slice(0,40).map(value=>value.name)}
    const history=input.history.slice(-8).map(value=>({role:value.direction==='inbound'?'customer':'salon',body:redactText(value.body)}))
    const request=()=>this.client.responses.create({model:this.model,instructions:input.prompt.instructions,input:JSON.stringify({verifiedFacts:facts,verifiedConversationContext:input.verifiedContext,conversation:history,latestMessage:redactText(input.message.body)}),reasoning:{effort:'low' as const},max_output_tokens:500,store:false,safety_identifier:createHash('sha256').update(`${input.context.tenantId}:${input.message.conversationId}`).digest('hex'),text:{format:{type:'json_schema' as const,name:'conversation_route',strict:true,schema:routeSchema}}})
    const response=this.providerCircuits?await this.providerCircuits.execute(input.context,'openai','conversation.route',request):await request()
    await this.usage?.record(input.context,input.agentRunId,'conversation_route',response)
    const parsed=ConversationRouteSchema.parse(JSON.parse(response.output_text))
    return parsed.draftReply===''?{...parsed,draftReply:undefined}:parsed
  }
}

const routeSchema={type:'object',additionalProperties:false,properties:{intent:{type:'string',enum:['booking','reschedule','cancellation','price_question','service_question','availability_question','complaint','medical_safety','opt_out','human_request','spam','unknown']},confidence:{type:'number',minimum:0,maximum:1},urgency:{type:'string',enum:['normal','urgent','safety']},requiresHuman:{type:'boolean'},shortReason:{type:'string',minLength:1,maxLength:200},draftReply:{type:'string',maxLength:1600}},required:['intent','confidence','urgency','requiresHuman','shortReason','draftReply']} as const
