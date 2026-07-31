import type { FastifyRequest } from 'fastify'
import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose'
import { DomainError } from '../domain/errors.js'
import { TenantContextSchema, type TenantContext } from '../domain/schemas.js'

declare module 'fastify' {
  interface FastifyRequest { tenantContext: TenantContext }
}

type Environment = Record<string, string | undefined>
type SessionRole = TenantContext['role']
type AuthConfig = {
  jwksUrl: URL
  issuer: string
  audience: string[]
  algorithms: string[]
  tenantClaim: string
  locationClaim: string
  userClaim: string
  roleClaim: string
  roleValues: Record<SessionRole, Set<string>>
  mfaRequired: boolean
  mfaRoles: Set<SessionRole>
  mfaAmrClaim: string
  mfaAcrClaim: string
  mfaAmrValues: Set<string>
  mfaAcrValues: Set<string>
  clockToleranceSeconds: number
  maxTokenAgeSeconds: number
}

export type SessionResolver = (request: FastifyRequest) => Promise<TenantContext>
export type SessionResolverOptions = { environment?: Environment; keySet?: JWTVerifyGetKey }

const remoteKeySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>()
const roleOrder: SessionRole[] = ['owner', 'manager', 'operator', 'service']
const asymmetricAlgorithms = new Set(['RS256', 'RS384', 'RS512', 'PS256', 'PS384', 'PS512', 'ES256', 'ES384', 'ES512', 'EdDSA'])

export function createSessionResolver(options: SessionResolverOptions = {}): SessionResolver {
  const environment = options.environment ?? process.env
  return async (request) => resolveAuthorization(request.headers.authorization, environment, options.keySet)
}

export const resolveSession = createSessionResolver()

async function resolveAuthorization(header: string | undefined, environment: Environment, suppliedKeySet?: JWTVerifyGetKey): Promise<TenantContext> {
  const match = header?.match(/^Bearer[\t ]+([^\s]+)$/i)
  if (!match || match[1]!.length > 8192) throw new DomainError('Authenticated tenant session required', 'UNAUTHENTICATED', 401)
  const token = match[1]!
  if (token.startsWith('dev:')) return developmentContext(token, environment)

  const config = authConfig(environment)
  const keySet = suppliedKeySet ?? remoteKeySet(config)
  let payload: JWTPayload
  try {
    payload = (await jwtVerify(token, keySet, {
      issuer: config.issuer,
      audience: config.audience,
      algorithms: config.algorithms,
      clockTolerance: config.clockToleranceSeconds,
      maxTokenAge: config.maxTokenAgeSeconds,
      requiredClaims: ['iat', 'exp'],
    })).payload
  } catch {
    throw new DomainError('The bearer token is invalid or expired', 'UNAUTHENTICATED', 401)
  }

  const tenantId = requiredStringClaim(payload, config.tenantClaim)
  const locationId = requiredStringClaim(payload, config.locationClaim)
  const userId = requiredStringClaim(payload, config.userClaim)
  if (!tenantId || !locationId || !userId) throw new DomainError('The bearer token is missing required tenant context', 'INVALID_SESSION_CLAIMS', 401)
  const role = sessionRole(readClaim(payload, config.roleClaim), config.roleValues)
  if (!role) throw new DomainError('The authenticated user has no supported salon role', 'ROLE_FORBIDDEN', 403)
  if (config.mfaRequired && config.mfaRoles.has(role) && !hasMfaEvidence(payload, config)) throw new DomainError('Multi-factor authentication is required for this salon administrator session', 'MFA_REQUIRED', 403)
  const context = TenantContextSchema.safeParse({ tenantId, locationId, userId, role })
  if (!context.success) throw new DomainError('The bearer token contains invalid tenant context', 'INVALID_SESSION_CLAIMS', 401)
  return context.data
}

