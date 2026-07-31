import {
  ArrowRight,
  ArrowsClockwise,
  CalendarCheck,
  CaretRight,
  CheckCircle,
  Clock,
  EnvelopeSimple,
  LockKey,
  PaperPlaneTilt,
  SealCheck,
  ShieldCheck,
  TrendUp,
  WarningCircle,
  X,
} from '@phosphor-icons/react'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  loadLocationSettings,
  loadWeeklyReports,
  scheduleWeeklyReports,
  type ApiLocationSettings,
  type ApiWeeklyReportSnapshot,
  type ApiWeeklyRevenueReport,
} from '../operations-api'
import { formatCurrencyTotals } from '../verified-operations'

type LoadState = 'idle' | 'loading' | 'ready' | 'error'

export function WeeklyReportsScreen({liveMode,onNotify,onNavigate}:{liveMode:boolean;onNotify:(message:string)=>void;onNavigate:(view:string)=>void}){
  const [reports,setReports]=useState<ApiWeeklyReportSnapshot[]>(liveMode?[]:demoReports)
  const [selectedId,setSelectedId]=useState(liveMode?'':demoReports[0]!.id)
  const [settings,setSettings]=useState<ApiLocationSettings|null>(liveMode?null:demoSettings)
  const [state,setState]=useState<LoadState>(liveMode?'loading':'idle')
  const [reload,setReload]=useState(0)
  const [error,setError]=useState('')
  const [scheduleOpen,setScheduleOpen]=useState(false)
  const [scheduling,setScheduling]=useState(false)
  const [recipient,setRecipient]=useState(liveMode?'':demoSettings.reportRecipientEmail??'')
  const [firstRunAt,setFirstRunAt]=useState(defaultFirstRun())
  const [scheduledRun,setScheduledRun]=useState(liveMode?'':'2026-07-27T09:00:00.000Z')

  useEffect(()=>{
    if(!liveMode){setReports(demoReports);setSelectedId(demoReports[0]!.id);setSettings(demoSettings);setRecipient(demoSettings.reportRecipientEmail??'');setState('idle');setError('');return}
    let current=true;setState('loading');setError('')
    Promise.all([loadWeeklyReports(),loadLocationSettings()]).then(([history,location])=>{if(!current)return;const ordered=orderReports(history.reports);setReports(ordered);setSelectedId(value=>ordered.some(report=>report.id===value)?value:(ordered[0]?.id??''));setSettings(location.settings);setRecipient(location.settings?.reportRecipientEmail??'');setState('ready')}).catch(reason=>{if(current){setError(errorMessage(reason));setState('error')}})
    return()=>{current=false}
  },[liveMode,reload])

  const selected=reports.find(report=>report.id===selectedId)??reports[0]
  const delivery=useMemo(()=>deliverySummary(reports),[reports])

  async function submitSchedule(event:FormEvent<HTMLFormElement>){
    event.preventDefault();const runAt=new Date(firstRunAt).toISOString();setScheduling(true);setError('')
    try{const result=liveMode?await scheduleWeeklyReports(runAt,recipient.trim()):{jobId:`demo-report-${Date.now()}`,runAt,recipientEmail:recipient.trim()};setScheduledRun(result.runAt);setSettings(current=>({...current??demoSettings,reportRecipientEmail:result.recipientEmail,updatedAt:new Date().toISOString()}));setScheduleOpen(false);onNotify('Weekly verified-revenue delivery scheduled. The recipient remains excluded from audit evidence.')}
    catch(reason){setError(errorMessage(reason))}finally{setScheduling(false)}
  }

  if(liveMode&&state!=='ready')return <div className="empty-workspace weekly-report-boundary"><span>{state==='error'?<WarningCircle weight="fill"/>:<EnvelopeSimple weight="duotone"/>}</span><h2>{state==='error'?'Weekly reporting unavailable':'Loading weekly reports'}</h2><p>{state==='error'?error:'Reading tenant-scoped delivery snapshots and current report configuration.'}</p>{state==='error'&&<button className="primary-button" onClick={()=>setReload(value=>value+1)}>Retry weekly reports</button>}</div>

  return <div className="ops-page weekly-reports-page">
    <section className="screen-heading weekly-reports-heading"><div><span className="demo-label">{liveMode?'Verified automated reporting':'Sample automated reporting'}</span><h2>Revenue proof, delivered every week.</h2><p>Give the operator a defensible ROI report without asking them to assemble one—or exposing client identities.</p></div><button className="primary-button" onClick={()=>setScheduleOpen(value=>!value)}>{scheduleOpen?<X weight="bold"/>:<CalendarCheck weight="bold"/>}{scheduleOpen?'Close schedule':'Configure delivery'}</button></section>

    <section className="weekly-report-boundary-band"><ShieldCheck weight="fill"/><div><strong>Verified booking attribution only</strong><p>Estimated revenue and unattributed bookings are excluded. Currency totals remain separate from one another.</p></div><span><LockKey weight="fill"/>Tenant scoped</span></section>

    {error&&<section className="weekly-report-error" role="alert"><WarningCircle weight="fill"/><span>{error}</span><button aria-label="Dismiss weekly report error" onClick={()=>setError('')}><X weight="bold"/></button></section>}

    {scheduleOpen&&<form className="ops-panel weekly-schedule-form" onSubmit={event=>void submitSchedule(event)}>
      <header><span><CalendarCheck weight="duotone"/></span><div><small>Recurring workflow</small><h3>Schedule the first verified report</h3><p>After the first successful run, the workflow schedules the next delivery exactly seven days later.</p></div></header>
      <div className="weekly-schedule-fields"><label><span>Private recipient email</span><input type="email" required autoComplete="email" placeholder="owner@salon.example" value={recipient} onChange={event=>setRecipient(event.target.value)}/></label><label><span>First delivery</span><input type="datetime-local" required min={minimumFirstRun()} value={firstRunAt} onChange={event=>setFirstRunAt(event.target.value)}/></label></div>
      <footer><span><LockKey weight="fill"/>The recipient is stored in tenant settings and never copied into audit evidence.</span><button className="primary-button" disabled={scheduling||!recipient.trim()||!futureDate(firstRunAt)}><ArrowsClockwise className={scheduling?'spinning':''} weight="bold"/>{scheduling?'Scheduling…':'Schedule weekly delivery'}</button></footer>
    </form>}

    <section className="weekly-report-summary">
      <article className="weekly-report-lead"><span>Latest verified revenue</span><strong>{selected?formatCurrencyTotals(selected.report.observed.verifiedRecoveredRevenueMinorByCurrency):'No verified revenue'}</strong><small><SealCheck weight="fill"/>{selected?`${selected.report.observed.recoveredBookings} provider-confirmed bookings`:'Awaiting the first report'}</small></article>
      <article><span>Delivered reports</span><strong>{delivery.delivered}</strong><small>{reports.length} immutable delivery snapshots</small></article>
      <article><span>Delivery failures</span><strong className={delivery.failed?'danger-text':''}>{delivery.failed}</strong><small>{delivery.failed?'Visible for operational follow-up':'No unresolved delivery evidence'}</small></article>
      <article><span>Recurring delivery</span><strong>{settings?.reportRecipientEmail?'Configured':'Not configured'}</strong><small>{scheduledRun?`First run ${formatDateTime(scheduledRun)}`:settings?.reportRecipientEmail?`Recipient ${maskEmail(settings.reportRecipientEmail)}`:'Add a private report recipient'}</small></article>
    </section>

    {selected?<section className="weekly-report-workspace">
      <aside className="ops-panel weekly-report-history"><header><div><h3>Delivery history</h3><p>Generated and delivery state.</p></div><span>{reports.length}</span></header><div>{reports.map(report=><button key={report.id} className={report.id===selected.id?'selected':''} onClick={()=>setSelectedId(report.id)}><span className={report.status}>{statusIcon(report.status)}</span><span><strong>{weekLabel(report.periodFrom,report.periodTo)}</strong><small>{statusLabel(report.status)} · {formatDate(report.createdAt)}</small></span><CaretRight weight="bold"/></button>)}</div></aside>
      <section className="weekly-report-detail">
        <ReportHeader report={selected}/>
        <ReportOperations report={selected.report}/>
        <SourceBreakdown report={selected.report}/>
        <ReportDelivery report={selected} onNavigate={onNavigate}/>
        <EvidenceBoundary report={selected.report}/>
      </section>
    </section>:<section className="ops-panel weekly-report-empty"><EnvelopeSimple weight="duotone"/><div><h3>No delivery snapshots yet</h3><p>Configure the first run. The workflow will generate a verified report, deliver it through Postmark, and retain the delivery result here.</p></div><button className="primary-button" onClick={()=>setScheduleOpen(true)}>Configure first report</button></section>}
  </div>
}

