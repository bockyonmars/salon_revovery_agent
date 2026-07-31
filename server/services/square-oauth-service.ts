import { randomUUID } from 'node:crypto'
import { SquareClient, SquareEnvironment, type ObtainTokenResponse } from 'square'
import { DomainError } from '../domain/errors.js'
import type { TenantContext } from '../domain/schemas.js'
import type { Store } from '../repositories/store.js'
import { CredentialCipher } from '../security/credential-cipher.js'
import type { ProviderCircuitBreakerService } from './provider-circuit-breaker-service.js'

const scopes = ['MERCHANT_PROFILE_READ','APPOINTMENTS_READ','APPOINTMENTS_WRITE','APPOINTMENTS_ALL_READ','APPOINTMENTS_ALL_WRITE','APPOINTMENTS_BUSINESS_SETTINGS_READ','CUSTOMERS_READ','CUSTOMERS_WRITE','ITEMS_READ']
type TokenExchange=(input:{clientId:string;clientSecret:string;code:string;redirectUri:string;grantType:'authorization_code'})=>Promise<ObtainTokenResponse>

export class SquareOAuthService {
  private readonly exchange:TokenExchange
  constructor(private readonly store: Store, private readonly cipher: CredentialCipher, private readonly config: { applicationId: string; applicationSecret: string; redirectUri: string; environment: 'sandbox'|'production' },private readonly providerCircuits?:ProviderCircuitBreakerService,exchange?:TokenExchange) {
    const client=new SquareClient({token:config.applicationSecret,environment:config.environment==='production'?SquareEnvironment.Production:SquareEnvironment.Sandbox,version:'2026-07-15',maxRetries:0,timeoutInSeconds:8});this.exchange=exchange??((input)=>client.oAuth.obtainToken(input))
  }
  async begin(context: TenantContext) { if(context.role!=='owner'&&context.role!=='manager')throw new DomainError('Management role required to connect Square','FORBIDDEN',403);const state=randomUUID(); await this.store.saveOAuthState({state,...context,expiresAt:new Date(Date.now()+5*60_000).toISOString()}); const base=this.config.environment==='production'?'https://connect.squareup.com':'https://connect.squareupsandbox.com'; const url=new URL('/oauth2/authorize',base); url.searchParams.set('client_id',this.config.applicationId); url.searchParams.set('scope',scopes.join(' ')); url.searchParams.set('state',state); url.searchParams.set('redirect_uri',this.config.redirectUri); url.searchParams.set('session','false'); return {authorizationUrl:url.toString(),expiresInSeconds:300} }
  async complete(code:string,state:string) { const pending=await this.store.consumeOAuthState(state); if(!pending) throw new DomainError('OAuth state is invalid or expired','INVALID_OAUTH_STATE',400);const request=()=>this.exchange({clientId:this.config.applicationId,clientSecret:this.config.applicationSecret,code,redirectUri:this.config.redirectUri,grantType:'authorization_code'});const context:TenantContext={tenantId:pending.tenantId,locationId:pending.locationId,userId:pending.userId,role:'service'};const token=this.providerCircuits?await this.providerCircuits.execute(context,'square','oauth.token.exchange',request):await request(); if(!token.accessToken||!token.refreshToken||!token.merchantId) throw new DomainError('Square did not return complete credentials','OAUTH_TOKEN_ERROR',502); const now=new Date().toISOString();const result=await this.store.completeSquareOAuthConnection({id:randomUUID(),tenantId:pending.tenantId,locationId:pending.locationId,provider:'square',externalId:token.merchantId,encryptedCredentials:this.cipher.encrypt({accessToken:token.accessToken,refreshToken:token.refreshToken}),status:'active',tokenExpiresAt:token.expiresAt,createdAt:now,updatedAt:now},{auditId:randomUUID(),eventId:randomUUID(),userId:pending.userId,occurredAt:now});return result.account }
}
