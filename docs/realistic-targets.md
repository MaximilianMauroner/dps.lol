# Realistic target snapshots

Synthetic “2,000 HP / 100 armor” targets are useful for a unit test but poor answers to a build question. Rift Delta therefore stores the observations exposed by Match-V5 timelines and lets a simulation run across the resulting distribution.

## What is persisted

For each frame (normally one per minute), the app stores patch/game version, region, queue, match ID, participant/champion/team/role, timestamp/minute, level, total/current gold, and the `championStats` values supplied by Riot: `healthMax`, `armor`, `magicResist`, `attackDamage`, `attackSpeed`, and `abilityPower` when present. `snapshot_items` stores the reconstructed inventory at that exact timestamp.

The timeline is the source of truth for target defenses. Data Dragon contributes the patch-pinned champion base HP and HP growth used to estimate:

```text
bonusHealthEstimate = max(0, actual healthMax - baseHPAtLevel)
```

The clamp prevents a noisy or incomplete snapshot from creating negative bonus health. Temporary max-HP effects, runes, buffs, and mode-specific modifiers can make this estimate noisy; the UI and docs intentionally call it an estimate.

## Inventory and completed items

Events are replayed in timestamp order. Purchases append an item, sales and destruction remove one instance, and `ITEM_UNDO` removes `beforeId` and restores `afterId`. Completed legendary classification uses Data Dragon’s Summoner’s Rift map flag, purchasability, recipe (`from` present and `into` empty), total cost, and excludes boots, consumables, trinkets, gold-generation/support intermediates, and known utility IDs. This is deliberately conservative and can be refined with patch-specific item metadata.

## Third-item timing

During ingestion, a Yunara participant is the preferred anchor. The first frame where her reconstructed inventory contains three completed legendaries is the “Yunara third-item” timestamp; all enemy participants’ snapshots at that frame become scenario samples. If there are no exact Yunara anchors, the same logic uses bottom/carry participants and marks fallback level 1. Every ingested match also gets a `minute-window` anchor at the nearest frame to `SCENARIO_MINUTE` (25 by default), which is fallback level 2 when item timing is unavailable. If the database has no matching rows, the app reports no live sample rather than labeling fixture values as Riot data. The UI displays phase, fallback level, sample count, and provenance.

Filters currently include platform region, enemy role, and target champion. A target distribution is summarized with p25, median, and p75 for HP, estimated bonus HP, armor, MR, level, and game minute. Results also include per-role win rates when there are at least two observations in that role.

The ingestion command defaults to EUW ranked solo queue and high-elo league endpoints, deduplicates match IDs, observes retry-after headers, and writes run progress. It is safe to rerun: match IDs, snapshots, items, and scenario samples have unique keys/upserts.
