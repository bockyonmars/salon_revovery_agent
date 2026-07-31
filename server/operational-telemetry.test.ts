import { afterEach, describe, expect, it } from 'vitest'
import { createApp } from './app.js'
import { createWebhookApp } from './webhook-app.js'
import { MemoryStore } from './repositories/memory-store.js'
import { OperationalTelemetry, type OperationalLogRecord } from './operational-telemetry.js'

const applications:Array<{close():Promise<unknown>}>=[]
afterEach(async()=>{await Promise.all(applications.splice(0).map(value=>value.close()))})

describe('PII-safe operational telemetry',()=>{
  it('echoes a validated correlation ID and logs only the route template, method, status, and duration',async()=>{
    const records:OperationalLogRecord[]=[];const app=createApp(new MemoryStore(),{telemetrySink:record=>records.push(record)});applications.push(app)
    const response=await app.inject({method:'GET',url:'/health?email=private.person@example.com&phone=%2B447700900999',headers:{'x-request-id':'request-safe-0001','authorization':'Bearer secret-dashboard-token'}})
    expect(response.statusCode).toBe(200);expect(response.headers['x-request-id']).toBe('request-safe-0001')
    expect(records).toEqual([expect.objectContaining({event:'http.request.completed',service:'salon-recovery-api',requestId:'request-safe-0001',method:'GET',route:'/health',statusCode:200,durationMs:expect.any(Number)})])
    expect(JSON.stringify(records)).not.toMatch(/private\.person|447700900999|secret-dashboard-token|authorization|email|phone/i)
  })

  it('rejects hostile request IDs and never logs unmatched customer-bearing paths',async()=>{
    const records:OperationalLogRecord[]=[];const app=createApp(new MemoryStore(),{telemetrySink:record=>records.push(record)});applications.push(app)
    const response=await app.inject({method:'GET',url:'/private.person@example.com/%2B447700900999',headers:{'x-request-id':'bad id\n{"secret":"value"}'}})
    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/)
    expect(records[0]).toMatchObject({route:'unmatched',statusCode:404})
    expect(JSON.stringify(records)).not.toMatch(/private\.person|447700900999|bad id|secret|value/)
  })

  it('records webhook failure status without headers, destinations, bodies, or provider errors',async()=>{
    const records:OperationalLogRecord[]=[];const app=createWebhookApp(new MemoryStore(),{telemetrySink:record=>records.push(record)});applications.push(app)
    const response=await app.inject({method:'POST',url:'/webhooks/twilio/inbound',headers:{'content-type':'application/x-www-form-urlencoded','x-twilio-signature':'private-signature','x-request-id':'webhook-request-001'},payload:'From=%2B447700900111&To=%2B447700900222&Body=Private+message'})
    expect(response.statusCode).toBe(503)
    expect(records).toEqual([expect.objectContaining({service:'salon-recovery-webhook-ingester',requestId:'webhook-request-001',route:'/webhooks/twilio/inbound',statusCode:503,level:'error'})])
    expect(JSON.stringify(records)).not.toMatch(/private-signature|447700900|Private message|From|To|Body/)
  })

  it('reduces arbitrary exceptions to a bounded error code',()=>{
    const records:OperationalLogRecord[]=[];const telemetry=new OperationalTelemetry('salon-recovery-workflow-worker',record=>records.push(record),true);telemetry.error('workflow.tick_failed',new Error('postgres://user:password@database.internal/customer'))
    expect(records).toEqual([expect.objectContaining({event:'workflow.tick_failed',level:'error',errorCode:'Error'})])
    expect(JSON.stringify(records)).not.toMatch(/postgres|password|database\.internal|customer/)
  })
})
