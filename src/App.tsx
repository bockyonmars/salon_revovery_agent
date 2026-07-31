import {
  ArrowsCounterClockwise,
  ArrowsClockwise,
  Bell,
  BookOpen,
  Buildings,
  CalendarBlank,
  CalendarCheck,
  CalendarX,
  CaretDown,
  ChatTeardropText,
  Check,
  CheckCircle,
  Coins,
  ClipboardText,
  EnvelopeSimple,
  Funnel,
  Heartbeat,
  Handshake,
  LockSimple,
  Lightning,
  MagnifyingGlass,
  MapPin,
  MegaphoneSimple,
  PaperPlaneTilt,
  Plus,
  Plugs,
  Repeat,
  SealCheck,
  ShieldStar,
  SignOut,
  Sparkle,
  SquaresFour,
  TrendUp,
  UsersThree,
  WarningCircle,
  WhatsappLogo,
  X,
} from '@phosphor-icons/react'
import { FormEvent, lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { ApprovalsScreen } from './screens/ApprovalsScreen'
import { ConversationsScreen } from './screens/ConversationsScreen'
import { RecoveryQueueScreen } from './screens/RecoveryQueueScreen'
import { ClientsScreen, IntegrationsScreen, PoliciesScreen, RevenueLedgerScreen } from './screens/OperationsScreens'
import { ActivationScreen } from './screens/ActivationScreen'
import { activateOnboarding, decideApproval, hasOperationsSession, loadOnboarding, loadOperations, runOnboardingChecks, type ApiApprovalRequest, type ApiLocationSettings, type ApiOnboardingStatus, type ApiRevenueAttribution, type ApiTenantHealth } from './operations-api'
import { MarketingPage } from './MarketingPage'
import { OperationsAuthScreen, OperationsUnavailableScreen } from './OperationsAuthScreen'
import { beginOperationsSignIn, bootstrapOperationsAuth, endOperationsSession, subscribeOperationsAuth, type OperationsAuthSnapshot, type OperationsIdentity } from './operations-auth'
import { formatCurrencyTotals, formatMinorAmount, mapRecoveryOpportunities, opportunityTotalsByCurrency, revenueTotalsByCurrency } from './verified-operations'

const PortfolioScreen=lazy(()=>import('./screens/PortfolioScreen').then(module=>({default:module.PortfolioScreen})))
const AgencyAccessScreen=lazy(()=>import('./screens/AgencyAccessScreen').then(module=>({default:module.AgencyAccessScreen})))
const ExperimentsScreen=lazy(()=>import('./screens/ExperimentsScreen').then(module=>({default:module.ExperimentsScreen})))
const OwnerReviewScreen=lazy(()=>import('./screens/OwnerReviewScreen').then(module=>({default:module.OwnerReviewScreen})))
const WeeklyReportsScreen=lazy(()=>import('./screens/WeeklyReportsScreen').then(module=>({default:module.WeeklyReportsScreen})))

type Tone = 'champagne' | 'success' | 'warning' | 'danger' | 'info'
type QueueFilter = 'active' | 'resolved'

export type Opportunity = {
  id: number | string
  workflow: string
  timing: string
  client: string
  detail: string
  value: number
  currency?: string
  channel: string
  status: string
  tone: Tone
  resolved: boolean
  evidence?: 'verified_attribution' | 'case_record'
}

export type Approval = {
  id: number | string
  title: string
  detail: string
  reason: string
  risk: 'High' | 'Medium'
  amount?: number
  age?: string
  safety?: boolean
  policy?: string
  recommendation?: string
  source?: 'api' | 'demo'
}

export type ApprovalHistory = {
  id: number | string
  title: string
  decision: 'approved' | 'rejected'
  time: string
}

type Activity = {
  id: number | string
  icon: 'sent' | 'booked' | 'risk' | 'approved'
  text: string
  time: string
  tone: Tone
}

const navItems = [
  { label: 'Command Centre', icon: SquaresFour },
  { label: 'Recovery Queue', icon: ArrowsCounterClockwise },
  { label: 'Conversations', icon: ChatTeardropText },
  { label: 'Campaigns', icon: MegaphoneSimple },
  { label: 'Clients', icon: UsersThree },
  { label: 'Revenue Ledger', icon: Coins },
  { label: 'Weekly Reports', icon: EnvelopeSimple },
  { label: 'Portfolio', icon: Buildings },
]

const controlItems = [
  { label: 'Approvals', icon: SealCheck },
  { label: 'Integrations', icon: Plugs },
  { label: 'Policies', icon: BookOpen },
  { label: 'Owner Review', icon: ClipboardText },
  { label: 'Agency Access', icon: Handshake },
  { label: 'Activation', icon: Lightning },
]

// Sample workspace data for the interactive product prototype.
const initialOpportunities: Opportunity[] = [
  {
    id: 1,
    workflow: 'Abandoned booking',
    timing: '2 hours ago',
    client: 'Eleanor Vance',
    detail: 'Previous: Balayage and cut',
    value: 185,
    channel: 'WhatsApp',
    status: 'Follow-up sent',
    tone: 'warning',
    resolved: false,
  },
  {
    id: 2,
    workflow: 'Lapsed client',
    timing: '12 weeks since visit',
    client: 'Marcus Sterling',
    detail: 'High-value client',
    value: 65,
    channel: 'Email',
    status: 'Reactivating',
    tone: 'success',
    resolved: false,
  },
  {
    id: 3,
    workflow: 'Cancellation recovery',
    timing: 'Tomorrow at 14:00',
    client: 'Open two-hour slot',
    detail: 'Colour specialist available',
    value: 120,
    channel: 'Smart match',
    status: 'Offering to waitlist',
    tone: 'champagne',
    resolved: false,
  },
  {
    id: 4,
    workflow: 'Post-visit rebooking',
    timing: 'Resolved yesterday',
    client: 'Nia Okafor',
    detail: 'Six-week treatment interval',
    value: 95,
    channel: 'SMS',
    status: 'Booking recovered',
    tone: 'success',
    resolved: true,
  },
]

const initialApprovals: Approval[] = [
  {
    id: 1,
    title: 'Refund request',
    detail: 'Sarah Jenkins, £45 deposit',
    reason: 'Emergency cancellation. Policy exception required.',
    risk: 'High',
    amount: 45,
    age: '12 mins ago',
    policy: 'Deposits are non-refundable inside 24 hours unless an operator documents an exceptional circumstance.',
    recommendation: 'Approve a one-time deposit refund. The client has no previous exceptions and a strong attendance history.',
  },
  {
    id: 2,
    title: 'Offer exception',
    detail: '25% reactivation discount',
    reason: 'Discount exceeds the configured 15% limit.',
    risk: 'Medium',
    amount: 65,
    age: '45 mins ago',
    policy: 'Reactivation offers above 15% require approval and a value-at-risk review.',
    recommendation: 'Approve for this single appointment. The projected recovered margin remains above the configured floor.',
  },
  {
    id: 3,
    title: 'Complaint escalation',
    detail: 'Possible product reaction',
    reason: 'Client reported scalp irritation after a colour service and requested immediate guidance.',
    risk: 'High',
    amount: 0,
    age: '1 hour ago',
    safety: true,
    policy: 'Possible reactions must be escalated to the duty manager. Automated medical guidance and financial resolution are prohibited.',
  },
]

const initialActivity: Activity[] = [
  { id: 1, icon: 'sent', text: 'Agent sent a slot offer to Chloe Adams via SMS.', time: '12:42', tone: 'success' },
  { id: 2, icon: 'booked', text: 'Booking #8821 confirmed. Recovered value: £110.', time: '12:15', tone: 'champagne' },
  { id: 3, icon: 'risk', text: 'System identified two new no-show risks for tomorrow.', time: '11:58', tone: 'warning' },
]

const money = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 })

