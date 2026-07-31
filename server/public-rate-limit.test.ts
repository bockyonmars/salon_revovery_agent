import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { MemoryStore } from './repositories/memory-store.js'
import { PublicRateLimitService, publicRateLimitPolicy } from './services/public-rate-limit-service.js'
import { trustedProxyPolicy } from './app.js'

describe('distributed public rate limits',()=>{
  it('requires a production HMAC key and rejects weak or unsafe bounds',()=>{
    expect(()=>publicRateLimitPolicy({NODE_ENV:'production'})).toThrow('PUBLIC_RATE_LIMIT_HASH_KEY')
    expect(()=>publicRateLimitPolicy({PUBLIC_RATE_LIMIT_HASH_KEY:'short'})).toThrow('at least 32 bytes')
    expect(()=>publicRateLimitPolicy({PUBLIC_REVIEW_RATE_LIMIT_REQUESTS:'0'})).toThrow('PUBLIC_REVIEW_RATE_LIMIT_REQUESTS')
    expect(()=>publicRateLimitPolicy({PUBLIC_REVIEW_RATE_LIMIT_WINDOW_SECONDS:'59'})).toThrow('PUBLIC_REVIEW_RATE_LIMIT_WINDOW_SECONDS')
    expect(()=>trustedProxyPolicy(0)).toThrow('PUBLIC_TRUST_PROXY_HOPS');expect(trustedProxyPolicy(1)).toBe(1)
  })

  it('uses deterministic HMAC identities and resets only at fixed window boundaries',async()=>{
    const store=new MemoryStore();const policy={requests:2,windowSeconds:60,hashKey:'0123456789abcdef0123456789abcdef'};const first=new PublicRateLimitService(store,policy);const second=new PublicRateLimitService(store,policy)
    const at=new Date('2026-07-20T12:00:30.000Z');const one=await first.consume('recovery_review','203.0.113.10',at);const two=await second.consume('recovery_review','203.0.113.10',at);const blocked=await first.consume('recovery_review','203.0.113.10',at)
    expect(one).toMatchObject({allowed:true,requestCount:1,remaining:1});expect(two).toMatchObject({allowed:true,requestCount:2,remaining:0});expect(blocked).toMatchObject({allowed:false,requestCount:3,remaining:0})
    expect(one.identityHash).toMatch(/^[a-f0-9]{64}$/);expect(one.identityHash).not.toContain('203.0.113.10')
    expect(await second.consume('recovery_review','203.0.113.10',new Date('2026-07-20T12:01:00.000Z'))).toMatchObject({allowed:true,requestCount:1})
  })

  it('keeps the PostgreSQL increment atomic and the schema free of raw network identities',async()=>{
    const[repository,migration,app]=await Promise.all([readFile(new URL('./repositories/postgres-store.ts',import.meta.url),'utf8'),readFile(new URL('./db/migrations/044_public_rate_limits.sql',import.meta.url),'utf8'),readFile(new URL('./app.ts',import.meta.url),'utf8')])
    expect(repository).toContain('ON CONFLICT (route_key,identity_hash,window_start) DO UPDATE SET request_count=public_rate_limit_buckets.request_count+1')
    expect(repository).toContain("DELETE FROM public_rate_limit_buckets WHERE updated_at<$6::timestamptz-interval '2 days'")
    expect(migration).toContain("identity_hash text NOT NULL CHECK (identity_hash ~ '^[a-f0-9]{64}$')")
    expect(migration).not.toMatch(/\b(?:ip|address|user_agent|header)\b/i)
    expect(app).not.toContain('publicReviewAttempts')
  })
})
