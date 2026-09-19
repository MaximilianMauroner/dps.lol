import { z } from "zod";

/**
 * P01 freezes the wire shape, not the complete combat implementation. Later
 * slices may add fields through a new schema version or an additive revision.
 */
export const CONTRACT_SCHEMA_VERSION = 1 as const;

const finiteNumber = z.number().finite();
const nonNegativeNumber = finiteNumber.nonnegative();
const nonNegativeInteger = z.number().int().nonnegative();
const positiveInteger = z.number().int().positive();
const identifier = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/, "must be a stable ASCII identifier");
const itemId = z.number().int().positive();
const timestamp = z
  .string()
  .min(1)
  .refine((value) => Number.isFinite(Date.parse(value)), {
    message: "must be an ISO-compatible timestamp",
  });

export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    finiteNumber,
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ]),
);

export const ContentHashSchema = z
  .string()
  .regex(/^sha256:[0-9a-f]{64}$/, "must be a lowercase sha256:<64 hex characters> hash");
export type ContentHash = z.infer<typeof ContentHashSchema>;

export const ProvenanceKindSchema = z.enum([
  "observed",
  "inferred",
  "manual",
  "fixture",
  "derived",
  "unknown",
]);

/** Every source-affecting field carries an explicit provenance record. */
export const ProvenanceSchema = z
  .object({
    kind: ProvenanceKindSchema,
    sourceId: identifier,
    sourceHash: ContentHashSchema.nullable(),
    locator: z.string().min(1),
    capturedAt: timestamp.nullable(),
    note: z.string().min(1),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.kind === "observed" && value.sourceHash === null) {
      context.addIssue({
        code: "custom",
        path: ["sourceHash"],
        message: "observed values require a retained source hash",
      });
    }
  });
export type Provenance = z.infer<typeof ProvenanceSchema>;

const uniqueIdentifiers = z
  .array(identifier)
  .refine((values) => new Set(values).size === values.length, "values must be unique");
const uniqueItemIds = z
  .array(itemId)
  .refine((values) => new Set(values).size === values.length, "item IDs must be unique");
const finiteNumberMap = z.record(z.string().min(1), finiteNumber);
const provenanceMap = z.record(z.string().min(1), ProvenanceSchema);

export const SourceArtifactSchema = z
  .object({
    artifactId: identifier,
    kind: z.enum(["data-dragon", "community-dragon", "riot-api", "fixture", "manual"]),
    uri: z.string().url(),
    version: z.string().min(1),
    contentHash: ContentHashSchema,
    retrievedAt: timestamp,
  })
  .strict();
export type SourceArtifact = z.infer<typeof SourceArtifactSchema>;

export const RulesetModeSchema = z
  .object({
    modeId: identifier,
    mapId: identifier,
    queueId: identifier,
    enabled: z.boolean(),
    tags: uniqueIdentifiers,
  })
  .strict();

export const RulesetManifestSchema = z
  .object({
    schemaVersion: z.literal(CONTRACT_SCHEMA_VERSION),
    manifestId: identifier,
    patch: z.string().min(1),
    dataDragonVersion: z.string().min(1),
    sourceArtifacts: z.array(SourceArtifactSchema).min(1),
    modes: z.array(RulesetModeSchema).min(1),
    manifestHash: ContentHashSchema,
    generatedAt: timestamp,
    compatibilityRevision: identifier,
  })
  .strict()
  .superRefine((value, context) => {
    const artifactIds = value.sourceArtifacts.map((artifact) => artifact.artifactId);
    if (new Set(artifactIds).size !== artifactIds.length) {
      context.addIssue({
        code: "custom",
        path: ["sourceArtifacts"],
        message: "artifact IDs must be unique",
      });
    }
    const modeIds = value.modes.map((mode) => mode.modeId);
    if (new Set(modeIds).size !== modeIds.length) {
      context.addIssue({
        code: "custom",
        path: ["modes"],
        message: "mode IDs must be unique",
      });
    }
  });
export type RulesetManifest = z.infer<typeof RulesetManifestSchema>;

export const PositionSchema = z
  .object({ x: finiteNumber, y: finiteNumber, z: finiteNumber })
  .strict();
export type Position = z.infer<typeof PositionSchema>;

export const HealthStateSchema = z
  .object({
    current: nonNegativeNumber,
    maximum: finiteNumber.positive(),
    shield: nonNegativeNumber,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.current > value.maximum) {
      context.addIssue({
        code: "custom",
        path: ["current"],
        message: "current health cannot exceed maximum health",
      });
    }
  });

export const ResourceStateSchema = z
  .object({
    resourceId: identifier,
    current: nonNegativeNumber,
    maximum: finiteNumber.positive(),
    regenerationPerSecond: nonNegativeNumber,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.current > value.maximum) {
      context.addIssue({
        code: "custom",
        path: ["current"],
        message: "current resource cannot exceed maximum resource",
      });
    }
  });

export const BuffStateSchema = z
  .object({
    buffId: identifier,
    ownerEntityId: identifier,
    sourceEntityId: identifier,
    stacks: nonNegativeInteger,
    expiresAtMs: nonNegativeInteger.nullable(),
    tags: uniqueIdentifiers,
  })
  .strict();
export type BuffState = z.infer<typeof BuffStateSchema>;

export const AbilityOriginSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("native"), sourceAbilityId: identifier }).strict(),
  z
    .object({
      kind: z.literal("copied"),
      sourceAbilityId: identifier,
      sourceEntityId: identifier,
      copyId: identifier,
    })
    .strict(),
  z
    .object({
      kind: z.literal("transformed"),
      sourceAbilityId: identifier,
      transformationId: identifier,
    })
    .strict(),
]);

