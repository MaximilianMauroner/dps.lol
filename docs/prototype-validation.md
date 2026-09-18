# Prototype validation record

This document records the bounded private prototype validation for the current revision. It is
updated after each data/deployment checkpoint; it does not claim in-game or statistical validation.

## Shipped path

- Attacker: Yunara, patch `26.18`, Data Dragon `16.18.1`.
- Builds: Kraken + Runaan + Berserker’s Greaves + IE versus the same core + LDR.
- Target retrieval is a separate authenticated `/api/cohort` request. Filter changes fetch one
  deterministic, bounded, sanitized cohort; level/build/action/duration changes reuse it in a
  module Web Worker. Summary comparisons omit per-row events; the selected actual target alone gets
  a detailed trace.
- Default target semantics are mortal. Applied damage caps at target HP, overkill is separate,
  fixed-window double kills tie, and TTK reports first expected-damage crossing with explicit
  censored/not-killed outcomes.
- Raw match and timeline responses are archived before extraction in the private Railway bucket;
  Postgres stores typed hot snapshots, items, scenario rows, manifests, and ingestion state.
- The level-first UI retrieves a same-match/frame enemy cohort for the selected Yunara level. Common
  skill ranks are derived only from the Yunara participant ID associated with each archived match;
  other participants' `SKILL_LEVEL_UP` events are ignored. When archives/events are unavailable,
  the UI labels a legal fallback instead of presenting it as observed.

## Access and deployment

Final Railway deployment: `de6afd37-dfa7-4df7-83bd-f1bc64f0412e` (`SUCCESS`, source revision
`9b4a59f`). The private HTTPS
test URL is `https://web-production-25228.up.railway.app/`. Login is server-side and unauthenticated
page/API requests must redirect or return `401`; the password is in ignored `.prototype-access` and
can be copied with `tr -d '\n' < .prototype-access`.

The web service has `NEXT_TELEMETRY_DISABLED=1`, a bounded idle DB pool, and no recurring ingestion;
`sleepApplication: true` is applied to this new web deployment. Postgres remains warm with
`sleepApplication: false` because sleep/wake/reconnect recovery was not safely verified. The Railway
bucket remains private; raw archive downloads are not routed through the browser.

## Data manifest

Values below are measured from the deployed prototype after the bounded ingestion run. Distinct
matches and target snapshots are intentionally reported separately; exact Yunara, bot-carry, and
minute-window phases are not merged or relabelled.

| Measure                                           |                 Value |
| ------------------------------------------------- | --------------------: |
| Patch / Data Dragon                               |   `26.18` / `16.18.1` |
| Ranked region / queue                             |             EUW / 420 |
| New-match ceiling / request ceiling               |         1,000 / 5,000 |
| Accepted current-patch matches / legacy row       |             1,139 / 1 |
| Verified source archives / bucket objects         |         1,139 / 1,141 |
| Exact Yunara matches / deduped level observations |           324 / 3,878 |
| Same-frame enemy vectors (compact hot rows)       |                19,390 |
| Bot-carry fallback matches / target vectors       |           839 / 6,955 |
| Minute-window matches / target vectors            |           774 / 3,870 |
| Legacy rows (pre-original-archive)                | 1 initial smoke match |

Archive bytes from the 1,139 verified original match-plus-timeline objects are 82,610,303 compressed
bytes (82.61 MB); the two pinned static archives add 130,993 bytes. Postgres measured 50,501,311
bytes (50.50 MB). The old reconstructed ~24 KB sample is not used as a complete-source size
estimate. A one-match byte count or the local engine-only timing is not a browser/Web Worker/end-to-end
benchmark.

Compact projection reads are the production path: `level_observations`/`level_targets` drive the
level-aware progression and same-frame cohorts, while `hot_scenario_samples` drives phase cohorts.
The SQL adapters retain an explicit dense-table fallback for a corpus with no compact projection;
the settled current-patch aggregates above intentionally exclude the prior 117-match dense-only
rows so they cannot overweight the new corpus. The one pre-archive smoke row remains labelled
legacy and is never treated as a complete original source archive.