function formatOpportunityValue(item: Pick<Opportunity, 'value' | 'currency'>) {
  return item.currency ? formatMinorAmount(Math.round(item.value * 100), item.currency) : money.format(item.value)
}

function Brand() {
  return (
    <div className="brand" aria-label="Salon Recovery Agent">
      <span className="brand-mark"><ShieldStar weight="fill" aria-hidden="true" /></span>
      <span><strong>Salon</strong><small>Recovery Agent</small></span>
    </div>
  )
}

function Sidebar({ active, approvals, identity, locationName, onNavigate, onSignOut }: { active: string; approvals: number; identity: OperationsIdentity; locationName: string; onNavigate: (label: string) => void; onSignOut?: () => void }) {
  return (
    <aside className="sidebar">
      <Brand />
      <nav aria-label="Primary navigation">
        {navItems.map(({ label, icon: Icon }) => (
          <button key={label} className={active === label ? 'active' : ''} onClick={() => onNavigate(label)}>
            <Icon weight={active === label ? 'fill' : 'bold'} aria-hidden="true" />
            <span>{label}</span>
          </button>
        ))}
        <p className="nav-label">Controls</p>
        {controlItems.map(({ label, icon: Icon }) => (
          <button key={label} className={active === label ? 'active' : ''} onClick={() => onNavigate(label)}>
            <Icon weight={active === label ? 'fill' : 'bold'} aria-hidden="true" />
            <span>{label}</span>
            {label === 'Approvals' && approvals > 0 && <b className="nav-count">{approvals}</b>}
          </button>
        ))}
      </nav>
      <div className="operator">
        <span className="operator-avatar">{identity.initials}</span>
        <span><strong>{identity.displayName}</strong><small>{identity.email ?? locationName}</small></span>
        {onSignOut && <button className="operator-signout" type="button" onClick={onSignOut} aria-label="Sign out"><SignOut weight="bold" aria-hidden="true" /></button>}
      </div>
    </aside>
  )
}

