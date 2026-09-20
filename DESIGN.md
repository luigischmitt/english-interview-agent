---
name: English Interview Agent
description: Calm, focused English interview practice for Brazilian technology professionals.
colors:
  canvas: "#fbfaf3"
  surface: "#fffef8"
  ink: "#28343a"
  muted-ink: "#55656b"
  rule: "#d4dbd6"
  accent: "#3c5966"
  accent-content: "#f7f7f1"
  accent-soft: "#d9e1dc"
  sidebar: "#e9ede9"
  positive: "#89a4a0"
  warning: "#e3e7e3"
  error: "#9f3d2b"
typography:
  display:
    fontFamily: "Geist Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(2.5rem, 5vw, 3.25rem)"
    fontWeight: 600
    lineHeight: 1.08
    letterSpacing: "-0.035em"
  headline:
    fontFamily: "Geist Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(1.875rem, calc(1.25rem + 3.125vw), 2.5rem)"
    fontWeight: 600
    lineHeight: 1.12
    letterSpacing: "-0.03em"
  title:
    fontFamily: "Geist Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  body:
    fontFamily: "Geist Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.75
  label:
    fontFamily: "Geist Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 500
    lineHeight: 1.5
rounded:
  sm: "0.375rem"
  md: "0.5rem"
  lg: "0.625rem"
  xl: "0.75rem"
spacing:
  xs: "0.5rem"
  sm: "0.75rem"
  md: "1rem"
  lg: "1.5rem"
  xl: "2rem"
  section: "3rem"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-content}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "0.75rem 1.25rem"
    height: "3rem"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "0.75rem"
    height: "3rem"
  input-field:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "0.625rem 0.75rem"
    height: "2.75rem"
  editorial-card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.xl}"
    padding: "1.25rem"
  nav-item:
    backgroundColor: "transparent"
    textColor: "{colors.muted-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "0.75rem"
    height: "2.75rem"

---

# Design System: English Interview Agent

## Overview

**Creative North Star: "The Calm Rehearsal Desk"**

English Interview Agent is an editorial operating surface for a high-pressure human task. The interface gives a candidate one useful next move, using warm bone surfaces, ink-colored type, sparse hairline rules, and a precise blue-green accent. It feels like a prepared desk: quiet, legible, and ready when the question arrives.

The visual system favors hierarchy over decoration. Public Home makes the audience and promise clear before offering one account action; authenticated Home keeps one practice action in front, with warm-up and Progress as supporting paths. The implementation rejects gradients, heavy shadows, generic bento grids, decorative avatars, and claims the product cannot support.

**Key Characteristics:**
- Warm monochrome canvas with a single muted teal action voice.
- Editorial rules, narrow measures, and deliberate whitespace.
- Controls are modestly rounded, tactile, and visibly focusable.
- Content remains useful at 390px, 768px, and 1440px.

## Colors

The palette is warm paper and cool ink, with one restrained blue-green accent reserved for action and wayfinding. Light and dark themes invert the canvas/surface relationship while preserving the same semantic roles.

### Primary
- **Quiet Teal** (`#3c5966`): Primary action, active indicator, focus ring, and compact brand mark in the light theme.

### Neutral
- **Warm Canvas** (`#fbfaf3`): Page background and the public reading surface.
- **Soft Paper** (`#fffef8`): Cards, form surfaces, and other contained work areas.
- **Ink** (`#28343a`): Primary text and high-contrast content.
- **Muted Ink** (`#55656b`): Supporting copy, labels, and low-emphasis navigation.
- **Hairline Rule** (`#d4dbd6`): Borders, dividers, and editorial section separators.
- **Quiet Tint** (`#d9e1dc`): Selected mobile navigation and low-emphasis states.
- **Sidebar Wash** (`#e9ede9`): Desktop navigation rail background.

### Named Rules
**The One Voice Rule.** Let the accent carry action and current-location meaning; do not spread it across decorative surfaces.

## Typography

**Display Font:** Geist Sans (with `ui-sans-serif`, `system-ui`, sans-serif fallbacks)
**Body Font:** Geist Sans (with `ui-sans-serif`, `system-ui`, sans-serif fallbacks)
**Label/Mono Font:** No distinct mono face is used in the implemented UI; compact labels use the body family.

**Character:** Geist Sans is direct and contemporary without becoming promotional. Tight tracking and weight establish confidence in headings; generous body leading keeps B1/B2 English copy easy to scan.

### Hierarchy
- **Display** (600, `clamp(2.5rem, 5vw, 3.25rem)`, 1.08): Public Home H1; left-weighted promise and audience statement.
- **Headline** (600, `clamp(1.875rem, calc(1.25rem + 3.125vw), 2.5rem)`, 1.12): Authenticated page introductions and prominent room headings.
- **Title** (600, `1.5rem`, 1.2): Section titles such as “How it works” and “Start with one useful answer.”
- **Body** (400, `1rem`, 1.75): Explanatory copy, prompts, and interview content; keep prose near 48–60ch.
- **Label** (500, `0.875rem`, 1.5): Controls, navigation, field labels, and compact supporting metadata.

