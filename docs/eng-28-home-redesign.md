# ENG-28 — Home redesign direction

Status: design direction for ENG-29. ENG-55 supersedes the candidate-answer interaction described below: the room is voice-only, and only completed voice transcripts may be submitted. This document otherwise preserves the Home implementation contract and the now-available interview persistence, microphone capture, and real Progress states without adding new data behavior.

The route `/` has two explicit presentation states: a public Home for visitors and a practice Home for authenticated users. Both states must make the product, audience, and next step legible within seconds.

## Design Read

Reading this as: a two-state Home (public visitor introduction + authenticated practice-home) for Brazilian technology professionals at B1/B2 English, with a quiet editorial / technical language, leaning toward premium utilitarian minimalism: warm bone canvas, ink typography, precise teal accents, sparse borders, and one clear action per state.

The Home is an operating surface, not a marketing landing page. Its job is to get a returning candidate into a useful speaking practice session in under a minute and make the next step feel safe under pressure. It should feel like a calm rehearsal desk, not a video-call dashboard or an AI sales page.

## Dials

- `DESIGN_VARIANCE: 5/10` — intentional asymmetry in the opening block and editorial rule lines; stable reading order and familiar controls.
- `MOTION_INTENSITY: 2/10` — one restrained entrance and state transitions only; no ambient loops or celebratory effects.
- `VISUAL_DENSITY: 3/10` — short copy, one primary action, a compact context rail, and no data wall.

The direction is deliberately quieter than the current prototype: confidence comes from hierarchy, not decoration.

## Product and scope invariants

- Audience: Brazilian developers and other technology professionals, usually B1/B2, who can do the work but lose clarity and confidence under interview pressure.
- Promise: help their technical competence be perceived in English with clarity, confidence, and precision. Never promise accent elimination or perfect English.
- Differentiator to surface: practice under interview pressure, with attention to pauses, hesitation, pacing, intelligibility, pronunciation, word stress, articles, prepositions, tense, literal translations, false cognates, and answer structure.
- Do not invent unsupported AI analysis, feedback results, social proof, streaks, benchmarks, users, or scores. Interview text persistence and real Progress data now exist; Home must not synthesize, duplicate, or market them as proof.
- Keep the existing Kokoro audio path for interviewer questions in the interview room. Home may explain that the room is spoken and audio-led; it must not replace or duplicate the playback behavior.
- Preserve the existing local microphone capture, permission behavior, and voice-answer flow in the room. ENG-29 adds no new microphone, camera, avatar, backend, analytics, or persistence work.

## Current-state audit

Evidence inspected: `frontend/src/app/page.tsx`, auth pages and session guard, interview question/speech modules, theme tokens, and `frontend/README.md`.

### What is already useful

- The first action is visible and the warm-up prompt is product-relevant rather than generic filler.
- “You do not need a perfect answer. You need one that is clear, specific, and yours.” is an honest, audience-specific line worth preserving in spirit.
- The setup form has meaningful controls: target role, seniority, focus, length, and question count.
- The room separates interviewer question, candidate response, session progress, elapsed time, and audio fallback. The candidate responds by voice; interviewer question text remains available if Kokoro fails.
- Auth copy is calm and avoids inflated claims; expired/config/callback/error states are explicit.

### Problems the redesign must solve

- The Home currently opens with two competing calls to action: “Start interview” and “Another question,” then repeats “View progress” below. The candidate must decide what matters before seeing a clear “next practice” context.
- The blue/teal filled card is visually heavy relative to the calm product promise. It reads as a generic feature hero and consumes the strongest contrast for a prompt that is not the main task.
- “A focused room” repeats setup facts (technical, 25 minutes, English) without showing why to start now or what changes after a session.
- “Keep the momentum” is too vague for the new persistence contract. Authenticated Home should offer a clear handoff to the real Progress view, never a duplicate history block or dynamic data fetch.
- Home, setup, progress, and settings are all local views in one file. Navigation is serviceable but the hover-expanded desktop rail and fixed mobile bar add chrome before the candidate has begun.
- The Progress view now owns real loading, error, empty, completed-session, duration, and answer-count states. ENG-29 must preserve that ENG-32 surface and must not duplicate its metrics or introduce a Home persistence call.
- The room uses initials in an avatar tile. This is existing prototype behavior and out of scope for ENG-28; the redesign must not broaden it into avatar work.

