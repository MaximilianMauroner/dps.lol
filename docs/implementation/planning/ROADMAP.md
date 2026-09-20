# dps.lol implementation roadmap snapshot

This is the P00-local planning snapshot of the reviewed GitHub requirements. The current issue
bodies are authoritative; linked HTML microplans are historical and cannot override them.

- Repository: [MaximilianMauroner/dps.lol](https://github.com/MaximilianMauroner/dps.lol)
- Roadmap: [issue #3](https://github.com/MaximilianMauroner/dps.lol/issues/3)
- Roadmap body revision observed: `2026-09-18T20:10:48Z`
- P00: [issue #4](https://github.com/MaximilianMauroner/dps.lol/issues/4)
- P00 body revision observed: `2026-09-18T20:10:12Z`
- Audited implementation baseline: `f2747db43ca89d12338982b0e7ed2f700ee2b591`
- Audited source tree: `c009c80956c8eb844dbbd8e75f6c820b89530d2b`
- Ruleset scope: League PC patch `26.18`, Data Dragon `16.18.1`; later patches are separate
  immutable rulesets.

## Product goal retained by the roadmap

dps.lol is a complete, patch-versioned League theorycrafting system, not a curated Yunara
calculator. The final product must model combat-relevant champion, ability, passive, item, rune,
summoner, buff, debuff, defensive, utility, environmental and mode mechanics and their
interactions. It must support realistic match-derived scenarios, legal complete item-combination
search through one reusable combat engine, explicit burst/fixed-window/sustained-DPS/TTK
objectives, reproducible traces and explanations. Yunara on standard Summoner's Rift is the first
engine migration proof, not the final content scope.

P00 is only the baseline/planning gate. It records provenance, characterization and dispatch
contracts; it does not implement the later shared engine, content fan-out, storage migration,
worker migration or UI rewrite.

## Authority and scope decisions

The reviewed issue bodies supersede historical linked plans. P02 must pin the complete PC
patch/hotfix, mode/queue map and required content IDs from retained artifacts and a reviewed
manual inventory. P02 later owns content-task and content-manifest generation. P14, P15 and P17
are fan-out coordinators, not shortcuts around that inventory. A catalog may track unimplemented
mechanics, but combat-complete certification cannot pass while material mechanics are missing.

The shared engine is the single execution authority. Actions, future ticks, projectile impacts,
resource changes, cooldowns, triggers, survival and explanations must resolve in chronological
event order with causal lineage. Analytical expectation, average-state approximation, seeded
trajectories and sampled estimates remain distinct numerical modes. Search certificates must
separate exact exhaustion, safe pruning, failures, partial work and independent finalist
validation. Observed effective target stats must not be double-counted with reconstructed
loadouts.

## Dispatch order

1. Complete P00, then freeze shared contracts and migration boundaries in P01.
2. After P01 acceptance, dispatch P02, P03, P04 and P23 independently.
3. Dispatch P05, P06, P07, P12 and P18 as their prerequisites land; P19 and P20 follow their
   direct dependencies.
4. Integrate P08, P09, P10 and P11 through the shared services; do not create parallel simulators.
5. Port the initial items in P13, prove the reusable engine with Yunara in P16, then fan out P14,
   P15 and P17 from the P02 inventory.
6. Deliver P21, P22, P24, P25 and P26 as their dependencies permit.
7. Close full content and interaction coverage in P27, measure scale in P28, integrate in P29 and
   make separate operational/release decisions in P30.

The machine-readable parent graph, issue revision metadata and ownership scopes are in
[`TASKS.json`](TASKS.json). Each parent work order is in [`work-orders/`](work-orders/), and the
P02 child template is [`CONTENT-WORK-ORDER.md`](CONTENT-WORK-ORDER.md).

## Shared acceptance scenarios

| ID  | Invariant                                                                                   | Primary owners     |
| --- | ------------------------------------------------------------------------------------------- | ------------------ |
| A01 | A future W tick cannot damage or kill before an earlier eligible attack.                    | P04, P08, P16      |
| A02 | Cooldown waits execute only the actions permitted by policy.                                | P06, P08           |
| A03 | Windups, resets, travel, collision and control change delivered actions.                    | P07-P10            |
| A04 | Shields, healing, cleanse, death and revival can change rankings and TTK.                   | P09, P13-P17, P21  |
| A05 | Multi-target effects respect eligibility, ownership and one-hit rules.                      | P07, P10, P14-P19  |
| A06 | Legal synergies survive exhaustive search even when partners are weak alone.                | P20, P21           |
| A07 | Locked inventory, components, budgets, upgrades and sales produce legal purchase sequences. | P12, P20, P24      |
| A08 | Rare low-level builds remain selectable with an evidence/rank explanation.                  | P19, P23, P24      |
| A09 | Selected results transfer exact scenario, policy, cohort, randomness, hash and score.       | P21-P26            |
| A10 | Exact, approximate and seeded/sample results are labeled distinctly.                        | P11, P21, P24      |
| A11 | Cohort filtering preserves joint vectors and declared match weighting.                      | P18, P19           |
| A12 | Cancel/resume/replay cannot publish stale or partial work as complete.                      | P20-P22, P26, P28  |
| A13 | Sanitized replay uses retained ruleset/engine/cohort bytes, not current data.               | P11, P26           |
| A14 | Every required content mechanic and transitive dependency has implementation/evidence.      | P02, P14-P17, P27  |
| A15 | Archive verification failure blocks publication; isolated restore preserves data.           | P18, P26, P29, P30 |
| A16 | The complete choose-state -> lock -> optimize -> inspect flow uses real adapters.           | P24, P25, P29      |

## Proposed performance targets

These are engineering targets to be measured by P22/P28 on recorded reference hardware, not
baseline successes or delivery promises:

- p95 control acknowledgement below 100 ms;
- progress updates at least every 250 ms while active;
- cancellation acknowledgement within 250 ms;
- an initial 256 MiB per-worker benchmark budget, with shared/cohort memory accounted separately;
- measured candidate throughput, trace-load latency, peak memory, query/storage growth and
  generation cost across the agreed matrix.

## Release and data boundaries

Implementation, empirical validation, data readiness and deployment authorization are separate
statuses. Production ingestion, migrations, retention changes, deployment, paid services and
external release claims require their own authorization. Replay files are validated data, never
an authority to execute imported code. The private archive remains archive-first and immutable;
Postgres remains the hot searchable index; sanitized bounded cohort packs are the warm simulation
working set. The archive is not a Postgres backup.
