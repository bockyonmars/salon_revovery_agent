import {
  ArrowRight,
  Buildings,
  Check,
  CheckCircle,
  ClipboardText,
  Eye,
  Handshake,
  IdentificationCard,
  LockKey,
  ShieldCheck,
  Trash,
  WarningCircle,
  X,
} from '@phosphor-icons/react'
import { FormEvent, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  acceptAgencyInvitation,
  createAgencyInvitation,
  loadAgencyAccess,
  loadAgencyClientPortfolio,
  previewAgencyInvitation,
  revokeAgencyGrant,
  saveAgencyAccount,
  type ApiAgencyAccount,
  type ApiAgencyGrant,
  type ApiAgencyInvitation,
  type ApiAgencyInvitationPreview,
  type ApiTenantPortfolioReport,
} from '../operations-api'
import { formatCurrencyTotals } from '../verified-operations'

type LoadState='idle'|'loading'|'ready'|'error'
type BusyAction='account'|'invite'|'preview'|'accept'|'revoke'|'portfolio'|''
type OneTimeInvitation={invitation:ApiAgencyInvitation;token:string}

export function AgencyAccessScreen({liveMode,onNotify}:{liveMode:boolean;onNotify:(message:string)=>void}){
  const [account,setAccount]=useState<ApiAgencyAccount|null>(liveMode?null:demoAccount)
  const [agencyGrants,setAgencyGrants]=useState<ApiAgencyGrant[]>(liveMode?[]:demoAgencyGrants)
  const [clientGrants,setClientGrants]=useState<ApiAgencyGrant[]>(liveMode?[]:demoClientGrants)
  const [state,setState]=useState<LoadState>(liveMode?'loading':'idle')
  const [busy,setBusy]=useState<BusyAction>('')
  const [error,setError]=useState('')
  const [reload,setReload]=useState(0)
  const [oneTimeInvitation,setOneTimeInvitation]=useState<OneTimeInvitation|null>(null)
  const [inviteToken,setInviteToken]=useState('')
  const [preview,setPreview]=useState<ApiAgencyInvitationPreview|null>(null)
  const [acceptConfirmed,setAcceptConfirmed]=useState(false)
  const [revoking,setRevoking]=useState<ApiAgencyGrant|null>(null)
  const [portfolio,setPortfolio]=useState<{clientTenantId:string;report:ApiTenantPortfolioReport}|null>(null)

  useEffect(()=>{
    setOneTimeInvitation(null)
    setPreview(null)
    setAcceptConfirmed(false)
    setPortfolio(null)
    if(!liveMode){setAccount(demoAccount);setAgencyGrants(demoAgencyGrants);setClientGrants(demoClientGrants);setState('idle');setError('');return}
    let current=true
    setState('loading');setError('')
    loadAgencyAccess().then(value=>{if(current){setAccount(value.account);setAgencyGrants(value.agencyGrants);setClientGrants(value.clientGrants);setState('ready')}}).catch(reason=>{if(current){setError(message(reason));setState('error')}})
    return()=>{current=false}
  },[liveMode,reload])

  const activeAgencyGrants=useMemo(()=>agencyGrants.filter(grant=>grant.status==='active'),[agencyGrants])
  const activeClientGrants=useMemo(()=>clientGrants.filter(grant=>grant.status==='active'),[clientGrants])

  async function saveAccount(event:FormEvent<HTMLFormElement>){
    event.preventDefault();const form=new FormData(event.currentTarget);const displayName=String(form.get('displayName')??'').trim();const supportEmail=String(form.get('supportEmail')??'').trim()
    setBusy('account');setError('')
    try{const saved=liveMode?await saveAgencyAccount({displayName,...(supportEmail?{supportEmail}:{})}):{...demoAccount,displayName,...(supportEmail?{supportEmail}:{supportEmail:undefined}),updatedAt:new Date().toISOString()};setAccount(saved);onNotify('Agency identity saved with owner evidence.')}
    catch(reason){setError(message(reason))}finally{setBusy('')}
  }

  async function issueInvitation(event:FormEvent<HTMLFormElement>){
    event.preventDefault();const form=new FormData(event.currentTarget);const clientTenantId=String(form.get('clientTenantId')??'').trim();const expiresInDays=Number(form.get('expiresInDays'))
    setBusy('invite');setError('');setOneTimeInvitation(null)
    try{const created=liveMode?await createAgencyInvitation({clientTenantId,expiresInDays}):demoInvitation(clientTenantId,expiresInDays);setOneTimeInvitation({invitation:created.invitation,token:created.acceptanceToken});event.currentTarget.reset();onNotify('One-time invitation created. Copy it before closing the handoff.')}
    catch(reason){setError(message(reason))}finally{setBusy('')}
  }

  async function inspectInvitation(event:FormEvent<HTMLFormElement>){
    event.preventDefault();const token=inviteToken.trim();setBusy('preview');setError('');setPreview(null);setAcceptConfirmed(false)
    try{const result=liveMode?await previewAgencyInvitation(token):demoPreview;setPreview(result)}catch(reason){setError(message(reason))}finally{setBusy('')}
  }

  async function acceptInvitation(){
    const token=inviteToken.trim();setBusy('accept');setError('')
    try{const result=liveMode?await acceptAgencyInvitation(token):demoAcceptance;setClientGrants(current=>[result.grant,...current.filter(grant=>grant.id!==result.grant.id)]);setInviteToken('');setPreview(null);setAcceptConfirmed(false);onNotify(result.duplicate?'This agency relationship was already active.':'Agency access accepted with owner evidence.')}
    catch(reason){setError(message(reason))}finally{setBusy('')}
  }

  async function revoke(event:FormEvent<HTMLFormElement>){
    event.preventDefault();if(!revoking)return;const reason=String(new FormData(event.currentTarget).get('reason')??'').trim();setBusy('revoke');setError('')
    try{const result=liveMode?await revokeAgencyGrant(revoking.id,reason):{...revoking,status:'revoked' as const,revokedAt:new Date().toISOString(),revokeReason:reason};setAgencyGrants(current=>current.map(grant=>grant.id===result.id?result:grant));setClientGrants(current=>current.map(grant=>grant.id===result.id?result:grant));if(portfolio&&portfolio.clientTenantId===result.clientTenantId)setPortfolio(null);setRevoking(null);onNotify('Agency portfolio access revoked immediately.')}
    catch(reason){setError(message(reason))}finally{setBusy('')}
  }

  async function viewPortfolio(grant:ApiAgencyGrant){
    setBusy('portfolio');setError('')
    const to=new Date();const from=new Date(to.getTime()-30*86_400_000)
    try{const result=liveMode?await loadAgencyClientPortfolio(grant.clientTenantId,from.toISOString(),to.toISOString()):{report:demoPortfolio};setPortfolio({clientTenantId:grant.clientTenantId,report:result.report})}
    catch(reason){setError(message(reason))}finally{setBusy('')}
  }

  if(liveMode&&state!=='ready')return <div className="empty-workspace agency-boundary"><span>{state==='error'?<WarningCircle weight="fill"/>:<Handshake weight="duotone"/>}</span><h2>{state==='error'?'Agency access unavailable':'Loading agency access'}</h2><p>{state==='error'?error:'Reading owner-only bilateral grants and aggregate portfolio permissions.'}</p>{state==='error'&&<button className="primary-button" onClick={()=>setReload(value=>value+1)}>Retry access</button>}</div>

  return <div className="ops-page agency-page">
    <section className="screen-heading agency-heading"><div><span className="demo-label">{liveMode?'Owner-only bilateral controls':'Sample agency control room'}</span><h2>Portfolio access starts with two owners.</h2><p>Invite, inspect, accept, and revoke aggregate-only agency relationships without exposing client identities.</p></div><div className="agency-heading-state"><span><ShieldCheck weight="fill"/></span><div><small>Active relationships</small><strong>{activeAgencyGrants.length+activeClientGrants.length}</strong></div></div></section>

    <section className="agency-trust-band"><LockKey weight="fill"/><div><strong>Read-only by design</strong><p>Every grant is limited to identity-free portfolio aggregates. An agency cannot message clients, change operations, or inspect individual bookings.</p></div><span>Scope · portfolio_read</span></section>

    {error&&<section className="agency-error" role="alert"><WarningCircle weight="fill"/><span>{error}</span><button aria-label="Dismiss error" onClick={()=>setError('')}><X weight="bold"/></button></section>}

    <section className="agency-setup-grid">
      <article className="ops-panel agency-form-panel">
        <header className="ops-panel-header"><div><h3><IdentificationCard weight="duotone"/> Agency identity</h3><p>Required before this tenant can invite salon groups.</p></div><span className={`status-badge ${account?'success':'warning'}`}>{account?'Configured':'Required'}</span></header>
        <form onSubmit={saveAccount} className="agency-form">
          <label><span>Agency display name</span><input name="displayName" defaultValue={account?.displayName??''} minLength={3} maxLength={120} required disabled={busy==='account'}/></label>
          <label><span>Support email <small>Optional</small></span><input name="supportEmail" type="email" defaultValue={account?.supportEmail??''} disabled={busy==='account'}/></label>
          <footer><small>Changes are attributed to the signed-in tenant owner.</small><button className="secondary-button" disabled={Boolean(busy)}>{busy==='account'?'Saving…':account?'Update identity':'Save identity'}</button></footer>
        </form>
      </article>

      <article className="ops-panel agency-form-panel">
        <header className="ops-panel-header"><div><h3><Handshake weight="duotone"/> Invite a client tenant</h3><p>Create a one-time owner acceptance credential.</p></div><span className="status-badge champagne">Aggregate only</span></header>
        <form onSubmit={issueInvitation} className="agency-form agency-invite-form">
          <label><span>Client tenant ID</span><input name="clientTenantId" minLength={3} maxLength={200} placeholder="salon-group-tenant" required disabled={!account||Boolean(busy)}/></label>
          <label className="agency-expiry"><span>Expires in</span><select name="expiresInDays" defaultValue="7" disabled={!account||Boolean(busy)}><option value="1">1 day</option><option value="3">3 days</option><option value="7">7 days</option><option value="14">14 days</option><option value="30">30 days</option></select></label>
          <footer><small>{account?'The client owner must still preview and accept.':'Save an agency identity first.'}</small><button className="primary-button" disabled={!account||Boolean(busy)}>{busy==='invite'?'Creating…':'Create invitation'}</button></footer>
        </form>
      </article>
    </section>

    <section className="agency-workspace">
      <article className="ops-panel agency-relationships">
        <header className="ops-panel-header"><div><h3>Client portfolios</h3><p>Salon groups that granted this agency aggregate read access.</p></div><span className="status-badge success">{activeAgencyGrants.length} active</span></header>
        <div className="agency-grant-list">{agencyGrants.length?agencyGrants.map(grant=><GrantRow key={grant.id} grant={grant} side="agency" busy={busy} onView={()=>viewPortfolio(grant)} onRevoke={()=>setRevoking(grant)}/>):<EmptyGrant icon={<Buildings weight="duotone"/>} title="No client portfolios yet" detail="Create an invitation and have the client tenant owner accept it."/>}</div>
      </article>

      <article className="ops-panel agency-acceptance">
        <header className="ops-panel-header"><div><h3>Connect an agency</h3><p>Preview the exact scope before accepting as a client owner.</p></div><span className="status-badge warning">Owner decision</span></header>
        <form className="agency-token-form" onSubmit={inspectInvitation}>
          <label><span>One-time invitation token</span><input value={inviteToken} onChange={event=>{setInviteToken(event.target.value);setPreview(null);setAcceptConfirmed(false)}} minLength={43} maxLength={200} autoComplete="off" spellCheck={false} placeholder="Paste the credential received from the agency" required disabled={Boolean(busy)}/></label>
          <button className="secondary-button" disabled={Boolean(busy)}>{busy==='preview'?'Inspecting…':<><Eye weight="bold"/>Preview access</>}</button>
        </form>
        {preview?<div className="agency-preview"><header><span><CheckCircle weight="fill"/></span><div><small>Invitation from</small><strong>{preview.agency.displayName}</strong>{preview.agency.supportEmail&&<a href={`mailto:${preview.agency.supportEmail}`}>{preview.agency.supportEmail}</a>}</div></header><dl><div><dt>Scope</dt><dd>Portfolio aggregates only</dd></div><div><dt>Expires</dt><dd>{formatDate(preview.expiresAt)}</dd></div><div><dt>Client identities</dt><dd>Never included</dd></div></dl><label className="agency-confirm"><input type="checkbox" checked={acceptConfirmed} onChange={event=>setAcceptConfirmed(event.target.checked)}/><span>I understand this grants read-only aggregate portfolio access until revoked.</span></label><button className="primary-button" disabled={!acceptConfirmed||Boolean(busy)} onClick={acceptInvitation}>{busy==='accept'?'Accepting…':<>Accept agency <ArrowRight weight="bold"/></>}</button></div>:<div className="agency-preview-empty"><Eye weight="duotone"/><p><strong>Inspect before accepting</strong><span>The credential is sent in the request body and is never placed in the URL or saved in this browser.</span></p></div>}
      </article>
    </section>

    <section className="ops-panel agency-connected-panel">
      <header className="ops-panel-header"><div><h3>Agencies connected to this tenant</h3><p>Relationships this tenant accepted as the client owner.</p></div><span className="status-badge success">{activeClientGrants.length} active</span></header>
      <div className="agency-grant-list agency-client-list">{clientGrants.length?clientGrants.map(grant=><GrantRow key={grant.id} grant={grant} side="client" busy={busy} onRevoke={()=>setRevoking(grant)}/>):<EmptyGrant icon={<Handshake weight="duotone"/>} title="No connected agencies" detail="Paste an invitation above to inspect and accept an agency relationship."/>}</div>
    </section>

    {portfolio&&<PortfolioSummary clientTenantId={portfolio.clientTenantId} report={portfolio.report} onClose={()=>setPortfolio(null)}/>}
    {oneTimeInvitation&&<InvitationHandoff value={oneTimeInvitation} onClose={()=>setOneTimeInvitation(null)} onNotify={onNotify}/>}
    {revoking&&<RevokeDialog grant={revoking} busy={busy==='revoke'} onClose={()=>setRevoking(null)} onSubmit={revoke}/>}
  </div>
}

