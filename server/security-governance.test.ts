import { describe,expect,it } from 'vitest'
import { parseSecurityGovernanceConfig, SecurityGovernanceConfigurationError } from './release/security-governance.js'

const now=new Date('2026-07-20T12:00:00.000Z')
const current=():NodeJS.ProcessEnv=>({SECURITY_DEPENDENCY_REVIEW_AT:'2026-07-01T10:00:00.000Z',SECURITY_DEPENDENCY_REVIEW_REF:'report:dependencies-2026-q3',SECURITY_ACCESS_REVIEW_AT:'2026-06-30T09:00:00.000Z',SECURITY_ACCESS_REVIEW_REF:'external-ticket:SEC-2042',SECURITY_ENTERPRISE_RELEASE:'false'})

describe('protected security governance evidence',()=>{
  it('accepts recent quarterly evidence without requiring a penetration test for non-enterprise releases',()=>{expect(parseSecurityGovernanceConfig(current(),now)).toEqual({dependencyReview:{completedAt:'2026-07-01T10:00:00.000Z',evidenceReference:'report:dependencies-2026-q3',ageDays:19},accessReview:{completedAt:'2026-06-30T09:00:00.000Z',evidenceReference:'external-ticket:SEC-2042',ageDays:20},enterpriseRelease:false})})

  it('requires a recent annual penetration test before an enterprise release',()=>{const environment={...current(),SECURITY_ENTERPRISE_RELEASE:'true'};expect(()=>parseSecurityGovernanceConfig(environment,now)).toThrow(SecurityGovernanceConfigurationError);environment.SECURITY_PENETRATION_TEST_AT='2026-02-15T12:00:00.000Z';environment.SECURITY_PENETRATION_TEST_REF='report:independent-pentest-2026';expect(parseSecurityGovernanceConfig(environment,now)).toMatchObject({enterpriseRelease:true,penetrationTest:{ageDays:155,evidenceReference:'report:independent-pentest-2026'}})})

  it('rejects missing, stale, future, malformed, and URL-like evidence without echoing configured values',()=>{const environment={...current(),SECURITY_DEPENDENCY_REVIEW_AT:'2026-01-01T00:00:00.000Z',SECURITY_ACCESS_REVIEW_AT:'2026-07-21T12:00:00.000Z',SECURITY_ACCESS_REVIEW_REF:'https://tickets.example/secret?token=value',SECURITY_ENTERPRISE_RELEASE:'sometimes'};try{parseSecurityGovernanceConfig(environment,now);throw new Error('expected failure')}catch(error){expect(error).toBeInstanceOf(SecurityGovernanceConfigurationError);const issues=(error as SecurityGovernanceConfigurationError).issues.join(' ');expect(issues).toContain('SECURITY_DEPENDENCY_REVIEW_AT is stale');expect(issues).toContain('SECURITY_ACCESS_REVIEW_AT cannot be in the future');expect(issues).toContain('SECURITY_ACCESS_REVIEW_REF must be an opaque approved evidence reference');expect(issues).toContain('SECURITY_ENTERPRISE_RELEASE must be true or false');expect(issues).not.toContain('token=value')}})
})
