# Shared UI primitives

The application uses custom React/CSS primitives defined inline in `src/App.tsx`; there is no external component library. Phosphor Icons supplies icon components.

## Brand

- Source: `src/App.tsx`
- Shared salon operations identity used by desktop and mobile shells.

```tsx
function Brand() {
  return (
    <div className="brand" aria-label="Salon Recovery Agent">
      <span className="brand-mark"><ShieldStar weight="fill" aria-hidden="true" /></span>
      <span><strong>Salon</strong><small>Recovery Agent</small></span>
    </div>
  )
}
```

## Button primitives

- Source: `src/styles.css`
- `.primary-button`, `.secondary-button`, `.text-button`, and `.icon-button` are the shared action system.

```css
.primary-button, .secondary-button, .text-button { min-height: 39px; display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 0 15px; border-radius: var(--radius-control); font-size: .75rem; font-weight: 700; white-space: nowrap; transition: background 160ms ease, border-color 160ms ease, color 160ms ease, transform 160ms ease; }
.primary-button { color: var(--surface); background: var(--primary); border: 1px solid var(--primary); }
.primary-button:hover { background: var(--primary-hover); border-color: var(--primary-hover); }
.secondary-button { color: var(--primary); background: var(--surface); border: 1px solid var(--border-strong); }
.secondary-button:hover { border-color: var(--primary); background: var(--canvas); }
.text-button { min-height: 32px; padding: 0 4px; border: 0; color: var(--primary); background: transparent; }
```

## Operational panels and status badges

- Source: `src/styles.css`
- Used across dashboard, integrations, policies, approvals, and onboarding.

```css
.ops-panel { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-panel); box-shadow: var(--shadow); }
.status-badge { display: inline-flex; max-width: 100%; padding: 4px 6px; border-radius: var(--radius-badge); border: 1px solid var(--border); font-size: .56rem; font-weight: 750; text-transform: uppercase; letter-spacing: .025em; white-space: nowrap; }
.status-badge.success { color: var(--success); background: var(--success-soft); }
.status-badge.warning { color: var(--warning); background: var(--warning-soft); }
.status-badge.danger { color: var(--danger); background: var(--danger-soft); }
```
