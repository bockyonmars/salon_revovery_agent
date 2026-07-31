import { createHash, randomUUID } from 'node:crypto'
import { DomainError } from '../domain/errors.js'
import type { ClientDataExportPackage, ClientDataExportRecordCounts, PrivacyDataExportReceipt, TenantContext } from '../domain/schemas.js'
import type { Store } from '../repositories/store.js'
import { canonicalJson } from '../security/canonical-json.js'
import { AuditService } from './audit-service.js'

export class PrivacyDataExportService{
  constructor(private readonly store:Store,_audit:AuditService){}

  async generate(context:TenantContext,clientId:string,reason:string){
    const snapshot=await this.store.buildClientDataSnapshot(context,clientId)
    const recordCounts:ClientDataExportRecordCounts={profile:snapshot.profile?1:0,consents:snapshot.consents.length,holds:snapshot.holds.length,bookings:snapshot.bookings.length,waitlistEntries:snapshot.waitlistEntries.length,conversations:snapshot.conversations.length,messages:snapshot.messages.length,reviewRequests:snapshot.reviewRequests.length,recoveryContacts:snapshot.recoveryContacts.length,conversationFollowups:snapshot.conversationFollowups.length,missedCallRecoveries:snapshot.missedCallRecoveries.length,messageDeliveries:snapshot.messageDeliveries.length,events:snapshot.events.length,auditRecords:snapshot.auditRecords.length}
    if(Object.values(recordCounts).every(count=>count===0))throw new DomainError('No data was found for this client in the current salon location','CLIENT_DATA_NOT_FOUND',404)
    const id=randomUUID();const generatedAt=new Date().toISOString();const{conversations,messages,...otherData}=snapshot
    const data:ClientDataExportPackage['data']={...otherData,conversations:conversations.map(conversation=>({conversation,messages:messages.filter(message=>message.conversationId===conversation.id)}))}
    const exported:ClientDataExportPackage={schemaVersion:1,exportId:id,generatedAt,scope:{tenantId:context.tenantId,locationId:context.locationId},subject:{clientId},data}
    const digest=createHash('sha256').update(canonicalJson(exported)).digest('hex')
    const receipt:PrivacyDataExportReceipt={id,tenantId:context.tenantId,locationId:context.locationId,clientId,requestedBy:context.userId,reason,digest,recordCounts,generatedAt}
    await this.store.savePrivacyDataExportReceiptWithAudit(context,receipt,{auditId:randomUUID(),userId:context.userId,occurredAt:generatedAt})
    return{receipt,export:exported}
  }
}
