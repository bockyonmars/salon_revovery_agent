export const voiceMachineCheckKeys = [
  'callRecency',
  'modelPin',
  'readinessGate',
  'recordingDisabled',
  'sidebandConnection',
  'aiDisclosure',
  'silenceHandling',
  'humanTransfer',
  'sidebandHealth',
] as const

export const voiceHumanObservationKeys = [
  'aiDisclosureAudible',
  'transferCompleted',
  'silenceBehaviorAcceptable',
  'interruptionBehaviorAcceptable',
] as const

export type VoiceReleaseEvidenceInput = {
  policyVersion: 'voice-realtime-sandbox-v1'
  model: string
  referenceHash: string
  reportDigest: string
  sandboxCompletedAt: string
  containsPhoneNumbers: false
  containsAudioOrTranscripts: false
  machineChecks: Record<(typeof voiceMachineCheckKeys)[number], true>
  humanObservations: Record<(typeof voiceHumanObservationKeys)[number], true>
}

const topLevelKeys = [
  'policyVersion',
  'model',
  'referenceHash',
  'reportDigest',
  'sandboxCompletedAt',
  'containsPhoneNumbers',
  'containsAudioOrTranscripts',
  'machineChecks',
  'humanObservations',
] as const
const modelPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{1,63}$/
const sha256Pattern = /^[a-f0-9]{64}$/
const dateTimePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/

export function parseVoiceReleaseEvidencePayload(text: string): VoiceReleaseEvidenceInput {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('Evidence must be a valid JSON file.')
  }
  const value = requireExactObject(parsed, topLevelKeys, 'Evidence')
  if (value.policyVersion !== 'voice-realtime-sandbox-v1') throw new Error('Evidence uses an unsupported policy version.')
  if (typeof value.model !== 'string' || !modelPattern.test(value.model)) throw new Error('Evidence must name a valid pinned Realtime model.')
  if (typeof value.referenceHash !== 'string' || !sha256Pattern.test(value.referenceHash)) throw new Error('Evidence reference hash must be a lowercase SHA-256 digest.')
  if (typeof value.reportDigest !== 'string' || !sha256Pattern.test(value.reportDigest)) throw new Error('Evidence report digest must be a lowercase SHA-256 digest.')
  if (typeof value.sandboxCompletedAt !== 'string' || !dateTimePattern.test(value.sandboxCompletedAt) || !Number.isFinite(Date.parse(value.sandboxCompletedAt))) throw new Error('Evidence must include a valid sandbox completion time.')
  if (value.containsPhoneNumbers !== false || value.containsAudioOrTranscripts !== false) throw new Error('Evidence must contain references and checks only; sensitive call content is not accepted.')
  const machineChecks = requireTrueRecord(value.machineChecks, voiceMachineCheckKeys, 'Machine checks')
  const humanObservations = requireTrueRecord(value.humanObservations, voiceHumanObservationKeys, 'Human observations')
  return {
    policyVersion: value.policyVersion,
    model: value.model,
    referenceHash: value.referenceHash,
    reportDigest: value.reportDigest,
    sandboxCompletedAt: value.sandboxCompletedAt,
    containsPhoneNumbers: false,
    containsAudioOrTranscripts: false,
    machineChecks,
    humanObservations,
  }
}

function requireExactObject<const Keys extends readonly string[]>(value: unknown, keys: Keys, label: string): Record<Keys[number], unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be a JSON object.`)
  const actual = Object.keys(value)
  if (actual.length !== keys.length || actual.some(key => !keys.includes(key))) throw new Error(`${label} has missing or unsupported fields.`)
  return value as Record<Keys[number], unknown>
}

function requireTrueRecord<const Keys extends readonly string[]>(value: unknown, keys: Keys, label: string): Record<Keys[number], true> {
  const record = requireExactObject(value, keys, label)
  if (keys.some(key => record[key as Keys[number]] !== true)) throw new Error(`${label} must confirm every required item.`)
  return record as Record<Keys[number], true>
}
