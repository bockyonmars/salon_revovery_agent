import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'

const reservedPaths = ['/v1', '/public', '/oauth', '/health', '/livez', '/readyz']
const contentTypes: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

export function registerStaticAssets(app: FastifyInstance, assetsRoot: string) {
  const root = resolve(assetsRoot)
  app.setNotFoundHandler(async (request, reply) => {
    const pathname = safePathname(request.url)
    if (!pathname || isReserved(pathname) || !['GET', 'HEAD'].includes(request.method)) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: 'Route not found.' })
    }

    const requested = pathname === '/' ? 'index.html' : pathname.slice(1)
    const direct = safeAssetPath(root, requested)
    if (!direct) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Route not found.' })

    const directFile = await readableFile(direct)
    if (directFile) return sendFile(request, reply, direct, pathname.startsWith('/assets/'))

    // Only extensionless client-side routes fall back to the application shell.
    if (extname(requested)) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Asset not found.' })
    const shell = resolve(root, 'index.html')
    if (!await readableFile(shell)) return reply.code(503).send({ error: 'STATIC_ASSETS_UNAVAILABLE', message: 'Application assets are unavailable.' })
    return sendFile(request, reply, shell, false)
  })
}

function safePathname(url: string) {
  try {
    const pathname = decodeURIComponent(new URL(url, 'http://localhost').pathname)
    if (pathname.includes('\0') || pathname.includes('\\')) return undefined
    return pathname
  } catch {
    return undefined
  }
}

function isReserved(pathname: string) {
  return reservedPaths.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
}

function safeAssetPath(root: string, requested: string) {
  const candidate = resolve(root, requested)
  return candidate === root || candidate.startsWith(`${root}${sep}`) ? candidate : undefined
}

async function readableFile(filename: string) {
  try {
    return (await stat(filename)).isFile()
  } catch {
    return false
  }
}

async function sendFile(request: FastifyRequest, reply: FastifyReply, filename: string, immutable: boolean) {
  const metadata = await stat(filename)
  reply
    .type(contentTypes[extname(filename).toLowerCase()] ?? 'application/octet-stream')
    .header('content-length', String(metadata.size))
    .header('cache-control', immutable ? 'public, max-age=31536000, immutable' : 'no-cache')
    .header('x-content-type-options', 'nosniff')
    .header('x-frame-options', 'DENY')
    .header('referrer-policy', 'strict-origin-when-cross-origin')
    .header('permissions-policy', 'camera=(), microphone=(), geolocation=()')
    .header('content-security-policy', "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self' https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' https: wss:; frame-src https://challenges.cloudflare.com")
  if (request.method === 'HEAD') return reply.send()
  return reply.send(createReadStream(filename))
}
