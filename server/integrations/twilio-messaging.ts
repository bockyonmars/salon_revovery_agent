import twilio from 'twilio'
import { DomainError } from '../domain/errors.js'

export type TwilioMessageChannel = 'sms' | 'whatsapp'
export type TwilioMessagingConfig = { accountSid: string; authToken: string; smsFrom?: string; whatsappFrom?: string }

export interface MessagingProvider {
  send(input: { channel: TwilioMessageChannel; to: string; body: string; statusCallback?: string }): Promise<{ id: string; status: string }>
  supportsChannel?(channel:TwilioMessageChannel):boolean
  inspectMessage?(messageId:string):Promise<{found:boolean;id:string;status?:string;errorCode?:string}>
}

export class TwilioMessagingProvider implements MessagingProvider {
  private readonly client
  constructor(private readonly config: TwilioMessagingConfig) {
    if(!config.smsFrom&&!config.whatsappFrom)throw new DomainError('At least one Twilio messaging sender must be configured','MESSAGING_SENDER_NOT_CONFIGURED',503)
    if(config.smsFrom)smsAddress(config.smsFrom,'sender')
    if(config.whatsappFrom)whatsappAddress(config.whatsappFrom,'sender')
    this.client = twilio(config.accountSid, config.authToken, { autoRetry: false, timeout: 8_000 })
  }
  supportsChannel(channel:TwilioMessageChannel){return channel==='whatsapp'?Boolean(this.config.whatsappFrom):Boolean(this.config.smsFrom)}
  async send(input: { channel: TwilioMessageChannel; to: string; body: string; statusCallback?: string }) {
    const addresses=twilioMessageAddresses(input.channel,input.to,this.config)
    const message = await this.client.messages.create({ ...addresses, body: input.body, statusCallback: input.statusCallback })
    return { id: message.sid, status: message.status }
  }
  async inspectMessage(messageId:string){try{const message=await this.client.messages(messageId).fetch();return{found:true,id:message.sid,status:message.status,...(message.errorCode!==null?{errorCode:String(message.errorCode)}:{})}}catch(error){if(providerStatus(error)===404)return{found:false,id:messageId};throw error}}
}

export function twilioMessageAddresses(channel:TwilioMessageChannel,to:string,config:Pick<TwilioMessagingConfig,'smsFrom'|'whatsappFrom'>){
  const sender=channel==='whatsapp'?config.whatsappFrom:config.smsFrom
  if(!sender)throw new DomainError(`Twilio ${channel==='whatsapp'?'WhatsApp':'SMS'} sender is not configured`,'MESSAGING_SENDER_NOT_CONFIGURED',503)
  if(channel==='sms')return{to:smsAddress(to,'destination'),from:smsAddress(sender,'sender')}
  return{to:whatsappAddress(to,'destination'),from:whatsappAddress(sender,'sender')}
}

function smsAddress(value:string,kind:string){const address=value.trim();if(!/^\+[1-9]\d{7,14}$/.test(address))throw new DomainError(`Twilio SMS ${kind} must be an E.164 address`,'MESSAGING_ADDRESS_INVALID',400);return address}
function whatsappAddress(value:string,kind:string){const address=value.trim().replace(/^whatsapp:/i,'');if(!/^\+[1-9]\d{7,14}$/.test(address))throw new DomainError(`Twilio WhatsApp ${kind} must be an E.164 address with an optional whatsapp: prefix`,'MESSAGING_ADDRESS_INVALID',400);return`whatsapp:${address}`}

function providerStatus(error:unknown){if(typeof error!=='object'||error===null)return undefined;const value=(error as{status?:unknown}).status;return typeof value==='number'?value:undefined}

export function validateTwilioWebhook(input: { authToken: string; signature: string; url: string; params: Record<string, string> }) {
  return twilio.validateRequest(input.authToken, input.signature, input.url, input.params)
}
