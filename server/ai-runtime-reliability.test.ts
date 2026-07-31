import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import type { TenantContext, WorkflowJob } from './domain/schemas.js'
import { MemoryStore } from './repositories/memory-store.js'
import { openAIRuntimePolicy } from './services/openai-runtime-policy.js'
import { PermanentWorkflowError, WorkflowEngine, workflowFailureDetail } from './services/workflow-engine.js'

const context:TenantContext={tenantId:'tenant-one',locationId:'location-one',userId:'service-one',role:'service'}

describe('AI runtime reliability boundary',()=>{
  it('uses a bounded deadline and delegates retries to durable workflows',()=>{
    expect(openAIRuntimePolicy({})).toEqual({timeout:20_000,maxRetries:0})
    expect(openAIRuntimePolicy({OPENAI_TIMEOUT_MS:'12500'})).toEqual({timeout:12_500,maxRetries:0})
    for(const value of['999','60001','1.5','invalid'])expect(()=>openAIRuntimePolicy({OPENAI_TIMEOUT_MS:value})).toThrow('OPENAI_TIMEOUT_MS')
  })

  it('wires the same policy into both production Responses API clients',async()=>{
    const[router,booking]=await Promise.all([
      readFile(new URL('./services/openai-conversation-agent.ts',import.meta.url),'utf8'),
      readFile(new URL('./services/openai-booking-agent.ts',import.meta.url),'utf8'),
    ])
    for(const source of[router,booking])expect(source).toContain('new OpenAI({apiKey,...openAIRuntimePolicy()})')
  })

  it('never persists raw unknown exception text in jobs or approvals',async()=>{
    const raw='Timeout sending to client@example.com at +44 7700 900999: provider body secret'
    expect(workflowFailureDetail(Object.assign(new Error(raw),{code:'ETIMEDOUT/socket'}))).toBe('Workflow dependency failed (ETIMEDOUT_SOCKET)')
    expect(workflowFailureDetail(new Error(raw))).toBe('Workflow dependency failed (UNKNOWN)')
    expect(workflowFailureDetail(new PermanentWorkflowError('Authoritative location settings are missing'))).toBe('Authoritative location settings are missing')

    const store=new MemoryStore();const job=workflow();await store.enqueueWorkflowJob(job)
    await new WorkflowEngine(store,{execute:async()=>{throw new Error(raw)}},'safe-failure-worker').tick()
    const [failed]=await store.listWorkflowJobs(context);const [approval]=await store.listApprovalRequests(context)
    expect(failed).toMatchObject({status:'failed',lastError:'Workflow dependency failed (UNKNOWN)'})
    expect(approval).toMatchObject({requestType:'workflow_failure',reason:'Workflow dependency failed (UNKNOWN)'})
    expect(JSON.stringify({failed,approval})).not.toMatch(/client@example|7700 900999|provider body secret/)
  })
})

function workflow():WorkflowJob{const now=new Date().toISOString();return{id:randomUUID(),tenantId:context.tenantId,locationId:context.locationId,workflowType:'appointment_confirmation',correlationId:randomUUID(),causationEventId:randomUUID(),dedupeKey:randomUUID(),runAt:now,status:'pending',attempts:0,maxAttempts:1,payload:{},createdAt:now,updatedAt:now}}
