import { randomUUID } from 'node:crypto'
import type { RecoveryCase, TenantContext, WorkflowJob } from '../domain/schemas.js'
import type { Store } from '../repositories/store.js'
import { EventService } from './event-service.js'

export class RecoveryService {
  constructor(private readonly store:Store,_events:EventService){}
  async open(job:WorkflowJob){
    const context:TenantContext={tenantId:job.tenantId,locationId:job.locationId,userId:`workflow:${job.workflowType}`,role:'service'}
    const recoveryType:RecoveryCase['recoveryType']=job.workflowType==='no_show_recovery'?'no_show':job.workflowType==='post_visit_rebook'?'post_visit_rebook':job.workflowType==='lapsed_reactivation'?'lapsed_reactivation':'waitlist_fill'
    const value:RecoveryCase={id:randomUUID(),tenantId:job.tenantId,locationId:job.locationId,recoveryType,correlationId:job.correlationId,workflowJobId:job.id,status:'open',...(Number.isFinite(Number(job.payload.priceMinor))?{potentialRevenueMinor:Number(job.payload.priceMinor)}:{}),...(typeof job.payload.currency==='string'?{currency:job.payload.currency}:{}),openedAt:new Date().toISOString()}
    return (await this.store.openRecoveryCaseWithEvidence(context,value,{auditId:randomUUID(),eventId:randomUUID(),userId:context.userId,causationId:job.causationEventId,occurredAt:value.openedAt})).recoveryCase
  }
}