function developmentContext(token: string, environment: Environment) {
  if (environment.NODE_ENV === 'production') throw new DomainError('Development sessions are disabled', 'UNAUTHENTICATED', 401)
  const values = token.slice('dev:'.length).split(':')
  if (values.length < 3 || values.length > 4) throw new DomainError('Development session is invalid', 'UNAUTHENTICATED', 401)
  const [tenantId, locationId, userId, role = 'operator'] = values
  const context = TenantContextSchema.safeParse({ tenantId, locationId, userId, role })
  if (!context.success) throw new DomainError('Development session is invalid', 'UNAUTHENTICATED', 401)
  return context.data
}

function authConfig(environment: Environment): AuthConfig {
  const jwksUrl = requiredConfiguration(environment.AUTH_JWKS_URL, 'AUTH_JWKS_URL')
  const issuer = requiredConfiguration(environment.AUTH_ISSUER, 'AUTH_ISSUER')
  const audience = csv(requiredConfiguration(environment.AUTH_AUDIENCE, 'AUTH_AUDIENCE'))
  const algorithms = csv(environment.AUTH_ALLOWED_ALGORITHMS ?? 'RS256')
  if (!audience.length || !algorithms.length || algorithms.some(value => !asymmetricAlgorithms.has(value))) throw configurationError('AUTH_ALLOWED_ALGORITHMS must contain supported asymmetric signing algorithms')
  let parsedJwksUrl: URL
  try { parsedJwksUrl = new URL(jwksUrl) } catch { throw configurationError('AUTH_JWKS_URL must be a valid URL') }
  if (environment.NODE_ENV === 'production' && parsedJwksUrl.protocol !== 'https:') throw configurationError('AUTH_JWKS_URL must use HTTPS in production')
  if (parsedJwksUrl.username || parsedJwksUrl.password) throw configurationError('AUTH_JWKS_URL cannot contain credentials')
  const roleValues: AuthConfig['roleValues'] = {
    owner: new Set(csv(environment.AUTH_OWNER_ROLE_VALUES ?? 'owner')),
    manager: new Set(csv(environment.AUTH_MANAGER_ROLE_VALUES ?? 'manager')),
    operator: new Set(csv(environment.AUTH_OPERATOR_ROLE_VALUES ?? 'operator')),
    service: new Set(csv(environment.AUTH_SERVICE_ROLE_VALUES ?? 'service')),
  }
  const claimedRoles = new Set<string>()
  for (const role of roleOrder) for (const value of roleValues[role]) {
    if (claimedRoles.has(value)) throw configurationError(`Authentication role value ${value} is mapped more than once`)
    claimedRoles.add(value)
  }
  const mfaRequired = environment.NODE_ENV === 'production' || optionalBoolean(environment.AUTH_MFA_REQUIRED, false, 'AUTH_MFA_REQUIRED')
  const configuredMfaRoles = csv(environment.AUTH_MFA_REQUIRED_ROLES ?? 'owner,manager')
  const invalidMfaRole = configuredMfaRoles.find(value => !roleOrder.includes(value as SessionRole))
  if (invalidMfaRole) throw configurationError(`AUTH_MFA_REQUIRED_ROLES contains unsupported role ${invalidMfaRole}`)
  const mfaRoles = new Set(configuredMfaRoles as SessionRole[])
  const mfaAmrValues = new Set(csv(environment.AUTH_MFA_AMR_VALUES ?? 'mfa,otp,hwk,swk'))
  const mfaAcrValues = new Set(csv(environment.AUTH_MFA_ACR_VALUES ?? ''))
  if (mfaRequired && (!mfaRoles.size || (!mfaAmrValues.size && !mfaAcrValues.size))) throw configurationError('MFA enforcement requires at least one role and one accepted amr or acr value')
  return {
    jwksUrl: parsedJwksUrl,
    issuer,
    audience,
    algorithms,
    tenantClaim: claimPath(environment.AUTH_TENANT_CLAIM ?? 'tenant_id'),
    locationClaim: claimPath(environment.AUTH_LOCATION_CLAIM ?? 'location_id'),
    userClaim: claimPath(environment.AUTH_USER_CLAIM ?? 'sub'),
    roleClaim: claimPath(environment.AUTH_ROLE_CLAIM ?? 'role'),
    roleValues,
    mfaRequired,
    mfaRoles,
    mfaAmrClaim: claimPath(environment.AUTH_MFA_AMR_CLAIM ?? 'amr'),
    mfaAcrClaim: claimPath(environment.AUTH_MFA_ACR_CLAIM ?? 'acr'),
    mfaAmrValues,
    mfaAcrValues,
    clockToleranceSeconds: boundedInteger(environment.AUTH_CLOCK_TOLERANCE_SECONDS, 30, 0, 300, 'AUTH_CLOCK_TOLERANCE_SECONDS'),
    maxTokenAgeSeconds: boundedInteger(environment.AUTH_MAX_TOKEN_AGE_SECONDS, 3600, 60, 86400, 'AUTH_MAX_TOKEN_AGE_SECONDS'),
  }
}

