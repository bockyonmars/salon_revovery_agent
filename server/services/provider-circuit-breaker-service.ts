import { randomUUID } from 'node:crypto'
import { DomainError } from '../domain/errors.js'
import type { ProviderCircuitState, ProviderName, TenantContext } from '../domain/schemas.js'
import type { Store } from '../repositories/store.js'
import { redactText } from '../security/pii-redaction.js'

export type ProviderCircuitPolicy={failureThreshold:number;cooldownMs:number;probeLeaseMs:number}

const DEFAULT_POLICY:ProviderCircuitPolicy={failureThreshold:5,cooldownMs:60_000,probeLeaseMs:30_000}

export class ProviderCircuitBreakerService{
  private readonly policy:ProviderCircuitPolicy
  constructor(private readonly store:Store,policy:Partial<ProviderCircuitPolicy>={},private readonly clock:()=>Date=()=>new Date()){this.policy={...DEFAULT_POLICY,...policy};if(!Number.isInteger(this.policy.failureThreshold)||this.policy.failureThreshold<1)throw new Error('Provider circuit failureThreshold must be a positive integer');if(this.policy.cooldownMs<1||this.policy.probeLeaseMs<1)throw new Error('Provider circuit timings must be positive')}

  async execute<T>(context:TenantContext,provider:ProviderName,operation:string,action:()=>Promise<T>):Promise<T>{
    const now=this.clock().toISOString();const permit=await this.store.acquireProviderCircuitPermit(context,provider,now,this.policy.probeLeaseMs)
    if(!permit.allowed)throw new ProviderCircuitOpenError(provider,operation,permit.circuit)
    try{const result=await action();await this.store.recordProviderCircuitSuccess(context,provider,this.clock().toISOString());return result}catch(error){
      if(error instanceof ProviderCircuitOpenError)throw error
      if(isTransientProviderFailure(error)){const circuit=await this.store.recordProviderCircuitFailure(context,provider,this.clock().toISOString(),this.policy.failureThreshold,this.policy.cooldownMs,providerErrorCode(error));if(circuit.state==='open')await this.openOutageApproval(context,circuit,operation)}
      else await this.store.recordProviderCircuitSuccess(context,provider,this.clock().toISOString())
      throw error
    }
  }

  list(context:TenantContext){return this.store.listProviderCircuits(context)}
  reset(context:TenantContext,provider:ProviderName,reason:string){return this.store.resetProviderCircuit(context,provider,{auditId:randomUUID(),userId:context.userId,redactedReason:redactText(reason),occurredAt:this.clock().toISOString()})}

  private async openOutageApproval(context:TenantContext,circuit:ProviderCircuitState,operation:string){const createdAt=this.clock().toISOString();await this.store.createApprovalRequestWithEvent({id:randomUUID(),tenantId:context.tenantId,locationId:context.locationId,requestType:'integration_reconnect',reason:`${circuit.provider} integration crossed the transient-failure threshold and automatic calls are paused.`,status:'pending',entityType:'integration_provider',entityId:circuit.provider,payload:{provider:circuit.provider,state:circuit.state,consecutiveFailures:circuit.consecutiveFailures,openedAt:circuit.openedAt,operation:operation.slice(0,100),errorCode:circuit.lastErrorCode},createdAt},{eventId:randomUUID(),correlationId:`provider-outage:${circuit.provider}`,causationId:`circuit:${circuit.provider}:${circuit.openedAt??createdAt}`})}
}

export class ProviderCircuitOpenError extends DomainError{
  constructor(public readonly provider:ProviderName,public readonly operation:string,public readonly circuit:ProviderCircuitState){super(`${provider} is temporarily unavailable while its circuit breaker recovers`,'PROVIDER_CIRCUIT_OPEN',503)}
}

export function isTransientProviderFailure(error:unknown){
  const status=providerStatus(error);if(status!==undefined)return status===408||status===425||status===429||status>=500
  if(typeof error==='object'&&error!==null&&'code'in error){const code=String((error as{code:unknown}).code).toUpperCase();if(['ECONNABORTED','ECONNREFUSED','ECONNRESET','EHOSTUNREACH','ENETDOWN','ENETUNREACH','ENOTFOUND','EPIPE','ETIMEDOUT'].includes(code))return true}
  return error instanceof TypeError||/timeout|timed out|connection reset|network error|socket hang up/i.test(error instanceof Error?error.message:String(error))
}

function providerStatus(error:unknown){if(typeof error!=='object'||error===null)return undefined;for(const key of ['status','statusCode']){const value=(error as Record<string,unknown>)[key];if(typeof value==='number')return value}return undefined}
function providerErrorCode(error:unknown){if(typeof error==='object'&&error!==null){for(const key of ['code','status','statusCode']){const value=(error as Record<string,unknown>)[key];if(typeof value==='string'||typeof value==='number')return String(value).slice(0,100)}}return(error instanceof Error?error.name:'PROVIDER_ERROR').slice(0,100)}
