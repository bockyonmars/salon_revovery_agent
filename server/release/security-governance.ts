const QUARTERLY_MAX_AGE_DAYS=93
const ANNUAL_MAX_AGE_DAYS=366
const DAY=86_400_000
const REFERENCE=/^(?:external-ticket|audit|approval|monitor|report):[A-Za-z0-9][A-Za-z0-9._/-]{2,199}$/
const RFC3339_UTC=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/

export type SecurityGovernanceReview={completedAt:string;evidenceReference:string;ageDays:number}
export type SecurityGovernanceConfig={dependencyReview:SecurityGovernanceReview;accessReview:SecurityGovernanceReview;enterpriseRelease:boolean;penetrationTest?:SecurityGovernanceReview}

export class SecurityGovernanceConfigurationError extends Error{
  constructor(readonly issues:string[]){super('Security governance evidence is incomplete or stale');this.name='SecurityGovernanceConfigurationError'}
}

export function parseSecurityGovernanceConfig(environment:NodeJS.ProcessEnv,now=new Date()):SecurityGovernanceConfig{
  const issues:string[]=[]
  const enterpriseRaw=environment.SECURITY_ENTERPRISE_RELEASE?.trim()||'false'
  if(!['true','false'].includes(enterpriseRaw))issues.push('SECURITY_ENTERPRISE_RELEASE must be true or false')
  const dependencyReview=review(environment,'SECURITY_DEPENDENCY_REVIEW',QUARTERLY_MAX_AGE_DAYS,now,issues)
  const accessReview=review(environment,'SECURITY_ACCESS_REVIEW',QUARTERLY_MAX_AGE_DAYS,now,issues)
  const enterpriseRelease=enterpriseRaw==='true'
  const penetrationTest=enterpriseRelease?review(environment,'SECURITY_PENETRATION_TEST',ANNUAL_MAX_AGE_DAYS,now,issues):undefined
  if(issues.length)throw new SecurityGovernanceConfigurationError([...new Set(issues)])
  return{dependencyReview:dependencyReview!,accessReview:accessReview!,enterpriseRelease,...(penetrationTest?{penetrationTest}:{})}
}

function review(environment:NodeJS.ProcessEnv,prefix:string,maxAgeDays:number,now:Date,issues:string[]):SecurityGovernanceReview|undefined{
  const atName=`${prefix}_AT`;const refName=`${prefix}_REF`;const completedAt=environment[atName]?.trim()??'';const evidenceReference=environment[refName]?.trim()??''
  if(!completedAt)issues.push(`${atName} is required`)
  if(!evidenceReference)issues.push(`${refName} is required`)
  if(evidenceReference&&(!REFERENCE.test(evidenceReference)||evidenceReference.includes('..')||evidenceReference.includes('//')))issues.push(`${refName} must be an opaque approved evidence reference`)
  const completedMs=RFC3339_UTC.test(completedAt)?Date.parse(completedAt):NaN
  if(completedAt&&!Number.isFinite(completedMs))issues.push(`${atName} must be an RFC3339 UTC timestamp`)
  const ageMs=now.getTime()-completedMs
  if(Number.isFinite(completedMs)&&ageMs< -5*60_000)issues.push(`${atName} cannot be in the future`)
  if(Number.isFinite(completedMs)&&ageMs>maxAgeDays*DAY)issues.push(`${atName} is stale; evidence must be no more than ${maxAgeDays} days old`)
  if(!completedAt||!evidenceReference||!Number.isFinite(completedMs))return undefined
  return{completedAt:new Date(completedMs).toISOString(),evidenceReference,ageDays:Math.max(0,Math.floor(ageMs/DAY))}
}
