import {
  CalendarBlank,
  CheckCircle,
  ChatTeardropText,
  Info,
  NotePencil,
  ShieldCheck,
  UserCircle,
  WarningDiamond,
} from '@phosphor-icons/react'
import { useMemo, useState } from 'react'
import type { Approval, ApprovalHistory } from '../App'

type Tab = 'Pending' | 'Urgent' | 'Resolved'

export function ApprovalsScreen({ approvals, history, onDecision, onRequestInfo }: { approvals: Approval[]; history: ApprovalHistory[]; onDecision: (approval: Approval, decision: 'approved' | 'rejected') => void; onRequestInfo: (approval: Approval) => void }) {
  const [tab, setTab] = useState<Tab>('Pending')
  const [selectedId, setSelectedId] = useState(approvals[0]?.id)
  const pending = useMemo(() => tab === 'Urgent' ? approvals.filter((item) => item.risk === 'High') : approvals, [approvals, tab])
  const selected = approvals.find((item) => item.id === selectedId) ?? pending[0]
  const moneyAtRisk = approvals.reduce((total, item) => total + (item.amount ?? 0), 0)

  return (
    <div className="approvals-screen">
      <header className="approval-topline">
        <div className="segmented approval-tabs" aria-label="Approval status">
          {(['Pending', 'Urgent', 'Resolved'] as const).map((value) => <button key={value} className={tab === value ? 'selected' : ''} onClick={() => setTab(value)}>{value}{value !== 'Resolved' && ` (${value === 'Urgent' ? approvals.filter((item) => item.risk === 'High').length : approvals.length})`}</button>)}
        </div>
        <div><span>Money at risk</span><strong>£{moneyAtRisk}</strong></div>
      </header>

      {tab === 'Resolved' ? (
        <section className="resolved-approvals">
          <div className="screen-heading"><div><span className="demo-label">Decision history</span><h2>Resolved approvals</h2><p>Every decision retains the operator, reason, and audit timestamp.</p></div></div>
          <div>{history.length === 0 ? <div className="queue-empty"><CheckCircle weight="duotone" /><strong>No decisions recorded</strong><p>Approved and rejected requests will appear here.</p></div> : history.map((item) => <article key={item.id}><span className={`activity-icon ${item.decision === 'approved' ? 'success' : 'danger'}`}><CheckCircle /></span><span><strong>{item.title}</strong><small>{item.decision} by Julian de Villiers</small></span><time>{item.time}</time></article>)}</div>
        </section>
      ) : (
        <div className="approval-workspace">
          <aside className="approval-queue">
            {pending.map((approval) => <button key={approval.id} className={selected?.id === approval.id ? 'selected' : approval.safety ? 'safety' : ''} onClick={() => setSelectedId(approval.id)}>
              <span className={`approval-kind ${approval.safety ? 'danger' : approval.risk === 'High' ? 'warning' : 'success'}`}>{approval.safety ? 'Safety' : approval.title.split(' ')[0]}</span>
              <small>{approval.age ?? '12 mins ago'}</small>
              <strong>{approval.detail}</strong>
              <p>{approval.reason}</p>
              <footer>{approval.safety ? <WarningDiamond weight="fill" /> : <span>£{approval.amount ?? 0}</span>}<b>{approval.safety ? 'Critical escalation' : `${approval.risk} risk`}</b></footer>
            </button>)}
            {pending.length === 0 && <div className="queue-empty"><CheckCircle weight="duotone" /><strong>Nothing waiting</strong><p>All decisions in this view are complete.</p></div>}
          </aside>

          {selected ? (
            <section className="approval-detail-screen">
              <header><div><span className="demo-label">Case AP-{typeof selected.id === 'number' ? 7720 + selected.id : selected.id.slice(0, 8).toUpperCase()}</span><h2>{selected.detail}</h2><p>{selected.title} · {selected.source === 'api' ? 'Verified system exception' : 'Client since 2022'} · {selected.risk} risk</p></div><div><span>Value at stake</span><strong>£{selected.amount ?? 0}</strong></div></header>
              {selected.safety && <div className="safety-banner"><WarningDiamond weight="fill" /><span><strong>Immediate safety escalation required</strong><p>This case cannot be approved automatically. Contact the duty manager and follow the incident protocol.</p></span></div>}
              <div className="approval-evidence-grid">
                <article><h3>Request detail and policy</h3><p>{selected.reason}</p><div><span>Policy rule</span><p>{selected.policy ?? 'Any exception to the published cancellation or discount policy requires operator approval.'}</p></div></article>
                <article><h3>Agent recommendation</h3><div className="agent-recommendation"><span>AI</span><p><strong>Recovery coordinator</strong>{selected.safety ? 'Do not issue a financial or medical response. Escalate immediately.' : selected.recommendation ?? 'Approve with a documented exception based on client history and attributable value.'}</p></div><b className={selected.safety ? 'danger-text' : 'success-text'}><ShieldCheck weight="fill" />{selected.safety ? 'Operator action required' : 'Policy-bounded recommendation'}</b></article>
              </div>
              <section className="evidence-timeline"><h3>Evidence timeline and audit</h3><div><span><CalendarBlank /></span><p><strong>Request received</strong><small>Today, 08:32 · Provider event verified</small></p></div><div><span><ChatTeardropText /></span><p><strong>Customer context captured</strong><small>Original message stored with consent evidence</small></p></div><div><span><ShieldCheck /></span><p><strong>System validation</strong><small>Policy threshold exceeded. Routed to operator.</small></p></div></section>
              <div className="approval-audit"><span><UserCircle /> Requested by Agent ID 042 · Audit hash 928X-YY2</span>{!selected.safety && <div><button className="secondary-button" onClick={() => onRequestInfo(selected)}><NotePencil /> Request more info</button><button className="secondary-button danger-button" onClick={() => onDecision(selected, 'rejected')}>Reject request</button><button className="primary-button" onClick={() => onDecision(selected, 'approved')}>Approve request</button></div>}</div>
              <div className="protocol-reminder"><Info weight="bold" /><span><strong>Safety protocol reminder</strong><p>Medical reactions, injuries, legal threats, and chargebacks always require immediate human escalation.</p></span></div>
            </section>
          ) : <div className="approval-empty"><CheckCircle weight="duotone" /><h2>Queue clear</h2><p>No approval requests remain in this view.</p></div>}
        </div>
      )}
    </div>
  )
}
