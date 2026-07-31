import {
  ArrowsClockwise,
  ChatTeardropText,
  CheckCircle,
  Coins,
  GearSix,
  MagnifyingGlass,
  MegaphoneSimple,
  SealCheck,
  ShieldCheck,
  UsersThree,
  WarningCircle,
} from '@phosphor-icons/react'
import { useEffect, useState, type FormEvent } from 'react'
import {
  loadClients,
  loadLocationSettings,
  loadProviderCircuits,
  loadRevenueAttribution,
  loadTenantHealth,
  saveLocationSettings,
  type ApiClientProfile,
  type ApiLocationSettings,
  type ApiProviderCircuit,
  type ApiRevenueAttribution,
  type ApiTenantHealth,
} from '../operations-api'
import { formatCurrencyTotals, formatMinorAmount, revenueTotalsByCurrency } from '../verified-operations'

type LoadState = 'idle' | 'loading' | 'ready' | 'error'

const demoClients: ApiClientProfile[] = [
  { clientId: 'demo-eleanor', displayName: 'Eleanor Vance', contactTo: '+440000000001', timezone: 'Europe/London', lastVisitAt: '2026-01-12T10:00:00.000Z', updatedAt: '2026-07-01T10:00:00.000Z' },
  { clientId: 'demo-marcus', displayName: 'Marcus Sterling', contactTo: '+440000000002', timezone: 'Europe/London', lastVisitAt: '2026-04-20T10:00:00.000Z', updatedAt: '2026-07-01T10:00:00.000Z' },
  { clientId: 'demo-chloe', displayName: 'Chloe Adams', contactTo: '+440000000003', timezone: 'Europe/London', lastVisitAt: '2026-07-02T10:00:00.000Z', updatedAt: '2026-07-02T10:00:00.000Z' },
]

export function ClientsScreen({ liveMode, onOpenConversation }: { liveMode: boolean; onOpenConversation: (client: string) => void }) {
  const [clients, setClients] = useState<ApiClientProfile[]>(liveMode ? [] : demoClients)
  const [state, setState] = useState<LoadState>(liveMode ? 'loading' : 'idle')
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState(liveMode ? '' : demoClients[0]!.clientId)

  useEffect(() => {
    if (!liveMode) return
    let active = true
    setClients([]); setState('loading'); setError('')
    loadClients().then(({ clients: records }) => { if (active) { setClients(records); setSelectedId(records[0]?.clientId ?? ''); setState('ready') } })
      .catch((reason) => { if (active) { setError(message(reason)); setState('error') } })
    return () => { active = false }
  }, [liveMode])

  if (liveMode && state !== 'ready') return <DataBoundary state={state} error={error} icon="clients" label="client profiles" />
  const filtered = clients.filter((client) => `${client.displayName ?? ''} ${client.clientId}`.toLowerCase().includes(search.toLowerCase()))
  const selected = clients.find((client) => client.clientId === selectedId) ?? clients[0]
  if (!selected) return <EmptyPanel title="No verified client profiles" detail="Client profiles will appear after the connected booking provider has synchronized authoritative customer records." />

  const name = selected.displayName ?? `Client ${selected.clientId.slice(0, 8)}`
  return <div className="client-ops-workspace"><aside className="client-master"><div><span className="demo-label">{liveMode ? 'Verified client directory' : 'Client intelligence'}</span><h2>Client profiles</h2><label className="search-control"><MagnifyingGlass /><input aria-label="Search clients" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search clients" /></label></div><div className="client-segments"><button className="selected">All <b>{clients.length}</b></button></div><div className="client-list">{filtered.map((client) => { const clientName = client.displayName ?? `Client ${client.clientId.slice(0, 8)}`; return <button key={client.clientId} className={selected.clientId === client.clientId ? 'selected' : ''} onClick={() => setSelectedId(client.clientId)}><span className="client-avatar">{initials(clientName)}</span><span><strong>{clientName}</strong><small>{client.clientId}</small></span></button> })}</div></aside><section className="client-profile"><header><span className="client-avatar large">{initials(name)}</span><div><span className="demo-label">{liveMode ? 'Authoritative profile' : 'Sample client'}</span><h2>{name}</h2><p>Only synchronized profile fields are displayed.</p></div><button className="primary-button" onClick={() => onOpenConversation(name)}><ChatTeardropText /> Open conversation</button></header><div className="profile-metrics"><article><span>Last visit</span><strong>{selected.lastVisitAt ? formatDate(selected.lastVisitAt) : 'Not recorded'}</strong></article><article><span>Timezone</span><strong>{selected.timezone}</strong></article><article><span>Rebook interval</span><strong>{selected.recommendedRebookDays ? `${selected.recommendedRebookDays} days` : 'Not recorded'}</strong></article></div><div className="ops-two-column"><section className="ops-panel profile-detail"><h3>Contact profile</h3><dl><div><dt>Client ID</dt><dd>{selected.clientId}</dd></div><div><dt>Contact</dt><dd>{maskContact(selected.contactTo)}</dd></div></dl></section><section className="ops-panel profile-detail"><h3>Provider evidence</h3><dl><div><dt>Provider customer</dt><dd>{selected.providerCustomerId ?? 'Not linked'}</dd></div><div><dt>Profile updated</dt><dd>{formatDate(selected.updatedAt)}</dd></div></dl></section></div></section></div>
}

