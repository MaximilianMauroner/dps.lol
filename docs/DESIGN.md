# Design

<!-- impeccable:design-schema 1 -->

## World

Rift Delta is a desktop damage-lab instrument in the register of modern LoL
stat products (dpm.lol token system, user-pinned): soft dark surfaces, rounded
everything, one chemtech-teal decision accent, Inter with tabular numerals.
The verdict leads every view; setup sits below the answer; provenance and
limits are content, never footnotes. Dark is picked from the use scene:
pre-game build study at a desktop, often at night, dense data held for minutes.

## Tokens

- Ground `--bg #131619`, header `#0d0f10`, widget `#1a1d21`, inset inputs
  `#22262c`, hairline `rgba(255,255,255,.09)`.
- Text `#ffffff` / `#e8e9e9` / `#9b9c9e` (body and placeholder ≥ 4.5:1).
- Accent chemtech teal `--acc #34d3bd` (user-picked over the mock's
  periwinkle): winner tag and Run button fill with `--acc-ink #052e29` text,
  rings `rgba(52,211,189,.5)`. Secondary ice `#a1e4f9` for source bars, gold
  `#ffdc75` for patch/cost/provenance caution, up `#dbf7cd`, down `#f7665e`.
- Type Inter (user-pinned dpm register; detector overused-font warning
  explicitly dispensed), tabular numerals on all numbers, headings −0.02em,
  `text-wrap: balance` on the verdict. Monospace only for the debug log.
- Radius 12px cards, 8–10px controls, pills for tags and status. Elevation is
  border or offset soft shadow, never both except verdict/winner
  (`0 16px 40px rgba(0,0,0,.45)`). No kickers, no gradient text, no
  colored edge bars, no nested cards, no blink/chevron decoration.

## Composition

Single centered column (1180px), stacked sections with 26px gaps: verdict →
duel + distribution → draft matrix → setup (attacker / opener / target cards)
→ damage trace → cohort detail → disclaimer footer. Sticky 58px header with
section nav, patch pill, engine status. Fight-length 3s/5s/20s segmented
control lives in the verdict and auto-reruns. The draft matrix rows are live
re-simulations over cohort slices (average + top-third HP/armor/MR), not
illustration. All simulator inputs are preserved and auto-recompute from the
cached cohort (280ms debounce); champion text commits via Apply/Enter.

## States and motion

One authored motion: the cohort win-bar eases
(`cubic-bezier(0.22,1,0.36,1)`, disabled under reduced-motion). Loading
(Calculating… + disabled Run), error alert, empty placeholders, hover,
`focus-visible` teal rings, themed selection/caret/scrollbars. Provenance
badge (Riot green / fixture gold) plus one-line note, dataset coverage, and
the five model warnings stay visible in the trace card.

## Provenance

- Direction: exploration rd1 (`./.agents/artifacts/design/rd1/`, git-excluded):
  baseline → A/B/C/D rejected (mono-everywhere type, sharp edges) → E in the
  user-pinned dpm.lol register → teal accent picked by the user → implemented.
- Detector findings on the build: Inter warning (dispensed by the pin) and one
  width-transition warning (kept as the single authored motion).
- Mock numbers in `rd1/a–e.html` are illustrative; the app computes everything
  live. No invented claims ship.
