import {
  ArrowsClockwise,
  ChartLineUp,
  CheckCircle,
  Flask,
  LockKey,
  Pause,
  Play,
  Plus,
  SealCheck,
  ShieldCheck,
  Stop,
  Timer,
  Trash,
  WarningCircle,
  X,
} from '@phosphor-icons/react'
import { FormEvent, useEffect, useMemo, useState } from 'react'
import {
  activateExperiment,
  completeExperiment,
  createExperiment,
  loadExperimentResults,
  loadExperiments,
  pauseExperiment,
  type ApiControlledExperiment,
  type ApiControlledExperimentInput,
  type ApiControlledExperimentResult,
} from '../operations-api'
import { formatCurrencyTotals } from '../verified-operations'

type LoadState='idle'|'loading'|'ready'|'error'
type BusyAction='create'|'activate'|'pause'|'complete'|'results'|''
type TransitionAction='activate'|'pause'|'complete'
type VariantDraft={key:string;allocation:number;body:string}

const prefix='{{sender}}:'
const suffix='Reply STOP to unsubscribe.'

export function ExperimentsScreen({liveMode,onNotify}:{liveMode:boolean;onNotify:(message:string)=>void}){
  const [records,setRecords]=useState<ApiControlledExperiment[]>(liveMode?[]:demoExperiments)
  const [selectedId,setSelectedId]=useState(liveMode?'':demoExperiments[0]!.id)
  const [results,setResults]=useState<ApiControlledExperimentResult|null>(liveMode?null:demoResults[demoExperiments[0]!.id]!)
  const [state,setState]=useState<LoadState>(liveMode?'loading':'idle')
  const [busy,setBusy]=useState<BusyAction>('')
  const [error,setError]=useState('')
  const [createOpen,setCreateOpen]=useState(false)
  const [variants,setVariants]=useState<VariantDraft[]>(defaultVariants())
  const [pendingTransition,setPendingTransition]=useState<TransitionAction|null>(null)
  const [reload,setReload]=useState(0)

  useEffect(()=>{
    setCreateOpen(false);setPendingTransition(null);setError('')
    if(!liveMode){setRecords(demoExperiments);setSelectedId(demoExperiments[0]!.id);setState('idle');return}
    let current=true;setState('loading')
    loadExperiments().then(({experiments})=>{if(current){setRecords(experiments);setSelectedId(value=>experiments.some(item=>item.id===value)?value:(experiments[0]?.id??''));setState('ready')}}).catch(reason=>{if(current){setError(message(reason));setState('error')}})
    return()=>{current=false}
  },[liveMode,reload])

  const selected=records.find(record=>record.id===selectedId)??records[0]

  useEffect(()=>{
    if(!selected){setResults(null);return}
    if(!liveMode){setResults(demoResults[selected.id]??emptyResults(selected));return}
    let current=true;setBusy('results');setError('')
    loadExperimentResults(selected.id).then(value=>{if(current)setResults(value)}).catch(reason=>{if(current){setResults(null);setError(message(reason))}}).finally(()=>{if(current)setBusy('')})
    return()=>{current=false}
  },[liveMode,selected?.id,selected?.status])

  const counts=useMemo(()=>({active:records.filter(value=>value.status==='active').length,draft:records.filter(value=>value.status==='draft').length,paused:records.filter(value=>value.status==='paused').length,completed:records.filter(value=>value.status==='completed').length}),[records])

  async function create(event:FormEvent<HTMLFormElement>){
    event.preventDefault();const form=new FormData(event.currentTarget);const startsAt=dateValue(form.get('startsAt'));const endsAt=dateValue(form.get('endsAt'))
    const input:ApiControlledExperimentInput={name:String(form.get('name')??'').trim(),workflowType:String(form.get('workflowType')) as ApiControlledExperiment['workflowType'],variants:variants.map(value=>({key:value.key.trim(),allocation:value.allocation,messageTemplate:template(value.body)})),...(startsAt?{startsAt}:{}),...(endsAt?{endsAt}:{})}
    setBusy('create');setError('')
    try{const created=liveMode?await createExperiment(input):demoCreated(input);setRecords(current=>[created,...current]);setSelectedId(created.id);setCreateOpen(false);setVariants(defaultVariants());onNotify('Controlled experiment saved as a draft. It is not active.')}
    catch(reason){setError(message(reason))}finally{setBusy('')}
  }

  async function transition(action:TransitionAction){
    if(!selected)return;setBusy(action);setError('')
    try{if(!liveMode&&action==='activate'&&records.some(value=>value.id!==selected.id&&value.workflowType===selected.workflowType&&value.status==='active'))throw new Error('Another experiment is active for this recovery workflow. Pause or complete it before activating this draft.');const updated=liveMode?await(action==='activate'?activateExperiment(selected.id):action==='pause'?pauseExperiment(selected.id):completeExperiment(selected.id)):demoTransition(selected,action);setRecords(current=>current.map(value=>value.id===updated.id?updated:value));setPendingTransition(null);onNotify(action==='activate'?'Experiment activated with deterministic assignment.':action==='pause'?'Experiment paused. No new clients will be exposed.':'Experiment completed. Evidence remains available and no winner was auto-selected.')}
    catch(reason){setPendingTransition(null);setError(message(reason))}finally{setBusy('')}
  }

  function updateVariant(index:number,patch:Partial<VariantDraft>){setVariants(current=>current.map((value,position)=>position===index?{...value,...patch}:value))}
  function addVariant(){setVariants(current=>current.length===2?[{...current[0]!,allocation:34},{...current[1]!,allocation:33},{key:'variant_c',allocation:33,body:'Our salon team can help you review current appointment availability when you are ready.'}]:current.map(value=>value))}
  function removeThird(){setVariants(current=>current.slice(0,2).map(value=>({...value,allocation:50})))}

  const allocationTotal=variants.reduce((total,value)=>total+value.allocation,0)
  const draftValid=allocationTotal===100&&new Set(variants.map(value=>value.key.trim())).size===variants.length&&variants.every(value=>/^[a-z][a-z0-9_-]{0,31}$/.test(value.key.trim())&&template(value.body).length>=40&&template(value.body).length<=320)

  if(liveMode&&state!=='ready')return <div className="empty-workspace experiment-boundary"><span>{state==='error'?<WarningCircle weight="fill"/>:<Flask weight="duotone"/>}</span><h2>{state==='error'?'Experiment controls unavailable':'Loading controlled experiments'}</h2><p>{state==='error'?error:'Reading policy-bounded experiment records and verified attribution evidence.'}</p>{state==='error'&&<button className="primary-button" onClick={()=>setReload(value=>value+1)}>Retry experiments</button>}</div>

  return <div className="ops-page experiment-page">
    <section className="screen-heading experiment-heading"><div><span className="demo-label">{liveMode?'Verified experiment operations':'Sample controlled experiments'}</span><h2>Learn without surrendering control.</h2><p>Test recovery copy with deterministic assignment, consent-checked sends, and verified booking attribution.</p></div><button className="primary-button" onClick={()=>setCreateOpen(value=>!value)}><Plus weight="bold"/>{createOpen?'Close builder':'New experiment'}</button></section>

    <section className="experiment-safety-band"><ShieldCheck weight="fill"/><div><strong>Bounded experimentation</strong><p>Only recovery copy changes. Pricing, discounts, urgency, consent rules, audience eligibility, and workflow timing remain outside the experiment.</p></div><span>Automatic winners · disabled</span></section>

    {error&&<section className="experiment-error" role="alert"><WarningCircle weight="fill"/><span>{error}</span><button aria-label="Dismiss experiment error" onClick={()=>setError('')}><X weight="bold"/></button></section>}

    {createOpen&&<ExperimentBuilder variants={variants} allocationTotal={allocationTotal} valid={draftValid} busy={busy==='create'} onSubmit={create} onChange={updateVariant} onAdd={addVariant} onRemoveThird={removeThird} onCancel={()=>setCreateOpen(false)}/>}

    <section className="ops-summary experiment-summary"><article className="ops-summary-lead"><span>Experiment records</span><strong>{records.length}</strong><small><SealCheck weight="fill"/> Versioned and auditable</small></article><article><span>Active</span><strong>{counts.active}</strong><small className="success-text">One per workflow maximum</small></article><article><span>Draft or paused</span><strong>{counts.draft+counts.paused}</strong><small>Never auto-activated</small></article><article><span>Completed</span><strong>{counts.completed}</strong><small>Evidence retained</small></article></section>

    {records.length?<section className="experiment-workspace">
      <aside className="ops-panel experiment-list-panel"><header><div><h3>Experiment portfolio</h3><p>Select a record to inspect its controls and evidence.</p></div><span>{records.length}</span></header><div className="experiment-list">{records.map(record=><button key={record.id} className={record.id===selected?.id?'selected':''} onClick={()=>setSelectedId(record.id)}><span className={`experiment-status-dot ${record.status}`}/><span><strong>{record.name}</strong><small>{workflowLabel(record.workflowType)} · {record.variants.length} variants</small></span><b>{statusLabel(record.status)}</b></button>)}</div></aside>
      {selected&&<section className="experiment-detail">
        <article className="ops-panel experiment-control-card"><header className="experiment-detail-header"><div><span className={`status-badge ${selected.status==='active'||selected.status==='completed'?'success':'warning'}`}>{statusLabel(selected.status)}</span><h3>{selected.name}</h3><p>{workflowLabel(selected.workflowType)} · Created {formatDate(selected.createdAt)}</p></div><div className="experiment-actions">{(selected.status==='draft'||selected.status==='paused')&&<button className="primary-button" disabled={Boolean(busy)} onClick={()=>setPendingTransition('activate')}><Play weight="fill"/>Activate</button>}{selected.status==='active'&&<><button className="secondary-button" disabled={Boolean(busy)} onClick={()=>setPendingTransition('pause')}><Pause weight="fill"/>Pause</button><button className="secondary-button" disabled={Boolean(busy)} onClick={()=>setPendingTransition('complete')}><Stop weight="fill"/>Complete</button></>}</div></header><dl className="experiment-metadata"><div><dt>Assignment</dt><dd>Deterministic per client</dd></div><div><dt>Schedule</dt><dd>{schedule(selected)}</dd></div><div><dt>Attribution</dt><dd>Verified bookings only</dd></div><div><dt>Winner selection</dt><dd>Human decision only</dd></div></dl><div className="experiment-variants">{selected.variants.map(variant=><article key={variant.key}><header><span>{variant.key}</span><strong>{variant.allocation}% allocation</strong></header><p>{displayTemplate(variant.messageTemplate)}</p><footer><LockKey weight="fill"/>Sender and opt-out framing are fixed</footer></article>)}</div></article>
        <ResultsPanel experiment={selected} results={results} loading={busy==='results'}/>
      </section>}
    </section>:<section className="ops-panel experiment-empty"><Flask weight="duotone"/><div><h3>No controlled experiments yet</h3><p>Create a draft with two policy-validated variants. Nothing activates until a manager explicitly approves it.</p></div><button className="primary-button" onClick={()=>setCreateOpen(true)}>Create first draft</button></section>}

    {selected&&pendingTransition&&<TransitionDialog action={pendingTransition} experiment={selected} busy={busy===pendingTransition} onClose={()=>setPendingTransition(null)} onConfirm={()=>transition(pendingTransition)}/>}
  </div>
}