function Topbar({ title, locationName, approvalCount, onNew, onApprovals, onRunChecks, checking }: { title: string; locationName: string; approvalCount: number; onNew: () => void; onApprovals: () => void; onRunChecks: () => void; checking: boolean }) {
  const [range, setRange] = useState('Last 30 days')
  return (
    <header className="topbar">
      <div className="mobile-brand"><Brand /></div>
      <div className="topbar-title">
        <h1>{title}</h1>
        <span className="topbar-divider" />
        <button className="location-button"><MapPin weight="fill" aria-hidden="true" /> {locationName} <CaretDown aria-hidden="true" /></button>
      </div>
      <div className="topbar-actions">
        {title !== 'Activation' && title !== 'Portfolio' && title !== 'Agency Access' && title !== 'Campaigns' && title !== 'Owner Review' && title !== 'Weekly Reports' && <label className="range-control">
          <CalendarBlank aria-hidden="true" />
          <span className="sr-only">Reporting period</span>
          <select value={range} onChange={(event) => setRange(event.target.value)}>
            <option>Last 7 days</option>
            <option>Last 30 days</option>
            <option>This quarter</option>
          </select>
        </label>}
        <button className="icon-button notification-button" aria-label={`${approvalCount} approvals need attention`} onClick={onApprovals}>
          <Bell weight="bold" aria-hidden="true" />
          {approvalCount > 0 && <span>{approvalCount}</span>}
        </button>
        {title === 'Activation' ? <button className="primary-button new-action" onClick={onRunChecks} disabled={checking}><ArrowsClockwise className={checking?'spinning':''} weight="bold" aria-hidden="true" /> {checking?'Running checks…':'Run checks'}</button> : title !== 'Portfolio' && title !== 'Agency Access' && title !== 'Campaigns' && title !== 'Owner Review' && title !== 'Weekly Reports' && <button className="primary-button new-action" onClick={onNew}><Plus weight="bold" aria-hidden="true" /> New recovery</button>}
      </div>
    </header>
  )
}

function MetricStrip({ attribution, live }: { attribution: ApiRevenueAttribution[]; live: boolean }) {
  if (live) {
    const totals = revenueTotalsByCurrency(attribution)
    const recovered = formatCurrencyTotals(totals)
    const workflows = new Set(attribution.map((record) => record.attributionType)).size
    return (
      <section className="metrics" aria-label="Verified revenue recovery summary">
        <article className="lead-metric">
          <div className="metric-label-row"><span className="metric-label">Verified recovered revenue</span><SealCheck aria-hidden="true" /></div>
          <strong>{recovered}</strong>
          <p><b>{attribution.length}</b> booking-level attribution {attribution.length === 1 ? 'record' : 'records'}</p>
          <div className="attribution"><Sparkle weight="fill" aria-hidden="true" /><span>Only provider-confirmed booking evidence is included</span></div>
        </article>
        <div className="supporting-metrics">
          <article><span className="metric-label">Bookings recovered</span><strong>{attribution.length}</strong><small className="success">Verified records</small></article>
          <article><span className="metric-label">Recovery workflows</span><strong>{workflows}</strong><small>With verified attribution</small></article>
          <article><span className="metric-label">Currencies</span><strong>{Object.keys(totals).length}</strong><small>No cross-currency summing</small></article>
          <article><span className="metric-label">Evidence standard</span><strong>100%</strong><small className="success">Booking-level</small></article>
        </div>
      </section>
    )
  }
  const metrics = [
    { label: 'Bookings recovered', value: '142', note: '+18 vs average', tone: 'success' },
    { label: 'Slots filled', value: '38', note: '94% match rate', tone: 'neutral' },
    { label: 'Rebooking rate', value: '68.2%', note: 'Within target', tone: 'warning' },
    { label: 'No-shows prevented', value: '£4.2k', note: '12 appointments', tone: 'neutral' },
  ]
  return (
    <section className="metrics" aria-label="Revenue recovery summary">
      <article className="lead-metric">
        <div className="metric-label-row"><span className="metric-label">Recovered revenue</span><TrendUp aria-hidden="true" /></div>
        <strong>£42,890</strong>
        <p><b>+12.4%</b> compared with the previous period</p>
        <div className="attribution"><Sparkle weight="fill" aria-hidden="true" /><span>87% has verified booking attribution</span></div>
      </article>
      <div className="supporting-metrics">
        {metrics.map((metric) => (
          <article key={metric.label}>
            <span className="metric-label">{metric.label}</span>
            <strong>{metric.value}</strong>
            <small className={metric.tone}>{metric.note}</small>
          </article>
        ))}
      </div>
    </section>
  )
}

function WorkflowIcon({ workflow }: { workflow: string }) {
  if (workflow.toLowerCase().includes('abandoned')) return <CalendarX weight="bold" aria-hidden="true" />
  if (workflow.toLowerCase().includes('lapsed')) return <Repeat weight="bold" aria-hidden="true" />
  if (workflow.toLowerCase().includes('cancellation')) return <Sparkle weight="fill" aria-hidden="true" />
  return <CalendarCheck weight="bold" aria-hidden="true" />
}

function ChannelIcon({ channel }: { channel: string }) {
  if (channel === 'WhatsApp') return <WhatsappLogo weight="bold" aria-hidden="true" />
  if (channel === 'Email') return <EnvelopeSimple weight="bold" aria-hidden="true" />
  if (channel === 'Smart match') return <Sparkle weight="fill" aria-hidden="true" />
  return <ChatTeardropText weight="bold" aria-hidden="true" />
}

