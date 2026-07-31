import { randomUUID } from 'node:crypto'
import { DomainError } from '../domain/errors.js'
import { ModelPriceVersionInputSchema, type ModelPriceVersion, type ModelUsageOperation, type ModelUsageRecord, type TenantContext } from '../domain/schemas.js'
import type { Store } from '../repositories/store.js'
import type { AuditService } from './audit-service.js'

type OpenAIUsageResponse={id:string;model:string;created_at?:number;completed_at?:number|null;usage?:null|{input_tokens:number;input_tokens_details?:null|{cached_tokens?:number};output_tokens:number;output_tokens_details?:null|{reasoning_tokens?:number};total_tokens:number}}

export class ModelUsageService {
  constructor(private readonly store:Store,_audit?:AuditService,private readonly now=()=>new Date()){}

  async record(context:TenantContext,agentRunId:string,operation:ModelUsageOperation,response:OpenAIUsageResponse){
    const tokens=validUsage(response.usage)?{usageStatus:'reported' as const,inputTokens:response.usage.input_tokens,cachedInputTokens:response.usage.input_tokens_details?.cached_tokens??0,outputTokens:response.usage.output_tokens,reasoningTokens:response.usage.output_tokens_details?.reasoning_tokens??0,totalTokens:response.usage.total_tokens}:{usageStatus:'missing' as const};const providerTime=response.completed_at??response.created_at;const occurredAt=typeof providerTime==='number'&&Number.isSafeInteger(providerTime)&&providerTime>0?new Date(providerTime*1000).toISOString():this.now().toISOString();const value:ModelUsageRecord={id:randomUUID(),tenantId:context.tenantId,locationId:context.locationId,provider:'openai',providerResponseId:response.id,agentRunId,operation,model:response.model,...tokens,occurredAt};return this.store.saveModelUsageRecord(value)
  }

  async createPrice(context:TenantContext,input:unknown):Promise<ModelPriceVersion>{
    requireOwner(context);const parsed=ModelPriceVersionInputSchema.parse(input);const createdAt=this.now().toISOString();try{return await this.store.createModelPriceVersionWithAudit(context,{...parsed,id:randomUUID(),tenantId:context.tenantId,version:1,evidence:'owner_attested',createdBy:context.userId,createdAt},{auditId:randomUUID(),userId:context.userId,occurredAt:createdAt})}catch(error){if(error instanceof Error&&['MODEL_PRICE_EFFECTIVE_NOT_MONOTONIC','MODEL_PRICE_EFFECTIVE_CONFLICT'].includes(error.message))throw new DomainError('A model price must have an effective time later than the existing version','MODEL_PRICE_VERSION_CONFLICT',409);throw error}
  }

  async listPrices(context:TenantContext){requireOwner(context);return this.store.listModelPriceVersions(context)}
}

function validUsage(value:OpenAIUsageResponse['usage']):value is NonNullable<OpenAIUsageResponse['usage']>{if(!value)return false;const cached=value.input_tokens_details?.cached_tokens??0;const reasoning=value.output_tokens_details?.reasoning_tokens??0;return[value.input_tokens,cached,value.output_tokens,reasoning,value.total_tokens].every(token=>Number.isSafeInteger(token)&&token>=0)&&cached<=value.input_tokens&&reasoning<=value.output_tokens&&value.total_tokens===value.input_tokens+value.output_tokens}
function requireOwner(context:TenantContext){if(context.role!=='owner')throw new DomainError('Owner access is required for model price evidence','ROLE_FORBIDDEN',403)}
