import { ITEMS, type ItemMechanic } from "./items";
import type {
  Build,
  BuildValidation,
  BuildValidationReason,
  OptimizerBootRule,
  OptimizerCandidate,
  OptimizerConstraints,
  OptimizerEligibility,
  OptimizerGenerationOptions,
} from "./types";

export type {
  BuildValidation,
  BuildValidationReason,
  OptimizerBootRule,
  OptimizerCandidate,
  OptimizerConstraints,
  OptimizerEligibility,
  OptimizerGenerationOptions,
  OptimizerMetric,
  OptimizerObjective,
} from "./types";

/**
 * The curated catalog is deliberately finite. The optimizer must not turn
 * every Data Dragon item into a candidate while its mechanics are absent from
 * the simulator.
 */
export const OPTIMIZER_ELIGIBLE_ITEM_IDS = Object.keys(ITEMS)
  .map(Number)
  .sort((left, right) => left - right);

/**
 * Realistic full-build defaults. Callers can opt into no-boots or partial
 * builds explicitly for experiments and progression-state searches.
 */
export const DEFAULT_OPTIMIZER_CONSTRAINTS: OptimizerConstraints = {
  slotCount: 6,
  bootRule: "required",
  maxBoots: 1,
};

interface CatalogLike {
  readonly [itemId: number]: ItemMechanic | undefined;
}

interface ResolvedOptions {
  catalog: CatalogLike;
  eligibleItemIds: number[];
  constraints: OptimizerConstraints;
}

interface ValidationOptions {
  eligibleItemIds?: readonly number[];
  constraints?: Partial<OptimizerConstraints>;
  catalog?: CatalogLike;
}

/** Returns the sorted, de-duplicated IDs accepted by the optimizer catalog. */
export function optimizerEligibleItemIds(
  catalog: CatalogLike = ITEMS,
  requestedItemIds?: readonly number[],
): number[] {
  const source = requestedItemIds ?? Object.keys(catalog).map(Number);
  return [...new Set(source)]
    .filter((itemId) => Number.isInteger(itemId) && catalog[itemId] !== undefined)
    .sort((left, right) => left - right);
}

export const getOptimizerEligibleItemIds = optimizerEligibleItemIds;

/**
 * Resolves an explicit pool into known eligible IDs and reports values that
 * cannot be simulated. Duplicate input IDs are reported rather than allowed
 * to create duplicate candidate branches.
 */
export function resolveOptimizerEligibility(
  requestedItemIds: readonly number[] = OPTIMIZER_ELIGIBLE_ITEM_IDS,
  catalog: CatalogLike = ITEMS,
): OptimizerEligibility {
  const seen = new Set<number>();
  const duplicateItemIds = new Set<number>();
  const unsupportedItemIds = new Set<number>();

  for (const itemId of requestedItemIds) {
    if (!Number.isInteger(itemId) || catalog[itemId] === undefined) {
      unsupportedItemIds.add(itemId);
      continue;
    }
    if (seen.has(itemId)) duplicateItemIds.add(itemId);
    seen.add(itemId);
  }

  return {
    eligibleItemIds: [...seen].sort((left, right) => left - right),
    unsupportedItemIds: [...unsupportedItemIds].sort(compareNumbers),
    duplicateItemIds: [...duplicateItemIds].sort(compareNumbers),
  };
}

export function isOptimizerEligibleItem(itemId: number, catalog: CatalogLike = ITEMS): boolean {
  return Number.isInteger(itemId) && catalog[itemId] !== undefined;
}

/**
 * Canonical item order is numeric and independent of purchase/UI order. It
 * intentionally preserves duplicate IDs: duplicate builds are illegal, and
 * collapsing them here would make an invalid build share an identity with a
 * different legal build.
 */
export function canonicalizeItemIds(itemIds: readonly number[]): number[] {
  return [...itemIds].sort(compareNumbers);
}

export const canonicalBuildItemIds = canonicalizeItemIds;

export function canonicalizeBuild(build: Build): Build {
  return { ...build, itemIds: canonicalizeItemIds(build.itemIds) };
}

