import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { twilioMessageAddresses, type MessagingProvider } from './integrations/twilio-messaging.js'
import { MemoryStore } from './repositories/memory-store.js'
import { AuditService } from './services/audit-service.js'
import { ConsentService } from './services/consent-service.js'
import { EventService } from './services/event-service.js'
import { MessageService } from './services/message-service.js'
import { TenantHealthService } from './services/tenant-health-service.js'

const context={tenantId:'tenant-one',locationId:'location-one',userId:'manager-one',role:'manager' as const}
const healthConfig={messagingConfigured:true,smsMessagingConfigured:true,whatsappMessagingConfigured:false,reportEmailConfigured:false,billingConfigured:false,rateLimitingConfigured:false}

describe('channel-safe Twilio messaging',()=>{
  it('keeps SMS plain and normalizes WhatsApp sender and destination addresses',()=>{
    expect(twilioMessageAddresses('sms','+15555550101',{smsFrom:'+15555550100'})).toEqual({to:'+15555550101',from:'+15555550100'})
    expect(twilioMessageAddresses('whatsapp','+15555550102',{whatsappFrom:'whatsapp:+15555550100'})).toEqual({to:'whatsapp:+15555550102',from:'whatsapp:+15555550100'})
    expect(()=>twilioMessageAddresses('sms','whatsapp:+15555550101',{smsFrom:'+15555550100'})).toThrowError(expect.objectContaining({code:'MESSAGING_ADDRESS_INVALID',statusCode:400}))
    expect(()=>twilioMessageAddresses('whatsapp','+15555550102',{smsFrom:'+15555550100'})).toThrowError(expect.objectContaining({code:'MESSAGING_SENDER_NOT_CONFIGURED',statusCode:503}))
  })

  it('requires WhatsApp consent independently and passes the explicit channel to the provider',async()=>{
    const store=new MemoryStore();const audit=new AuditService(store);const consent=new ConsentService(store,audit);const events=new EventService(store);const sent:Parameters<MessagingProvider['send']>[0][]=[]
    const messages=new MessageService({send:async input=>{sent.push(input);return{id:'SM-whatsapp-one',status:'queued'}}},consent,events,audit)
    await consent.record(context,{clientId:'client-one',channel:'sms',purpose:'transactional',status:'opted_in',captureMethod:'booking_form',disclosureVersion:'transactional-v1'})
    const input={clientId:'client-one',channel:'whatsapp' as const,purpose:'transactional' as const,to:'+15555550102',body:'Your appointment is confirmed.',correlationId:'booking-one',idempotencyKey:'whatsapp-message-one'}
    await expect(messages.send(context,input)).rejects.toMatchObject({code:'CONSENT_REQUIRED'})
    await consent.record(context,{clientId:'client-one',channel:'whatsapp',purpose:'transactional',status:'opted_in',captureMethod:'booking_form',disclosureVersion:'transactional-v1'})
    await expect(messages.send(context,input)).resolves.toMatchObject({message:{id:'SM-whatsapp-one'},duplicate:false})
    expect(sent).toEqual([expect.objectContaining({channel:'whatsapp',to:'+15555550102'})])
  })

  it('requires sender credentials that match the location route channel',async()=>{
    const store=new MemoryStore();const now=new Date().toISOString();await store.saveChannelRoute({id:randomUUID(),tenantId:context.tenantId,locationId:context.locationId,provider:'twilio',address:'whatsapp:+15555550100',status:'active',createdAt:now,updatedAt:now})
    const blocked=(await new TenantHealthService(store,healthConfig).inspect(context)).checks.find(value=>value.key==='messaging')
    expect(blocked).toMatchObject({status:'blocked',detail:expect.stringContaining('WhatsApp sender credentials are incomplete')})
    const ready=(await new TenantHealthService(store,{...healthConfig,whatsappMessagingConfigured:true}).inspect(context)).checks.find(value=>value.key==='messaging')
    expect(ready).toMatchObject({status:'ready',detail:expect.stringContaining('WhatsApp delivery')})
  })
})
