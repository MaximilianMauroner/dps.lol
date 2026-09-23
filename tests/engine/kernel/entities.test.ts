import { expect, test } from "bun:test";
import { EngineSnapshotSchema, assertResumeCompatible } from "../../../src/domain/contracts";
import { createMockPorts } from "../../contracts/mock-ports";
import {
  HASH_A,
  sampleResolvedScenario,
  sampleRunningRun,
  sampleScenario,
  sampleSnapshot,
} from "../../contracts/fixtures";
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

test("death, revive, and transform preserve identity and revision through checkpoint restore", () => {
  const registry = new EntityRegistry(sampleScenario.entities, [], { actor: 4, enemy: 2 });
  const actor = registry.get("actor")!;
  const dead = { ...actor, alive: false, health: { ...actor.health, current: 0, shield: 0 } };
  registry.applyInPlace({ entityId: "actor", transition: "death", replacement: dead });
  expect(registry.get("actor")?.alive).toBe(false);
  expect(registry.stateRevisions()).toEqual({ actor: 5, enemy: 2 });

  const checkpoint = EngineSnapshotSchema.parse({
    ...sampleSnapshot,
    entities: registry.active(),
    stateRevisions: registry.stateRevisions(),
  });
  const compatible = assertResumeCompatible(
    { scenario: sampleResolvedScenario, run: sampleRunningRun, ports: createMockPorts() },
    checkpoint,
    HASH_A,
  );
  const restored = new EntityRegistry(
    compatible.snapshot.entities,
    [],
    compatible.snapshot.stateRevisions,
  );
  expect(restored.get("actor")?.alive).toBe(false);
  expect(restored.stateRevisions()).toEqual({ actor: 5, enemy: 2 });

  const revived = {
    ...restored.get("actor")!,
    alive: true,
    health: { ...actor.health, current: 200 },
  };
  restored.applyInPlace({ entityId: "actor", transition: "revive", replacement: revived });
  restored.applyInPlace({
    entityId: "actor",
    transition: "transform",
    replacement: { ...restored.get("actor")!, position: { x: 50, y: 0, z: 0 } },
  });
  expect(restored.get("actor")?.position.x).toBe(50);
  expect(restored.stateRevisions()).toEqual({ actor: 7, enemy: 2 });
});

test("invalid lifecycle transitions and exhausted revisions leave registry unchanged", () => {
  const registry = new EntityRegistry(sampleScenario.entities);
  const actor = registry.get("actor")!;
  const before = registry.active();
  expect(() =>
    registry.applyInPlace({ entityId: "actor", transition: "revive", replacement: actor }),
  ).toThrow("dead entity");
  expect(() =>
    registry.applyInPlace({ entityId: "actor", transition: "death", replacement: actor }),
  ).toThrow("dead entity");
  expect(() =>
    registry.applyInPlace({
      entityId: "actor",
      transition: "transform",
      replacement: sampleScenario.entities[1]!,
    }),
  ).toThrow("identity");
  expect(() =>
    registry.applyInPlace({ entityId: "actor", transition: "despawn", replacement: null }),
  ).toThrow("allocation checkpoint ledger");
  expect(registry.active()).toEqual(before);
  expect(registry.stateRevisions()).toEqual({ actor: 1, enemy: 1 });

  const maxed = new EntityRegistry(sampleScenario.entities, [], {
    actor: Number.MAX_SAFE_INTEGER,
    enemy: 1,
  });
  const dead = { ...actor, alive: false, health: { ...actor.health, current: 0 } };
  expect(() =>
    maxed.applyInPlace({ entityId: "actor", transition: "death", replacement: dead }),
  ).toThrow("revision exhausted");
  expect(maxed.get("actor")?.alive).toBe(true);
  expect(maxed.stateRevisions().actor).toBe(Number.MAX_SAFE_INTEGER);
});
