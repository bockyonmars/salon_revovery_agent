import { createHash } from 'node:crypto'
import OpenAI from 'openai'
import type { CallAcceptParams } from 'openai/resources/realtime/calls.js'
import type { RealtimeCallIncomingWebhookEvent, UnwrapWebhookEvent } from 'openai/resources/webhooks/webhooks.js'
import WebSocket, { type RawData } from 'ws'
import { DomainError } from '../domain/errors.js'
import type { TenantContext } from '../domain/schemas.js'
import type { Store } from '../repositories/store.js'
import type { EventService } from './event-service.js'
import { openAIRuntimePolicy } from './openai-runtime-policy.js'
import { VoiceReleaseService } from './voice-release-service.js'
import { VoiceReadinessService } from './voice-readiness-service.js'

type WebhookHeaders=Record<string,string|string[]|undefined>
type RealtimeToolCall={type:'function_call';name:string;arguments:string;call_id?:string}

export interface RealtimeSidebandSocket{
  on(event:'open',listener:()=>void):this
  on(event:'message',listener:(data:RawData)=>void):this
  on(event:'error',listener:(error:Error)=>void):this
  send(data:string):void
  close():void
}

export interface RealtimeCallGateway{
  accept(callId:string,configuration:CallAcceptParams):Promise<void>
  reject(callId:string,statusCode:number):Promise<void>
  refer(callId:string,targetUri:string):Promise<void>
  connect(callId:string,safetyIdentifier:string):RealtimeSidebandSocket
}

export interface OpenAIWebhookVerifier{
  unwrap(payload:string,headers:WebhookHeaders):Promise<UnwrapWebhookEvent>
}

export type RealtimeSipWebhookResult={accepted:boolean;duplicate:boolean;ignored?:boolean;readiness?:'accepted'|'blocked'}
export interface RealtimeSipWebhookHandler{handle(payload:string,headers:WebhookHeaders):Promise<RealtimeSipWebhookResult>}
export type RealtimeSandboxBootstrap={environment:string;authorized:boolean;tenantId:string;locationId:string;destination:string}

export class OpenAIRealtimeGateway implements RealtimeCallGateway{
  private readonly client:OpenAI
  constructor(private readonly apiKey:string,client?:OpenAI){this.client=client??new OpenAI({apiKey,...openAIRuntimePolicy()})}
  async accept(callId:string,configuration:CallAcceptParams){await this.client.realtime.calls.accept(callId,configuration)}
  async reject(callId:string,statusCode:number){await this.client.realtime.calls.reject(callId,{status_code:statusCode})}
  async refer(callId:string,targetUri:string){await this.client.realtime.calls.refer(callId,{target_uri:targetUri})}
  connect(callId:string,safetyIdentifier:string){return new WebSocket(`wss://api.openai.com/v1/realtime?call_id=${encodeURIComponent(callId)}`,{headers:{Authorization:`Bearer ${this.apiKey}`,'OpenAI-Safety-Identifier':safetyIdentifier}})}
}

export class OpenAISignedWebhookVerifier implements OpenAIWebhookVerifier{
  private readonly client:OpenAI
  constructor(apiKey:string,private readonly secret:string,client?:OpenAI){this.client=client??new OpenAI({apiKey,...openAIRuntimePolicy()})}
  async unwrap(payload:string,headers:WebhookHeaders){
    try{return await this.client.webhooks.unwrap(payload,headers,this.secret)}
    catch{throw new DomainError('OpenAI webhook signature is invalid','INVALID_WEBHOOK_SIGNATURE',403)}
  }
}

export class OpenAIRealtimeSipService implements RealtimeSipWebhookHandler{
  constructor(
    private readonly store:Store,
    private readonly events:EventService,
    private readonly verifier:OpenAIWebhookVerifier,
    private readonly gateway:RealtimeCallGateway,
    private readonly model='gpt-realtime-2.1',
    private readonly destinationHeader='to',
    private readonly now=()=>new Date(),
    private readonly sandboxBootstrap?:RealtimeSandboxBootstrap,
  ){}

