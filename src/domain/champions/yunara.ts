import { giantSlayerMultiplier, itemStats, itemWarnings, krakenBaseDamage } from "../items";
import { applyPercentArmorPenetration, growthAtLevel, mitigate, round } from "../math";
import type { ChampionPlugin } from "./plugin";
import type { DamageEvent, DamageType, SimulationResult } from "../types";

const BASE_AD = 55;
const AD_GROWTH = 3;
const BASE_AS = 0.65;
const AS_GROWTH = 0.02;
// Patch 26.18 inherits the global 2.00x critical-strike baseline introduced in 26.1.
const BASE_CRIT_DAMAGE = 2;
const Q_DURATION_SECONDS = 5;
const R_DURATION_SECONDS = 15;
const ABILITY_CAST_SECONDS = { Q: 0.25, W: 0.5, R: 0.25, E: 0.25 } as const;
const SCRIPTED_ATTACK_LOCK_SECONDS = 0.25;
const YUN_TAL_MAX_STACKS = 125;
const YUN_TAL_CRIT_PER_STACK = 0.002;
const YUN_TAL_FLURRY_ATTACK_SPEED = 0.3;
const YUN_TAL_FLURRY_DURATION_SECONDS = 6;
const YUN_TAL_FLURRY_COOLDOWN_SECONDS = 30;

type State = {
  qUntil: number;
  rUntil: number;
  attacks: number;
  targetHealth: number;
  nextAttackReady: number;
  yunTalStacks: number;
  flurryUntil: number;
  flurryReadyAt: number;
  flurryActivations: number;
};

function qMagicOnHit(rank: number, ap: number): number {
  return [0, 5, 10, 15, 20, 25][rank]! + 0.2 * ap;
}

function qAttackSpeed(rank: number): number {
  return [0, 0.2, 0.3, 0.4, 0.5, 0.6][rank]!;
}

