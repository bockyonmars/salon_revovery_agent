# Salon Recovery Agent design system

## Product character

Luxury salon operations: composed, trustworthy, quietly premium, and evidence-led. Professional rather than overtly feminine. Avoid pink, ornamental flourishes, glassmorphism, gradients, oversized marketing typography, excessive pills, and playful consumer-app patterns.

## Color

- Canvas warm ivory: `#f6f1e9`
- Primary surface: `#fffcf7`
- Muted surface: `#eee6dc`
- Sidebar deep plum: `#35152e`
- Raised plum: `#45203d`
- Primary plum: `#4a1f3f`
- Main ink: `#291b25`
- Soft ink: `#6e6269`
- Muted ink: `#8b7f85`
- Border: `#ddd1c5`; strong border: `#c8b9ab`
- Restrained champagne: `#b59661`; soft champagne: `#eee3cf`
- Success sage: `#5f735f`; warning umber: `#9a6837`; danger oxblood: `#8b404a`; information slate: `#5d6e82`

Champagne is a navigational or verification accent, never a large decorative fill. State colors should remain muted and accessible.

## Typography

Use `Avenir Next`, Avenir, `SF Pro Display`, system UI. Dense operational typography: 0.61–0.84rem supporting labels/body, 0.98–1.12rem section headings, and restrained 1.8–2.5rem page statements. Labels are uppercase with 0.075–0.1em tracking. Use tabular numerals for values.

## Shape and depth

- Panels: 14px radius, 1px fine border, `0 14px 38px rgba(53,21,46,.08)` shadow.
- Controls: 9px radius, minimum 39px height.
- Badges: 7px radius; do not use fully rounded pills.
- Use dividers, hierarchy, and whitespace before adding shadows.

## Layout

Desktop shell: fixed 248px sidebar, sticky 68px topbar, content max-width near 1488px, 28px horizontal page padding. Operational pages use a strong introductory row followed by summary/checklist panels. At 980px collapse multi-column layouts; at 760px replace fixed sidebar with a compact mobile route strip.

## Interaction

Primary actions are solid plum; secondary actions are ivory with strong border; text actions are unboxed plum. Hover and press transitions are 160–180ms. Focus rings are mandatory. Disabled activation must explain exactly which checks are blocking it.

## Activation experience

The screen must make three things immediately clear: current state (`Draft`, `Ready to activate`, or `Active`), critical checks that passed/failed, and the next safe action. Use an evidence checklist rather than a playful numbered wizard. The manager runs checks, corrects blockers, then explicitly activates. A stale result receives a visible warning and activation remains disabled. Never imply a provider action passed if no verified result exists.
