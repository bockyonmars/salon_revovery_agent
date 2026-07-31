import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createApp } from './app.js'
import type { RevenueAttribution, TenantContext } from './domain/schemas.js'
import { MemoryStore } from './repositories/memory-store.js'
import { AgencyAccessService } from './services/agency-access-service.js'
import { AuditService } from './services/audit-service.js'

const agency:TenantContext={tenantId:'agency-tenant',locationId:'agency-hq',userId:'agency-owner',role:'owner'}
const client:TenantContext={tenantId:'client-tenant',locationId:'client-main',userId:'client-owner',role:'owner'}
const other:TenantContext={tenantId:'other-tenant',locationId:'other-main',userId:'other-owner',role:'owner'}
const from='2026-07-01T00:00:00.000Z';const to='2026-08-01T00:00:00.000Z';const now='2026-07-19T12:00:00.000Z'

describe('bilateral agency portfolio grants',()=>{
  it('requires client-owner acceptance, exposes aggregates only, and revokes immediately',async()=>{
    const store=new MemoryStore();await seedClient(store);const audit=new AuditService(store);const access=new AgencyAccessService(store,audit,()=>new Date(now));await access.saveAccount(agency,{displayName:'Plum Portfolio Partners',supportEmail:'support@agency.example'})
    const created=await access.invite(agency,{clientTenantId:client.tenantId,expiresInDays:7});expect(created.acceptanceToken).toHaveLength(43);expect(created.invitation).not.toHaveProperty('tokenHash')
    await expect(access.portfolio(agency,client.tenantId,{from,to})).rejects.toMatchObject({code:'AGENCY_GRANT_REQUIRED'})
    const preview=await access.preview(client,{token:created.acceptanceToken});expect(preview).toEqual({agency:{displayName:'Plum Portfolio Partners',supportEmail:'support@agency.example'},scopes:['portfolio_read'],expiresAt:'2026-07-26T12:00:00.000Z'})
    const accepted=await access.accept(client,{token:created.acceptanceToken});expect(accepted).toMatchObject({duplicate:false,grant:{agencyTenantId:agency.tenantId,clientTenantId:client.tenantId,status:'active',scopes:['portfolio_read']}});expect(accepted.invitation).not.toHaveProperty('tokenHash');expect((await access.accept(client,{token:created.acceptanceToken})).duplicate).toBe(true);expect(await access.clientGrants(client)).toEqual([expect.objectContaining({id:accepted.grant.id,status:'active'})])
    const portfolio=await access.portfolio(agency,client.tenantId,{from,to});expect(portfolio).toMatchObject({grant:{scope:'portfolio_read'},report:{tenantId:client.tenantId,portfolio:{locationCount:1},totals:{recoveredBookings:1,verifiedRecoveredRevenueMinorByCurrency:{GBP:18500}},dataQuality:{containsClientIdentities:false}}});const serialized=JSON.stringify(portfolio);expect(serialized).not.toContain('client-one');expect(serialized).not.toContain('+447700900181')
    await access.revoke(client,accepted.grant.id,'Client ended the agency relationship');await expect(access.portfolio(agency,client.tenantId,{from,to})).rejects.toMatchObject({code:'AGENCY_GRANT_REQUIRED'});expect((await access.grants(agency))[0]).toMatchObject({status:'revoked',revokedBy:client.userId})
    const agencyAudit=await store.getAudit(agency);const clientAudit=await store.getAudit(client);expect(agencyAudit.map(value=>value.action)).toEqual(expect.arrayContaining(['agency_account.saved','agency_invitation.created','agency_portfolio.viewed']));expect(clientAudit.filter(value=>value.action==='agency_invitation.accepted')).toHaveLength(2);expect(clientAudit.map(value=>value.action)).toContain('agency_grant.revoked');const auditText=JSON.stringify([...agencyAudit,...clientAudit]);expect(auditText).not.toContain(created.acceptanceToken);expect(auditText).not.toContain('tokenHash');expect(auditText).not.toContain('Client ended the agency relationship')
  })

  it('denies the wrong tenant and every non-owner role',async()=>{
    const store=new MemoryStore();const access=new AgencyAccessService(store,undefined,()=>new Date(now));await access.saveAccount(agency,{displayName:'Plum Portfolio Partners'});const invitation=await access.invite(agency,{clientTenantId:client.tenantId,expiresInDays:7})
    await expect(access.preview(other,{token:invitation.acceptanceToken})).rejects.toMatchObject({code:'AGENCY_INVITATION_INVALID'});for(const role of['manager','operator','service'] as const)await expect(access.preview({...client,role},{token:invitation.acceptanceToken})).rejects.toMatchObject({code:'ROLE_FORBIDDEN'})
    await expect(store.getAgencyGrantedTenantPortfolioData({...agency,role:'manager'},client.tenantId,from,to)).rejects.toThrow('OWNER_AGENCY_ACCESS_REQUIRED')
  })

  it('blocks self-grants, overlapping invitations, and overlapping active grants',async()=>{
    const store=new MemoryStore();const access=new AgencyAccessService(store,undefined,()=>new Date(now));await access.saveAccount(agency,{displayName:'Plum Portfolio Partners'});await expect(access.invite(agency,{clientTenantId:agency.tenantId,expiresInDays:7})).rejects.toMatchObject({code:'AGENCY_SELF_GRANT_FORBIDDEN'});const invitation=await access.invite(agency,{clientTenantId:client.tenantId,expiresInDays:7});await expect(access.invite(agency,{clientTenantId:client.tenantId,expiresInDays:7})).rejects.toMatchObject({code:'AGENCY_INVITATION_CONFLICT'});await access.accept(client,{token:invitation.acceptanceToken});await expect(access.invite(agency,{clientTenantId:client.tenantId,expiresInDays:7})).rejects.toMatchObject({code:'AGENCY_GRANT_ALREADY_ACTIVE'})
  })

  it('supports the owner API flow without exposing the stored token digest',async()=>{
    const store=new MemoryStore();await seedClient(store);const server=createApp(store);const agencyAuth={authorization:'Bearer dev:agency-tenant:agency-hq:agency-owner:owner'};const clientAuth={authorization:'Bearer dev:client-tenant:client-main:client-owner:owner'}
    try{expect((await server.inject({method:'PUT',url:'/v1/agency/account',headers:agencyAuth,payload:{displayName:'Plum Portfolio Partners'}})).statusCode).toBe(200);const invitation=await server.inject({method:'POST',url:'/v1/agency/invitations',headers:agencyAuth,payload:{clientTenantId:'client-tenant',expiresInDays:7}});expect(invitation.statusCode).toBe(201);const body=invitation.json();expect(body.invitation).not.toHaveProperty('tokenHash');expect((await server.inject({method:'POST',url:'/v1/agency/invitations/preview',headers:clientAuth,payload:{token:body.acceptanceToken}})).statusCode).toBe(200);const accepted=await server.inject({method:'POST',url:'/v1/agency/invitations/accept',headers:clientAuth,payload:{token:body.acceptanceToken}});expect(accepted.statusCode).toBe(200);expect(accepted.json().grant.scopes).toEqual(['portfolio_read']);const portfolio=await server.inject({method:'GET',url:`/v1/agency/clients/client-tenant/portfolio?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,headers:agencyAuth});expect(portfolio.statusCode).toBe(200);expect(portfolio.headers['cache-control']).toBe('no-store');expect(portfolio.json().report.totals.recoveredBookings).toBe(1)}finally{await server.close()}
  })
})

async function seedClient(store:MemoryStore){await store.saveLocationSettings({tenantId:client.tenantId,locationId:client.locationId,salonName:'Client Salon',senderName:'Client Salon',timezone:'Europe/London',updatedAt:now});await store.saveClientProfile({tenantId:client.tenantId,locationId:client.locationId,clientId:'client-one',contactTo:'+447700900181',timezone:'Europe/London',updatedAt:now});const attribution:RevenueAttribution={id:randomUUID(),tenantId:client.tenantId,locationId:client.locationId,bookingId:randomUUID(),sourceId:randomUUID(),workflowJobId:randomUUID(),amountMinor:18500,currency:'GBP',attributionType:'lapsed_reactivation',evidence:'sent_recovery_before_booking',touchAt:now,verifiedAt:now};await store.saveRevenueAttribution(attribution);await store.saveLocationSettings({tenantId:other.tenantId,locationId:other.locationId,salonName:'Other Salon',senderName:'Other Salon',timezone:'UTC',updatedAt:now})}