export function canonicalBuildKey(buildOrItemIds: Build | readonly number[]): string {
  const itemIds = isBuild(buildOrItemIds) ? buildOrItemIds.itemIds : buildOrItemIds;
  return canonicalizeItemIds(itemIds).join(",");
}

/** An order-insensitive identity used for candidate de-duplication/cache keys. */
export const canonicalBuildIdentity = canonicalBuildKey;
export const buildIdentity = canonicalBuildKey;
export const buildKey = canonicalBuildKey;

export function sameBuildIdentity(
  left: Build | readonly number[],
  right: Build | readonly number[],
): boolean {
  return canonicalBuildKey(left) === canonicalBuildKey(right);
}

/**
 * Validates one candidate against the same rules used by exhaustive
 * generation. Keeping this as a pure function prevents the generator and a
 * future API/UI validator from drifting apart.
 */
export function validateBuild(
  buildOrItemIds: Build | readonly number[],
  optionsOrConstraints: ValidationOptions | Partial<OptimizerConstraints> = {},
  eligibleItemIds?: readonly number[],
): BuildValidation {
  const {
    catalog,
    eligibleItemIds: eligible,
    constraints,
  } = resolveValidationOptions(optionsOrConstraints, eligibleItemIds);
  const itemIds = isBuild(buildOrItemIds) ? [...buildOrItemIds.itemIds] : [...buildOrItemIds];
  const reasons: BuildValidationReason[] = [];
  const eligibleSet = new Set(eligible);
  const required = new Set(constraints.requiredItemIds ?? []);
  const excluded = new Set(constraints.excludedItemIds ?? []);
  const knownIds = new Set(Object.keys(catalog).map(Number));
  const unsupported = itemIds.some((itemId) => !Number.isInteger(itemId) || !knownIds.has(itemId));
  const ineligible = itemIds.some((itemId) => knownIds.has(itemId) && !eligibleSet.has(itemId));
  const duplicate = new Set(itemIds).size !== itemIds.length;
  const bootCount = itemIds.reduce(
    (count, itemId) => count + (catalog[itemId]?.boots === true ? 1 : 0),
    0,
  );
  const totalGold = itemIds.reduce((total, itemId) => total + (catalog[itemId]?.goldTotal ?? 0), 0);

  if (itemIds.length !== constraints.slotCount) reasons.push("wrong-slot-count");
  if (unsupported) reasons.push("unsupported-item");
  if (ineligible) reasons.push("ineligible-item");
  if (duplicate) reasons.push("duplicate-item");

  const bootRule = normalizedBootRule(constraints);
  const maxBoots = normalizedMaxBoots(constraints);
  if (bootRule === "required" && bootCount === 0) reasons.push("boots-required");
  if (bootRule === "forbidden" && bootCount > 0) reasons.push("boots-forbidden");
  if (bootCount > maxBoots) reasons.push("too-many-boots");

  if ([...required].some((itemId) => !itemIds.includes(itemId))) {
    reasons.push("required-item-missing");
  }
  if (itemIds.some((itemId) => excluded.has(itemId))) reasons.push("excluded-item");
  if (constraints.maxGold !== undefined && totalGold > constraints.maxGold) {
    reasons.push("above-max-gold");
  }
  if (constraints.minGold !== undefined && totalGold < constraints.minGold) {
    reasons.push("below-min-gold");
  }

  return {
    legal: reasons.length === 0,
    reasons,
    totalGold,
    bootCount,
  };
}

export function isLegalBuild(
  buildOrItemIds: Build | readonly number[],
  optionsOrConstraints: ValidationOptions | Partial<OptimizerConstraints> = {},
  eligibleItemIds?: readonly number[],
): boolean {
  return validateBuild(buildOrItemIds, optionsOrConstraints, eligibleItemIds).legal;
}

/**
 * Enumerates combinations, never permutations. Every generated build is
 * canonical, unique, and validated against the exact same legal-build
 * predicate. No item-level stat heuristic is used, so item synergies cannot
 * disappear merely because one partner is weak in isolation.
 */
