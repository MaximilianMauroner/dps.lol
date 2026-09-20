# Realistic target snapshots

Synthetic “2,000 HP / 100 armor” targets are useful for a unit test but poor answers to a build question. dps.lol therefore stores the observations exposed by Match-V5 timelines and lets a simulation run across the resulting distribution.

## What is persisted

For each frame (normally one per minute), the app stores patch/game version, region, queue, match ID, participant/champion/team/role, timestamp/minute, level, total/current gold, and the `championStats` values supplied by Riot: `healthMax`, `armor`, `magicResist`, `attackDamage`, `attackSpeed`, and `abilityPower` when present. `snapshot_items` stores the reconstructed inventory at that exact timestamp.

The timeline is the source of truth for target defenses. Data Dragon contributes the patch-pinned champion base HP and HP growth used to estimate:

```text
bonusHealthEstimate = max(0, actual healthMax - baseHPAtLevel)
```

The clamp prevents a noisy or incomplete snapshot from creating negative bonus health. If the pinned champion row is missing, `bonus_health_estimate` is NULL with `missing-static` status and the row is excluded from precise target cohorts; observed HP is never relabelled as bonus health. Temporary max-HP effects, runes, buffs, and mode-specific modifiers can make this estimate noisy; the UI and docs intentionally call it an estimate.

## Inventory and completed items

Events are replayed in timestamp order. Purchases append an item, sales and destruction remove one instance, and `ITEM_UNDO` removes `beforeId` and restores `afterId`. Completed legendary classification uses Data Dragon’s Summoner’s Rift map flag, purchasability, recipe (`from` present and `into` empty), total cost, and excludes boots, consumables, trinkets, gold-generation/support intermediates, and known utility IDs. This is deliberately conservative and can be refined with patch-specific item metadata.

## Third-item timing

During ingestion, a Yunara participant is the preferred anchor. The first frame where her reconstructed inventory contains three completed legendaries is the “Yunara third-item” sample frame; the purchase/undo event that crossed the third-item boundary is retained separately as `anchor_event_timestamp_ms`, with frame distance recorded. All **enemy-team** participants’ snapshots at that selected frame become scenario samples. If there are no exact Yunara anchors, the same logic uses bottom/carry participants and marks fallback level 1. Every ingested match can get a `minute-window` anchor only when a frame is within the configurable `SCENARIO_MINUTE_TOLERANCE` (2 minutes by default) of `SCENARIO_MINUTE` (25 by default); a short game is never silently presented as a minute-25 sample. If the database has no matching rows, the app reports no live sample rather than labeling fixture values as Riot data. The UI displays phase, fallback level, event/frame provenance, sample count, and source patch/time range.

Filters currently include platform region, enemy role, target champion, and directly seeded rank. Retrieval uses a deterministic hash order, caps nearby snapshots per match, and exposes both available and returned counts. Match-balanced weights preserve complete joint target vectors while preventing long matches from dominating; weighted p25/median/p75 summaries use the same weights as comparison aggregation. Results also include per-role win rates when there are at least two observations in that role. A selected actual vector gets a detailed trace; cohort rows remain summary-only.

Before any extraction, the ingestion command archives the original match and original timeline responses in the private bucket with a content-addressed checksum manifest. The hot `matches.raw` field for new rows is only an archive pointer; the earlier smoke row is explicitly legacy because its original timeline was not retained. The command defaults to EUW ranked solo queue and high-elo league endpoints, deduplicates match IDs, observes retry-after headers, and writes run progress. It is safe to rerun: match IDs, snapshots, items, and scenario samples have unique keys/upserts. No pruning is enabled.