### Named Rules
**The Clear Answer Rule.** Use tight, weight-led headings and readable measures; never use display scale to make a promise sound louder than it is.

## Layout

The shared shell is a centered `max-width: 72rem` frame with responsive gutters (`1.25rem` mobile, `2rem` at small widths, `3rem` at large widths). Public Home uses a left-weighted two-column opening at large widths and a three-step row below a rule; it collapses to one reading column below the medium breakpoint. Authenticated Home uses a 1.3:0.7 content-to-context composition at large widths, with the warm-up rail aligned beside the primary practice action.

Desktop authenticated navigation is a persistent `15rem` left rail. Below the large breakpoint it becomes a fixed bottom navigation with four labeled destinations, at least `3rem` high per item and safe-area padding. Main content reserves bottom space for that bar. Vertical rhythm is built from `0.75rem`, `1rem`, `1.5rem`, `2rem`, and section-scale gaps rather than dense card grids.

## Elevation & Depth

This is a flat-by-default system. There are no structural shadows in the implemented Home surfaces; depth comes from warm tonal changes, hairline borders, and whitespace. The card primitive uses a subtle one-pixel foreground ring rather than a shadow. Motion is reserved for state changes and orientation, not ambient decoration.

### Named Rules
**The Flat Desk Rule.** Surfaces rest flat; use a rule, spacing, or tonal shift to establish hierarchy before adding elevation.

## Shapes

The form language uses modest corners: controls and navigation sit at `0.5rem`, brand marks and cards use `0.625rem` to `0.75rem`, and full pills are reserved for status badges rather than primary actions. Borders are one pixel and low-contrast but visible in both themes. Public content uses rule-separated blocks; authenticated warm-up and context panels use top/bottom rules instead of ornamental containers.

## Components

### Buttons
Buttons are compact, confident actions with a minimum `3rem` touch height on Home. The primary button uses the accent fill; ghost buttons preserve the paper canvas and gain a muted tint on hover.

- **Shape:** Gently rounded corners (`0.5rem`); no pill-shaped primary actions.
- **Primary:** Quiet Teal fill with canvas-colored text and `0.75rem 1.25rem` padding.
- **Hover / Focus:** Accent opacity shifts on hover; focus uses a visible accent ring and border. Active state translates by one pixel.
- **Secondary / Ghost:** Transparent at rest, text-led, with muted background on hover; use for Sign in, View progress, Another prompt, and cancellation.

### Cards / Containers
Cards are bounded work surfaces, not dashboard tiles. They use Soft Paper, a `0.75rem` corner, a one-pixel tonal ring, and internal padding from `1.25rem` to `2rem`. Editorial Home blocks generally prefer borders and whitespace without a card shell.

### Inputs / Fields
Inputs use a Soft Paper fill, one-pixel Hairline Rule border, `0.5rem` corners, and a `2.75rem` control height. Focus shifts to the accent border/ring; invalid fields use the error role and keep the message adjacent to the field.

### Navigation
The desktop rail is visible with labels at normal widths, uses a Sidebar Wash background, and marks the active route with a thin accent rule plus text contrast rather than a saturated tile. Mobile navigation is fixed to the bottom, keeps four icon-and-label targets visible, and gives the active item a Quiet Tint background. Essential labels never depend on hover.

### Warm-up Prompt
The optional warm-up is a rule-separated editorial block with a prompt, a practical cue, and a quiet “Another prompt” action. Its prompt content changes locally with `aria-live="polite"`; it never competes visually with Start practice or navigates away.

## Do's and Don'ts

### Do:
- **Do** keep one primary CTA in the first viewport: “Create a practice space” publicly or “Start practice” for an authenticated candidate.
- **Do** use the accent for action, focus, and current location, with Hairline Rules for structure.
- **Do** keep explanatory copy within roughly 48–60ch and let long roles or statuses wrap.
- **Do** preserve visible focus, labeled navigation, 44px-or-larger touch targets, and reduced-motion behavior.
- **Do** let warm-up and Progress support the next action without inventing metrics or analysis claims.

### Don't:
- **Don't** add gradients, neon, glass, heavy shadows, decorative avatars, or generic bento/card grids.
- **Don't** use accent color as a saturated background for every navigation item or section.
- **Don't** make primary actions pill-shaped, icon-only, or dependent on hover to explain themselves.
- **Don't** claim AI analysis, readiness scores, accent correction, or outcomes not represented by the product.
- **Don't** duplicate Progress metrics, history, loading, error, or empty states on Home.