export function generateLegalBuilds(
  optionsOrEligibleItemIds: OptimizerGenerationOptions | readonly number[] = {},
  constraintsArgument: Partial<OptimizerConstraints> = {},
): Build[] {
  const options = resolveGenerationOptions(optionsOrEligibleItemIds, constraintsArgument);
  const { catalog, eligibleItemIds, constraints } = options;
  const required = [...new Set(constraints.requiredItemIds ?? [])].sort(compareNumbers);

  if (!canGenerate(required, eligibleItemIds, constraints, catalog)) return [];

  const optionalIds = eligibleItemIds.filter((itemId) => !required.includes(itemId));
  const selected: number[] = [...required];
  const generated: Build[] = [];
  const targetOptionalCount = constraints.slotCount - required.length;

  function visit(start: number, remaining: number): void {
    if (remaining === 0) {
      const itemIds = canonicalizeItemIds(selected);
      if (
        isLegalBuild(itemIds, {
          catalog,
          eligibleItemIds,
          constraints,
        })
      ) {
        generated.push({
          name: buildName(itemIds, catalog),
          itemIds,
        });
      }
      return;
    }

    const lastStart = optionalIds.length - remaining;
    for (let index = start; index <= lastStart; index += 1) {
      selected.push(optionalIds[index]!);
      visit(index + 1, remaining - 1);
      selected.pop();
    }
  }

  visit(0, targetOptionalCount);
  generated.sort((left, right) => compareCanonicalIds(left.itemIds, right.itemIds));
  return generated;
}

/** Alias emphasizing that this is exhaustive rather than heuristic search. */
export const generateExhaustiveBuilds = generateLegalBuilds;
export const generateLegalCandidateBuilds = generateLegalBuilds;

export function generateCandidateBuilds(
  optionsOrEligibleItemIds: OptimizerGenerationOptions | readonly number[] = {},
  constraintsArgument: Partial<OptimizerConstraints> = {},
): OptimizerCandidate[] {
  const options = resolveGenerationOptions(optionsOrEligibleItemIds, constraintsArgument);
  return generateLegalBuilds(options).map((build) => ({
    ...build,
    identity: canonicalBuildKey(build),
    goldTotal: totalGold(build.itemIds, options.catalog),
  }));
}

export const generateOptimizerCandidates = generateCandidateBuilds;

function resolveGenerationOptions(
  optionsOrEligibleItemIds: OptimizerGenerationOptions | readonly number[],
  constraintsArgument: Partial<OptimizerConstraints>,
): ResolvedOptions {
  const objectOptions = isGenerationOptions(optionsOrEligibleItemIds)
    ? optionsOrEligibleItemIds
    : undefined;
  const catalog = ITEMS;
  const requestedItemIds = objectOptions
    ? objectOptions.eligibleItemIds
    : (optionsOrEligibleItemIds as readonly number[]);
  const eligibility = resolveOptimizerEligibility(requestedItemIds ?? OPTIMIZER_ELIGIBLE_ITEM_IDS);
  const suppliedConstraints = objectOptions?.constraints ?? constraintsArgument;
  return {
    catalog,
    eligibleItemIds: eligibility.eligibleItemIds,
    constraints: normalizeConstraints(suppliedConstraints),
  };
}

function resolveValidationOptions(
  optionsOrConstraints: ValidationOptions | Partial<OptimizerConstraints>,
  eligibleItemIds?: readonly number[],
): ResolvedOptions {
  const looksLikeOptions =
    "constraints" in optionsOrConstraints ||
    "eligibleItemIds" in optionsOrConstraints ||
    "catalog" in optionsOrConstraints;
  const options = looksLikeOptions ? (optionsOrConstraints as ValidationOptions) : undefined;
  const constraints =
    options?.constraints ?? (optionsOrConstraints as Partial<OptimizerConstraints>);
  const catalog = options?.catalog ?? ITEMS;
  const requestedItemIds = options?.eligibleItemIds ?? eligibleItemIds;
  const eligibility = resolveOptimizerEligibility(
    requestedItemIds ?? Object.keys(catalog).map(Number),
    catalog,
  );
  return {
    catalog,
    eligibleItemIds: eligibility.eligibleItemIds,
    constraints: normalizeConstraints(constraints),
  };
}

