import { createHash, randomUUID } from 'node:crypto'
import { DomainError } from '../domain/errors.js'
import { ControlledExperimentInputSchema, type ControlledExperiment, type ControlledExperimentInput, type ControlledExperimentResult, type ExperimentExposure, type ExperimentWorkflowType, type TenantContext } from '../domain/schemas.js'
import type { Store } from '../repositories/store.js'
import type { AuditService } from './audit-service.js'

const MINIMUM_SAMPLE_PER_VARIANT=50

export type ExperimentSelection={experimentId:string;variantKey:string;body:string}

export class ControlledExperimentService {
  constructor(private readonly store:Store,_audit?:AuditService,private readonly now=()=>new Date()){}

  async create(context:TenantContext,input:ControlledExperimentInput){
    const validated=ControlledExperimentInputSchema.parse(input)
    const now=this.now().toISOString()
    if(validated.endsAt&&Date.parse(validated.endsAt)<=Date.parse(now))throw new DomainError('Experiment end must be in the future','EXPERIMENT_END_ELAPSED',409)
    const experiment:ControlledExperiment={...validated,id:randomUUID(),tenantId:context.tenantId,locationId:context.locationId,version:1,status:'draft',createdBy:context.userId,createdAt:now,updatedBy:context.userId,updatedAt:now}
    return this.store.createExperiment(experiment,{auditId:randomUUID(),userId:context.userId,occurredAt:now})
  }

  async list(context:TenantContext){return this.store.listExperiments(context)}

  async activate(context:TenantContext,id:string){
    const current=await this.require(context,id)
    if(current.status==='completed')throw new DomainError('Completed experiments cannot be reactivated','EXPERIMENT_COMPLETED',409)
    if(current.status==='active')return current
    const active=await this.store.getActiveExperiment(context,current.workflowType,this.now().toISOString())
    if(active&&active.id!==id)throw new DomainError('Another experiment is active for this recovery workflow','ACTIVE_EXPERIMENT_CONFLICT',409)
    const now=this.now().toISOString()
    if(current.endsAt&&Date.parse(current.endsAt)<=Date.parse(now))throw new DomainError('Experiment end has already elapsed','EXPERIMENT_END_ELAPSED',409)
    let updated:ControlledExperiment|undefined
    try{updated=await this.store.transitionExperiment(context,id,'active',{auditId:randomUUID(),userId:context.userId,occurredAt:now})}catch(error){if(error instanceof Error&&error.message==='ACTIVE_EXPERIMENT_CONFLICT')throw new DomainError('Another experiment is active for this recovery workflow','ACTIVE_EXPERIMENT_CONFLICT',409);throw error}
    if(!updated)throw new DomainError('Experiment not found','EXPERIMENT_NOT_FOUND',404)
    return updated
  }

  async pause(context:TenantContext,id:string){return this.transition(context,id,'paused')}
  async complete(context:TenantContext,id:string){return this.transition(context,id,'completed')}

  async select(context:TenantContext,workflowType:ExperimentWorkflowType,clientId:string,sender:string):Promise<ExperimentSelection|undefined>{
    const experiment=await this.store.getActiveExperiment(context,workflowType,this.now().toISOString())
    if(!experiment)return undefined
    if(!ControlledExperimentInputSchema.safeParse(experiment).success)throw new DomainError('Active experiment configuration failed safety validation','EXPERIMENT_CONFIGURATION_INVALID',409)
    const variant=assignedVariant(experiment,clientId)
    return{experimentId:experiment.id,variantKey:variant.key,body:variant.messageTemplate.replaceAll('{{sender}}',sender)}
  }

  async recordExposure(context:TenantContext,selection:ExperimentSelection,input:{workflowJobId:string;recoveryContactAttemptId:string;clientId:string;providerMessageId:string}){
    return this.store.saveExperimentExposure(await this.prepareExposure(context,selection,input))
  }

  async prepareExposure(context:TenantContext,selection:ExperimentSelection,input:{workflowJobId:string;recoveryContactAttemptId:string;clientId:string;providerMessageId:string},exposedAt=this.now().toISOString()){
    const experiment=await this.store.getExperiment(context,selection.experimentId)
    if(!experiment||!experiment.variants.some(value=>value.key===selection.variantKey))throw new DomainError('Experiment exposure does not match a configured variant','EXPERIMENT_EXPOSURE_INVALID',409)
    const exposure:ExperimentExposure={id:randomUUID(),tenantId:context.tenantId,locationId:context.locationId,experimentId:selection.experimentId,variantKey:selection.variantKey,...input,exposedAt}
    return exposure
  }

  async results(context:TenantContext,id:string):Promise<ControlledExperimentResult>{
    const experiment=await this.require(context,id)
    const [exposures,attributions]=await Promise.all([this.store.listExperimentExposures(context,id),this.store.listRevenueAttribution(context)])
    const attributionByJob=new Map(attributions.map(value=>[value.workflowJobId,value]))
    const variants=experiment.variants.map(variant=>{const assigned=exposures.filter(value=>value.variantKey===variant.key);const recovered=assigned.map(value=>attributionByJob.get(value.workflowJobId)).filter(value=>value!==undefined);const revenue:Record<string,number>={};for(const value of recovered)revenue[value.currency]=(revenue[value.currency]??0)+value.amountMinor;return{variantKey:variant.key,allocation:variant.allocation,exposures:assigned.length,recoveredBookings:recovered.length,conversionRate:assigned.length?recovered.length/assigned.length:0,verifiedRecoveredRevenueMinorByCurrency:revenue}})
    return{experimentId:id,status:experiment.status,evidence:'verified_booking_attribution_only',minimumSampleReached:variants.every(value=>value.exposures>=MINIMUM_SAMPLE_PER_VARIANT),minimumSamplePerVariant:MINIMUM_SAMPLE_PER_VARIANT,winnerSuggested:false,variants,generatedAt:this.now().toISOString()}
  }

  private async transition(context:TenantContext,id:string,status:'paused'|'completed'){
    const current=await this.require(context,id)
    if(current.status===status)return current
    if(current.status!=='active')throw new DomainError(`Only active experiments can be ${status}`,'EXPERIMENT_TRANSITION_INVALID',409)
    const occurredAt=this.now().toISOString();const updated=await this.store.transitionExperiment(context,id,status,{auditId:randomUUID(),userId:context.userId,occurredAt})
    if(!updated)throw new DomainError('Experiment not found','EXPERIMENT_NOT_FOUND',404)
    return updated
  }

  private async require(context:TenantContext,id:string){const value=await this.store.getExperiment(context,id);if(!value)throw new DomainError('Experiment not found','EXPERIMENT_NOT_FOUND',404);return value}
}

function assignedVariant(experiment:ControlledExperiment,clientId:string){const digest=createHash('sha256').update(`${experiment.tenantId}:${experiment.locationId}:${experiment.id}:${clientId}`).digest();const point=digest.readUInt32BE(0)/0x1_0000_0000*100;let cumulative=0;for(const variant of experiment.variants){cumulative+=variant.allocation;if(point<cumulative)return variant}return experiment.variants[experiment.variants.length-1]!}