The bounded current-window collection used Match-V5 `startTime=1788912000` (2026-09-09 00:00:00
UTC), `queue=420`, and exact `16.18` detail validation. It stopped at the global ceilings with no
worker/tunnel left running. The 1,139-match corpus is an enriched exploratory sample: Yunara-heavy
PUUID expansions were prioritized before general high-elo seeds, so it is not an unbiased population.
Exact Yunara, bot-carry, and minute-window phases remain separate and are never presented as a
single representative population.

## Checks

The required local checks are:

```bash
bun run format:check
bun run lint
bun run typecheck
bun test
bun run build
```

The tests cover current 2.0/2.3 crit values, mitigation and negative resistance, LDR Giant Slayer
0/500/1000/1500+ bonus-health bands, mortal overkill and same-build ties, valid finite-target TTK
winner/censoring, legal attack readiness, Q five-second/R fifteen-second boundaries, chronological
inventory and undo, missing static HP, bounded minute anchors, event/frame provenance, archive
envelope replay, and summary/trace equality.

The focused suite also covers level-anchor dedupe/weights, legal skill breakpoints, Yunara-only
archived skill-event filtering, and the explicit identical-build result state. Current run:
**42 tests / 144 assertions**, with format, lint, typecheck, and production build passing.

Browser acceptance is performed on the HTTPS deployment with the T3 preview or local Playwright:

1. Open the URL unauthenticated and confirm redirect to `/login`; request `/api/cohort` without the
   session and confirm `401`.
2. Log in using the ignored local password file; confirm the cookie is HttpOnly/Secure/SameSite in
   production and the UI shows provenance/counts/warnings.
3. Run the realistic cohort comparison, switch IE/LDR and duration/build inputs, and confirm no
   new cohort request occurs while the worker recomputes.
4. Switch to manual target, vary armor and bonus HP, run again, and inspect the selected-target
   trace, capped overkill, source split, TTK censoring, and breakpoint grid.
5. Select a different actual target and confirm only the trace changes while the cohort counts stay
   fixed.
6. Reload after a cold/restarted web process; confirm the app uses Railway data rather than local
   files or a dev server.

Evidence for this revision: authenticated headless Chromium/CDP checks against the HTTPS deployment
returned `401` for unauthenticated progression/cohort requests, then rendered the current compact
corpus at levels 10/13/16 (`266/207/88` distinct matches and `1,330/1,035/440` available vectors).
The browser showed timeline-derived skill ranks Q5/W4/E1/R1, Q5/W5/E2/R2, and Q5/W5/E4/R3; level-13
defaults used the full three-item Infinity Edge + Yun Tal Wildarrows + Runaan's Hurricane core.
Forcing three legendaries at level 10 showed `2 of 266` observed states at ≥3 (0.75%); changing a
build slot, combo preset, and Yun Tal stack input changed the result with zero new cohort requests.
Typing a target champion caused zero requests until Apply (one request), level changes fetched new
progression/cohort data, and manual target mode plus the selected-target trace rendered successfully.
The initial identical-build result explicitly says to change an item; it is not treated as a build
recommendation. The archive replay check rebuilt 330 derived snapshots from one verified original
source envelope without changing production rows. These are prototype checks; a full idle sleep/wake
cycle was not run, and target samples do not prove in-game mechanic exactness.

## Known gaps

The corpus is exploratory and selected from high-elo seeds; it is not a representative population.
More matches validate the target distribution, not the combat engine. Yunara’s Runaan bolts, E,
runes, shields, resist buffs/debuffs, champion-specific temporary defenses, exact animation windups,
and non-Yunara plugins remain unsupported. Historical cold filters would need an asynchronous archive
rebuild. No source pruning is enabled until checksum restore/rebuild equivalence is tested.
