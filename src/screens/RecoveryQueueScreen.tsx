import {
  ChatTeardropText,
  Check,
  CheckCircle,
  Clock,
  EnvelopeSimple,
  Funnel,
  MagnifyingGlass,
  Pause,
  Sparkle,
  WarningCircle,
  WhatsappLogo,
} from '@phosphor-icons/react'
import { useMemo, useState } from 'react'
import type { Opportunity } from '../App'
import { formatCurrencyTotals, formatMinorAmount, opportunityTotalsByCurrency } from '../verified-operations'

const money = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 })

type Props = {
  items: Opportunity[]
  live: boolean
  onNew: () => void
  onOpenConversation: (client: string) => void
  onPause: (item: Opportunity) => void
  onResolve: (item: Opportunity) => void
}

function ChannelIcon({ channel }: { channel: string }) {
  if (channel === 'WhatsApp') return <WhatsappLogo weight="bold" />
  if (channel === 'Email') return <EnvelopeSimple weight="bold" />
  if (channel === 'Smart match') return <Sparkle weight="fill" />
  return <ChatTeardropText weight="bold" />
}

export function RecoveryQueueScreen({ items, live, onNew, onOpenConversation, onPause, onResolve }: Props) {
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<'active' | 'resolved' | 'all'>('active')
  const [selectedId, setSelectedId] = useState(items.find((item) => !item.resolved)?.id ?? items[0]?.id)

  const filtered = useMemo(() => items.filter((item) => {
    const matchesStatus = status === 'all' || item.resolved === (status === 'resolved')
    const query = search.toLowerCase().trim()
    const matchesSearch = !query || `${item.client} ${item.workflow} ${item.channel}`.toLowerCase().includes(query)
    return matchesStatus && matchesSearch
  }), [items, search, status])

  const selected = items.find((item) => item.id === selectedId) ?? filtered[0]
  const active = items.filter((item) => !item.resolved)
  const openValue = live ? formatCurrencyTotals(opportunityTotalsByCurrency(items, true), 'No recorded value') : money.format(active.reduce((total, item) => total + item.value, 0))
  const resolved = items.filter((item) => item.resolved)
  const formatValue = (item: Opportunity) => item.currency ? formatMinorAmount(Math.round(item.value * 100), item.currency) : money.format(item.value)

  return (
    <div className="screen-page recovery-screen">
      <section className="screen-heading">
        <div>
          <span className="demo-label">{live ? 'Verified recovery operations' : 'Recovery operations'}</span>
          <h2>Every opportunity, clearly prioritised.</h2>
          <p>Inspect the client context and deterministic checks before intervening in an automated workflow.</p>
        </div>
        <button className="primary-button" onClick={onNew}>New recovery action</button>
      </section>

      <section className="recovery-summary" aria-label="Recovery queue summary">
        <div><span>Open value</span><strong>{openValue}</strong></div>
        <div><span>Active cases</span><strong>{active.length}</strong></div>
        <div><span>Resolved cases</span><strong className="success-text">{resolved.length}</strong></div>
        <div><span>Evidence mode</span><strong className="champagne-text">{live ? 'Authoritative' : 'Sample'}</strong></div>
      </section>

      <div className="recovery-toolbar">
        <label className="search-control"><MagnifyingGlass /><span className="sr-only">Search recovery queue</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search clients or workflows" /></label>
        <div className="segmented" aria-label="Recovery queue filter">
          {(['active', 'resolved', 'all'] as const).map((value) => <button key={value} className={status === value ? 'selected' : ''} onClick={() => setStatus(value)}>{value[0].toUpperCase() + value.slice(1)}</button>)}
        </div>
        <button className="secondary-button compact"><Funnel weight="bold" /> More filters</button>
      </div>

      <div className="recovery-workspace">
        <section className="recovery-master" aria-label="Recovery opportunities">
          <div className="recovery-master-head"><span>Workflow and client</span><span>Channel</span><span>Value</span><span>Status</span></div>
          <div className="recovery-master-list">
            {filtered.map((item) => (
              <button key={item.id} className={`recovery-master-row ${selected?.id === item.id ? 'selected' : ''}`} onClick={() => setSelectedId(item.id)}>
                <span className={`queue-icon ${item.tone}`}><ChannelIcon channel={item.channel} /></span>
                <span className="master-client"><strong>{item.client}</strong><small>{item.workflow} · {item.timing}</small></span>
                <span className="master-channel"><ChannelIcon channel={item.channel} />{item.channel}</span>
                <strong className="master-value">{formatValue(item)}</strong>
                <span className={`status-badge ${item.tone}`}>{item.status}</span>
              </button>
            ))}
            {filtered.length === 0 && <div className="queue-empty"><MagnifyingGlass weight="duotone" /><strong>No matching opportunities</strong><p>Try a broader search or status view.</p></div>}
          </div>
        </section>

        {selected && (
          <aside className="recovery-detail">
            <header>
              <span className="client-avatar">{selected.client.split(' ').map((part) => part[0]).join('').slice(0, 2)}</span>
              <span><h3>{selected.client}</h3><small>{selected.detail}</small></span>
              <strong>{formatValue(selected)}</strong>
            </header>
            <div className="detail-body">
              <div className="verification-grid">
                <div><span>{live ? 'Evidence source' : 'Verified consent'}</span><strong className="success-text"><CheckCircle weight="fill" /> {live ? (selected.evidence === 'verified_attribution' ? 'Booking attribution' : 'Recovery case') : 'Active'}</strong></div>
                <div><span>Booking state</span><strong className={selected.resolved ? 'success-text' : 'warning-text'}>{selected.resolved ? <CheckCircle weight="fill" /> : <WarningCircle weight="fill" />}{selected.resolved ? 'Booked' : 'Open'}</strong></div>
              </div>
              <section className="recommendation-panel">
                <span>Recommended next action</span>
                <p>{selected.resolved ? 'This recovery is complete. Keep attribution evidence attached to the confirmed booking.' : live ? 'Review the authoritative workflow record before intervening. No manual status change is available from this read-only evidence view.' : `Continue the ${selected.channel.toLowerCase()} workflow. Confirm the client has not already booked before sending another message.`}</p>
                <small><Sparkle weight="fill" /> {live ? 'No inferred confidence score shown' : 'Agent confidence: 94%'}</small>
              </section>
              <section className="case-timeline">
                <h4>Case timeline</h4>
                <div><span className="timeline-icon champagne"><Clock /></span><p><strong>Opportunity opened</strong><small>{selected.timing} · {formatValue(selected)}</small></p></div>
                {live ? <div><span className="timeline-icon success"><Check /></span><p><strong>{selected.status}</strong><small>{selected.detail}</small></p></div> : <><div><span className="timeline-icon success"><Check /></span><p><strong>Policy checks passed</strong><small>Consent, frequency, and booking state verified</small></p></div><div><span className="timeline-icon muted"><Clock /></span><p><strong>{selected.resolved ? 'Booking attributed' : 'Next check scheduled'}</strong><small>{selected.resolved ? 'Revenue ledger updated' : 'In two hours'}</small></p></div></>}
              </section>
            </div>
            <footer>
              <button className="primary-button" onClick={() => onOpenConversation(selected.client)}><ChatTeardropText weight="bold" /> Open conversation</button>
              {!live && <div><button className="secondary-button" disabled={selected.resolved} onClick={() => onPause(selected)}><Pause weight="bold" /> Pause</button><button className="secondary-button success-button" disabled={selected.resolved} onClick={() => onResolve(selected)}><Check weight="bold" /> Resolve</button></div>}
            </footer>
          </aside>
        )}
      </div>
    </div>
  )
}
