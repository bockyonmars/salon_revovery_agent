import { DomainError } from '../domain/errors.js'
import type { TenantContext, WorkflowJob } from '../domain/schemas.js'
import type { Store } from '../repositories/store.js'
import { PauseWorkflowError, type WorkflowActionHandler } from './workflow-engine.js'

export class BillingPolicyService {
  constructor(private readonly store:Store,readonly enforced:boolean){}
  async access(context:TenantContext){const account=await this.store.getBillingAccount(context);const allowed=!this.enforced||account?.status==='active'||account?.status==='trialing';return{allowed,enforced:this.enforced,status:account?.status??'missing'}}
  async requireAutomation(context:TenantContext){const result=await this.access(context);if(!result.allowed)throw new DomainError('An active subscription or trial is required for this automation','BILLING_ACCESS_REQUIRED',402);return result}
}

export class BillingPolicyWorkflowHandler implements WorkflowActionHandler {
  constructor(private readonly policy:BillingPolicyService,private readonly next:WorkflowActionHandler){}
  async execute(job:WorkflowJob){if(job.workflowType==='conversation_turn'){await this.next.execute(job);return}const context:TenantContext={tenantId:job.tenantId,locationId:job.locationId,userId:`workflow:${job.workflowType}`,role:'service'};const access=await this.policy.access(context);if(!access.allowed)throw new PauseWorkflowError(`billing:Subscription access is ${access.status}`);await this.next.execute(job)}
}