export const AbilityStateSchema = z
  .object({
    abilityId: identifier,
    ownerEntityId: identifier,
    rank: z.number().int().min(0).max(6),
    formId: identifier.nullable(),
    origin: AbilityOriginSchema,
  })
  .strict();
export type AbilityState = z.infer<typeof AbilityStateSchema>;

export const ItemUpgradeSchema = z
  .object({
    upgradeId: identifier,
    fromItemId: itemId,
    toItemId: itemId,
  })
  .strict();

export const ItemInstanceSchema = z
  .object({
    instanceId: identifier,
    baseItemId: itemId,
    effectiveItemId: itemId,
    slot: z.number().int().min(-1).max(5),
    state: z.enum(["owned", "equipped", "consumed", "sold"]),
    upgrade: ItemUpgradeSchema.nullable(),
    stacks: nonNegativeInteger,
    charges: nonNegativeInteger,
    provenance: ProvenanceSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.upgrade && value.upgrade.fromItemId !== value.baseItemId) {
      context.addIssue({
        code: "custom",
        path: ["upgrade", "fromItemId"],
        message: "upgrade source must match the immutable base item ID",
      });
    }
    if (value.upgrade && value.upgrade.toItemId !== value.effectiveItemId) {
      context.addIssue({
        code: "custom",
        path: ["upgrade", "toItemId"],
        message: "upgrade destination must match the effective item ID",
      });
    }
  });
export type ItemInstance = z.infer<typeof ItemInstanceSchema>;

export const EntityTeamSchema = z.enum(["actor", "ally", "enemy", "neutral"]);
export const EntityKindSchema = z.enum([
  "champion",
  "minion",
  "monster",
  "summon",
  "projectile",
  "object",
]);

export const EntityStateSchema = z
  .object({
    entityId: identifier,
    team: EntityTeamSchema,
    kind: EntityKindSchema,
    championId: identifier.nullable(),
    alive: z.boolean(),
    health: HealthStateSchema,
    resources: z.array(ResourceStateSchema),
    stats: finiteNumberMap,
    statProvenance: provenanceMap,
    abilities: z.array(AbilityStateSchema),
    buffs: z.array(BuffStateSchema),
    inventory: z.array(ItemInstanceSchema),
    inventoryOrigin: z.enum(["observed-effective", "modeled-loadout", "empty", "unknown"]),
    position: PositionSchema,
    provenance: ProvenanceSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const statKeys = Object.keys(value.stats).sort();
    const provenanceKeys = Object.keys(value.statProvenance).sort();
    for (const statKey of statKeys) {
      if (!(statKey in value.statProvenance)) {
        context.addIssue({
          code: "custom",
          path: ["statProvenance", statKey],
          message: "every effective stat requires provenance",
        });
      }
    }
    for (const provenanceKey of provenanceKeys) {
      if (!(provenanceKey in value.stats)) {
        context.addIssue({
          code: "custom",
          path: ["statProvenance", provenanceKey],
          message: "stat provenance cannot describe a missing effective stat",
        });
      }
    }
    const entityIds = new Set([value.entityId]);
    for (const ability of value.abilities) {
      if (ability.ownerEntityId !== value.entityId) {
        context.addIssue({
          code: "custom",
          path: ["abilities"],
          message: `ability ${ability.abilityId} must be owned by ${value.entityId}`,
        });
      }
    }
    for (const buff of value.buffs) {
      if (!entityIds.has(buff.ownerEntityId)) {
        context.addIssue({
          code: "custom",
          path: ["buffs"],
          message: `buff ${buff.buffId} must be owned by ${value.entityId}`,
        });
      }
    }
  });
export type EntityState = z.infer<typeof EntityStateSchema>;

export const CohortMemberSchema = z
  .object({
    memberId: identifier,
    entityId: identifier,
    matchKey: identifier,
    weight: finiteNumber.positive(),
    provenance: ProvenanceSchema,
  })
  .strict();

export const CohortSpecSchema = z
  .object({
    cohortId: identifier,
    contentHash: ContentHashSchema,
    members: z.array(CohortMemberSchema).min(1),
    weighting: z.enum(["uniform-member", "match-balanced", "declared-mass"]),
    normalized: z.boolean(),
  })
  .strict()
  .superRefine((value, context) => {
    const memberIds = value.members.map((member) => member.memberId);
    if (new Set(memberIds).size !== memberIds.length) {
      context.addIssue({
        code: "custom",
        path: ["members"],
        message: "cohort member IDs must be unique",
      });
    }
  });
export type CohortSpec = z.infer<typeof CohortSpecSchema>;

export const TargetSelectorSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("self"), actorId: identifier }).strict(),
  z.object({ kind: z.literal("entity"), entityId: identifier }).strict(),
  z.object({ kind: z.literal("all-visible-enemies"), actorId: identifier }).strict(),
  z.object({ kind: z.literal("lowest-health-visible-enemy"), actorId: identifier }).strict(),
]);
export type TargetSelector = z.infer<typeof TargetSelectorSchema>;

