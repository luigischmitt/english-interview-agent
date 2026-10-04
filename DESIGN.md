---
name: English Interview Agent
description: Warm, calm, green-on-cream interface for Brazilian developers rehearsing English job interviews.
colors:
  ink: "#0e2a1f"
  green: "#1f6b45"
  green-deep: "#17563a"
  cream: "#f3f4ee"
  surface: "#fbfbf7"
  field: "#f1f3ec"
  track: "#e8ece3"
  tint: "#e6f1ea"
  text-2: "#44604f"
  error: "#8a3a21"
  error-tint: "#f6e9e2"
  warning: "#5a4512"
  warning-tint: "#f6ecd0"
typography:
  ui: "Instrument Sans (400/500/600/700)"
  display: "Instrument Serif (400, italic available)"
---

# Design system

Source of truth in code: tokens in `frontend/src/app/globals.css` (`--ds-*`), primitives in `frontend/src/app/design-system.css` (`ds-*`), shared components in `frontend/src/components/ui/`, fonts in `frontend/src/lib/fonts.ts`. The interview setup page (`interview-setup.tsx`) is the reference implementation. Product context is in `PRODUCT.md`; UI copy is PT-BR.

## Principles

1. Calm under pressure. The product rehearses a stressful moment, so the interface is quiet: cream ground, one green, no decoration that competes with the candidate's words.
2. Depth from light, not lines. Soft two-layer shadows and tint changes separate surfaces; hard borders are the exception.
3. Feedback is instant, motion is short. Press responds on pointer-down; nothing animates longer than 300ms.
4. Precision over polish. Tracking, leading and contrast are chosen per size, not defaulted.

## Palette

| Token | Value | Role |
| --- | --- | --- |
| `--ds-ink` | `#0e2a1f` | Primary text, dark panels |
| `--ds-green` | `#1f6b45` | Primary action, selected ring, links, focus |
| `--ds-green-deep` | `#17563a` | Primary hover, text on tint |
| `--ds-cream` | `#f3f4ee` | Page background |
| `--ds-surface` | `#fbfbf7` | Cards |
| `--ds-field` | `#f1f3ec` | Inputs, option cards, quiet wells (hover `#e9ede3`) |
| `--ds-track` | `#e8ece3` | Segmented and progress tracks |
| `--ds-tint` | `#e6f1ea` | Selected state, success, soft button (hover `#d8eadf`) |
| `--ds-text-2` | `#44604f` | Secondary text |
| `--ds-error` / `-tint` / `-ring` | `#8a3a21` / `#f6e9e2` / `#c9694a` | Error text, error surface, invalid field ring |
| `--ds-warning` / `-tint` | `#5a4512` / `#f6ecd0` | Warning text and surface |
| `--ds-success` / `-tint` | green / tint | Success |
| `--ds-placeholder` | `#75897d` | Placeholder text only |

Contrast (WCAG): ink on cream 13.9:1; text-2 on cream 6.3:1, on surface 6.7:1, on field 6.2:1; green on cream 5.9:1; cream on green 5.9:1; green-deep on tint 7.5:1; green on tint 5.6:1; error on error-tint 6.5:1. The placeholder color is 3.3:1 and must never carry meaning on its own. Never put text-2 or green on a darker surface than `--ds-field` without re-checking.

Tailwind: `bg-surface`, `bg-field`, `bg-tint`, `bg-track`, `bg-cream`, `text-ink`, `text-text-2`, `text-green`, `text-danger`, `bg-danger-tint`, `bg-warn-tint`, `shadow-card`, `shadow-pop`, `shadow-panel`. shadcn variables (`--primary`, `--card`, `--muted-foreground`, ...) and the DaisyUI `interview-light` theme (`btn`, `alert`, `text-error`, ...) are mapped to the same palette, so `text-muted-foreground` is text-2, `text-error` is `#8a3a21`, `bg-primary` is green.

## Typography

Instrument Sans is the UI face everywhere (`font-sans`, default on `<html>`). Instrument Serif is for large display titles only (`font-display`, `var(--font-display)`); never for body, labels or buttons. Fonts load once in the root layout.

| Level | Size / leading | Weight | Tracking | Class |
| --- | --- | --- | --- | --- |
| Display | `clamp(2.25rem, 1.5rem + 3.75vw, 3rem)` / 1.08 (serif) | 400 | -0.02em | `font-display text-balance` |
| Section title | 1.1875rem / 1.25 | 600 | -0.018em | `ds-h2` |
| Label | 0.875rem / 1.25rem | 600 | 0 | `ds-label` |
| Body | 0.875rem / 1.55 | 400 | 0 | `ds-body` (text-2) |
| Small / hint | 0.8125rem / 1.5 | 400 | +0.005em | `ds-small`, `ds-hint` |
| Input | 1rem (prevents iOS zoom) | 400 | 0 | `ds-field` |
| Button | 0.9375rem (CTA 1rem) | 600 | 0 | `ds-btn` |

Rule: tracking tightens as size grows and opens slightly as it shrinks. Use `text-balance` on titles. Long unbroken strings (roles, URLs) need `overflow-wrap: anywhere`.

## Spacing and layout

4px base. Card padding 1.25-1.5rem, gap between cards 1rem-1.5rem, field-to-label 0.5rem. Page gutters 1rem (mobile) / 2rem (sm) / 3rem (lg), content max width `max-w-6xl`. Touch targets at least 44px (`ds-btn` 2.75rem, CTA 3.25rem, segmented item 2.5rem inside a padded track). Mobile primary actions live in a sticky bar with a translucent material that falls back to opaque under `prefers-reduced-transparency`.

