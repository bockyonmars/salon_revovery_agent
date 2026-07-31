export type DashboardAuthReleaseConfig={issuer:string;redirectPath:string;postLogoutPath:string;scopes:string[];resourceConfigured:boolean;apiMode:'same_origin'|'explicit'}

export class DashboardAuthConfigurationError extends Error{
  constructor(readonly issues:string[]){super('Dashboard authentication configuration is incomplete or unsafe');this.name='DashboardAuthConfigurationError'}
}

export function parseDashboardAuthReleaseConfig(environment:NodeJS.ProcessEnv):DashboardAuthReleaseConfig{
  const issues:string[]=[]
  const publicOrigin=url(environment,'DASHBOARD_PUBLIC_ORIGIN',issues)
  const authority=url(environment,'VITE_OIDC_AUTHORITY',issues)
  const redirect=url(environment,'VITE_OIDC_REDIRECT_URI',issues)
  const postLogout=url(environment,'VITE_OIDC_POST_LOGOUT_REDIRECT_URI',issues)
  const issuer=url(environment,'AUTH_ISSUER',issues)
  const jwks=url(environment,'AUTH_JWKS_URL',issues)
  const clientId=required(environment,'VITE_OIDC_CLIENT_ID',issues)
  required(environment,'AUTH_AUDIENCE',issues)
  const scopes=(environment.VITE_OIDC_SCOPE?.trim()||'openid profile email').split(/\s+/).filter(Boolean)
  const resource=environment.VITE_OIDC_RESOURCE?.trim()||''
  const apiBase=environment.VITE_API_BASE_URL?.trim()||''

  if(clientId&&(clientId.length>200||/\s/.test(clientId)))issues.push('VITE_OIDC_CLIENT_ID must be a bounded identifier without whitespace')
  if(!scopes.includes('openid'))issues.push('VITE_OIDC_SCOPE must include openid')
  if(scopes.some(value=>!/^[A-Za-z0-9:._/-]{1,100}$/.test(value)))issues.push('VITE_OIDC_SCOPE contains an invalid scope value')
  if(resource&&(resource.length>500||/[\u0000-\u001f\u007f]/.test(resource)))issues.push('VITE_OIDC_RESOURCE is invalid')
  if(environment.VITE_DEV_AUTH_TOKEN?.trim())issues.push('VITE_DEV_AUTH_TOKEN must be empty for a protected release')

  for(const [name,value] of [['DASHBOARD_PUBLIC_ORIGIN',publicOrigin],['VITE_OIDC_AUTHORITY',authority],['VITE_OIDC_REDIRECT_URI',redirect],['VITE_OIDC_POST_LOGOUT_REDIRECT_URI',postLogout],['AUTH_ISSUER',issuer],['AUTH_JWKS_URL',jwks]] as const){
    if(value&&value.protocol!=='https:')issues.push(`${name} must use HTTPS for a protected release`)
    if(value&&(value.username||value.password))issues.push(`${name} cannot contain credentials`)
  }
  if(publicOrigin&&(publicOrigin.pathname!=='/'||publicOrigin.search||publicOrigin.hash))issues.push('DASHBOARD_PUBLIC_ORIGIN must contain only the public origin')
  if(authority&&(authority.search||authority.hash))issues.push('VITE_OIDC_AUTHORITY cannot contain a query or fragment')
  if(issuer&&(issuer.search||issuer.hash))issues.push('AUTH_ISSUER cannot contain a query or fragment')
  if(authority&&issuer&&normalizedUrl(authority)!==normalizedUrl(issuer))issues.push('VITE_OIDC_AUTHORITY must match AUTH_ISSUER')

  validateRedirect('VITE_OIDC_REDIRECT_URI',redirect,publicOrigin,'/app/auth/callback',issues)
  validateRedirect('VITE_OIDC_POST_LOGOUT_REDIRECT_URI',postLogout,publicOrigin,'/app',issues)
  if(apiBase){const api=urlValue(apiBase,'VITE_API_BASE_URL',issues);if(api&&api.protocol!=='https:')issues.push('VITE_API_BASE_URL must use HTTPS for a protected release');if(api&&(api.username||api.password||api.hash))issues.push('VITE_API_BASE_URL cannot contain credentials or a fragment');if(api&&publicOrigin&&api.origin!==publicOrigin.origin)issues.push('VITE_API_BASE_URL must use DASHBOARD_PUBLIC_ORIGIN; route /v1 to the API at the edge')}

  if(issues.length)throw new DashboardAuthConfigurationError([...new Set(issues)])
  return{issuer:normalizedUrl(issuer!),redirectPath:redirect!.pathname,postLogoutPath:postLogout!.pathname,scopes:[...new Set(scopes)],resourceConfigured:Boolean(resource),apiMode:apiBase?'explicit':'same_origin'}
}

function required(environment:NodeJS.ProcessEnv,name:string,issues:string[]){const value=environment[name]?.trim()||'';if(!value)issues.push(`${name} is required`);return value}
function url(environment:NodeJS.ProcessEnv,name:string,issues:string[]){const value=required(environment,name,issues);return value?urlValue(value,name,issues):undefined}
function urlValue(value:string,name:string,issues:string[]){try{return new URL(value)}catch{issues.push(`${name} must be a valid absolute URL`);return undefined}}
function normalizedUrl(value:URL){return value.toString().replace(/\/$/,'')}
function normalizedPath(value:string){return value.replace(/\/+$/,'')||'/'}
function validateRedirect(name:string,value:URL|undefined,origin:URL|undefined,path:string,issues:string[]){if(!value||!origin)return;if(value.origin!==origin.origin)issues.push(`${name} must use DASHBOARD_PUBLIC_ORIGIN`);if(normalizedPath(value.pathname)!==path)issues.push(`${name} must end at ${path}`);if(value.search||value.hash)issues.push(`${name} cannot contain a query or fragment`)}