export type Condition =
  | { kind: "always" }
  | { kind: "all"; clauses: Condition[] }
  | { kind: "any"; clauses: Condition[] }
  | { kind: "not"; clause: Condition }
  | { kind: "cooldown-ready"; entityId: string; abilityId: string }
  | { kind: "resource-at-least"; entityId: string; resourceId: string; amount: number }
  | { kind: "target-alive"; entityId: string }
  | { kind: "health-ratio-at-most"; entityId: string; ratio: number }
  | { kind: "buff-stacks-at-least"; entityId: string; buffId: string; stacks: number };

export const ConditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("always") }).strict(),
    z.object({ kind: z.literal("all"), clauses: z.array(ConditionSchema).min(1) }).strict(),
    z.object({ kind: z.literal("any"), clauses: z.array(ConditionSchema).min(1) }).strict(),
    z.object({ kind: z.literal("not"), clause: ConditionSchema }).strict(),
    z
      .object({
        kind: z.literal("cooldown-ready"),
        entityId: identifier,
        abilityId: identifier,
      })
      .strict(),
    z
      .object({
        kind: z.literal("resource-at-least"),
        entityId: identifier,
        resourceId: identifier,
        amount: nonNegativeNumber,
      })
      .strict(),
    z.object({ kind: z.literal("target-alive"), entityId: identifier }).strict(),
    z
      .object({
        kind: z.literal("health-ratio-at-most"),
        entityId: identifier,
        ratio: finiteNumber.min(0).max(1),
      })
      .strict(),
    z
      .object({
        kind: z.literal("buff-stacks-at-least"),
        entityId: identifier,
        buffId: identifier,
        stacks: nonNegativeInteger,
      })
      .strict(),
  ]),
);

export const ActionCommandSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("basic-attack"),
      actorId: identifier,
      target: TargetSelectorSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("ability"),
      actorId: identifier,
      abilityId: identifier,
      target: TargetSelectorSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("item-active"),
      actorId: identifier,
      itemInstanceId: identifier,
      target: TargetSelectorSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("move"),
      actorId: identifier,
      destination: PositionSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("wait"),
      actorId: identifier,
      durationMs: positiveInteger,
    })
    .strict(),
]);
export type ActionCommand = z.infer<typeof ActionCommandSchema>;

export const ActionStepSchema = z
  .object({
    stepId: identifier,
    priority: positiveInteger,
    action: ActionCommandSchema,
    condition: ConditionSchema,
    onUnavailable: z.enum(["wait", "skip", "fail"]),
    repeat: z.boolean(),
    maxRepeats: positiveInteger.nullable(),
  })
  .strict();

export const PolicyVisibilitySchema = z
  .object({
    allowFutureEvents: z.literal(false),
    allowHiddenOpponentState: z.literal(false),
    visibleEntityIds: uniqueIdentifiers,
  })
  .strict();

export const ActionPolicySchema = z
  .object({
    schemaVersion: z.literal(CONTRACT_SCHEMA_VERSION),
    policyId: identifier,
    revision: positiveInteger,
    mode: z.enum(["scripted", "conditional-priority"]),
    steps: z.array(ActionStepSchema).min(1),
    visibility: PolicyVisibilitySchema,
  })
  .strict()
  .superRefine((value, context) => {
    const priorities = value.steps.map((step) => step.priority);
    if (new Set(priorities).size !== priorities.length) {
      context.addIssue({
        code: "custom",
        path: ["steps"],
        message: "action priorities must be unique",
      });
    }
  });
export type ActionPolicy = z.infer<typeof ActionPolicySchema>;

export const ObjectiveKindSchema = z.enum([
  "burst-damage",
  "fixed-window-damage",
  "sustained-dps",
  "ttk",
  "first-death",
  "final-elimination",
]);

export const ObjectiveSpecSchema = z
  .object({
    schemaVersion: z.literal(CONTRACT_SCHEMA_VERSION),
    objectiveId: identifier,
    kind: ObjectiveKindSchema,
    primaryMetric: z.enum(["damage", "dps", "ttk", "time-to-first-death", "time-to-elimination"]),
    horizonMs: positiveInteger,
    warmupMs: nonNegativeInteger,
    censoring: z.enum(["right-censored", "fail-if-not-killed"]),
    aggregation: z.enum(["weighted-mean", "median", "coverage-then-ttk"]),
    tiePolicy: z.enum(["exact", "within-tolerance"]),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.warmupMs > value.horizonMs) {
      context.addIssue({
        code: "custom",
        path: ["warmupMs"],
        message: "warmup cannot exceed the horizon",
      });
    }
    const expectedMetric =
      value.kind === "sustained-dps"
        ? "dps"
        : value.kind === "ttk"
          ? "ttk"
          : value.kind === "first-death"
            ? "time-to-first-death"
            : value.kind === "final-elimination"
              ? "time-to-elimination"
              : "damage";
    if (value.primaryMetric !== expectedMetric) {
      context.addIssue({
        code: "custom",
        path: ["primaryMetric"],
        message: `${value.kind} must use ${expectedMetric}`,
      });
    }
  });
export type ObjectiveSpec = z.infer<typeof ObjectiveSpecSchema>;

export const DeterministicRandomSchema = z
  .object({
    kind: z.literal("deterministic"),
    algorithm: z.literal("none"),
    seed: z.null(),
    trialCount: z.literal(1),
  })
  .strict();

export const SeededRandomSchema = z
  .object({
    kind: z.literal("seeded"),
    algorithm: identifier,
    seed: identifier,
    trialCount: positiveInteger,
  })
  .strict();

export const RandomConfigurationSchema = z.discriminatedUnion("kind", [
  DeterministicRandomSchema,
  SeededRandomSchema,
]);
export type RandomConfiguration = z.infer<typeof RandomConfigurationSchema>;

