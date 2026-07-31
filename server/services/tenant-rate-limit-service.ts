import type { TenantContext, TenantRateLimitKind } from '../domain/schemas.js'
import type { Store } from '../repositories/store.js'

export type TenantRateLimitPolicy={enabled:boolean;readLimit:number;writeLimit:number;windowSeconds:number}

export class TenantRateLimitService{
  constructor(private readonly store:Store,readonly policy:TenantRateLimitPolicy){}

  async consume(context:TenantContext,kind:TenantRateLimitKind,now=new Date()){
    const windowMs=this.policy.windowSeconds*1000;const startMs=Math.floor(now.getTime()/windowMs)*windowMs;const windowStart=new Date(startMs).toISOString();const windowEnd=new Date(startMs+windowMs).toISOString();const maxRequests=kind==='read'?this.policy.readLimit:this.policy.writeLimit
    return this.store.consumeTenantRateLimit({tenantId:context.tenantId,locationId:context.locationId,kind,windowStart,windowEnd,requestCount:1,maxRequests,updatedAt:now.toISOString()})
  }
}

export function tenantRateLimitPolicy(override?:Partial<TenantRateLimitPolicy>):TenantRateLimitPolicy{
  const production=process.env.NODE_ENV==='production';const enabled=production||(override?.enabled??process.env.API_RATE_LIMIT_ENABLED==='true')
  return{enabled,readLimit:integer('API_RATE_LIMIT_READ_REQUESTS',override?.readLimit??process.env.API_RATE_LIMIT_READ_REQUESTS,240,1,100_000),writeLimit:integer('API_RATE_LIMIT_WRITE_REQUESTS',override?.writeLimit??process.env.API_RATE_LIMIT_WRITE_REQUESTS,60,1,100_000),windowSeconds:integer('API_RATE_LIMIT_WINDOW_SECONDS',override?.windowSeconds??process.env.API_RATE_LIMIT_WINDOW_SECONDS,60,1,3_600)}
}

function integer(name:string,value:number|string|undefined,fallback:number,min:number,max:number){const parsed=value===undefined?fallback:Number(value);if(!Number.isInteger(parsed)||parsed<min||parsed>max)throw new Error(`${name} must be an integer from ${min} to ${max}`);return parsed}
