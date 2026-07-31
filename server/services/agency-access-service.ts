import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { DomainError } from '../domain/errors.js'
import { AgencyAccountInputSchema, AgencyClientTenantIdSchema, AgencyInvitationInputSchema, AgencyInvitationTokenSchema, TenantPortfolioQuerySchema, type AgencyAccount, type AgencyInvitation, type TenantContext } from '../domain/schemas.js'
import type { Store } from '../repositories/store.js'
import type { AuditService } from './audit-service.js'
import { buildTenantPortfolioReport } from './tenant-portfolio-service.js'

export class AgencyAccessService {
  constructor(private readonly store:Store,private readonly audit?:AuditService,private readonly now=()=>new Date()){}

  async saveAccount(context:TenantContext,input:unknown){this.requireOwner(context);const parsed=AgencyAccountInputSchema.parse(input);const current=await this.store.getAgencyAccount(context);const now=this.now().toISOString();const value:AgencyAccount={...parsed,id:current?.id??randomUUID(),tenantId:context.tenantId,status:'active',createdBy:current?.createdBy??context.userId,createdAt:current?.createdAt??now,updatedBy:context.userId,updatedAt:now};return this.store.saveAgencyAccountWithAudit(context,value,{auditId:randomUUID(),userId:context.userId,occurredAt:now})}
  async account(context:TenantContext){this.requireOwner(context);return this.store.getAgencyAccount(context)}

  async invite(context:TenantContext,input:unknown){this.requireOwner(context);const parsed=AgencyInvitationInputSchema.parse(input);if(parsed.clientTenantId===context.tenantId)throw new DomainError('An agency cannot invite its own tenant','AGENCY_SELF_GRANT_FORBIDDEN',409);const account=await this.store.getAgencyAccount(context);if(!account)throw new DomainError('Configure the agency account before inviting a client','AGENCY_ACCOUNT_REQUIRED',409);const token=randomBytes(32).toString('base64url');const now=this.now();const invitation:AgencyInvitation={id:randomUUID(),agencyTenantId:context.tenantId,clientTenantId:parsed.clientTenantId,scopes:['portfolio_read'],tokenHash:hash(token),status:'pending',createdBy:context.userId,createdAt:now.toISOString(),expiresAt:new Date(now.getTime()+parsed.expiresInDays*86_400_000).toISOString()};let saved:AgencyInvitation;try{saved=await this.store.createAgencyInvitationWithAudit(context,invitation,{auditId:randomUUID(),userId:context.userId,occurredAt:invitation.createdAt})}catch(error){if(error instanceof Error&&error.message==='AGENCY_GRANT_ALREADY_ACTIVE')throw new DomainError('This client already has an active agency grant','AGENCY_GRANT_ALREADY_ACTIVE',409);if(error instanceof Error&&error.message==='AGENCY_INVITATION_CONFLICT')throw new DomainError('A non-expired invitation is already pending for this client','AGENCY_INVITATION_CONFLICT',409);throw error}return{invitation:publicInvitation(saved),acceptanceToken:token}}

  async preview(context:TenantContext,input:unknown){this.requireOwner(context);const parsed=AgencyInvitationTokenSchema.parse(input);const result=await this.store.getAgencyInvitationForClient(context,hash(parsed.token),this.now().toISOString());if(!result)throw new DomainError('Invitation is invalid, expired, or not addressed to this tenant','AGENCY_INVITATION_INVALID',404);return{agency:{displayName:result.agency.displayName,...(result.agency.supportEmail?{supportEmail:result.agency.supportEmail}:{})},scopes:result.invitation.scopes,expiresAt:result.invitation.expiresAt}}

  async accept(context:TenantContext,input:unknown){this.requireOwner(context);const parsed=AgencyInvitationTokenSchema.parse(input);const acceptedAt=this.now().toISOString();const result=await this.store.acceptAgencyInvitationWithAudit(context,hash(parsed.token),acceptedAt,{auditId:randomUUID(),userId:context.userId,occurredAt:acceptedAt});if(!result)throw new DomainError('Invitation is invalid, expired, or not addressed to this tenant','AGENCY_INVITATION_INVALID',404);return{invitation:publicInvitation(result.invitation),grant:result.grant,duplicate:result.duplicate}}

  async grants(context:TenantContext){this.requireOwner(context);const account=await this.store.getAgencyAccount(context);if(!account)throw new DomainError('Agency account not found','AGENCY_ACCOUNT_REQUIRED',409);return this.store.listAgencyGrants(context)}
  async clientGrants(context:TenantContext){this.requireOwner(context);return this.store.listClientAgencyGrants(context)}

  async revoke(context:TenantContext,id:string,reason:string){this.requireOwner(context);const revokedAt=this.now().toISOString();const grant=await this.store.revokeAgencyGrantWithAudit(context,id,revokedAt,reason,{auditId:randomUUID(),userId:context.userId,occurredAt:revokedAt});if(!grant)throw new DomainError('Agency grant not found for this tenant','AGENCY_GRANT_NOT_FOUND',404);return grant}

  async portfolio(context:TenantContext,clientTenantId:string,query:{from:string;to:string}){this.requireOwner(context);const target=AgencyClientTenantIdSchema.parse(clientTenantId);const period=TenantPortfolioQuerySchema.parse(query);const result=await this.store.getAgencyGrantedTenantPortfolioData(context,target,period.from,period.to);if(!result)throw new DomainError('An active portfolio grant is required for this client tenant','AGENCY_GRANT_REQUIRED',403);const report=buildTenantPortfolioReport(target,period,result.data,this.now());await this.audit?.record(context,'agency_portfolio.viewed','agency_grant',result.grant.id,'Agency owner viewed granted aggregate client portfolio',{clientTenantId:target,from:period.from,to:period.to},{locationCount:report.portfolio.locationCount,recoveredBookings:report.totals.recoveredBookings,currencies:Object.keys(report.totals.verifiedRecoveredRevenueMinorByCurrency)});return{grant:{id:result.grant.id,scope:'portfolio_read' as const},report}}

  private requireOwner(context:TenantContext){if(context.role!=='owner')throw new DomainError('Tenant owner access is required','ROLE_FORBIDDEN',403)}
}

function hash(value:string){return createHash('sha256').update(value).digest('hex')}
function publicInvitation(value:AgencyInvitation){const{tokenHash:_,...safe}=value;return safe}