## Journeys

### Visitor journey (unauthenticated)

1. Visitor requests `/` and receives the public Home, not an immediate login wall. In seconds it answers: what it is (spoken English interview practice), who it is for (Brazilian technology professionals preparing for interviews), and what to do next.
2. The public Home has one primary CTA: **Create a practice space** → `/signup`; a quiet secondary link **Sign in** → `/login`. It contains no metrics, testimonials, customer logos, readiness scores, or claims about AI analysis.
3. Visitor can move to `/signup`, submit name/email/password, and sees the confirmation message when email confirmation is required.
4. Visitor follows the confirmation link and returns to `/` as an authenticated user.
5. A visitor who forgot a password uses `/forgot-password`, receives a neutral recovery message, follows the callback, and updates the password at `/update-password`.
6. If an unauthenticated visitor requests a protected view such as Progress, middleware still redirects to `/login?next=<safe-path>`; public access to `/` must not weaken protection for other views.

Public Home content contract:

- H1: **Practice clearer answers in English.**
- Supporting line: “Interview practice for Brazilian technology professionals who want their technical thinking to come through under pressure.”
- CTA pair: **Create a practice space** and **Sign in**.
- A short “How it works” sequence: choose a role and focus → answer spoken questions → return to practice with more clarity. It describes the product without claiming unsupported feedback analysis or AI evaluation.
- Auth pages remain an adjacent trust surface, not a second Home hero. Preserve `next` return behavior and explicit expired/config/callback errors.

### Authenticated journey

1. Land on the authenticated Home with one obvious next action: **Start practice**.
2. Read a short orientation line about clarity under pressure; optionally use a low-emphasis warm-up prompt without leaving Home.
3. Select **Start practice** and complete setup: target role, seniority, focus, session length, and question count.
4. Enter the interview room. The interviewer question is spoken with the existing Kokoro route, then the candidate answers aloud and submits only its completed voice transcript. Microphone or transcription failure offers retry, skip, or end actions.
5. Finish the room and return to Home. Keep the completion copy truthful to persistence state: show “Saved to your private session.” when saved, or the existing local/degraded warning when account sync fails. Keep the existing note that voice recordings remain local and are not uploaded or transcribed.
6. Progress is reachable from navigation and remains the destination for real history/metrics/loading/error/empty behavior. ENG-29 must not change or duplicate that ENG-32 surface. Settings remains a utility view for theme and voice-first explanation.

### Primary success criterion

Within the first viewport, a returning user can answer “What am I doing now?” and activate practice without scanning more than one primary CTA. A first-time authenticated user can understand role/focus choices before submitting setup.

## Information architecture and navigation

Desktop and mobile share the same four destinations, in this order:

1. **Home** — “Practice overview” (current location).
2. **Interview** — starts setup, then becomes room while a session is active.
3. **Progress** — existing practice history/skills destination; its real metrics, loading/error/empty states, and layout remain untouched by ENG-29 and are owned by merged ENG-32.
4. **Settings** — appearance and interview environment.

Navigation behavior:

- Desktop: a compact left rail with labels always visible at normal widths. No hover-only expansion for essential labels. Active item uses a thin accent rule and text contrast, not a saturated tile.
- Mobile: a bottom navigation with 44px minimum targets and labels; content reserves safe-area space. The active item has a subtle tinted background and text/icon change.
- In setup and room, provide an explicit back/end action; do not hide the exit behind navigation.
- Keep `aria-current="page"`, visible keyboard focus, and a skip link to the main content.

## Home hierarchy and blocks

The Home is a single column with a narrow context rail at desktop; it collapses to one column below 768px. Avoid a bento grid and avoid three equal feature cards.

### 0. Public Home state (visitor)

When there is no authenticated user at `/`, replace the practice shell with a concise public Home. It has its own simple header: mark on the left, **Sign in** text link and **Create a practice space** button on the right. No sidebar, mobile app nav, warm-up prompt, progress link, or session metrics appears in this state.

