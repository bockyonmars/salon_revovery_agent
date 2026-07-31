import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp } from './app.js'
import { MemoryStore } from './repositories/memory-store.js'
import { DomainError } from './domain/errors.js'

const apps:ReturnType<typeof createApp>[]=[]
const payload=(overrides:Record<string,unknown>={})=>({
  submissionKey:randomUUID(),contactName:'Alex Morgan',businessEmail:'OWNER@PLUMHOUSE.EXAMPLE',salonName:'Plum House',locations:'two_to_five',bookingPlatform:'square',
  monthlyAppointments:850,averageTicketMinor:9500,primaryRevenueLoss:'unanswered_enquiries',channels:['whatsapp','email'],marketingConsent:false,
  privacyNoticeVersion:'recovery-review-v1',calculator:{monthlyEnquiries:520,unansweredPercentage:22,bookingConversionPercentage:48,averageTicketMinor:9500,lateCancellationPercentage:8},
  sourcePath:'/for/london',locationSlug:'london',website:'',...overrides,
})

afterEach(async()=>{vi.unstubAllEnvs();await Promise.all(apps.splice(0).map(app=>app.close()))})

describe('public recovery review acquisition',()=>{
  it('accepts a direct request without authentication and recomputes the estimate server-side',async()=>{
    const store=new MemoryStore();const app=createApp(store);apps.push(app)
    const response=await app.inject({method:'POST',url:'/public/recovery-reviews',payload:payload()})
    expect(response.statusCode).toBe(201)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.json()).toMatchObject({accepted:true,duplicate:false,estimatedRecoveryMinor:390869,currency:'GBP'})
    const review=await store.getPublicRecoveryReview(response.json().referenceId)
    expect(review).toMatchObject({businessEmail:'owner@plumhouse.example',marketingConsent:false,estimatedRecoveryMinor:390869,status:'new',sourcePath:'/for/london'})
    expect(review?.marketingConsentCapturedAt).toBeUndefined()
    expect(Date.parse(review!.retentionExpiresAt)).toBeGreaterThan(Date.parse(review!.createdAt))
  })

  it('records explicit marketing permission separately and makes retries idempotent',async()=>{
    const store=new MemoryStore();const app=createApp(store);apps.push(app);const input=payload({marketingConsent:true})
    const first=await app.inject({method:'POST',url:'/public/recovery-reviews',payload:input})
    const second=await app.inject({method:'POST',url:'/public/recovery-reviews',payload:{...input,salonName:'Changed on retry'}})
    expect(first.statusCode).toBe(201);expect(second.statusCode).toBe(200)
    expect(second.json()).toMatchObject({accepted:true,duplicate:true,referenceId:first.json().referenceId})
    const review=await store.getPublicRecoveryReview(first.json().referenceId)
    expect(review).toMatchObject({salonName:'Plum House',marketingConsent:true,marketingConsentCapturedAt:expect.any(String),privacyNoticeVersion:'recovery-review-v1'})
  })

  it('fails closed on malformed qualification data and quietly absorbs honeypot submissions',async()=>{
    const store=new MemoryStore();const app=createApp(store);apps.push(app)
    const invalid=await app.inject({method:'POST',url:'/public/recovery-reviews',payload:payload({businessEmail:'not-an-email',channels:[]})})
    expect(invalid.statusCode).toBe(400);expect(invalid.json().error).toBe('VALIDATION_ERROR')
    const trap=await app.inject({method:'POST',url:'/public/recovery-reviews',payload:payload({website:'https://spam.example'})})
    expect(trap.statusCode).toBe(202);expect(trap.json()).toEqual({accepted:true,referenceId:'received',duplicate:false})
    expect(await store.getPublicRecoveryReview(trap.json().referenceId)).toBeUndefined()
  })

  it('bounds repeated public submissions by source address',async()=>{
    vi.stubEnv('PUBLIC_REVIEW_RATE_LIMIT_REQUESTS','2');vi.stubEnv('PUBLIC_REVIEW_RATE_LIMIT_WINDOW_SECONDS','60')
    const app=createApp(new MemoryStore());apps.push(app)
    expect((await app.inject({method:'POST',url:'/public/recovery-reviews',payload:payload()})).statusCode).toBe(201)
    expect((await app.inject({method:'POST',url:'/public/recovery-reviews',payload:payload()})).statusCode).toBe(201)
    const blocked=await app.inject({method:'POST',url:'/public/recovery-reviews',payload:payload()})
    expect(blocked.statusCode).toBe(429);expect(blocked.headers['retry-after']).toBeDefined();expect(blocked.json().error).toBe('RATE_LIMIT_EXCEEDED')
  })

  it('shares the public request budget across API replicas without storing the source address',async()=>{
    vi.stubEnv('PUBLIC_REVIEW_RATE_LIMIT_REQUESTS','2');vi.stubEnv('PUBLIC_REVIEW_RATE_LIMIT_WINDOW_SECONDS','60');vi.stubEnv('PUBLIC_RATE_LIMIT_HASH_KEY','0123456789abcdef0123456789abcdef')
    const store=new MemoryStore();const first=createApp(store);const second=createApp(store);apps.push(first,second)
    expect((await first.inject({method:'POST',url:'/public/recovery-reviews',payload:payload()})).statusCode).toBe(201)
    expect((await second.inject({method:'POST',url:'/public/recovery-reviews',payload:payload()})).statusCode).toBe(201)
    const blocked=await first.inject({method:'POST',url:'/public/recovery-reviews',payload:payload()})
    expect(blocked.statusCode).toBe(429)
    expect(JSON.stringify(store)).not.toContain('127.0.0.1')
  })

  it('uses the client address supplied by the single trusted load-balancer hop',async()=>{
    vi.stubEnv('PUBLIC_REVIEW_RATE_LIMIT_REQUESTS','1');vi.stubEnv('PUBLIC_REVIEW_RATE_LIMIT_WINDOW_SECONDS','60');vi.stubEnv('PUBLIC_RATE_LIMIT_HASH_KEY','0123456789abcdef0123456789abcdef')
    const app=createApp(new MemoryStore(),{trustedProxyHops:1});apps.push(app)
    expect((await app.inject({method:'POST',url:'/public/recovery-reviews',headers:{'x-forwarded-for':'203.0.113.10'},payload:payload()})).statusCode).toBe(201)
    expect((await app.inject({method:'POST',url:'/public/recovery-reviews',headers:{'x-forwarded-for':'203.0.113.11'},payload:payload()})).statusCode).toBe(201)
    expect((await app.inject({method:'POST',url:'/public/recovery-reviews',headers:{'x-forwarded-for':'203.0.113.10'},payload:payload()})).statusCode).toBe(429)
  })

  it('requires server-accepted bot evidence without persisting the challenge token',async()=>{
    const store=new MemoryStore();const verify=vi.fn(async()=>{});const app=createApp(store,{publicBotVerifier:{verify}});apps.push(app);const response=await app.inject({method:'POST',url:'/public/recovery-reviews',payload:payload({botToken:'single-use-turnstile-token'})});expect(response.statusCode).toBe(201);expect(verify).toHaveBeenCalledWith('single-use-turnstile-token','127.0.0.1');const review=await store.getPublicRecoveryReview(response.json().referenceId);expect(JSON.stringify(review)).not.toContain('single-use-turnstile-token')
  })

  it('fails closed before persistence but quietly absorbs honeypots without spending a challenge',async()=>{
    const store=new MemoryStore();const verify=vi.fn(async()=>{throw new DomainError('Bot verification was not accepted.','BOT_VERIFICATION_FAILED',400)});const app=createApp(store,{publicBotVerifier:{verify}});apps.push(app);const blocked=await app.inject({method:'POST',url:'/public/recovery-reviews',payload:payload({botToken:'invalid-token'})});expect(blocked.statusCode).toBe(400);expect(blocked.json()).toMatchObject({error:'BOT_VERIFICATION_FAILED'});expect(await store.getPublicRecoveryReview(blocked.json().referenceId)).toBeUndefined();const trap=await app.inject({method:'POST',url:'/public/recovery-reviews',payload:payload({website:'bot-filled',botToken:''})});expect(trap.statusCode).toBe(202);expect(verify).toHaveBeenCalledOnce()
  })
})
