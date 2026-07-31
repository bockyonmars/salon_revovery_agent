import { randomUUID } from 'node:crypto'
import type { TenantContext, WeeklyReportSnapshot, WorkflowJob } from '../domain/schemas.js'
import type { ReportEmailProvider } from '../integrations/postmark-email.js'
import type { Store } from '../repositories/store.js'
import { RevenueReportService } from './revenue-report-service.js'
import { PermanentWorkflowError } from './workflow-engine.js'
import type { ProviderCircuitBreakerService } from './provider-circuit-breaker-service.js'

const WEEK = 7 * 86_400_000

export class WeeklyReportWorkflowService {
  constructor(private readonly store: Store, private readonly reports: RevenueReportService, private readonly email?: ReportEmailProvider,private readonly providerCircuits?:ProviderCircuitBreakerService) {}

  async execute(job: WorkflowJob) {
    const context: TenantContext = { tenantId: job.tenantId, locationId: job.locationId, userId: 'workflow:weekly_roi_report', role: 'service' }
    const settings = await this.store.getLocationSettings(context)
    if (!settings?.reportRecipientEmail) throw new PermanentWorkflowError('Weekly report recipient is not configured in location settings')
    const periodTo = new Date(job.runAt).toISOString()
    const periodFrom = new Date(Date.parse(periodTo) - WEEK).toISOString()
    const report = await this.reports.weekly(context, periodFrom, periodTo)
    const base: WeeklyReportSnapshot = { id: randomUUID(), tenantId: job.tenantId, locationId: job.locationId, periodFrom, periodTo, report, status: 'generated', recipientEmail: settings.reportRecipientEmail, createdAt: new Date().toISOString() }
    await this.store.saveWeeklyReport(base)
    if (!this.email) throw new PermanentWorkflowError('Postmark report delivery is not configured')
    try {
      const send=()=>this.email!.send({ to: settings.reportRecipientEmail!, subject: `${settings.salonName} — weekly recovered revenue`, textBody: formatReport(settings.salonName, report) });if(this.providerCircuits)await this.providerCircuits.execute(context,'postmark','weekly-report.send',send);else await send()
      await this.store.saveWeeklyReport({ ...base, status: 'delivered', deliveredAt: new Date().toISOString() })
    } catch (error) {
      await this.store.saveWeeklyReport({ ...base, status: 'delivery_failed' })
      throw error
    }
    await this.store.enqueueWorkflowJob(nextJob(job))
  }
}

function nextJob(previous: WorkflowJob): WorkflowJob {
  const now = new Date().toISOString()
  const runAt = new Date(Date.parse(previous.runAt) + WEEK).toISOString()
  return { id: randomUUID(), tenantId: previous.tenantId, locationId: previous.locationId, workflowType: 'weekly_roi_report', correlationId: previous.correlationId, causationEventId: previous.id, dedupeKey: `${previous.tenantId}:${previous.locationId}:weekly_roi_report:${runAt}`, runAt, status: 'pending', attempts: 0, maxAttempts: 5, payload: {}, createdAt: now, updatedAt: now }
}

function formatReport(salonName: string, report: Awaited<ReturnType<RevenueReportService['weekly']>>) {
  const revenue = Object.entries(report.observed.verifiedRecoveredRevenueMinorByCurrency).map(([currency, amount]) => `${currency} ${(amount / 100).toFixed(2)}`).join(', ') || 'None verified'
  const sources=Object.entries(report.observed.recoveredBookingsBySource).map(([source,count])=>`${source}: ${count}`).join(', ')||'None'
  return `${salonName}\nWeekly recovered-revenue report\n\nPeriod: ${report.period.from} to ${report.period.to}\nVerified recovered revenue: ${revenue}\nRecovered bookings: ${report.observed.recoveredBookings}\nRecovered bookings by source: ${sources}\nRecovery cases opened: ${report.observed.recoveryCasesOpened}\nResolved: ${report.observed.recoveryCasesResolved}\nClosed without recovery: ${report.observed.recoveryCasesClosed}\nStill open: ${report.observed.recoveryCasesStillOpen}\nReview requests sent: ${report.observed.reviewRequestsSent}\nReview requests closed by policy: ${report.observed.reviewRequestsClosed}\nNegative review feedback escalated: ${report.observed.negativeReviewFeedback}\n\nAttribution method: verified booking, one eligible sent recovery touch. Estimated and unattributed revenue are excluded.`
}