function ExperimentBuilder({variants,allocationTotal,valid,busy,onSubmit,onChange,onAdd,onRemoveThird,onCancel}:{variants:VariantDraft[];allocationTotal:number;valid:boolean;busy:boolean;onSubmit:(event:FormEvent<HTMLFormElement>)=>void;onChange:(index:number,patch:Partial<VariantDraft>)=>void;onAdd:()=>void;onRemoveThird:()=>void;onCancel:()=>void}){
  return <section className="ops-panel experiment-builder"><header><div><span className="demo-label">Governed creation</span><h3>New recovery-copy experiment</h3><p>The record begins as a draft. Activation is always a separate manager action.</p></div><span className={`experiment-allocation ${allocationTotal===100?'valid':'invalid'}`}>{allocationTotal}% allocated</span></header><form onSubmit={onSubmit}><div className="experiment-builder-fields"><label><span>Experiment name</span><input name="name" minLength={3} maxLength={120} placeholder="July rebooking copy test" required disabled={busy}/></label><label><span>Recovery workflow</span><select name="workflowType" defaultValue="lapsed_reactivation" disabled={busy}><option value="lapsed_reactivation">Lapsed-client reactivation</option><option value="post_visit_rebook">Post-visit rebooking</option><option value="no_show_recovery">No-show recovery</option></select></label><label><span>Starts at <small>Optional</small></span><input name="startsAt" type="datetime-local" disabled={busy}/></label><label><span>Ends at <small>Optional</small></span><input name="endsAt" type="datetime-local" disabled={busy}/></label></div><div className="experiment-copy-boundary"><LockKey weight="fill"/><span><strong>Copy boundary</strong><small>Every message begins with <code>{prefix}</code> and ends with <code>{suffix}</code>. The server rejects discounts, free offers, guarantees, refunds, scarcity, and unverified urgency.</small></span></div><div className="experiment-variant-builder">{variants.map((variant,index)=><article key={index}><header><strong>Variant {String.fromCharCode(65+index)}</strong>{index===2&&<button type="button" className="text-button danger-text" onClick={onRemoveThird}><Trash weight="bold"/>Remove</button>}</header><div className="experiment-variant-fields"><label><span>Key</span><input value={variant.key} onChange={event=>onChange(index,{key:event.target.value})} pattern="[a-z][a-z0-9_-]{0,31}" required disabled={busy}/></label><label><span>Allocation</span><div className="experiment-allocation-input"><input type="number" value={variant.allocation} onChange={event=>onChange(index,{allocation:Number(event.target.value)})} min={1} max={99} required disabled={busy}/><span>%</span></div></label></div><label className="experiment-message-field"><span>Message body</span><div><code>{prefix}</code><textarea value={variant.body} onChange={event=>onChange(index,{body:event.target.value})} minLength={1} maxLength={260} required disabled={busy}/><code>{suffix}</code></div><small>{template(variant.body).length}/320 characters including fixed framing</small></label></article>)}</div><footer><div>{variants.length<3?<button type="button" className="text-button" onClick={onAdd}><Plus weight="bold"/>Add third variant</button>:<span><CheckCircle weight="fill"/>Maximum three variants</span>}<small>{valid?'Configuration ready for server validation.':'Keys must be unique, allocations must total 100%, and copy must fit the safety boundary.'}</small></div><span><button type="button" className="secondary-button" onClick={onCancel} disabled={busy}>Cancel</button><button className="primary-button" disabled={!valid||busy}>{busy?'Saving draft…':'Save draft'}</button></span></footer></form></section>
}

