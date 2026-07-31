import { createHash } from 'node:crypto'
import { Pool } from 'pg'
import { VoiceReleaseEvidenceInputSchema, type MessagingReliabilityEvaluation, type RealtimeVoiceCall, type VoiceReadinessDeclaration, type VoiceReleaseEvidenceInput } from '../domain/schemas.js'

export type VoiceSandboxStatus='passed'|'failed'
export type VoiceSandboxCheck={id:'call_recency'|'model_pin'|'readiness_gate'|'recording_disabled'|'sideband_connection'|'ai_disclosure'|'silence_handling'|'human_transfer'|'sideband_health';status:VoiceSandboxStatus;detail:string}
export type VoiceSandboxReport={status:VoiceSandboxStatus;policyVersion:'voice-realtime-sandbox-v1';model:string;referenceHash:string;containsPhoneNumbers:false;containsAudioOrTranscripts:false;startedAt:string;completedAt:string;checks:VoiceSandboxCheck[]}
export type VoiceSandboxConfig={databaseUrl:string;tenantId:string;locationId:string;callId:string;expectedModel:string;maximumAgeMinutes:number;evidenceOutput:string}
export type VoiceSandboxSource={call?:RealtimeVoiceCall;declaration?:VoiceReadinessDeclaration;evaluation?:MessagingReliabilityEvaluation}
export type VoiceSandboxHumanObservations=VoiceReleaseEvidenceInput['humanObservations']

export class VoiceSandboxConfigurationError extends Error{
  constructor(readonly issues:string[]){super('Voice sandbox evaluation configuration is incomplete or unsafe');this.name='VoiceSandboxConfigurationError'}
}

export function parseVoiceSandboxConfig(env:NodeJS.ProcessEnv):VoiceSandboxConfig{
  const issues:string[]=[];const required=(name:string)=>{const value=env[name]?.trim();if(!value)issues.push(`${name} is required`);return value??''}
  if(env.NODE_ENV==='production')issues.push('NODE_ENV must not be production for voice sandbox evaluation')
  if(env.VOICE_SANDBOX_ALLOW_EVALUATION!=='true')issues.push('VOICE_SANDBOX_ALLOW_EVALUATION must be true')
  if(env.OPENAI_REALTIME_SIP_ENABLED!=='true')issues.push('OPENAI_REALTIME_SIP_ENABLED must be true in the controlled sandbox environment')
  const databaseUrl=required('DATABASE_URL');const tenantId=required('VOICE_SANDBOX_TENANT_ID');const locationId=required('VOICE_SANDBOX_LOCATION_ID');const callId=required('VOICE_SANDBOX_CALL_ID');const expectedModel=required('OPENAI_REALTIME_MODEL');const evidenceOutput=required('VOICE_SANDBOX_EVIDENCE_OUTPUT')
  if(callId&&!/^[A-Za-z0-9][A-Za-z0-9_.:-]{2,254}$/.test(callId))issues.push('VOICE_SANDBOX_CALL_ID has an invalid format')
  if(expectedModel&&!/^[A-Za-z0-9][A-Za-z0-9._-]{2,79}$/.test(expectedModel))issues.push('OPENAI_REALTIME_MODEL has an invalid format')
  if(evidenceOutput&&!/^release-evidence\/[A-Za-z0-9][A-Za-z0-9._-]{2,119}\.json$/.test(evidenceOutput))issues.push('VOICE_SANDBOX_EVIDENCE_OUTPUT must be a JSON file directly inside release-evidence/')
  const maximumAgeMinutes=parseInteger(env.VOICE_SANDBOX_MAX_AGE_MINUTES??'30','VOICE_SANDBOX_MAX_AGE_MINUTES',issues,5,240)
  if(issues.length)throw new VoiceSandboxConfigurationError([...new Set(issues)])
  return{databaseUrl,tenantId,locationId,callId,expectedModel,maximumAgeMinutes,evidenceOutput}
}

