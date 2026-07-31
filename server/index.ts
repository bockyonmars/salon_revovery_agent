import { createApp } from './app.js'
import { createStore } from './repositories/create-store.js'
import { registerStaticAssets } from './static-assets.js'
import { OperationalTelemetry } from './operational-telemetry.js'

const port = Number(process.env.PORT ?? 4100)
const host = process.env.HOST ?? '127.0.0.1'
const store=createStore()
const app = createApp(store)
const telemetry=new OperationalTelemetry('salon-recovery-api')
if(process.env.NODE_ENV==='production'||process.env.STATIC_ASSETS_ENABLED==='true')registerStaticAssets(app,process.env.STATIC_ASSETS_ROOT??'dist')

app.listen({ port, host }).then(()=>telemetry.emit('service.started','info',{port})).catch((error) => {
  telemetry.error('service.start_failed',error)
  process.exit(1)
})

let stopping=false
const stop=async()=>{if(stopping)return;stopping=true;telemetry.emit('service.stopping');await app.close();await store.close?.();telemetry.emit('service.stopped');process.exit(0)}
process.once('SIGINT',stop)
process.once('SIGTERM',stop)
