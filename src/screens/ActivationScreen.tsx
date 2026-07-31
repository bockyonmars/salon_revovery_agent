import { ArrowsClockwise, CheckCircle, Clock, Info, Lightning, LockSimple, Microphone, UploadSimple, WarningCircle, WarningDiamond } from '@phosphor-icons/react'
import { type FormEvent, useEffect, useRef, useState } from 'react'
import { activateVoiceRelease, attestVoiceReadiness, attestVoiceReleaseEvidence, evaluateMessagingReliability, loadVoiceReadinessStatus, loadVoiceReleaseStatus, type ApiHealthCheck, type ApiOnboardingCheck, type ApiOnboardingStatus, type ApiVoiceReadinessStatus, type ApiVoiceReleaseStatus, type VoiceReadinessAttestationInput } from '../operations-api'
import { parseVoiceReleaseEvidencePayload, type VoiceReleaseEvidenceInput } from '../voice-release-evidence'

type ActivationAction = 'checking' | 'activating'
type VoiceAction = 'loading' | 'evaluating' | 'attesting' | 'importing' | 'activating'
type CheckKey = ApiOnboardingCheck['key']
type ReadinessDraft = Pick<VoiceReadinessAttestationInput,'jurisdictionCode'|'aiDisclosureVersion'|'retentionPolicyVersion'|'transferTo'>&{controls:Record<keyof VoiceReadinessAttestationInput['controls'],boolean>}

const emptyReadinessDraft:ReadinessDraft={jurisdictionCode:'',aiDisclosureVersion:'voice-ai-v1',retentionPolicyVersion:'voice-retention-v1',transferTo:'',controls:{aiParticipationDisclosureReviewed:false,recordingStorageDisabled:false,immediateTransferTested:false,jurisdictionRetentionReviewed:false}}

const groups:Array<{title:string;note:string;keys:CheckKey[]}>= [
  {title:'Salon setup',note:'Authoritative location, communication policy, booking provider, catalog, and client data.',keys:['location_settings','communication_policy','square_connection','catalog_sync','client_profiles']},
  {title:'Delivery channels',note:'Messaging routes and verified weekly report delivery.',keys:['messaging','weekly_reporting']},
  {title:'Commercial readiness',note:'A live subscription or trial is required for automation.',keys:['billing']},
  {title:'Production proof',note:'Fresh model simulation, reversible test booking, and signed live callbacks.',keys:['conversation_simulation','test_booking','webhook_verification']},
]

const fallback:ApiOnboardingStatus={activation:{status:'draft',updatedAt:new Date().toISOString()},canActivate:false,stale:false,health:{status:'setup_required',automationReady:false,checkedAt:new Date().toISOString(),summary:{ready:3,warning:0,blocked:4,pendingWorkflows:0,failedWorkflows:0,pausedWorkflows:0,pendingApprovals:0},checks:[
  {key:'location_settings',status:'ready',label:'Salon settings',detail:'Salon identity and timezone are configured.'},
  {key:'communication_policy',status:'blocked',label:'Communication policy',detail:'Disclosure versions, escalation ownership, contact hours, and rebooking policy are required.',action:'Publish the communication policy.'},
  {key:'square_connection',status:'blocked',label:'Square connection',detail:'An active Square OAuth connection is required.',action:'Connect or re-authorize Square.'},
  {key:'catalog_sync',status:'blocked',label:'Services and staff',detail:'No complete synchronized catalog is available.',action:'Run a Square catalog sync.'},
  {key:'client_profiles',status:'blocked',label:'Client profiles',detail:'No authoritative client profiles are available.',action:'Import or create client profiles.'},
  {key:'messaging',status:'blocked',label:'Messaging provider',detail:'An active Twilio destination route is required.',action:'Configure Twilio routing.'},
  {key:'weekly_reporting',status:'ready',label:'Weekly reporting',detail:'Verified revenue delivery is configured.'},
  {key:'billing',status:'ready',label:'Subscription billing',detail:'Trial access is active.'},
]}}

