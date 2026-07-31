# Page dependency trees

## Public marketing and recovery review

Entry: `src/MarketingPage.tsx`

- `src/App.tsx` (public path selection)
  - `src/MarketingPage.tsx`
  - `src/public-api.ts`
  - `src/marketing.css`
  - `src/styles.css` (global design tokens imported by `src/main.tsx`)

## Command Centre

Entry: `src/App.tsx`

- `src/App.tsx`
  - `src/operations-api.ts`
  - `src/screens/ApprovalsScreen.tsx`
  - `src/screens/ConversationsScreen.tsx`
  - `src/screens/RecoveryQueueScreen.tsx`
  - `src/screens/OperationsScreens.tsx`
  - `src/styles.css` (imported by `src/main.tsx`)

## Integrations

Entry: `src/screens/OperationsScreens.tsx` (`IntegrationsScreen`)

- `src/App.tsx` (Sidebar, Topbar, active screen branch)
  - `src/screens/OperationsScreens.tsx`
  - `src/operations-api.ts`
  - `src/styles.css`

## Activation (new flow target)

The future `ActivationScreen` should use:

- `src/App.tsx` (Sidebar, Topbar, control navigation, active screen branch)
  - `src/screens/ActivationScreen.tsx`
  - `src/operations-api.ts`
  - `src/styles.css`

No Tailwind configuration or independent component library exists.