function GrantRow({grant,side,busy,onView,onRevoke}:{grant:ApiAgencyGrant;side:'agency'|'client';busy:BusyAction;onView?:()=>void;onRevoke:()=>void}){
  const active=grant.status==='active';const tenant=side==='agency'?grant.clientTenantId:grant.agencyTenantId
  return <article className="agency-grant-row"><span className={active?'active':'revoked'}>{active?<ShieldCheck weight="fill"/>:<LockKey weight="fill"/>}</span><div className="agency-grant-identity"><strong>{tenant}</strong><small>{side==='agency'?'Client tenant':'Agency tenant'} · accepted {formatDate(grant.createdAt)}</small></div><div className="agency-grant-scope"><small>Permitted scope</small><strong>Portfolio read</strong></div><span className={`status-badge ${active?'success':''}`}>{active?'Active':'Revoked'}</span><div className="agency-grant-actions">{active&&onView&&<button className="text-button" disabled={Boolean(busy)} onClick={onView}><Eye weight="bold"/>View portfolio</button>}{active&&<button className="text-button danger-text" disabled={Boolean(busy)} onClick={onRevoke}><Trash weight="bold"/>Revoke</button>}</div></article>
}

function EmptyGrant({icon,title,detail}:{icon:ReactNode;title:string;detail:string}){return <div className="agency-empty">{icon}<p><strong>{title}</strong><span>{detail}</span></p></div>}

