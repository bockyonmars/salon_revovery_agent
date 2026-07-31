import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MemoryStore } from './repositories/memory-store.js'
import { AuditService } from './services/audit-service.js'
import { ConsentService } from './services/consent-service.js'
import { ConversationService } from './services/conversation-service.js'
import { EventService } from './services/event-service.js'
import { actualPromptDigest, conversationRouterPromptManifest, createConversationRouterPrompt, promptMatchesManifest } from './prompts/conversation-router.js'

const context={tenantId:'tenant-one',locationId:'location-one',userId:'service-one',role:'service' as const}
let previousNodeEnv:string|undefined
let previousModel:string|undefined

beforeEach(()=>{
  previousNodeEnv=process.env.NODE_ENV
  previousModel=process.env.MODEL_CONCIERGE
  process.env.NODE_ENV='production'
  process.env.MODEL_CONCIERGE='gpt-5.6-terra'
})

afterEach(()=>{
  previousNodeEnv===undefined?delete process.env.NODE_ENV:process.env.NODE_ENV=previousNodeEnv
  previousModel===undefined?delete process.env.MODEL_CONCIERGE:process.env.MODEL_CONCIERGE=previousModel
})

function service(store:MemoryStore){
  const audit=new AuditService(store)
  return new ConversationService(store,new EventService(store),audit,new ConsentService(store,audit))
}

async function inbound(conversations:ConversationService){
  return conversations.intake(context,{clientId:'client-one',participantAddress:'+447700900123',channel:'sms',body:'Can I book a haircut next week?',providerMessageId:`SM-${crypto.randomUUID()}`})
}

describe('conversation prompt release provenance',()=>{
  it('produces a stable SHA-256 manifest bound to the prompt, schema, release, and model',()=>{
    const first=conversationRouterPromptManifest('gpt-5.6-terra')
    const repeated=conversationRouterPromptManifest('gpt-5.6-terra')
    const otherModel=conversationRouterPromptManifest('gpt-5.6-sol')
    expect(first.contentDigest).toMatch(/^[a-f0-9]{64}$/)
    expect(repeated.contentDigest).toBe(first.contentDigest)
    expect(otherModel.contentDigest).not.toBe(first.contentDigest)
    expect(promptMatchesManifest(createConversationRouterPrompt(first.model),first.model)).toBe(true)
  })

  it('refuses production routing when no evaluated prompt is active',async()=>{
    const store=new MemoryStore()
    const conversations=service(store)
    const input=await inbound(conversations)
    await expect(conversations.run(context,input.conversation.id,input.message.id)).rejects.toMatchObject({code:'PROMPT_RELEASE_REQUIRED',statusCode:503})
    expect(await store.listAgentRuns(context,input.conversation.id)).toEqual([])
  })

  it('refuses production routing when the active prompt content drifts from the code release',async()=>{
    const store=new MemoryStore()
    const released=createConversationRouterPrompt('gpt-5.6-terra',{approvalReference:'release-review-42'})
    await store.savePromptVersion({...released,instructions:`${released.instructions}\nUnreviewed change.`,contentDigest:actualPromptDigest(released)})
    const conversations=service(store)
    const input=await inbound(conversations)
    await expect(conversations.run(context,input.conversation.id,input.message.id)).rejects.toMatchObject({code:'PROMPT_RELEASE_MISMATCH',statusCode:503})
  })

  it('routes only after the exact code-managed prompt is active',async()=>{
    const store=new MemoryStore()
    const released=createConversationRouterPrompt('gpt-5.6-terra',{approvalReference:'release-review-42'})
    await store.savePromptVersion(released)
    const conversations=service(store)
    const input=await inbound(conversations)
    const result=await conversations.run(context,input.conversation.id,input.message.id)
    expect(result.run).toMatchObject({promptVersionId:released.id,status:'skipped',errorCode:'MODEL_NOT_CONFIGURED'})
  })
})
