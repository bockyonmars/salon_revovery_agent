import type { ApiRecoveryCase, ApiRevenueAttribution } from './operations-api'

export type VerifiedOpportunity = {
  id: string
  workflow: string
  openedAt: string
  client: string
  detail: string
  value: number
  currency?: string
  channel: 'Workflow'
  status: string
  tone: 'champagne' | 'success' | 'warning' | 'danger' | 'info'
  resolved: boolean
  evidence: 'verified_attribution' | 'case_record'
}

const workflowLabels: Record<ApiRecoveryCase['recoveryType'], string> = {
  waitlist_fill: 'Waitlist fill',
  no_show: 'No-show recovery',
  post_visit_rebook: 'Post-visit rebooking',
  lapsed_reactivation: 'Lapsed client reactivation',
}

export function mapRecoveryOpportunities(cases: ApiRecoveryCase[], attribution: ApiRevenueAttribution[]): VerifiedOpportunity[] {
  return [...cases]
    .sort((left, right) => Date.parse(right.openedAt) - Date.parse(left.openedAt))
    .map((recoveryCase) => {
      const record = matchAttribution(recoveryCase, attribution)
      const resolved = recoveryCase.status !== 'open'
      const amountMinor = record?.amountMinor ?? recoveryCase.potentialRevenueMinor ?? 0
      const status = recoveryCase.status === 'open'
        ? 'Recovery in progress'
        : record
          ? 'Revenue verified'
          : recoveryCase.status === 'resolved'
            ? 'Resolved · attribution pending'
            : 'Closed without recovery'

      return {
        id: recoveryCase.id,
        workflow: workflowLabels[recoveryCase.recoveryType],
        openedAt: recoveryCase.openedAt,
        client: `Recovery case ${recoveryCase.id.slice(0, 8)}`,
        detail: record ? `Verified booking ${record.bookingId.slice(0, 8)}` : `Workflow ${recoveryCase.workflowJobId.slice(0, 8)}`,
        value: amountMinor / 100,
        ...(record?.currency || recoveryCase.currency ? { currency: (record?.currency ?? recoveryCase.currency)?.toUpperCase() } : {}),
        channel: 'Workflow' as const,
        status,
        tone: record ? 'success' as const : recoveryCase.status === 'open' ? 'warning' as const : recoveryCase.status === 'resolved' ? 'champagne' as const : 'info' as const,
        resolved,
        evidence: record ? 'verified_attribution' as const : 'case_record' as const,
      }
    })
}

export function revenueTotalsByCurrency(records: ApiRevenueAttribution[]) {
  return records.reduce<Record<string, number>>((totals, record) => {
    const currency = record.currency.toUpperCase()
    totals[currency] = (totals[currency] ?? 0) + record.amountMinor
    return totals
  }, {})
}

export function opportunityTotalsByCurrency(opportunities: Array<{ value: number; currency?: string; resolved?: boolean }>, openOnly = false) {
  return opportunities.reduce<Record<string, number>>((totals, opportunity) => {
    if (openOnly && opportunity.resolved) return totals
    const currency = opportunity.currency?.toUpperCase()
    if (!currency) return totals
    totals[currency] = (totals[currency] ?? 0) + Math.round(opportunity.value * 100)
    return totals
  }, {})
}

export function formatMinorAmount(amountMinor: number, currency: string) {
  try {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency: currency.toUpperCase(), maximumFractionDigits: amountMinor % 100 === 0 ? 0 : 2 }).format(amountMinor / 100)
  } catch {
    return `${currency.toUpperCase()} ${(amountMinor / 100).toFixed(2)}`
  }
}

export function formatCurrencyTotals(totals: Record<string, number>, empty = 'No verified value') {
  const entries = Object.entries(totals).sort(([left], [right]) => left.localeCompare(right))
  if (!entries.length) return empty
  return entries.map(([currency, amountMinor]) => formatMinorAmount(amountMinor, currency)).join(' · ')
}

function matchAttribution(recoveryCase: ApiRecoveryCase, records: ApiRevenueAttribution[]) {
  if (recoveryCase.resultBookingId) {
    const bookingMatch = records.find((record) => record.bookingId === recoveryCase.resultBookingId)
    if (bookingMatch) return bookingMatch
  }
  return records.find((record) => record.recoveryCorrelationId === recoveryCase.correlationId)
    ?? records.find((record) => record.workflowJobId === recoveryCase.workflowJobId)
}