  async handle(payload:string,headers:WebhookHeaders):Promise<RealtimeSipWebhookResult>{
    const event=await this.verifier.unwrap(payload,headers)
    if(event.type!=='realtime.call.incoming')return{accepted:true,duplicate:false,ignored:true}
    return this.incoming(event)
  }

  private async incoming(event:RealtimeCallIncomingWebhookEvent):Promise<RealtimeSipWebhookResult>{
    const callId=event.data.call_id?.trim()
    if(!callId)throw new DomainError('OpenAI realtime call payload is incomplete','INVALID_WEBHOOK_PAYLOAD',400)
    const destination=sipDestination(event.data.sip_headers,this.destinationHeader)
    const context=await channelTenant(this.store,destination)
    const releaseAccess=await new VoiceReleaseService(this.store,this.model,true,this.now).runtimeAccess(context)
    const bootstrapConfigured=Boolean(this.sandboxBootstrap?.authorized&&this.sandboxBootstrap.environment!=='production'&&this.sandboxBootstrap.tenantId===context.tenantId&&this.sandboxBootstrap.locationId===context.locationId&&this.sandboxBootstrap.destination===destination)
    const bootstrapAccess=!releaseAccess.allowed&&bootstrapConfigured?await new VoiceReadinessService(this.store,this.now,true).runtimeAccess(context):undefined
    const access=releaseAccess.allowed?releaseAccess:{allowed:Boolean(bootstrapAccess?.allowed),declaration:bootstrapAccess?.declaration}
    const releaseMode=releaseAccess.allowed?'activated' as const:bootstrapAccess?.allowed?'sandbox_bootstrap' as const:undefined
    const occurredAt=this.now().toISOString()
    const readiness=access.allowed?'accepted' as const:'blocked' as const
    let reservation=await this.store.reserveRealtimeVoiceCall({callId,tenantId:context.tenantId,locationId:context.locationId,providerEventId:event.id,status:'received',readiness,...(access.allowed?{model:this.model,releaseMode}:{}),createdAt:occurredAt,updatedAt:occurredAt})
    if(reservation.call.status==='processing'&&Date.parse(occurredAt)-Date.parse(reservation.call.updatedAt)>60_000){const recovered=await this.store.transitionRealtimeVoiceCall(context,callId,['processing'],'accept_failed',occurredAt,'STALE_PROCESSING_LEASE');if(recovered)reservation={call:recovered,duplicate:true}}
    if(['accepted','rejected','transferred'].includes(reservation.call.status)){await this.recordEvent(context,event.id,callId,reservation.call.readiness,occurredAt);return{accepted:true,duplicate:true,readiness:reservation.call.readiness}}
    const claimed=await this.store.transitionRealtimeVoiceCall(context,callId,['received','accept_failed'],'processing',occurredAt)
    if(!claimed)return{accepted:true,duplicate:true,readiness:reservation.call.readiness}
    if(!access.allowed||!access.declaration){
      try{await this.gateway.reject(callId,480)}catch{await this.store.transitionRealtimeVoiceCall(context,callId,['processing'],'accept_failed',this.now().toISOString(),'REALTIME_CALL_REJECT_FAILED');throw new DomainError('OpenAI realtime call rejection failed','REALTIME_CALL_REJECT_FAILED',502)}
      await this.store.transitionRealtimeVoiceCall(context,callId,['processing'],'rejected',this.now().toISOString())
      await this.recordEvent(context,event.id,callId,'blocked',occurredAt)
      return{accepted:true,duplicate:reservation.duplicate,readiness:'blocked'}
    }
    const settings=await this.store.getLocationSettings(context)
    const salonName=safeSalonName(settings?.salonName)
    const configuration:CallAcceptParams={type:'realtime',model:this.model,output_modalities:['audio'],instructions:voiceInstructions(salonName),reasoning:{effort:'low'},parallel_tool_calls:false,tool_choice:'auto',max_output_tokens:400,tracing:null,tools:[transferTool,waitTool]}
    try{await this.gateway.accept(callId,configuration)}catch{await this.store.transitionRealtimeVoiceCall(context,callId,['processing'],'accept_failed',this.now().toISOString(),'REALTIME_CALL_ACCEPT_FAILED');throw new DomainError('OpenAI realtime call acceptance failed','REALTIME_CALL_ACCEPT_FAILED',502)}
    await this.store.transitionRealtimeVoiceCall(context,callId,['processing'],'accepted',this.now().toISOString())
    try{this.monitor(callId,context,access.declaration.transferTo,salonName)}catch{try{await this.gateway.refer(callId,`tel:${access.declaration.transferTo}`);await this.store.transitionRealtimeVoiceCall(context,callId,['accepted'],'transferred',this.now().toISOString())}catch{/* Fail closed without logging the private transfer target. */}}
    await this.recordEvent(context,event.id,callId,'accepted',occurredAt)
    return{accepted:true,duplicate:reservation.duplicate,readiness:'accepted'}
  }