export function RevenueLedgerScreen({ liveMode, onNotify }: { liveMode: boolean; onNotify: (message: string) => void }) {
  const [records, setRecords] = useState<ApiRevenueAttribution[]>([])
  const [state, setState] = useState<LoadState>(liveMode ? 'loading' : 'idle')
  const [error, setError] = useState('')
  const [selectedId, setSelectedId] = useState('')

  useEffect(() => {
    if (!liveMode) return
    let active = true
    setRecords([]); setState('loading'); setError('')
    loadRevenueAttribution().then(({ records: values }) => { if (active) { setRecords(values); setSelectedId(values[0]?.id ?? ''); setState('ready') } })
      .catch((reason) => { if (active) { setError(message(reason)); setState('error') } })
    return () => { active = false }
  }, [liveMode])

  const demoRecords: ApiRevenueAttribution[] = liveMode ? [] : [{ id: 'demo-attribution', bookingId: 'demo-booking', sourceId: 'demo-source', workflowJobId: 'demo-workflow', amountMinor: 14500, currency: 'GBP', attributionType: 'abandoned_enquiry', evidence: 'sent_recovery_before_booking', touchAt: '2026-07-20T10:00:00.000Z', verifiedAt: '2026-07-20T10:30:00.000Z' }]
  if (liveMode && state !== 'ready') return <DataBoundary state={state} error={error} icon="ledger" label="revenue attribution records" />
  const rows = liveMode ? records : demoRecords
  const selected = rows.find((row) => row.id === selectedId) ?? rows[0]
  const totals = revenueTotalsByCurrency(rows)
  if (!selected) return <EmptyPanel title="No verified revenue attribution" detail="The ledger remains empty until a recovery touch is matched to a provider-confirmed booking." />

  return <div className="ops-page"><section className="screen-heading"><div><span className="demo-label">{liveMode ? 'Verified attribution ledger' : 'Sample transaction log'}</span><h2>Recovered revenue you can defend.</h2><p>Every displayed amount is tied to booking-level evidence.</p></div><button className="secondary-button" onClick={() => onNotify('Ledger export is not enabled until an audited export endpoint is connected.')}>Export ledger</button></section><section className="ledger-summary"><article className="ledger-lead"><span>Verified total recovered</span><strong>{formatCurrencyTotals(totals)}</strong><small><SealCheck weight="fill" /> No cross-currency summing</small></article><article><span>Verified bookings</span><strong>{rows.length}</strong><small>Single-touch records</small></article><article><span>Currencies</span><strong>{Object.keys(totals).length}</strong><small>Reported separately</small></article><article><span>Evidence</span><strong>100%</strong><small className="success-text">Booking-level</small></article></section><div className="ledger-workspace"><section className="ops-panel ledger-table-panel"><header className="ops-panel-header"><div><h3>Attribution history</h3><p>Authoritative recovery-to-booking records.</p></div></header><div className="ledger-table">{rows.map((row) => <button key={row.id} className={selected.id === row.id ? 'selected' : ''} onClick={() => setSelectedId(row.id)}><span><strong>{formatDate(row.verifiedAt)}</strong><small>{row.id.slice(0, 12)}</small></span><span><strong>Booking {row.bookingId.slice(0, 8)}</strong><small>{label(row.attributionType)}</small></span><strong>{formatMinorAmount(row.amountMinor, row.currency)}</strong><span className="success-text">Verified</span></button>)}</div></section><aside className="ops-panel evidence-panel"><header><span className="queue-icon champagne"><Coins /></span><div><h3>Record evidence</h3><p>{selected.id}</p></div></header><dl><div><dt>Attribution workflow</dt><dd>{label(selected.attributionType)}</dd></div><div><dt>Booking ID</dt><dd>{selected.bookingId}</dd></div><div><dt>Source ID</dt><dd>{selected.sourceId}</dd></div><div><dt>Recovered amount</dt><dd>{formatMinorAmount(selected.amountMinor, selected.currency)}</dd></div></dl><div className="evidence-steps"><span><CheckCircle weight="fill" /><b>{label(selected.evidence)}</b></span><span><CheckCircle weight="fill" /><b>Booking provider event matched</b></span><span><CheckCircle weight="fill" /><b>Verified {formatDate(selected.verifiedAt)}</b></span></div></aside></div></div>
}

