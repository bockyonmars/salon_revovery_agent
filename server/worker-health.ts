import { createServer } from 'node:http'
import type { Store } from './repositories/store.js'

export type WorkerHealthState={shuttingDown:boolean;tickStartedAt?:number;tickCompletedAt?:number}
export type WorkerReadiness={status:'ready'|'not_ready';service:'salon-recovery-workflow-worker';reason?:'shutting_down'|'worker_stalled'|'database_unavailable'}

export async function workerReadiness(store:Store,state:WorkerHealthState,stallAfterMs:number,now=Date.now()):Promise<WorkerReadiness>{
  if(state.shuttingDown)return{status:'not_ready',service:'salon-recovery-workflow-worker',reason:'shutting_down'}
  const tickInProgress=state.tickStartedAt!==undefined&&(state.tickCompletedAt===undefined||state.tickStartedAt>state.tickCompletedAt)
  if(tickInProgress&&now-state.tickStartedAt!>stallAfterMs)return{status:'not_ready',service:'salon-recovery-workflow-worker',reason:'worker_stalled'}
  try{await store.healthCheck();return{status:'ready',service:'salon-recovery-workflow-worker'}}catch{return{status:'not_ready',service:'salon-recovery-workflow-worker',reason:'database_unavailable'}}
}

export async function workerProbe(method:string,path:string,store:Store,state:WorkerHealthState,stallAfterMs:number){
  if(method!=='GET'||!['/health','/livez','/readyz'].includes(path))return{statusCode:404,payload:{status:'not_found' as const}}
  if(path==='/readyz'){const payload=await workerReadiness(store,state,stallAfterMs);return{statusCode:payload.status==='ready'?200:503,payload}}
  return{statusCode:state.shuttingDown?503:200,payload:{status:state.shuttingDown?'stopping' as const:'alive' as const,service:'salon-recovery-workflow-worker' as const}}
}

export function createWorkerHealthServer(store:Store,state:WorkerHealthState,stallAfterMs:number){
  return createServer(async(request,response)=>{
    const path=new URL(request.url??'/','http://worker.local').pathname
    const result=await workerProbe(request.method??'',path,store,state,stallAfterMs)
    send(response,result.statusCode,result.payload)
  })
}

function send(response:import('node:http').ServerResponse,statusCode:number,payload:unknown){const body=JSON.stringify(payload);response.writeHead(statusCode,{'content-type':'application/json; charset=utf-8','content-length':Buffer.byteLength(body),'cache-control':'no-store'});response.end(body)}
