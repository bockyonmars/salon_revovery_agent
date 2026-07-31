import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createApp } from './app.js'
import type { BookingRecord, TenantContext } from './domain/schemas.js'
import { MemoryStore } from './repositories/memory-store.js'
import { ClientCohortService } from './services/client-cohort-service.js'
import { MonthlyOwnerReviewService } from './services/monthly-owner-review-service.js'

const owner:TenantContext={tenantId:'tenant-one',locationId:'location-one',userId:'owner-one',role:'owner'}
const from='2026-07-01T00:00:00.000Z';const to='2026-08-01T00:00:00.000Z';const now='2026-08-01T01:00:00.000Z'

describe('active-client cohort evidence',()=>{
  it('creates an identity-free 180-day cohort snapshot from completed Square bookings only',async()=>{
    const store=new MemoryStore();await seedBookings(store);const snapshot=await new ClientCohortService(store,undefined,()=>new Date(now)).generate(owner,{from,to})
    expect(snapshot).toMatchObject({policyVersion:'active-client-180d-v1',activityWindowDays:180,periodFrom:from,periodTo:to,startWindowFrom:'2026-01-02T00:00:00.000Z',endWindowFrom:'2026-02-02T00:00:00.000Z',evidenceStatus:'sufficient',metrics:{completedBookingsConsidered:5,startCompletedBookings:3,endCompletedBookings:4,startActiveClients:3,endActiveClients:3,retainedClients:2,churnedClients:1,newlyActiveClients:1,churnRate:1/3},evidence:'square_completed_bookings',containsClientIdentities:false});expect(snapshot.snapshotDigest).toMatch(/^[a-f0-9]{64}$/);expect(await store.getAudit(owner)).toEqual([expect.objectContaining({action:'client_cohort.generated',result:expect.objectContaining({snapshotId:snapshot.id,snapshotDigest:snapshot.snapshotDigest})})]);const serialized=JSON.stringify(snapshot);for(const identity of['client-retained','client-churned','client-existing','client-new','BOOK-'])expect(serialized).not.toContain(identity)
  })

  it('automatically attaches a fresh cohort snapshot to the monthly owner review',async()=>{
    const store=new MemoryStore();await seedBookings(store);const report=(await new MonthlyOwnerReviewService(store,undefined,()=>new Date(now)).generate(owner,{from,to})).report;expect(report.revenue.churn).toMatchObject({status:'available',policyVersion:'active-client-180d-v1',startActiveClients:3,endActiveClients:3,retainedClients:2,churnedClients:1,newlyActiveClients:1,churnRate:1/3});expect(report.dataQuality.unavailableMetrics).toEqual(['model_cost']);expect(report.actionItems.map(value=>value.key)).not.toContain('client_churn_unavailable')
  })

  it('fails closed when the starting cohort has no valid churn denominator',async()=>{
    const store=new MemoryStore();const snapshot=await new ClientCohortService(store,undefined,()=>new Date(now)).generate(owner,{from,to});expect(snapshot).toMatchObject({evidenceStatus:'insufficient',metrics:{startActiveClients:0,endActiveClients:0,churnedClients:0,churnRate:null}});const report=(await new MonthlyOwnerReviewService(store,undefined,()=>new Date(now)).generate(owner,{from,to})).report;expect(report.revenue.churn).toMatchObject({status:'unavailable',requiredEvidence:expect.stringContaining('at least one active client')});expect(report.dataQuality.unavailableMetrics).toContain('client_churn');expect(report.actionItems.map(value=>value.key)).toContain('client_churn_unavailable')
  })

  it('enforces owner and period boundaries through service, repository, and no-store APIs',async()=>{
    const store=new MemoryStore();await seedBookings(store);const manager={...owner,userId:'manager-one',role:'manager' as const};await expect(new ClientCohortService(store).generate(manager,{from,to})).rejects.toMatchObject({code:'ROLE_FORBIDDEN'});await expect(store.getOwnerClientCohortBookings(manager,from,to)).rejects.toThrow('OWNER_COHORT_ACCESS_REQUIRED');const server=createApp(store);const ownerAuth={authorization:'Bearer dev:tenant-one:location-one:owner-one:owner'}
    try{const denied=await server.inject({method:'POST',url:'/v1/reports/client-cohorts',headers:{authorization:'Bearer dev:tenant-one:location-one:manager-one:manager'},payload:{from,to}});expect(denied.statusCode).toBe(403);const created=await server.inject({method:'POST',url:'/v1/reports/client-cohorts',headers:ownerAuth,payload:{from,to}});expect(created.statusCode).toBe(201);expect(created.headers['cache-control']).toBe('no-store');const history=await server.inject({method:'GET',url:'/v1/reports/client-cohorts/snapshots?limit=1',headers:ownerAuth});expect(history.statusCode).toBe(200);expect(history.headers['cache-control']).toBe('no-store');expect(history.json().snapshots).toHaveLength(1);const oversized=await server.inject({method:'POST',url:'/v1/reports/client-cohorts',headers:ownerAuth,payload:{from:'2026-01-01T00:00:00.000Z',to:'2026-03-01T00:00:00.000Z'}});expect(oversized.statusCode).toBe(400)}finally{await server.close()}
  })
})

async function seedBookings(store:MemoryStore){const values=[booking('client-retained','2026-06-15T10:00:00.000Z'),booking('client-retained','2026-07-15T10:00:00.000Z'),booking('client-churned','2026-01-15T10:00:00.000Z'),booking('client-existing','2026-02-15T10:00:00.000Z'),booking('client-new','2026-07-10T10:00:00.000Z'),booking('client-accepted','2026-07-12T10:00:00.000Z','ACCEPTED'),{...booking('other-client','2026-07-12T10:00:00.000Z'),tenantId:'tenant-two',locationId:'location-two'}];for(const value of values)await store.saveBookingMutation({tenantId:value.tenantId,locationId:value.locationId,userId:'seed',role:'service'},randomUUID(),value)}
function booking(clientId:string,startsAt:string,providerStatus='COMPLETED'):BookingRecord{return{id:randomUUID(),tenantId:owner.tenantId,locationId:owner.locationId,holdId:randomUUID(),clientId,bookingReference:`BOOK-${clientId}`,priceMinor:18500,currency:'GBP',createdAt:startsAt,provider:'square',providerBookingId:randomUUID(),providerBookingVersion:1,providerStatus,serviceId:'service-one',staffId:'staff-one',startsAt}}