export const EvaluationModeSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("analytical-expectation"),
      random: DeterministicRandomSchema,
      approximation: z.null(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("average-state-approximation"),
      random: DeterministicRandomSchema,
      approximation: z.enum(["expected-crit", "mean-resource", "mean-cooldown"]),
    })
    .strict(),
  z
    .object({
      kind: z.literal("seeded-trajectory"),
      random: SeededRandomSchema,
      approximation: z.null(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("sampled-estimate"),
      random: SeededRandomSchema,
      approximation: z.null(),
      confidenceLevel: finiteNumber.gt(0).lt(1),
    })
    .strict(),
]);
export type EvaluationMode = z.infer<typeof EvaluationModeSchema>;

export const SearchBudgetSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("incremental-gold"), amount: nonNegativeInteger }).strict(),
  z.object({ kind: z.literal("total-final-inventory"), amount: nonNegativeInteger }).strict(),
]);

export const SearchConstraintsSchema = z
  .object({
    schemaVersion: z.literal(CONTRACT_SCHEMA_VERSION),
    slotCount: z.number().int().min(1).max(6),
    bootRule: z.enum(["required", "optional", "forbidden"]),
    budget: SearchBudgetSchema,
    requiredItemIds: uniqueItemIds,
    excludedItemIds: uniqueItemIds,
    candidateLimit: positiveInteger,
    pruning: z.enum(["none", "legality-proven", "bound-proven"]),
  })
  .strict()
  .superRefine((value, context) => {
    const excluded = new Set(value.excludedItemIds);
    if (value.requiredItemIds.some((required) => excluded.has(required))) {
      context.addIssue({
        code: "custom",
        path: ["excludedItemIds"],
        message: "an item cannot be both required and excluded",
      });
    }
    if (value.requiredItemIds.length > value.slotCount) {
      context.addIssue({
        code: "custom",
        path: ["requiredItemIds"],
        message: "required items cannot exceed the slot count",
      });
    }
  });
export type SearchConstraints = z.infer<typeof SearchConstraintsSchema>;

const replayProvenanceFields = [
  "rulesetManifestHash",
  "modeId",
  "actorEntityId",
  "entities",
  "cohort",
  "policy",
  "objective",
  "evaluationMode",
  "searchConstraints",
] as const;

const scenarioValueShape = {
  rulesetManifestHash: ContentHashSchema,
  modeId: identifier,
  actorEntityId: identifier,
  entities: z.array(EntityStateSchema).min(1),
  cohort: CohortSpecSchema,
  policy: ActionPolicySchema,
  objective: ObjectiveSpecSchema,
  evaluationMode: EvaluationModeSchema,
  searchConstraints: SearchConstraintsSchema,
};

function addReferenceIssue(
  context: z.RefinementCtx,
  path: (string | number)[],
  message: string,
): void {
  context.addIssue({ code: "custom", path, message });
}

function referencedEntityIds(
  policy: ActionPolicy,
): Array<{ id: string; path: (string | number)[] }> {
  const references: Array<{ id: string; path: (string | number)[] }> = [];
  for (const [stepIndex, step] of policy.steps.entries()) {
    const action = step.action;
    references.push({
      id: action.actorId,
      path: ["policy", "steps", stepIndex, "action", "actorId"],
    });
    if (action.kind === "move" || action.kind === "wait") continue;
    if (action.target.kind === "entity") {
      references.push({
        id: action.target.entityId,
        path: ["policy", "steps", stepIndex, "action", "target", "entityId"],
      });
    } else {
      references.push({
        id: action.target.actorId,
        path: ["policy", "steps", stepIndex, "action", "target", "actorId"],
      });
    }
  }
  return references;
}

function validateScenarioReferences(
  value: {
    actorEntityId: string;
    entities: EntityState[];
    cohort: CohortSpec;
    policy: ActionPolicy;
  },
  context: z.RefinementCtx,
): void {
  const entityIds = new Set<string>();
  for (const [index, entity] of value.entities.entries()) {
    if (entityIds.has(entity.entityId)) {
      addReferenceIssue(
        context,
        ["entities", index, "entityId"],
        `entity ID ${entity.entityId} must be unique within a scenario`,
      );
    }
    entityIds.add(entity.entityId);
  }
  if (!entityIds.has(value.actorEntityId)) {
    addReferenceIssue(
      context,
      ["actorEntityId"],
      "actorEntityId must reference an entity in entities",
    );
  }
  for (const [index, member] of value.cohort.members.entries()) {
    if (!entityIds.has(member.entityId)) {
      addReferenceIssue(
        context,
        ["cohort", "members", index, "entityId"],
        `cohort member references unknown entity ${member.entityId}`,
      );
    }
  }
  for (const [entityIndex, entity] of value.entities.entries()) {
    for (const [abilityIndex, ability] of entity.abilities.entries()) {
      if (ability.origin.kind === "copied" && !entityIds.has(ability.origin.sourceEntityId)) {
        addReferenceIssue(
          context,
          ["entities", entityIndex, "abilities", abilityIndex, "origin", "sourceEntityId"],
          `copied ability references unknown source entity ${ability.origin.sourceEntityId}`,
        );
      }
    }
    for (const [buffIndex, buff] of entity.buffs.entries()) {
      if (!entityIds.has(buff.sourceEntityId)) {
        addReferenceIssue(
          context,
          ["entities", entityIndex, "buffs", buffIndex, "sourceEntityId"],
          `buff references unknown source entity ${buff.sourceEntityId}`,
        );
      }
    }
  }
  for (const reference of referencedEntityIds(value.policy)) {
    if (!entityIds.has(reference.id)) {
      addReferenceIssue(
        context,
        reference.path,
        `policy references unknown entity ${reference.id}`,
      );
    }
  }
}