function ResultsPanel({experiment,results,loading}:{experiment:ApiControlledExperiment;results:ApiControlledExperimentResult|null;loading:boolean}){
  return <article className="ops-panel experiment-results"><header className="ops-panel-header"><div><h3><ChartLineUp weight="duotone"/> Verified results</h3><p>Exposure evidence is joined only to provider-confirmed booking attribution.</p></div>{loading?<ArrowsClockwise className="spinning"/>:<span className={`status-badge ${results?.minimumSampleReached?'success':'warning'}`}>{results?.minimumSampleReached?'Sample reached':'Collecting evidence'}</span>}</header>{results?<><div className="experiment-results-grid">{results.variants.map(variant=><article key={variant.variantKey}><header><span>{variant.variantKey}</span><strong>{variant.allocation}%</strong></header><dl><div><dt>Exposures</dt><dd>{variant.exposures}</dd></div><div><dt>Recovered bookings</dt><dd>{variant.recoveredBookings}</dd></div><div><dt>Conversion</dt><dd>{percent(variant.conversionRate)}</dd></div><div><dt>Verified revenue</dt><dd>{formatCurrencyTotals(variant.verifiedRecoveredRevenueMinorByCurrency)}</dd></div></dl><div className="experiment-sample-bar"><span style={{width:`${Math.min(100,variant.exposures/results.minimumSamplePerVariant*100)}%`}}/></div><small>{Math.min(variant.exposures,results.minimumSamplePerVariant)} of {results.minimumSamplePerVariant} minimum exposures</small></article>)}</div><footer><ShieldCheck weight="fill"/><span><strong>No automatic winner</strong>{results.minimumSampleReached?'The minimum sample is available for a human evidence review.':'No conclusion should be drawn before every variant reaches the minimum sample.'}</span><b>winnerSuggested · false</b></footer></>:<div className="experiment-results-empty"><Timer weight="duotone"/><p><strong>{experiment.status==='draft'?'Awaiting activation':'No result evidence available'}</strong><span>Results appear after consent-checked messages are sent and matched to verified bookings.</span></p></div>}</article>
}

