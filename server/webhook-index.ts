import { createStore } from './repositories/create-store.js'
import { createWebhookApp } from './webhook-app.js'
import { OperationalTelemetry } from './operational-telemetry.js'

const store=createStore()
const app = createWebhookApp(store)
const telemetry=new OperationalTelemetry('salon-recovery-webhook-ingester');const port=Number(process.env.WEBHOOK_PORT??4200)
app.listen({ host: process.env.WEBHOOK_HOST ?? '127.0.0.1', port }).then(()=>telemetry.emit('service.started','info',{port})).catch((error) => { telemetry.error('service.start_failed',error); process.exit(1) })

let stopping=false
const stop=async()=>{if(stopping)return;stopping=true;telemetry.emit('service.stopping');await app.close();await store.close?.();telemetry.emit('service.stopped');process.exit(0)}
process.once('SIGINT',stop)
process.once('SIGTERM',stop)
