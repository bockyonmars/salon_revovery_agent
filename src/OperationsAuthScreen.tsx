import { ArrowSquareOut, CheckCircle, Info, LockKey, ShieldCheck, ShieldStar, SignIn, SpinnerGap, WarningCircle } from '@phosphor-icons/react'
import type { OperationsAuthSnapshot } from './operations-auth'

export function OperationsAuthScreen({ state, busy, onSignIn }: { state: Exclude<OperationsAuthSnapshot, { status: 'authenticated' | 'demo' }>; busy: boolean; onSignIn: () => void }) {
  const loading = state.status === 'loading' || busy
  const blocked = state.status === 'misconfigured'
  const failed = state.status === 'error'
  const statusMessage = 'message' in state ? state.message : 'Opening secure sign-in'
  return (
    <main className="auth-shell">
      <AuthTrustPanel />

      <section className="auth-stage" aria-labelledby="sign-in-title">
        <div className="auth-wrap">
          <p className="auth-context"><span>Operations workspace</span><strong>Salon Recovery Agent</strong></p>
          <div className="auth-card">
            <header>
              <span className={`auth-secure-label ${failed || blocked ? 'danger' : ''}`}>{failed || blocked ? <WarningCircle weight="bold" /> : <ShieldCheck weight="bold" />}{blocked ? 'Configuration required' : failed ? 'Sign-in interrupted' : 'Secure organisation access'}</span>
              <h2 id="sign-in-title">{loading ? 'Verifying secure access' : blocked ? 'Sign-in is not configured' : failed ? 'Sign-in needs attention' : 'Sign in to continue'}</h2>
              <p>{loading ? statusMessage : blocked || failed ? statusMessage : 'Use your salon operations account. You will return here after verification.'}</p>
            </header>

            {!blocked && <div className="auth-provider" aria-label="Configured identity provider"><span><ShieldStar weight="fill" /></span><span><strong>Organisation identity provider</strong><small>Authorization Code with PKCE</small></span><b>{failed ? 'Retry' : 'Ready'}</b></div>}

            {!blocked && <button className="auth-sign-in" type="button" onClick={onSignIn} disabled={loading}>{loading ? <SpinnerGap className="spinning" weight="bold" /> : <SignIn weight="bold" />}<span>{loading ? 'Checking session' : failed ? 'Try secure sign-in again' : 'Continue with secure sign-in'}</span></button>}

            <p className="auth-notice"><Info weight="bold" /><span>{blocked ? 'Set the public OIDC values during the frontend build. No client secret belongs in the browser.' : 'No password is entered or stored here. Your access token remains in this browser session.'}</span></p>
          </div>
          <p className="auth-support"><span>Having trouble signing in?</span><strong>Contact your operations administrator</strong></p>
        </div>
      </section>
    </main>
  )
}

export function OperationsUnavailableScreen({ onRetry, onSignOut }: { onRetry: () => void; onSignOut: () => void }) {
  return <main className="auth-shell">
    <AuthTrustPanel />
    <section className="auth-stage" aria-labelledby="operations-unavailable-title">
      <div className="auth-wrap">
        <p className="auth-context"><span>Protected workspace</span><strong>Connection interrupted</strong></p>
        <div className="auth-card">
          <header>
            <span className="auth-secure-label danger"><WarningCircle weight="bold" /> Operations unavailable</span>
            <h2 id="operations-unavailable-title">Live data could not be verified</h2>
            <p>The dashboard did not substitute sample revenue, clients, or approvals. Retry after checking the API and identity-provider connection.</p>
          </header>
          <button className="auth-sign-in" type="button" onClick={onRetry}><ArrowSquareOut weight="bold" /><span>Retry operations</span></button>
          <button className="auth-secondary-action" type="button" onClick={onSignOut}>Sign out safely</button>
          <p className="auth-notice"><Info weight="bold" /><span>No recovery action was sent while the control plane was unavailable.</span></p>
        </div>
      </div>
    </section>
  </main>
}

function AuthTrustPanel() {
  return <section className="auth-trust-panel" aria-labelledby="auth-value-title">
    <AuthBrand />
    <div className="auth-trust-copy">
      <p className="auth-eyebrow">Protected operations</p>
      <h1 id="auth-value-title">Revenue recovery, under control.</h1>
      <p>Enter through your verified identity provider. Recovery actions remain attributable, policy-bound, and reviewable.</p>
      <ul className="auth-trust-list">
        <li><span><ShieldCheck weight="bold" /></span>Authorization Code with PKCE protects every browser sign-in.</li>
        <li><span><LockKey weight="bold" /></span>Multi-factor authentication is enforced by your identity provider.</li>
        <li><span><CheckCircle weight="bold" /></span>Operator identity and sensitive decisions remain in the audit ledger.</li>
      </ul>
    </div>
    <p className="auth-environment"><CheckCircle weight="fill" /> Production control plane</p>
  </section>
}

function AuthBrand() {
  return <div className="auth-brand" aria-label="Salon Recovery Agent"><span><ShieldStar weight="fill" /></span><span><strong>Salon</strong><small>Recovery Agent</small></span></div>
}