function RecoveryQueue({ items, filter, onFilter, onReview }: { items: Opportunity[]; filter: QueueFilter; onFilter: (filter: QueueFilter) => void; onReview: (item: Opportunity) => void }) {
  const visibleItems = items.filter((item) => item.resolved === (filter === 'resolved'))
  return (
    <section className="recovery-section">
      <div className="section-header">
        <div><h2>Recovery opportunity queue</h2><p>Prioritised by value, timing, and client fit.</p></div>
        <div className="queue-controls">
          <div className="segmented" aria-label="Queue status">
            <button className={filter === 'active' ? 'selected' : ''} onClick={() => onFilter('active')}>Active</button>
            <button className={filter === 'resolved' ? 'selected' : ''} onClick={() => onFilter('resolved')}>Resolved</button>
          </div>
          <button className="text-button"><Funnel weight="bold" aria-hidden="true" /> Filter</button>
        </div>
      </div>
      <div className="queue-panel">
        <div className="queue-head" aria-hidden="true"><span>Workflow</span><span>Client context</span><span>Opportunity</span><span>Status</span><span /></div>
        <div className="queue-list">
          {visibleItems.map((item) => (
            <article className="queue-row" key={item.id}>
              <div className="workflow-cell">
                <span className={`queue-icon ${item.tone}`}><WorkflowIcon workflow={item.workflow} /></span>
                <span><strong>{item.workflow}</strong><small>{item.timing}</small></span>
              </div>
              <div><strong>{item.client}</strong><small>{item.detail}</small></div>
              <div className="opportunity-cell"><strong>{formatOpportunityValue(item)}</strong><small><ChannelIcon channel={item.channel} />{item.channel}</small></div>
              <div><span className={`status-badge ${item.tone}`}>{item.status}</span></div>
              <button className="secondary-button compact" onClick={() => onReview(item)}>{item.resolved ? 'Inspect' : 'Review'}</button>
            </article>
          ))}
          {visibleItems.length === 0 && <div className="queue-empty"><CheckCircle weight="duotone" /><strong>Queue is clear</strong><p>No opportunities match this view.</p></div>}
        </div>
        <button className="queue-footer">View all {items.length} opportunities</button>
      </div>
    </section>
  )
}

function ApprovalDesk({ approvals, onDecision, onViewAll }: { approvals: Approval[]; onDecision: (approval: Approval, decision: 'approved' | 'rejected') => void; onViewAll: () => void }) {
  return (
    <section className="approval-section">
      <div className="section-header compact-header"><div><h2>Approval desk</h2><p>Human decisions only.</p></div>{approvals.length > 0 && <b className="urgent-count">{approvals.length} urgent</b>}</div>
      <div className="approval-stack">
        {approvals.slice(0, 2).map((approval, index) => (
          <article className="approval-card" key={approval.id}>
            <div className="approval-title"><span><strong>{approval.title}</strong><small>{approval.detail}</small></span><LockSimple weight="bold" aria-label="Locked pending approval" /></div>
            <p>{approval.reason}</p>
            {index === 0 ? (
              <div className="approval-actions"><button className="primary-button" onClick={() => onDecision(approval, 'approved')}>Approve</button><button className="secondary-button" onClick={() => onDecision(approval, 'rejected')}>Reject</button></div>
            ) : (
              <div className="risk-row"><span>Risk: {approval.risk}</span><button className="text-button" onClick={onViewAll}>Review details</button></div>
            )}
          </article>
        ))}
        {approvals.length === 0 && <div className="all-clear"><CheckCircle weight="fill" /><span><strong>No approvals waiting</strong><small>Automated workflows are within policy.</small></span></div>}
      </div>
    </section>
  )
}

function SystemHealth({ health, onOpen }: { health?: ApiTenantHealth; onOpen: () => void }) {
  const fallback = [
    { label: 'Square bookings sync', value: 'Active', tone: 'success' },
    { label: 'Twilio messaging', value: 'Stable', tone: 'success' },
    { label: 'Recovery workflows', value: 'Healthy', tone: 'success' },
  ]
  const items = health ? [...health.checks].sort((a, b) => healthRank(a.status) - healthRank(b.status)).slice(0, 3).map((item) => ({ label: item.label, value: item.status === 'ready' ? 'Ready' : item.status === 'warning' ? 'Review' : 'Blocked', tone: item.status === 'ready' ? 'success' : 'warning' })) : fallback
  return (
    <section className="health-section">
      <div className="section-header compact-header"><div><h2>System health</h2><p>{health ? `Live check · ${health.summary.blocked} blocked` : 'Last checked four minutes ago.'}</p></div><Heartbeat weight="duotone" /></div>
      <div className="health-panel">
        {items.map((item) => <div key={item.label}><span>{item.tone === 'success' ? <CheckCircle weight="fill" /> : <WarningCircle weight="fill" />}{item.label}</span><strong className={item.tone}>{item.value}</strong></div>)}
        <button className="text-button" onClick={onOpen}>Open operations monitor</button>
      </div>
    </section>
  )
}

function healthRank(status: 'ready' | 'warning' | 'blocked') { return status === 'blocked' ? 0 : status === 'warning' ? 1 : 2 }

