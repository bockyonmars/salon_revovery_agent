import { ArrowsClockwise, Buildings, CheckCircle, Coins, Flask, ShieldCheck, WarningCircle } from '@phosphor-icons/react'
import { useEffect, useState } from 'react'
import { loadTenantPortfolio, type ApiTenantPortfolioLocation, type ApiTenantPortfolioReport } from '../operations-api'
import { formatCurrencyTotals } from '../verified-operations'

type LoadState='idle'|'loading'|'ready'|'error'

export function PortfolioScreen({liveMode,onNotify}:{liveMode:boolean;onNotify:(message:string)=>void}){
  const [days,setDays]=useState<7|30>(30)
  const [report,setReport]=useState<ApiTenantPortfolioReport>(demoReport)
  const [state,setState]=useState<LoadState>(liveMode?'loading':'idle')
  const [error,setError]=useState('')
  const [reload,setReload]=useState(0)

  useEffect(()=>{
    if(!liveMode){setReport(withDemoPeriod(days));setState('idle');setError('');return}
    let current=true
    const to=new Date();const from=new Date(to.getTime()-days*86_400_000)
    setState('loading');setError('')
    loadTenantPortfolio(from.toISOString(),to.toISOString()).then(value=>{if(current){setReport(value);setState('ready')}}).catch(reason=>{if(current){setError(message(reason));setState('error')}})
    return()=>{current=false}
  },[days,liveMode,reload])

  if(liveMode&&state!=='ready')return <div className="empty-workspace portfolio-boundary"><span>{state==='error'?<WarningCircle weight="fill"/>:<Buildings weight="duotone"/>}</span><h2>{state==='error'?'Owner portfolio unavailable':'Loading owner portfolio'}</h2><p>{state==='error'?error:'Aggregating identity-free operating evidence across this tenant’s locations.'}</p>{state==='error'&&<button className="primary-button" onClick={()=>setReload(value=>value+1)}>Retry portfolio</button>}</div>

  const locations=report.portfolio.locations
  const attention=locations.filter(needsAttention).length
  const totals=report.totals
  return <div className="ops-page portfolio-page">
    <section className="screen-heading portfolio-heading"><div><span className="demo-label">{liveMode?'Owner-only cross-location evidence':'Sample multi-location portfolio'}</span><h2>See every location without losing the operational truth.</h2><p>Verified recovered revenue, delivery health, workflow pressure, and experiment posture—aggregated without client identities.</p></div><div className="portfolio-heading-actions"><div className="segmented" aria-label="Portfolio reporting period"><button className={days===7?'selected':''} onClick={()=>setDays(7)}>7 days</button><button className={days===30?'selected':''} onClick={()=>setDays(30)}>30 days</button></div><button className="secondary-button" disabled={!liveMode||state==='loading'} onClick={()=>{setReload(value=>value+1);onNotify('Refreshing owner portfolio evidence.')}}><ArrowsClockwise className={state==='loading'?'spinning':''}/>Refresh</button></div></section>

    <section className="portfolio-summary" aria-label="Portfolio summary">
      <article className="portfolio-revenue-card"><span>Verified recovered revenue</span><strong>{formatCurrencyTotals(totals.verifiedRecoveredRevenueMinorByCurrency)}</strong><small><ShieldCheck weight="fill"/> Booking-level single-touch evidence only</small></article>
      <article><span>Recovered bookings</span><strong>{totals.recoveredBookings}</strong><small>{formatPeriod(report.period.from,report.period.to)}</small></article>
      <article><span>Message delivery</span><strong>{percent(totals.messaging.deliveryRate)}</strong><small>{totals.messaging.delivered} delivered · {totals.messaging.failed} failed</small></article>
      <article><span>Locations requiring attention</span><strong className={attention?'warning-text':'success-text'}>{attention}</strong><small>{report.portfolio.locationCount} locations in this tenant</small></article>
    </section>

    <section className="portfolio-evidence-note"><ShieldCheck weight="fill"/><div><strong>Identity-free operating evidence</strong><p>Estimated revenue and unattributed bookings are excluded. Consent figures are current-state snapshots, not period flows.{report.dataQuality.multipleCurrencies?' Currency totals remain separated.':''}</p></div><span>Generated {formatDate(report.generatedAt)}</span></section>

    <section className="ops-panel portfolio-table-panel">
      <header className="ops-panel-header"><div><h3>Location comparison</h3><p>Each row retains its own activation, billing, provider, delivery, workflow, and experiment evidence.</p></div><span className="status-badge success">{locations.length} locations</span></header>
      <div className="portfolio-table-head"><span>Location</span><span>Verified recovery</span><span>Delivery health</span><span>Operations</span><span>Experiments</span></div>
      <div className="portfolio-location-list">{locations.map(location=><LocationRow key={location.locationId} location={location}/>)}</div>
    </section>

    <section className="portfolio-operations-grid">
      <article className="ops-panel"><header><span><ArrowsClockwise weight="duotone"/></span><div><h3>Workflow pressure</h3><p>Current backlog across all locations</p></div></header><dl><div><dt>Pending</dt><dd>{totals.operations.pendingWorkflows}</dd></div><div><dt>Running</dt><dd>{totals.operations.runningWorkflows}</dd></div><div><dt>Failed</dt><dd className={totals.operations.failedWorkflows?'danger-text':''}>{totals.operations.failedWorkflows}</dd></div><div><dt>Paused</dt><dd>{totals.operations.pausedWorkflows}</dd></div></dl></article>
      <article className="ops-panel"><header><span><WarningCircle weight="duotone"/></span><div><h3>Control attention</h3><p>Human and provider intervention</p></div></header><dl><div><dt>Pending approvals</dt><dd>{totals.operations.pendingApprovals}</dd></div><div><dt>Open circuits</dt><dd className={totals.providerCircuits.open?'danger-text':''}>{totals.providerCircuits.open}</dd></div><div><dt>Half-open circuits</dt><dd>{totals.providerCircuits.halfOpen}</dd></div><div><dt>Open recovery cases</dt><dd>{totals.recoveryCases.open}</dd></div></dl></article>
      <article className="ops-panel"><header><span><Flask weight="duotone"/></span><div><h3>Experiment posture</h3><p>Never automatically promoted</p></div></header><dl><div><dt>Active</dt><dd>{totals.experiments.active}</dd></div><div><dt>Draft</dt><dd>{totals.experiments.draft}</dd></div><div><dt>Paused</dt><dd>{totals.experiments.paused}</dd></div><div><dt>Automatic winners</dt><dd>Disabled</dd></div></dl></article>
    </section>
  </div>
}