type ActivationScreenProps = {
  status?: ApiOnboardingStatus
  action?: ActivationAction
  liveMode: boolean
  onRunChecks: () => void
  onActivate: () => void
  onNavigate: (view: string) => void
  onNotify: (message: string) => void
}

export function ActivationScreen({status,action,liveMode,onRunChecks,onActivate,onNavigate,onNotify}:ActivationScreenProps){
  const value=status??fallback
  const healthChecks=new Map(value.health.checks.map(check=>[check.key,check]))
  const latest=value.latestRun
  const simulationChecks=new Map(latest?.checks.map(check=>[check.key,check])??[])
  const checks=groups.flatMap(group=>group.keys.map(key=>simulationChecks.get(key)??toCheck(key,healthChecks.get(key))))
  const passed=checks.filter(check=>check.status==='passed').length
  const blockers=checks.length-passed
  const active=value.activation.status==='active'
  const ready=!active&&value.canActivate&&!value.stale
  const stateLabel=active?'Active':ready?'Ready to activate':'Draft mode'
  const [voiceStatus,setVoiceStatus]=useState<ApiVoiceReleaseStatus>()
  const [readinessStatus,setReadinessStatus]=useState<ApiVoiceReadinessStatus>()
  const [voiceAction,setVoiceAction]=useState<VoiceAction>()
  const [voiceError,setVoiceError]=useState<string>()
  const [evidenceInput,setEvidenceInput]=useState<VoiceReleaseEvidenceInput>()
  const [activationConfirmed,setActivationConfirmed]=useState(false)
  const [showReadinessForm,setShowReadinessForm]=useState(false)
  const [readinessDraft,setReadinessDraft]=useState<ReadinessDraft>(emptyReadinessDraft)
  const fileInput=useRef<HTMLInputElement>(null)

  useEffect(()=>{
    let current=true
    if(!liveMode){setVoiceStatus(undefined);setReadinessStatus(undefined);setVoiceError(undefined);setEvidenceInput(undefined);setActivationConfirmed(false);setShowReadinessForm(false);setReadinessDraft(emptyReadinessDraft);return()=>{current=false}}
    setVoiceAction('loading')
    Promise.all([loadVoiceReleaseStatus(),loadVoiceReadinessStatus()]).then(([release,readiness])=>{if(current){setVoiceStatus(release);setReadinessStatus(readiness)}}).catch(error=>{if(current)setVoiceError(errorMessage(error))}).finally(()=>{if(current)setVoiceAction(undefined)})
    return()=>{current=false}
  },[liveMode])

  async function refreshVoice(){const[release,readiness]=await Promise.all([loadVoiceReleaseStatus(),loadVoiceReadinessStatus()]);setVoiceStatus(release);setReadinessStatus(readiness);return{release,readiness}}
  async function evaluateReliability(){
    if(!readinessStatus?.permissions.evaluateReliability)return
    setVoiceAction('evaluating');setVoiceError(undefined)
    try{const evaluation=await evaluateMessagingReliability();await refreshVoice();onNotify(evaluation.status==='passed'?'SMS reliability evidence passed and is current.':'SMS reliability evaluation completed with blockers.')}catch(error){setVoiceError(errorMessage(error))}finally{setVoiceAction(undefined)}
  }
  async function submitReadiness(event:FormEvent<HTMLFormElement>){
    event.preventDefault()
    if(!readinessStatus?.permissions.attest||!readinessStatus.reliabilityCurrent||!readinessDraftValid(readinessDraft))return
    setVoiceAction('attesting');setVoiceError(undefined)
    const input:VoiceReadinessAttestationInput={jurisdictionCode:readinessDraft.jurisdictionCode.trim().toUpperCase(),aiDisclosureVersion:readinessDraft.aiDisclosureVersion.trim(),retentionPolicyVersion:readinessDraft.retentionPolicyVersion.trim(),recordingMode:'disabled',transferMode:'human',transferTo:readinessDraft.transferTo.trim(),controls:{aiParticipationDisclosureReviewed:true,recordingStorageDisabled:true,immediateTransferTested:true,jurisdictionRetentionReviewed:true}}
    try{await attestVoiceReadiness(input);await refreshVoice();setReadinessDraft(emptyReadinessDraft);setShowReadinessForm(false);setActivationConfirmed(false);onNotify('Voice readiness declaration attested. Any earlier voice activation must now be renewed.')}catch(error){setVoiceError(errorMessage(error))}finally{setVoiceAction(undefined)}
  }
  async function selectEvidence(file?:File){
    setVoiceError(undefined);setEvidenceInput(undefined)
    if(!file)return
    if(file.size>128*1024){setVoiceError('Evidence file exceeds the 128 KB limit.');return}
    try{setEvidenceInput(parseVoiceReleaseEvidencePayload(await file.text()))}catch(error){setVoiceError(errorMessage(error))}
  }
  async function importEvidence(){
    if(!evidenceInput||!voiceStatus?.permissions.attestEvidence)return
    setVoiceAction('importing');setVoiceError(undefined)
    try{await attestVoiceReleaseEvidence(evidenceInput);await refreshVoice();setEvidenceInput(undefined);if(fileInput.current)fileInput.current.value='';onNotify('Voice sandbox evidence imported and attested.')}catch(error){setVoiceError(errorMessage(error))}finally{setVoiceAction(undefined)}
  }
  async function activateVoice(){
    if(!voiceStatus?.permissions.activate||!activationConfirmed)return
    setVoiceAction('activating');setVoiceError(undefined)
    try{await activateVoiceRelease();await refreshVoice();setActivationConfirmed(false);onNotify('Realtime voice activation recorded. Runtime access remains policy-gated.')}catch(error){setVoiceError(errorMessage(error))}finally{setVoiceAction(undefined)}
  }

  const voiceReady=Boolean(voiceStatus?.readiness.allowed&&voiceStatus.evidenceCurrent&&!voiceStatus.activationCurrent)
  const voiceState=voiceStatus?.realtimeVoiceEnabled?'Active':voiceStatus?.activationCurrent&&!voiceStatus.runtimeConfigured?'Activated · runtime disabled':voiceReady?'Ready to activate':voiceAction==='loading'?'Checking release state…':liveMode?'Blocked':'Live session required'
  const ownerCanAct=Boolean(voiceStatus?.permissions.activate&&voiceStatus.permissions.attestEvidence)
  const evidence=voiceStatus?.evidence
  const readinessDeclaration=readinessStatus?.declaration
  const evaluation=readinessStatus?.evaluation

  return <div className="activation-page">
    <section className={`activation-state ${active?'active':ready?'ready':''}`}>
      <div className="activation-state-title"><span><Lightning weight="fill" /></span><div><small>Activation state</small><h2>{stateLabel}</h2></div></div>
      <div className="activation-state-counts"><div><strong className={blockers?'danger-text':'success-text'}>{blockers}</strong><small>Blockers</small></div><i/><div><strong>{passed}</strong><small>Verified</small></div></div>
    </section>

    {value.stale&&<div className="activation-stale" role="alert"><WarningDiamond weight="fill"/><span><strong>Configuration changed after the latest simulation.</strong><small>Run the checks again before activating production automation.</small></span><button className="text-button" onClick={onRunChecks} disabled={Boolean(action)}>Run now</button></div>}

    <div className="activation-grid">
      <div className="activation-check-groups">
        {groups.map(group=><section className="ops-panel activation-check-panel" key={group.title}><header><h3>{group.title}</h3><p>{group.note}</p></header><div>{group.keys.map(key=>{const check=checks.find(item=>item.key===key)!;return <article className="activation-check" key={key}><span className={check.status==='passed'?'passed':'failed'}>{check.status==='passed'?<CheckCircle weight="fill"/>:<WarningCircle weight="fill"/>}</span><div><strong>{check.label}</strong><small>{check.detail}</small></div>{check.status==='passed'?<b className="success-text">Verified</b>:<button className="text-button" onClick={()=>onNavigate(routeFor(key))}>Resolve</button>}</article>})}</div></section>)}
      </div>

      <aside className="activation-aside">
        <section className="ops-panel activation-control"><span className="control-label">Simulation state</span><dl><div><dt>Latest check</dt><dd><Clock weight="fill"/>{latest?formatDate(latest.createdAt):'Not run yet'}</dd></div><div><dt>Configuration fingerprint</dt><dd className="fingerprint">{latest?`SHA-256: ${latest.configurationFingerprint.slice(0,8)}…${latest.configurationFingerprint.slice(-4)}`:'Awaiting first run'}</dd></div><div><dt>Simulation result</dt><dd><span className={`status-badge ${latest?.status==='passed'?'success':'warning'}`}>{latest?.status??'Not run'}</span></dd></div></dl><div className="activation-actions"><button className="secondary-button" onClick={onRunChecks} disabled={Boolean(action)}><ArrowsClockwise className={action==='checking'?'spinning':''}/>{action==='checking'?'Running checks…':'Run checks'}</button><button className="primary-button" onClick={onActivate} disabled={!ready||Boolean(action)}><Lightning weight="bold"/>{action==='activating'?'Activating…':active?'Production active':'Activate production'}</button></div>{!active&&!ready&&<div className="activation-blocker"><WarningDiamond weight="fill"/><p>{value.stale?<><strong>A fresh simulation is required.</strong> Configuration changed after the latest run.</>:<><strong>{blockers} {blockers===1?'blocker prevents':'blockers prevent'} activation.</strong> Resolve every failed check and retain a current passing simulation.</>}</p></div>}{ready&&<div className="activation-ready"><CheckCircle weight="fill"/><p><strong>All critical checks passed.</strong> Activation will resume only workflows paused by onboarding policy.</p></div>}</section>
        <section className={`activation-note ${active?'active':''}`}><Info weight="fill"/><div><h3>{active?'Production automation active':'Dry-run protection active'}</h3><p>{active?'The location is permitted to run policy-bounded recovery workflows.':'Events may be recorded, but outbound revenue automation remains paused until activation.'}</p></div></section>
      </aside>
    </div>

    <section className="ops-panel voice-release-panel" aria-labelledby="voice-release-title">
      <header className="voice-release-header">
        <div className="voice-release-title"><span><Microphone weight="fill"/></span><div><small>Separate production control</small><h2 id="voice-release-title">Realtime voice governance</h2><p>Conversational calling remains isolated from general automation until its own evidence and owner activation are current.</p></div></div>
        <span className={`voice-state-badge ${voiceStatus?.realtimeVoiceEnabled?'active':voiceReady?'ready':'blocked'}`}>{voiceState}</span>
      </header>
      <div className="voice-readiness-band">
        <div className="voice-readiness-overview">
          <div className="voice-readiness-heading"><div><span className="control-label">Step 1 · prerequisite declaration</span><h3>Voice readiness and human-transfer boundary</h3><p>Prove SMS reliability, confirm the jurisdiction-specific policies, and bind a tested private transfer destination before sandbox release evidence can be accepted.</p></div><span className={`status-badge ${readinessStatus?.voiceRuntimeAllowed?'success':'warning'}`}>{readinessStatus?.voiceRuntimeAllowed?'Current':'Not ready'}</span></div>
          <div className="voice-readiness-metrics">
            <div><span>SMS evidence</span><strong className={readinessStatus?.reliabilityCurrent?'success-text':'danger-text'}>{readinessStatus?.reliabilityCurrent?'Current':evaluation?.status==='failed'?'Failed':'Required'}</strong><small>{evaluation?`${evaluation.metrics.terminalMessages} terminal · ${(evaluation.metrics.deliveryRate*100).toFixed(2)}% delivered`:'No evaluation on record'}</small></div>
            <div><span>Owner declaration</span><strong className={readinessStatus?.declarationCurrent?'success-text':'danger-text'}>{readinessStatus?.declarationCurrent?'Current':'Required'}</strong><small>{readinessDeclaration?`${readinessDeclaration.jurisdictionCode} · expires ${formatDate(readinessDeclaration.expiresAt)}`:'No declaration on record'}</small></div>
            <div><span>Human transfer</span><strong>{readinessDeclaration?.transferToMasked??'Not attested'}</strong><small>{readinessDeclaration?'Private destination masked by the API':'A tested human route is mandatory'}</small></div>
          </div>
        </div>
        <div className="voice-readiness-actions">
          <button className="secondary-button" disabled={!readinessStatus?.permissions.evaluateReliability||Boolean(voiceAction)} onClick={()=>void evaluateReliability()}><ArrowsClockwise className={voiceAction==='evaluating'?'spinning':''}/>{voiceAction==='evaluating'?'Evaluating SMS evidence…':'Evaluate SMS reliability'}</button>
          {readinessStatus?.permissions.attest?<button className="text-button" disabled={!readinessStatus.reliabilityCurrent||Boolean(voiceAction)} onClick={()=>setShowReadinessForm(value=>!value)}>{showReadinessForm?'Close declaration form':readinessStatus.declarationCurrent?'Renew owner declaration':'Create owner declaration'}</button>:liveMode&&<span className="voice-owner-only"><LockSimple weight="fill"/>Owner access required to attest</span>}
        </div>
      </div>
      {showReadinessForm&&<form className="voice-readiness-form" onSubmit={event=>void submitReadiness(event)}>
        <header><div><span className="control-label">Owner attestation</span><h3>Confirm the governed voice boundary</h3></div><p>A new declaration invalidates any earlier Realtime activation. The private destination is transmitted only to this tenant’s protected API and is masked in management status.</p></header>
        <div className="voice-readiness-fields">
          <label><span>Jurisdiction code</span><input required maxLength={6} placeholder="NG-LA" autoComplete="off" value={readinessDraft.jurisdictionCode} onChange={event=>setReadinessDraft(value=>({...value,jurisdictionCode:event.target.value.toUpperCase()}))}/></label>
          <label><span>AI disclosure version</span><input required maxLength={64} autoComplete="off" value={readinessDraft.aiDisclosureVersion} onChange={event=>setReadinessDraft(value=>({...value,aiDisclosureVersion:event.target.value}))}/></label>
          <label><span>Retention policy version</span><input required maxLength={64} autoComplete="off" value={readinessDraft.retentionPolicyVersion} onChange={event=>setReadinessDraft(value=>({...value,retentionPolicyVersion:event.target.value}))}/></label>
          <label><span>Private human-transfer destination</span><input required type="tel" inputMode="tel" placeholder="+234…" autoComplete="off" value={readinessDraft.transferTo} onChange={event=>setReadinessDraft(value=>({...value,transferTo:event.target.value}))}/></label>
        </div>
        <div className="voice-fixed-boundary"><LockSimple weight="fill"/><span><strong>Recording remains disabled. Transfer mode remains human.</strong><small>These controls are fixed by the server schema and cannot be relaxed from the dashboard.</small></span></div>
        <div className="voice-readiness-confirmations">
          <ReadinessConfirmation checked={readinessDraft.controls.aiParticipationDisclosureReviewed} onChange={checked=>setReadinessDraft(value=>({...value,controls:{...value.controls,aiParticipationDisclosureReviewed:checked}}))}>The AI participation disclosure has been reviewed for this jurisdiction.</ReadinessConfirmation>
          <ReadinessConfirmation checked={readinessDraft.controls.recordingStorageDisabled} onChange={checked=>setReadinessDraft(value=>({...value,controls:{...value.controls,recordingStorageDisabled:checked}}))}>Audio, recording storage, and transcript persistence are disabled.</ReadinessConfirmation>
          <ReadinessConfirmation checked={readinessDraft.controls.immediateTransferTested} onChange={checked=>setReadinessDraft(value=>({...value,controls:{...value.controls,immediateTransferTested:checked}}))}>Immediate transfer to the private human destination has been tested.</ReadinessConfirmation>
          <ReadinessConfirmation checked={readinessDraft.controls.jurisdictionRetentionReviewed} onChange={checked=>setReadinessDraft(value=>({...value,controls:{...value.controls,jurisdictionRetentionReviewed:checked}}))}>The jurisdiction-specific retention policy has been reviewed.</ReadinessConfirmation>
        </div>
        <footer><button type="button" className="secondary-button" onClick={()=>setShowReadinessForm(false)} disabled={Boolean(voiceAction)}>Cancel</button><button className="primary-button" disabled={!readinessStatus?.reliabilityCurrent||!readinessDraftValid(readinessDraft)||Boolean(voiceAction)}><CheckCircle weight="bold"/>{voiceAction==='attesting'?'Recording attestation…':'Attest voice readiness'}</button></footer>
      </form>}
      {voiceError&&<div className="voice-release-error voice-governance-error" role="alert"><WarningCircle weight="fill"/><span>{voiceError}</span></div>}
      <div className="voice-release-body">
        <div className="voice-release-readiness">
          <span className="control-label">Release gates</span>
          <div className="voice-gate-list">
            <VoiceGate passed={Boolean(voiceStatus?.readiness.allowed)} label="Voice and SMS readiness" detail={voiceStatus?.readiness.allowed?'Current reliability evidence and voice declaration are valid.':'Current prerequisite evidence is required.'}/>
            <VoiceGate passed={Boolean(voiceStatus?.evidenceCurrent)} label="Sandbox evidence" detail={voiceStatus?.evidenceCurrent?'Current attested sandbox evidence is on record.':'Import fresh evidence produced by npm run voice:release:payload.'}/>
            <VoiceGate passed={Boolean(evidence&&evidence.model===voiceStatus?.model)} label="Pinned Realtime model" detail={voiceStatus?.model?`Release target: ${voiceStatus.model}`:'Model configuration is unavailable.'}/>
            <VoiceGate passed={Boolean(voiceStatus?.activationCurrent)} label="Owner activation" detail={voiceStatus?.activationCurrent?'Activation matches the current evidence and readiness declaration.':'A salon owner must explicitly activate this release.'}/>
            <VoiceGate passed={Boolean(voiceStatus?.runtimeConfigured)} label="Runtime configuration" detail={voiceStatus?.runtimeConfigured?'The Realtime runtime switch is configured.':'Activation can be recorded, but runtime calling stays disabled.'} warning={Boolean(voiceStatus?.activationCurrent&&!voiceStatus.runtimeConfigured)}/>
          </div>
          <div className="voice-evidence-summary">
            <div><span>Evidence model</span><strong>{evidence?.model??'Not imported'}</strong></div>
            <div><span>Sandbox completed</span><strong>{evidence?formatDate(evidence.sandboxCompletedAt):'—'}</strong></div>
            <div><span>Evidence expires</span><strong>{evidence?formatDate(evidence.expiresAt):'—'}</strong></div>
            <div><span>Report digest</span><strong className="fingerprint">{evidence?maskDigest(evidence.reportDigest):'—'}</strong></div>
          </div>
        </div>

        <div className="voice-release-controls">
          <span className="control-label">Owner release controls</span>
          {!liveMode&&<div className="voice-access-note"><LockSimple weight="fill"/><p><strong>Live operations session required.</strong> Sign in to inspect authoritative release status or take an action.</p></div>}
          {liveMode&&voiceStatus&&!ownerCanAct&&<div className="voice-access-note"><LockSimple weight="fill"/><p><strong>Owner access required.</strong> Managers may inspect release evidence, but cannot attest or activate it.</p></div>}
          <label className={`voice-file-control ${!voiceStatus?.permissions.attestEvidence?'disabled':''}`}>
            <input ref={fileInput} type="file" accept="application/json,.json" disabled={!voiceStatus?.permissions.attestEvidence||Boolean(voiceAction)} onChange={event=>void selectEvidence(event.target.files?.[0])}/>
            <UploadSimple weight="bold"/><span><strong>{evidenceInput?'Evidence file validated':'Select evidence JSON'}</strong><small>Generate with <code>npm run voice:release:payload</code> · 128 KB maximum</small></span>
          </label>
          {evidenceInput&&<div className="voice-import-preview"><CheckCircle weight="fill"/><span><strong>{evidenceInput.model}</strong><small>Sandbox completed {formatDate(evidenceInput.sandboxCompletedAt)} · {maskDigest(evidenceInput.reportDigest)}</small></span></div>}
          <button className="secondary-button voice-import-button" disabled={!evidenceInput||!voiceStatus?.permissions.attestEvidence||Boolean(voiceAction)} onClick={()=>void importEvidence()}><UploadSimple weight="bold"/>{voiceAction==='importing'?'Importing evidence…':'Import and attest evidence'}</button>
          <label className={`voice-confirmation ${!voiceStatus?.permissions.activate?'disabled':''}`}><input type="checkbox" checked={activationConfirmed} disabled={!voiceStatus?.permissions.activate||Boolean(voiceAction)} onChange={event=>setActivationConfirmed(event.target.checked)}/><span>I understand this enables policy-bounded conversational calls when the runtime is configured, and that human transfer and disclosure controls remain mandatory.</span></label>
          <button className="primary-button voice-activate-button" disabled={!voiceReady||!voiceStatus?.permissions.activate||!activationConfirmed||Boolean(voiceAction)} onClick={()=>void activateVoice()}><Lightning weight="bold"/>{voiceAction==='activating'?'Recording activation…':voiceStatus?.activationCurrent?'Voice release active':'Activate Realtime voice'}</button>
          <p className="voice-control-footnote">The API rechecks role, evidence freshness, model binding, readiness, and SMS reliability at activation time. This control never bypasses those gates.</p>
        </div>
      </div>
    </section>
  </div>
}

