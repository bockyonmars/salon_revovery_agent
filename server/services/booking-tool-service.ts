import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { DomainError } from '../domain/errors.js'
import { AvailabilitySearchInputSchema, SupportKnowledgeSearchSchema, type BookingToolName, type TenantContext, type ToolCallRecord } from '../domain/schemas.js'
import type { Store } from '../repositories/store.js'
import { AuditService } from './audit-service.js'
import { BookingService } from './booking-service.js'
import type { BookingGateway } from './square-booking-gateway.js'
import { redactSensitive, traceSafeToolResult } from '../security/pii-redaction.js'
import type { SupportKnowledgeService } from './support-knowledge-service.js'

const EmptyInput=z.object({}).strict()
const ServiceInput=z.object({serviceId:z.string().min(3)}).strict()
const AvailabilityInput=AvailabilitySearchInputSchema
const HoldToolInput=z.object({serviceId:z.string().min(3),staffId:z.string().min(3),startsAt:z.string().datetime()}).strict()

export type BookingToolRequest={conversationId:string;inputMessageId:string;agentRunId:string;clientId:string;providerCallId:string;toolName:BookingToolName;arguments:unknown}
export type BookingToolResult={ok:true;data:unknown}|{ok:false;errorCode:string;message:string}

export interface BookingToolExecutor{execute(context:TenantContext,request:BookingToolRequest):Promise<BookingToolResult>}

export class BookingToolService implements BookingToolExecutor{
  constructor(private readonly store:Store,private readonly bookings:BookingService,private readonly gateway:BookingGateway,_audit:AuditService,private readonly requireAutomation:((context:TenantContext)=>Promise<void>)=async()=>{},private readonly supportKnowledge?:SupportKnowledgeService){}

  async execute(context:TenantContext,request:BookingToolRequest):Promise<BookingToolResult>{
    const createdAt=new Date().toISOString()
    try{
      const data=await this.call(context,request.toolName,request.arguments,request.clientId,request.conversationId)
      if(request.toolName==='create_temporary_hold'&&holdResult(data)){const now=new Date().toISOString();try{await this.store.saveConversationAction({id:randomUUID(),tenantId:context.tenantId,locationId:context.locationId,conversationId:request.conversationId,clientId:request.clientId,actionType:'book_appointment',holdId:data.holdId,agentRunId:request.agentRunId,status:'prepared',createdAt:now,updatedAt:now})}catch(error){await this.store.cancelHold(context,data.holdId);throw error}}
      const result:BookingToolResult={ok:true,data}
      await this.record(context,request,'completed',createdAt,result)
      return result
    }catch(error){
      const errorCode=error instanceof DomainError?error.code:'BOOKING_TOOL_FAILED'
      const message=error instanceof DomainError?error.message:'The booking tool could not be completed.'
      const result:BookingToolResult={ok:false,errorCode,message}
      await this.record(context,request,'failed',createdAt,result,errorCode)
      if(error instanceof DomainError&&error.statusCode>=500)throw new BookingToolExecutionError(message,true,error)
      return result
    }
  }

