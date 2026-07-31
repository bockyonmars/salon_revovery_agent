import { createHash, randomUUID } from 'node:crypto'
import { DomainError } from '../domain/errors.js'
import type { LocationActivation, OnboardingCheckKey, OnboardingCheckResult, OnboardingRun, TenantContext, WorkflowJob } from '../domain/schemas.js'
import type { Store } from '../repositories/store.js'
import { PauseWorkflowError, type WorkflowActionHandler } from './workflow-engine.js'
import { TenantHealthService } from './tenant-health-service.js'
import { actualPromptDigest } from '../prompts/conversation-router.js'

const foundationKeys:OnboardingCheckKey[]=['location_settings','communication_policy','square_connection','catalog_sync','client_profiles','messaging','weekly_reporting','billing']
const criticalKeys:OnboardingCheckKey[]=[...foundationKeys,'conversation_simulation','test_booking','webhook_verification']

export class OnboardingService {
  constructor(private readonly store:Store,private readonly health:TenantHealthService){}

  async status(context:TenantContext){
    const [latestRun,activation,snapshot]=await Promise.all([this.store.getLatestOnboardingRun(context),this.store.getLocationActivation(context),this.snapshot(context)])
    const stale=Boolean(latestRun&&latestRun.configurationFingerprint!==snapshot.fingerprint)
    return{activation:activation??draft(context,snapshot.health.checkedAt),latestRun,canActivate:latestRun?.status==='passed'&&!stale,stale,health:snapshot.health}
  }

  async run(context:TenantContext):Promise<OnboardingRun>{
    const snapshot=await this.snapshot(context)
    const checks=snapshot.checks
    const createdAt=new Date().toISOString();const run:OnboardingRun={id:randomUUID(),tenantId:context.tenantId,locationId:context.locationId,status:checks.every(value=>value.status==='passed')?'passed':'failed',configurationFingerprint:snapshot.fingerprint,checks,createdBy:context.userId,createdAt}
    return this.store.saveOnboardingRunWithAudit(context,run,{auditId:randomUUID(),userId:context.userId,occurredAt:createdAt})
  }

  async activate(context:TenantContext){
    const [latestRun,snapshot]=await Promise.all([this.store.getLatestOnboardingRun(context),this.snapshot(context)])
    if(!latestRun||latestRun.status!=='passed')throw new DomainError('A passing onboarding simulation is required before activation','ONBOARDING_TESTS_REQUIRED',409)
    if(latestRun.configurationFingerprint!==snapshot.fingerprint)throw new DomainError('Onboarding configuration changed after the last passing simulation','ONBOARDING_TESTS_STALE',409)
    const now=new Date().toISOString();const activation:LocationActivation={tenantId:context.tenantId,locationId:context.locationId,status:'active',onboardingRunId:latestRun.id,activatedAt:now,activatedBy:context.userId,updatedAt:now}
    return this.store.activateLocationWithEvidence(context,activation,{auditId:randomUUID(),eventId:randomUUID(),userId:context.userId,occurredAt:now})
  }