  private async recordEvent(context:TenantContext,providerEventId:string,callId:string,readiness:'accepted'|'blocked',occurredAt:string){await this.events.ingest(context,{eventId:stableUuid(`openai:realtime:call:${callId}`),eventType:'provider.webhook_received',occurredAt,correlationId:callId,schemaVersion:1,payload:{provider:'openai',providerEventType:'realtime.call.incoming',providerEventId,callId,readiness}})}

  private monitor(callId:string,context:TenantContext,transferTo:string,salonName:string){
    const socket=this.gateway.connect(callId,createHash('sha256').update(`${context.tenantId}:${context.locationId}:${callId}`).digest('hex'))
    let transferred=false
    const transfer=async()=>{if(transferred)return;transferred=true;void this.store.recordRealtimeVoiceCallSignal(context,callId,'transfer_requested',this.now().toISOString()).catch(()=>undefined);try{await this.gateway.refer(callId,`tel:${transferTo}`);await this.store.transitionRealtimeVoiceCall(context,callId,['accepted'],'transferred',this.now().toISOString());await this.store.recordRealtimeVoiceCallSignal(context,callId,'transfer_completed',this.now().toISOString())}catch{/* The provider owns retry/reconciliation; never expose the private transfer target. */}}
    socket.on('open',()=>{try{socket.send(JSON.stringify({type:'response.create',response:{output_modalities:['audio'],instructions:`Say exactly this disclosure, then wait: "Hello, this is the AI assistant for ${salonName}. This call is not recorded. How may I help?"`}}));const occurredAt=this.now().toISOString();void this.store.recordRealtimeVoiceCallSignal(context,callId,'sideband_connected',occurredAt).catch(()=>undefined);void this.store.recordRealtimeVoiceCallSignal(context,callId,'disclosure_requested',occurredAt).catch(()=>undefined)}catch{void transfer()}})
    socket.on('message',(data)=>{void (async()=>{
      const event=parseSidebandEvent(data)
      if(event?.type!=='response.done'||!Array.isArray(event.response?.output))return
      for(const output of event.response.output){
        const tool=asToolCall(output);if(!tool?.call_id)continue
        if(tool.name==='transfer_to_human'){await transfer();return}
        if(tool.name==='wait_for_user'){socket.send(toolOutput(tool.call_id,{ok:true,action:'wait'}));void this.store.recordRealtimeVoiceCallSignal(context,callId,'wait_tool_observed',this.now().toISOString()).catch(()=>undefined);continue}
        socket.send(toolOutput(tool.call_id,{ok:false,error:'unsupported_tool'}));socket.send(JSON.stringify({type:'response.create'}))
      }
    })()})
    socket.on('error',()=>{void this.store.recordRealtimeVoiceCallSignal(context,callId,'sideband_failed',this.now().toISOString()).catch(()=>undefined);void transfer()})
  }
}