function toApproval(record: ApiApprovalRequest): Approval {
  const title = record.requestType === 'integration_reconnect' ? 'Integration reconnect' : record.requestType === 'report_delivery' ? 'Report delivery' : record.requestType === 'service_recovery' ? 'Service recovery' : 'Workflow recovery'
  const detail = approvalDetail(record)
  const safety = record.requestType === 'integration_reconnect' || record.requestType === 'service_recovery'
  return {
    id: record.id,
    title,
    detail,
    reason: record.reason,
    risk: safety ? 'High' : 'Medium',
    age: relativeTime(record.createdAt),
    safety,
    policy: record.requestType === 'service_recovery' ? 'Medical, legal, refund, and explicit human requests must remain outside autonomous handling.' : safety ? 'Provider authorization must be restored before affected automated actions can continue.' : 'Failed automated actions remain closed until a manager explicitly authorizes a deterministic replay.',
    recommendation: record.requestType === 'service_recovery' ? 'Review the conversation and respond personally without admitting liability, diagnosing a condition, or promising a refund.' : record.entityType === 'workflow_job' ? 'Approve only after the underlying configuration or provider incident has been corrected. Approval returns this exact job to the durable queue.' : 'Review the provider connection and reconnect through the verified OAuth flow.',
    source: 'api',
  }
}

function approvalDetail(record: ApiApprovalRequest) {
  const workflow = typeof record.payload.workflowType === 'string' ? record.payload.workflowType.replaceAll('_', ' ') : undefined
  if (workflow) return workflow.replace(/^./, (letter) => letter.toUpperCase())
  if (record.requestType === 'integration_reconnect') return 'Square authorization required'
  if (record.requestType === 'report_delivery') return 'Weekly revenue report paused'
  if (record.requestType === 'service_recovery') return 'Customer conversation requires human review'
  return `${record.entityType.replaceAll('_', ' ')} ${record.entityId.slice(0, 8)}`
}

function relativeTime(value: string) {
  const elapsed = Math.max(0, Date.now() - Date.parse(value))
  if (elapsed < 60_000) return 'Just now'
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)} mins ago`
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)} hours ago`
  return `${Math.floor(elapsed / 86_400_000)} days ago`
}

function toAttributionActivity(record: ApiRevenueAttribution): Activity {
  return {
    id: record.id,
    icon: 'booked',
    text: `${record.attributionType.replaceAll('_', ' ')} verified for booking ${record.bookingId.slice(0, 8)}. Recovered value: ${formatMinorAmount(record.amountMinor, record.currency)}.`,
    time: relativeTime(record.verifiedAt),
    tone: 'success',
  }
}

function ActivityFeed({ items }: { items: Activity[] }) {
  const icons = { sent: PaperPlaneTilt, booked: CalendarCheck, risk: MagnifyingGlass, approved: Check }
  return (
    <section className="activity-section">
      <div className="section-header compact-header"><div><h2>Recent automated activity</h2><p>Verified events from connected systems.</p></div><button className="text-button">Full activity log</button></div>
      <div className="activity-panel">
        {items.map((item) => {
          const Icon = icons[item.icon]
          return <article key={item.id}><span className={`activity-icon ${item.tone}`}><Icon weight="bold" /></span><p>{item.text}</p><time>{item.time}</time></article>
        })}
      </div>
    </section>
  )
}

function EmptyWorkspace({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <div className="empty-workspace">
      <span><ArrowsCounterClockwise weight="duotone" /></span>
      <h2>{title}</h2>
      <p>This prototype establishes the command-centre foundation. The {title.toLowerCase()} workflow is ready for the next build pass.</p>
      <button className="primary-button" onClick={onBack}>Return to command centre</button>
    </div>
  )
}

function ScreenLoading({title}:{title:string}){return <div className="empty-workspace"><span><ArrowsClockwise className="spinning" weight="duotone"/></span><h2>Loading {title}</h2><p>Reading the authoritative operating evidence for this view.</p></div>}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <header><div><span>Recovery workflow</span><h2 id="modal-title">{title}</h2></div><button className="icon-button" onClick={onClose} aria-label="Close dialog"><X weight="bold" /></button></header>
        {children}
      </section>
    </div>
  )
}