function normalizeConstraints(supplied: Partial<OptimizerConstraints> = {}): OptimizerConstraints {
  const constraints: OptimizerConstraints = {
    ...DEFAULT_OPTIMIZER_CONSTRAINTS,
    ...supplied,
  };
  if (supplied.requireBoots !== undefined && supplied.bootRule === undefined) {
    constraints.bootRule = supplied.requireBoots ? "required" : "optional";
  }
  constraints.requiredItemIds = [...new Set(constraints.requiredItemIds ?? [])];
  constraints.excludedItemIds = [...new Set(constraints.excludedItemIds ?? [])];
  return constraints;
}

function normalizedBootRule(constraints: OptimizerConstraints): OptimizerBootRule {
  if (constraints.bootRule) return constraints.bootRule;
  if (constraints.requireBoots !== undefined)
    return constraints.requireBoots ? "required" : "optional";
  return DEFAULT_OPTIMIZER_CONSTRAINTS.bootRule!;
}

function normalizedMaxBoots(constraints: OptimizerConstraints): number {
  if (normalizedBootRule(constraints) === "forbidden") return 0;
  return Math.min(1, Math.max(0, Math.floor(constraints.maxBoots ?? 1)));
}

function canGenerate(
  required: readonly number[],
  eligibleItemIds: readonly number[],
  constraints: OptimizerConstraints,
  catalog: CatalogLike,
): boolean {
  if (!Number.isInteger(constraints.slotCount) || constraints.slotCount < 0) return false;
  if (required.length > constraints.slotCount) return false;
  const eligible = new Set(eligibleItemIds);
  const excluded = new Set(constraints.excludedItemIds ?? []);
  if (required.some((itemId) => !eligible.has(itemId) || excluded.has(itemId))) return false;
  if (required.some((itemId) => catalog[itemId] === undefined)) return false;
  if (new Set(required).size !== required.length) return false;
  if (constraints.maxGold !== undefined && constraints.maxGold < 0) return false;
  if (constraints.minGold !== undefined && constraints.minGold < 0) return false;
  if (
    constraints.maxGold !== undefined &&
    constraints.minGold !== undefined &&
    constraints.minGold > constraints.maxGold
  ) {
    return false;
  }
  const requiredBoots = required.filter((itemId) => catalog[itemId]?.boots === true).length;
  if (requiredBoots > normalizedMaxBoots(constraints)) return false;
  if (normalizedBootRule(constraints) === "required" && requiredBoots === 0) {
    const canAddBoot = eligibleItemIds.some(
      (itemId) =>
        !required.includes(itemId) && !excluded.has(itemId) && catalog[itemId]?.boots === true,
    );
    if (!canAddBoot) return false;
  }
  if (normalizedBootRule(constraints) === "forbidden" && requiredBoots > 0) return false;
  return true;
}

function buildName(itemIds: readonly number[], catalog: CatalogLike): string {
  return itemIds.map((itemId) => catalog[itemId]?.name ?? String(itemId)).join(" + ");
}

function totalGold(itemIds: readonly number[], catalog: CatalogLike): number {
  return itemIds.reduce((total, itemId) => total + (catalog[itemId]?.goldTotal ?? 0), 0);
}

function compareNumbers(left: number, right: number): number {
  return left - right;
}

function compareCanonicalIds(left: readonly number[], right: readonly number[]): number {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const difference = left[index]! - right[index]!;
    if (difference !== 0) return difference;
  }
  return left.length - right.length;
}

function isBuild(value: Build | readonly number[]): value is Build {
  return !Array.isArray(value);
}

function isGenerationOptions(
  value: OptimizerGenerationOptions | readonly number[],
): value is OptimizerGenerationOptions {
  return !Array.isArray(value);
}
