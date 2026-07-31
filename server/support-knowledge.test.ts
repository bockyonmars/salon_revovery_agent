import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { createApp } from './app.js'
import { DomainError } from './domain/errors.js'
import { MemoryStore } from './repositories/memory-store.js'
import { AuditService } from './services/audit-service.js'
import { BookingService } from './services/booking-service.js'
import { BookingToolService } from './services/booking-tool-service.js'
import { EventService } from './services/event-service.js'
import type { BookingGateway } from './services/square-booking-gateway.js'
import { SupportKnowledgeService } from './services/support-knowledge-service.js'

const apps:Array<ReturnType<typeof createApp>>=[]
afterEach(async()=>{await Promise.all(apps.splice(0).map(value=>value.close()))})
const context={tenantId:'tenant-one',locationId:'location-one',userId:'manager-one',role:'manager' as const}
const article={title:'Late arrivals',summary:'What happens when a guest arrives after the appointment start time.',content:'Guests arriving more than ten minutes late should contact the salon. The team will confirm whether the full service can still be completed safely.',topics:['lateness','arrival policy'],status:'published' as const}
const auth=(tenant='tenant-one',location='location-one',user='operator-one',role='operator')=>({authorization:`Bearer dev:${tenant}:${location}:${user}:${role}`})

describe('approved support knowledge base',()=>{
  it('versions manager content and retrieves only current published tenant knowledge',async()=>{
    const store=new MemoryStore();const service=new SupportKnowledgeService(store,new AuditService(store))
    const draft=await service.publish(context,'late-arrivals',{...article,status:'draft'})
    expect(draft).toMatchObject({version:1,status:'draft',slug:'late-arrivals'})
    expect(await service.search(context,{query:'late arrival policy'})).toEqual({matches:[],grounded:false})
    const published=await service.publish(context,'late-arrivals',article)
    expect(published).toMatchObject({id:draft.id,version:2,status:'published',publishedAt:expect.any(String)})
    expect(published.contentHash).not.toBe(draft.contentHash)
    const result=await service.search(context,{query:'What happens if I arrive late?',limit:3})
    expect(result).toMatchObject({grounded:true,matches:[{articleId:draft.id,version:2,title:'Late arrivals',contentHash:published.contentHash}]})
    const other={tenantId:'tenant-two',locationId:'location-two',userId:'manager-two',role:'manager' as const}
    expect(await service.search(other,{query:'late arrival'})).toEqual({matches:[],grounded:false})
    expect(await store.getAudit(context)).toHaveLength(2)
  })

  it('rejects credentials and restricted internal instructions before persistence',async()=>{
    const service=new SupportKnowledgeService(new MemoryStore(),new AuditService(new MemoryStore()))
    await expect(service.publish(context,'unsafe',{...article,content:'Use this API key sk_live_do_not_store_12345 when a customer asks for help.'})).rejects.toMatchObject<Partial<DomainError>>({code:'KNOWLEDGE_CONTENT_RESTRICTED'})
  })

  it('exposes manager-only versioning and operator read-only search without crossing tenants',async()=>{
    const server=createApp(new MemoryStore());apps.push(server)
    expect((await server.inject({method:'PUT',url:'/v1/support/knowledge/late-arrivals',headers:auth(),payload:article})).statusCode).toBe(403)
    const created=await server.inject({method:'PUT',url:'/v1/support/knowledge/late-arrivals',headers:auth('tenant-one','location-one','manager-one','manager'),payload:article})
    expect(created.statusCode).toBe(200);expect(created.json()).toMatchObject({version:1,status:'published'})
    const own=await server.inject({method:'POST',url:'/v1/support/knowledge/search',headers:auth(),payload:{query:'late arrival policy',limit:3}})
    expect(own.json()).toMatchObject({grounded:true,matches:[{slug:'late-arrivals'}]})
    const other=await server.inject({method:'POST',url:'/v1/support/knowledge/search',headers:auth('tenant-two','location-two'),payload:{query:'late arrival policy',limit:3}})
    expect(other.json()).toEqual({matches:[],grounded:false})
  })

  it('makes published support facts available through the audited read-only model tool',async()=>{
    const store=new MemoryStore();const audit=new AuditService(store);const knowledge=new SupportKnowledgeService(store,audit);await knowledge.publish(context,'late-arrivals',article)
    const gateway:BookingGateway={searchAvailability:async()=>[],validateHold:async()=>({provider:'square',customerId:'unused',serviceVariationVersion:'1',durationMinutes:60}),createBooking:async()=>({provider:'square',id:'unused'}),cancelBooking:async()=>({provider:'square',id:'unused'}),rescheduleBooking:async()=>({provider:'square',id:'unused'})}
    const tool=new BookingToolService(store,new BookingService(store,new EventService(store),audit,gateway),gateway,audit,async()=>{},knowledge)
    const occurredAt=new Date().toISOString();const conversationId=randomUUID();await store.saveConversation({id:conversationId,tenantId:context.tenantId,locationId:context.locationId,clientId:'client-one',participantAddress:'+447700900111',channel:'sms',status:'active',intent:'service_question',requiresHuman:false,unreadCount:1,lastMessageAt:occurredAt,createdAt:occurredAt,updatedAt:occurredAt});const inputMessage=(await store.saveConversationMessage({id:randomUUID(),tenantId:context.tenantId,locationId:context.locationId,conversationId,direction:'inbound',author:'client',body:'What is the late arrival policy?',providerMessageId:'SM-support-tool',deliveryStatus:'received',createdAt:occurredAt})).message
    const result=await tool.execute({...context,role:'service'},{conversationId,inputMessageId:inputMessage.id,agentRunId:randomUUID(),clientId:'client-one',providerCallId:'call-support-one',toolName:'search_support_knowledge',arguments:{query:'late arrival policy',limit:3}})
    expect(result).toMatchObject({ok:true,data:{grounded:true,matches:[{slug:'late-arrivals',version:1}]}})
    expect((await store.getAudit(context)).map(value=>value.action)).toContain('booking_tool.completed')
  })
})
