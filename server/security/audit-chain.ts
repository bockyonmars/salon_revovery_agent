import { createHash } from 'node:crypto'
import type { AuditIntegrityReport, AuditRecord, AuditRecordInput } from '../domain/schemas.js'

export const AUDIT_GENESIS_HASH='0'.repeat(64)

export function sealAuditRecord(input:AuditRecordInput,sequence:number,previousHash:string):AuditRecord{
  const normalized=canonical(input) as AuditRecordInput;const unsigned={...normalized,chainVersion:1 as const,sequence,previousHash};return{...unsigned,recordHash:sha256(stable(unsigned))}
}

export function legacyAuditAnchor(records:AuditRecordInput[]){return sha256(`legacy-audit-v1\n${sort(records).map(value=>stable(stripChain(value))).join('\n')}`)}

export function verifyAuditChain(records:Array<AuditRecord|AuditRecordInput>):AuditIntegrityReport{
  const checkedAt=new Date().toISOString();if(!records.length)return{status:'empty',recordCount:0,legacyRecords:0,chainedRecords:0,checkedAt}
  const legacy=sort(records.filter(value=>!isChained(value)));const chained=records.filter(isChained).sort((a,b)=>a.sequence-b.sequence)
  if(!chained.length)return{status:'legacy_only',recordCount:records.length,legacyRecords:legacy.length,chainedRecords:0,checkedAt,reason:'Pre-chain audit records have not yet been anchored by a new append.'}
  let previous=legacy.length?legacyAuditAnchor(legacy):AUDIT_GENESIS_HASH;let expectedSequence=1
  for(const value of chained){if(value.sequence!==expectedSequence)return broken(records,legacy,chained,checkedAt,value.id,'Audit sequence is discontinuous.');if(value.previousHash!==previous)return broken(records,legacy,chained,checkedAt,value.id,'Audit previous-hash link does not match.');const expected=sealAuditRecord(stripChain(value),value.sequence,value.previousHash).recordHash;if(value.recordHash!==expected)return broken(records,legacy,chained,checkedAt,value.id,'Audit record content hash does not match.');previous=value.recordHash;expectedSequence+=1}
  return{status:'verified',recordCount:records.length,legacyRecords:legacy.length,chainedRecords:chained.length,checkedAt,headHash:previous}
}

export function isChained(value:AuditRecord|AuditRecordInput):value is AuditRecord{return(value as Partial<AuditRecord>).chainVersion===1&&Number.isInteger((value as Partial<AuditRecord>).sequence)&&typeof(value as Partial<AuditRecord>).previousHash==='string'&&typeof(value as Partial<AuditRecord>).recordHash==='string'}

function stripChain(value:AuditRecord|AuditRecordInput):AuditRecordInput{const{chainVersion:_chainVersion,sequence:_sequence,previousHash:_previousHash,recordHash:_recordHash,...input}=value as AuditRecord;return input}
function sort<T extends AuditRecord|AuditRecordInput>(records:T[]){return[...records].sort((a,b)=>Date.parse(a.occurredAt)-Date.parse(b.occurredAt)||a.id.localeCompare(b.id))}
function broken(records:Array<AuditRecord|AuditRecordInput>,legacy:AuditRecordInput[],chained:AuditRecord[],checkedAt:string,breakAtId:string|undefined,reason:string):AuditIntegrityReport{return{status:'broken',recordCount:records.length,legacyRecords:legacy.length,chainedRecords:chained.length,checkedAt,...(chained.at(-1)?.recordHash?{headHash:chained.at(-1)!.recordHash}:{}),...(breakAtId?{breakAtId}:{}),reason}}
function sha256(value:string){return createHash('sha256').update(value).digest('hex')}
function stable(value:unknown):string{return JSON.stringify(canonical(value))}
function canonical(value:unknown):unknown{if(Array.isArray(value))return value.map(canonical);if(value instanceof Date)return value.toISOString();if(Buffer.isBuffer(value))return canonical(value.toJSON());if(value&&typeof value==='object'){const candidate=value as Record<string,unknown>&{toJSON?:()=>unknown};if(typeof candidate.toJSON==='function')return canonical(candidate.toJSON());const result:Record<string,unknown>={};for(const key of Object.keys(candidate).sort()){const child=candidate[key];if(child!==undefined)result[key]=canonical(child)}return result}if(typeof value==='bigint')return value.toString();return value}
