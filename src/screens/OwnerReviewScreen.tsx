import {
  ArrowsClockwise,
  CaretRight,
  CheckCircle,
  ClipboardText,
  Coins,
  Flask,
  LockKey,
  MegaphoneSimple,
  Plugs,
  SealCheck,
  ShieldCheck,
  ShieldStar,
  UsersThree,
  WarningCircle,
  X,
} from '@phosphor-icons/react'
import { useEffect, useState, type ReactNode } from 'react'
import { generateMonthlyOwnerReview, loadMonthlyOwnerReviews, type ApiMonthlyOwnerReviewReport, type ApiMonthlyOwnerReviewSnapshot } from '../operations-api'
import { formatCurrencyTotals } from '../verified-operations'

type LoadState='idle'|'loading'|'ready'|'error'

export function OwnerReviewScreen({liveMode,onNotify,onNavigate}:{liveMode:boolean;onNotify:(message:string)=>void;onNavigate:(view:string)=>void}){
  const [snapshots,setSnapshots]=useState<ApiMonthlyOwnerReviewSnapshot[]>(liveMode?[]:demoSnapshots)
  const [selectedId,setSelectedId]=useState(liveMode?'':demoSnapshots[0]!.id)
  const [state,setState]=useState<LoadState>(liveMode?'loading':'idle')
  const [generating,setGenerating]=useState(false)
  const [error,setError]=useState('')
  const [reload,setReload]=useState(0)

  useEffect(()=>{
    if(!liveMode){setSnapshots(demoSnapshots);setSelectedId(demoSnapshots[0]!.id);setState('idle');setError('');return}
    let current=true;setState('loading');setError('')
    loadMonthlyOwnerReviews().then(({snapshots:values})=>{if(current){setSnapshots(values);setSelectedId(value=>values.some(item=>item.id===value)?value:(values[0]?.id??''));setState('ready')}}).catch(reason=>{if(current){setError(message(reason));setState('error')}})
    return()=>{current=false}
  },[liveMode,reload])

  const selected=snapshots.find(value=>value.id===selectedId)??snapshots[0]

  async function generate(){
    const to=new Date();const from=new Date(to.getTime()-30*86_400_000);setGenerating(true);setError('')
    try{const snapshot=liveMode?await generateMonthlyOwnerReview(from.toISOString(),to.toISOString()):demoGenerated(from,to);setSnapshots(current=>[snapshot,...current]);setSelectedId(snapshot.id);onNotify('Immutable monthly owner review generated from current verified evidence.')}
    catch(reason){setError(message(reason))}finally{setGenerating(false)}
  }

  if(liveMode&&state!=='ready')return <div className="empty-workspace owner-review-boundary"><span>{state==='error'?<WarningCircle weight="fill"/>:<ClipboardText weight="duotone"/>}</span><h2>{state==='error'?'Owner review unavailable':'Loading owner reviews'}</h2><p>{state==='error'?error:'Reading immutable governance snapshots for this tenant.'}</p>{state==='error'&&<button className="primary-button" onClick={()=>setReload(value=>value+1)}>Retry owner review</button>}</div>

  return <div className="ops-page owner-review-page">
    <section className="screen-heading owner-review-heading"><div><span className="demo-label">{liveMode?'Owner-only governance evidence':'Sample owner governance review'}</span><h2>One session. Every consequential signal.</h2><p>Review the business without returning to daily operations or exposing individual client identities.</p></div><button className="primary-button" onClick={generate} disabled={generating}><ArrowsClockwise className={generating?'spinning':''} weight="bold"/>{generating?'Generating…':'Generate 30-day review'}</button></section>

    <section className="owner-review-boundary-band"><ShieldCheck weight="fill"/><div><strong>Immutable and identity-free</strong><p>Each review is digest-protected, excludes estimated revenue, and preserves unavailable metrics instead of inventing them.</p></div><span>Owner access only</span></section>

    {error&&<section className="owner-review-error" role="alert"><WarningCircle weight="fill"/><span>{error}</span><button aria-label="Dismiss owner review error" onClick={()=>setError('')}><X weight="bold"/></button></section>}

    {selected?<section className="owner-review-workspace">
      <aside className="ops-panel owner-review-history"><header><div><h3>Review history</h3><p>Up to twelve immutable snapshots.</p></div><span>{snapshots.length}</span></header><div>{snapshots.map(snapshot=><button key={snapshot.id} className={snapshot.id===selected.id?'selected':''} onClick={()=>setSelectedId(snapshot.id)}><span className={snapshot.report.reviewStatus==='ready'?'ready':'attention'}>{snapshot.report.reviewStatus==='ready'?<CheckCircle weight="fill"/>:<WarningCircle weight="fill"/>}</span><span><strong>{monthLabel(snapshot.periodFrom,snapshot.periodTo)}</strong><small>{snapshot.report.actionItems.length} action items · {formatDate(snapshot.createdAt)}</small></span><CaretRight weight="bold"/></button>)}</div></aside>
      <section className="owner-review-detail">
        <ReviewHeader snapshot={selected}/>
        <ReviewSummary report={selected.report}/>
        <ActionItems report={selected.report} onNavigate={onNavigate}/>
        <EvidenceGrid report={selected.report} onNavigate={onNavigate}/>
        <ReviewFooter snapshot={selected}/>
      </section>
    </section>:<section className="ops-panel owner-review-empty"><ClipboardText weight="duotone"/><div><h3>No monthly owner review yet</h3><p>Generate the first 30-day snapshot to capture revenue, operational risk, governance evidence, and proposed experiments.</p></div><button className="primary-button" onClick={generate} disabled={generating}>{generating?'Generating…':'Generate first review'}</button></section>}
  </div>
}

