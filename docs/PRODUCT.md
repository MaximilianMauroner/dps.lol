# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

High-elo ADC players who want to know the ideal build: on average, against the
average champion, which build wins, plus the ability to ask the same question
against team-comp archetypes (HP-heavy, armor-heavy, MR-heavy). Desktop lab
tool; dense data tables are fine. Mobile is not a priority.

## Product Purpose

Rift Delta is a patch-pinned League of Legends damage lab. It answers "which
build outputs the most DPS" with an inspectable expected-value simulator plus
observed target cohorts from real matches. Starting focus: DPS within 20s (long
teamfights) and within 3s and 5s (quick trades). Success is a high-elo ADC
locking a build faster, with numbers they can trace to a formula or a match
snapshot.

## Positioning

A transparent lab, not an opinion guide: every number traces to a published
formula or an observed match snapshot, pinned to one patch, with limitations
surfaced in the UI instead of hidden. Neighboring build guides give
recommendations; Rift Delta shows its work.

## Operating Context

Pre-game and post-patch build study at a desktop. Workflow: pick attacker
setup (level, ability ranks, opener), pick target question (average champion
vs. HP/armor/MR-heavy cohorts vs. one observed target), compare two builds
across 3s / 5s / 20s windows, inspect the damage trace. Users re-run often
with small changes; cached cohorts and fast local recompute matter.

## Capabilities and Constraints

- Shipped vertical slice: Yunara on patch 26.18 (Data Dragon 16.18.1).
- Core: Kraken Slayer + Runaan's Hurricane + Berserker's Greaves; third-item
  question is Infinity Edge vs Lord Dominik's Regards.
- Engine: deterministic expected-crit model, mortal-target death/overkill
  semantics, match-balanced cohort comparison, selected-target damage trace.
- Known limits surfaced as warnings: expected (not probabilistic) crits, E is
  mobility-only, Runaan's bolts excluded single-target, no runes/shields/resist
  buffs/CC, builds compared at listed cost not equal gold.
- Without a database the app uses clearly labelled fixture/demo targets; never
  fabricate Riot provenance.
- Private tester prototype: server-side password gate; Riot key, database URL,
  and secrets stay server-side.
- Redesign scope (user-authorized): layout, hierarchy, and panels may be
  rethought freely. Simulator truth, provenance labels, warnings, and all
  controls' function must be preserved. Desktop-first.
- Windows to support: 3s, 5s, 20s comparison metric.

## Brand Commitments

Name "Rift Delta" stays. No binding visual identity, palette, or typeface; the
incumbent dark lab look is evidence only and may be replaced. Riot trademark
disclaimer footer must stay.

## Evidence on Hand

- Working Next.js app in `src/app/` (page, login, gated API routes).
- Data Dragon item/champion icons via CDN (`src/app/page.tsx` ICON base).
- Cohort API (`/api/cohort`) plus fixture fallback; `docs/realistic-targets.md`
  and `docs/storage-architecture.md` describe data semantics.
- No marketing copy, testimonials, or brand assets exist; do not invent any.

## Product Principles

1. Decision first: the winning build and by how much lead every view.
2. Trace everything: headline, cohort, and trace stay one click apart.
3. Honest about uncertainty: sample size, provenance, and model limits are
   content, not footnotes.
4. Patch-pinned: numbers belong to exactly one patch and say so.
5. Fast iteration: small setup changes re-run without ceremony.