export async function runVoiceSandboxEvaluation(config:VoiceSandboxConfig,now=()=>new Date()):Promise<VoiceSandboxReport>{
  const pool=new Pool({connectionString:config.databaseUrl,connectionTimeoutMillis:8_000,statement_timeout:8_000,max:1})
  try{
    const[callResult,declarationResult,evaluationResult]=await Promise.all([
      pool.query<{record:RealtimeVoiceCall}>('SELECT record FROM realtime_voice_calls WHERE call_id=$1 AND tenant_id=$2 AND location_id=$3',[config.callId,config.tenantId,config.locationId]),
      pool.query<{record:VoiceReadinessDeclaration}>('SELECT record FROM voice_readiness_declarations WHERE tenant_id=$1 AND location_id=$2 ORDER BY created_at DESC LIMIT 1',[config.tenantId,config.locationId]),
      pool.query<{record:MessagingReliabilityEvaluation}>('SELECT record FROM messaging_reliability_evaluations WHERE tenant_id=$1 AND location_id=$2 ORDER BY created_at DESC LIMIT 1',[config.tenantId,config.locationId]),
    ])
    return evaluateVoiceSandbox(config,{call:callResult.rows[0]?.record,declaration:declarationResult.rows[0]?.record,evaluation:evaluationResult.rows[0]?.record},now())
  }finally{await pool.end()}
}

export function evaluateVoiceSandbox(config:VoiceSandboxConfig,source:VoiceSandboxSource,completedAt:Date):VoiceSandboxReport{
  const startedAt=completedAt.toISOString();const call=source.call;const declaration=source.declaration;const evaluation=source.evaluation;const current=completedAt.getTime();const callAt=call?Date.parse(call.updatedAt):Number.NaN
  const scoped=Boolean(call&&call.tenantId===config.tenantId&&call.locationId===config.locationId);const recent=Boolean(scoped&&Number.isFinite(callAt)&&callAt<=current&&callAt>=current-config.maximumAgeMinutes*60_000)
  const readinessCurrent=Boolean(call?.readiness==='accepted'&&declaration&&declaration.policyVersion==='voice-readiness-v1'&&declaration.status==='attested'&&declaration.recordingMode==='disabled'&&declaration.transferMode==='human'&&declaration.controls.aiParticipationDisclosureReviewed&&declaration.controls.recordingStorageDisabled&&declaration.controls.immediateTransferTested&&declaration.controls.jurisdictionRetentionReviewed&&Date.parse(declaration.createdAt)<=current&&Date.parse(declaration.expiresAt)>current&&evaluation&&declaration.messagingReliabilityEvaluationId===evaluation.id&&evaluation.status==='passed'&&evaluation.voiceBuildAllowed&&Date.parse(evaluation.createdAt)<=current&&Date.parse(evaluation.expiresAt)>current)
  const signalAt=(name:keyof NonNullable<RealtimeVoiceCall['signals']>)=>{const value=call?.signals?.[name];const parsed=value?Date.parse(value):Number.NaN;return Number.isFinite(parsed)&&parsed<=current?parsed:undefined};const sidebandAt=signalAt('sideband_connected');const disclosureAt=signalAt('disclosure_requested');const waitAt=signalAt('wait_tool_observed');const transferRequestedAt=signalAt('transfer_requested');const transferCompletedAt=signalAt('transfer_completed')
  const sideband=sidebandAt!==undefined;const disclosure=Boolean(sidebandAt!==undefined&&disclosureAt!==undefined&&sidebandAt<=disclosureAt);const silence=Boolean(disclosureAt!==undefined&&waitAt!==undefined&&disclosureAt<=waitAt);const transfer=Boolean(call?.status==='transferred'&&waitAt!==undefined&&transferRequestedAt!==undefined&&transferCompletedAt!==undefined&&waitAt<=transferRequestedAt&&transferRequestedAt<=transferCompletedAt)
  const checks:VoiceSandboxCheck[]=[
    check('call_recency',recent,'The controlled call completed within the bounded evidence window.','No recent tenant-scoped controlled call evidence was found.'),
    check('model_pin',Boolean(call&&call.model===config.expectedModel),`The call used the pinned Realtime model ${config.expectedModel}.`,'The controlled call did not use the expected pinned Realtime model.'),
    check('readiness_gate',readinessCurrent,'Current messaging reliability and owner voice-readiness gates were present.','Current messaging reliability and voice-readiness evidence was missing or invalid.'),
    check('recording_disabled',Boolean(declaration?.recordingMode==='disabled'&&declaration.controls.recordingStorageDisabled),'Recording and recording storage remained disabled.','The required non-recording control was not present.'),
    check('sideband_connection',sideband,'The server-side call-control channel connected.','The server-side call-control channel was not observed.'),
    check('ai_disclosure',disclosure,'The required AI and non-recording disclosure response was requested.','The required disclosure response was not observed in sequence.'),
    check('silence_handling',silence,'The bounded silence/background-audio tool was observed.','The silence handling tool was not observed in sequence during the controlled call.'),
    check('human_transfer',transfer,'A human transfer was requested and relayed by the provider.','A completed human transfer was not observed.'),
    check('sideband_health',Boolean(call&&signalAt('sideband_failed')===undefined),'No sideband transport failure was observed.','A sideband transport failure occurred during the controlled call.'),
  ]
  return{status:checks.every(value=>value.status==='passed')?'passed':'failed',policyVersion:'voice-realtime-sandbox-v1',model:config.expectedModel,referenceHash:createHash('sha256').update(`${config.tenantId}:${config.locationId}:${config.callId}`).digest('hex'),containsPhoneNumbers:false,containsAudioOrTranscripts:false,startedAt,completedAt:completedAt.toISOString(),checks}
}