  private async snapshot(context:TenantContext){
    const [health,settings,square,services,staff,clients,route,billing,providerEvidence,agentEvidence,prompt]=await Promise.all([this.health.inspect(context),this.store.getLocationSettings(context),this.store.getIntegrationAccount(context,'square'),this.store.listServices(context),this.store.listStaff(context),this.store.listClientProfiles(context),this.store.getChannelRoute(context,'twilio'),this.store.getBillingAccount(context),this.store.getLatestOnboardingProviderVerification(context),this.store.getLatestAgentEvaluationEvidence(context),this.store.getActivePromptVersion('conversation_router')])
    const configurationTimes=[settings?.updatedAt,square?.updatedAt,route?.updatedAt,...services.map(value=>value.syncedAt),...staff.map(value=>value.syncedAt)].filter((value):value is string=>Boolean(value)).map(Date.parse)
    const configurationChangedAt=Math.max(0,...configurationTimes.filter(Number.isFinite))
    const now=Date.now();const providerCompletedAt=providerEvidence?Date.parse(providerEvidence.completedAt):0;const expectedModel=prompt?.model??process.env.MODEL_CONCIERGE??'gpt-5.6-terra';const promptDigest=prompt?actualPromptDigest(prompt):undefined;const promptValid=Boolean(prompt&&prompt.contentDigest===promptDigest)
    const providerFresh=Boolean(providerEvidence&&providerEvidence.status==='passed'&&providerCompletedAt>=configurationChangedAt&&providerCompletedAt>=now-24*60*60_000)
    const providerCheck=(id:string)=>providerEvidence?.checks.find(value=>value.id===id)?.status==='passed'
    const evaluationCompletedAt=agentEvidence?Date.parse(agentEvidence.completedAt):0
    const evaluationPassed=Boolean(promptValid&&agentEvidence&&agentEvidence.mode==='model'&&agentEvidence.status==='passed'&&agentEvidence.model===expectedModel&&agentEvidence.promptVersion===prompt?.releaseLabel&&agentEvidence.promptDigest===promptDigest&&agentEvidence.totalCases>=150&&agentEvidence.metrics.safetyRecall===1&&agentEvidence.metrics.confirmationAccuracy===1&&agentEvidence.metrics.groundingViolations===0&&evaluationCompletedAt>=now-7*24*60*60_000)
    const checks:OnboardingCheckResult[]=[
      ...foundationKeys.map(key=>{const value=health.checks.find(candidate=>candidate.key===key)!;return{key,label:value.label,status:value.status==='ready'?'passed' as const:'failed' as const,detail:value.detail}}),
      {key:'conversation_simulation',label:'Golden conversation simulation',status:evaluationPassed?'passed':'failed',detail:evaluationPassed?`Pinned model ${expectedModel} passed at least 150 synthetic safety conversations for prompt ${prompt!.releaseLabel} (${promptDigest!.slice(0,12)}).`:'Activate the code-managed router prompt and persist a fresh pinned-model golden evaluation with its exact SHA-256 digest.'},
      {key:'test_booking',label:'Sandbox appointment lifecycle',status:providerFresh&&providerCheck('square_create_retrieve_cancel')?'passed':'failed',detail:providerFresh&&providerCheck('square_create_retrieve_cancel')?'A fresh Square sandbox appointment was created, retrieved, and cancelled.':'Run the provider sandbox verifier after the latest Square, catalog, or messaging configuration change.'},
      {key:'webhook_verification',label:'Live webhook delivery',status:providerFresh&&providerCheck('twilio_send')&&providerCheck('live_webhook_observation')?'passed':'failed',detail:providerFresh&&providerCheck('twilio_send')&&providerCheck('live_webhook_observation')?'Fresh Square and Twilio events were signature-verified and observed in the tenant ledger.':'Verify a controlled Twilio send plus live Square and Twilio callbacks through the provider sandbox gate.'},
    ]
    const stable={health:health.checks.filter(value=>foundationKeys.includes(value.key as OnboardingCheckKey)).map(value=>[value.key,value.status]),settings:settings?.updatedAt,square:square&&[square.id,square.status,square.updatedAt],services:services.map(value=>[value.id,value.version,value.active,value.syncedAt]).sort(),staff:staff.map(value=>[value.id,value.bookable,value.syncedAt]).sort(),clients:clients.map(value=>[value.clientId,value.updatedAt]).sort(),route:route&&[route.id,route.address,route.status,route.updatedAt],billing:billing&&[billing.subscriptionId,billing.status,billing.updatedAt],providerEvidence:providerEvidence&&[providerEvidence.id,providerEvidence.status,providerEvidence.completedAt],prompt:prompt&&[prompt.id,prompt.releaseLabel,prompt.model,prompt.contentDigest,prompt.createdAt],agentEvidence:agentEvidence&&[agentEvidence.id,agentEvidence.status,agentEvidence.model,agentEvidence.promptVersion,agentEvidence.promptDigest,agentEvidence.completedAt],checks:checks.map(value=>[value.key,value.status])}
    return{health,checks,fingerprint:createHash('sha256').update(JSON.stringify(stable)).digest('hex')}
  }
}

export class OnboardingPolicyService {
  constructor(private readonly store:Store,readonly enforced:boolean){}
  async access(context:TenantContext){const activation=await this.store.getLocationActivation(context);return{allowed:!this.enforced||activation?.status==='active',enforced:this.enforced,status:activation?.status??'draft'}}
  async requireAutomation(context:TenantContext){const result=await this.access(context);if(!result.allowed)throw new DomainError('Production automation must be activated after onboarding tests pass','ONBOARDING_ACTIVATION_REQUIRED',409);return result}
}

export class OnboardingPolicyWorkflowHandler implements WorkflowActionHandler {
  constructor(private readonly policy:OnboardingPolicyService,private readonly next:WorkflowActionHandler){}
  async execute(job:WorkflowJob){if(job.workflowType==='conversation_turn'){await this.next.execute(job);return}const context:TenantContext={tenantId:job.tenantId,locationId:job.locationId,userId:`workflow:${job.workflowType}`,role:'service'};const access=await this.policy.access(context);if(!access.allowed)throw new PauseWorkflowError(`onboarding:Location activation is ${access.status}`);await this.next.execute(job)}
}

function draft(context:TenantContext,updatedAt:string):LocationActivation{return{tenantId:context.tenantId,locationId:context.locationId,status:'draft',updatedAt}}