The public first viewport contains the H1, supporting line, CTA pair, and the three-step “How it works” explanation. Keep the page calm and specific; it is a product introduction, not a dashboard and not a generic AI landing page. On mobile, stack the mark, copy, and CTA pair in that reading order.

### 1. Authenticated header / orientation

- Eyebrow: `PRACTICE OVERVIEW` in compact mono uppercase.
- H1: **Make your next answer clearer.**
- Supporting copy: “A short English interview practice session for the role you are preparing for.”
- Primary CTA: **Start practice**.
- Secondary action: text link **View progress**. It is the authenticated path back to the existing Progress view; ENG-29 does not redesign or replace that view.

This copy says what the product does without claiming AI analysis or future results. “Clearer” is the goal, not “fluent,” “native,” or “perfect.”

### 2. Practice prompt (supporting, not competing)

Use a bordered editorial block below the CTA:

- Label: `WARM-UP`.
- Prompt: retain the existing rotating prompt set (technical decision, collaboration, impact).
- Cue: keep the short practical cue.
- Action: **Another prompt** as a quiet text button.

The prompt is optional preparation. It must not look like a second start flow; changing it stays local and does not navigate.

### 3. Context rail / “what to expect”

At desktop, a narrow rule-separated rail aligns with the opening block. At mobile it follows the warm-up block. Content:

- `MODE` — English, spoken answers.
- `FOCUS` — selected focus once a role/session preference exists; otherwise “Choose in setup.”
- `ROOM` — “Questions are spoken aloud; you answer at your pace.”

Do not show “25 minutes” as a hard-coded promise on Home when the setup can change it. Do not show a fake readiness score or completion count.

### 4. Progress handoff

Home does not render a first-session/history block and does not make a new persistence request. The authenticated Home keeps one clear **View progress** handoff to the existing Progress destination. Progress owns its real loading, error, empty, and completed-session metrics states; ENG-29 must not reproduce those states or metrics on Home.

## Content and copy rules

- Default language of the app remains English because the practiced interview is in English. Copy should use short sentences and familiar B1/B2 vocabulary.
- Keep labels concrete: “Start practice,” “Target role,” “Question count,” “Your voice answer.” Avoid “Optimize,” “Elevate,” “seamless,” “next-gen,” and “AI-powered.”
- Mention pressure where it clarifies the job: “Practice answering clearly when the question is on.” Do not use shame, scarcity, or “fix your accent.”
- Keep the distinction between content and English delivery explicit in future progress copy: technical answer quality is not the same as clarity, pacing, or pronunciation.
- If interviewer audio is unavailable, keep the question visible and offer a retry; microphone or transcription failures offer retry, skip, or end.
- Do not invent Home metrics or history copy. When a user wants history, send them to **View progress** and let the existing Progress state explain what is available.

## Empty, loading, error, and completion states

| Surface | State | Required behavior and copy |
| --- | --- | --- |
| Home | Authenticated handoff | Keep **Start practice** primary and **View progress** as the direct route to real history; do not render a duplicate or dynamic history block. |
| Home | Warm-up prompt changing | Keep `aria-live="polite"`; animate only the prompt content; preserve selected topic. |
| Home | Auth expired | Route to login with existing “Your session ended…” warning and preserve a safe `next` path. |
| Setup | Missing role | Inline error: “Add the role you want to practice for.” Keep focus on the field. |
| Setup | Submit pending | Disable submit and show a small spinner; do not change the user’s selections. |
| Room | Kokoro unavailable/timeout | Keep question text visible, show the existing non-blocking warning, and let the candidate answer aloud. |
| Room | Speaking | Keep response controls unavailable with a clear “The question is playing” state; never trap focus. |
| Room | Advancing | Disable duplicate submit and announce “Moving to next question.” |
| Room | Complete / saved | Preserve “Saved to your private session.” and the existing factual session summary. |
| Room | Complete / degraded | Preserve “Saved locally for this session; account sync needs attention.” plus the existing warning; do not imply account persistence succeeded. |
| Progress | Existing real view | Preserve ENG-32 loading skeleton, retryable error, no-completed-sessions empty state, completed-session metrics, and session table. ENG-29 neither changes nor duplicates it on Home. |
| Auth | Configuration/network/error | Preserve existing neutral, specific alert variants; never reveal account existence in recovery. |