export function prepareVoiceReleaseEvidencePayload(reportText:string,humanObservations:VoiceSandboxHumanObservations):VoiceReleaseEvidenceInput{
  let value:unknown;try{value=JSON.parse(reportText)}catch{throw new Error('VOICE_SANDBOX_REPORT_INVALID')}
  if(typeof value!=='object'||value===null)throw new Error('VOICE_SANDBOX_REPORT_INVALID')
  const report=value as Partial<VoiceSandboxReport>;const required:VoiceSandboxCheck['id'][]=['call_recency','model_pin','readiness_gate','recording_disabled','sideband_connection','ai_disclosure','silence_handling','human_transfer','sideband_health'];const checks=Array.isArray(report.checks)?report.checks:[]
  if(report.status!=='passed'||report.policyVersion!=='voice-realtime-sandbox-v1'||report.containsPhoneNumbers!==false||report.containsAudioOrTranscripts!==false||checks.length!==required.length||!required.every(id=>checks.filter(check=>check?.id===id&&check.status==='passed').length===1))throw new Error('VOICE_SANDBOX_REPORT_NOT_RELEASABLE')
  const passed=(id:VoiceSandboxCheck['id'])=>checks.some(check=>check.id===id&&check.status==='passed')
  return VoiceReleaseEvidenceInputSchema.parse({policyVersion:report.policyVersion,model:report.model,referenceHash:report.referenceHash,reportDigest:createHash('sha256').update(reportText).digest('hex'),sandboxCompletedAt:report.completedAt,containsPhoneNumbers:false,containsAudioOrTranscripts:false,machineChecks:{callRecency:passed('call_recency'),modelPin:passed('model_pin'),readinessGate:passed('readiness_gate'),recordingDisabled:passed('recording_disabled'),sidebandConnection:passed('sideband_connection'),aiDisclosure:passed('ai_disclosure'),silenceHandling:passed('silence_handling'),humanTransfer:passed('human_transfer'),sidebandHealth:passed('sideband_health')},humanObservations})
}

function check(id:VoiceSandboxCheck['id'],passed:boolean,success:string,failure:string):VoiceSandboxCheck{return{id,status:passed?'passed':'failed',detail:passed?success:failure}}
function parseInteger(raw:string,name:string,issues:string[],minimum:number,maximum:number){const value=Number(raw);if(!Number.isSafeInteger(value)||value<minimum||value>maximum){issues.push(`${name} must be an integer from ${minimum} to ${maximum}`);return minimum}return value}
