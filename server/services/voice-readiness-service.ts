import { randomUUID } from 'node:crypto'
import { DomainError } from '../domain/errors.js'
import type { TenantContext, VoiceReadinessAttestation, VoiceReadinessDeclaration } from '../domain/schemas.js'
import type { Store } from '../repositories/store.js'

const DAY=86_400_000

export class VoiceReadinessService{
  constructor(private readonly store:Store,private readonly now=()=>new Date(),private readonly runtimeConfigured=false){}

  async status(context:TenantContext){
    this.requireManagement(context)
    const snapshot=await this.snapshot(context)
    return{...snapshot,declaration:publicVoiceReadinessDeclaration(snapshot.declaration),runtimeConfigured:this.runtimeConfigured,permissions:{evaluateReliability:true,attest:context.role==='owner'},voiceEnabled:Boolean(snapshot.voiceRuntimeAllowed&&this.runtimeConfigured)}
  }

  async runtimeAccess(context:TenantContext){
    if(context.role!=='service')throw new DomainError('Service access is required','ROLE_FORBIDDEN',403)
    const snapshot=await this.snapshot(context)
    return{allowed:Boolean(snapshot.voiceRuntimeAllowed&&this.runtimeConfigured),declaration:snapshot.declaration}
  }

  private async snapshot(context:TenantContext){
    const[evaluation,declaration]=await Promise.all([this.store.getLatestMessagingReliabilityEvaluation(context),this.store.getLatestVoiceReadinessDeclaration(context)])
    const current=this.now().getTime()
    const reliabilityCurrent=Boolean(evaluation&&evaluation.status==='passed'&&evaluation.voiceBuildAllowed&&Date.parse(evaluation.createdAt)<=current&&Date.parse(evaluation.expiresAt)>current)
    const declarationValid=Boolean(declaration&&declaration.recordingMode==='disabled'&&declaration.transferMode==='human'&&/^\+[1-9]\d{7,14}$/.test(declaration.transferTo??'')&&declaration.controls.aiParticipationDisclosureReviewed&&declaration.controls.recordingStorageDisabled&&declaration.controls.immediateTransferTested&&declaration.controls.jurisdictionRetentionReviewed)
    const declarationCurrent=Boolean(declarationValid&&declaration&&Date.parse(declaration.createdAt)<=current&&Date.parse(declaration.expiresAt)>current)
    return{evaluation,declaration,reliabilityCurrent,declarationCurrent,voiceRuntimeAllowed:Boolean(reliabilityCurrent&&declarationCurrent)}
  }

  async attest(context:TenantContext,input:VoiceReadinessAttestation):Promise<VoiceReadinessDeclaration>{
    if(context.role!=='owner')throw new DomainError('Owner access is required','ROLE_FORBIDDEN',403)
    const evaluation=await this.store.getLatestMessagingReliabilityEvaluation(context)
    const createdAt=this.now().toISOString()
    if(!evaluation||evaluation.status!=='passed'||!evaluation.voiceBuildAllowed||Date.parse(evaluation.createdAt)>Date.parse(createdAt)||Date.parse(evaluation.expiresAt)<=Date.parse(createdAt))throw new DomainError('A current passing SMS reliability evaluation is required','VOICE_RELIABILITY_EVIDENCE_REQUIRED',409)
    const declaration:VoiceReadinessDeclaration={id:randomUUID(),tenantId:context.tenantId,locationId:context.locationId,policyVersion:'voice-readiness-v1',status:'attested',messagingReliabilityEvaluationId:evaluation.id,...input,createdBy:context.userId,createdAt,expiresAt:new Date(Date.parse(createdAt)+90*DAY).toISOString()}
    try{return await this.store.saveVoiceReadinessDeclarationWithAudit(context,declaration,{auditId:randomUUID(),userId:context.userId,occurredAt:createdAt})}catch(error){if(error instanceof Error&&error.message==='VOICE_RELIABILITY_EVIDENCE_STALE')throw new DomainError('The SMS reliability evaluation changed or expired before attestation completed','VOICE_RELIABILITY_EVIDENCE_STALE',409);throw error}
  }

  private requireManagement(context:TenantContext){if(context.role!=='owner'&&context.role!=='manager')throw new DomainError('Owner or manager access is required','ROLE_FORBIDDEN',403)}
}

export function publicVoiceReadinessDeclaration(declaration:VoiceReadinessDeclaration|undefined){
  if(!declaration)return undefined
  const{transferTo,...safe}=declaration
  return{...safe,transferToMasked:`+••••${transferTo.slice(-4)}`}
}
