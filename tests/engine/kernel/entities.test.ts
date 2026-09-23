import { expect, test } from "bun:test";
import { sampleScenario } from "../../contracts/fixtures";
import { EntityRegistry } from "../../../src/domain/engine/kernel/entities";

const summon = (entityId: string, ownerEntityId: string | null) => ({
  ...structuredClone(sampleScenario.entities[0]!),
  entityId,
  ownerEntityId,
  team: "actor" as const,
  kind: "summon" as const,
  championId: null,
  abilities: [],
  buffs: [],
  resources: [],
  inventory: [],
  inventoryOrigin: "empty" as const,
});

test("spawn, snapshot, and despawn preserve ownership and IDs", () => {
  const registry = new EntityRegistry(sampleScenario.entities);
  registry.spawn(summon("summon-1", "actor"));
  expect(registry.get("summon-1")?.ownerEntityId).toBe("actor");
  expect(registry.active().map((entity) => entity.entityId)).toEqual([
    "actor",
    "enemy",
    "summon-1",
  ]);
  expect(() => registry.despawn("actor")).toThrow("references");
  registry.despawn("summon-1");
  expect(registry.retired()).toEqual(["summon-1"]);
  expect(() => registry.spawn(summon("summon-1", "actor"))).toThrow("already allocated");
  const restored = new EntityRegistry(registry.active(), registry.retired());
  expect(restored.active()).toEqual(registry.active());
  expect(restored.retired()).toEqual(registry.retired());
});

test("invalid owner or cycle is rejected without changing active state", () => {
  const registry = new EntityRegistry(sampleScenario.entities);
  const before = registry.active();
  expect(() => registry.spawn(summon("orphan", "missing"))).toThrow("unknown owner");
  expect(registry.active()).toEqual(before);
  expect(() => new EntityRegistry([summon("a", "b"), summon("b", "a")])).toThrow("cycles");
});

test("callers cannot mutate registry state through returned entities", () => {
  const registry = new EntityRegistry(sampleScenario.entities);
  const first = registry.get("actor")!;
  first.health.current = 1;
  expect(registry.get("actor")!.health.current).not.toBe(1);
});