export const ScenarioSpecSchema = z
  .object({
    schemaVersion: z.literal(CONTRACT_SCHEMA_VERSION),
    scenarioId: identifier,
    ...scenarioValueShape,
    inputProvenance: provenanceMap,
  })
  .strict()
  .superRefine((value, context) => {
    validateScenarioReferences(value, context);
    for (const field of replayProvenanceFields) {
      if (!(field in value.inputProvenance)) {
        context.addIssue({
          code: "custom",
          path: ["inputProvenance", field],
          message: "every input field requires provenance",
        });
      }
    }
  });
export type ScenarioSpec = z.infer<typeof ScenarioSpecSchema>;

export const ResolvedScenarioValuesSchema = z
  .object(scenarioValueShape)
  .strict()
  .superRefine((value, context) => validateScenarioReferences(value, context));
export type ResolvedScenarioValues = z.infer<typeof ResolvedScenarioValuesSchema>;

export const ResolvedScenarioSchema = z
  .object({
    schemaVersion: z.literal(CONTRACT_SCHEMA_VERSION),
    scenarioId: identifier,
    resolvedScenarioHash: ContentHashSchema,
    effective: ResolvedScenarioValuesSchema,
    provenance: provenanceMap,
  })
  .strict()
  .superRefine((value, context) => {
    for (const field of replayProvenanceFields) {
      if (!(field in value.provenance)) {
        context.addIssue({
          code: "custom",
          path: ["provenance", field],
          message: "every replay-affecting field requires provenance",
        });
      }
    }
  });
export type ResolvedScenario = z.infer<typeof ResolvedScenarioSchema>;

export const RunManifestSchema = z
  .object({
    schemaVersion: z.literal(CONTRACT_SCHEMA_VERSION),
    runId: identifier,
    engineHash: ContentHashSchema,
    rulesetHash: ContentHashSchema,
    resolvedScenarioHash: ContentHashSchema,
    cohortHash: ContentHashSchema,
    policyHash: ContentHashSchema,
    searchContextHash: ContentHashSchema,
    candidateInputHash: ContentHashSchema,
    objective: ObjectiveKindSchema,
    evaluationMode: z.enum([
      "analytical-expectation",
      "average-state-approximation",
      "seeded-trajectory",
      "sampled-estimate",
    ]),
    random: RandomConfigurationSchema,
    status: z.enum(["planned", "running", "complete", "cancelled", "invalid"]),
    createdAt: timestamp,
    completedAt: timestamp.nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.searchContextHash === value.candidateInputHash) {
      context.addIssue({
        code: "custom",
        path: ["candidateInputHash"],
        message: "candidate input hash must remain distinct from the frozen search-context hash",
      });
    }
    if (value.status === "complete" && value.completedAt === null) {
      context.addIssue({
        code: "custom",
        path: ["completedAt"],
        message: "complete runs require completedAt",
      });
    }
  });
export type RunManifest = z.infer<typeof RunManifestSchema>;

export const MechanicEvidenceSourceSchema = z
  .object({
    sourceId: identifier,
    sourceHash: ContentHashSchema,
    locator: z.string().min(1),
    excerpt: z.string().min(1),
  })
  .strict();

export const MechanicEvidenceSchema = z
  .object({
    schemaVersion: z.literal(CONTRACT_SCHEMA_VERSION),
    mechanicId: identifier,
    status: z.enum([
      "discovered",
      "specified",
      "implemented",
      "tested",
      "validated",
      "unavailable",
    ]),
    patch: z.string().min(1),
    sources: z.array(MechanicEvidenceSourceSchema),
    discrepancy: z.string().min(1).nullable(),
    nextAction: z.string().min(1).nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.status !== "unavailable" && value.sources.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["sources"],
        message: "non-unavailable mechanics require at least one source",
      });
    }
    if (value.status === "unavailable" && value.discrepancy === null) {
      context.addIssue({
        code: "custom",
        path: ["discrepancy"],
        message: "unavailable mechanics require a recorded discrepancy",
      });
    }
  });
export type MechanicEvidence = z.infer<typeof MechanicEvidenceSchema>;

export const DamagePacketSchema = z
  .object({
    sourceEntityId: identifier,
    targetEntityId: identifier,
    damageType: z.enum(["physical", "magic", "true"]),
    rawAmount: nonNegativeNumber,
    tags: uniqueIdentifiers,
    canOverkill: z.boolean(),
  })
  .strict();
export type DamagePacket = z.infer<typeof DamagePacketSchema>;

export const DamageResolutionSchema = z
  .object({
    attempted: nonNegativeNumber,
    absorbed: nonNegativeNumber,
    prevented: nonNegativeNumber,
    applied: nonNegativeNumber,
    overkill: nonNegativeNumber,
    targetHealthAfter: nonNegativeNumber,
    killed: z.boolean(),
  })
  .strict();
export type DamageResolution = z.infer<typeof DamageResolutionSchema>;

