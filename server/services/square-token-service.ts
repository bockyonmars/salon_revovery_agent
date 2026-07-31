import { randomUUID } from 'node:crypto'
import { SquareClient, SquareEnvironment, type ObtainTokenResponse } from 'square'
import { DomainError } from '../domain/errors.js'
import type { TenantContext } from '../domain/schemas.js'
import type { Store } from '../repositories/store.js'
import { CredentialCipher } from '../security/credential-cipher.js'
import type { ProviderCircuitBreakerService } from './provider-circuit-breaker-service.js'
import { PauseWorkflowError } from './workflow-engine.js'

type Credentials = { accessToken: string; refreshToken: string }
type Refresher = (refreshToken: string) => Promise<ObtainTokenResponse>

export class SquareTokenService {
  private readonly refresher?: Refresher
  constructor(private readonly store: Store, private readonly cipher: CredentialCipher, config?: { applicationId: string; applicationSecret: string; environment: 'sandbox'|'production' }, refresher?: Refresher,private readonly providerCircuits?:ProviderCircuitBreakerService) {
    if (refresher) this.refresher = refresher
    else if (config) { const client=new SquareClient({token:config.applicationSecret,environment:config.environment==='production'?SquareEnvironment.Production:SquareEnvironment.Sandbox,version:'2026-07-15',maxRetries:0,timeoutInSeconds:8}); this.refresher=(refreshToken)=>client.oAuth.obtainToken({clientId:config.applicationId,clientSecret:config.applicationSecret,refreshToken,grantType:'refresh_token'}) }
  }
  async getAccessToken(context: TenantContext) {
    const account=await this.store.getIntegrationAccount(context,'square')
    if(!account||account.status!=='active') throw new DomainError('An active Square connection is required','SQUARE_NOT_CONNECTED',409)
    const credentials=this.cipher.decrypt<Credentials>(account.encryptedCredentials)
    if(!credentials.accessToken||!credentials.refreshToken) throw new DomainError('Square credentials are incomplete','SQUARE_CREDENTIAL_ERROR',500)
    const fresh=!account.tokenExpiresAt||Date.parse(account.tokenExpiresAt)>Date.now()+5*60_000
    if(fresh) return credentials.accessToken
    if(!this.refresher) {await this.openReconnectApproval(context,account.id,'Square refresh is not configured');throw this.refreshFailure(context,'Square OAuth token refresh is not configured','SQUARE_TOKEN_EXPIRED',409)}
    const refreshed=await this.store.withLockedIntegrationAccount(context,'square',async(current)=>{
      if(current.status!=='active')throw new DomainError('An active Square connection is required','SQUARE_NOT_CONNECTED',409)
      const currentCredentials=this.cipher.decrypt<Credentials>(current.encryptedCredentials)
      if(!currentCredentials.accessToken||!currentCredentials.refreshToken)throw new DomainError('Square credentials are incomplete','SQUARE_CREDENTIAL_ERROR',500)
      if(!current.tokenExpiresAt||Date.parse(current.tokenExpiresAt)>Date.now()+5*60_000)return{account:current}
      let token:ObtainTokenResponse
      const refresh=()=>this.refresher!(currentCredentials.refreshToken)
      try{token=this.providerCircuits?await this.providerCircuits.execute(context,'square','oauth.token.refresh',refresh):await refresh()}catch{await this.openReconnectApproval(context,current.id,'Square token refresh failed');throw this.refreshFailure(context,'Square OAuth token refresh failed','SQUARE_TOKEN_REFRESH_FAILED',502)}
      if(!token.accessToken){await this.openReconnectApproval(context,current.id,'Square returned incomplete refreshed credentials');throw this.refreshFailure(context,'Square returned incomplete refreshed credentials','SQUARE_TOKEN_REFRESH_INVALID',502)}
      const occurredAt=new Date().toISOString();return{account:{...current,encryptedCredentials:this.cipher.encrypt({accessToken:token.accessToken,refreshToken:token.refreshToken??currentCredentials.refreshToken}),tokenExpiresAt:token.expiresAt,status:'active' as const,updatedAt:occurredAt},refreshEvidence:{auditId:randomUUID(),userId:context.userId,occurredAt}}
    })
    if(!refreshed)throw new DomainError('An active Square connection is required','SQUARE_NOT_CONNECTED',409)
    return this.cipher.decrypt<Credentials>(refreshed.encryptedCredentials).accessToken
  }

  private refreshFailure(context:TenantContext,message:string,code:string,status:number){return context.userId.startsWith('workflow:')?new PauseWorkflowError(`integration:square:${message}`):new DomainError(message,code,status)}
  private async openReconnectApproval(context:TenantContext,accountId:string,reason:string){const createdAt=new Date().toISOString();await this.store.createApprovalRequestWithEvent({id:randomUUID(),tenantId:context.tenantId,locationId:context.locationId,requestType:'integration_reconnect',reason,status:'pending',entityType:'integration_account',entityId:accountId,payload:{provider:'square'},createdAt},{eventId:randomUUID(),correlationId:`integration:${accountId}`,causationId:`square-token:${accountId}`})}
}