function InvitationHandoff({value,onClose,onNotify}:{value:OneTimeInvitation;onClose:()=>void;onNotify:(message:string)=>void}){
  const [copied,setCopied]=useState(false)
  async function copy(){try{await navigator.clipboard.writeText(value.token);setCopied(true);onNotify('Invitation token copied. It will disappear when this handoff closes.')}catch{onNotify('Copy was blocked. Select the token and copy it manually.')}}
  return <div className="agency-dialog-backdrop" role="presentation"><section className="agency-dialog agency-handoff" role="dialog" aria-modal="true" aria-labelledby="agency-handoff-title"><header><span><ClipboardText weight="duotone"/></span><div><small>One-time handoff</small><h3 id="agency-handoff-title">Copy this invitation now.</h3></div><button aria-label="Close invitation" onClick={onClose}><X weight="bold"/></button></header><p>The token is shown once and is not retained after this panel closes. Send it to the owner of <strong>{value.invitation.clientTenantId}</strong> through your approved secure channel.</p><div className="agency-token"><code>{value.token}</code><button className={copied?'copied':''} onClick={copy}>{copied?<Check weight="bold"/>:<ClipboardText weight="bold"/>}{copied?'Copied':'Copy token'}</button></div><dl><div><dt>Scope</dt><dd>portfolio_read</dd></div><div><dt>Expires</dt><dd>{formatDate(value.invitation.expiresAt)}</dd></div></dl><footer><span><LockKey weight="fill"/>No token is written to local storage, session storage, the URL, or audit evidence.</span><button className="primary-button" onClick={onClose}>I have copied it</button></footer></section></div>
}

