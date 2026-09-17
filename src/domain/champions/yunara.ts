import { giantSlayerMultiplier, itemStats, krakenBaseDamage } from "../items";
import { applyPercentArmorPenetration, growthAtLevel, mitigate, round } from "../math";
import type { ChampionPlugin } from "./plugin";
import type { DamageEvent, DamageType, SimulationResult } from "../types";

const BASE_AD = 55;
const AD_GROWTH = 3;
const BASE_AS = 0.65;
const AS_GROWTH = 0.02;
const BASE_CRIT_DAMAGE = 1.75;

type State = { qUntil: number; rUntil: number; attacks: number; targetHealth: number };

function qOnHit(rank: number, totalAd: number): number {
  return [0, 10, 15, 20, 25, 30][rank]! + 0.2 * totalAd;
}

function qAttackSpeed(rank: number): number {
  return [0, 0.2, 0.3, 0.4, 0.5, 0.6][rank]!;
}

export const yunara: ChampionPlugin = {
  id: 804,
  slug: "yunara",
  patch: "26.18",
  simulate(input): SimulationResult {
    const items = itemStats(input.build.itemIds);
    const totalAd = BASE_AD + growthAtLevel(AD_GROWTH, input.level) + items.attackDamage;
    const critChance = Math.min(1, items.critChance);
    const critDamage = BASE_CRIT_DAMAGE + items.critDamage;
    const hasLdr = input.build.itemIds.includes(3036);
    const hasKraken = input.build.itemIds.includes(6672);
    const hasRunaans = input.build.itemIds.includes(3085);
    const targetAmp = hasLdr ? giantSlayerMultiplier(input.target.bonusHealth) : 1;
    const effectiveArmor = applyPercentArmorPenetration(input.target.armor, items.armorPenPercent);
    const state: State = { qUntil: -1, rUntil: -1, attacks: 0, targetHealth: input.target.health };
    const events: DamageEvent[] = [];
    const warnings = [
      "Expected crit mode averages crits; individual attacks are not RNG rolls.",
      "E is mobility-only and intentionally contributes no damage.",
    ];
    if (hasRunaans) warnings.push("Runaan's bolts are excluded from single-target damage.");

    const add = (
      time: number,
      source: string,
      type: DamageType,
      raw: number,
      notes: string[] = [],
    ) => {
      if (time > input.durationSeconds || raw <= 0) return;
      const resistance =
        type === "physical" ? effectiveArmor : type === "magic" ? input.target.magicResist : 0;
      const multiplier = (type === "true" ? 1 : undefined) ?? 1;
      let final = type === "true" ? raw : mitigate(raw, resistance);
      final *= targetAmp;
      if (hasLdr) notes = [...notes, `Giant Slayer ×${round(targetAmp, 3)}`];
      state.targetHealth -= final;
      events.push({
        time: round(time, 3),
        source,
        type,
        raw: round(raw, 3),
        resistance: round(resistance, 2),
        multiplier: round(multiplier * targetAmp, 3),
        final: round(final, 3),
        targetHealthAfter: round(state.targetHealth, 2),
        notes,
      });
    };

    const attack = (time: number) => {
      state.attacks += 1;
      const expectedPhysical = totalAd * (1 + critChance * (critDamage - 1));
      add(time, "Basic attack", "physical", expectedPhysical, [
        `${Math.round(critChance * 100)}% expected crit at ${Math.round(critDamage * 100)}%`,
      ]);
      // Passive is 10% of the pre-mitigation physical critical strike, weighted by crit chance.
      add(time, "Vow of the First Lands", "magic", critChance * totalAd * critDamage * 0.1, [
        "10% of critical strike pre-mitigation damage",
      ]);
      if (time <= state.qUntil) {
        add(time, "Cultivation of Spirit", "magic", qOnHit(input.ranks.q, totalAd), [
          "Q on-hit; secondary spread excluded",
        ]);
      }
      if (hasKraken && state.attacks % 3 === 0) {
        const missingFraction = Math.max(
          0,
          Math.min(1, 1 - state.targetHealth / input.target.health),
        );
        const missingHealthAmp = 1 + 0.75 * missingFraction;
        add(
          time,
          "Kraken Slayer — Bring It Down",
          "physical",
          krakenBaseDamage(input.level) * missingHealthAmp,
          [
            `Every third attack; missing-health amp ×${round(missingHealthAmp, 3)}`,
            "80% ranged modifier",
          ],
        );
      }
    };

    let cursor = 0;
    for (const action of input.actions) {
      if (cursor > input.durationSeconds) break;
      if (action === "R") {
        state.rUntil = cursor + 15;
        state.qUntil = cursor + 15;
        cursor += 0.25;
      } else if (action === "Q") {
        state.qUntil = Math.max(state.qUntil, cursor + 6);
        cursor += 0.25;
      } else if (action === "W") {
        if (cursor <= state.rUntil) {
          const base = [0, 160, 320, 480][input.ranks.r]!;
          add(
            cursor,
            "Arc of Ruin",
            "magic",
            base + 1.2 * (totalAd - BASE_AD - growthAtLevel(AD_GROWTH, input.level)),
            ["R-enhanced W; 120% bonus AD"],
          );
        } else {
          const base = [0, 55, 95, 135, 175, 215][input.ranks.w]!;
          const hit = base + 0.85 * (totalAd - BASE_AD - growthAtLevel(AD_GROWTH, input.level));
          add(cursor, "Arc of Judgment", "physical", hit, ["Initial hit; 85% bonus AD"]);
          add(cursor + 1, "Arc of Judgment — linger", "physical", hit * 0.6, [
            "One representative 60% lingering tick",
          ]);
        }
        cursor += 0.5;
      } else {
        attack(cursor);
        cursor += 0.25;
      }
    }

    if (input.continueAutos) {
      let next = cursor;
      while (next <= input.durationSeconds + 1e-9) {
        const qBonus = next <= state.qUntil ? qAttackSpeed(input.ranks.q) : 0;
        const attackSpeed = Math.min(
          2.5,
          BASE_AS * (1 + growthAtLevel(AS_GROWTH, input.level) + items.attackSpeed + qBonus),
        );
        attack(next);
        next += 1 / attackSpeed;
      }
    }

    const split = { physical: 0, magic: 0, true: 0 };
    const sources: Record<string, number> = {};
    let ttk: number | null = null;
    for (const event of events) {
      split[event.type] += event.final;
      sources[event.source] = (sources[event.source] ?? 0) + event.final;
      if (ttk === null && event.targetHealthAfter <= 0) ttk = event.time;
    }
    const totalDamage = Object.values(split).reduce((sum, value) => sum + value, 0);
    const initialQ =
      input.actions[0] === "Q" || input.actions[0] === "R" ? qAttackSpeed(input.ranks.q) : 0;
    return {
      build: input.build.name,
      totalDamage: round(totalDamage),
      dps: round(totalDamage / input.durationSeconds),
      ttk,
      split: Object.fromEntries(Object.entries(split).map(([k, v]) => [k, round(v)])) as Record<
        DamageType,
        number
      >,
      sources: Object.fromEntries(Object.entries(sources).map(([k, v]) => [k, round(v)])),
      events,
      warnings,
      stats: {
        attackDamage: round(totalAd),
        attackSpeed: round(
          Math.min(
            2.5,
            BASE_AS * (1 + growthAtLevel(AS_GROWTH, input.level) + items.attackSpeed + initialQ),
          ),
          2,
        ),
        critChance,
        critDamage,
        armorPenPercent: items.armorPenPercent,
      },
    };
  },
};
