import type { CommunicationPolicy } from '../domain/schemas.js'
import { PermanentWorkflowError } from './workflow-engine.js'

export const SAFE_CONTACT_WINDOW={startHour:9,endHour:20} as const

export function contactWindow(policy?:CommunicationPolicy){
  return policy?{startHour:policy.contactWindowStartHour,endHour:policy.contactWindowEndHour}:SAFE_CONTACT_WINDOW
}

export function nextAllowedContactAt(start:Date,timezone:string,policy?:CommunicationPolicy){
  try{new Intl.DateTimeFormat('en-US',{timeZone:timezone}).format(start)}catch{throw new PermanentWorkflowError('Recovery timezone is invalid')}
  const window=contactWindow(policy)
  for(let offset=0;offset<=48*60;offset+=15){
    const candidate=new Date(start.getTime()+offset*60_000)
    const hour=Number(new Intl.DateTimeFormat('en-US',{timeZone:timezone,hour:'2-digit',hourCycle:'h23'}).format(candidate))
    if(hour>=window.startHour&&hour<window.endHour)return candidate
  }
  throw new PermanentWorkflowError('Could not resolve the configured contact window')
}
