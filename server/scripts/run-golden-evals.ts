import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { Pool } from 'pg'
import type { ConversationMessage, LocationSettings, ServiceRecord, StaffRecord, TenantContext } from '../domain/schemas.js'
import { evaluateGoldenConversations, type GoldenRouter } from '../evals/golden-evaluator.js'
import { GOLDEN_DATASET_VERSION, type GoldenConversationCase } from '../evals/golden-conversations.js'
import { OpenAIConversationAgent } from '../services/openai-conversation-agent.js'
import { createConversationRouterPrompt, conversationRouterPromptManifest } from '../prompts/conversation-router.js'

const modelMode=process.argv.includes('--model')
const model=process.env.MODEL_CONCIERGE?.trim()||(modelMode?'':'deterministic-router-v1')
if(modelMode&&process.env.EVAL_ALLOW_MODEL_CALLS!=='true')fail('EVAL_ALLOW_MODEL_CALLS must be true for a model evaluation')
if(modelMode&&!process.env.OPENAI_API_KEY)fail('OPENAI_API_KEY is required for a model evaluation')
if(modelMode&&!model)fail('MODEL_CONCIERGE must pin the evaluated release model')

const evaluatedModel=model||'deterministic-router-v1'
const manifest=conversationRouterPromptManifest(evaluatedModel)
const router=modelMode?modelRouter(process.env.OPENAI_API_KEY!,evaluatedModel):undefined
const report=await evaluateGoldenConversations({mode:modelMode?'model':'deterministic',model:evaluatedModel,router,concurrency:modelMode?3:1,promptVersion:manifest.releaseLabel,promptDigest:manifest.contentDigest})
console.log(JSON.stringify(report,null,2))
await persistEvidence(report)
await persistDatabase(report)
if(report.status!=='passed')process.exitCode=1

function modelRouter(apiKey:string,modelName:string):GoldenRouter{
  const agent=new OpenAIConversationAgent(apiKey,modelName)
  const context:TenantContext={tenantId:'golden-eval-tenant',locationId:'golden-eval-location',userId:'golden-eval',role:'service'}
  const settings:LocationSettings={tenantId:context.tenantId,locationId:context.locationId,salonName:'Maison Plum',senderName:'Maison Plum',timezone:'Europe/London',brandVoice:'Warm, concise and professional',reportRecipientEmail:'eval@example.invalid',updatedAt:'2026-01-01T00:00:00.000Z'}
  const services:ServiceRecord[]=[{id:'service-silk-press',tenantId:context.tenantId,locationId:context.locationId,provider:'square',externalItemId:'catalog-silk-press',version:'1',name:'Silk Press',variationName:'Standard',durationMinutes:90,priceMinor:8500,currency:'GBP',active:true,teamMemberIds:['staff-amara'],syncedAt:'2026-01-01T00:00:00.000Z'}]
  const staff:StaffRecord[]=[{id:'staff-amara',tenantId:context.tenantId,locationId:context.locationId,provider:'square',name:'Amara',bookable:true,syncedAt:'2026-01-01T00:00:00.000Z'}]
  const prompt=createConversationRouterPrompt(modelName,{id:'golden-prompt-v1',createdAt:'2026-01-01T00:00:00.000Z',approvalReference:'golden-evaluation'})
  return async value=>{
    const conversationId=`eval-${value.id}`
    const history=(value.history??[]).map((body,index):ConversationMessage=>({id:randomUUID(),tenantId:context.tenantId,locationId:context.locationId,conversationId,direction:'inbound',author:'client',body,deliveryStatus:'received',createdAt:new Date(Date.UTC(2026,0,1,10,index)).toISOString()}))
    const message:ConversationMessage={id:randomUUID(),tenantId:context.tenantId,locationId:context.locationId,conversationId,direction:'inbound',author:'client',body:value.message,deliveryStatus:'received',createdAt:'2026-01-01T11:00:00.000Z'}
    return agent.route({context,agentRunId:randomUUID(),message,history:[...history,message].slice(-8),settings,services,staff,verifiedContext:{client:{profileAvailable:false},consent:[],upcomingAppointments:[],factualSummary:'Client timezone is not verified. No consent records or upcoming appointments are present in this isolated evaluation case. No appointment action is awaiting confirmation.'},prompt})
  }
}

async function persistEvidence(report:object){
  const requested=process.env.EVAL_EVIDENCE_OUTPUT?.trim()
  if(!requested)return
  const root=resolve(process.cwd(),'release-evidence')
  const output=resolve(process.cwd(),requested)
  if(output!==root&&!output.startsWith(`${root}/`))throw new Error('EVAL_EVIDENCE_OUTPUT must remain inside release-evidence/')
  await mkdir(root,{recursive:true})
  await writeFile(output,`${JSON.stringify(report,null,2)}\n`,{encoding:'utf8',flag:'wx'})
}

async function persistDatabase(report:{status:string;mode:string;model:string;promptVersion:string;promptDigest:string;metrics:object;failures:object[];startedAt:string;completedAt:string}){
  if(process.env.EVAL_PERSIST_TO_DATABASE!=='true')return
  const databaseUrl=process.env.DATABASE_URL?.trim();const tenantId=process.env.SANDBOX_TENANT_ID?.trim();const locationId=process.env.SANDBOX_LOCATION_ID?.trim()
  if((!databaseUrl&&!process.env.PGHOST)||!tenantId||!locationId)fail('DATABASE_URL or PGHOST, plus SANDBOX_TENANT_ID and SANDBOX_LOCATION_ID, are required to persist evaluation evidence')
  const pool=new Pool({...(databaseUrl?{connectionString:databaseUrl}:{}),max:1,connectionTimeoutMillis:8_000})
  try{await pool.query(`INSERT INTO agent_evaluation_runs (id,tenant_id,location_id,dataset_version,mode,model,prompt_version,prompt_digest,status,total_cases,passed_cases,failed_cases,metrics,record,started_at,completed_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,[randomUUID(),tenantId,locationId,GOLDEN_DATASET_VERSION,report.mode,report.model,report.promptVersion,report.promptDigest,report.status,(report.metrics as{total:number}).total,(report.metrics as{passed:number}).passed,(report.metrics as{failed:number}).failed,report.metrics,{failureIds:report.failures.map((value:{id?:unknown})=>value.id).filter(value=>typeof value==='string'),promptDigest:report.promptDigest},report.startedAt,report.completedAt])}finally{await pool.end()}
}

function fail(message:string):never{console.error(JSON.stringify({status:'failed',issues:[message]},null,2));process.exit(1)}
