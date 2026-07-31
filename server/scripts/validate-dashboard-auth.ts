import { DashboardAuthConfigurationError, parseDashboardAuthReleaseConfig } from '../release/dashboard-auth.js'

try{
  const result=parseDashboardAuthReleaseConfig(process.env)
  console.log(JSON.stringify({status:'passed',control:'dashboard_oidc_authorization_code_pkce',...result}))
}catch(error){
  if(error instanceof DashboardAuthConfigurationError)console.error(error.issues.join('\n'))
  else console.error(error instanceof Error?error.message:'Dashboard authentication configuration is invalid')
  process.exitCode=1
}
