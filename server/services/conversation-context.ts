import type { BookingRecord, ClientProfile, ConsentRecord, Conversation, ConversationAction, ServiceRecord, StaffRecord } from '../domain/schemas.js'

export type VerifiedConversationContext = {
  client: { profileAvailable: boolean; timezone?: string }
  consent: Array<{ channel: ConsentRecord['channel']; purpose: ConsentRecord['purpose']; status: ConsentRecord['status'] }>
  upcomingAppointments: Array<{ startsAt: string; serviceName?: string; staffName?: string; priceMinor: number; currency: string; provider: BookingRecord['provider']; state: 'recorded_upcoming' }>
  activeAction?: { actionType: ConversationAction['actionType']; status: ConversationAction['status']; expiresAt?: string }
  factualSummary: string
}

export function buildVerifiedConversationContext(input: {
  conversation: Conversation
  profile?: ClientProfile
  consents: ConsentRecord[]
  bookings: BookingRecord[]
  services: ServiceRecord[]
  staff: StaffRecord[]
  activeAction?: ConversationAction
  now?: number
}): VerifiedConversationContext {
  const { conversation } = input
  const inScope = <T extends { tenantId: string; locationId: string }>(value: T) => value.tenantId === conversation.tenantId && value.locationId === conversation.locationId
  const profile = input.profile && inScope(input.profile) && input.profile.clientId === conversation.clientId ? input.profile : undefined
  const timezone = profile && safeTimezone(profile.timezone) ? profile.timezone : undefined
  const consent = input.consents
    .filter(value => inScope(value) && value.clientId === conversation.clientId)
    .map(value => ({ channel: value.channel, purpose: value.purpose, status: value.status }))
    .sort((left, right) => `${left.channel}:${left.purpose}`.localeCompare(`${right.channel}:${right.purpose}`))
  const services = new Map(input.services.filter(inScope).map(value => [value.id, value.name]))
  const staff = new Map(input.staff.filter(inScope).map(value => [value.id, value.name]))
  const upcomingAppointments = input.bookings
    .filter(value => inScope(value) && value.clientId === conversation.clientId && Date.parse(value.startsAt) > (input.now ?? Date.now()) && !String(value.providerStatus ?? '').startsWith('CANCELLED'))
    .sort((left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt))
    .slice(0, 3)
    .map(value => ({ startsAt: value.startsAt, ...(services.get(value.serviceId) ? { serviceName: services.get(value.serviceId) } : {}), ...(staff.get(value.staffId) ? { staffName: staff.get(value.staffId) } : {}), priceMinor: value.priceMinor, currency: value.currency, provider: value.provider, state: 'recorded_upcoming' as const }))
  const activeAction = input.activeAction && inScope(input.activeAction) && input.activeAction.conversationId === conversation.id && ['prepared', 'awaiting_confirmation'].includes(input.activeAction.status)
    ? { actionType: input.activeAction.actionType, status: input.activeAction.status, ...(input.activeAction.expiresAt ? { expiresAt: input.activeAction.expiresAt } : {}) }
    : undefined
  const factualSummary = [
    `Conversation state is ${conversation.status}; latest verified intent is ${conversation.intent}.`,
    timezone ? `Client timezone is ${timezone}.` : 'Client timezone is not verified.',
    `${consent.length} channel-purpose consent record${consent.length === 1 ? '' : 's'} available.`,
    `${upcomingAppointments.length} upcoming appointment record${upcomingAppointments.length === 1 ? '' : 's'} available.`,
    activeAction ? `A ${activeAction.actionType} action is ${activeAction.status}.` : 'No appointment action is awaiting confirmation.',
  ].join(' ')
  return { client: { profileAvailable: Boolean(profile), ...(timezone ? { timezone } : {}) }, consent, upcomingAppointments, ...(activeAction ? { activeAction } : {}), factualSummary }
}

function safeTimezone(value: string) {
  try { new Intl.DateTimeFormat('en', { timeZone: value }).format(); return true } catch { return false }
}