## Palette and conceptual tokens

Use warm monochrome plus one muted blue-green accent. No gradients, neon, glass, or decorative avatars. Shadows are not a structural layer; rely on borders, spacing, and contrast.

| Token | Light concept | Dark concept | Use |
| --- | --- | --- | --- |
| `canvas` | `#FBFAF3` | `#1F2021` | Page background |
| `surface` | `#FFFEF8` | `#2A2D2E` | Form/room surfaces |
| `ink` | `#28343A` | `#F4F5EF` | Primary text |
| `muted-ink` | `#55656B` | `#BBC5C3` | Supporting text |
| `rule` | `#D4DBD6` | `#404544` | 1px separators and card borders |
| `accent` | `#3C5966` | `#B7C8CA` | Primary CTA, focus, active indicator |
| `accent-soft` | `#D9E1DC` | `#414A49` | Selected/quiet state |
| `positive` | Surface `#EDF3EC`; content `#24512B` | Surface `#26352B`; content `#B8E0BE` | Success only; 8.15:1 light and 8.88:1 dark |
| `warning` | Surface `#FBF3DB`; content `#765000` | Surface `#493D1E`; content `#F1D98A` | Audio/config warning; 6.49:1 light and 7.63:1 dark |

Conceptual type tokens:

- `display`: Geist Sans, 40–52px desktop / 34–40px mobile, 1.08 line-height, tight tracking.
- `heading`: Geist Sans, 20–28px, 1.2 line-height.
- `body`: Geist Sans, 15–16px, 1.55–1.65 line-height.
- `meta`: Geist Mono, 11–12px, uppercase with 0.12–0.16em tracking.
- `measure`: 58–66ch for explanatory copy; never stretch paragraphs across the full shell.
- `radius`: 6–10px for controls/surfaces; no pill-shaped primary containers.
- `border`: 1px, low-contrast but visible in both themes.

## Accessibility and inclusion

- Meet WCAG AA contrast for body text, controls, status, and borders needed to understand boundaries; check both light and dark themes.
- Every control has visible text or an accessible name. Do not make icon-only navigation the default.
- Keep heading order `h1` then section `h2`; use landmarks (`header`, `nav`, `main`, `aside`) intentionally.
- Preserve keyboard focus through prompt changes, setup validation, auth errors, and room state changes. Errors are adjacent to fields and announced.
- Maintain 44×44px minimum touch targets, including mobile navigation, prompt selectors, theme control, and room actions.
- Respect `prefers-reduced-motion`: remove entrance transforms and prompt transitions, but preserve state change, focus, and status text. Never rely on color or motion alone to communicate speaking/answering.
- Avoid language that stigmatizes Brazilian accent. Explain intelligibility and clarity as communication outcomes, not identity correction.
- Support browser zoom/text enlargement without horizontal scrolling; test long roles and translated future copy for wrapping.

## Responsive behavior

- `<768px`: one column; order is orientation → primary CTA → warm-up → context rail → View progress handoff. Hide decorative separation, not content. Bottom nav reserves safe-area padding.
- `768–1023px`: one content column with wider gutters; context rail becomes a full-width rule-separated section.
- `≥1024px`: persistent compact nav rail; Home content uses a 2:1 content/rail composition, with the opening block and context rail aligned to the same top edge.
- At every width, the primary CTA remains visible without requiring a scroll through prompt copy. Do not use fixed heights for copy blocks.
- Long role names and status messages wrap; they do not truncate critical meaning.

## Motion and behavior

- On initial Home view, a single 180–240ms opacity/translate entrance for the orientation and practice block. Use transform/opacity only.
- On “Another prompt,” cross-fade the prompt content over 160–220ms; keep `aria-live="polite"` and do not move focus unexpectedly.
- Buttons use a 100–160ms color/border transition and a small pressed translation; no bounce, parallax, pulse, or looping ambient effects.
- Room speaking indicator may continue its existing subtle status treatment; audio playback remains functional through the Kokoro route.
- Reduced motion removes transitions/entrances while leaving the same content order and status messaging.

