import { describe, expect, it } from 'vitest'
import { CommunicationPolicySchema } from './domain/schemas.js'
import { MemoryStore } from './repositories/memory-store.js'
import { nextAllowedContactAt, SAFE_CONTACT_WINDOW } from './services/communication-policy.js'
import { TenantHealthService } from './services/tenant-health-service.js'
import { schedule } from './services/workflow-engine.js'
import { createApp } from './app.js'

const policy={policyVersion:'communication-v1',transactionalDisclosureVersion:'transactional-v1',marketingDisclosureVersion:'marketing-v1',escalationContactName:'Duty manager',escalationContactEmail:'manager@example.com',contactWindowStartHour:11,contactWindowEndHour:17,defaultRebookDays:45}
const context={tenantId:'tenant-one',locationId:'location-one',userId:'manager-one',role:'manager' as const}

describe('authoritative communication policy',()=>{
  it('validates versioned disclosures, escalation ownership, hours, and rebooking limits',()=>{
    expect(CommunicationPolicySchema.parse(policy)).toEqual(policy)
    expect(CommunicationPolicySchema.safeParse({...policy,contactWindowStartHour:17,contactWindowEndHour:17}).success).toBe(false)
    expect(CommunicationPolicySchema.safeParse({...policy,escalationContactEmail:'not-an-email'}).success).toBe(false)
    expect(CommunicationPolicySchema.safeParse({...policy,defaultRebookDays:2}).success).toBe(false)
  })

  it('uses the configured client-local contact window and retains a safe legacy fallback',()=>{
    expect(SAFE_CONTACT_WINDOW).toEqual({startHour:9,endHour:20})
    expect(nextAllowedContactAt(new Date('2026-07-20T10:15:00.000Z'),'UTC',policy).toISOString()).toBe('2026-07-20T11:00:00.000Z')
    expect(nextAllowedContactAt(new Date('2026-07-20T14:15:00.000Z'),'UTC',policy).toISOString()).toBe('2026-07-20T14:15:00.000Z')
    expect(nextAllowedContactAt(new Date('2026-07-20T17:00:00.000Z'),'UTC',policy).toISOString()).toBe('2026-07-21T11:00:00.000Z')
  })

  it('schedules the default post-visit rebooking interval from policy when the event has no override',()=>{
    const before=Date.now()
    const jobs=schedule({eventId:crypto.randomUUID(),tenantId:context.tenantId,locationId:context.locationId,eventType:'appointment.completed',occurredAt:new Date().toISOString(),correlationId:'booking-one',schemaVersion:1,payload:{clientId:'client-one',bookingId:'booking-one'}},policy.defaultRebookDays)
    const rebook=jobs.find(value=>value.workflowType==='post_visit_rebook')!
    expect(Date.parse(rebook.runAt)).toBeGreaterThanOrEqual(before+45*86_400_000)
    expect(Date.parse(rebook.runAt)).toBeLessThanOrEqual(Date.now()+45*86_400_000+1_000)
  })

  it('blocks tenant readiness until an explicit policy is published',async()=>{
    const store=new MemoryStore()
    const now=new Date().toISOString()
    await store.saveLocationSettings({tenantId:context.tenantId,locationId:context.locationId,salonName:'Plum House',senderName:'Plum House Salon',timezone:'Europe/London',updatedAt:now})
    const health=new TenantHealthService(store,{messagingConfigured:false,reportEmailConfigured:false,billingConfigured:false,rateLimitingConfigured:false})
    expect((await health.inspect(context)).checks).toEqual(expect.arrayContaining([expect.objectContaining({key:'communication_policy',status:'blocked'})]))
    await store.saveLocationSettings({tenantId:context.tenantId,locationId:context.locationId,salonName:'Plum House',senderName:'Plum House Salon',timezone:'Europe/London',communicationPolicy:policy,updatedAt:now})
    expect((await health.inspect(context)).checks).toEqual(expect.arrayContaining([expect.objectContaining({key:'communication_policy',status:'ready',detail:expect.stringContaining('11:00 to 17:00')})]))
  })

  it('validates and audits manager-published policy without retaining the escalation email in audit output',async()=>{
    const store=new MemoryStore()
    const app=createApp(store)
    const headers={authorization:'Bearer dev:tenant-one:location-one:manager-one:manager'}
    try{
      const invalid=await app.inject({method:'PUT',url:'/v1/location-settings',headers,payload:{salonName:'Plum House',senderName:'Plum House',timezone:'Europe/London',communicationPolicy:{...policy,contactWindowStartHour:18,contactWindowEndHour:9}}})
      expect(invalid.statusCode).toBe(400)
      const saved=await app.inject({method:'PUT',url:'/v1/location-settings',headers,payload:{salonName:'Plum House',senderName:'Plum House',timezone:'Europe/London',communicationPolicy:policy}})
      expect(saved.statusCode).toBe(200)
      expect(saved.json()).toMatchObject({communicationPolicy:policy})
      const activeAt=new Date().toISOString()
      await store.saveLocationActivation({tenantId:context.tenantId,locationId:context.locationId,status:'active',onboardingRunId:crypto.randomUUID(),activatedAt:activeAt,activatedBy:'manager-one',updatedAt:activeAt})
      const changed=await app.inject({method:'PUT',url:'/v1/location-settings',headers,payload:{salonName:'Plum House',senderName:'Plum House',timezone:'Europe/London',communicationPolicy:{...policy,contactWindowStartHour:10}}})
      expect(changed.statusCode).toBe(200)
      expect(await store.getLocationActivation(context)).toMatchObject({status:'draft'})
      const audit=await store.getAudit(context)
      expect(audit).toEqual(expect.arrayContaining([expect.objectContaining({action:'location_settings.updated'})]))
      expect(JSON.stringify(audit)).not.toContain(policy.escalationContactEmail)
    }finally{await app.close()}
  })
})
