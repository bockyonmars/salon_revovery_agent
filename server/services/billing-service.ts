import Stripe from 'stripe'
import { DomainError } from '../domain/errors.js'
import type { TenantContext } from '../domain/schemas.js'
import type { Store } from '../repositories/store.js'
import type { ProviderCircuitBreakerService } from './provider-circuit-breaker-service.js'

export class BillingService {
  private readonly stripe:Stripe
  constructor(private readonly store:Store,secretKey:string,private readonly config:{priceId:string;successUrl:string;cancelUrl:string;trialDays:number},client?:Stripe,private readonly providerCircuits?:ProviderCircuitBreakerService){this.stripe=client??new Stripe(secretKey,{maxNetworkRetries:0,timeout:8_000})}

  async status(context:TenantContext){const account=await this.store.getBillingAccount(context);return{account,automationAccess:account?.status==='active'||account?.status==='trialing'}}

  async createCheckout(context:TenantContext,idempotencyKey:string){const existing=await this.store.getBillingAccount(context);if(existing&&['active','trialing'].includes(existing.status))throw new DomainError('This location already has billing access','BILLING_ALREADY_ACTIVE',409);const metadata={tenantId:context.tenantId,locationId:context.locationId};const create=()=>this.stripe.checkout.sessions.create({mode:'subscription',line_items:[{price:this.config.priceId,quantity:1}],success_url:this.config.successUrl,cancel_url:this.config.cancelUrl,client_reference_id:`${context.tenantId}:${context.locationId}`,metadata,subscription_data:{metadata,...(this.config.trialDays>0?{trial_period_days:this.config.trialDays,trial_settings:{end_behavior:{missing_payment_method:'cancel' as const}}}:{})}}, {idempotencyKey});const session=this.providerCircuits?await this.providerCircuits.execute(context,'stripe','checkout.session.create',create):await create();if(!session.url)throw new DomainError('Stripe did not return a hosted checkout URL','BILLING_CHECKOUT_INVALID',502);return{checkoutSessionId:session.id,url:session.url,expiresAt:session.expires_at?new Date(session.expires_at*1000).toISOString():undefined}}
}
