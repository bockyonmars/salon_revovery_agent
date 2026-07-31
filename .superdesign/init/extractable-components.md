# Extractable components

## Sidebar

- Source: `src/App.tsx`
- Category: layout
- Description: Fixed deep-plum navigation with product identity, control links, approval badge, and operator identity.
- Extractable props: `activeItem` (string, default `Activation`), `approvalCount` (number, default `3`)
- Hardcoded: logo mark, navigation labels, icons, operator identity, CSS.

## Topbar

- Source: `src/App.tsx`
- Category: layout
- Description: Sticky screen header with location, period selector, notifications, and primary recovery action.
- Extractable props: `title` (string, default `Activation`), `approvalCount` (number, default `3`)
- Hardcoded: Mayfair Flagship, period options, icon names, action label.

## OperationalPanel

- Source: `src/styles.css` and `src/screens/OperationsScreens.tsx`
- Category: basic
- Description: Ivory bordered card with compact header and evidence-oriented content.
- Extractable props: none.
- Hardcoded: surface, border, shadow, radius.

## StatusBadge

- Source: `src/styles.css`
- Category: basic
- Description: Compact uppercase ready, warning, danger, or neutral state label.
- Extractable props: none; inline in drafts.
