import { describe, expect, it } from 'vitest'
import { parseVoiceReleaseEvidencePayload } from '../src/voice-release-evidence.js'

describe('voice release evidence file validation', () => {
  it('accepts the exact reference-only release payload', () => {
    expect(parseVoiceReleaseEvidencePayload(JSON.stringify(validPayload()))).toEqual(validPayload())
  })

  it('rejects missing, extra, false, or malformed evidence fields', () => {
    const { reportDigest: _missing, ...missing } = validPayload()
    expect(() => parseVoiceReleaseEvidencePayload(JSON.stringify(missing))).toThrow('missing or unsupported fields')
    expect(() => parseVoiceReleaseEvidencePayload(JSON.stringify({ ...validPayload(), destination: 'unsupported' }))).toThrow('missing or unsupported fields')
    expect(() => parseVoiceReleaseEvidencePayload(JSON.stringify({ ...validPayload(), humanObservations: { ...validPayload().humanObservations, transferCompleted: false } }))).toThrow('confirm every required item')
    expect(() => parseVoiceReleaseEvidencePayload(JSON.stringify({ ...validPayload(), referenceHash: 'ABC123' }))).toThrow('lowercase SHA-256')
  })

  it('rejects sensitive call-content declarations and invalid JSON', () => {
    expect(() => parseVoiceReleaseEvidencePayload('{not-json')).toThrow('valid JSON')
    expect(() => parseVoiceReleaseEvidencePayload(JSON.stringify({ ...validPayload(), containsAudioOrTranscripts: true }))).toThrow('sensitive call content')
  })
})

function validPayload() {
  return {
    policyVersion: 'voice-realtime-sandbox-v1' as const,
    model: 'gpt-realtime-2.1',
    referenceHash: 'a'.repeat(64),
    reportDigest: 'b'.repeat(64),
    sandboxCompletedAt: '2026-07-22T12:00:00.000Z',
    containsPhoneNumbers: false as const,
    containsAudioOrTranscripts: false as const,
    machineChecks: { callRecency: true as const, modelPin: true as const, readinessGate: true as const, recordingDisabled: true as const, sidebandConnection: true as const, aiDisclosure: true as const, silenceHandling: true as const, humanTransfer: true as const, sidebandHealth: true as const },
    humanObservations: { aiDisclosureAudible: true as const, transferCompleted: true as const, silenceBehaviorAcceptable: true as const, interruptionBehaviorAcceptable: true as const },
  }
}
