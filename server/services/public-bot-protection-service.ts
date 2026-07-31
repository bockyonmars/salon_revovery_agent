import { randomUUID } from 'node:crypto'
import { DomainError } from '../domain/errors.js'
import { publicRateLimitReleaseConfig } from './public-rate-limit-service.js'

const SITEVERIFY_URL='https://challenges.cloudflare.com/turnstile/v0/siteverify'
const EXPECTED_ACTION='recovery_review'

export type PublicBotVerifier={verify(token:string,remoteIp:string):Promise<void>}
export type PublicBotProtectionPolicy={enabled:boolean;secretKey?:string;expectedHostnames:string[];timeoutMs:number}

export class PublicBotProtectionService implements PublicBotVerifier{
  constructor(private readonly policy=publicBotProtectionPolicy(),private readonly request:typeof fetch=fetch){}

  async verify(token:string,remoteIp:string){
    if(!this.policy.enabled)return
    if(!token)throw new DomainError('Complete the bot verification and try again.','BOT_VERIFICATION_REQUIRED',400)
    let response:Response
    try{
      response=await this.request(SITEVERIFY_URL,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({secret:this.policy.secretKey,response:token,remoteip:remoteIp,idempotency_key:randomUUID()}),signal:AbortSignal.timeout(this.policy.timeoutMs)})
    }catch{
      throw new DomainError('Bot verification is temporarily unavailable. Please try again.','BOT_VERIFICATION_UNAVAILABLE',503)
    }
    if(!response.ok)throw new DomainError('Bot verification is temporarily unavailable. Please try again.','BOT_VERIFICATION_UNAVAILABLE',503)
    let result:TurnstileResult
    try{result=await response.json() as TurnstileResult}catch{throw new DomainError('Bot verification is temporarily unavailable. Please try again.','BOT_VERIFICATION_UNAVAILABLE',503)}
    const hostname=typeof result.hostname==='string'?result.hostname.toLowerCase():''
    if(result.success!==true||result.action!==EXPECTED_ACTION||!this.policy.expectedHostnames.includes(hostname))throw new DomainError('Bot verification was not accepted. Please retry the challenge.','BOT_VERIFICATION_FAILED',400)
  }
}

export function publicBotProtectionPolicy(environment:NodeJS.ProcessEnv=process.env):PublicBotProtectionPolicy{
  const enabled=environment.NODE_ENV==='production'||environment.PUBLIC_BOT_PROTECTION_ENABLED==='true'
  const secretKey=environment.TURNSTILE_SECRET_KEY?.trim()
  const expectedHostnames=(environment.TURNSTILE_EXPECTED_HOSTNAMES??'').split(',').map(value=>value.trim().toLowerCase()).filter(Boolean)
  const timeoutMs=parseBoundedInteger(environment.TURNSTILE_VERIFY_TIMEOUT_MS,'TURNSTILE_VERIFY_TIMEOUT_MS',5000,500,10_000)
  if(enabled&&!secretKey)throw new Error('TURNSTILE_SECRET_KEY is required when public bot protection is enabled')
  if(enabled&&!expectedHostnames.length)throw new Error('TURNSTILE_EXPECTED_HOSTNAMES is required when public bot protection is enabled')
  return{enabled,...(secretKey?{secretKey}:{}),expectedHostnames,timeoutMs}
}

export function publicBotProtectionReleaseConfig(environment:NodeJS.ProcessEnv=process.env){
  const policy=publicBotProtectionPolicy({...environment,NODE_ENV:'production'})
  if(!environment.VITE_TURNSTILE_SITE_KEY?.trim())throw new Error('VITE_TURNSTILE_SITE_KEY is required for a production release')
  return{hostnameCount:policy.expectedHostnames.length,timeoutMs:policy.timeoutMs,publicRateLimit:publicRateLimitReleaseConfig(environment)}
}

type TurnstileResult={success?:boolean;hostname?:string;action?:string;'error-codes'?:unknown}

function parseBoundedInteger(value:string|undefined,name:string,fallback:number,min:number,max:number){const parsed=value===undefined?fallback:Number(value);if(!Number.isInteger(parsed)||parsed<min||parsed>max)throw new Error(`${name} must be an integer from ${min} to ${max}`);return parsed}
