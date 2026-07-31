import { randomUUID } from 'node:crypto'
import Stripe from 'stripe'
import { DomainError } from '../domain/errors.js'
import type { BillingAccount, BillingStatus, TenantContext } from '../domain/schemas.js'
import type { Store } from '../repositories/store.js'
import { EventService } from './event-service.js'

const subscriptionEvents=new Set(['customer.subscription.created','customer.subscription.updated','customer.subscription.deleted','customer.subscription.paused','customer.subscription.resumed'])
const billingStatuses=new Set<BillingStatus>(['trialing','active','past_due','paused','canceled','incomplete','incomplete_expired','unpaid'])

export class StripeBillingWebhookService {
  private readonly stripe:Stripe
  constructor(private readonly store:Store,private readonly events:EventService,secretKey:string,private readonly webhookSecret:string){this.stripe=new Stripe(secretKey,{maxNetworkRetries:0,timeout:8_000})}

  async handle(rawBody:string,signature:string){let event:Stripe.Event;try{event=this.stripe.webhooks.constructEvent(rawBody,signature,this.webhookSecret)}catch{throw new DomainError('Stripe webhook signature is invalid','INVALID_WEBHOOK_SIGNATURE',403)}if(!subscriptionEvents.has(event.type))return{accepted:true,ignored:true,duplicate:false,stale:false,resumed:0};const subscription=event.data.object as Stripe.Subscription;const context=tenant(subscription.metadata);const value=account(context,subscription,event);const result=await this.store.saveBillingAccountFromEvent(value);if(!result.duplicate&&!result.stale)await this.events.ingest(context,{eventId:randomUUID(),eventType:'billing.updated',occurredAt:new Date(event.created*1000).toISOString(),correlationId:subscription.id,causationId:event.id,schemaVersion:1,payload:{provider:'stripe',subscriptionId:subscription.id,status:value.status,trialEndsAt:value.trialEndsAt,currentPeriodEndsAt:value.currentPeriodEndsAt,cancelAtPeriodEnd:value.cancelAtPeriodEnd}});const resumed=!result.duplicate&&!result.stale&&(value.status==='active'||value.status==='trialing')?await this.store.resumeBillingPausedJobs(context):0;return{accepted:true,ignored:false,duplicate:result.duplicate,stale:result.stale,status:result.account.status,resumed}}
}

function tenant(metadata:Stripe.Metadata):TenantContext{const tenantId=metadata.tenantId;const locationId=metadata.locationId;if(!tenantId||tenantId.length<3||!locationId||locationId.length<3)throw new DomainError('Stripe subscription tenant metadata is missing','WEBHOOK_TENANT_UNRESOLVED',422);return{tenantId,locationId,userId:'stripe-webhook',role:'service'}}
function account(context:TenantContext,subscription:Stripe.Subscription,event:Stripe.Event):BillingAccount{if(!billingStatuses.has(subscription.status as BillingStatus))throw new DomainError(`Unsupported Stripe subscription status: ${subscription.status}`,'BILLING_STATUS_UNSUPPORTED',422);const customerId=typeof subscription.customer==='string'?subscription.customer:subscription.customer.id;const item=subscription.items.data[0];const periodEnd=subscription.items.data.reduce((latest,value)=>Math.max(latest,value.current_period_end),0);const now=new Date().toISOString();return{id:randomUUID(),tenantId:context.tenantId,locationId:context.locationId,provider:'stripe',customerId,subscriptionId:subscription.id,priceId:item?.price.id,status:subscription.status as BillingStatus,...(subscription.trial_end?{trialEndsAt:new Date(subscription.trial_end*1000).toISOString()}:{}),...(periodEnd?{currentPeriodEndsAt:new Date(periodEnd*1000).toISOString()}:{}),cancelAtPeriodEnd:subscription.cancel_at_period_end,providerEventCreated:event.created,sourceEventId:event.id,sourceEventType:event.type,createdAt:now,updatedAt:now}}
