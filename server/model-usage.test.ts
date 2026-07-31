import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { createApp } from './app.js'
import type { Conversation, ConversationMessage, ConversationRoute, TenantContext } from './domain/schemas.js'
import { MemoryStore } from './repositories/memory-store.js'
import { ModelUsageService } from './services/model-usage-service.js'
import { OpenAIBookingAgent } from './services/openai-booking-agent.js'

const owner:TenantContext={tenantId:'tenant-one',locationId:'location-one',userId:'owner-one',role:'owner'}
const now='2026-07-19T12:00:00.000Z'

describe('provider model usage accounting',()=>{
  it('persists exact provider usage idempotently without prompt or output content',async()=>{
    const store=new MemoryStore();const usage=new ModelUsageService(store,undefined,()=>new Date(now));const response=providerResponse('resp_exact_1')
    const first=await usage.record(owner,'11111111-1111-4111-8111-111111111111','conversation_route',response);const repeated=await usage.record(owner,'22222222-2222-4222-8222-222222222222','conversation_route',response)
    expect(first.duplicate).toBe(false);expect(repeated.duplicate).toBe(true);expect(first.record).toMatchObject({provider:'openai',providerResponseId:'resp_exact_1',agentRunId:'11111111-1111-4111-8111-111111111111',model:'gpt-test-snapshot',usageStatus:'reported',inputTokens:100,cachedInputTokens:20,outputTokens:50,reasoningTokens:10,totalTokens:150,occurredAt:'2026-07-18T12:00:00.000Z'});const serialized=JSON.stringify(first.record);expect(serialized).not.toContain('private prompt');expect(serialized).not.toContain('private answer')
  })

  it('records missing evidence instead of inventing malformed token counts',async()=>{
    const store=new MemoryStore();const usage=new ModelUsageService(store,undefined,()=>new Date(now));const response={...providerResponse('resp_bad_usage'),usage:{...providerResponse('unused').usage,total_tokens:999}}
    await usage.record(owner,randomUUID(),'booking_specialist',response);expect(await store.listModelUsageRecords(owner)).toEqual([expect.objectContaining({usageStatus:'missing',providerResponseId:'resp_bad_usage'})]);expect((await store.listModelUsageRecords(owner))[0]).not.toHaveProperty('inputTokens')
  })

  it('captures every booking-specialist Responses API step through the recorder',async()=>{
    const store=new MemoryStore();const usage=new ModelUsageService(store);const create=vi.fn().mockResolvedValue({...providerResponse('resp_booking_1'),output:[],output_text:'Would you like the first or second appointment?'});const specialist=new OpenAIBookingAgent('test-key',{execute:vi.fn()},'gpt-test-snapshot',{responses:{create}} as never,undefined,usage);const conversation:Conversation={id:randomUUID(),tenantId:owner.tenantId,locationId:owner.locationId,clientId:'client-one',participantAddress:'+447700900111',channel:'sms',status:'active',intent:'booking',requiresHuman:false,unreadCount:1,lastMessageAt:now,createdAt:now,updatedAt:now};const message:ConversationMessage={id:randomUUID(),tenantId:owner.tenantId,locationId:owner.locationId,conversationId:conversation.id,direction:'inbound',author:'client',body:'Can I book?',deliveryStatus:'received',createdAt:now};const route:ConversationRoute={intent:'booking',confidence:.98,urgency:'normal',requiresHuman:false,shortReason:'Booking requested.'}
    await expect(specialist.respond({context:owner,conversation,message,history:[message],route,agentRunId:'33333333-3333-4333-8333-333333333333'})).resolves.toBe('Would you like the first or second appointment?');expect(await store.listModelUsageRecords(owner)).toEqual([expect.objectContaining({operation:'booking_specialist',agentRunId:'33333333-3333-4333-8333-333333333333'})])
  })

  it('creates append-only owner-attested price versions and exposes owner-only APIs',async()=>{
    const store=new MemoryStore();const usage=new ModelUsageService(store,undefined,()=>new Date(now));const price=priceInput('2026-07-01T00:00:00.000Z');const first=await usage.createPrice(owner,price);expect(first).toMatchObject({version:1,evidence:'owner_attested',currency:'GBP'});await expect(usage.createPrice(owner,price)).rejects.toMatchObject({code:'MODEL_PRICE_VERSION_CONFLICT'});const second=await usage.createPrice(owner,priceInput('2026-08-01T00:00:00.000Z'));expect(second.version).toBe(2);await expect(usage.listPrices({...owner,role:'manager'})).rejects.toMatchObject({code:'ROLE_FORBIDDEN'})
    const server=createApp(store);try{const manager=await server.inject({method:'POST',url:'/v1/operations/model-prices',headers:{authorization:'Bearer dev:tenant-one:location-one:manager-one:manager'},payload:priceInput('2026-09-01T00:00:00.000Z')});expect(manager.statusCode).toBe(403);const created=await server.inject({method:'POST',url:'/v1/operations/model-prices',headers:{authorization:'Bearer dev:tenant-one:location-one:owner-one:owner'},payload:priceInput('2026-09-01T00:00:00.000Z')});expect(created.statusCode).toBe(201);expect(created.headers['cache-control']).toBe('no-store');expect(created.json()).toMatchObject({version:3,evidence:'owner_attested'});const listed=await server.inject({method:'GET',url:'/v1/operations/model-prices',headers:{authorization:'Bearer dev:tenant-one:location-one:owner-one:owner'}});expect(listed.statusCode).toBe(200);expect(listed.headers['cache-control']).toBe('no-store');expect(listed.json().prices).toHaveLength(3);const audits=(await store.getAudit(owner)).filter(value=>value.action==='model_price.created');expect(audits).toHaveLength(3);expect(audits).toEqual(expect.arrayContaining([expect.objectContaining({result:expect.objectContaining({version:1})}),expect.objectContaining({result:expect.objectContaining({version:2})}),expect.objectContaining({result:expect.objectContaining({version:3})})]))}finally{await server.close()}
  })
})

function providerResponse(id:string){return{id,model:'gpt-test-snapshot',created_at:1_784_375_999,completed_at:1_784_376_000,input:'private prompt',output_text:'private answer',usage:{input_tokens:100,input_tokens_details:{cached_tokens:20},output_tokens:50,output_tokens_details:{reasoning_tokens:10},total_tokens:150}}}
function priceInput(effectiveFrom:string){return{provider:'openai' as const,model:'gpt-test-snapshot',currency:'GBP',inputPerMillionMinor:200,cachedInputPerMillionMinor:50,outputPerMillionMinor:1000,effectiveFrom,sourceLabel:'Provider pricing page reviewed by owner',sourceUrl:'https://example.com/provider-pricing'}}