export function IntegrationsScreen({ liveMode, onNotify }: { liveMode: boolean; onNotify: (message: string) => void }) {
  const [circuits, setCircuits] = useState<ApiProviderCircuit[]>([])
  const [health, setHealth] = useState<ApiTenantHealth>()
  const [state, setState] = useState<LoadState>(liveMode ? 'loading' : 'idle')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!liveMode) return
    let active = true
    setCircuits([]); setHealth(undefined); setState('loading'); setError('')
    Promise.all([loadProviderCircuits(), loadTenantHealth()]).then(([providerResult, tenantHealth]) => { if (active) { setCircuits(providerResult.circuits); setHealth(tenantHealth); setState('ready') } })
      .catch((reason) => { if (active) { setError(message(reason)); setState('error') } })
    return () => { active = false }
  }, [liveMode])

  if (liveMode && state !== 'ready') return <DataBoundary state={state} error={error} icon="integrations" label="provider health" />
  if (!liveMode) return <EmptyPanel title="Sample integration monitor" detail="Sign in to a configured operations API to view authoritative provider circuit and tenant-health records." />
  return <div className="ops-page"><section className="screen-heading"><div><span className="demo-label">Verified provider operations</span><h2>Every workflow depends on healthy evidence.</h2><p>Provider circuit state and readiness checks come directly from the operations control plane.</p></div><button className="secondary-button" onClick={() => onNotify('Provider health is refreshed whenever this screen opens.')}><ArrowsClockwise /> Refresh policy</button></section><section className="ops-summary"><article><span>Tenant status</span><strong>{label(health?.status ?? 'unavailable')}</strong><small>{health?.checkedAt ? `Checked ${formatDate(health.checkedAt)}` : 'Not checked'}</small></article><article><span>Ready checks</span><strong>{health?.summary.ready ?? 0}</strong><small className="success-text">Authoritative</small></article><article><span>Blocked checks</span><strong className="warning-text">{health?.summary.blocked ?? 0}</strong><small>Action required</small></article><article><span>Open circuits</span><strong>{circuits.filter((circuit) => circuit.state === 'open').length}</strong><small>No estimated availability</small></article></section>{circuits.length === 0 ? <EmptyPanel title="No provider circuit records" detail="Providers will appear after their circuit state has been initialized by a real operation." /> : <section className="integration-grid">{circuits.map((circuit) => <article className="ops-panel integration-card" key={circuit.provider}><header><span className="integration-mark"><GearSix weight="fill" /></span><span><h3>{providerName(circuit.provider)}</h3><p>Distributed provider circuit</p></span><b className={circuit.state === 'closed' ? 'success-text' : 'warning-text'}>{label(circuit.state)}</b></header><dl><div><dt>Consecutive failures</dt><dd>{circuit.consecutiveFailures}</dd></div><div><dt>Last success</dt><dd>{circuit.lastSuccessAt ? formatDate(circuit.lastSuccessAt) : 'Not recorded'}</dd></div><div><dt>Last error</dt><dd>{circuit.lastErrorCode ?? 'None recorded'}</dd></div><div><dt>Updated</dt><dd>{formatDate(circuit.updatedAt)}</dd></div></dl></article>)}</section>}<HealthCheckGrid checks={health?.checks??[]}/></div>
}

function HealthCheckGrid({checks}:{checks:ApiTenantHealth['checks']}){
  const ordered=[...checks].sort((left,right)=>rank(left.status)-rank(right.status)||left.label.localeCompare(right.label))
  return <section className="ops-panel health-check-panel"><header className="ops-panel-header"><div><h3>Operational evidence</h3><p>Tenant-scoped checks for release integrity, event lag, workflow pressure, providers, and governance.</p></div></header><div className="health-check-grid">{ordered.map(check=><article key={check.key} className={`health-check-card ${check.status}`}><span>{check.status==='ready'?<CheckCircle weight="fill"/>:<WarningCircle weight="fill"/>}</span><div><strong>{check.label}</strong><p>{check.detail}</p>{check.action&&<small>{check.action}</small>}</div><b>{label(check.status)}</b></article>)}</div></section>
}