function RevokeDialog({grant,busy,onClose,onSubmit}:{grant:ApiAgencyGrant;busy:boolean;onClose:()=>void;onSubmit:(event:FormEvent<HTMLFormElement>)=>void}){
  return <div className="agency-dialog-backdrop" role="presentation"><section className="agency-dialog agency-revoke" role="dialog" aria-modal="true" aria-labelledby="agency-revoke-title"><header><span><WarningCircle weight="fill"/></span><div><small>Immediate access change</small><h3 id="agency-revoke-title">Revoke portfolio access?</h3></div><button aria-label="Close revocation" onClick={onClose}><X weight="bold"/></button></header><p>The active relationship between <strong>{grant.agencyTenantId}</strong> and <strong>{grant.clientTenantId}</strong> will stop immediately.</p><form onSubmit={onSubmit}><label><span>Reason for revocation</span><textarea name="reason" minLength={3} maxLength={500} placeholder="Document why this relationship is ending" required autoFocus disabled={busy}/></label><footer><button type="button" className="secondary-button" onClick={onClose} disabled={busy}>Keep access</button><button className="primary-button danger-button" disabled={busy}>{busy?'Revoking…':'Revoke access'}</button></footer></form></section></div>
}

function PortfolioSummary({clientTenantId,report,onClose}:{clientTenantId:string;report:ApiTenantPortfolioReport;onClose:()=>void}){
  return <section className="ops-panel agency-portfolio-summary"><header className="ops-panel-header"><div><span className="demo-label">Granted aggregate view</span><h3>{clientTenantId}</h3><p>{report.portfolio.locationCount} locations · {formatPeriod(report.period.from,report.period.to)}</p></div><button className="icon-button" aria-label="Close client portfolio" onClick={onClose}><X weight="bold"/></button></header><div><article><small>Verified recovered revenue</small><strong>{formatCurrencyTotals(report.totals.verifiedRecoveredRevenueMinorByCurrency)}</strong></article><article><small>Recovered bookings</small><strong>{report.totals.recoveredBookings}</strong></article><article><small>Message delivery</small><strong>{percent(report.totals.messaging.deliveryRate)}</strong></article><article><small>Open cases</small><strong>{report.totals.recoveryCases.open}</strong></article></div><footer><ShieldCheck weight="fill"/><span><strong>Identity-free response verified</strong>No client names, contact details, or individual booking records are included.</span></footer></section>
}

