export type BrowserEnvironment = Record<string, string | boolean | undefined>

export type OidcBrowserSettings = {
  authority: string
  clientId: string
  redirectUri: string
  postLogoutRedirectUri: string
  scope: string
  resource?: string
}

export type OperationsAuthConfiguration =
  | { mode: 'disabled' }
  | { mode: 'invalid'; message: string }
  | { mode: 'oidc'; settings: OidcBrowserSettings }

const oidcKeys = ['VITE_OIDC_AUTHORITY', 'VITE_OIDC_CLIENT_ID', 'VITE_OIDC_REDIRECT_URI', 'VITE_OIDC_POST_LOGOUT_REDIRECT_URI'] as const

export function resolveOperationsAuthConfiguration(
  environment: BrowserEnvironment,
  runtime: { origin: string; production: boolean },
): OperationsAuthConfiguration {
  const values = Object.fromEntries(oidcKeys.map((key) => [key, stringValue(environment[key])])) as Record<(typeof oidcKeys)[number], string>
  const configured = oidcKeys.filter((key) => values[key])
  if (configured.length === 0) return { mode: 'disabled' }

  const missing = oidcKeys.filter((key) => !values[key])
  if (missing.length) return { mode: 'invalid', message: `Dashboard identity configuration is incomplete: ${missing.join(', ')}` }

  const authority = safeUrl(values.VITE_OIDC_AUTHORITY, 'VITE_OIDC_AUTHORITY')
  const redirect = safeUrl(values.VITE_OIDC_REDIRECT_URI, 'VITE_OIDC_REDIRECT_URI')
  const postLogout = safeUrl(values.VITE_OIDC_POST_LOGOUT_REDIRECT_URI, 'VITE_OIDC_POST_LOGOUT_REDIRECT_URI')
  if (authority instanceof Error || redirect instanceof Error || postLogout instanceof Error) {
    const error = [authority, redirect, postLogout].find((value) => value instanceof Error)
    return { mode: 'invalid', message: error instanceof Error ? error.message : 'Dashboard identity configuration is invalid' }
  }

  if (authority.username || authority.password || authority.search || authority.hash) return { mode: 'invalid', message: 'VITE_OIDC_AUTHORITY cannot contain credentials, a query, or a fragment' }
  if (runtime.production && authority.protocol !== 'https:') return { mode: 'invalid', message: 'VITE_OIDC_AUTHORITY must use HTTPS in production' }
  if (runtime.production && (redirect.protocol !== 'https:' || postLogout.protocol !== 'https:')) return { mode: 'invalid', message: 'Dashboard redirect URLs must use HTTPS in production' }

  const runtimeOrigin = normalizeOrigin(runtime.origin)
  if (!runtimeOrigin) return { mode: 'invalid', message: 'The dashboard runtime origin is invalid' }
  if (redirect.origin !== runtimeOrigin || postLogout.origin !== runtimeOrigin) return { mode: 'invalid', message: 'Dashboard redirect URLs must use the dashboard origin' }
  if (normalizePath(redirect.pathname) !== '/app/auth/callback') return { mode: 'invalid', message: 'VITE_OIDC_REDIRECT_URI must end at /app/auth/callback' }
  if (normalizePath(postLogout.pathname) !== '/app') return { mode: 'invalid', message: 'VITE_OIDC_POST_LOGOUT_REDIRECT_URI must end at /app' }

  const scope = stringValue(environment.VITE_OIDC_SCOPE) || 'openid profile email'
  if (!scope.split(/\s+/).includes('openid')) return { mode: 'invalid', message: 'VITE_OIDC_SCOPE must include openid' }

  const resource = stringValue(environment.VITE_OIDC_RESOURCE)
  return {
    mode: 'oidc',
    settings: {
      authority: authority.toString().replace(/\/$/, ''),
      clientId: values.VITE_OIDC_CLIENT_ID,
      redirectUri: redirect.toString(),
      postLogoutRedirectUri: postLogout.toString(),
      scope,
      ...(resource ? { resource } : {}),
    },
  }
}

function stringValue(value: string | boolean | undefined) { return typeof value === 'string' ? value.trim() : '' }

function safeUrl(value: string, key: string) {
  try { return new URL(value) } catch { return new Error(`${key} must be a valid absolute URL`) }
}

function normalizeOrigin(value: string) {
  try { return new URL(value).origin } catch { return undefined }
}

function normalizePath(value: string) { return value.replace(/\/+$/, '') || '/' }
