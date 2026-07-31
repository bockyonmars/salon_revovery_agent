import { createHmac } from 'node:crypto'
import type { PublicRateLimitRoute } from '../domain/schemas.js'
import type { Store } from '../repositories/store.js'

export type PublicRateLimitPolicy={requests:number;windowSeconds:number;hashKey:string}

export class PublicRateLimitService{
  constructor(private readonly store:Store,readonly policy=publicRateLimitPolicy()){}

  async consume(route:PublicRateLimitRoute,sourceAddress:string,now=new Date()){
    const windowMs=this.policy.windowSeconds*1000;const startMs=Math.floor(now.getTime()/windowMs)*windowMs
    const identityHash=createHmac('sha256',this.policy.hashKey).update(`public-rate-limit-v1:${route}:${sourceAddress.trim()}`).digest('hex')
    return this.store.consumePublicRateLimit({route,identityHash,windowStart:new Date(startMs).toISOString(),windowEnd:new Date(startMs+windowMs).toISOString(),requestCount:1,maxRequests:this.policy.requests,updatedAt:now.toISOString()})
  }
}

export function publicRateLimitPolicy(environment:NodeJS.ProcessEnv=process.env):PublicRateLimitPolicy{
  const requests=integer('PUBLIC_REVIEW_RATE_LIMIT_REQUESTS',environment.PUBLIC_REVIEW_RATE_LIMIT_REQUESTS,8,1,100)
  const windowSeconds=integer('PUBLIC_REVIEW_RATE_LIMIT_WINDOW_SECONDS',environment.PUBLIC_REVIEW_RATE_LIMIT_WINDOW_SECONDS,3_600,60,86_400)
  const configured=environment.PUBLIC_RATE_LIMIT_HASH_KEY?.trim();const hashKey=configured||'development-only-public-rate-limit-key'
  if(environment.NODE_ENV==='production'&&!configured)throw new Error('PUBLIC_RATE_LIMIT_HASH_KEY is required in production')
  if(configured&&Buffer.byteLength(configured,'utf8')<32)throw new Error('PUBLIC_RATE_LIMIT_HASH_KEY must contain at least 32 bytes')
  return{requests,windowSeconds,hashKey}
}

export function publicRateLimitReleaseConfig(environment:NodeJS.ProcessEnv=process.env){const policy=publicRateLimitPolicy({...environment,NODE_ENV:'production'});return{requests:policy.requests,windowSeconds:policy.windowSeconds,identityProtection:'hmac-sha256' as const}}

function integer(name:string,value:string|undefined,fallback:number,min:number,max:number){const parsed=value===undefined?fallback:Number(value);if(!Number.isInteger(parsed)||parsed<min||parsed>max)throw new Error(`${name} must be an integer from ${min} to ${max}`);return parsed}