function OperationsApp() {
  const [authState, setAuthState] = useState<OperationsAuthSnapshot>({ status: 'loading', message: 'Checking your operations session' })
  const [authBusy, setAuthBusy] = useState(false)
  const [operationsLoadState, setOperationsLoadState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [operationsReload, setOperationsReload] = useState(0)
  const [activeView, setActiveView] = useState('Command Centre')
  const [opportunities, setOpportunities] = useState(initialOpportunities)
  const [approvals, setApprovals] = useState(initialApprovals)
  const [approvalHistory, setApprovalHistory] = useState<ApprovalHistory[]>([])
  const [activities, setActivities] = useState(initialActivity)
  const [filter, setFilter] = useState<QueueFilter>('active')
  const [selectedOpportunity, setSelectedOpportunity] = useState<Opportunity | null>(null)
  const [showNewAction, setShowNewAction] = useState(false)
  const [toast, setToast] = useState('')
  const [preferredConversationClient, setPreferredConversationClient] = useState<string>()
  const [tenantHealth, setTenantHealth] = useState<ApiTenantHealth>()
  const [onboardingStatus, setOnboardingStatus] = useState<ApiOnboardingStatus>()
  const [onboardingAction, setOnboardingAction] = useState<'checking' | 'activating'>()
  const [liveOperations, setLiveOperations] = useState(false)
  const [attribution, setAttribution] = useState<ApiRevenueAttribution[]>([])
  const [locationSettings, setLocationSettings] = useState<ApiLocationSettings | null>()

  useEffect(() => {
    let active = true
    const unsubscribe = subscribeOperationsAuth((value) => { if (active) setAuthState(value) })
    bootstrapOperationsAuth().then((value) => { if (active) setAuthState(value) })
    return () => { active = false; unsubscribe() }
  }, [])

  useEffect(() => {
    if (authState.status !== 'authenticated') return
    let active = true
    setLiveOperations(false)
    setOperationsLoadState('loading')
    loadOperations().then(({ approvals: records, health, onboarding, recoveryCases, attribution: attributionRecords, settings }) => {
      if (!active) return
      setApprovals(records.filter((item) => item.status === 'pending').map(toApproval))
      setApprovalHistory(records.filter((item) => item.status !== 'pending').map((item) => ({ id: item.id, title: approvalDetail(item), decision: item.status as 'approved' | 'rejected', time: relativeTime(item.decidedAt ?? item.createdAt) })))
      setTenantHealth(health)
      setOnboardingStatus(onboarding)
      setOpportunities(mapRecoveryOpportunities(recoveryCases, attributionRecords).map((item) => ({ ...item, timing: relativeTime(item.openedAt) })))
      setAttribution(attributionRecords)
      setActivities([...attributionRecords].sort((left, right) => Date.parse(right.verifiedAt) - Date.parse(left.verifiedAt)).slice(0, 12).map(toAttributionActivity))
      setLocationSettings(settings)
      setLiveOperations(true)
      setOperationsLoadState('ready')
    }).catch((error) => {
      if (!active) return
      if (import.meta.env.PROD) setOperationsLoadState('error')
      else { console.warn('Operations API unavailable; retaining the development sample workspace.', error); setOperationsLoadState('ready') }
    })
    return () => { active = false }
  }, [authState.status, operationsReload])

  const openValue = useMemo(() => liveOperations
    ? formatCurrencyTotals(opportunityTotalsByCurrency(opportunities, true), 'No recorded value')
    : money.format(opportunities.filter((item) => !item.resolved).reduce((sum, item) => sum + item.value, 0)), [liveOperations, opportunities])

  function notify(message: string) {
    setToast(message)
    window.setTimeout(() => setToast(''), 3000)
  }

  async function signIn() {
    setAuthBusy(true)
    try { await beginOperationsSignIn() }
    catch (error) { setAuthState({ status: 'error', message: error instanceof Error ? error.message : 'Secure sign-in could not be started.' }); setAuthBusy(false) }
  }

  async function signOut() {
    setAuthBusy(true)
    try { await endOperationsSession() }
    finally { setAuthBusy(false) }
  }

  async function runActivationChecks() {
    if (!hasOperationsSession()) { notify('Connect a dashboard API session before running production checks.'); return }
    setOnboardingAction('checking')
    try {
      const run = await runOnboardingChecks()
      const latest = await loadOnboarding()
      setOnboardingStatus(latest)
      setTenantHealth(latest.health)
      notify(run.status === 'passed' ? 'All critical activation checks passed.' : `${run.checks.filter((check) => check.status === 'failed').length} activation checks need attention.`)
    } catch (error) { notify(error instanceof Error ? error.message : 'Activation checks could not be completed.') }
    finally { setOnboardingAction(undefined) }
  }

  async function activateProduction() {
    if (!hasOperationsSession()) { notify('Connect a dashboard API session before activating production.'); return }
    setOnboardingAction('activating')
    try {
      const result = await activateOnboarding()
      const latest = await loadOnboarding()
      setOnboardingStatus(latest)
      setTenantHealth(latest.health)
      notify(result.resumedWorkflows ? `Production activated; ${result.resumedWorkflows} paused workflows resumed.` : 'Production automation activated.')
    } catch (error) { notify(error instanceof Error ? error.message : 'Production activation could not be completed.') }
    finally { setOnboardingAction(undefined) }
  }

  async function handleDecision(approval: Approval, decision: 'approved' | 'rejected') {
    if (approval.source === 'api') {
      try {
        const result = await decideApproval(String(approval.id), decision)
        const latest = await loadOperations()
        setTenantHealth(latest.health)
        setOnboardingStatus(latest.onboarding)
        notify(result.replayed ? `${approval.title} approved and safely returned to the workflow queue.` : `${approval.title} ${decision}.`)
      } catch (error) {
        notify(error instanceof Error ? error.message : 'The approval decision could not be completed.')
        return
      }
    } else notify(`${approval.title} ${decision}.`)
    setApprovals((current) => current.filter((item) => item.id !== approval.id))
    setApprovalHistory((current) => [{ id: Date.now(), title: approval.detail, decision, time: 'Now' }, ...current])
    setActivities((current) => [{ id: Date.now(), icon: 'approved', text: `${approval.title} ${decision} by Julian de Villiers.`, time: 'Now', tone: decision === 'approved' ? 'success' : 'danger' }, ...current])
  }

  function pauseOpportunity(item: Opportunity) {
    if (liveOperations) { notify('Pausing a verified recovery case requires a dedicated audited API action.'); return }
    setOpportunities((current) => current.map((opportunity) => opportunity.id === item.id ? { ...opportunity, status: 'Paused by operator', tone: 'warning' } : opportunity))
    setActivities((current) => [{ id: Date.now(), icon: 'risk', text: `${item.workflow} paused for ${item.client} by Julian de Villiers.`, time: 'Now', tone: 'warning' }, ...current])
    notify('Recovery workflow paused.')
  }

  function openConversation(client: string) {
    setPreferredConversationClient(client)
    setActiveView('Conversations')
  }

  function recoverOpportunity(item: Opportunity) {
    if (liveOperations) { notify('Recovery status is derived from provider-confirmed workflow evidence and cannot be changed here.'); return }
    setOpportunities((current) => current.map((opportunity) => opportunity.id === item.id ? { ...opportunity, resolved: true, status: 'Booking recovered', tone: 'success' } : opportunity))
    setActivities((current) => [{ id: Date.now(), icon: 'booked', text: `${item.workflow} resolved for ${item.client}. Recovered value: ${money.format(item.value)}.`, time: 'Now', tone: 'success' }, ...current])
    setSelectedOpportunity(null)
    notify('Opportunity marked as recovered.')
  }

  function createRecovery(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (liveOperations) { setShowNewAction(false); notify('Manual production recoveries require an evidence-backed workflow endpoint.'); return }
    const form = new FormData(event.currentTarget)
    const newItem: Opportunity = {
      id: Date.now(),
      workflow: String(form.get('workflow')),
      timing: 'Created just now',
      client: String(form.get('client')),
      detail: 'Manual recovery action',
      value: Number(form.get('value')) || 0,
      channel: String(form.get('channel')),
      status: 'Ready to contact',
      tone: 'info',
      resolved: false,
    }
    setOpportunities((current) => [newItem, ...current])
    setFilter('active')
    setShowNewAction(false)
    notify('Recovery action created.')
  }

  if (authState.status !== 'authenticated' && authState.status !== 'demo') return <OperationsAuthScreen state={authState} busy={authBusy} onSignIn={signIn} />
  if (authState.status === 'authenticated' && (operationsLoadState === 'idle' || operationsLoadState === 'loading')) return <OperationsAuthScreen state={{ status: 'loading', message: 'Loading verified salon operations' }} busy onSignIn={signIn} />
  if (authState.status === 'authenticated' && operationsLoadState === 'error') return <OperationsUnavailableScreen onRetry={() => setOperationsReload((value) => value + 1)} onSignOut={signOut} />
  const identity = authState.status === 'authenticated' ? authState.identity : { displayName: 'Julian de Villiers', initials: 'JD' }
  const locationName = locationSettings?.salonName ?? (liveOperations ? 'Salon location' : 'Mayfair Flagship')

  return (
    <div className="app-shell">
      <Sidebar active={activeView} approvals={approvals.length} identity={identity} locationName={locationName} onNavigate={setActiveView} {...(authState.status === 'authenticated' && !authState.development ? { onSignOut: signOut } : {})} />
      <main className="main-region">
        <Topbar title={activeView} locationName={locationName} approvalCount={approvals.length} onNew={() => liveOperations ? notify('Manual production recoveries require an evidence-backed workflow endpoint.') : setShowNewAction(true)} onApprovals={() => setActiveView('Approvals')} onRunChecks={runActivationChecks} checking={onboardingAction==='checking'} />
        <div className="mobile-route-strip" aria-label="Mobile navigation">
          {[...navItems, ...controlItems].map(({ label }) => <button key={label} className={activeView === label ? 'active' : ''} onClick={() => setActiveView(label)}>{label}</button>)}
        </div>
        {activeView === 'Command Centre' ? (
          <div className="page">
            <section className="page-intro"><div><span className="demo-label">{liveOperations ? 'Verified live operations' : 'Sample workspace'}</span><h2>Revenue recovery, under control.</h2><p>See what the agent recovered, what needs a decision, and where the next opportunity sits.</p></div><div className="open-value"><span>Open opportunity</span><strong>{openValue}</strong></div></section>
            <MetricStrip attribution={attribution} live={liveOperations} />
            <div className="operations-grid">
              <RecoveryQueue items={opportunities} filter={filter} onFilter={setFilter} onReview={setSelectedOpportunity} />
              <aside className="operations-aside"><ApprovalDesk approvals={approvals} onDecision={handleDecision} onViewAll={() => setActiveView('Approvals')} /><SystemHealth health={tenantHealth} onOpen={() => setActiveView('Integrations')} /></aside>
            </div>
            <ActivityFeed items={activities} />
          </div>
        ) : activeView === 'Recovery Queue' ? (
          <RecoveryQueueScreen items={opportunities} live={liveOperations} onNew={() => liveOperations ? notify('Manual production recoveries require an evidence-backed workflow endpoint.') : setShowNewAction(true)} onOpenConversation={openConversation} onPause={pauseOpportunity} onResolve={recoverOpportunity} />
        ) : activeView === 'Conversations' ? (
          <ConversationsScreen liveMode={liveOperations} preferredClient={preferredConversationClient} onOpenApproval={() => setActiveView('Approvals')} onNotify={notify} />
        ) : activeView === 'Campaigns' ? (
          <Suspense fallback={<ScreenLoading title="controlled experiments"/>}><ExperimentsScreen liveMode={liveOperations} onNotify={notify} /></Suspense>
        ) : activeView === 'Clients' ? (
          <ClientsScreen liveMode={liveOperations} onOpenConversation={openConversation} />
        ) : activeView === 'Revenue Ledger' ? (
          <RevenueLedgerScreen liveMode={liveOperations} onNotify={notify} />
        ) : activeView === 'Weekly Reports' ? (
          <Suspense fallback={<ScreenLoading title="weekly revenue reports"/>}><WeeklyReportsScreen liveMode={liveOperations} onNotify={notify} onNavigate={setActiveView} /></Suspense>
        ) : activeView === 'Portfolio' ? (
          <Suspense fallback={<ScreenLoading title="owner portfolio"/>}><PortfolioScreen liveMode={liveOperations} onNotify={notify} /></Suspense>
        ) : activeView === 'Agency Access' ? (
          <Suspense fallback={<ScreenLoading title="agency access"/>}><AgencyAccessScreen liveMode={liveOperations} onNotify={notify} /></Suspense>
        ) : activeView === 'Approvals' ? (
          <ApprovalsScreen approvals={approvals} history={approvalHistory} onDecision={handleDecision} onRequestInfo={(approval) => notify(`More information requested for ${approval.detail}.`)} />
        ) : activeView === 'Integrations' ? (
          <IntegrationsScreen liveMode={liveOperations} onNotify={notify} />
        ) : activeView === 'Policies' ? (
          <PoliciesScreen liveMode={liveOperations} onNotify={notify} />
        ) : activeView === 'Owner Review' ? (
          <Suspense fallback={<ScreenLoading title="monthly owner review"/>}><OwnerReviewScreen liveMode={liveOperations} onNotify={notify} onNavigate={setActiveView} /></Suspense>
        ) : activeView === 'Activation' ? (
          <ActivationScreen status={onboardingStatus} action={onboardingAction} liveMode={liveOperations} onRunChecks={runActivationChecks} onActivate={activateProduction} onNavigate={setActiveView} onNotify={notify} />
        ) : (
          <EmptyWorkspace title={activeView} onBack={() => setActiveView('Command Centre')} />
        )}
      </main>

      {showNewAction && (
        <Modal title="New recovery action" onClose={() => setShowNewAction(false)}>
          <form className="recovery-form" onSubmit={createRecovery}>
            <label><span>Workflow</span><select name="workflow" required><option>Abandoned booking</option><option>Cancellation recovery</option><option>Lapsed client</option><option>Post-visit rebooking</option></select></label>
            <label><span>Client or slot</span><input name="client" placeholder="Client name or open slot" required /></label>
            <div className="form-row"><label><span>Opportunity value</span><input name="value" type="number" min="0" step="1" placeholder="120" required /></label><label><span>Channel</span><select name="channel"><option>WhatsApp</option><option>SMS</option><option>Email</option><option>Smart match</option></select></label></div>
            <p className="form-note"><LockSimple weight="bold" /> The agent will validate consent and policy before contacting anyone.</p>
            <footer><button type="button" className="secondary-button" onClick={() => setShowNewAction(false)}>Cancel</button><button type="submit" className="primary-button">Create action</button></footer>
          </form>
        </Modal>
      )}

      {selectedOpportunity && (
        <Modal title={selectedOpportunity.workflow} onClose={() => setSelectedOpportunity(null)}>
          <div className="review-detail">
            <div className="review-value"><span>{selectedOpportunity.evidence === 'verified_attribution' ? 'Verified recovered revenue' : 'Recorded potential revenue'}</span><strong>{formatOpportunityValue(selectedOpportunity)}</strong></div>
            <dl><div><dt>Client context</dt><dd>{selectedOpportunity.client}</dd></div><div><dt>Channel</dt><dd>{selectedOpportunity.channel}</dd></div><div><dt>Current status</dt><dd>{selectedOpportunity.status}</dd></div></dl>
            <div className="policy-check"><CheckCircle weight="fill" /><span><strong>{liveOperations ? 'Evidence boundary enforced' : 'Policy checks passed'}</strong><small>{liveOperations ? 'Status and value come from the authoritative workflow and booking-attribution records.' : 'Consent, contact frequency, and current booking state are valid.'}</small></span></div>
            <footer><button className="secondary-button" onClick={() => setSelectedOpportunity(null)}>Close</button>{!liveOperations && !selectedOpportunity.resolved && <button className="primary-button" onClick={() => recoverOpportunity(selectedOpportunity)}>Mark recovered</button>}</footer>
          </div>
        </Modal>
      )}

      {toast && <div className="toast" role="status"><CheckCircle weight="fill" />{toast}</div>}
    </div>
  )
}

export function App(){
  const pathname=window.location.pathname.replace(/\/+$/,'')||'/'
  if(pathname==='/app'||pathname.startsWith('/app/'))return <OperationsApp/>
  const locationMatch=pathname.match(/^\/for\/([a-z0-9]+(?:-[a-z0-9]+)*)$/)
  const locationSlug=locationMatch?.[1]
  const locationLabel=locationSlug?.split('-').map(value=>value.charAt(0).toUpperCase()+value.slice(1)).join(' ')
  return <MarketingPage {...(locationSlug?{locationSlug,locationLabel}:{})}/>
}