function ReviewHeader({snapshot}:{snapshot:ApiMonthlyOwnerReviewSnapshot}){
  const attention=snapshot.report.reviewStatus==='attention_required'
  return <section className={`owner-review-state ${attention?'attention':'ready'}`}><div><span>{attention?<WarningCircle weight="fill"/>:<CheckCircle weight="fill"/>}</span><div><small>{attention?'Owner attention required':'Review ready'}</small><h3>{monthLabel(snapshot.periodFrom,snapshot.periodTo)}</h3><p>Generated {formatDateTime(snapshot.createdAt)}</p></div></div><dl><div><dt>Action items</dt><dd>{snapshot.report.actionItems.length}</dd></div><div><dt>Critical</dt><dd className={snapshot.report.actionItems.some(value=>value.severity==='critical')?'danger-text':''}>{snapshot.report.actionItems.filter(value=>value.severity==='critical').length}</dd></div><div><dt>Snapshot</dt><dd>{snapshot.id.slice(0,8)}</dd></div></dl></section>
}

function ReviewSummary({report}:{report:ApiMonthlyOwnerReviewReport}){
  const churn=report.revenue.churn
  return <section className="owner-review-summary"><article className="owner-review-revenue"><span>Verified recovered revenue</span><strong>{formatCurrencyTotals(report.revenue.verifiedRecoveredRevenueMinorByCurrency)}</strong><small><SealCheck weight="fill"/> Single-touch booking evidence</small></article><article><span>Recovered bookings</span><strong>{report.revenue.recoveredBookings}</strong><small>Provider-confirmed outcomes</small></article><article><span>Client churn</span><strong className={churn.status==='available'&&churn.churnRate>.1?'warning-text':''}>{churn.status==='available'?percent(churn.churnRate):'Unavailable'}</strong><small>{churn.status==='available'?`${churn.churnedClients} churned · ${churn.newlyActiveClients} newly active`:'Missing exact-period cohort evidence'}</small></article><article><span>Marketing opt-outs</span><strong>{percent(report.messagingOptOuts.currentMarketingOptOutRate)}</strong><small>{report.messagingOptOuts.currentMarketingOptOuts} of {report.messagingOptOuts.currentMarketingConsentRecords} current records</small></article></section>
}

function ActionItems({report,onNavigate}:{report:ApiMonthlyOwnerReviewReport;onNavigate:(view:string)=>void}){
  const ordered=[...report.actionItems].sort((a,b)=>severityRank(a.severity)-severityRank(b.severity))
  return <section className="ops-panel owner-action-panel"><header className="ops-panel-header"><div><h3>Owner action queue</h3><p>Deterministically classified signals; no narrative client data is copied into this review.</p></div><span className={`status-badge ${ordered.some(value=>value.severity==='critical')?'danger':ordered.some(value=>value.severity==='warning')?'warning':'success'}`}>{ordered.length?`${ordered.length} items`:'Clear'}</span></header>{ordered.length?<div className="owner-action-list">{ordered.map(item=>{const destination=actionDestination(item.key);return <article key={item.key}><span className={item.severity}>{item.severity==='critical'?<WarningCircle weight="fill"/>:item.severity==='warning'?<ShieldStar weight="fill"/>:<ClipboardText weight="fill"/>}</span><div><strong>{actionLabel(item.key)}</strong><p>{item.detail}</p></div><b>{item.severity}</b>{destination&&<button className="text-button" onClick={()=>onNavigate(destination)}>{destination==='Campaigns'?'Review experiments':destination==='Approvals'?'Open approvals':'Inspect controls'}<CaretRight weight="bold"/></button>}</article>})}</div>:<div className="owner-action-empty"><CheckCircle weight="duotone"/><span><strong>No critical or warning actions</strong><small>Informational gaps remain visible in the evidence cards below.</small></span></div>}</section>
}