function TransitionDialog({action,experiment,busy,onClose,onConfirm}:{action:TransitionAction;experiment:ApiControlledExperiment;busy:boolean;onClose:()=>void;onConfirm:()=>void}){
  const content={activate:{title:'Activate this experiment?',detail:'Eligible clients will be assigned deterministically. Only one active experiment is allowed for this workflow.',confirm:'Activate experiment',icon:<Play weight="fill"/>},pause:{title:'Pause this experiment?',detail:'No new clients will be exposed. Existing exposure and attribution evidence will remain intact.',confirm:'Pause experiment',icon:<Pause weight="fill"/>},complete:{title:'Complete this experiment?',detail:'Completion is final. Evidence remains available, but the experiment cannot be reactivated.',confirm:'Complete experiment',icon:<Stop weight="fill"/>}}[action]
  return <div className="experiment-dialog-backdrop" role="presentation"><section className="experiment-dialog" role="dialog" aria-modal="true" aria-labelledby="experiment-transition-title"><header><span>{content.icon}</span><div><small>Manager decision</small><h3 id="experiment-transition-title">{content.title}</h3></div><button aria-label="Close experiment decision" onClick={onClose}><X weight="bold"/></button></header><div><p><strong>{experiment.name}</strong></p><p>{content.detail}</p><div><ShieldCheck weight="fill"/><span>Copy remains policy validated. Results never trigger automatic promotion.</span></div></div><footer><button className="secondary-button" onClick={onClose} disabled={busy}>Cancel</button><button className="primary-button" onClick={onConfirm} disabled={busy}>{busy?'Applying…':content.confirm}</button></footer></section></div>
}