export const TraceEffectSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("damage"),
      sourceEntityId: identifier,
      targetEntityId: identifier,
      damageType: z.enum(["physical", "magic", "true"]),
      amount: nonNegativeNumber,
      overkill: nonNegativeNumber,
    })
    .strict(),
  z
    .object({
      kind: z.literal("heal"),
      sourceEntityId: identifier,
      targetEntityId: identifier,
      amount: nonNegativeNumber,
    })
    .strict(),
  z
    .object({
      kind: z.literal("shield"),
      sourceEntityId: identifier,
      targetEntityId: identifier,
      amount: nonNegativeNumber,
    })
    .strict(),
  z
    .object({
      kind: z.literal("resource"),
      sourceEntityId: identifier,
      targetEntityId: identifier,
      resourceId: identifier,
      delta: finiteNumber,
    })
    .strict(),
  z.object({ kind: z.literal("buff"), buff: BuffStateSchema }).strict(),
  z
    .object({
      kind: z.literal("lifecycle"),
      entityId: identifier,
      transition: z.enum(["spawn", "despawn", "death", "revive", "transform"]),
    })
    .strict(),
]);

export const TraceEventSchema = z
  .object({
    eventId: identifier,
    sequence: positiveInteger,
    timeMs: nonNegativeInteger,
    phase: z.enum(["input", "windup", "impact", "periodic", "expiry", "lifecycle", "checkpoint"]),
    kind: z.enum(["action", "damage", "resource", "buff", "lifecycle", "random", "checkpoint"]),
    actorEntityId: identifier.nullable(),
    targetEntityIds: uniqueIdentifiers,
    causeEventIds: uniqueIdentifiers,
    effects: z.array(TraceEffectSchema),
    stateDigest: ContentHashSchema.nullable(),
  })
  .strict();
export type TraceEvent = z.infer<typeof TraceEventSchema>;

export const TraceSchema = z
  .object({
    schemaVersion: z.literal(CONTRACT_SCHEMA_VERSION),
    traceId: identifier,
    runId: identifier,
    events: z.array(TraceEventSchema),
    truncated: z.boolean(),
    truncationReason: z.string().min(1).nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    for (let index = 1; index < value.events.length; index += 1) {
      const previous = value.events[index - 1]!;
      const current = value.events[index]!;
      if (
        current.timeMs < previous.timeMs ||
        (current.timeMs === previous.timeMs && current.sequence <= previous.sequence)
      ) {
        context.addIssue({
          code: "custom",
          path: ["events", index],
          message: "trace events must have deterministic chronological order",
        });
      }
    }
    if (value.truncated && value.truncationReason === null) {
      context.addIssue({
        code: "custom",
        path: ["truncationReason"],
        message: "truncated traces require a reason",
      });
    }
    if (!value.truncated && value.truncationReason !== null) {
      context.addIssue({
        code: "custom",
        path: ["truncationReason"],
        message: "complete traces cannot carry a truncation reason",
      });
    }
  });
export type Trace = z.infer<typeof TraceSchema>;

export const MetricValueSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("value"), value: finiteNumber }).strict(),
  z.object({ status: z.literal("censored"), horizonMs: positiveInteger }).strict(),
  z.object({ status: z.literal("undefined"), reason: z.string().min(1) }).strict(),
  z.object({ status: z.literal("not-applicable"), reason: z.string().min(1) }).strict(),
]);
export type MetricValue = z.infer<typeof MetricValueSchema>;

export const CombatResultSchema = z
  .object({
    schemaVersion: z.literal(CONTRACT_SCHEMA_VERSION),
    resultId: identifier,
    runId: identifier,
    status: z.enum(["complete", "incomplete", "cancelled", "invalid"]),
    objective: ObjectiveKindSchema,
    resolvedScenarioHash: ContentHashSchema,
    candidateInputHash: ContentHashSchema,
    metrics: z
      .object({ damage: MetricValueSchema, dps: MetricValueSchema, ttk: MetricValueSchema })
      .strict(),
    killed: z.boolean(),
    censoring: z.enum(["not-censored", "right-censored", "invalid"]),
    warnings: z.array(z.string()),
    traceId: identifier.nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.killed && value.metrics.ttk.status !== "value") {
      context.addIssue({
        code: "custom",
        path: ["metrics", "ttk"],
        message: "a killed result requires a finite TTK value",
      });
    }
    if (!value.killed && value.metrics.ttk.status === "value") {
      context.addIssue({
        code: "custom",
        path: ["metrics", "ttk"],
        message: "a non-kill result cannot carry a finite TTK value",
      });
    }
  });
export type CombatResult = z.infer<typeof CombatResultSchema>;

export const ScheduledEventSchema = z
  .object({
    eventId: identifier,
    timeMs: nonNegativeInteger,
    sequence: positiveInteger,
    phase: z.enum(["input", "windup", "impact", "periodic", "expiry", "lifecycle", "checkpoint"]),
    kind: identifier,
    payload: JsonValueSchema,
    causeEventIds: uniqueIdentifiers,
  })
  .strict();
export type ScheduledEvent = z.infer<typeof ScheduledEventSchema>;

export const EventQueueSnapshotSchema = z
  .object({
    nextSequence: positiveInteger,
    entries: z.array(ScheduledEventSchema),
  })
  .strict()
  .superRefine((value, context) => {
    const ids = value.entries.map((entry) => entry.eventId);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: "custom",
        path: ["entries"],
        message: "queued event IDs must be unique",
      });
    }
    for (let index = 1; index < value.entries.length; index += 1) {
      const previous = value.entries[index - 1]!;
      const current = value.entries[index]!;
      if (
        current.timeMs < previous.timeMs ||
        (current.timeMs === previous.timeMs && current.sequence < previous.sequence)
      ) {
        context.addIssue({
          code: "custom",
          path: ["entries", index],
          message: "queue entries must be ordered by time then sequence",
        });
      }
    }
  });

