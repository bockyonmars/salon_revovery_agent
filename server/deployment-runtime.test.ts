import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createApp } from './app.js'
import { createWebhookApp } from './webhook-app.js'
import { MemoryStore } from './repositories/memory-store.js'
import { workerProbe, workerReadiness, type WorkerHealthState } from './worker-health.js'
import { registerStaticAssets } from './static-assets.js'

class UnhealthyStore extends MemoryStore{override async healthCheck(){throw new Error('postgres://secret-credential@database.internal/salon')}}

const applications:Array<{close():Promise<unknown>}>=[]
const temporaryDirectories:string[]=[]
afterEach(async()=>{await Promise.all(applications.splice(0).map(value=>value.close()));await Promise.all(temporaryDirectories.splice(0).map(value=>rm(value,{recursive:true,force:true})))})

describe('production service probes',()=>{
  it('packages migrations and gates protected release configuration explicitly',async()=>{const[dockerfile,manifest,validator]=await Promise.all([readFile(new URL('../Dockerfile',import.meta.url),'utf8'),readFile(new URL('../package.json',import.meta.url),'utf8'),readFile(new URL('./scripts/validate-release-candidate.ts',import.meta.url),'utf8')]);expect(dockerfile).toContain('cp -R server/db/migrations dist-server/db/migrations');expect(dockerfile).toContain('ARG VITE_TURNSTILE_SITE_KEY');expect(dockerfile).not.toContain('TURNSTILE_SECRET_KEY');const scripts=JSON.parse(manifest).scripts;expect(scripts['db:migrate:prod']).toBe('node dist-server/db/migrate.js');expect(scripts['bot:preflight']).toBeDefined();expect(scripts['security:preflight']).toBeDefined();expect(scripts['voice:sandbox:preflight']).toBeDefined();expect(scripts['voice:sandbox:evaluate']).toBeDefined();expect(validator).toContain("public_bot_protection_configuration");expect(validator).toContain("security_governance_evidence");expect(validator).toContain("if(process.env.OPENAI_REALTIME_SIP_ENABLED==='true')runGate('voice_realtime_sandbox_evidence'")})

  it('keeps the pull-request gate read-only, secret-free, and supply-chain pinned',async()=>{const[dockerfile,workflow]=await Promise.all([readFile(new URL('../Dockerfile',import.meta.url),'utf8'),readFile(new URL('../.github/workflows/ci.yml',import.meta.url),'utf8')]);expect(dockerfile.match(/node:22\.23\.1-bookworm-slim@sha256:[a-f0-9]{64}/g)).toHaveLength(2);expect(workflow).toContain('permissions:\n  contents: read');expect(workflow).toContain('persist-credentials: false');expect(workflow).toContain('package-manager-cache: false');expect(workflow).toContain('npm run release:validate:local');expect(workflow).toContain('docker build');expect(workflow).not.toContain('pull_request_target');expect(workflow).not.toContain('secrets.');expect(workflow.match(/actions\/(?:checkout|setup-node)@[a-f0-9]{40}/g)).toHaveLength(2)})

  it('keeps liveness process-only and makes API readiness dependency-aware without leaking errors',async()=>{
    const healthy=createApp(new MemoryStore());const unhealthy=createApp(new UnhealthyStore());applications.push(healthy,unhealthy)
    expect((await healthy.inject({method:'GET',url:'/livez'})).json()).toEqual({status:'alive',service:'salon-recovery-api'})
    expect((await healthy.inject({method:'GET',url:'/readyz'})).json()).toEqual({status:'ready',service:'salon-recovery-api'})
    const live=await unhealthy.inject({method:'GET',url:'/livez'});const ready=await unhealthy.inject({method:'GET',url:'/readyz'});expect(live.statusCode).toBe(200);expect(ready.statusCode).toBe(503);expect(ready.json()).toEqual({status:'not_ready',service:'salon-recovery-api'});expect(ready.body).not.toContain('secret-credential')
  })

  it('makes webhook readiness fail closed while its liveness endpoint remains available',async()=>{
    const webhook=createWebhookApp(new UnhealthyStore());applications.push(webhook);expect((await webhook.inject({method:'GET',url:'/livez'})).statusCode).toBe(200);const ready=await webhook.inject({method:'GET',url:'/readyz'});expect(ready.statusCode).toBe(503);expect(ready.json()).toEqual({status:'not_ready',service:'salon-recovery-webhook-ingester'});expect(ready.body).not.toContain('database.internal')
  })

  it('fails worker readiness for shutdown, a stalled tick, or database loss',async()=>{
    expect(await workerReadiness(new MemoryStore(),{shuttingDown:false},10_000,20_000)).toEqual({status:'ready',service:'salon-recovery-workflow-worker'})
    expect(await workerReadiness(new MemoryStore(),{shuttingDown:true},10_000,20_000)).toMatchObject({status:'not_ready',reason:'shutting_down'})
    expect(await workerReadiness(new MemoryStore(),{shuttingDown:false,tickStartedAt:5_000},10_000,20_000)).toMatchObject({status:'not_ready',reason:'worker_stalled'})
    expect(await workerReadiness(new UnhealthyStore(),{shuttingDown:false},10_000,20_000)).toMatchObject({status:'not_ready',reason:'database_unavailable'})
  })

  it('routes worker liveness and readiness probes without exposing a tenant surface',async()=>{
    const state:WorkerHealthState={shuttingDown:false};expect(await workerProbe('GET','/livez',new MemoryStore(),state,10_000)).toEqual({statusCode:200,payload:{status:'alive',service:'salon-recovery-workflow-worker'}});expect((await workerProbe('GET','/readyz',new MemoryStore(),state,10_000)).statusCode).toBe(200);expect((await workerProbe('POST','/readyz',new MemoryStore(),state,10_000)).statusCode).toBe(404);state.shuttingDown=true;expect((await workerProbe('GET','/readyz',new MemoryStore(),state,10_000)).statusCode).toBe(503)
  })

  it('serves the packaged application, deep links, and immutable assets without masking API misses',async()=>{
    const root=await mkdtemp(join(tmpdir(),'salon-static-'));temporaryDirectories.push(root);await mkdir(join(root,'assets'));await Promise.all([writeFile(join(root,'index.html'),'<!doctype html><main>Salon operations</main>'),writeFile(join(root,'assets','app-abc123.js'),'console.log("ready")')]);const app=createApp(new MemoryStore());registerStaticAssets(app,root);applications.push(app)
    const shell=await app.inject({method:'GET',url:'/app/conversations'});expect(shell.statusCode).toBe(200);expect(shell.headers['content-type']).toContain('text/html');expect(shell.headers['cache-control']).toBe('no-cache');expect(shell.headers['content-security-policy']).toContain("frame-ancestors 'none'");expect(shell.body).toContain('Salon operations')
    const asset=await app.inject({method:'GET',url:'/assets/app-abc123.js'});expect(asset.statusCode).toBe(200);expect(asset.headers['content-type']).toContain('text/javascript');expect(asset.headers['cache-control']).toBe('public, max-age=31536000, immutable')
    const head=await app.inject({method:'HEAD',url:'/assets/app-abc123.js'});expect(head.statusCode).toBe(200);expect(head.body).toBe('');expect(head.headers['content-length']).toBe(String(Buffer.byteLength('console.log("ready")')))
    const missingApi=await app.inject({method:'GET',url:'/v1/not-a-route'});expect(missingApi.statusCode).toBe(404);expect(missingApi.json()).toMatchObject({error:'NOT_FOUND'})
    const missingAsset=await app.inject({method:'GET',url:'/assets/missing.js'});expect(missingAsset.statusCode).toBe(404);expect(missingAsset.json()).toMatchObject({error:'NOT_FOUND'})
    const traversal=await app.inject({method:'GET',url:'/assets/%2e%2e/package.json'});expect(traversal.statusCode).toBe(404);expect(traversal.body).not.toContain('salon-recovery-agent')
  })
})
