import { describe,expect,it } from 'vitest'
import { DashboardAuthConfigurationError, parseDashboardAuthReleaseConfig } from './release/dashboard-auth.js'

const valid=():NodeJS.ProcessEnv=>({
  DASHBOARD_PUBLIC_ORIGIN:'https://salon-recovery.example',
  VITE_OIDC_AUTHORITY:'https://identity.example/',
  VITE_OIDC_CLIENT_ID:'salon-operations-dashboard',
  VITE_OIDC_REDIRECT_URI:'https://salon-recovery.example/app/auth/callback',
  VITE_OIDC_POST_LOGOUT_REDIRECT_URI:'https://salon-recovery.example/app',
  VITE_OIDC_SCOPE:'openid profile email salon:operations',
  VITE_OIDC_RESOURCE:'https://api.salon-recovery.example',
  VITE_API_BASE_URL:'https://salon-recovery.example',
  AUTH_ISSUER:'https://identity.example',
  AUTH_JWKS_URL:'https://identity.example/.well-known/jwks.json',
  AUTH_AUDIENCE:'https://api.salon-recovery.example',
})

describe('protected dashboard OIDC configuration',()=>{
  it('accepts aligned HTTPS Authorization Code with PKCE browser settings',()=>{expect(parseDashboardAuthReleaseConfig(valid())).toEqual({issuer:'https://identity.example',redirectPath:'/app/auth/callback',postLogoutPath:'/app',scopes:['openid','profile','email','salon:operations'],resourceConfigured:true,apiMode:'explicit'})})

  it('supports a same-origin API without embedding an API URL',()=>{const environment=valid();delete environment.VITE_API_BASE_URL;expect(parseDashboardAuthReleaseConfig(environment)).toMatchObject({apiMode:'same_origin'})})

  it('rejects an API origin that is not covered by the current same-origin deployment contract',()=>{expect(()=>parseDashboardAuthReleaseConfig({...valid(),VITE_API_BASE_URL:'https://api.salon-recovery.example'})).toThrow('Dashboard authentication configuration is incomplete or unsafe')})

  it('rejects partial, cross-origin, non-PKCE-compatible, and development-token release settings',()=>{const environment={...valid(),VITE_OIDC_AUTHORITY:'http://other-identity.example',VITE_OIDC_REDIRECT_URI:'https://attacker.example/callback?code=leak',VITE_OIDC_SCOPE:'profile email',VITE_DEV_AUTH_TOKEN:'dev:secret'};delete environment.VITE_OIDC_CLIENT_ID;try{parseDashboardAuthReleaseConfig(environment);throw new Error('expected failure')}catch(error){expect(error).toBeInstanceOf(DashboardAuthConfigurationError);const issues=(error as DashboardAuthConfigurationError).issues.join(' ');expect(issues).toContain('VITE_OIDC_CLIENT_ID is required');expect(issues).toContain('VITE_OIDC_AUTHORITY must use HTTPS');expect(issues).toContain('VITE_OIDC_AUTHORITY must match AUTH_ISSUER');expect(issues).toContain('VITE_OIDC_REDIRECT_URI must use DASHBOARD_PUBLIC_ORIGIN');expect(issues).toContain('VITE_OIDC_SCOPE must include openid');expect(issues).toContain('VITE_DEV_AUTH_TOKEN must be empty');expect(issues).not.toContain('dev:secret')}})
})
