# Route and screen mapping

This Vite application uses state-based screen routing in `src/App.tsx`, not React Router.

Public path routing is resolved before the state-based operations shell:

| Path | Component | File |
|---|---|---|
| `/` | `MarketingPage` | `src/MarketingPage.tsx` |
| `/for/:locationSlug` | `MarketingPage` with localized copy | `src/MarketingPage.tsx` |
| `/app` | `OperationsApp` | `src/App.tsx` |

| Screen label | Component | File | Shared layout |
|---|---|---|---|
| Command Centre | inline dashboard branch | `src/App.tsx` | Sidebar + Topbar |
| Recovery Queue | `RecoveryQueueScreen` | `src/screens/RecoveryQueueScreen.tsx` | Sidebar + Topbar |
| Conversations | `ConversationsScreen` | `src/screens/ConversationsScreen.tsx` | Sidebar + Topbar |
| Campaigns | `CampaignsScreen` | `src/screens/OperationsScreens.tsx` | Sidebar + Topbar |
| Clients | `ClientsScreen` | `src/screens/OperationsScreens.tsx` | Sidebar + Topbar |
| Revenue Ledger | `RevenueLedgerScreen` | `src/screens/OperationsScreens.tsx` | Sidebar + Topbar |
| Approvals | `ApprovalsScreen` | `src/screens/ApprovalsScreen.tsx` | Sidebar + Topbar |
| Integrations | `IntegrationsScreen` | `src/screens/OperationsScreens.tsx` | Sidebar + Topbar |
| Policies | `PoliciesScreen` | `src/screens/OperationsScreens.tsx` | Sidebar + Topbar |

Activation is a Controls screen rendered in the same operations branch structure.