function remoteKeySet(config: AuthConfig) {
  const cacheKey = `${config.issuer}\n${config.jwksUrl.href}`
  let keySet = remoteKeySets.get(cacheKey)
  if (!keySet) {
    keySet = createRemoteJWKSet(config.jwksUrl, { timeoutDuration: 4000, cooldownDuration: 30_000, cacheMaxAge: 600_000 })
    remoteKeySets.set(cacheKey, keySet)
  }
  return keySet
}

function readClaim(payload: JWTPayload, path: string): unknown {
  let value: unknown = payload
  for (const segment of path.split('.')) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
    value = (value as Record<string, unknown>)[segment]
  }
  return value
}

function requiredStringClaim(payload: JWTPayload, path: string) {
  const value = readClaim(payload, path)
  return typeof value === 'string' && value.trim() === value && value.length >= 3 && value.length <= 200 ? value : undefined
}

function sessionRole(value: unknown, mappings: AuthConfig['roleValues']): SessionRole | undefined {
  const values = Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : typeof value === 'string' ? [value] : []
  return roleOrder.find(role => values.some(entry => mappings[role].has(entry)))
}

function hasMfaEvidence(payload: JWTPayload, config: AuthConfig) {
  const amrClaim = readClaim(payload, config.mfaAmrClaim)
  const amrValues = Array.isArray(amrClaim) ? amrClaim.filter((value): value is string => typeof value === 'string') : typeof amrClaim === 'string' ? [amrClaim] : []
  const methods = new Set(amrValues)
  if (methods.has('mfa') && config.mfaAmrValues.has('mfa')) return true
  if (methods.size >= 2 && [...methods].some(value => value !== 'mfa' && config.mfaAmrValues.has(value))) return true
  const acrClaim = readClaim(payload, config.mfaAcrClaim)
  return typeof acrClaim === 'string' && config.mfaAcrValues.has(acrClaim)
}

function requiredConfiguration(value: string | undefined, name: string) {
  if (!value?.trim()) throw configurationError(`${name} is required`)
  return value.trim()
}

function csv(value: string) { return [...new Set(value.split(',').map(entry => entry.trim()).filter(Boolean))] }

function claimPath(value: string) {
  const path = value.trim()
  if (!/^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/.test(path) || path.split('.').some(segment => ['__proto__', 'prototype', 'constructor'].includes(segment))) throw configurationError(`Invalid authentication claim path: ${value}`)
  return path
}

function boundedInteger(value: string | undefined, fallback: number, minimum: number, maximum: number, name: string) {
  const parsed = value === undefined ? fallback : Number(value)
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) throw configurationError(`${name} must be an integer from ${minimum} through ${maximum}`)
  return parsed
}

function optionalBoolean(value:string|undefined,fallback:boolean,name:string){if(value===undefined)return fallback;if(value==='true')return true;if(value==='false')return false;throw configurationError(`${name} must be true or false`)}

function configurationError(message: string) { return new DomainError(message, 'AUTH_CONFIGURATION_ERROR', 503) }