function defaultVariants():VariantDraft[]{return[{key:'control',allocation:50,body:'Reply if you would like help reviewing current appointment availability.'},{key:'concierge',allocation:50,body:'Our salon team can help you review current appointment availability when you are ready.'}]}
function template(body:string){return`${prefix} ${body.trim()} ${suffix}`}
function displayTemplate(value:string){return value.replace(prefix,'').replace(suffix,'').trim()}
function dateValue(value:FormDataEntryValue|null){const text=String(value??'').trim();return text?new Date(text).toISOString():undefined}
function percent(value:number){return`${(value*100).toFixed(value===0||value===1?0:1)}%`}
function formatDate(value:string){return new Intl.DateTimeFormat('en-GB',{dateStyle:'medium'}).format(new Date(value))}
function statusLabel(value:ApiControlledExperiment['status']){return value.charAt(0).toUpperCase()+value.slice(1)}
function workflowLabel(value:ApiControlledExperiment['workflowType']){return{no_show_recovery:'No-show recovery',post_visit_rebook:'Post-visit rebooking',lapsed_reactivation:'Lapsed-client reactivation'}[value]}
function schedule(value:ApiControlledExperiment){if(!value.startsAt&&!value.endsAt)return'Open schedule';if(value.startsAt&&value.endsAt)return`${formatDate(value.startsAt)}–${formatDate(value.endsAt)}`;return value.startsAt?`From ${formatDate(value.startsAt)}`:`Until ${formatDate(value.endsAt!)}`}
function message(reason:unknown){return reason instanceof Error?reason.message:'The controlled experiment could not be updated.'}
function emptyResults(value:ApiControlledExperiment):ApiControlledExperimentResult{return{experimentId:value.id,status:value.status,evidence:'verified_booking_attribution_only',minimumSampleReached:false,minimumSamplePerVariant:50,winnerSuggested:false,variants:value.variants.map(variant=>({variantKey:variant.key,allocation:variant.allocation,exposures:0,recoveredBookings:0,conversionRate:0,verifiedRecoveredRevenueMinorByCurrency:{}})),generatedAt:now}}
function demoCreated(input:ApiControlledExperimentInput):ApiControlledExperiment{return{id:`demo-${Date.now()}`,...input,status:'draft',createdAt:now,updatedAt:now}}
function demoTransition(value:ApiControlledExperiment,action:TransitionAction):ApiControlledExperiment{const status=action==='activate'?'active':action==='pause'?'paused':'completed';return{...value,status,updatedAt:now,...(action==='activate'?{activatedAt:now}:{}),...(action==='complete'?{completedAt:now}:{})}}