export const PendingActionSchema = z
  .object({
    actionId: identifier,
    command: ActionCommandSchema,
    state: z.enum(["scheduled", "windup", "interrupted", "complete"]),
    startedAtMs: nonNegativeInteger,
  })
  .strict();

export const TriggerStateSchema = z
  .object({
    triggerId: identifier,
    ownerEntityId: identifier,
    armed: z.boolean(),
    stacks: nonNegativeInteger,
    internalCooldownUntilMs: nonNegativeInteger.nullable(),
  })
  .strict();

export const RngStreamSnapshotSchema = z
  .object({
    streamId: identifier,
    algorithm: identifier,
    seed: identifier,
    drawCount: nonNegativeInteger,
    state: z.array(nonNegativeInteger),
  })
  .strict();

export const NumericalBranchStateSchema = z
  .object({
    branchId: identifier,
    mode: z.enum([
      "analytical-expectation",
      "average-state-approximation",
      "seeded-trajectory",
      "sampled-estimate",
    ]),
    accumulators: finiteNumberMap,
    labels: uniqueIdentifiers,
  })
  .strict();

export const EngineSnapshotSchema = z
  .object({
    schemaVersion: z.literal(CONTRACT_SCHEMA_VERSION),
    runId: identifier,
    currentTimeMs: nonNegativeInteger,
    queue: EventQueueSnapshotSchema,
    entities: z.array(EntityStateSchema).min(1),
    buffs: z.array(BuffStateSchema),
    pendingActions: z.array(PendingActionSchema),
    triggerState: z.array(TriggerStateSchema),
    rngStreams: z.array(RngStreamSnapshotSchema),
    numericalBranches: z.array(NumericalBranchStateSchema),
    status: z.enum(["running", "complete", "cancelled", "invalid"]),
    result: CombatResultSchema.nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.status === "complete" && value.result === null) {
      context.addIssue({
        code: "custom",
        path: ["result"],
        message: "complete snapshots require a result",
      });
    }
    if (value.status !== "complete" && value.result !== null) {
      context.addIssue({
        code: "custom",
        path: ["result"],
        message: "only complete snapshots may carry a result",
      });
    }
  });
export type EngineSnapshot = z.infer<typeof EngineSnapshotSchema>;

export const StepBudgetSchema = z
  .object({
    maxEvents: positiveInteger,
    untilTimeMs: nonNegativeInteger.nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.untilTimeMs !== null && value.untilTimeMs < 0) {
      context.addIssue({
        code: "custom",
        path: ["untilTimeMs"],
        message: "time cannot be negative",
      });
    }
  });
export type StepBudget = z.infer<typeof StepBudgetSchema>;

export const PolicyVisibleReadinessSchema = z
  .object({
    entityId: identifier,
    abilityId: identifier,
    ready: z.boolean(),
    cooldownRemainingMs: nonNegativeInteger,
  })
  .strict();

export const PolicyVisibleStateSchema = z
  .object({
    atTimeMs: nonNegativeInteger,
    actorEntityId: identifier,
    entities: z.array(EntityStateSchema).min(1),
    readiness: z.array(PolicyVisibleReadinessSchema),
    visibleResourceIds: uniqueIdentifiers,
  })
  .strict();
export type PolicyVisibleState = z.infer<typeof PolicyVisibleStateSchema>;

export const EngineCommandSchema = z.discriminatedUnion("kind", [
  z
    .object({
      schemaVersion: z.literal(CONTRACT_SCHEMA_VERSION),
      kind: z.literal("apply-damage"),
      commandId: identifier,
      issuedAtMs: nonNegativeInteger,
      causeEventIds: uniqueIdentifiers,
      packet: DamagePacketSchema,
    })
    .strict(),
  z
    .object({
      schemaVersion: z.literal(CONTRACT_SCHEMA_VERSION),
      kind: z.literal("schedule-event"),
      commandId: identifier,
      issuedAtMs: nonNegativeInteger,
      causeEventIds: uniqueIdentifiers,
      event: ScheduledEventSchema,
    })
    .strict(),
  z
    .object({
      schemaVersion: z.literal(CONTRACT_SCHEMA_VERSION),
      kind: z.literal("cancel-event"),
      commandId: identifier,
      issuedAtMs: nonNegativeInteger,
      causeEventIds: uniqueIdentifiers,
      eventId: identifier,
    })
    .strict(),
  z
    .object({
      schemaVersion: z.literal(CONTRACT_SCHEMA_VERSION),
      kind: z.literal("trace"),
      commandId: identifier,
      issuedAtMs: nonNegativeInteger,
      causeEventIds: uniqueIdentifiers,
      event: TraceEventSchema,
    })
    .strict(),
]);
export type EngineCommand = z.infer<typeof EngineCommandSchema>;

export const EngineEventSchema = z
  .object({
    schemaVersion: z.literal(CONTRACT_SCHEMA_VERSION),
    eventId: identifier,
    timeMs: nonNegativeInteger,
    sequence: positiveInteger,
    phase: z.enum(["input", "windup", "impact", "periodic", "expiry", "lifecycle", "checkpoint"]),
    kind: identifier,
    actorEntityId: identifier.nullable(),
    targetEntityIds: uniqueIdentifiers,
    causeEventIds: uniqueIdentifiers,
    payload: JsonValueSchema,
  })
  .strict();
