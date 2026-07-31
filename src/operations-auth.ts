import type { User, UserManager } from 'oidc-client-ts'
import { resolveOperationsAuthConfiguration } from './operations-auth-config'

export type OperationsIdentity = { displayName: string; email?: string; initials: string }
export type OperationsAuthSnapshot =
  | { status: 'loading'; message: string }
  | { status: 'demo' }
  | { status: 'anonymous' }
  | { status: 'authenticated'; identity: OperationsIdentity; development: boolean }
  | { status: 'misconfigured'; message: string }
  | { status: 'error'; message: string }

const devToken = import.meta.env.DEV ? String(import.meta.env.VITE_DEV_AUTH_TOKEN ?? '').trim() : ''
const configuration = resolveOperationsAuthConfiguration(import.meta.env, { origin: window.location.origin, production: import.meta.env.PROD })
let manager: UserManager | undefined
let snapshot: OperationsAuthSnapshot = { status: 'loading', message: 'Checking your operations session' }
let bootstrapPromise: Promise<OperationsAuthSnapshot> | undefined
const listeners = new Set<(value: OperationsAuthSnapshot) => void>()

export function bootstrapOperationsAuth(): Promise<OperationsAuthSnapshot> {
  bootstrapPromise ??= runBootstrap()
  return bootstrapPromise
}

async function runBootstrap(): Promise<OperationsAuthSnapshot> {
  if (devToken) return update({ status: 'authenticated', identity: { displayName: 'Development operator', initials: 'DO' }, development: true })
  if (configuration.mode === 'disabled') return update(import.meta.env.DEV ? { status: 'demo' } : { status: 'misconfigured', message: 'Secure organisation sign-in has not been configured for this dashboard.' })
  if (configuration.mode === 'invalid') return update({ status: 'misconfigured', message: configuration.message })

  try {
      const userManager = await getManager()
    if (window.location.pathname.replace(/\/+$/, '') === '/app/auth/callback') {
      update({ status: 'loading', message: 'Completing secure sign-in' })
      const user = await userManager.signinRedirectCallback()
      window.history.replaceState({}, document.title, '/app')
      return update(authenticatedSnapshot(user))
    }
    const user = await userManager.getUser()
    if (!user || user.expired || !user.access_token) {
      if (user) await userManager.removeUser()
      return update({ status: 'anonymous' })
    }
    return update(authenticatedSnapshot(user))
  } catch {
    window.history.replaceState({}, document.title, '/app')
    return update({ status: 'error', message: 'Secure sign-in could not be completed. Start a new sign-in attempt or contact your operations administrator.' })
  }
}

export function subscribeOperationsAuth(listener: (value: OperationsAuthSnapshot) => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function hasOperationsSession() { return snapshot.status === 'authenticated' }

export async function beginOperationsSignIn() {
  if (configuration.mode !== 'oidc') throw new Error('Secure organisation sign-in is not configured')
  update({ status: 'loading', message: 'Opening secure sign-in' })
  bootstrapPromise = undefined
  await (await getManager()).signinRedirect()
}

export async function endOperationsSession() {
  if (devToken) return update({ status: 'authenticated', identity: { displayName: 'Development operator', initials: 'DO' }, development: true })
  if (configuration.mode !== 'oidc') return update(import.meta.env.DEV ? { status: 'demo' } : { status: 'anonymous' })
  const userManager = await getManager()
  const user = await userManager.getUser()
  if (!user) return update({ status: 'anonymous' })
  try {
    await userManager.signoutRedirect()
  } catch {
    await userManager.removeUser()
    update({ status: 'anonymous' })
  }
  return snapshot
}

export async function getOperationsAccessToken() {
  if (devToken) return devToken
  if (configuration.mode !== 'oidc' || snapshot.status !== 'authenticated') return undefined
  const userManager = await getManager()
  const user = await userManager.getUser()
  if (!user || user.expired || !user.access_token) {
    if (user) await userManager.removeUser()
    update({ status: 'anonymous' })
    bootstrapPromise = undefined
    return undefined
  }
  return user.access_token
}

export async function invalidateOperationsSession() {
  if (manager) await manager.removeUser()
  bootstrapPromise = undefined
  if (!devToken) update({ status: 'anonymous' })
}

async function getManager() {
  if (manager) return manager
  if (configuration.mode !== 'oidc') throw new Error('Secure organisation sign-in is not configured')
  const { UserManager, WebStorageStateStore } = await import('oidc-client-ts')
  const sessionStore = new WebStorageStateStore({ store: window.sessionStorage })
  manager = new UserManager({
    authority: configuration.settings.authority,
    client_id: configuration.settings.clientId,
    redirect_uri: configuration.settings.redirectUri,
    post_logout_redirect_uri: configuration.settings.postLogoutRedirectUri,
    scope: configuration.settings.scope,
    ...(configuration.settings.resource ? { resource: configuration.settings.resource } : {}),
    response_type: 'code',
    disablePKCE: false,
    automaticSilentRenew: false,
    monitorSession: false,
    loadUserInfo: false,
    redirectMethod: 'replace',
    stateStore: sessionStore,
    userStore: sessionStore,
  })
  manager.events.addAccessTokenExpired(() => { update({ status: 'anonymous' }) })
  manager.events.addUserSignedOut(() => { update({ status: 'anonymous' }) })
  manager.events.addUserUnloaded(() => { update({ status: 'anonymous' }) })
  return manager
}

function authenticatedSnapshot(user: User): OperationsAuthSnapshot {
  const displayName = firstClaim(user, ['name', 'preferred_username', 'email']) ?? 'Salon operator'
  const email = firstClaim(user, ['email'])
  const initials = displayName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'SO'
  return { status: 'authenticated', identity: { displayName, ...(email ? { email } : {}), initials }, development: false }
}

function firstClaim(user: User, keys: string[]) {
  for (const key of keys) {
    const value = user.profile[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return undefined
}

function update(value: OperationsAuthSnapshot) {
  snapshot = value
  listeners.forEach((listener) => listener(value))
  return value
}
