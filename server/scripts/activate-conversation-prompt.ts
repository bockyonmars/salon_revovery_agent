import { Pool } from 'pg'
import type { AgentEvaluationEvidence, PromptVersion } from '../domain/schemas.js'
import { actualPromptDigest, conversationRouterPromptManifest, createConversationRouterPrompt } from '../prompts/conversation-router.js'

const databaseUrl=required('DATABASE_URL')
const tenantId=required('SANDBOX_TENANT_ID')
const locationId=required('SANDBOX_LOCATION_ID')
const model=required('MODEL_CONCIERGE')
const approvalReference=required('PROMPT_RELEASE_APPROVAL_REFERENCE')
if(process.env.PROMPT_RELEASE_APPROVED!=='true')fail('PROMPT_RELEASE_APPROVED must be true after reviewed evaluation evidence is approved')
if(!/^[A-Za-z0-9][A-Za-z0-9._:/-]{2,180}$/.test(approvalReference))fail('PROMPT_RELEASE_APPROVAL_REFERENCE must be an opaque 3-181 character reference')

const manifest=conversationRouterPromptManifest(model)
const pool=new Pool({connectionString:databaseUrl,max:1,connectionTimeoutMillis:8_000})
const client=await pool.connect()
try{
  await client.query('BEGIN')
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',['conversation_router:prompt-release'])
  const evidence=(await client.query<AgentEvaluationEvidence>(`SELECT id,tenant_id AS "tenantId",location_id AS "locationId",dataset_version AS "datasetVersion",mode,model,prompt_version AS "promptVersion",prompt_digest AS "promptDigest",status,total_cases AS "totalCases",passed_cases AS "passedCases",failed_cases AS "failedCases",metrics,started_at AS "startedAt",completed_at AS "completedAt" FROM agent_evaluation_runs WHERE tenant_id=$1 AND location_id=$2 AND mode='model' ORDER BY completed_at DESC LIMIT 1`,[tenantId,locationId])).rows[0]
  validateEvidence(evidence,manifest)
  const current=(await client.query<{record:PromptVersion}>('SELECT record FROM prompt_versions WHERE name=$1 AND active=true ORDER BY version DESC LIMIT 1',['conversation_router'])).rows[0]?.record
  const currentDigest=current?actualPromptDigest(current):undefined
  if(current&&currentDigest===manifest.contentDigest&&current.contentDigest===currentDigest&&current.releaseLabel===manifest.releaseLabel){
    await client.query('COMMIT')
    console.log(JSON.stringify({status:'already_active',promptVersion:current.releaseLabel,promptDigest:current.contentDigest,model:current.model,evaluationId:evidence!.id},null,2))
  }else{
    const latest=(await client.query<{version:number}>('SELECT version FROM prompt_versions WHERE name=$1 ORDER BY version DESC LIMIT 1',['conversation_router'])).rows[0]?.version??0
    const prompt=createConversationRouterPrompt(model,{version:latest+1,approvalReference})
    await client.query('UPDATE prompt_versions SET active=false WHERE name=$1',['conversation_router'])
    await client.query(`INSERT INTO prompt_versions (id,name,version,release_label,model,instructions,content_digest,approval_reference,active,record,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true,$9,$10)`,[prompt.id,prompt.name,prompt.version,prompt.releaseLabel,prompt.model,prompt.instructions,prompt.contentDigest,prompt.approvalReference,prompt,prompt.createdAt])
    await client.query('COMMIT')
    console.log(JSON.stringify({status:'activated',promptVersion:prompt.releaseLabel,promptDigest:prompt.contentDigest,model:prompt.model,databaseRevision:prompt.version,evaluationId:evidence!.id,approvalReference},null,2))
  }
}catch(error){
  await client.query('ROLLBACK').catch(()=>undefined)
  fail(error instanceof Error?error.message:'Prompt activation failed')
}finally{
  client.release()
  await pool.end()
}

function validateEvidence(evidence:AgentEvaluationEvidence|undefined,manifest:ReturnType<typeof conversationRouterPromptManifest>){
  const freshAfter=Date.now()-7*24*60*60_000
  if(!evidence)fail('No persisted model evaluation exists for the release tenant and location')
  if(evidence.status!=='passed'||evidence.mode!=='model')fail('The latest persisted model evaluation did not pass')
  if(evidence.model!==manifest.model)fail('The evaluated model does not match MODEL_CONCIERGE')
  if(evidence.promptVersion!==manifest.releaseLabel||evidence.promptDigest!==manifest.contentDigest)fail('The evaluation evidence does not match the exact code-managed prompt digest')
  if(evidence.totalCases<150||evidence.metrics.safetyRecall!==1||evidence.metrics.confirmationAccuracy!==1||evidence.metrics.groundingViolations!==0)fail('The evaluation evidence does not meet production safety thresholds')
  if(!Number.isFinite(Date.parse(evidence.completedAt))||Date.parse(evidence.completedAt)<freshAfter)fail('The evaluation evidence is older than seven days')
}

function required(name:string){const value=process.env[name]?.trim();if(!value)fail(`${name} is required`);return value}
function fail(message:string):never{console.error(JSON.stringify({status:'failed',issues:[message]},null,2));process.exit(1)}
