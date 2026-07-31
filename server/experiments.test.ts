import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createApp } from './app.js'
import { ControlledExperimentInputSchema, type ControlledExperimentInput, type TenantContext, type WorkflowJob } from './domain/schemas.js'
import { MemoryStore } from './repositories/memory-store.js'
import { AuditService } from './services/audit-service.js'
import { ConsentService } from './services/consent-service.js'
import { ControlledExperimentService } from './services/controlled-experiment-service.js'
import { EventService } from './services/event-service.js'
import { MessageService } from './services/message-service.js'
import { RecoveryCampaignService } from './services/recovery-campaign-service.js'
import { RecoveryService } from './services/recovery-service.js'

const context:TenantContext={tenantId:'tenant-one',locationId:'location-one',userId:'manager-one',role:'manager'}
const template=(middle:string)=>`{{sender}}: ${middle} Reply STOP to unsubscribe.`
const input=(name='Reactivation copy test'):ControlledExperimentInput=>({name,workflowType:'lapsed_reactivation',variants:[{key:'control',allocation:50,messageTemplate:template('We have not seen you for a while. Reply if you would like to view current availability.')},{key:'concierge',allocation:50,messageTemplate:template('When you are ready for your next visit, reply and our salon team can help with current availability.')} ]})

describe('controlled recovery experiments',()=>{
  it('rejects unverified claims, unknown variables, missing opt-out text, and invalid allocations',()=>{
    const unsafe=[
      {...input(),variants:[{key:'a',allocation:50,messageTemplate:template('Urgent: claim a guaranteed discount today.')},{key:'b',allocation:50,messageTemplate:template('Reply if you would like to view current availability.')} ]},
      {...input(),variants:[{key:'a',allocation:50,messageTemplate:'{{client}}: Reply if you would like help. Reply STOP to unsubscribe.'},{key:'b',allocation:50,messageTemplate:template('Reply if you would like to view current availability.')} ]},
      {...input(),variants:[{key:'a',allocation:60,messageTemplate:template('Reply if you would like to view current availability.')},{key:'b',allocation:50,messageTemplate:template('Reply if you would like to view current availability.')} ]},
    ]
    for(const value of unsafe)expect(ControlledExperimentInputSchema.safeParse(value).success).toBe(false)
  })

  it('keeps assignment deterministic, prevents overlapping active tests, and isolates tenants',async()=>{
    const store=new MemoryStore();const experiments=new ControlledExperimentService(store)
    const first=await experiments.create(context,input());expect(await store.getAudit(context)).toEqual([expect.objectContaining({action:'experiment.created',entityId:first.id})]);await experiments.activate(context,first.id)
    const selected=await experiments.select(context,'lapsed_reactivation','client-one','Plum House')
    expect(await experiments.select(context,'lapsed_reactivation','client-one','Plum House')).toEqual(selected)
    expect(selected?.body).toContain('Plum House:');expect(selected?.body).not.toContain('{{sender}}')
    const second=await experiments.create(context,input('Second copy test'))
    await expect(experiments.activate(context,second.id)).rejects.toMatchObject({code:'ACTIVE_EXPERIMENT_CONFLICT'})
    expect(await experiments.list({...context,tenantId:'tenant-two'})).toEqual([])
    await experiments.pause(context,first.id);expect((await experiments.activate(context,second.id)).status).toBe('active')
  })

  it('records an exposure only for an accepted consent-checked send and reports verified revenue only',async()=>{
    const store=new MemoryStore();const audit=new AuditService(store);const events=new EventService(store);const consent=new ConsentService(store,audit);const sent:string[]=[]
    const messages=new MessageService({send:async({body})=>{sent.push(body);return{id:'SM-experiment-one',status:'queued'}}},consent,events,audit,store)
    const experiments=new ControlledExperimentService(store);const created=await experiments.create(context,input());await experiments.activate(context,created.id)
    const now=new Date().toISOString();await store.saveLocationSettings({tenantId:context.tenantId,locationId:context.locationId,salonName:'Plum House',senderName:'Plum House Salon',timezone:'UTC',updatedAt:now});await store.saveClientProfile({tenantId:context.tenantId,locationId:context.locationId,clientId:'client-one',contactTo:'+447700900181',timezone:'UTC',updatedAt:now});await consent.record(context,{clientId:'client-one',channel:'sms',purpose:'marketing',status:'opted_in',captureMethod:'marketing_form',disclosureVersion:'v1'})
    const job:WorkflowJob={id:randomUUID(),tenantId:context.tenantId,locationId:context.locationId,workflowType:'lapsed_reactivation',correlationId:'experiment-recovery-one',causationEventId:randomUUID(),dedupeKey:'experiment-recovery-one',runAt:now,status:'running',attempts:1,maxAttempts:5,payload:{clientId:'client-one'},createdAt:now,updatedAt:now}
    await new RecoveryCampaignService(store,messages,events,new RecoveryService(store,events),()=>new Date('2026-07-19T12:00:00.000Z'),experiments).execute(job)
    expect(sent).toHaveLength(1);expect(created.variants.some(value=>sent[0]===value.messageTemplate.replace('{{sender}}','Plum House Salon'))).toBe(true)
    const exposures=await store.listExperimentExposures(context,created.id);expect(exposures).toEqual([expect.objectContaining({workflowJobId:job.id,providerMessageId:'SM-experiment-one'})])
    let results=await experiments.results(context,created.id);expect(results.variants.reduce((total,value)=>total+value.recoveredBookings,0)).toBe(0);expect(results.winnerSuggested).toBe(false)
    await store.saveRevenueAttribution({id:randomUUID(),tenantId:context.tenantId,locationId:context.locationId,bookingId:randomUUID(),sourceId:randomUUID(),workflowJobId:job.id,recoveryCorrelationId:job.correlationId,amountMinor:22500,currency:'GBP',attributionType:'lapsed_reactivation',evidence:'sent_recovery_before_booking',touchAt:now,verifiedAt:now})
    results=await experiments.results(context,created.id);const exposed=results.variants.find(value=>value.variantKey===exposures[0]!.variantKey)!;expect(exposed).toMatchObject({exposures:1,recoveredBookings:1,conversionRate:1,verifiedRecoveredRevenueMinorByCurrency:{GBP:22500}});expect(results.minimumSampleReached).toBe(false)
  })

  it('keeps experiment management manager-only over the API',async()=>{
    const server=createApp(new MemoryStore());const payload=input()
    try{const forbidden=await server.inject({method:'POST',url:'/v1/experiments',headers:{authorization:'Bearer dev:tenant-one:location-one:operator-one:operator'},payload});expect(forbidden.statusCode).toBe(403);const created=await server.inject({method:'POST',url:'/v1/experiments',headers:{authorization:'Bearer dev:tenant-one:location-one:manager-one:manager'},payload});expect(created.statusCode).toBe(201);const listed=await server.inject({method:'GET',url:'/v1/experiments',headers:{authorization:'Bearer dev:tenant-one:location-one:manager-one:manager'}});expect(listed.json().experiments).toEqual([expect.objectContaining({id:created.json().id,status:'draft'})])}finally{await server.close()}
  })
})