function ReadinessConfirmation({checked,onChange,children}:{checked:boolean;onChange:(checked:boolean)=>void;children:string}){return <label><input type="checkbox" checked={checked} onChange={event=>onChange(event.target.checked)}/><span>{children}</span></label>}
function VoiceGate({passed,label,detail,warning=false}:{passed:boolean;label:string;detail:string;warning?:boolean}){return <article className="voice-gate"><span className={passed?'passed':warning?'warning':'failed'}>{passed?<CheckCircle weight="fill"/>:warning?<WarningDiamond weight="fill"/>:<WarningCircle weight="fill"/>}</span><div><strong>{label}</strong><small>{detail}</small></div><b className={passed?'success-text':warning?'warning-text':'danger-text'}>{passed?'Current':warning?'Limited':'Required'}</b></article>}
function toCheck(key:CheckKey,health?:ApiHealthCheck):ApiOnboardingCheck{return{key,label:health?.label??key.replaceAll('_',' '),status:health?.status==='ready'?'passed':'failed',detail:health?.detail??'This critical check has not been verified.'}}
function routeFor(key:CheckKey){return key==='client_profiles'?'Clients':key==='communication_policy'||key==='location_settings'?'Policies':key==='conversation_simulation'?'Conversations':'Integrations'}
function formatDate(value:string){return new Intl.DateTimeFormat('en-GB',{dateStyle:'medium',timeStyle:'short'}).format(new Date(value))}
function maskDigest(value:string){return `SHA-256: ${value.slice(0,8)}…${value.slice(-4)}`}
function errorMessage(error:unknown){return error instanceof Error?error.message:'Voice release status could not be updated.'}
function readinessDraftValid(value:ReadinessDraft){return/^[A-Z]{2}(?:-[A-Z0-9]{1,3})?$/.test(value.jurisdictionCode.trim().toUpperCase())&&/^[A-Za-z0-9][A-Za-z0-9._-]{1,63}$/.test(value.aiDisclosureVersion.trim())&&/^[A-Za-z0-9][A-Za-z0-9._-]{1,63}$/.test(value.retentionPolicyVersion.trim())&&/^\+[1-9]\d{7,14}$/.test(value.transferTo.trim())&&Object.values(value.controls).every(Boolean)}