export type EngineEvent = z.infer<typeof EngineEventSchema>;

export const EngineStepResultSchema = z
  .object({
    status: z.enum(["progress", "complete", "cancelled", "invalid"]),
    snapshot: EngineSnapshotSchema,
    emittedEvents: z.array(EngineEventSchema),
    result: CombatResultSchema.nullable(),
    reason: z.string().min(1).nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.status === "complete" && value.result === null) {
      context.addIssue({
        code: "custom",
        path: ["result"],
        message: "complete step results require a result",
      });
    }
    if (value.status !== "complete" && value.result !== null) {
      context.addIssue({
        code: "custom",
        path: ["result"],
        message: "only complete step results may carry a result",
      });
    }
  });
export type EngineStepResult = z.infer<typeof EngineStepResultSchema>;

export const ExactComparisonTransferSchema = z
  .object({
    result: CombatResultSchema,
    resolvedScenario: ResolvedScenarioSchema,
    run: RunManifestSchema,
    candidateInputHash: ContentHashSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.run.resolvedScenarioHash !== value.resolvedScenario.resolvedScenarioHash) {
      context.addIssue({
        code: "custom",
        path: ["run", "resolvedScenarioHash"],
        message: "run and transfer must reference the same resolved scenario",
      });
    }
    if (value.run.candidateInputHash !== value.candidateInputHash) {
      context.addIssue({
        code: "custom",
        path: ["candidateInputHash"],
        message: "transfer candidate input must match the run manifest",
      });
    }
    if (value.result.resolvedScenarioHash !== value.resolvedScenario.resolvedScenarioHash) {
      context.addIssue({
        code: "custom",
        path: ["result", "resolvedScenarioHash"],
        message: "result and transfer must reference the same resolved scenario",
      });
    }
    if (value.result.candidateInputHash !== value.candidateInputHash) {
      context.addIssue({
        code: "custom",
        path: ["result", "candidateInputHash"],
        message: "result and transfer must reference the same candidate input",
      });
    }
  });
export type ExactComparisonTransfer = z.infer<typeof ExactComparisonTransferSchema>;

export const WorkerMessageSchema = z.discriminatedUnion("direction", [
  z
    .object({
      schemaVersion: z.literal(CONTRACT_SCHEMA_VERSION),
      direction: z.literal("command"),
      payload: EngineCommandSchema,
    })
    .strict(),
  z
    .object({
      schemaVersion: z.literal(CONTRACT_SCHEMA_VERSION),
      direction: z.literal("event"),
      payload: EngineEventSchema,
    })
    .strict(),
  z
    .object({
      schemaVersion: z.literal(CONTRACT_SCHEMA_VERSION),
      direction: z.literal("step"),
      payload: EngineStepResultSchema,
    })
    .strict(),
]);
export type WorkerMessage = z.infer<typeof WorkerMessageSchema>;

export const ContractSchemas = {
  RulesetManifest: RulesetManifestSchema,
  ScenarioSpec: ScenarioSpecSchema,
  ResolvedScenario: ResolvedScenarioSchema,
  EntityState: EntityStateSchema,
  ItemInstance: ItemInstanceSchema,
  ActionPolicy: ActionPolicySchema,
  ObjectiveSpec: ObjectiveSpecSchema,
  SearchConstraints: SearchConstraintsSchema,
  EvaluationMode: EvaluationModeSchema,
  RunManifest: RunManifestSchema,
  MechanicEvidence: MechanicEvidenceSchema,
  Trace: TraceSchema,
  CombatResult: CombatResultSchema,
  EngineSnapshot: EngineSnapshotSchema,
  EngineCommand: EngineCommandSchema,
  EngineEvent: EngineEventSchema,
  EngineStepResult: EngineStepResultSchema,
  ExactComparisonTransfer: ExactComparisonTransferSchema,
  WorkerMessage: WorkerMessageSchema,
} as const;

export class ContractValidationError extends Error {
  readonly issues: z.core.$ZodIssue[];

  constructor(error: z.ZodError) {
    super(`contract validation failed: ${error.issues.map((issue) => issue.message).join("; ")}`);
    this.name = "ContractValidationError";
    this.issues = error.issues;
  }
}

export function parseContract<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ContractValidationError(parsed.error);
  return parsed.data;
}

function canonicalize(value: unknown, stack: Set<object>): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new TypeError("canonical JSON cannot contain non-finite numbers");
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (typeof value !== "object") {
    throw new TypeError(
      "canonical JSON cannot contain undefined, bigint, symbol, or function values",
    );
  }
  if (stack.has(value)) throw new TypeError("canonical JSON cannot contain cycles");
  stack.add(value);
  let result: string;
  if (Array.isArray(value)) {
    const entries: string[] = [];
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.prototype.hasOwnProperty.call(value, index)) {
        throw new TypeError("canonical JSON cannot contain sparse arrays");
      }
      entries.push(canonicalize(value[index], stack));
    }
    result = `[${entries.join(",")}]`;
  } else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("canonical JSON accepts plain objects only");
    }
    const object = value as Record<string, unknown>;
    const entries = Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize(object[key], stack)}`);
    result = `{${entries.join(",")}}`;
  }
  stack.delete(value);
  return result;
}

/** Stable key ordering is shared by hashes, cache identities, and replay files. */
export function canonicalJson(value: unknown): string {
  return canonicalize(value, new Set<object>());
}

export async function hashCanonical(value: unknown): Promise<ContentHash> {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  const hex = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `sha256:${hex}`;
}