export const yunara: ChampionPlugin = {
  id: 804,
  slug: "yunara",
  patch: "26.18",
  simulate(input): SimulationResult {
    const targetMode = input.targetMode ?? "mortal";
    const items = itemStats(input.build.itemIds);
    const totalAd = BASE_AD + growthAtLevel(AD_GROWTH, input.level) + items.attackDamage;
    const critDamage = BASE_CRIT_DAMAGE + items.critDamage;
    const hasLdr = input.build.itemIds.includes(3036);
    const hasKraken = input.build.itemIds.includes(6672);
    const hasRunaans = input.build.itemIds.includes(3085);
    const hasYunTal = input.build.itemIds.includes(3032);
    const yunTalStacksStart = clampYunTalStacks(input.yunTalStacks);
    const abilityPower = 0;
    const targetAmp = hasLdr ? giantSlayerMultiplier(input.target.bonusHealth) : 1;
    const effectiveArmor = applyPercentArmorPenetration(input.target.armor, items.armorPenPercent);
    const state: State = {
      qUntil: -1,
      rUntil: -1,
      attacks: 0,
      targetHealth: input.target.health,
      nextAttackReady: 0,
      yunTalStacks: yunTalStacksStart,
      flurryUntil: -1,
      flurryReadyAt: 0,
      flurryActivations: 0,
    };
    const events: DamageEvent[] = [];
    const warnings = [
      "Expected crit mode averages crits; individual attacks are not RNG rolls.",
      "Mortal-target mode stops at first death; damage shown excludes overkill.",
      "AA timing uses attack-readiness intervals and a 0.25s scripted action lock; champion windups/resets are not modeled.",
      "E is selectable for combo planning but is mobility-only and intentionally contributes no damage.",
      ...itemWarnings(input.build.itemIds),
    ];
    if (hasYunTal) {
      warnings.push(
        "Yun Tal Practice Makes Lethal starts at " +
          yunTalStacksStart +
          "/125 ranged stacks; Match-V5 frames do not expose crit chance, so this is an explicit assumption.",
      );
      warnings.push(
        "Yun Tal Flurry is modeled at +30% bonus AS for 6s; its cooldown uses expected 1s + crit-chance on-hit reduction rather than sampled crit rolls.",
      );
    }
    if (targetMode === "uncapped") {
      warnings.push(
        "Training-dummy mode is explicitly uncapped: the target never stops receiving events; it is not a time-to-kill result.",
      );
    }
    if (hasRunaans) warnings.push("Runaan's bolts are excluded from single-target damage.");
    if (input.build.itemIds.includes(3008)) {
      warnings.push("Gluttonous Greaves omnivamp and takedown stacking are not modeled in damage.");
    }

    const isDead = () => targetMode === "mortal" && state.targetHealth <= 1e-9;
    const yunTalCritChance = () =>
      hasYunTal
        ? Math.min(1, items.critChance + state.yunTalStacks * YUN_TAL_CRIT_PER_STACK)
        : Math.min(1, items.critChance);

    const add = (
      time: number,
      source: string,
      type: DamageType,
      raw: number,
      notes: string[] = [],
    ) => {
      if (time > input.durationSeconds || raw <= 0 || isDead()) return false;
      const resistance =
        type === "physical" ? effectiveArmor : type === "magic" ? input.target.magicResist : 0;
      const attemptedFinal = (type === "true" ? raw : mitigate(raw, resistance)) * targetAmp;
      const remaining = Math.max(0, state.targetHealth);
      const final = targetMode === "mortal" ? Math.min(attemptedFinal, remaining) : attemptedFinal;
      const overkill = targetMode === "mortal" ? Math.max(0, attemptedFinal - final) : 0;
      state.targetHealth -= final;
      if (hasLdr) notes = [...notes, `Giant Slayer ×${round(targetAmp, 3)}`];
      events.push({
        time: round(time, 3),
        source,
        type,
        raw: round(raw, 3),
        resistance: round(resistance, 2),
        multiplier: round(targetAmp, 3),
        attemptedFinal: round(attemptedFinal, 3),
        final: round(final, 3),
        overkill: round(overkill, 3),
        targetHealthAfter: round(Math.max(0, state.targetHealth), 2),
        notes,
      });
      return final > 0 || overkill > 0;
    };

    const attackSpeedAt = (time: number) => {
      const qBonus = time < state.qUntil ? qAttackSpeed(input.ranks.q) : 0;
      const flurryBonus = hasYunTal && time < state.flurryUntil ? YUN_TAL_FLURRY_ATTACK_SPEED : 0;
      return Math.min(
        2.5,
        BASE_AS *
          (1 + growthAtLevel(AS_GROWTH, input.level) + items.attackSpeed + qBonus + flurryBonus),
      );
    };

    const attack = (time: number) => {
      if (isDead() || time > input.durationSeconds) return false;
      const attackCritChance = yunTalCritChance();
      if (hasYunTal && time >= state.flurryReadyAt - 1e-9) {
        state.flurryUntil = time + YUN_TAL_FLURRY_DURATION_SECONDS;
        state.flurryReadyAt = time + YUN_TAL_FLURRY_COOLDOWN_SECONDS;
        state.flurryActivations += 1;
      }
      state.attacks += 1;
      const expectedPhysical = totalAd * (1 + attackCritChance * (critDamage - 1));
      add(time, "Basic attack", "physical", expectedPhysical, [
        `${Math.round(attackCritChance * 100)}% expected crit at ${Math.round(critDamage * 100)}%`,
        ...(hasYunTal
          ? [
              `Yun Tal stacks ${state.yunTalStacks}/${YUN_TAL_MAX_STACKS}`,
              ...(time < state.flurryUntil ? ["Flurry +30% bonus AS active"] : []),
            ]
          : []),
      ]);
      // Passive is 10% of the pre-mitigation critical strike, weighted by expected crit chance.
      add(time, "Vow of the First Lands", "magic", attackCritChance * totalAd * critDamage * 0.1, [
        "10% of critical strike pre-mitigation damage",
      ]);
      add(
        time,
        "Cultivation of Spirit — passive",
        "magic",
        qMagicOnHit(input.ranks.q, abilityPower),
        ["Passive on-hit; 5–25 + 20% AP"],
      );
      if (time < state.qUntil) {
        add(
          time,
          "Cultivation of Spirit — active",
          "magic",
          qMagicOnHit(input.ranks.q, abilityPower),
          ["Active adds the same magic on-hit; secondary spread excluded"],
        );
      }
      if (hasKraken && state.attacks % 3 === 0 && !isDead()) {
        const missingFraction = Math.max(
          0,
          Math.min(1, 1 - Math.max(0, state.targetHealth) / input.target.health),
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
      if (hasYunTal) {
        state.yunTalStacks = Math.min(YUN_TAL_MAX_STACKS, state.yunTalStacks + 1);
        if (state.flurryReadyAt > time) {
          state.flurryReadyAt = Math.max(time, state.flurryReadyAt - (1 + attackCritChance));
        }
      }
      state.nextAttackReady = time + 1 / attackSpeedAt(time);
      return true;
    };

    let cursor = 0;
    for (const action of input.actions) {
      if (cursor > input.durationSeconds || isDead()) break;
      if (action === "R") {
        state.rUntil = cursor + R_DURATION_SECONDS;
        state.qUntil = Math.max(state.qUntil, cursor + R_DURATION_SECONDS);
        cursor += ABILITY_CAST_SECONDS.R;
      } else if (action === "Q") {
        state.qUntil = Math.max(state.qUntil, cursor + Q_DURATION_SECONDS);
        cursor += ABILITY_CAST_SECONDS.Q;
      } else if (action === "W") {
        if (cursor < state.rUntil) {
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
          add(cursor, "Arc of Judgment", "magic", hit, ["Initial hit; 85% bonus AD"]);
          add(cursor + 1, "Arc of Judgment — linger", "magic", hit * 0.6, [
            "One representative 60% lingering tick",
          ]);
        }
        cursor += ABILITY_CAST_SECONDS.W;
      } else if (action === "E") {
        cursor += ABILITY_CAST_SECONDS.E;
      } else {
        const attackTime = Math.max(cursor, state.nextAttackReady);
        if (attack(attackTime)) cursor = attackTime + SCRIPTED_ATTACK_LOCK_SECONDS;
      }
    }

    if (input.continueAutos && !isDead()) {
      let next = Math.max(cursor, state.nextAttackReady);
      while (next <= input.durationSeconds + 1e-9 && !isDead()) {
        attack(next);
        next = state.nextAttackReady;
      }
    }

    const split = { physical: 0, magic: 0, true: 0 };
    const sources: Record<string, number> = {};
    let ttk: number | null = null;
    let overkill = 0;
    for (const event of events) {
      split[event.type] += event.final;
      sources[event.source] = (sources[event.source] ?? 0) + event.final;
      overkill += event.overkill;
      if (ttk === null && event.targetHealthAfter <= 0 && targetMode === "mortal") ttk = event.time;
    }
    const totalDamage = Object.values(split).reduce((sum, value) => sum + value, 0);
    const initialQ =
      input.actions[0] === "Q" || input.actions[0] === "R" ? qAttackSpeed(input.ranks.q) : 0;
    const killed = targetMode === "mortal" && state.targetHealth <= 1e-9;
    const yunTalCritChanceStart = hasYunTal
      ? Math.min(1, items.critChance + yunTalStacksStart * YUN_TAL_CRIT_PER_STACK)
      : Math.min(1, items.critChance);
    const yunTalCritChanceEnd = yunTalCritChance();
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
      killed,
      censored: targetMode === "mortal" && !killed,
      overkill: round(overkill),
      targetMode,
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
        critChance: yunTalCritChanceStart,
        critDamage,
        armorPenPercent: items.armorPenPercent,
        yunTalStacksStart,
        yunTalStacksEnd: state.yunTalStacks,
        yunTalCritChanceStart,
        yunTalCritChanceEnd,
        flurryActivations: state.flurryActivations,
      },
    };
  },
};

function clampYunTalStacks(value: number | undefined): number {
  return Math.max(0, Math.min(YUN_TAL_MAX_STACKS, Math.round(Number(value ?? 0))));
}
