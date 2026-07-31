# Local marketing design review

These standalone drafts are review artifacts only. They do not alter the production React application.

- `evidence-led.html`: operational proof leads; the calculator is the primary conversion moment.
- `calculator-first.html`: the calculator leads; operational evidence and the sandbox follow.

Both drafts use the production warm-ivory, deep-plum, and restrained-champagne design system. Calculations are interactive and intentionally show the recovery assumptions rather than implying guaranteed revenue.

## Production authentication review

- `auth-oidc.html`: local-only review draft for the `/app` OIDC Authorization Code + PKCE entry state. It uses the production design system, explains MFA and session handling without exposing implementation detail, and includes a restrained redirect/loading interaction.
