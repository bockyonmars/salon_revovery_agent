import { createHash, randomUUID } from 'node:crypto'
import { DomainError } from '../domain/errors.js'
import { TenantPortfolioQuerySchema, type ClientCohortSnapshot, type TenantContext } from '../domain/schemas.js'
import type { Store } from '../repositories/store.js'
import { canonicalJson } from '../security/canonical-json.js'
import type { AuditService } from './audit-service.js'

const ACTIVITY_WINDOW_DAYS=180 as const
const DAY_MS=86_400_000

export class ClientCohortService {
  constructor(private readonly store:Store,_audit?:AuditService,private readonly now=()=>new Date()){}

  async generate(context:TenantContext,input:{from:string;to:string}):Promise<ClientCohortSnapshot>{
    requireOwner(context);const period=TenantPortfolioQuerySchema.parse(input);const startWindowFrom=new Date(Date.parse(period.from)-ACTIVITY_WINDOW_DAYS*DAY_MS).toISOString();const endWindowFrom=new Date(Date.parse(period.to)-ACTIVITY_WINDOW_DAYS*DAY_MS).toISOString();const bookings=await this.store.getOwnerClientCohortBookings(context,startWindowFrom,period.to);const startBookings=bookings.filter(value=>Date.parse(value.startsAt)<Date.parse(period.from));const endBookings=bookings.filter(value=>Date.parse(value.startsAt)>=Date.parse(endWindowFrom)&&Date.parse(value.startsAt)<Date.parse(period.to));const startClients=new Set(startBookings.map(value=>value.clientId));const endClients=new Set(endBookings.map(value=>value.clientId));const retained=[...startClients].filter(value=>endClients.has(value)).length;const churned=startClients.size-retained;const newlyActive=[...endClients].filter(value=>!startClients.has(value)).length;const evidenceStatus=startClients.size?'sufficient' as const:'insufficient' as const;const metrics={completedBookingsConsidered:bookings.length,startCompletedBookings:startBookings.length,endCompletedBookings:endBookings.length,startActiveClients:startClients.size,endActiveClients:endClients.size,retainedClients:retained,churnedClients:churned,newlyActiveClients:newlyActive,churnRate:startClients.size?churned/startClients.size:null};const createdAt=this.now().toISOString();const evidence={tenantId:context.tenantId,policyVersion:'active-client-180d-v1' as const,activityWindowDays:ACTIVITY_WINDOW_DAYS,periodFrom:period.from,periodTo:period.to,startWindowFrom,endWindowFrom,evidenceStatus,metrics,evidence:'square_completed_bookings' as const,containsClientIdentities:false as const,createdBy:context.userId,createdAt};const snapshot:ClientCohortSnapshot={id:randomUUID(),...evidence,snapshotDigest:createHash('sha256').update(canonicalJson(evidence)).digest('hex')};return this.store.saveClientCohortSnapshotWithAudit(context,snapshot,{auditId:randomUUID(),userId:context.userId,occurredAt:createdAt})
  }

  async history(context:TenantContext,limit:number){requireOwner(context);return this.store.listClientCohortSnapshots(context,limit)}
}

function requireOwner(context:TenantContext){if(context.role!=='owner')throw new DomainError('Tenant owner access is required for client cohort evidence','ROLE_FORBIDDEN',403)}