function message(reason:unknown){return reason instanceof Error?reason.message:'Agency access could not be updated.'}
function formatDate(value:string){return new Intl.DateTimeFormat('en-GB',{dateStyle:'medium'}).format(new Date(value))}
function formatPeriod(from:string,to:string){const format=new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',year:'numeric'});return`${format.format(new Date(from))}–${format.format(new Date(to))}`}
function percent(value:number){return`${(value*100).toFixed(value===0||value===1?0:1)}%`}

const now='2026-07-22T12:00:00.000Z'
const demoAccount:ApiAgencyAccount={id:'agency-account-demo',tenantId:'sample-tenant',displayName:'Maison Revenue Partners',supportEmail:'owners@maison.example',status:'active',createdBy:'demo-owner',createdAt:'2026-03-14T09:00:00.000Z',updatedBy:'demo-owner',updatedAt:now}
const demoAgencyGrants:ApiAgencyGrant[]=[{id:'agency-grant-1',agencyTenantId:'sample-tenant',clientTenantId:'aurora-salon-group',scopes:['portfolio_read'],status:'active',invitationId:'invitation-1',acceptedBy:'aurora-owner',createdAt:'2026-06-18T10:30:00.000Z'},{id:'agency-grant-2',agencyTenantId:'sample-tenant',clientTenantId:'atelier-hair-collective',scopes:['portfolio_read'],status:'revoked',invitationId:'invitation-2',acceptedBy:'atelier-owner',createdAt:'2026-04-09T13:00:00.000Z',revokedBy:'atelier-owner',revokedAt:'2026-07-02T15:20:00.000Z',revokeReason:'Engagement complete'}]
const demoClientGrants:ApiAgencyGrant[]=[{id:'client-grant-1',agencyTenantId:'plum-portfolio-partners',clientTenantId:'sample-tenant',scopes:['portfolio_read'],status:'active',invitationId:'invitation-3',acceptedBy:'demo-owner',createdAt:'2026-07-08T11:00:00.000Z'}]
const demoPreview:ApiAgencyInvitationPreview={agency:{displayName:'Plum Portfolio Partners',supportEmail:'support@plum.example'},scopes:['portfolio_read'],expiresAt:'2026-07-29T12:00:00.000Z'}
const demoAcceptance:{invitation:ApiAgencyInvitation;grant:ApiAgencyGrant;duplicate:boolean}={invitation:{id:'demo-accepted-invitation',agencyTenantId:'plum-portfolio-partners',clientTenantId:'sample-tenant',scopes:['portfolio_read'],status:'accepted',createdBy:'plum-owner',createdAt:now,expiresAt:'2026-07-29T12:00:00.000Z'},grant:{id:'client-grant-new',agencyTenantId:'plum-portfolio-partners',clientTenantId:'sample-tenant',scopes:['portfolio_read'],status:'active',invitationId:'demo-accepted-invitation',acceptedBy:'demo-owner',createdAt:now},duplicate:false}
function demoInvitation(clientTenantId:string,expiresInDays:number):{invitation:ApiAgencyInvitation;acceptanceToken:string}{const expiresAt=new Date(Date.parse(now)+expiresInDays*86_400_000).toISOString();return{invitation:{id:`invitation-${Date.now()}`,agencyTenantId:'sample-tenant',clientTenantId,scopes:['portfolio_read'],status:'pending',createdBy:'demo-owner',createdAt:now,expiresAt},acceptanceToken:'dGhpcy1pcy1hLWRlbW8taW52aXRhdGlvbi10b2tlbg1'}}
const demoPortfolio:ApiTenantPortfolioReport={tenantId:'aurora-salon-group',period:{from:'2026-06-22T12:00:00.000Z',to:now},portfolio:{locationCount:4,locations:[]},totals:{verifiedRecoveredRevenueMinorByCurrency:{GBP:12643000},recoveredBookings:418,recoveryCases:{opened:446,resolved:418,closed:12,open:16},messaging:{attempted:4290,delivered:4201,failed:89,deliveryRate:.9793,currentMarketingConsentRecords:2380,currentMarketingOptOuts:95,currentMarketingOptOutRate:.0399},operations:{pendingWorkflows:18,runningWorkflows:5,failedWorkflows:1,pausedWorkflows:0,pendingApprovals:2},experiments:{active:4,draft:2,paused:0},providerCircuits:{open:0,halfOpen:0}},dataQuality:{revenueEvidence:'verified_booking_single_touch',estimatedRevenueIncluded:false,unattributedBookingsIncluded:false,multipleCurrencies:false,consentMetric:'current_record_snapshot_not_period_flow',containsClientIdentities:false},generatedAt:now}
