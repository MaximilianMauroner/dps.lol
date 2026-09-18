# Design

<!-- impeccable:design-schema 1 -->

## World

Rift Delta is a desktop damage-lab instrument in the register of modern LoL
stat products (dpm.lol token system, user-pinned): soft dark surfaces, rounded
everything, one chemtech-teal decision accent, Inter with tabular numerals.
The answer leads, the setup stays reachable beside it, and provenance and
limits are content, never footnotes. Dark is picked from the use scene:
pre-game build study at a desktop, often at night, dense data held for minutes.

The lab names the question by what actually differs. When each build holds one
item the other does not, every label is that item ("Infinity Edge vs Lord
Dominik's Regards"), not the repeated shared core.

## Tokens

- Ground `--bg #131619`, header `#0d0f10`, widget `#1a1d21`, inset inputs
  `#22262c`, hairline `rgba(255,255,255,.09)`.
- Text `#ffffff` / `#e8e9e9` / `#9b9c9e` (body and placeholder ≥ 4.5:1). Prose
  runs at 13px in `--t2`; 11–12px `--t3` is for labels and notes only.
- Accent chemtech teal `--acc #34d3bd` (user-picked): side A, the leading
  build, primary fill with `--acc-ink #052e29`, rings `rgba(52,211,189,.5)`.
  Ice `#a1e4f9` is side B everywhere: win bar remainder, window tiles, draft
  bars, breakpoint heat. Gold `#ffdc75` for patch, provenance caution and the
  Read callout. Red `#f7665e` is reserved for errors and destructive hover; a
  leading build is never coloured like a fault.
- Type Inter (user-pinned dpm register; detector overused-font warning
  explicitly dispensed), tabular numerals on all numbers, headings −0.02em,
  `text-wrap: balance` on the question.
- Radius 12px cards, 8–10px controls, pills for status. Elevation is border or
  offset soft shadow, never both except the verdict band
  (`0 16px 40px rgba(0,0,0,.45)`). No gradient text, no colored edge bars, no
  nested cards.

## Composition

Two columns at up to 1400px: a sticky 296px setup rail and the result board.

- Rail: attacker (level, ability ranks, Yun Tal stacks), opener (presets,
  sequence, after-the-opener, custom fight length), target (mode, region, rank,
  role, timing, champion apply, manual stat entry, metric), live status with a
  manual re-run. Nothing needs a scroll to change.
- Board: verdict band → head to head + draft slices → folded trace, evidence
  and model limits → disclaimer footer.
- The verdict band answers all four fight lengths at once as clickable tiles
  (2s/5s/10s/20s, plus a tile for a custom length), states the weighted win
  share, carries one "Read" sentence that names the disagreement between the
  headline and the heavy drafts, and shows the breakpoint map beside it.
- The breakpoint map is a heat grid of applied damage difference. Its leading
  no-difference region collapses into one labelled row; when nothing differs
  anywhere the grid is replaced by a sentence.
- Head to head is one diff table (A, B, Δ) with the items under test as selects
  above it and the shared core in a fold. Editing a shared item edits both
  builds; builds that differ by more than one item stay fully editable.
- All simulator inputs auto-recompute from the cached cohort (280ms debounce);
  champion text commits via Apply/Enter.

## States and motion

One authored motion: the cohort win-bar eases
(`cubic-bezier(0.22,1,0.36,1)`, disabled under reduced-motion).

- First load seeds the observed level core against Infinity Edge and Lord
  Dominik's Regards, so the first screen is a real answer.
- Identical builds replace the verdict with one notice, a reset action and up to
  three alternative items; draft slices are hidden rather than printed as zeros.
- A damage window in which both builds kill every target reads "Both kill · use
  TTK instead" with a Switch to TTK action, not a tie. A TTK window with no
  kills reads "No kills yet".
- Recomputing keeps the previous numbers on screen and marks the band
  "recomputing…"; errors clear the result and name the fix.
- Provenance badge (Riot green / fixture gold) sits in the header and the trace
  fold. Model limits are grouped into damage model and comparison rules, with
  the page-authored duplicates of engine warnings removed.

## Provenance

- Direction: exploration rd1 (`./.agents/artifacts/design/rd1/`, git-excluded).
  Round 1: baseline → A/B/C/D rejected → E in the user-pinned dpm.lol register →
  teal accent → implemented. Round 2 (hierarchy and readability): F/G/H → user
  combined H + G into I and J → I chosen → I1 (band tuned) chosen → first-load
  and folded-panel states designed → built.
- Detector findings on the build: Inter warning (dispensed by the pin) and one
  width-transition warning (kept as the single authored motion).
- Mock numbers in `rd1/*.html` are illustrative and were taken from real runs;
  the app computes everything live. No invented claims ship.