const defaultCommunicationPolicy:NonNullable<ApiLocationSettings['communicationPolicy']>={policyVersion:'communication-v1',transactionalDisclosureVersion:'transactional-v1',marketingDisclosureVersion:'marketing-v1',escalationContactName:'Duty manager',escalationContactEmail:'manager@example.com',contactWindowStartHour:9,contactWindowEndHour:20,defaultRebookDays:45}
const demoSettings: ApiLocationSettings = { salonName: 'Mayfair Flagship', senderName: 'Salon Recovery', timezone: 'Europe/London', brandVoice: 'Warm, concise, professional, and never urgent.', reportRecipientEmail: 'owner@example.com', communicationPolicy:defaultCommunicationPolicy, updatedAt: '2026-07-01T10:00:00.000Z' }

export function PoliciesScreen({ liveMode, onNotify }: { liveMode: boolean; onNotify: (message: string) => void }) {
  const [settings, setSettings] = useState<ApiLocationSettings | null>(liveMode ? null : demoSettings)
  const [form, setForm] = useState<Omit<ApiLocationSettings, 'updatedAt'>>(stripUpdatedAt(demoSettings))
  const [state, setState] = useState<LoadState>(liveMode ? 'loading' : 'idle')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!liveMode) return
    let active = true
    setSettings(null); setState('loading'); setError('')
    loadLocationSettings().then(({ settings: value }) => { if (!active) return; setSettings(value); setForm(value ? {...stripUpdatedAt(value),communicationPolicy:value.communicationPolicy??defaultCommunicationPolicy} : { salonName: '', senderName: '', timezone: '', brandVoice: '', reportRecipientEmail: '', publicReviewUrl: '',communicationPolicy:defaultCommunicationPolicy }); setState('ready') })
      .catch((reason) => { if (active) { setError(message(reason)); setState('error') } })
    return () => { active = false }
  }, [liveMode])

  if (liveMode && state !== 'ready') return <DataBoundary state={state} error={error} icon="policies" label="authoritative salon settings" />

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!liveMode) { onNotify('Sample policy settings saved in the prototype workspace.'); return }
    setSaving(true)
    try {
      const saved = await saveLocationSettings(cleanSettings(form))
      setSettings(saved); setForm(stripUpdatedAt(saved)); onNotify('Authoritative salon settings saved to the audit trail.')
    } catch (reason) { onNotify(message(reason)) }
    finally { setSaving(false) }
  }

  return <div className="ops-page policy-page"><section className="screen-heading"><div><span className="demo-label">{liveMode ? 'Authoritative communication settings' : 'Sample policy settings'}</span><h2>Salon identity and communication boundaries.</h2><p>Only settings supported by the audited location-settings contract are editable here.</p></div></section><form className="ops-panel policy-editor" onSubmit={submit}><header><span className="queue-icon champagne"><ShieldCheck /></span><div><h2>{settings?.salonName ?? 'Configure this salon location'}</h2><p>{settings ? `Last updated ${formatDate(settings.updatedAt)}` : 'No authoritative location settings have been saved yet.'}</p></div><span className={`status-badge ${settings ? 'success' : 'warning'}`}>{settings ? 'Configured' : 'Setup required'}</span></header><div className="policy-form"><section><h3>Salon identity</h3><div className="policy-fields"><label><span>Salon name</span><input required minLength={2} maxLength={120} value={form.salonName} onChange={(event) => setForm({ ...form, salonName: event.target.value })} /></label><label><span>Sender name</span><input required minLength={2} maxLength={80} value={form.senderName} onChange={(event) => setForm({ ...form, senderName: event.target.value })} /></label><label><span>IANA timezone</span><input required minLength={3} maxLength={100} value={form.timezone} onChange={(event) => setForm({ ...form, timezone: event.target.value })} /></label><label><span>Report recipient</span><input type="email" value={form.reportRecipientEmail ?? ''} onChange={(event) => setForm({ ...form, reportRecipientEmail: event.target.value })} /></label></div></section><section><h3>Brand voice</h3><textarea maxLength={1000} value={form.brandVoice ?? ''} onChange={(event) => setForm({ ...form, brandVoice: event.target.value })} placeholder="Describe the approved tone for client communication" /></section><CommunicationPolicyFields value={form.communicationPolicy!} onChange={(communicationPolicy)=>setForm({...form,communicationPolicy})}/><section><h3>Public review destination</h3><input type="url" maxLength={500} value={form.publicReviewUrl ?? ''} onChange={(event) => setForm({ ...form, publicReviewUrl: event.target.value })} placeholder="https://…" /><div className="locked-rule"><ShieldCheck weight="fill" /><span><strong>Unsupported financial controls are not shown</strong><small>Refund limits and discount policies require their own versioned, audited backend contract.</small></span></div></section></div><footer><button className="primary-button" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save authoritative settings'}</button></footer></form></div>
}