function LocationRow({location}:{location:ApiTenantPortfolioLocation}){
  const attention=needsAttention(location)
  const workflowPressure=location.operations.pendingWorkflows+location.operations.failedWorkflows+location.operations.pausedWorkflows
  return <article className="portfolio-location-row">
    <div className="portfolio-location-name"><span className={attention?'warning':'ready'}>{attention?<WarningCircle weight="fill"/>:<CheckCircle weight="fill"/>}</span><div><strong>{location.locationName}</strong><small>{label(location.activationStatus)} activation · {label(location.billingStatus)} billing</small></div></div>
    <div><strong>{formatCurrencyTotals(location.verifiedRecoveredRevenueMinorByCurrency)}</strong><small>{location.recoveredBookings} recovered {location.recoveredBookings===1?'booking':'bookings'}</small></div>
    <div className="portfolio-delivery"><strong>{percent(location.messaging.deliveryRate)}</strong><span><i style={{width:`${Math.round(location.messaging.deliveryRate*100)}%`}}/></span><small>{location.messaging.attempted} attempts · {percent(location.messaging.currentMarketingOptOutRate)} opted out</small></div>
    <div><strong className={workflowPressure||location.operations.pendingApprovals?'warning-text':''}>{workflowPressure+location.operations.pendingApprovals} items</strong><small>{location.operations.failedWorkflows} failed · {location.operations.pendingApprovals} approvals · {location.providerCircuits.open} open circuits</small></div>
    <div><strong>{location.experiments.active} active</strong><small>{location.experiments.draft} draft · {location.experiments.paused} paused</small></div>
  </article>
}