const now='2026-07-22T12:00:00.000Z'
const demoExperiments:ApiControlledExperiment[]=[
  {id:'demo-reactivation',name:'Concierge reactivation copy',workflowType:'lapsed_reactivation',status:'active',variants:[{key:'control',allocation:50,messageTemplate:template('Reply if you would like help reviewing current appointment availability.')},{key:'concierge',allocation:50,messageTemplate:template('Our salon team can help you review current appointment availability when you are ready.')}],startsAt:'2026-07-01T09:00:00.000Z',endsAt:'2026-07-31T18:00:00.000Z',createdAt:'2026-06-28T12:00:00.000Z',updatedAt:'2026-07-01T09:00:00.000Z',activatedAt:'2026-07-01T09:00:00.000Z'},
  {id:'demo-rebook',name:'Post-visit timing language',workflowType:'post_visit_rebook',status:'draft',variants:[{key:'control',allocation:50,messageTemplate:template('Reply if you would like to review current availability for your next visit.')},{key:'care_plan',allocation:50,messageTemplate:template('Our salon team can help review current availability for your next recommended visit.')}],createdAt:'2026-07-18T10:30:00.000Z',updatedAt:'2026-07-18T10:30:00.000Z'},
  {id:'demo-no-show',name:'No-show recovery tone',workflowType:'no_show_recovery',status:'completed',variants:[{key:'direct',allocation:50,messageTemplate:template('Reply if you would like help reviewing current availability for another appointment.')},{key:'supportive',allocation:50,messageTemplate:template('Our salon team can help you review current availability for another appointment when you are ready.')}],createdAt:'2026-05-02T08:00:00.000Z',updatedAt:'2026-06-02T18:00:00.000Z',activatedAt:'2026-05-03T08:00:00.000Z',completedAt:'2026-06-02T18:00:00.000Z'},
]
const demoResults:Record<string,ApiControlledExperimentResult>={
  'demo-reactivation':{experimentId:'demo-reactivation',status:'active',evidence:'verified_booking_attribution_only',minimumSampleReached:true,minimumSamplePerVariant:50,winnerSuggested:false,variants:[{variantKey:'control',allocation:50,exposures:126,recoveredBookings:18,conversionRate:18/126,verifiedRecoveredRevenueMinorByCurrency:{GBP:284500}},{variantKey:'concierge',allocation:50,exposures:121,recoveredBookings:22,conversionRate:22/121,verifiedRecoveredRevenueMinorByCurrency:{GBP:361000}}],generatedAt:now},
  'demo-no-show':{experimentId:'demo-no-show',status:'completed',evidence:'verified_booking_attribution_only',minimumSampleReached:true,minimumSamplePerVariant:50,winnerSuggested:false,variants:[{variantKey:'direct',allocation:50,exposures:89,recoveredBookings:11,conversionRate:11/89,verifiedRecoveredRevenueMinorByCurrency:{GBP:132000}},{variantKey:'supportive',allocation:50,exposures:92,recoveredBookings:13,conversionRate:13/92,verifiedRecoveredRevenueMinorByCurrency:{GBP:156500}}],generatedAt:now},
}
