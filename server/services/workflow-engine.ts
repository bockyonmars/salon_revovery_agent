import { randomUUID } from 'node:crypto'
import type { DomainEvent, WorkflowJob, WorkflowType } from '../domain/schemas.js'
import type { Store } from '../repositories/store.js'

export interface WorkflowActionHandler { execute(job: WorkflowJob): Promise<void> }
export class PermanentWorkflowError extends Error {}
export class RescheduleWorkflowError extends Error {constructor(message:string,readonly runAt:string){super(message)}}
export class PauseWorkflowError extends Error {}

export class WorkflowEngine {
  constructor(private readonly store:Store,private readonly handler:WorkflowActionHandler,private readonly workerId=`worker-${randomUUID()}`){}
  async tick(limit=20){
    const outbox=await this.store.getUnpublishedEvents(limit)
    for(const event of outbox){const settings=event.eventType==='appointment.completed'?await this.store.getLocationSettings({tenantId:event.tenantId,locationId:event.locationId,userId:'workflow:scheduler',role:'service'}):undefined;await this.store.dispatchWorkflowJobs(event,schedule(event,settings?.communicationPolicy?.defaultRebookDays??45))}
    const jobs=await this.store.claimDueWorkflowJobs(this.workerId,limit)
    for(const job of jobs){try{await this.handler.execute(job);await this.store.completeWorkflowJob(job,this.workerId)}catch(error){const detail=workflowFailureDetail(error);if(error instanceof PauseWorkflowError){await this.store.pauseWorkflowJob(job,this.workerId,detail);continue}const terminal=error instanceof PermanentWorkflowError||job.attempts>=job.maxAttempts;const delay=Math.min(15*60_000,2**Math.max(0,job.attempts-1)*5_000);const runAt=error instanceof RescheduleWorkflowError?error.runAt:new Date(Date.now()+delay).toISOString();if(terminal)await this.deadLetter(job,detail);else await this.store.retryWorkflowJob(job,this.workerId,runAt,detail)}}
    return {dispatched:outbox.length,processed:jobs.length}
  }

  private async deadLetter(job:WorkflowJob,reason:string){const now=new Date().toISOString();await this.store.deadLetterWorkflow(job,this.workerId,reason,{id:randomUUID(),tenantId:job.tenantId,locationId:job.locationId,requestType:job.workflowType==='weekly_roi_report'?'report_delivery':'workflow_failure',reason,status:'pending',entityType:'workflow_job',entityId:job.id,payload:{workflowType:job.workflowType,attempts:job.attempts,correlationId:job.correlationId},createdAt:now},randomUUID())}
}

export function workflowFailureDetail(error:unknown){
  if(error instanceof PauseWorkflowError||error instanceof PermanentWorkflowError||error instanceof RescheduleWorkflowError)return error.message.slice(0,240)
  return`Workflow dependency failed (${safeFailureCode(error)})`
}

function safeFailureCode(error:unknown){
  if(typeof error!=='object'||error===null)return'UNKNOWN'
  const value=error as Record<string,unknown>
  for(const candidate of[value.code,value.status,value.statusCode,value.name]){
    if(typeof candidate!=='string'&&typeof candidate!=='number')continue
    const normalized=String(candidate).toUpperCase().replace(/[^A-Z0-9_-]/g,'_').slice(0,64)
    if(normalized&&normalized!=='ERROR')return normalized
  }
  return'UNKNOWN'
}

export function schedule(event:DomainEvent,defaultRebookDays=45):WorkflowJob[]{
  const now=new Date();const jobs:Array<{type:WorkflowType;runAt:Date;payload:Record<string,unknown>}>=[];const payload=event.payload
  if(event.eventType==='appointment.booked'){jobs.push({type:'appointment_confirmation',runAt:now,payload});const startsAt=typeof payload.startsAt==='string'?Date.parse(payload.startsAt):NaN;if(Number.isFinite(startsAt)&&startsAt>Date.now())jobs.push({type:'appointment_reminder',runAt:new Date(Math.max(Date.now(),startsAt-24*60*60_000)),payload})}
  if(event.eventType==='appointment.rescheduled'){const startsAt=typeof payload.startsAt==='string'?Date.parse(payload.startsAt):NaN;if(Number.isFinite(startsAt)&&startsAt>Date.now())jobs.push({type:'appointment_reminder',runAt:new Date(Math.max(Date.now(),startsAt-24*60*60_000)),payload})}
  if(event.eventType==='appointment.cancelled')jobs.push({type:'waitlist_match',runAt:now,payload})
  if(event.eventType==='appointment.no_show')jobs.push({type:'no_show_recovery',runAt:new Date(Date.now()+30*60_000),payload})
  if(event.eventType==='appointment.completed'){const configured=typeof payload.rebookAt==='string'?Date.parse(payload.rebookAt):NaN;jobs.push({type:'review_request',runAt:new Date(Date.now()+24*60*60_000),payload});jobs.push({type:'post_visit_rebook',runAt:new Date(Number.isFinite(configured)?configured:Date.now()+defaultRebookDays*86_400_000),payload})}
  if(event.eventType==='client.lapsed')jobs.push({type:'lapsed_reactivation',runAt:now,payload})
  if(event.eventType==='message.replied'&&typeof payload.conversationId==='string'&&typeof payload.messageId==='string')jobs.push({type:'conversation_turn',runAt:now,payload})
  if(event.eventType==='conversation.followup_requested'&&typeof payload.conversationId==='string'&&typeof payload.triggerMessageId==='string')jobs.push({type:'abandoned_enquiry',runAt:new Date(Date.now()+20*60_000),payload})
  if(event.eventType==='call.missed'&&typeof payload.providerCallSid==='string'&&typeof payload.callerAddress==='string')jobs.push({type:'missed_call_recovery',runAt:new Date(Date.now()+2*60_000),payload})
  return jobs.map(({type,runAt,payload})=>{const timestamp=new Date().toISOString();const entity=String(payload.triggerMessageId??payload.messageId??payload.providerBookingId??payload.bookingId??event.correlationId);const time=type==='appointment_reminder'?`:${String(payload.startsAt??'unknown')}`:'';return{id:randomUUID(),tenantId:event.tenantId,locationId:event.locationId,workflowType:type,correlationId:event.correlationId,causationEventId:event.eventId,dedupeKey:`${event.tenantId}:${event.locationId}:${type}:${entity}${time}`,runAt:runAt.toISOString(),status:'pending',attempts:0,maxAttempts:5,payload,createdAt:timestamp,updatedAt:timestamp}})
}