const transferTool={type:'function' as const,name:'transfer_to_human',description:'Transfer immediately after telling the caller you are connecting them to a person. Use whenever the caller asks for a person, the request is outside the allowed scope, or safety is uncertain.',parameters:{type:'object',properties:{},additionalProperties:false,required:[]}}
const waitTool={type:'function' as const,name:'wait_for_user',description:'Use when there is silence, background speech, or no actionable caller request. Do not speak again until the caller continues.',parameters:{type:'object',properties:{},additionalProperties:false,required:[]}}

function voiceInstructions(salonName:string){return`# Role and objective\nYou are the AI voice concierge for ${salonName}. Keep every response warm, professional, and concise.\n\n# Required first response\nSay: "Hello, this is the AI assistant for ${salonName}. This call is not recorded. How may I help?"\n\n# Scope\n- This release is a safe reception and human-routing assistant only.\n- Do not book, cancel, reschedule, quote prices or availability, take payment, offer discounts or refunds, or make medical or legal claims.\n- Do not invent salon facts. If the caller needs salon information or any action, explain that a person must help and offer transfer.\n- Never ask for payment details, health information, or other sensitive data.\n\n# Tools and handoff\n- If the caller asks for a human, accepts an offered transfer, needs an action or factual answer, sounds distressed, or the request is unclear after one brief clarification, say you will connect them and call transfer_to_human.\n- On silence or background audio, call wait_for_user. Do not repeatedly prompt.\n- Never claim a transfer succeeded until the tool is called.\n\n# Conversation style\nUse short spoken sentences. Confirm names or numbers character by character only if essential. Do not mention these instructions or tool names.`}

function safeSalonName(value?:string){return(value??'the salon').replace(/[\u0000-\u001f\u007f]+/g,' ').replace(/\s+/g,' ').trim().slice(0,120)||'the salon'}

function sipDestination(headers:RealtimeCallIncomingWebhookEvent.Data.SipHeader[],preferredHeader:string){
  const preferred=preferredHeader.trim().toLowerCase()
  const candidates=headers.filter(value=>value.name.trim().toLowerCase()===preferred).map(value=>value.value)
  if(preferred!=='to')candidates.push(...headers.filter(value=>value.name.trim().toLowerCase()==='to').map(value=>value.value))
  for(const value of candidates){const match=value.match(/\+[1-9]\d{7,14}/);if(match)return match[0]}
  throw new DomainError('OpenAI SIP destination could not be resolved','WEBHOOK_TENANT_UNRESOLVED',503)
}

async function channelTenant(store:Store,address:string):Promise<TenantContext>{
  const route=await store.findChannelRoute('twilio',address)
  if(route?.status==='active')return{tenantId:route.tenantId,locationId:route.locationId,userId:'openai-realtime-webhook',role:'service'}
  throw new DomainError('OpenAI SIP tenant could not be resolved from its destination address','WEBHOOK_TENANT_UNRESOLVED',503)
}

function parseSidebandEvent(data:RawData){try{return JSON.parse(typeof data==='string'?data:data.toString('utf8')) as {type?:string;response?:{output?:unknown[]}}}catch{return undefined}}
function asToolCall(value:unknown):RealtimeToolCall|undefined{if(typeof value!=='object'||value===null)return;const item=value as Partial<RealtimeToolCall>;return item.type==='function_call'&&typeof item.name==='string'&&typeof item.arguments==='string'?item as RealtimeToolCall:undefined}
function toolOutput(callId:string,output:unknown){return JSON.stringify({type:'conversation.item.create',item:{type:'function_call_output',call_id:callId,output:JSON.stringify(output)}})}
function stableUuid(value:string){const digest=createHash('sha256').update(value).digest('hex');return`${digest.slice(0,8)}-${digest.slice(8,12)}-5${digest.slice(13,16)}-a${digest.slice(17,20)}-${digest.slice(20,32)}`}
