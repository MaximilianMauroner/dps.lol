# Patch-pinned mechanics notes

Static values are synced from [Data Dragon 16.18.1](https://ddragon.leagueoflegends.com/cdn/16.18.1/data/en_US/). Data Dragon has names, stats, recipes, tags, and tooltips but does not encode every combat interaction. Where it does not, the implementation cross-checks [CommunityDragon 16.18 game data](https://raw.communitydragon.org/16.18/game/data/characters/yunara/yunara.bin.json) and the public [League Wiki Yunara page](https://wiki.leagueoflegends.com/en-us/Yunara). These are references for independent formulas, not copied source or assets.

## Mitigation and penetration

For positive resistance, damage multiplier is `100 / (100 + resistance)`. For negative resistance it is `2 - 100 / (100 - resistance)`. LDR’s 35% bonus armor penetration is applied to armor before physical mitigation. Percentage penetration is clamped to `[0, 1]`; flat penetration is not yet in the MVP.

## Expected critical strikes

The expected basic-attack physical component is:

```text
total AD × (1 + critChance × (critMultiplier − 1))
```

Patch 26.18 uses the global **200%** critical-damage baseline introduced in [Patch 26.1](https://www.leagueoflegends.com/en-us/news/game-updates/patch-26-1-notes/). Infinity Edge adds 30 percentage points, so the pinned engine uses 2.30x with IE and 2.00x without it. Yunara’s Vow of the First Lands adds a separate magic event equal to 10% of the pre-mitigation critical-strike damage, weighted by crit chance (AP scaling is zero in this MVP). This is why the debug trace shows both a physical attack and a magic passive event.

## Items

- **Infinity Edge:** 75 AD, 25% crit, +30% crit damage.
- **Lord Dominik’s Regards:** 35 AD, 25% crit, 35% armor penetration. Giant Slayer multiplies damage by `1 + min(0.15, bonusHealth / 10,000)`, i.e. 0/5/10/15% at 0/500/1000/1500+ bonus health.
- **Kraken Slayer:** 45 AD, 40% AS. Bring It Down triggers on every third attack. Its patch-26.18 ranged base is `0.8 × (150 at level 1–8, +5 per level through 200)` and increases by 0–75% with target missing health. The engine uses this as an expected deterministic proc, not a random roll.
- **Runaan’s Hurricane:** 40% AS, 25% crit. The two extra bolts and their on-hit effects are excluded when the scenario has one target; the UI explicitly warns about this.
- **Berserker’s Greaves:** 30% AS.

## Yunara MVP path

The patch data gives Yunara 55 base AD, 3 AD/level, 0.65 base AS, and 2% AS/level. Q rank 1–5 supplies 20–60% AS and 5/10/15/20/25 (+20% AP) passive magic on-hit; the pinned CommunityDragon 16.18 `Buff_Duration` is 5 seconds, and while active Q adds the same amount again. W’s initial damage is magic, with a base of 55/95/135/175/215 plus 85% bonus AD; one representative 60% lingering magic tick is emitted. During R, W is upgraded to a 160/320/480 rank-1/2/3 magic hit plus 120% bonus AD. R’s modeled state lasts 15 seconds and activates Q’s on-hit/attack-speed state for that window. E is a mobility spell and has no damage event.

Yun Tal Wildarrows (3032) is pinned to 50 AD, 45% AS, and 0% base crit in Data Dragon
[16.18.1](https://ddragon.leagueoflegends.com/cdn/16.18.1/data/en_US/item.json). The pinned
[CommunityDragon item data](https://raw.communitydragon.org/16.18/game/data/items/3032.bin.json)
confirms ranged Practice Makes Lethal: each basic attack grants 0.2 percentage points of crit
chance, up to 125 stacks (25 percentage points). Flurry grants 30% bonus AS for 6 seconds, has a
30-second cooldown, and is reduced by 1 second per basic attack or 2 seconds per critical attack.
Because this engine averages expected crits rather than sampling rolls, it applies an expected
`1 + critChance` seconds of cooldown reduction per on-hit. Stored Match-V5 `championStats` do not
expose Yun Tal stacks or crit chance, so the initial stack count is an explicit 0–125 user
assumption (0 by default), not a telemetry-derived state.

## Timing, target death, and comparison semantics

Scripted basic attacks use the current attack-readiness interval, including Q attack speed, rather
than a fixed quarter-second interval. A 0.25-second scripted action lock is retained as an explicit
approximation; champion-specific windups, cancels, and attack resets are unsupported and surfaced in
the warning list. Mortal mode is the default: once applied damage reaches target max health, later
events are not applied, the final event is capped, and overkill is reported separately. Fixed-window
comparisons treat two kills as a tie because both applied the same target HP. TTK comparisons use the
first expected-damage crossing time; an uncensored kill beats a censored (not-killed) result, two
censored results are reported as censored, and the value is not a kill probability. An explicit
training-dummy/uncapped mode exists for engine diagnostics only and is never presented as TTK.
Across a cohort, each row contributes its match-balanced sample weight to the A-win, B-win, tie, or
censored bucket. The headline and decisive win bar compare weighted A/B mass; ties and censored mass
are neutral, and equal weighted A/B mass is shown as a tie rather than being assigned to LDR.

The engine keeps these mechanics in `src/domain/champions/yunara.ts` behind `ChampionPlugin`; future plugins can add more complete spell scheduling without changing mitigation, targets, or comparison aggregation.
