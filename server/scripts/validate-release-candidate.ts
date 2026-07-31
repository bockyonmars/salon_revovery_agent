import { spawnSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

type Gate={id:string;command:string[];status:'passed'|'failed'|'not_run';durationMs:number}

const localOnly=process.argv.includes('--local-only')
const startedAt=new Date().toISOString()
const gates:Gate[]=[]

runGate('automated_contracts',['npm','test'])
runGate('deterministic_golden_evaluation',['npm','run','eval:golden'])
runGate('production_build',['npm','run','build'])
if(!localOnly){
  runGate('dashboard_oidc_configuration',['npm','run','auth:preflight'])
  runGate('public_bot_protection_configuration',['npm','run','bot:preflight'])
  runGate('security_governance_evidence',['npm','run','security:preflight'])
  runGate('pinned_model_golden_evaluation',['npm','run','eval:golden:model'])
  runGate('provider_sandbox_smoke',['npm','run','sandbox:smoke'])
  if(process.env.OPENAI_REALTIME_SIP_ENABLED==='true')runGate('voice_realtime_sandbox_evidence',['npm','run','voice:sandbox:evaluate'])
  runGate('database_restore_drill',['npm','run','db:restore:drill'])
}

const allPassed=gates.every(value=>value.status==='passed')
const report={
  status:allPassed?(localOnly?'local_passed':'passed'):'failed',
  scope:localOnly?'local':'full',
  startedAt,
  completedAt:new Date().toISOString(),
  gates,
  releaseEligible:!localOnly&&allPassed,
}
console.log(JSON.stringify(report,null,2))
await persistOptionalEvidence(report)
if(!allPassed)process.exitCode=1

function runGate(id:string,command:string[]){
  const began=Date.now()
  const [executable,...args]=command
  if(!executable){gates.push({id,command,status:'not_run',durationMs:0});return}
  const result=spawnSync(executable,args,{cwd:process.cwd(),stdio:'inherit',env:process.env})
  gates.push({id,command,status:result.status===0?'passed':'failed',durationMs:Date.now()-began})
}

async function persistOptionalEvidence(report:object){
  const requested=process.env.RELEASE_EVIDENCE_OUTPUT?.trim()
  if(!requested)return
  const evidenceRoot=resolve(process.cwd(),'release-evidence')
  const output=resolve(process.cwd(),requested)
  if(output!==evidenceRoot&&!output.startsWith(`${evidenceRoot}/`))throw new Error('RELEASE_EVIDENCE_OUTPUT must remain inside release-evidence/')
  await mkdir(evidenceRoot,{recursive:true})
  await writeFile(output,`${JSON.stringify(report,null,2)}\n`,{encoding:'utf8',flag:'wx'})
}
