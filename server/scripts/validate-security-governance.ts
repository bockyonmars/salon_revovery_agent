import { parseSecurityGovernanceConfig, SecurityGovernanceConfigurationError } from '../release/security-governance.js'

try{
  const config=parseSecurityGovernanceConfig(process.env)
  console.log(JSON.stringify({status:'passed',control:'security_governance_freshness',enterpriseRelease:config.enterpriseRelease,reviews:{dependency:{ageDays:config.dependencyReview.ageDays},access:{ageDays:config.accessReview.ageDays},...(config.penetrationTest?{penetrationTest:{ageDays:config.penetrationTest.ageDays}}:{})}}))
}catch(error){
  if(error instanceof SecurityGovernanceConfigurationError)console.error(JSON.stringify({status:'failed',control:'security_governance_freshness',issues:error.issues}))
  else console.error(JSON.stringify({status:'failed',control:'security_governance_freshness',issues:['Unexpected security governance validation failure']}))
  process.exitCode=1
}