function needsAttention(location:ApiTenantPortfolioLocation){return location.activationStatus!=='active'||!['active','trialing'].includes(location.billingStatus)||location.providerCircuits.open>0||location.providerCircuits.halfOpen>0||location.operations.failedWorkflows>0||location.operations.pendingApprovals>0}
function percent(value:number){return`${(value*100).toFixed(value===0||value===1?0:1)}%`}
function label(value:string){return value.split('_').map(part=>`${part[0]?.toUpperCase()??''}${part.slice(1)}`).join(' ')}
function formatDate(value:string){return new Intl.DateTimeFormat('en-GB',{dateStyle:'medium',timeStyle:'short'}).format(new Date(value))}
function formatPeriod(from:string,to:string){return`${new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short'}).format(new Date(from))}–${new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short'}).format(new Date(to))}`}
function message(reason:unknown){return reason instanceof Error?reason.message:'The owner portfolio could not be loaded.'}

const demoReport:ApiTenantPortfolioReport={tenantId:'sample-tenant',period:{from:'2026-06-22T12:00:00.000Z',to:'2026-07-22T12:00:00.000Z'},portfolio:{locationCount:3,locations:[
  demoLocation('mayfair','Mayfair Flagship',{revenue:4289000,bookings:142,delivery:.991,active:'active'}),
  demoLocation('chelsea','Chelsea Studio',{revenue:2746000,bookings:91,delivery:.982,active:'active',approvals:1,drafts:1}),
  demoLocation('shoreditch','Shoreditch House',{revenue:1865000,bookings:64,delivery:.964,active:'draft',failed:1,circuits:1}),
]},totals:{verifiedRecoveredRevenueMinorByCurrency:{GBP:8900000},recoveredBookings:297,recoveryCases:{opened:321,resolved:297,closed:12,open:12},messaging:{attempted:3000,delivered:2937,failed:63,deliveryRate:.979,currentMarketingConsentRecords:1800,currentMarketingOptOuts:72,currentMarketingOptOutRate:.04},operations:{pendingWorkflows:12,runningWorkflows:3,failedWorkflows:1,pausedWorkflows:0,pendingApprovals:1},experiments:{active:3,draft:1,paused:0},providerCircuits:{open:1,halfOpen:0}},dataQuality:{revenueEvidence:'verified_booking_single_touch',estimatedRevenueIncluded:false,unattributedBookingsIncluded:false,multipleCurrencies:false,consentMetric:'current_record_snapshot_not_period_flow',containsClientIdentities:false},generatedAt:'2026-07-22T12:00:00.000Z'}

function demoLocation(locationId:string,locationName:string,input:{revenue:number;bookings:number;delivery:number;active:'active'|'draft';approvals?:number;drafts?:number;failed?:number;circuits?:number}):ApiTenantPortfolioLocation{return{locationId,locationName,settingsConfigured:true,activationStatus:input.active,billingStatus:'active',providerCircuits:{open:input.circuits??0,halfOpen:0},verifiedRecoveredRevenueMinorByCurrency:{GBP:input.revenue},recoveredBookings:input.bookings,recoveryCases:{opened:input.bookings+8,resolved:input.bookings,closed:4,open:4},messaging:{attempted:1000,delivered:Math.round(1000*input.delivery),failed:Math.round(1000*(1-input.delivery)),deliveryRate:input.delivery,currentMarketingConsentRecords:600,currentMarketingOptOuts:24,currentMarketingOptOutRate:.04},operations:{pendingWorkflows:4,runningWorkflows:1,failedWorkflows:input.failed??0,pausedWorkflows:0,pendingApprovals:input.approvals??0},experiments:{active:1,draft:input.drafts??0,paused:0}}}
function withDemoPeriod(days:7|30):ApiTenantPortfolioReport{const to=new Date(demoReport.period.to);const from=new Date(to.getTime()-days*86_400_000);return{...demoReport,period:{from:from.toISOString(),to:to.toISOString()}}}
