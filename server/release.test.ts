import { describe, expect, it } from 'vitest'
import { parseSandboxSmokeConfig, SandboxConfigurationError } from './release/sandbox-smoke.js'

const validEnvironment=():NodeJS.ProcessEnv=>({
  NODE_ENV:'staging',
  DATABASE_URL:'postgres://sandbox:sandbox@db.example.test:5432/salon_sandbox',
  SANDBOX_TENANT_ID:'tenant-sandbox',
  SANDBOX_LOCATION_ID:'location-sandbox',
  SANDBOX_ALLOW_PROVIDER_MUTATIONS:'true',
  SQUARE_ENVIRONMENT:'sandbox',
  SQUARE_ACCESS_TOKEN:'square-secret-value',
  SQUARE_WEBHOOK_SIGNATURE_KEY:'square-signature-secret',
  SQUARE_WEBHOOK_NOTIFICATION_URL:'https://sandbox.example.test/webhooks/square',
  SANDBOX_SQUARE_LOCATION_ID:'square-location',
  SANDBOX_SQUARE_CUSTOMER_ID:'square-customer',
  SANDBOX_SQUARE_TEAM_MEMBER_ID:'square-staff',
  SANDBOX_SQUARE_SERVICE_VARIATION_ID:'square-service',
  SANDBOX_SQUARE_SERVICE_VARIATION_VERSION:'27',
  SANDBOX_SQUARE_DURATION_MINUTES:'60',
  SANDBOX_SQUARE_START_AT:new Date(Date.now()+24*60*60_000).toISOString(),
  TWILIO_ACCOUNT_SID:'AC00000000000000000000000000000000',
  TWILIO_AUTH_TOKEN:'twilio-secret-value',
  TWILIO_FROM_NUMBER:'+15555550100',
  SANDBOX_TWILIO_TO:'+15555550101',
  TWILIO_STATUS_CALLBACK_URL:'https://sandbox.example.test/webhooks/twilio/status',
  STRIPE_SECRET_KEY:'sk_test_secret_value',
  STRIPE_WEBHOOK_SECRET:'whsec_secret_value',
  SANDBOX_WEBHOOK_WAIT_SECONDS:'20',
})

describe('provider sandbox release configuration',()=>{
  it('parses a non-production, explicitly authorized sandbox configuration',()=>{
    const result=parseSandboxSmokeConfig(validEnvironment())
    expect(result).toMatchObject({
      tenantId:'tenant-sandbox',
      locationId:'location-sandbox',
      webhookWaitSeconds:20,
      square:{serviceVariationVersion:27n,durationMinutes:60},
      twilio:{channel:'sms',from:'+15555550100',to:'+15555550101'},
    })
  })

  it('rejects production execution, non-test Stripe keys, local callbacks, and absent mutation acknowledgement',()=>{
    const environment=validEnvironment()
    environment.NODE_ENV='production'
    environment.SQUARE_ENVIRONMENT='production'
    environment.SANDBOX_ALLOW_PROVIDER_MUTATIONS='false'
    environment.STRIPE_SECRET_KEY='sk_live_must_never_run'
    environment.SQUARE_WEBHOOK_NOTIFICATION_URL='http://127.0.0.1:4200/webhooks/square'
    expect(()=>parseSandboxSmokeConfig(environment)).toThrow(SandboxConfigurationError)
    try{parseSandboxSmokeConfig(environment)}catch(error){
      expect(error).toBeInstanceOf(SandboxConfigurationError)
      const issues=(error as SandboxConfigurationError).issues.join(' ')
      expect(issues).toContain('NODE_ENV must not be production')
      expect(issues).toContain('SQUARE_ENVIRONMENT must be sandbox')
      expect(issues).toContain('STRIPE_SECRET_KEY must be a Stripe test-mode key')
      expect(issues).not.toContain('sk_live_must_never_run')
    }
  })

  it('reports only missing variable names and never includes configured secret values',()=>{
    const environment=validEnvironment()
    delete environment.TWILIO_ACCOUNT_SID
    environment.SANDBOX_SQUARE_START_AT='not-a-date'
    try{parseSandboxSmokeConfig(environment)}catch(error){
      const issues=(error as SandboxConfigurationError).issues.join(' ')
      expect(issues).toContain('TWILIO_ACCOUNT_SID is required')
      expect(issues).toContain('SANDBOX_SQUARE_START_AT must be an RFC3339 timestamp')
      expect(issues).not.toContain('twilio-secret-value')
      expect(issues).not.toContain('square-secret-value')
    }
  })

  it('selects the dedicated WhatsApp sender for a WhatsApp sandbox destination',()=>{
    const environment=validEnvironment()
    delete environment.TWILIO_FROM_NUMBER
    environment.TWILIO_WHATSAPP_FROM_NUMBER='whatsapp:+15555550100'
    environment.SANDBOX_TWILIO_TO='whatsapp:+15555550101'
    expect(parseSandboxSmokeConfig(environment).twilio).toMatchObject({channel:'whatsapp',from:'whatsapp:+15555550100',to:'whatsapp:+15555550101'})
  })
})