function EvidenceGrid({report,onNavigate}:{report:ApiMonthlyOwnerReviewReport;onNavigate:(view:string)=>void}){
  const complaintSignals=report.complaints.complaintConversations+report.complaints.medicalSafetyConversations+report.complaints.negativeReviewFeedback+report.complaints.serviceRecoveryApprovals
  const integrationIssues=report.integrationHealth.providerCircuits.open+report.integrationHealth.providerCircuits.halfOpen+report.integrationHealth.reconciliation.missing+report.integrationHealth.reconciliation.stale+report.integrationHealth.reconciliation.unclean
  const securityIssues=report.securityAlerts.auditIntegrity.broken+report.securityAlerts.rateLimitBreaches+report.securityAlerts.incidents.open+report.securityAlerts.incidents.contained
  return <section className="owner-evidence-grid">
    <EvidenceCard icon={<UsersThree weight="duotone"/>} title="Approvals & complaints" status={report.approvalBacklog.pending||complaintSignals?'attention':'clear'} onOpen={()=>onNavigate('Approvals')}><dl><Metric label="Pending approvals" value={report.approvalBacklog.pending}/><Metric label="Older than seven days" value={report.approvalBacklog.olderThanSevenDays}/><Metric label="Complaint signals" value={complaintSignals}/><Metric label="Medical-safety signals" value={report.complaints.medicalSafetyConversations}/></dl></EvidenceCard>
    <EvidenceCard icon={<Coins weight="duotone"/>} title="Model usage cost" status={report.modelCost.status==='available'?'clear':report.modelCost.status}><dl><Metric label="Cost" value={formatModelCost(report.modelCost.costMicroMinorByCurrency)}/><Metric label="Usage records" value={report.modelCost.usageRecords}/><Metric label="Unpriced responses" value={report.modelCost.unpricedUsageRecords}/><Metric label="Total tokens" value={formatNumber(report.modelCost.tokens.total)}/></dl>{report.modelCost.status!=='available'&&<p className="owner-evidence-note">{report.modelCost.reason??'Cost remains partial until every reported response has an effective owner-attested price version.'}</p>}</EvidenceCard>
    <EvidenceCard icon={<Plugs weight="duotone"/>} title="Integration health" status={integrationIssues?'attention':'clear'} onOpen={()=>onNavigate('Integrations')}><dl><Metric label="Open circuits" value={report.integrationHealth.providerCircuits.open}/><Metric label="Half-open circuits" value={report.integrationHealth.providerCircuits.halfOpen}/><Metric label="Missing reconciliations" value={report.integrationHealth.reconciliation.missing}/><Metric label="Unclean reconciliations" value={report.integrationHealth.reconciliation.unclean}/></dl></EvidenceCard>
    <EvidenceCard icon={<ShieldStar weight="duotone"/>} title="Security evidence" status={securityIssues?'attention':'clear'} onOpen={()=>onNavigate('Integrations')}><dl><Metric label="Broken audit chains" value={report.securityAlerts.auditIntegrity.broken}/><Metric label="Verified audit chains" value={report.securityAlerts.auditIntegrity.verified}/><Metric label="Rate-limit breaches" value={report.securityAlerts.rateLimitBreaches}/><Metric label="Active SEV1 incidents" value={report.securityAlerts.incidents.sev1Active}/></dl></EvidenceCard>
    <EvidenceCard icon={<Flask weight="duotone"/>} title="Proposed experiments" status={report.proposedExperiments.drafts.length?'information':'clear'} onOpen={()=>onNavigate('Campaigns')}><dl><Metric label="Drafts awaiting review" value={report.proposedExperiments.drafts.length}/><Metric label="Active" value={report.proposedExperiments.active}/><Metric label="Paused" value={report.proposedExperiments.paused}/><Metric label="Automatic activation" value="Disabled"/></dl>{report.proposedExperiments.drafts.length>0&&<div className="owner-draft-list">{report.proposedExperiments.drafts.slice(0,3).map(draft=><span key={draft.id}><strong>{draft.name}</strong><small>{workflowLabel(draft.workflowType)}</small></span>)}</div>}</EvidenceCard>
    <EvidenceCard icon={<MegaphoneSimple weight="duotone"/>} title="Messaging consent" status="clear"><dl><Metric label="Current consent records" value={report.messagingOptOuts.currentMarketingConsentRecords}/><Metric label="Current opt-outs" value={report.messagingOptOuts.currentMarketingOptOuts}/><Metric label="Opt-out rate" value={percent(report.messagingOptOuts.currentMarketingOptOutRate)}/><Metric label="Metric boundary" value="Current snapshot"/></dl></EvidenceCard>
  </section>
}