function CommunicationPolicyFields({value,onChange}:{value:NonNullable<ApiLocationSettings['communicationPolicy']>;onChange:(value:NonNullable<ApiLocationSettings['communicationPolicy']>)=>void}){
  const update=<Key extends keyof typeof value>(key:Key,next:(typeof value)[Key])=>onChange({...value,[key]:next})
  return <section><h3>Automation communication policy</h3><p className="policy-section-note">These versioned controls are required before production activation and are enforced in each client’s timezone.</p><div className="policy-fields"><label><span>Policy version</span><input required pattern="[A-Za-z0-9][A-Za-z0-9._-]{1,63}" value={value.policyVersion} onChange={event=>update('policyVersion',event.target.value)}/></label><label><span>Escalation owner</span><input required minLength={2} maxLength={120} value={value.escalationContactName} onChange={event=>update('escalationContactName',event.target.value)}/></label><label><span>Escalation email</span><input required type="email" value={value.escalationContactEmail} onChange={event=>update('escalationContactEmail',event.target.value)}/></label><label><span>Transactional disclosure</span><input required value={value.transactionalDisclosureVersion} onChange={event=>update('transactionalDisclosureVersion',event.target.value)}/></label><label><span>Marketing disclosure</span><input required value={value.marketingDisclosureVersion} onChange={event=>update('marketingDisclosureVersion',event.target.value)}/></label><label><span>Default rebook interval</span><input required type="number" min={7} max={365} value={value.defaultRebookDays} onChange={event=>update('defaultRebookDays',Number(event.target.value))}/></label><label><span>Contact from</span><input required type="number" min={0} max={23} value={value.contactWindowStartHour} onChange={event=>update('contactWindowStartHour',Number(event.target.value))}/></label><label><span>Contact until</span><input required type="number" min={1} max={24} value={value.contactWindowEndHour} onChange={event=>update('contactWindowEndHour',Number(event.target.value))}/></label></div></section>
}

function DataBoundary({ state, error, icon, label }: { state: LoadState; error: string; icon: 'campaigns' | 'clients' | 'ledger' | 'integrations' | 'policies'; label: string }) {
  const Icon = icon === 'clients' ? UsersThree : icon === 'ledger' ? Coins : icon === 'integrations' ? GearSix : icon === 'policies' ? ShieldCheck : MegaphoneSimple
  const failed = state === 'error'
  return <div className="empty-workspace"><span>{failed ? <WarningCircle weight="fill" /> : <Icon weight="duotone" />}</span><h2>{failed ? `${label[0]!.toUpperCase()}${label.slice(1)} unavailable` : `Loading ${label}`}</h2><p>{failed ? error : 'Reading authoritative operations records.'}</p></div>
}

function EmptyPanel({ title, detail }: { title: string; detail: string }) {
  return <div className="empty-workspace"><span><SealCheck weight="duotone" /></span><h2>{title}</h2><p>{detail}</p></div>
}

function label(value: string) { return value.split('_').map((word) => `${word[0]?.toUpperCase() ?? ''}${word.slice(1)}`).join(' ') }
function message(reason: unknown) { return reason instanceof Error ? reason.message : 'The verified operations record could not be loaded.' }
function formatDate(value: string) { return new Date(value).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) }
function initials(value: string) { return value.trim().split(/\s+/).slice(0, 2).map((word) => word[0] ?? '').join('').toUpperCase() || 'CL' }
function maskContact(value: string) { return value.length > 6 ? `${value.slice(0, 3)}••••${value.slice(-3)}` : 'Recorded' }
function providerName(provider: ApiProviderCircuit['provider']) { return provider === 'square' ? 'Square Bookings' : provider === 'twilio' ? 'Twilio Messaging' : provider === 'openai' ? 'OpenAI Agent' : 'Postmark Email' }
function rank(status:ApiTenantHealth['checks'][number]['status']){return status==='blocked'?0:status==='warning'?1:2}
function stripUpdatedAt(settings: ApiLocationSettings): Omit<ApiLocationSettings, 'updatedAt'> { const { updatedAt: _updatedAt, ...form } = settings; return form }
function cleanSettings(settings: Omit<ApiLocationSettings, 'updatedAt'>) { return Object.fromEntries(Object.entries(settings).filter(([, value]) => typeof value !== 'string' || value.trim() !== '')) as Omit<ApiLocationSettings, 'updatedAt'> }
