import { randomUUID } from 'node:crypto'
import { DomainError } from '../domain/errors.js'
import type { RealtimeVoiceActivation,TenantContext,VoiceReleaseEvidence,VoiceReleaseEvidenceInput } from '../domain/schemas.js'
import type { Store } from '../repositories/store.js'
import { VoiceReadinessService } from './voice-readiness-service.js'
import { publicVoiceReadinessDeclaration } from './voice-readiness-service.js'

const DAY=86_400_000

export class VoiceReleaseService{
  constructor(private readonly store:Store,private readonly model:string,private readonly runtimeConfigured=false,private readonly now=()=>new Date()){}

  async status(context:TenantContext){this.requireManagement(context);const snapshot=await this.snapshot(context);return{...snapshot,readiness:{...snapshot.readiness,declaration:publicVoiceReadinessDeclaration(snapshot.readiness.declaration)},runtimeConfigured:this.runtimeConfigured,permissions:{attestEvidence:context.role==='owner',activate:context.role==='owner'},realtimeVoiceEnabled:Boolean(snapshot.realtimeRuntimeAllowed&&this.runtimeConfigured)}}

  async attestEvidence(context:TenantContext,input:VoiceReleaseEvidenceInput):Promise<VoiceReleaseEvidence>{
    this.requireOwner(context);const createdAt=this.now().toISOString();const completedAt=Date.parse(input.sandboxCompletedAt);if(input.model!==this.model)throw new DomainError('Sandbox evidence model does not match the configured Realtime model','VOICE_RELEASE_MODEL_MISMATCH',409);if(!Number.isFinite(completedAt)||completedAt>Date.parse(createdAt)||Date.parse(createdAt)-completedAt>DAY)throw new DomainError('Sandbox evidence must have completed within the previous 24 hours','VOICE_RELEASE_EVIDENCE_STALE',409)
    const value:VoiceReleaseEvidence={id:randomUUID(),tenantId:context.tenantId,locationId:context.locationId,...input,status:'attested',createdBy:context.userId,createdAt,expiresAt:new Date(Date.parse(createdAt)+30*DAY).toISOString()}
    return this.store.saveVoiceReleaseEvidenceWithAudit(context,value,{auditId:randomUUID(),userId:context.userId,occurredAt:createdAt})
  }

  async activate(context:TenantContext):Promise<RealtimeVoiceActivation>{
    this.requireOwner(context);const at=this.now().toISOString();const[evidence,readiness]=await Promise.all([this.store.getLatestVoiceReleaseEvidence(context),new VoiceReadinessService(this.store,this.now,true).status(context)]);if(!evidence||evidence.model!==this.model||Date.parse(evidence.createdAt)>Date.parse(at)||Date.parse(evidence.expiresAt)<=Date.parse(at))throw new DomainError('Current sandbox evidence for the configured Realtime model is required','VOICE_RELEASE_EVIDENCE_REQUIRED',409);if(!readiness.voiceRuntimeAllowed||!readiness.declaration||!readiness.evaluation)throw new DomainError('Current voice readiness and SMS reliability evidence is required','VOICE_READINESS_REQUIRED',409)
    const value:RealtimeVoiceActivation={id:randomUUID(),tenantId:context.tenantId,locationId:context.locationId,policyVersion:'voice-runtime-activation-v1',status:'active',voiceReleaseEvidenceId:evidence.id,voiceReadinessDeclarationId:readiness.declaration.id,messagingReliabilityEvaluationId:readiness.evaluation.id,model:this.model,activatedBy:context.userId,activatedAt:at}
    try{return await this.store.activateRealtimeVoiceWithAudit(context,value,{auditId:randomUUID(),userId:context.userId,occurredAt:at})}catch(error){if(error instanceof Error&&error.message==='REALTIME_VOICE_ACTIVATION_EVIDENCE_STALE')throw new DomainError('Voice release evidence changed or expired before activation completed','VOICE_RELEASE_EVIDENCE_STALE',409);throw error}
  }

  async runtimeAccess(context:TenantContext){if(context.role!=='service')throw new DomainError('Service access is required','ROLE_FORBIDDEN',403);const snapshot=await this.snapshot(context);return{allowed:snapshot.realtimeRuntimeAllowed,declaration:snapshot.readiness.declaration,activation:snapshot.activation}}

  private async snapshot(context:TenantContext){const[readiness,evidence,activation]=await Promise.all([new VoiceReadinessService(this.store,this.now,true).runtimeAccess({...context,role:'service'}),this.store.getLatestVoiceReleaseEvidence(context),this.store.getLatestRealtimeVoiceActivation(context)]);const current=this.now().getTime();const evidenceCurrent=Boolean(evidence&&evidence.status==='attested'&&evidence.model===this.model&&Date.parse(evidence.createdAt)<=current&&Date.parse(evidence.expiresAt)>current);const activationCurrent=Boolean(activation&&activation.status==='active'&&activation.model===this.model&&activation.voiceReleaseEvidenceId===evidence?.id&&activation.voiceReadinessDeclarationId===readiness.declaration?.id&&Date.parse(activation.activatedAt)<=current);return{model:this.model,readiness,evidence,activation,evidenceCurrent,activationCurrent,realtimeRuntimeAllowed:Boolean(readiness.allowed&&evidenceCurrent&&activationCurrent)}}
  private requireOwner(context:TenantContext){if(context.role!=='owner')throw new DomainError('Owner access is required','ROLE_FORBIDDEN',403)}
  private requireManagement(context:TenantContext){if(context.role!=='owner'&&context.role!=='manager')throw new DomainError('Owner or manager access is required','ROLE_FORBIDDEN',403)}
}