function ReportHeader({report}:{report:ApiWeeklyReportSnapshot}){return <section className={`weekly-report-state ${report.status}`}><div><span>{statusIcon(report.status)}</span><div><small>{statusLabel(report.status)}</small><h3>{weekLabel(report.periodFrom,report.periodTo)}</h3><p>Snapshot {report.id.slice(0,10)} · created {formatDateTime(report.createdAt)}</p></div></div><dl><div><dt>Bookings</dt><dd>{report.report.observed.recoveredBookings}</dd></div><div><dt>Attribution</dt><dd>Single-touch</dd></div><div><dt>Recipient</dt><dd>{report.recipientEmail?maskEmail(report.recipientEmail):'Not retained'}</dd></div></dl></section>}

function ReportOperations({report}:{report:ApiWeeklyRevenueReport}){const observed=report.observed;const resolutionRate=observed.recoveryCasesOpened?observed.recoveryCasesResolved/observed.recoveryCasesOpened:0;return <section className="ops-panel weekly-report-operations"><header className="ops-panel-header"><div><h3>Weekly operating result</h3><p>Observed outcomes inside the exact report period.</p></div><span className="status-badge success">Provider evidence</span></header><div><article><span><TrendUp weight="duotone"/></span><div><small>Recovery cases</small><strong>{observed.recoveryCasesOpened}</strong><p>{observed.recoveryCasesResolved} resolved · {observed.recoveryCasesStillOpen} still open</p></div></article><article><span><CheckCircle weight="duotone"/></span><div><small>Resolution rate</small><strong>{percent(resolutionRate)}</strong><p>{observed.recoveryCasesClosed} closed without recovery</p></div></article><article><span><PaperPlaneTilt weight="duotone"/></span><div><small>Review requests sent</small><strong>{observed.reviewRequestsSent}</strong><p>{observed.reviewRequestsClosed} closed by policy</p></div></article><article><span><WarningCircle weight="duotone"/></span><div><small>Negative feedback</small><strong>{observed.negativeReviewFeedback}</strong><p>Escalated from bounded review signals</p></div></article></div></section>}

