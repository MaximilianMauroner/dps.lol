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

Final Railway deployment: update after the current compact-query deployment (`SUCCESS`). The private HTTPS
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

| Measure                                        |                                  Value |
| ---------------------------------------------- | -------------------------------------: |
| Patch / Data Dragon                            |                    `26.18` / `16.18.1` |
| Ranked region / queue                          |                              EUW / 420 |
| New-match ceiling / request ceiling            |                          1,000 / 5,000 |
| Accepted current-patch matches / legacy row    |                        1,139 / 1 |
| Verified source archives / bucket objects      |                    1,139 / 1,141 |
| Exact Yunara matches / deduped level observations |                 324 / 3,878 |
| Same-frame enemy vectors (compact hot rows)    |                             19,390 |
| Bot-carry fallback matches / target vectors    |                         839 / 6,955 |
| Minute-window matches / target vectors         |                         774 / 3,870 |
| Legacy rows (pre-original-archive)             |                  1 initial smoke match |

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

The recent-window run used Match-V5 `startTime=1788912000` (2026-09-09 00:00:00 UTC), an `endTime`
just beyond collection time, `queue=420`, and detail validation for `16.18`. It selected 2,000
previously unseen current-window IDs and persisted 89 before its private DB tunnel terminated; the
run was then marked `stopped` and no replacement crawler was left running. Its final per-detail
rejection counters were not written before that failure. Earlier recorded rejection evidence includes
183 old-patch IDs in the pre-window exploratory batch (and 6 short games in the completed first
batch). The database records 1,037 Riot requests across runs with request checkpoints; earlier smoke
runs without a request cursor are conservatively covered by the configured 500-request reserve, and
the global ceiling remains 5,000.

The corpus is therefore an enriched exploratory sample, not an unbiased population: the current run
prioritized PUUIDs of observed Yunara participants before high-elo seeds. Exact anchors meet the
prototype coverage goal (33 distinct matches / 165 complete enemy vectors), while fallback rows are
kept as separate phases.

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
rendered the explicit identical-default explanation, the exact-Yunara level-13 phase (`33 distinct
match(es) · 165 snapshots`), selected-target trace, warnings/provenance panels, and timeline-derived
skill provenance. A level switch incremented `/api/cohort` and `/api/progression`; Build B item edits,
combo presets, and Yun Tal stack edits changed results while the cohort request count stayed fixed.
The checks also exercised manual target mode and unauthenticated page/API gating. The prior browser
run recorded a restarted web process serving the same Railway counts and the archive replay check
rebuilt 330 derived snapshots from one verified original source envelope without changing production rows.
The archive replay check rebuilt 330 derived snapshots from one verified original source envelope
without changing production rows. These are prototype checks; a full idle sleep/wake cycle was not
run, and target samples do not prove in-game mechanic exactness.

## Known gaps

The corpus is exploratory and selected from high-elo seeds; it is not a representative population.
More matches validate the target distribution, not the combat engine. Yunara’s Runaan bolts, E,
runes, shields, resist buffs/debuffs, champion-specific temporary defenses, exact animation windups,
and non-Yunara plugins remain unsupported. Historical cold filters would need an asynchronous archive
rebuild. No source pruning is enabled until checksum restore/rebuild equivalence is tested.
