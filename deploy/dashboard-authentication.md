# Production dashboard authentication

The operations dashboard is a public OIDC client. It uses Authorization Code with PKCE and never receives or embeds a client secret. Both the temporary authorization transaction and the authenticated user session are stored in browser `sessionStorage`; closing the browser session clears them. Automatic silent renewal is disabled, so an expired access token returns the operator to the explicit sign-in boundary.

## Identity-provider registration

Register one single-page application client with:

- grant type: Authorization Code;
- PKCE: required, using `S256`;
- redirect URI: `https://<dashboard-host>/app/auth/callback`;
- post-logout redirect URI: `https://<dashboard-host>/app`;
- scopes: `openid profile email` plus the provider-specific API scope;
- no client secret in the frontend or image build;
- MFA required for owner and manager roles.

The access token must use the same issuer and API audience configured by `AUTH_ISSUER` and `AUTH_AUDIENCE`. It must also contain the tenant, location, user, role, and MFA claims described in `server/README.md`. If the provider uses an OAuth resource indicator or API audience request, set `VITE_OIDC_RESOURCE` to that public identifier.

## Build-time public configuration

The following values are intentionally public and must be present when Vite builds the image:

```text
VITE_API_BASE_URL
VITE_OIDC_AUTHORITY
VITE_OIDC_CLIENT_ID
VITE_OIDC_REDIRECT_URI
VITE_OIDC_POST_LOGOUT_REDIRECT_URI
VITE_OIDC_SCOPE
VITE_OIDC_RESOURCE
```

Route `/v1` to the API service on the dashboard's public origin and leave `VITE_API_BASE_URL` empty. It may be set to the same public origin, but the release gate rejects a separate API origin because the current browser contract is intentionally same-origin. Never add an OIDC client secret, API bearer token, signing key, or provider management credential to a `VITE_*` variable. `VITE_DEV_AUTH_TOKEN` is accepted only by a development build and must be empty in the protected release environment.

The deployment content-security policy must allow `connect-src` to the configured API origin and OIDC authority so discovery and code exchange can complete. The dashboard callback removes authorization query parameters from browser history immediately after validation.

## Release gate

Run `npm run auth:preflight` in the protected release environment. It fails closed unless:

- all public OIDC values are complete and use HTTPS;
- dashboard API requests remain on `DASHBOARD_PUBLIC_ORIGIN`;
- the browser authority matches `AUTH_ISSUER`;
- callback and logout URLs use `DASHBOARD_PUBLIC_ORIGIN` and the fixed application paths;
- the scope includes `openid`;
- backend JWKS and audience settings are present;
- no development bearer token is embedded.

The full `npm run release:validate` command runs this check before provider mutation, model evaluation, or database restoration evidence can make a release eligible.
