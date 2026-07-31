import type { BookingToolName, ConversationRoute } from '../domain/schemas.js'

const REDACTED='[REDACTED]'
const sensitiveKeys=new Set(['accesstoken','address','authorization','body','calleraddress','checkoutsessionid','confirmationtoken','contactto','credential','credentials','decisionnote','destination','displayname','email','encryptedcredentials','firstname','fullname','lastname','messagebody','note','participantaddress','password','phone','phonenumber','providercustomerid','publicreviewurl','reason','recipientemail','refreshtoken','reportrecipientemail','secret','sourceevidenceurl','staffname','token','to','url'])

export function redactSensitive(value:unknown):unknown{return visit(value,new WeakSet<object>())}

export function redactText(value:string){return value.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,'[EMAIL]').replace(/(?:whatsapp:)?\+[1-9]\d[\d ()-]{5,}\d/g,'[PHONE]').replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi,'Bearer [REDACTED]')}

export function traceSafeRoute(route:ConversationRoute):ConversationRoute{return{intent:route.intent,confidence:route.confidence,urgency:route.urgency,requiresHuman:route.requiresHuman,shortReason:`Conversation classified as ${route.intent}.`}}

export function traceSafeToolResult(toolName:BookingToolName,result:{ok:true;data:unknown}|{ok:false;errorCode:string;message:string}){
  if(!result.ok)return{ok:false,errorCode:result.errorCode}
  const data=objectValue(result.data)
  if(toolName==='list_services')return{ok:true,serviceCount:Array.isArray(data?.services)?data.services.length:0}
  if(toolName==='list_staff')return{ok:true,staffCount:Array.isArray(data?.staff)?data.staff.length:0}
  if(toolName==='search_support_knowledge')return{ok:true,matchCount:Array.isArray(data?.matches)?data.matches.length:0,grounded:data?.grounded===true}
  if(toolName==='search_availability')return{ok:true,optionCount:Array.isArray(data?.options)?data.options.length:0}
  if(toolName==='create_temporary_hold')return{ok:true,holdId:stringValue(data?.holdId),expiresAt:stringValue(data?.expiresAt)}
  if(toolName==='get_service_details')return{ok:true,serviceId:stringValue(data?.serviceId)}
  return{ok:true,configured:true}
}

function visit(value:unknown,seen:WeakSet<object>):unknown{
  if(typeof value==='string')return redactText(value)
  if(value===null||typeof value!=='object')return value
  if(Buffer.isBuffer(value))return REDACTED
  if(value instanceof Date)return value.toISOString()
  if(seen.has(value))return '[CIRCULAR]'
  seen.add(value)
  if(Array.isArray(value))return value.map(item=>visit(item,seen))
  return Object.fromEntries(Object.entries(value as Record<string,unknown>).map(([key,item])=>[key,sensitiveKeys.has(normalizeKey(key))?REDACTED:visit(item,seen)]))
}

function normalizeKey(value:string){return value.replace(/[^a-z0-9]/gi,'').toLowerCase()}
function objectValue(value:unknown){return value&&typeof value==='object'?value as Record<string,unknown>:undefined}
function stringValue(value:unknown){return typeof value==='string'?value:undefined}