function EvidenceCard({icon,title,status,onOpen,children}:{icon:ReactNode;title:string;status:'clear'|'attention'|'partial'|'unavailable'|'information';onOpen?:()=>void;children:ReactNode}){return <article className="ops-panel owner-evidence-card"><header><span>{icon}</span><div><h3>{title}</h3><small className={status}>{evidenceLabel(status)}</small></div>{onOpen&&<button aria-label={`Open ${title}`} onClick={onOpen}><CaretRight weight="bold"/></button>}</header>{children}</article>}
function Metric({label,value}:{label:string;value:string|number}){return <div><dt>{label}</dt><dd>{value}</dd></div>}

function ReviewFooter({snapshot}:{snapshot:ApiMonthlyOwnerReviewSnapshot}){return <section className="owner-review-integrity"><LockKey weight="fill"/><div><strong>Snapshot integrity sealed</strong><p>SHA-256 digest over the canonical identity-free report. This snapshot cannot be edited after generation.</p></div><code title={snapshot.reportDigest}>{snapshot.reportDigest}</code><span><CheckCircle weight="fill"/>No client identities</span></section>}

function severityRank(value:'critical'|'warning'|'information'){return{critical:0,warning:1,information:2}[value]}
function actionLabel(key:string){return key.split('_').map(value=>value.charAt(0).toUpperCase()+value.slice(1)).join(' ')}
function actionDestination(key:string){if(key.includes('approval')||key.includes('complaint'))return'Approvals';if(key.includes('experiment'))return'Campaigns';if(key.includes('integration')||key.includes('security')||key.includes('audit'))return'Integrations';return''}
function evidenceLabel(value:string){return{clear:'Evidence clear',attention:'Attention required',partial:'Partial evidence',unavailable:'Unavailable',information:'Owner review'}[value]??value}
function workflowLabel(value:string){return value.split('_').map(part=>part.charAt(0).toUpperCase()+part.slice(1)).join(' ')}
function percent(value:number){return`${(value*100).toFixed(value===0||value===1?0:1)}%`}
function formatDate(value:string){return new Intl.DateTimeFormat('en-GB',{dateStyle:'medium'}).format(new Date(value))}
function formatDateTime(value:string){return new Intl.DateTimeFormat('en-GB',{dateStyle:'medium',timeStyle:'short'}).format(new Date(value))}
function monthLabel(from:string,to:string){const start=new Date(from);const end=new Date(to);const format=new Intl.DateTimeFormat('en-GB',{month:'short',year:'numeric'});return start.getUTCMonth()===end.getUTCMonth()?format.format(start):`${format.format(start)}–${format.format(end)}`}
function formatNumber(value:number){return new Intl.NumberFormat('en-GB').format(value)}
function formatModelCost(values:Record<string,number>){const entries=Object.entries(values);if(!entries.length)return'Unavailable';return entries.map(([currency,microMinor])=>new Intl.NumberFormat('en-GB',{style:'currency',currency,minimumFractionDigits:2,maximumFractionDigits:4}).format(microMinor/100_000_000)).join(' · ')}
function message(reason:unknown){return reason instanceof Error?reason.message:'The monthly owner review could not be loaded.'}

