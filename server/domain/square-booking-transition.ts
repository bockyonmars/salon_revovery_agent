import type { SquareBookingWebhookCursor, SquareBookingWebhookDecision } from './schemas.js'

const TERMINAL=new Set(['CANCELLED_BY_CUSTOMER','CANCELLED_BY_SELLER','DECLINED','NO_SHOW','COMPLETED'])

export function decideSquareBookingWebhook(current:SquareBookingWebhookCursor|undefined,next:SquareBookingWebhookCursor):SquareBookingWebhookDecision{
  if(!current)return{accepted:true,cursor:next}
  if(current.providerEventId===next.providerEventId)return{accepted:false,reason:'duplicate',cursor:current}
  if(Date.parse(next.providerOccurredAt)<Date.parse(current.providerOccurredAt))return{accepted:false,reason:'stale',cursor:current}
  if(current.providerStatus===next.providerStatus)return{accepted:false,reason:'no_change',cursor:current}
  if(TERMINAL.has(current.providerStatus))return{accepted:false,reason:'invalid_transition',cursor:current}
  return{accepted:true,cursor:next}
}
