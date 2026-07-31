import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'

export type OperationalLogRecord = {
  timestamp: string
  level: 'info' | 'warn' | 'error'
  service: 'salon-recovery-api' | 'salon-recovery-webhook-ingester' | 'salon-recovery-workflow-worker'
  event: string
  requestId?: string
  method?: string
  route?: string
  statusCode?: number
  durationMs?: number
  errorCode?: string
  port?: number
}
export type OperationalLogSink = (record: OperationalLogRecord) => void

export class OperationalTelemetry {
  private readonly enabled: boolean
  constructor(readonly service: OperationalLogRecord['service'], private readonly sink: OperationalLogSink = jsonSink, enabled?: boolean) {
    this.enabled = enabled ?? (process.env.VITEST !== 'true' && (process.env.NODE_ENV === 'production' || process.env.OPERATIONAL_LOGGING_ENABLED === 'true'))
  }
  emit(event: string, level: OperationalLogRecord['level'] = 'info', fields: Omit<OperationalLogRecord, 'timestamp' | 'level' | 'service' | 'event'> = {}) {
    if (!this.enabled) return
    this.sink({ timestamp: new Date().toISOString(), level, service: this.service, event: safeToken(event, 'runtime.event'), ...safeFields(fields) })
  }
  error(event: string, error: unknown) { this.emit(event, 'error', { errorCode: safeErrorCode(error) }) }
}

export function registerRequestTelemetry(app: FastifyInstance, telemetry: OperationalTelemetry) {
  const starts = new Map<string, bigint>()
  app.addHook('onRequest', async (request, reply) => {
    starts.set(request.id, process.hrtime.bigint())
    reply.header('x-request-id', request.id)
  })
  app.addHook('onResponse', async (request, reply) => {
    const started = starts.get(request.id); starts.delete(request.id)
    const durationMs = started === undefined ? undefined : Number(process.hrtime.bigint() - started) / 1_000_000
    telemetry.emit('http.request.completed', reply.statusCode >= 500 ? 'error' : reply.statusCode >= 400 ? 'warn' : 'info', {
      requestId: request.id,
      method: request.method,
      route: request.routeOptions.url ?? 'unmatched',
      statusCode: reply.statusCode,
      ...(durationMs === undefined ? {} : { durationMs }),
    })
  })
}

export function operationalRequestId(header: unknown) {
  const value = Array.isArray(header) ? header[0] : header
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(value) ? value : randomUUID()
}

export function safeErrorCode(error: unknown) {
  if (typeof error === 'object' && error !== null) {
    if ('code' in error && typeof error.code === 'string') return safeToken(error.code, 'RUNTIME_ERROR')
    if ('status' in error && typeof error.status === 'number') return `HTTP_${Math.trunc(error.status)}`
    if ('name' in error && typeof error.name === 'string') return safeToken(error.name, 'RUNTIME_ERROR')
  }
  return 'RUNTIME_ERROR'
}

function safeFields(fields: Omit<OperationalLogRecord, 'timestamp' | 'level' | 'service' | 'event'>) {
  const record: typeof fields = {}
  if (fields.requestId && /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(fields.requestId)) record.requestId = fields.requestId
  if (fields.method && /^(?:GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS)$/.test(fields.method)) record.method = fields.method
  if (fields.route && /^(?:unmatched|\/[A-Za-z0-9_/:.*-]{0,199})$/.test(fields.route)) record.route = fields.route
  if (Number.isInteger(fields.statusCode) && fields.statusCode! >= 100 && fields.statusCode! <= 599) record.statusCode = fields.statusCode
  if (Number.isFinite(fields.durationMs) && fields.durationMs! >= 0) record.durationMs = Math.round(fields.durationMs! * 100) / 100
  if (fields.errorCode) record.errorCode = safeToken(fields.errorCode, 'RUNTIME_ERROR')
  if (Number.isInteger(fields.port) && fields.port! >= 1 && fields.port! <= 65535) record.port = fields.port
  return record
}

function safeToken(value: string, fallback: string) { return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/.test(value) ? value : fallback }
function jsonSink(record: OperationalLogRecord) { process.stdout.write(`${JSON.stringify(record)}\n`) }
