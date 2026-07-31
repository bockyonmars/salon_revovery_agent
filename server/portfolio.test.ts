import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createApp } from './app.js'
import type { ApprovalRequest, BillingAccount, ControlledExperiment, OutboundMessageDelivery, RecoveryCase, RevenueAttribution, TenantContext, WorkflowJob } from './domain/schemas.js'
import { MemoryStore } from './repositories/memory-store.js'
import { TenantPortfolioService } from './services/tenant-portfolio-service.js'

const owner:TenantContext={tenantId:'tenant-one',locationId:'location-one',userId:'owner-one',role:'owner'}
const from='2026-07-01T00:00:00.000Z';const to='2026-08-01T00:00:00.000Z';const now='2026-07-19T12:00:00.000Z'

describe('owner multi-location portfolio analytics',()=>{
  it('aggregates verified evidence across one tenant without returning client or destination data',async()=>{
    const store=new MemoryStore();await seed(store)
    const report=await new TenantPortfolioService(store,undefined,()=>new Date(now)).report(owner,{from,to})
    expect(report.portfolio.locationCount).toBe(2);expect(report.portfolio.locations.map(value=>value.locationName)).toEqual(['Plum House Chelsea','Plum House Mayfair'])
    expect(report.totals).toMatchObject({verifiedRecoveredRevenueMinorByCurrency:{GBP:30000},recoveredBookings:2,recoveryCases:{opened:2,resolved:1,closed:0,open:1},messaging:{attempted:2,delivered:1,failed:1,deliveryRate:.5,currentMarketingConsentRecords:2,currentMarketingOptOuts:1,currentMarketingOptOutRate:.5},operations:{pendingWorkflows:1,failedWorkflows:1,pendingApprovals:1},experiments:{active:1,draft:1}})
    expect(report.dataQuality).toMatchObject({estimatedRevenueIncluded:false,unattributedBookingsIncluded:false,containsClientIdentities:false,consentMetric:'current_record_snapshot_not_period_flow'})
    const serialized=JSON.stringify(report);expect(serialized).not.toContain('client-one');expect(serialized).not.toContain('+447700900181');expect(serialized).not.toContain('tenant-two')
  })

  it('enforces the period boundary while retaining current operational backlogs',async()=>{
    const store=new MemoryStore();await seed(store);const report=await new TenantPortfolioService(store).report(owner,{from:'2026-07-15T00:00:00.000Z',to})
    expect(report.totals.recoveredBookings).toBe(1);expect(report.totals.verifiedRecoveredRevenueMinorByCurrency).toEqual({GBP:20000});expect(report.totals.operations).toMatchObject({pendingWorkflows:1,failedWorkflows:1,pendingApprovals:1})
  })

  it('denies managers at both the service and repository boundaries',async()=>{
    const store=new MemoryStore();await seed(store);const manager={...owner,userId:'manager-one',role:'manager' as const}
    await expect(new TenantPortfolioService(store).report(manager,{from,to})).rejects.toMatchObject({code:'ROLE_FORBIDDEN'});await expect(store.getOwnerTenantPortfolioData(manager,from,to)).rejects.toThrow('OWNER_PORTFOLIO_ACCESS_REQUIRED')
  })

  it('exposes a no-store owner API and rejects managers and oversized ranges',async()=>{
    const store=new MemoryStore();await seed(store);const server=createApp(store)
    try{const manager=await server.inject({method:'GET',url:`/v1/reports/portfolio?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,headers:{authorization:'Bearer dev:tenant-one:location-one:manager-one:manager'}});expect(manager.statusCode).toBe(403);const response=await server.inject({method:'GET',url:`/v1/reports/portfolio?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,headers:{authorization:'Bearer dev:tenant-one:location-one:owner-one:owner'}});expect(response.statusCode).toBe(200);expect(response.headers['cache-control']).toBe('no-store');expect(response.json()).toMatchObject({tenantId:'tenant-one',portfolio:{locationCount:2},totals:{recoveredBookings:2}});const oversized=await server.inject({method:'GET',url:'/v1/reports/portfolio?from=2026-01-01T00%3A00%3A00.000Z&to=2026-03-01T00%3A00%3A00.000Z',headers:{authorization:'Bearer dev:tenant-one:location-one:owner-one:owner'}});expect(oversized.statusCode).toBe(400);expect(oversized.json().error).toBe('VALIDATION_ERROR')}finally{await server.close()}
  })
})