function SourceBreakdown({report}:{report:ApiWeeklyRevenueReport}){const sources=Object.keys({...report.observed.recoveredBookingsBySource,...report.observed.verifiedRecoveredRevenueMinorBySource});return <section className="ops-panel weekly-report-sources"><header className="ops-panel-header"><div><h3>Verified recovery sources</h3><p>Booking outcomes stay attached to the workflow that earned the attribution.</p></div><span>{sources.length} sources</span></header>{sources.length?<div>{sources.map(source=><article key={source}><span><strong>{workflowLabel(source)}</strong><small>{report.observed.recoveredBookingsBySource[source]??0} recovered bookings</small></span><b>{formatCurrencyTotals(report.observed.verifiedRecoveredRevenueMinorBySource[source]??{})}</b></article>)}</div>:<div className="weekly-source-empty"><SealCheck weight="duotone"/><p><strong>No verified recovery in this period</strong><span>The report correctly presents zero instead of estimating opportunity value.</span></p></div>}</section>}

function ReportDelivery({report,onNavigate}:{report:ApiWeeklyReportSnapshot;onNavigate:(view:string)=>void}){const delivered=report.status==='delivered';const failed=report.status==='delivery_failed';return <section className="ops-panel weekly-delivery-card"><span className={report.status}>{delivered?<CheckCircle weight="fill"/>:failed?<WarningCircle weight="fill"/>:<Clock weight="fill"/>}</span><div><small>Delivery evidence</small><h3>{delivered?'Report delivered successfully':failed?'Delivery failed and remains visible':'Report generated; delivery pending'}</h3><p>{delivered&&report.deliveredAt?`Postmark delivery recorded ${formatDateTime(report.deliveredAt)}.`:failed?'Provider failure is retained for retry and operational review.':'The generated snapshot remains immutable while delivery completes.'}</p></div>{failed&&<button className="text-button" onClick={()=>onNavigate('Integrations')}>Inspect delivery controls<ArrowRight weight="bold"/></button>}</section>}