## Contract for ENG-29 implementation

1. Implement the Home hierarchy and public/authenticated states in the existing frontend shell; do not add routes, Home persistence calls, analytics, avatar work, or new microphone/camera work. Preserve existing session persistence and microphone capture elsewhere in the shell.
2. Keep existing auth redirect and session-guard behavior intact, with one explicit exception: allow unauthenticated `/` to render the public Home while every other protected view continues to redirect to login with a sanitized `next` path. Authenticated users requesting `/` must render the practice Home.
3. Keep setup fields and validation intact unless a copy/ordering change is required by the hierarchy above.
4. Keep `getFixedInterviewQuestions` and `synthesizeInterviewerQuestion` behavior intact. Kokoro audio must continue to play interviewer questions and remain non-blocking on failure. Preserve `MicrophoneCapture` behavior, permission handling, and local voice-answer capture.
5. Implement the public and authenticated states of `/` described above. Do not remove the Progress destination; link to the existing Progress view without modifying it.
6. Do not modify or duplicate `ProgressView`, its real metrics, loading/error/empty states, session table, copy, or layout in ENG-29. Those states are owned by merged ENG-32.
7. Use existing daisyUI/shadcn primitives where they match, with this direction’s tokens and no new component library.
8. Keep typography and spacing in tokens/classes rather than route-specific magic values. Avoid generic card grids, gradients, heavy shadows, and avatar-led visuals.
9. Add/retain semantic labels, keyboard focus, `aria-live` only for dynamic prompt/status text, and reduced-motion behavior.
10. Verify desktop (1440px), tablet (768px), and mobile (390px) plus light/dark theme; verify long role text and auth/error states.

## Acceptance checklist

- [ ] The authenticated Home’s first viewport has one primary CTA labeled “Start practice”; the public Home’s primary CTA is “Create a practice space” (with “Sign in” as the quiet secondary action).
- [ ] Home copy is English, short, audience-specific, and makes no unsupported AI, metric, or accent claim.
- [ ] Visitor journey starts on a public `/` Home that states what the product does, who it is for, and offers Create account / Sign in within seconds.
- [ ] Public Home contains no fictional metrics, proof, testimonials, readiness scores, or unsupported AI claims.
- [ ] Auth redirects and protected views remain secure; unauthenticated protected requests preserve a sanitized `next` path.
- [ ] Authenticated journey reads Home → setup → interview room → truthful completion → Home/Progress.
- [ ] Navigation labels and active state are usable on desktop and mobile without hover-only essential information.
- [ ] Warm-up prompt remains optional, rotating locally, and is not mistaken for a second interview CTA.
- [ ] Authenticated Home has no fictional or duplicated progress/history metrics and retains a clear **View progress** link to the existing Progress view.
- [ ] ENG-29 does not modify or duplicate Progress metrics, loading/error/empty states, session table, copy, or layout; those states remain owned by ENG-32.
- [ ] Setup validation, room status, truthful saved/degraded completion copy, and Kokoro audio fallback remain intact.
- [ ] Existing microphone capture, permission behavior, and local voice-answer flow remain intact; no new avatar, camera, microphone, persistence, analytics, or backend integration work is introduced.
- [ ] No gradients, heavy shadows, generic bento/card grids, or decorative avatar visuals are introduced.
- [ ] Light/dark tokens maintain AA contrast; focus indicators and touch targets are present.
- [ ] Reduced-motion mode preserves hierarchy and status without animated transforms.
- [ ] Responsive checks pass at 390px, 768px, and 1440px with no horizontal overflow.
- [ ] `npm run lint` and `npm run build` pass after implementation.

## Explicit approvals / assumptions

No product decisions are intentionally left open in this direction. The following are explicit scope boundaries that should be approved if ENG-29 proposes to cross them: replacing the English UI with Portuguese, making `/` auth-only again, changing protected-route security or `next` sanitization, adding data/persistence or AI feedback claims, modifying Progress (owned by ENG-32 after ENG-31), changing Kokoro playback behavior, adding avatar/camera/microphone surfaces, or introducing a new brand/font asset pipeline.