async function seed(store:MemoryStore){
  const locationOne={...owner};const locationTwo={...owner,locationId:'location-two'};const other={...owner,tenantId:'tenant-two',locationId:'location-other'}
  await store.saveLocationSettings({tenantId:owner.tenantId,locationId:'location-one',salonName:'Plum House Mayfair',senderName:'Plum House',timezone:'Europe/London',updatedAt:now});await store.saveLocationSettings({tenantId:owner.tenantId,locationId:'location-two',salonName:'Plum House Chelsea',senderName:'Plum House',timezone:'Europe/London',updatedAt:now});await store.saveLocationSettings({tenantId:other.tenantId,locationId:other.locationId,salonName:'Other Tenant Salon',senderName:'Other',timezone:'UTC',updatedAt:now})
  await store.saveRevenueAttribution(attribution(locationOne,'2026-07-10T10:00:00.000Z',10000));await store.saveRevenueAttribution(attribution(locationTwo,'2026-07-20T10:00:00.000Z',20000));await store.saveRevenueAttribution(attribution(locationOne,'2026-06-20T10:00:00.000Z',99999));await store.saveRevenueAttribution(attribution(other,'2026-07-20T10:00:00.000Z',77777))
  await store.openRecoveryCase(recovery(locationOne,'resolved'));const open=await store.openRecoveryCase(recovery(locationTwo,'open'));await store.resolveRecoveryCase(locationOne,(await store.listRecoveryCases(locationOne))[0]!.correlationId,randomUUID());expect(open.status).toBe('open')
  await saveDelivery(store,locationOne,'delivered','client-one','+447700900181');await saveDelivery(store,locationTwo,'failed','client-two','+447700900182');await saveDelivery(store,other,'delivered','other-client','+447700900999')
  await store.enqueueWorkflowJob(job(locationOne,'pending'));await store.enqueueWorkflowJob(job(locationTwo,'failed'));await store.createApprovalRequest(approval(locationTwo));await store.createApprovalRequest(approval(other))
  await store.saveConsent({id:randomUUID(),tenantId:owner.tenantId,locationId:'location-one',clientId:'client-one',channel:'sms',purpose:'marketing',status:'opted_in',captureMethod:'marketing_form',disclosureVersion:'v1',capturedAt:now});await store.saveConsent({id:randomUUID(),tenantId:owner.tenantId,locationId:'location-two',clientId:'client-two',channel:'whatsapp',purpose:'marketing',status:'opted_out',captureMethod:'STOP_keyword',disclosureVersion:'v1',capturedAt:now,revokedAt:now})
  await store.saveLocationActivation({tenantId:owner.tenantId,locationId:'location-one',status:'active',activatedAt:now,activatedBy:owner.userId,updatedAt:now});await store.saveLocationActivation({tenantId:owner.tenantId,locationId:'location-two',status:'draft',updatedAt:now});await store.saveBillingAccountFromEvent(billing(locationOne,'active'));await store.saveBillingAccountFromEvent(billing(locationTwo,'trialing'))
  await store.saveExperiment(experiment(locationOne,'active'));await store.saveExperiment(experiment(locationTwo,'draft'));await store.recordProviderCircuitFailure(locationTwo,'twilio',now,1,60_000,'TIMEOUT')
}

function attribution(context:TenantContext,verifiedAt:string,amountMinor:number):RevenueAttribution{return{id:randomUUID(),tenantId:context.tenantId,locationId:context.locationId,bookingId:randomUUID(),sourceId:randomUUID(),workflowJobId:randomUUID(),amountMinor,currency:'GBP',attributionType:'lapsed_reactivation',evidence:'sent_recovery_before_booking',touchAt:verifiedAt,verifiedAt}}
function recovery(context:TenantContext,status:RecoveryCase['status']):RecoveryCase{return{id:randomUUID(),tenantId:context.tenantId,locationId:context.locationId,recoveryType:'lapsed_reactivation',correlationId:randomUUID(),workflowJobId:randomUUID(),status,openedAt:'2026-07-12T10:00:00.000Z',...(status==='resolved'?{resolvedAt:'2026-07-13T10:00:00.000Z',resultBookingId:randomUUID()}:{})}}
async function saveDelivery(store:MemoryStore,context:TenantContext,status:OutboundMessageDelivery['status'],clientId:string,toAddress:string){const value:OutboundMessageDelivery={id:randomUUID(),tenantId:context.tenantId,locationId:context.locationId,clientId,channel:'sms',purpose:'marketing',to:toAddress,correlationId:randomUUID(),idempotencyKey:randomUUID(),status:'reserved',createdAt:now,updatedAt:now};const reserved=await store.reserveOutboundMessageDelivery(value);await store.saveOutboundMessageDelivery({...reserved.delivery,status,providerMessageId:randomUUID(),updatedAt:now})}
function job(context:TenantContext,status:WorkflowJob['status']):WorkflowJob{return{id:randomUUID(),tenantId:context.tenantId,locationId:context.locationId,workflowType:'lapsed_reactivation',correlationId:randomUUID(),causationEventId:randomUUID(),dedupeKey:randomUUID(),runAt:now,status,attempts:status==='failed'?5:0,maxAttempts:5,payload:{},createdAt:now,updatedAt:now}}
function approval(context:TenantContext):ApprovalRequest{return{id:randomUUID(),tenantId:context.tenantId,locationId:context.locationId,requestType:'workflow_failure',reason:'Test failure',status:'pending',entityType:'workflow_job',entityId:randomUUID(),payload:{},createdAt:now}}
function billing(context:TenantContext,status:BillingAccount['status']):BillingAccount{return{id:randomUUID(),tenantId:context.tenantId,locationId:context.locationId,provider:'stripe',customerId:randomUUID(),subscriptionId:randomUUID(),status,cancelAtPeriodEnd:false,providerEventCreated:1,sourceEventId:randomUUID(),sourceEventType:'customer.subscription.updated',createdAt:now,updatedAt:now}}
function experiment(context:TenantContext,status:ControlledExperiment['status']):ControlledExperiment{return{id:randomUUID(),tenantId:context.tenantId,locationId:context.locationId,name:'Portfolio experiment',workflowType:'lapsed_reactivation',version:1,status,variants:[{key:'a',allocation:50,messageTemplate:'{{sender}}: Reply if you would like help with current availability. Reply STOP to unsubscribe.'},{key:'b',allocation:50,messageTemplate:'{{sender}}: Our salon team can help with current availability when you are ready. Reply STOP to unsubscribe.'}],createdBy:owner.userId,createdAt:now,updatedBy:owner.userId,updatedAt:now,...(status==='active'?{activatedAt:now}:{})}}
