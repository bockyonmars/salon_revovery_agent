import { describe, expect, it, vi } from 'vitest'
import { PublicBotProtectionService, publicBotProtectionPolicy, publicBotProtectionReleaseConfig } from './services/public-bot-protection-service.js'

const policy={enabled:true,secretKey:'turnstile-test-secret',expectedHostnames:['salon.example'],timeoutMs:1000}

describe('public Turnstile bot protection',()=>{
  it('cannot be disabled in production and requires complete server-side scope configuration',()=>{
    expect(()=>publicBotProtectionPolicy({NODE_ENV:'production',PUBLIC_BOT_PROTECTION_ENABLED:'false'})).toThrow('TURNSTILE_SECRET_KEY')
    expect(()=>publicBotProtectionPolicy({NODE_ENV:'production',TURNSTILE_SECRET_KEY:'configured'})).toThrow('TURNSTILE_EXPECTED_HOSTNAMES')
    expect(publicBotProtectionPolicy({NODE_ENV:'production',PUBLIC_BOT_PROTECTION_ENABLED:'false',TURNSTILE_SECRET_KEY:'configured',TURNSTILE_EXPECTED_HOSTNAMES:'Salon.Example, www.salon.example'})).toMatchObject({enabled:true,expectedHostnames:['salon.example','www.salon.example'],timeoutMs:5000})
    expect(publicBotProtectionPolicy({NODE_ENV:'test'}).enabled).toBe(false)
    expect(()=>publicBotProtectionReleaseConfig({TURNSTILE_SECRET_KEY:'configured',TURNSTILE_EXPECTED_HOSTNAMES:'salon.example'})).toThrow('VITE_TURNSTILE_SITE_KEY')
    expect(()=>publicBotProtectionReleaseConfig({TURNSTILE_SECRET_KEY:'configured',TURNSTILE_EXPECTED_HOSTNAMES:'salon.example',VITE_TURNSTILE_SITE_KEY:'public-site-key'})).toThrow('PUBLIC_RATE_LIMIT_HASH_KEY')
    expect(publicBotProtectionReleaseConfig({TURNSTILE_SECRET_KEY:'configured',TURNSTILE_EXPECTED_HOSTNAMES:'salon.example',VITE_TURNSTILE_SITE_KEY:'public-site-key',PUBLIC_RATE_LIMIT_HASH_KEY:'0123456789abcdef0123456789abcdef'})).toEqual({hostnameCount:1,timeoutMs:5000,publicRateLimit:{requests:8,windowSeconds:3600,identityProtection:'hmac-sha256'}})
  })

  it('redeems a token once with remote address and validates action and hostname',async()=>{
    const request=vi.fn(async()=>new Response(JSON.stringify({success:true,hostname:'SALON.EXAMPLE',action:'recovery_review'}),{status:200,headers:{'content-type':'application/json'}}));const service=new PublicBotProtectionService(policy,request);await service.verify('single-use-token','203.0.113.10');expect(request).toHaveBeenCalledOnce();const[url,init]=request.mock.calls[0]!;expect(url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');const body=JSON.parse(String(init?.body));expect(body).toMatchObject({secret:'turnstile-test-secret',response:'single-use-token',remoteip:'203.0.113.10',idempotency_key:expect.any(String)})
  })

  it('rejects missing, failed, wrong-action, and wrong-host evidence without exposing provider detail',async()=>{
    await expect(new PublicBotProtectionService(policy).verify('','203.0.113.10')).rejects.toMatchObject({code:'BOT_VERIFICATION_REQUIRED',statusCode:400})
    for(const result of[{success:false,'error-codes':['invalid-input-response']},{success:true,hostname:'salon.example',action:'login'},{success:true,hostname:'attacker.example',action:'recovery_review'}]){const service=new PublicBotProtectionService(policy,async()=>new Response(JSON.stringify(result),{status:200}));await expect(service.verify('token','203.0.113.10')).rejects.toMatchObject({code:'BOT_VERIFICATION_FAILED',statusCode:400})}
  })

  it('fails closed with a retryable response when Siteverify is unavailable or malformed',async()=>{
    for(const request of[async()=>{throw new Error('provider secret detail')},async()=>new Response('unavailable',{status:503}),async()=>new Response('not-json',{status:200})]){const service=new PublicBotProtectionService(policy,request);await expect(service.verify('token','203.0.113.10')).rejects.toMatchObject({code:'BOT_VERIFICATION_UNAVAILABLE',statusCode:503})}
  })
})