  private async call(context:TenantContext,name:BookingToolName,raw:unknown,clientId:string,conversationId:string):Promise<unknown>{
    if(name==='get_salon_information'){
      EmptyInput.parse(raw);const value=await this.store.getLocationSettings(context)
      if(!value)throw new DomainError('Salon information is not configured','LOCATION_SETTINGS_REQUIRED',409)
      return{salonName:value.salonName,senderName:value.senderName,timezone:value.timezone,brandVoice:value.brandVoice}
    }
    if(name==='list_services'){
      EmptyInput.parse(raw);const values=(await this.store.listServices(context)).filter(value=>value.active).slice(0,50)
      return{services:values.map(value=>({serviceId:value.id,name:value.name,variationName:value.variationName,durationMinutes:value.durationMinutes,priceMinor:value.priceMinor,currency:value.currency}))}
    }
    if(name==='get_service_details'){
      const input=ServiceInput.parse(raw);const value=await this.store.getService(context,input.serviceId)
      if(!value?.active)throw new DomainError('Service is not available at this location','SERVICE_NOT_FOUND',404)
      return{serviceId:value.id,name:value.name,variationName:value.variationName,durationMinutes:value.durationMinutes,priceMinor:value.priceMinor,currency:value.currency,staffIds:value.teamMemberIds}
    }
    if(name==='list_staff'){
      EmptyInput.parse(raw);const values=(await this.store.listStaff(context)).filter(value=>value.bookable).slice(0,50)
      return{staff:values.map(value=>({staffId:value.id,name:value.name}))}
    }
    if(name==='search_support_knowledge'){
      const input=SupportKnowledgeSearchSchema.parse(raw)
      if(!this.supportKnowledge)throw new DomainError('Support knowledge is not configured','SUPPORT_KNOWLEDGE_UNAVAILABLE',409)
      return this.supportKnowledge.search(context,input)
    }
    if(name==='search_availability'){
      const input=AvailabilityInput.parse(raw)
      if(Date.parse(input.from)<Date.now()-60_000)throw new DomainError('Availability searches must begin in the future','AVAILABILITY_RANGE_PAST',400)
      const slots=(await this.gateway.searchAvailability(context,input)).slice(0,3)
      const service=await this.store.getService(context,input.serviceId);const staff=await this.store.listStaff(context)
      return{timezone:(await this.store.getLocationSettings(context))?.timezone,service:service&&{serviceId:service.id,name:service.name,variationName:service.variationName,priceMinor:service.priceMinor,currency:service.currency},options:slots.map(value=>({...value,staffName:staff.find(member=>member.id===value.staffId)?.name}))}
    }
    const input=HoldToolInput.parse(raw)
    if(await this.store.getActiveConversationAction(context,conversationId))throw new DomainError('This conversation already has a temporary hold awaiting confirmation','PENDING_CONFIRMATION_EXISTS',409)
    await this.requireAutomation(context)
    const[service,staff,client,settings,conversation]=await Promise.all([this.store.getService(context,input.serviceId),this.store.getStaff(context,input.staffId),this.store.getClientProfile(context,clientId),this.store.getLocationSettings(context),this.store.getConversation(context,conversationId)])
    if(!service?.active||service.priceMinor===undefined||!service.currency)throw new DomainError('The service price is not available','SERVICE_PRICE_UNAVAILABLE',409)
    if(!staff?.bookable)throw new DomainError('The selected staff member is not bookable','STAFF_NOT_BOOKABLE',409)
    if(!client?.providerCustomerId)throw new DomainError('A verified Square customer profile is required before holding a slot','PROVIDER_CUSTOMER_REQUIRED',409)
    if(!settings)throw new DomainError('Salon information is not configured','LOCATION_SETTINGS_REQUIRED',409)
    const hold=await this.bookings.createHold(context,{clientId:client.clientId,serviceId:service.id,staffId:staff.id,startsAt:input.startsAt,timezone:settings.timezone,expectedPriceMinor:service.priceMinor,currency:service.currency,provider:'square',providerCustomerId:client.providerCustomerId,contactTo:client.contactTo,...(conversation?.channel==='sms'||conversation?.channel==='whatsapp'?{channel:conversation.channel}:{})})
    return{holdId:hold.id,expiresAt:hold.expiresAt,service:{serviceId:service.id,name:service.name,variationName:service.variationName,durationMinutes:service.durationMinutes,priceMinor:service.priceMinor,currency:service.currency},staff:{staffId:staff.id,name:staff.name},startsAt:hold.startsAt,timezone:hold.timezone,salonName:settings.salonName,requiresExplicitConfirmation:true}
  }

  private async record(context:TenantContext,request:BookingToolRequest,status:ToolCallRecord['status'],createdAt:string,result:BookingToolResult,errorCode?:string){
    const value:ToolCallRecord={id:randomUUID(),tenantId:context.tenantId,locationId:context.locationId,conversationId:request.conversationId,inputMessageId:request.inputMessageId,agentRunId:request.agentRunId,providerCallId:request.providerCallId,toolName:request.toolName,status,input:redactSensitive(request.arguments),result:traceSafeToolResult(request.toolName,result),errorCode,createdAt,completedAt:new Date().toISOString()}
    await this.store.saveToolCallWithAudit(context,value,{auditId:randomUUID(),userId:context.userId,occurredAt:value.completedAt})
  }
}

export class BookingToolExecutionError extends Error{constructor(message:string,readonly retryable:boolean,cause?:unknown){super(message,{cause})}}
function holdResult(value:unknown):value is {holdId:string}{return typeof value==='object'&&value!==null&&'holdId'in value&&typeof value.holdId==='string'}