function EvidenceBoundary({report}:{report:ApiWeeklyRevenueReport}){return <section className="weekly-report-integrity"><SealCheck weight="fill"/><div><strong>Defensible reporting boundary</strong><p>{report.observed.recoveredBookings} booking-level attribution records underpin this report. Estimated and unattributed revenue remain excluded.</p></div><span><CheckCircle weight="fill"/>No client identities displayed</span><code>{report.attribution.method}</code></section>}

function statusIcon(status:ApiWeeklyReportSnapshot['status']){return status==='delivered'?<CheckCircle weight="fill"/>:status==='delivery_failed'?<WarningCircle weight="fill"/>:<Clock weight="fill"/>}
function statusLabel(status:ApiWeeklyReportSnapshot['status']){return status==='delivered'?'Delivered':status==='delivery_failed'?'Delivery failed':'Generated'}
function deliverySummary(reports:ApiWeeklyReportSnapshot[]){return{delivered:reports.filter(report=>report.status==='delivered').length,failed:reports.filter(report=>report.status==='delivery_failed').length}}
function orderReports(reports:ApiWeeklyReportSnapshot[]){return[...reports].sort((a,b)=>Date.parse(b.periodTo)-Date.parse(a.periodTo))}
function weekLabel(from:string,to:string){const format=new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short'});return`${format.format(new Date(from))}–${format.format(new Date(to))}`}
function formatDate(value:string){return new Intl.DateTimeFormat('en-GB',{dateStyle:'medium'}).format(new Date(value))}
function formatDateTime(value:string){return new Intl.DateTimeFormat('en-GB',{dateStyle:'medium',timeStyle:'short'}).format(new Date(value))}
function percent(value:number){return`${(value*100).toFixed(value===0||value===1?0:1)}%`}
function workflowLabel(value:string){return value.split('_').map(part=>part.charAt(0).toUpperCase()+part.slice(1)).join(' ')}
function maskEmail(value:string){const[local,domain]=value.split('@');if(!domain)return'Private recipient';return`${local.slice(0,2)}${'•'.repeat(Math.min(5,Math.max(2,local.length-2)))}@${domain}`}
function futureDate(value:string){return Number.isFinite(Date.parse(value))&&Date.parse(value)>Date.now()}
function minimumFirstRun(){return localDateTime(new Date(Date.now()+60_000))}
function defaultFirstRun(){const value=new Date(Date.now()+86_400_000);value.setHours(9,0,0,0);return localDateTime(value)}
function localDateTime(value:Date){const offset=value.getTimezoneOffset()*60_000;return new Date(value.getTime()-offset).toISOString().slice(0,16)}
function errorMessage(reason:unknown){return reason instanceof Error?reason.message:'Weekly reporting could not be loaded.'}

const demoSettings:ApiLocationSettings={salonName:'Mayfair Flagship',senderName:'Plum House',timezone:'Europe/London',reportRecipientEmail:'owner@plumhouse.example',updatedAt:'2026-07-20T09:00:00.000Z'}
const latestReport:ApiWeeklyRevenueReport={period:{from:'2026-07-13T09:00:00.000Z',to:'2026-07-20T09:00:00.000Z'},observed:{verifiedRecoveredRevenueMinorByCurrency:{GBP:1284500},verifiedRecoveredRevenueMinorBySource:{abandoned_enquiry:{GBP:498500},waitlist_match:{GBP:421000},post_visit_rebook:{GBP:365000}},recoveredBookings:43,recoveredBookingsBySource:{abandoned_enquiry:18,waitlist_match:11,post_visit_rebook:14},recoveryCasesOpened:56,recoveryCasesResolved:43,recoveryCasesClosed:5,recoveryCasesStillOpen:8,reviewRequestsConsidered:37,reviewRequestsSent:31,reviewRequestsClosed:4,negativeReviewFeedback:2},attribution:{method:'verified_booking_single_touch',records:[]},dataQuality:{multipleCurrencies:false,estimatedRevenueIncluded:false,unattributedBookingsIncluded:false}}
const previousReport:ApiWeeklyRevenueReport={...latestReport,period:{from:'2026-07-06T09:00:00.000Z',to:'2026-07-13T09:00:00.000Z'},observed:{...latestReport.observed,verifiedRecoveredRevenueMinorByCurrency:{GBP:1098500},verifiedRecoveredRevenueMinorBySource:{abandoned_enquiry:{GBP:462500},waitlist_match:{GBP:336000},post_visit_rebook:{GBP:300000}},recoveredBookings:38,recoveredBookingsBySource:{abandoned_enquiry:16,waitlist_match:10,post_visit_rebook:12},recoveryCasesOpened:51,recoveryCasesResolved:38,recoveryCasesClosed:6,recoveryCasesStillOpen:7,reviewRequestsConsidered:34,reviewRequestsSent:29,reviewRequestsClosed:3,negativeReviewFeedback:1}}
const failedReport:ApiWeeklyRevenueReport={...latestReport,period:{from:'2026-06-29T09:00:00.000Z',to:'2026-07-06T09:00:00.000Z'},observed:{...latestReport.observed,verifiedRecoveredRevenueMinorByCurrency:{GBP:972000},verifiedRecoveredRevenueMinorBySource:{abandoned_enquiry:{GBP:398000},waitlist_match:{GBP:314000},post_visit_rebook:{GBP:260000}},recoveredBookings:34,recoveredBookingsBySource:{abandoned_enquiry:14,waitlist_match:9,post_visit_rebook:11},recoveryCasesOpened:47,recoveryCasesResolved:34,recoveryCasesClosed:7,recoveryCasesStillOpen:6,reviewRequestsConsidered:30,reviewRequestsSent:25,reviewRequestsClosed:4,negativeReviewFeedback:1}}
const demoReports:ApiWeeklyReportSnapshot[]=[{id:'weekly-2026-07-20',tenantId:'sample-tenant',locationId:'mayfair',periodFrom:latestReport.period.from,periodTo:latestReport.period.to,report:latestReport,status:'delivered',recipientEmail:demoSettings.reportRecipientEmail,createdAt:'2026-07-20T09:00:04.000Z',deliveredAt:'2026-07-20T09:00:06.000Z'},{id:'weekly-2026-07-13',tenantId:'sample-tenant',locationId:'mayfair',periodFrom:previousReport.period.from,periodTo:previousReport.period.to,report:previousReport,status:'delivered',recipientEmail:demoSettings.reportRecipientEmail,createdAt:'2026-07-13T09:00:03.000Z',deliveredAt:'2026-07-13T09:00:05.000Z'},{id:'weekly-2026-07-06',tenantId:'sample-tenant',locationId:'mayfair',periodFrom:failedReport.period.from,periodTo:failedReport.period.to,report:failedReport,status:'delivery_failed',recipientEmail:demoSettings.reportRecipientEmail,createdAt:'2026-07-06T09:00:04.000Z'}]
