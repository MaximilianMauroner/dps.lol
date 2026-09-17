# Patch-pinned mechanics notes

Static values are synced from [Data Dragon 16.18.1](https://ddragon.leagueoflegends.com/cdn/16.18.1/data/en_US/). Data Dragon has names, stats, recipes, tags, and tooltips but does not encode every combat interaction. Where it does not, the implementation cross-checks [CommunityDragon 16.18 game data](https://raw.communitydragon.org/16.18/game/data/characters/yunara/yunara.bin.json) and the public [League Wiki Yunara page](https://wiki.leagueoflegends.com/en-us/Yunara). These are references for independent formulas, not copied source or assets.

## Mitigation and penetration

For positive resistance, damage multiplier is `100 / (100 + resistance)`. For negative resistance it is `2 - 100 / (100 - resistance)`. LDR’s 35% bonus armor penetration is applied to armor before physical mitigation. Percentage penetration is clamped to `[0, 1]`; flat penetration is not yet in the MVP.

## Expected critical strikes

The expected basic-attack physical component is:

```text
total AD × (1 + critChance × (critMultiplier − 1))
```

The global baseline used for patch 26.18 is 175% critical damage. Infinity Edge adds 30 percentage points. Yunara’s Vow of the First Lands adds a separate magic event equal to 10% of the pre-mitigation critical-strike damage, weighted by crit chance (AP scaling is zero in this MVP). This is why the debug trace shows both a physical attack and a magic passive event.

## Items

- **Infinity Edge:** 75 AD, 25% crit, +30% crit damage.
- **Lord Dominik’s Regards:** 35 AD, 25% crit, 35% armor penetration. Giant Slayer multiplies damage by `1 + min(0.15, bonusHealth / 10,000)`, i.e. 0/5/10/15% at 0/500/1000/1500+ bonus health.
- **Kraken Slayer:** 45 AD, 40% AS. Bring It Down triggers on every third attack. Its patch-26.18 ranged base is `0.8 × (150 at level 1–8, +5 per level through 200)` and increases by 0–75% with target missing health.
- **Runaan’s Hurricane:** 40% AS, 25% crit. The two extra bolts and their on-hit effects are excluded when the scenario has one target; the UI explicitly warns about this.
- **Berserker’s Greaves:** 30% AS.

## Yunara MVP path

The patch data gives Yunara 55 base AD, 3 AD/level, 0.65 base AS, and 2% AS/level. Q rank 1–5 supplies 20–60% AS and a 10–30 + 20% total-AD on-hit. W’s base damage is 55/95/135/175/215 plus 85% bonus AD; one representative 60% lingering tick is emitted. During R, W is upgraded to a 160/320/480 rank-1/2/3 magic hit plus 120% bonus AD. R also activates the Q state for the simulation window. E is a mobility spell and has no damage event.

The engine keeps these mechanics in `src/domain/champions/yunara.ts` behind `ChampionPlugin`; future plugins can add more complete spell scheduling without changing mitigation, targets, or comparison aggregation.
