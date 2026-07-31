import { describe, expect, it } from 'vitest'
import type { ApiRecoveryCase, ApiRevenueAttribution } from '../src/operations-api'
import { formatCurrencyTotals, mapRecoveryOpportunities, opportunityTotalsByCurrency, revenueTotalsByCurrency } from '../src/verified-operations'

const recoveryCase: ApiRecoveryCase = {
  id: 'case-12345678',
  recoveryType: 'lapsed_reactivation',
  correlationId: 'recovery-correlation',
  workflowJobId: 'workflow-12345678',
  status: 'resolved',
  potentialRevenueMinor: 12000,
  currency: 'gbp',
  openedAt: '2026-07-19T10:00:00.000Z',
  resolvedAt: '2026-07-20T10:00:00.000Z',
  resultBookingId: 'booking-12345678',
}

const attribution: ApiRevenueAttribution = {
  id: 'attribution-1',
  bookingId: 'booking-12345678',
  sourceId: 'touch-1',
  workflowJobId: 'workflow-12345678',
  recoveryCorrelationId: 'recovery-correlation',
  amountMinor: 14550,
  currency: 'gbp',
  attributionType: 'lapsed_reactivation',
  evidence: 'sent_recovery_before_booking',
  touchAt: '2026-07-19T12:00:00.000Z',
  verifiedAt: '2026-07-20T10:00:00.000Z',
}

describe('verified operations dashboard mappings', () => {
  it('uses booking attribution instead of an estimated case value when evidence matches', () => {
    const [opportunity] = mapRecoveryOpportunities([recoveryCase], [attribution])
    expect(opportunity).toMatchObject({
      id: recoveryCase.id,
      client: 'Recovery case case-123',
      detail: 'Verified booking booking-',
      value: 145.5,
      currency: 'GBP',
      status: 'Revenue verified',
      resolved: true,
      evidence: 'verified_attribution',
    })
  })

  it('shows an authoritative case record without claiming verified revenue', () => {
    const [opportunity] = mapRecoveryOpportunities([{ ...recoveryCase, status: 'open', resultBookingId: undefined }], [])
    expect(opportunity).toMatchObject({
      value: 120,
      status: 'Recovery in progress',
      resolved: false,
      evidence: 'case_record',
    })
    expect(opportunity?.detail).toBe('Workflow workflow')
  })

  it('keeps recovered revenue separated by currency', () => {
    const records = [attribution, { ...attribution, id: 'attribution-2', bookingId: 'booking-2', amountMinor: 10000, currency: 'USD' }]
    expect(revenueTotalsByCurrency(records)).toEqual({ GBP: 14550, USD: 10000 })
    expect(formatCurrencyTotals(revenueTotalsByCurrency(records))).toContain(' · ')
  })

  it('omits unknown-currency case values from monetary totals', () => {
    expect(opportunityTotalsByCurrency([
      { value: 50, currency: 'GBP', resolved: false },
      { value: 999, resolved: false },
      { value: 25, currency: 'GBP', resolved: true },
    ], true)).toEqual({ GBP: 5000 })
  })
})
