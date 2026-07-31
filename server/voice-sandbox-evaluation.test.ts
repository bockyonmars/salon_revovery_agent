import { describe,expect,it } from 'vitest'
import type { MessagingReliabilityEvaluation,RealtimeVoiceCall,VoiceReadinessDeclaration } from './domain/schemas.js'
import { createHash } from 'node:crypto'
import { evaluateVoiceSandbox,parseVoiceSandboxConfig,prepareVoiceReleaseEvidencePayload,type VoiceSandboxConfig } from './release/voice-sandbox.js'

const now='2026-07-22T10:00:00.000Z'
const callId='rtc_controlled_123'
const config:VoiceSandboxConfig={databaseUrl:'postgres://sandbox',tenantId:'tenant-one',locationId:'location-one',callId,expectedModel:'gpt-realtime-2.1',maximumAgeMinutes:30,evidenceOutput:'release-evidence/voice-sandbox-20260722.json'}

describe('voice sandbox release evidence',()=>{
  it('passes only the bounded live control signals and emits a redacted evidence report',()=>{
    const report=evaluateVoiceSandbox(config,{call:controlledCall(),declaration:readiness(),evaluation:reliability()},new Date(now));expect(report).toMatchObject({status:'passed',policyVersion:'voice-realtime-sandbox-v1',model:'gpt-realtime-2.1',containsPhoneNumbers:false,containsAudioOrTranscripts:false,checks:expect.arrayContaining([{id:'ai_disclosure',status:'passed',detail:expect.any(String)},{id:'silence_handling',status:'passed',detail:expect.any(String)},{id:'human_transfer',status:'passed',detail:expect.any(String)}])});expect(report.referenceHash).toMatch(/^[a-f0-9]{64}$/);expect(JSON.stringify(report)).not.toContain(callId);expect(JSON.stringify(report)).not.toContain('+2348012345678')
  })

  it('fails closed for missing silence evidence, sideband failure, stale calls, model drift, or expired readiness',()=>{
    const base=controlledCall();const cases=[
      {...base,signals:{...base.signals,wait_tool_observed:undefined}},
      {...base,signals:{...base.signals,sideband_failed:now}},
      {...base,updatedAt:'2026-07-22T09:00:00.000Z'},
      {...base,model:'gpt-realtime-unreviewed'},
    ]
    for(const call of cases)expect(evaluateVoiceSandbox(config,{call,declaration:readiness(),evaluation:reliability()},new Date(now)).status).toBe('failed')
    expect(evaluateVoiceSandbox(config,{call:base,declaration:{...readiness(),expiresAt:now},evaluation:reliability()},new Date(now)).checks.find(value=>value.id==='readiness_gate')?.status).toBe('failed')
  })

  it('requires explicit non-production authorization and a write-once evidence path',()=>{
    const valid={NODE_ENV:'test',VOICE_SANDBOX_ALLOW_EVALUATION:'true',OPENAI_REALTIME_SIP_ENABLED:'true',DATABASE_URL:'postgres://sandbox',VOICE_SANDBOX_TENANT_ID:'tenant-one',VOICE_SANDBOX_LOCATION_ID:'location-one',VOICE_SANDBOX_CALL_ID:callId,OPENAI_REALTIME_MODEL:'gpt-realtime-2.1',VOICE_SANDBOX_EVIDENCE_OUTPUT:'release-evidence/voice-sandbox-20260722.json'}
    expect(parseVoiceSandboxConfig(valid)).toEqual(config)
    for(const env of[{...valid,NODE_ENV:'production'},{...valid,VOICE_SANDBOX_ALLOW_EVALUATION:'false'},{...valid,OPENAI_REALTIME_SIP_ENABLED:'false'},{...valid,VOICE_SANDBOX_EVIDENCE_OUTPUT:'../voice.json'}])expect(()=>parseVoiceSandboxConfig(env)).toThrow('Voice sandbox evaluation configuration is incomplete or unsafe')
  })

  it('prepares a digest-bound release payload only after all machine and human checks pass',()=>{
    const reportText=`${JSON.stringify(evaluateVoiceSandbox(config,{call:controlledCall(),declaration:readiness(),evaluation:reliability()},new Date(now)),null,2)}\n`;const observations={aiDisclosureAudible:true,transferCompleted:true,silenceBehaviorAcceptable:true,interruptionBehaviorAcceptable:true} as const;const payload=prepareVoiceReleaseEvidencePayload(reportText,observations);expect(payload).toMatchObject({policyVersion:'voice-realtime-sandbox-v1',model:config.expectedModel,sandboxCompletedAt:now,machineChecks:{callRecency:true,sidebandConnection:true,humanTransfer:true},humanObservations:observations});expect(payload.reportDigest).toBe(createHash('sha256').update(reportText).digest('hex'));const failed=JSON.stringify({...JSON.parse(reportText),status:'failed'});expect(()=>prepareVoiceReleaseEvidencePayload(failed,observations)).toThrow('VOICE_SANDBOX_REPORT_NOT_RELEASABLE');expect(()=>prepareVoiceReleaseEvidencePayload(reportText,{...observations,aiDisclosureAudible:false} as never)).toThrow()
  })
})

function controlledCall():RealtimeVoiceCall{return{callId,tenantId:config.tenantId,locationId:config.locationId,providerEventId:'evt_controlled_123',status:'transferred',readiness:'accepted',model:config.expectedModel,signals:{sideband_connected:'2026-07-22T09:55:00.000Z',disclosure_requested:'2026-07-22T09:55:01.000Z',wait_tool_observed:'2026-07-22T09:55:15.000Z',transfer_requested:'2026-07-22T09:55:25.000Z',transfer_completed:'2026-07-22T09:55:26.000Z'},createdAt:'2026-07-22T09:54:59.000Z',updatedAt:'2026-07-22T09:55:26.000Z'}}
function readiness():VoiceReadinessDeclaration{return{id:'voice-readiness-one',tenantId:config.tenantId,locationId:config.locationId,policyVersion:'voice-readiness-v1',status:'attested',messagingReliabilityEvaluationId:'reliability-one',jurisdictionCode:'NG-LA',aiDisclosureVersion:'voice-ai-v1',retentionPolicyVersion:'voice-retention-v1',recordingMode:'disabled',transferMode:'human',transferTo:'+2348012345678',controls:{aiParticipationDisclosureReviewed:true,recordingStorageDisabled:true,immediateTransferTested:true,jurisdictionRetentionReviewed:true},createdBy:'owner-one',createdAt:'2026-07-22T09:00:00.000Z',expiresAt:'2026-10-20T09:00:00.000Z'}}
function reliability():MessagingReliabilityEvaluation{return{id:'reliability-one',tenantId:config.tenantId,locationId:config.locationId,policyVersion:'voice-prerequisite-v1',channel:'sms',status:'passed',voiceBuildAllowed:true,windowFrom:'2026-06-22T09:00:00.000Z',windowTo:'2026-07-22T09:00:00.000Z',expiresAt:'2026-07-23T09:00:00.000Z',thresholds:{minimumTerminalMessages:100,minimumDeliveryRate:.98,maximumUncertainSends:0,maximumStaleNonTerminal:0,maximumPendingDeliveryIncidents:0,reconciliationMaximumAgeHours:24},metrics:{terminalMessages:100,deliveredMessages:99,failedMessages:1,deliveryRate:.99,uncertainSends:0,staleNonTerminal:0,pendingDeliveryIncidents:0,twilioCircuitState:'closed',twilioReconciliationState:'clean'},checks:[],createdBy:'manager-one',createdAt:'2026-07-22T09:00:00.000Z'}}
