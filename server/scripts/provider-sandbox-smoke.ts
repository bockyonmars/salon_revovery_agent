import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { parseSandboxSmokeConfig, runSandboxSmoke, SandboxConfigurationError } from '../release/sandbox-smoke.js'

const execute=process.argv.includes('--execute')

try{
  const config=parseSandboxSmokeConfig(process.env)
  if(!execute){
    console.log(JSON.stringify({status:'passed',mode:'preflight',detail:'Sandbox configuration is complete and restricted to non-production providers'},null,2))
  }else{
    const report=await runSandboxSmoke(config)
    console.log(JSON.stringify(report,null,2))
    await persistOnboardingEvidence(config.databaseUrl,config.tenantId,config.locationId,report)
    if(report.status!=='passed')process.exitCode=1
  }
}catch(error){
  if(error instanceof SandboxConfigurationError){
    console.error(JSON.stringify({status:'failed',mode:execute?'execute':'preflight',issues:error.issues},null,2))
    process.exitCode=1
  }else{
    console.error(JSON.stringify({status:'failed',mode:execute?'execute':'preflight',issues:['Unexpected sandbox smoke failure']},null,2))
    process.exitCode=1
  }
}

async function persistOnboardingEvidence(databaseUrl:string,tenantId:string,locationId:string,report:{status:'passed'|'failed';checks:unknown[];startedAt:string;completedAt:string}){
  if(process.env.SANDBOX_PERSIST_ONBOARDING_EVIDENCE!=='true')return
  const pool=new Pool({connectionString:databaseUrl,max:1,connectionTimeoutMillis:8_000})
  const value={id:randomUUID(),tenantId,locationId,status:report.status,checks:report.checks,startedAt:report.startedAt,completedAt:report.completedAt}
  try{await pool.query(`INSERT INTO onboarding_provider_verification_runs (id,tenant_id,location_id,status,checks,started_at,completed_at,record) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,[value.id,tenantId,locationId,value.status,value.checks,value.startedAt,value.completedAt,value])}finally{await pool.end()}
}