const now='2026-07-22T12:00:00.000Z'
const demoReport:ApiMonthlyOwnerReviewReport={tenantId:'sample-tenant',period:{from:'2026-06-22T12:00:00.000Z',to:now},reviewStatus:'attention_required',revenue:{verifiedRecoveredRevenueMinorByCurrency:{GBP:8900000},recoveredBookings:297,evidence:'verified_booking_single_touch',churn:{status:'available',snapshotId:'cohort-july',policyVersion:'active-client-180d-v1',activityWindowDays:180,startActiveClients:1480,endActiveClients:1512,retainedClients:1394,churnedClients:86,newlyActiveClients:118,churnRate:.0581,evidence:'square_completed_bookings'}},approvalBacklog:{pending:3,olderThanSevenDays:1,oldestPendingAt:'2026-07-10T09:00:00.000Z',byType:{service_recovery:2,integration_reconnect:1}},complaints:{complaintConversations:4,medicalSafetyConversations:1,negativeReviewFeedback:2,serviceRecoveryApprovals:2,evidence:'bounded_operational_signals'},messagingOptOuts:{currentMarketingConsentRecords:1800,currentMarketingOptOuts:72,currentMarketingOptOutRate:.04,evidence:'current_record_snapshot_not_period_flow'},modelCost:{status:'partial',usageRecords:2840,reportedUsageRecords:2812,missingUsageRecords:28,pricedUsageRecords:2780,unpricedUsageRecords:32,tokens:{input:8450000,cachedInput:1900000,output:2360000,reasoning:410000,total:10810000},costMicroMinorByCurrency:{GBP:1895000000},evidence:'provider_reported_usage_with_owner_attested_price_versions'},integrationHealth:{status:'attention_required',providerCircuits:{open:1,halfOpen:0},reconciliation:{clean:7,missing:0,stale:1,unclean:0}},securityAlerts:{status:'attention_required',auditIntegrity:{verified:3,empty:0,legacyOnly:0,broken:0},rateLimitBreaches:1,incidents:{open:0,contained:0,sev1Active:0}},proposedExperiments:{drafts:[{id:'draft-review-copy',locationId:'chelsea',name:'Post-visit timing language',workflowType:'post_visit_rebook',createdAt:'2026-07-18T10:30:00.000Z'}],active:3,paused:0,autoActivation:false},actionItems:[{key:'approval_backlog',severity:'critical',detail:'3 approval requests are pending; 1 has waited more than seven days.'},{key:'complaint_signals',severity:'critical',detail:'9 bounded complaint or service-recovery signals require owner review.'},{key:'integration_health',severity:'critical',detail:'Provider evidence: 1 open circuit and 1 stale reconciliation state require review.'},{key:'security_signals',severity:'warning',detail:'Security evidence requires review: 1 breached rate-limit window.'},{key:'proposed_experiments',severity:'information',detail:'1 draft experiment awaits explicit manager review; none were activated automatically.'},{key:'model_cost_partial',severity:'warning',detail:'Model cost is partial because some responses lacked usage or an effective price version.'}],dataQuality:{containsClientIdentities:false,estimatedRevenueIncluded:false,unavailableMetrics:['model_cost'],snapshotDigestAlgorithm:'sha256'},generatedAt:now}
const previousReport:ApiMonthlyOwnerReviewReport={...demoReport,period:{from:'2026-05-22T12:00:00.000Z',to:'2026-06-21T12:00:00.000Z'},reviewStatus:'ready',revenue:{...demoReport.revenue,verifiedRecoveredRevenueMinorByCurrency:{GBP:8125000},recoveredBookings:274},approvalBacklog:{pending:0,olderThanSevenDays:0,byType:{}},complaints:{...demoReport.complaints,complaintConversations:0,medicalSafetyConversations:0,negativeReviewFeedback:0,serviceRecoveryApprovals:0},integrationHealth:{status:'healthy',providerCircuits:{open:0,halfOpen:0},reconciliation:{clean:8,missing:0,stale:0,unclean:0}},securityAlerts:{status:'clear',auditIntegrity:{verified:3,empty:0,legacyOnly:0,broken:0},rateLimitBreaches:0,incidents:{open:0,contained:0,sev1Active:0}},proposedExperiments:{drafts:[],active:2,paused:0,autoActivation:false},actionItems:[],dataQuality:{...demoReport.dataQuality,unavailableMetrics:[]},generatedAt:'2026-06-21T12:30:00.000Z'}
const demoSnapshots:ApiMonthlyOwnerReviewSnapshot[]=[{id:'review-july-2026',tenantId:'sample-tenant',periodFrom:demoReport.period.from,periodTo:demoReport.period.to,report:demoReport,reportDigest:'8aa92e89c8f944b96f1bba30eaf43534076e0696a89d31cd8f38339098058567',createdBy:'demo-owner',createdAt:now},{id:'review-june-2026',tenantId:'sample-tenant',periodFrom:previousReport.period.from,periodTo:previousReport.period.to,report:previousReport,reportDigest:'bd8d39aabdc979417d4c51933d046138e2aebd9cf6a2c15079f133659f9da589',createdBy:'demo-owner',createdAt:previousReport.generatedAt}]
function demoGenerated(from:Date,to:Date):ApiMonthlyOwnerReviewSnapshot{const createdAt=new Date().toISOString();const report={...demoReport,period:{from:from.toISOString(),to:to.toISOString()},generatedAt:createdAt};return{id:`review-${Date.now()}`,tenantId:'sample-tenant',periodFrom:report.period.from,periodTo:report.period.to,report,reportDigest:'11ae3d798d474134a52480b972a30a2ccb7962d8e6b98086308606f922db36d7',createdBy:'demo-owner',createdAt}}
