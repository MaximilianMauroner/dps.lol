import {
  EntityStateSchema,
  assertLifecycleResolution,
  type EntityState,
  type LifecycleResolution,
  type LifecycleTransition,
} from "../../contracts";

/** Snapshot-friendly entity ownership state. Mutations replace copies, never caller objects. */
export class EntityRegistry {
  private readonly entities = new Map<string, EntityState>();
  private readonly retiredIds = new Set<string>();
  private readonly revisions = new Map<string, number>();

  constructor(
    initial: readonly EntityState[],
    retiredIds: readonly string[] = [],
    stateRevisions?: Readonly<Record<string, number>>,
  ) {
    if (new Set(retiredIds).size !== retiredIds.length)
      throw new TypeError("retired entity IDs must be unique");
    for (const entity of initial) {
      const parsed = EntityStateSchema.parse(entity);
      if (this.entities.has(parsed.entityId)) throw new TypeError("entity IDs must be unique");
      this.entities.set(parsed.entityId, structuredClone(parsed));
      const revision = stateRevisions?.[parsed.entityId] ?? 1;
      if (!Number.isSafeInteger(revision) || revision < 1)
        throw new TypeError("entity state revision must be a positive safe integer");
      this.revisions.set(parsed.entityId, revision);
    }
    if (
      stateRevisions !== undefined &&
      (Object.keys(stateRevisions).length !== this.entities.size ||
        Object.keys(stateRevisions).some((id) => !this.entities.has(id)))
    )
      throw new TypeError("entity state revisions must match active entity IDs");
    for (const id of retiredIds) {
      if (this.entities.has(id)) throw new TypeError("a retired entity cannot remain active");
      this.retiredIds.add(id);
    }
    this.assertReferences();
  }

  get(entityId: string): EntityState | null {
    const value = this.entities.get(entityId);
    return value ? structuredClone(value) : null;
  }

  active(): readonly EntityState[] {
    return [...this.entities.values()]
      .sort((a, b) => (a.entityId < b.entityId ? -1 : a.entityId > b.entityId ? 1 : 0))
      .map((value) => structuredClone(value));
  }

  retired(): readonly string[] {
    return [...this.retiredIds].sort();
  }

  stateRevisions(): Readonly<Record<string, number>> {
    return Object.fromEntries(
      [...this.revisions.entries()].sort(([left], [right]) =>
        left < right ? -1 : left > right ? 1 : 0,
      ),
    );
  }

  firstExpiredBuffAt(timeMs: number): string | null {
    for (const entity of this.entities.values()) {
      for (const buff of entity.buffs) {
        if (buff.expiresAtMs !== null && buff.expiresAtMs < timeMs) return buff.buffId;
      }
    }
    return null;
  }

  spawn(entity: EntityState): void {
    const parsed = EntityStateSchema.parse(entity);
    if (this.entities.has(parsed.entityId) || this.retiredIds.has(parsed.entityId))
      throw new TypeError("entity ID was already allocated");
    this.entities.set(parsed.entityId, structuredClone(parsed));
    try {
      this.assertReferences();
      this.revisions.set(parsed.entityId, 1);
    } catch (error) {
      this.entities.delete(parsed.entityId);
      throw error;
    }
  }

  despawn(entityId: string): EntityState {
    const entity = this.entities.get(entityId);
    if (!entity) throw new TypeError("cannot despawn an unknown entity");
    if (
      [...this.entities.values()].some(
        (other) =>
          other.ownerEntityId === entityId ||
          other.abilities.some(
            (ability) =>
              ability.origin.kind === "copied" && ability.origin.sourceEntityId === entityId,
          ) ||
          other.buffs.some((buff) => buff.sourceEntityId === entityId),
      )
    )
      throw new TypeError("cannot despawn an entity while active state references it");
    this.entities.delete(entityId);
    this.revisions.delete(entityId);
    this.retiredIds.add(entityId);
    return structuredClone(entity);
  }

  /** Death, revive, and transform preserve identity across P01 checkpoints. */
  applyInPlace(transition: LifecycleTransition): LifecycleResolution {
    if (transition.transition === "spawn" || transition.transition === "despawn")
      throw new TypeError("spawn and despawn require an entity allocation checkpoint ledger");
    const previous = this.entities.get(transition.entityId);
    if (!previous) throw new TypeError("cannot transition an unknown entity");
    const replacement =
      transition.replacement === null ? null : EntityStateSchema.parse(transition.replacement);
    const request = { ...transition, replacement };
    const result = assertLifecycleResolution(request, this.active(), {
      accepted: true,
      entityId: transition.entityId,
      transition: transition.transition,
      state: replacement,
      reason: null,
    });
    if (replacement === null) throw new TypeError("in-place lifecycle requires a replacement");
    const nextRevision = this.revisions.get(transition.entityId)! + 1;
    if (!Number.isSafeInteger(nextRevision))
      throw new RangeError("entity state revision exhausted");
    this.entities.set(transition.entityId, structuredClone(replacement));
    try {
      this.assertReferences();
    } catch (error) {
      this.entities.set(transition.entityId, previous);
      throw error;
    }
    this.revisions.set(transition.entityId, nextRevision);
    return structuredClone(result);
  }

  private assertReferences(): void {
    for (const entity of this.entities.values()) {
      if (entity.ownerEntityId !== null && !this.entities.has(entity.ownerEntityId))
        throw new TypeError(`unknown owner for ${entity.entityId}`);
      for (const ability of entity.abilities)
        if (ability.origin.kind === "copied" && !this.entities.has(ability.origin.sourceEntityId))
          throw new TypeError(`unknown copied ability source for ${entity.entityId}`);
      for (const buff of entity.buffs)
        if (!this.entities.has(buff.sourceEntityId))
          throw new TypeError(`unknown buff source for ${entity.entityId}`);
      const seen = new Set([entity.entityId]);
      let owner = entity.ownerEntityId;
      while (owner !== null) {
        if (seen.has(owner)) throw new TypeError("entity ownership cannot contain cycles");
        seen.add(owner);
        owner = this.entities.get(owner)?.ownerEntityId ?? null;
      }
    }
  }
}