## Radii

`--ds-r-sm` 0.625rem (list option), `--ds-r-md` 0.75rem (segmented thumb), `--ds-r-field` 0.875rem (inputs), `--ds-r-lg` 1rem (track, popover), `--ds-r-xl` 1.125rem (option cards, panels in cards), `--ds-r-card` 1.5rem (cards), `--ds-r-panel` 1.75rem (dark summary panel), `--ds-r-pill` (buttons, switches). Nested radii shrink as they nest.

## Elevation

Soft two-layer shadows, never a hard border for structure:

- `--ds-shadow-card`: resting cards.
- `--ds-shadow-pop`: popovers and menus (add a 1px `--ds-line` ring).
- `--ds-shadow-thumb`: raised thumb inside a track.
- `--ds-shadow-panel`: dark summary panel.

Fields use a tint plus an inset 1px `--ds-line` hairline, which becomes a 1.5px green ring and a 4px `--ds-focus-halo` on focus.

## Motion

Easing tokens (also Tailwind `ease-out` / `ease-in-out`): `--ease-out: cubic-bezier(0.23, 1, 0.32, 1)` for entrances, presses and anything responding to the user; `--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1)` for movement between on-screen positions (sliding thumb, disclosure). Never `ease-in`, never `linear` except spinners.

Durations: `--ds-dur-press` 120ms (press feedback), `--ds-dur-fast` 160ms (color, hover, focus), `--ds-dur-base` 200ms (popovers, switch), `--ds-dur-slow` 300ms (entrance, panel color). Nothing exceeds 300ms except the 1.6s looping "warming" bar.

Should it animate? Ask in order:

1. How often is it seen? Keyboard-driven or high-frequency actions (typing, list navigation, shortcut toggles) get no animation. Hover and press get near-imperceptible feedback only. Modals, popovers and disclosures get standard motion. Rare moments (completing setup, the report reveal) may carry delight.
2. What is its purpose? Feedback, spatial continuity, state change or preventing a jarring jump. "It looks nice" on something seen often is a no.
3. Is the user reading or acting on the data? Then it does not move for style.

Rules: animate `transform` and `opacity` only (the disclosure uses `grid-template-rows` deliberately). Enter from `translateY(8px)` + opacity, never `scale(0)`. Press is `scale(0.97)` (`0.985` on large option rows) on `:active`. Stagger entrances with `--i` x 60ms, 300ms maximum total feel. Hover effects are wrapped in `@media (hover: hover) and (pointer: fine)`. Prefer CSS transitions; use WAAPI or a library only for gesture-driven, interruptible motion.

Reduced motion is part of every animation, not a follow-up: movement becomes a fade (`ds-fade`), press scale is removed, looping bars become a slow opacity pulse. `globals.css` also clamps all animation and transition durations to ~0 under `prefers-reduced-motion: reduce`, so a new animation only needs an explicit variant when a plain fade is a better replacement than "instant".

## Component primitives

All in `design-system.css`; opt in by class.

- Card: `ds-card` (surface, `--ds-r-card`, `--ds-shadow-card`). Step badge: `ds-step`.
- Field: `ds-field` on `input`, `textarea`, `select` (chevron included). `aria-invalid="true"` shows the error ring; pair with an error message in `--ds-error` and `role="alert"`.
- Buttons: `ds-btn` plus a variant. `ds-btn-cta-green` primary (full width, 3.25rem), `ds-btn-soft` secondary, `ds-btn-quiet` ghost, `ds-btn-cta` for use on dark panels. Wrap a trailing arrow icon in `ds-arrow` to get the hover nudge. All have `scale(0.97)` press, a 2px green focus ring, 0.55 opacity when disabled.
- Switch: `<label class="ds-toggle"><input type="checkbox" class="ds-switch" /> ...</label>`; set `data-disabled="true"` on the label when disabled.
- Option card + radio: `<label class="ds-option"><input type="radio" class="ds-radio" /> ...</label>`; checked shows tint and a green ring.
- Segmented control: `SlidingSegmented` in `frontend/src/components/ui/sliding-segmented.tsx` (`ds-seg*`), radio semantics with a sliding thumb.
- Combobox: `RoleCombobox` in `frontend/src/components/ui/role-combobox.tsx` (`ds-combo-*`, `ds-field`).
- Disclosure: `ds-reveal` with `data-open`, wrapping a single child div; `ds-chevron` rotates.
- Entrance: `ds-enter` (with `style={{ "--i": n }}`), `ds-fade-in`, `ds-pop` (check mark).

Setup-only styles (summary panel, mobile bar, voice-readiness panel) stay in `interview-setup.css`; promote them to `ds-` only when a second screen needs them.

## Accessibility

- Text contrast 4.5:1 minimum (3:1 for 18px+ or bold 14px+ and for UI boundaries). Check every new pairing against the table above.
- Focus: one ring, `outline: var(--ds-focus-outline)` (2px green) with 2-3px offset; fields use the inset ring plus halo. Never `outline: none` without a replacement. Group controls (`label:has(input:focus-visible)`) show the ring on the visible wrapper.
- Targets at least 44px. Native inputs stay in the DOM (visually restyled, not replaced), so keyboard and screen readers work unchanged.
- State is never color alone: errors carry text and `aria-invalid`, selection carries a ring as well as tint.
- Dynamic status uses `role="status"` / `role="alert"`; collapsed content is `visibility: hidden` and inert.
- Respect `prefers-reduced-motion` and `prefers-reduced-transparency`; hover styles never gate functionality.
- Language: `<html lang="pt-BR">`; English interview content is marked where it appears in a PT-BR page.
