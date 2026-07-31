import { createHmac } from 'node:crypto'
import twilio from 'twilio'

export function signedSquareWebhook(input:{signatureKey:string;notificationUrl:string;body:Record<string,unknown>}){const payload=JSON.stringify(input.body);const signature=createHmac('sha256',input.signatureKey).update(`${input.notificationUrl}${payload}`).digest('base64');return{method:'POST' as const,url:'/webhooks/square',headers:{'content-type':'application/json','x-square-hmacsha256-signature':signature},payload}}

export function signedTwilioWebhook(input:{authToken:string;webhookUrl:string;path:'/webhooks/twilio/status'|'/webhooks/twilio/inbound'|'/webhooks/twilio/voice/status';params:Record<string,string>}){const signature=twilio.getExpectedTwilioSignature(input.authToken,input.webhookUrl,input.params);return{method:'POST' as const,url:input.path,headers:{'content-type':'application/x-www-form-urlencoded','x-twilio-signature':signature},payload:new URLSearchParams(input.params).toString()}}
