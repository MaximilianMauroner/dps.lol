import { z } from "zod";

import {
  ContentHashSchema,
  SourceArtifactSchema,
  canonicalJson,
  hashCanonical,
  parseContract,
  type ContentHash,
  type SourceArtifact,
} from "../contracts";

const identifier = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/, "must be a stable ASCII identifier");

const relativeArchivePath = z
  .string()
  .min(1)
  .refine((value) => !value.startsWith("/") && !value.split("/").includes(".."), {
    message: "retained paths must be relative and cannot traverse parents",
  });

export const RetainedSourceArtifactSchema = z
  .object({
    artifact: SourceArtifactSchema,
    retainedPath: relativeArchivePath,
  })
  .strict();
export type RetainedSourceArtifact = z.infer<typeof RetainedSourceArtifactSchema>;

export const PinnedSourceSetSchema = z
  .object({
    schemaVersion: z.literal(1),
    sourceSetId: identifier,
    patch: z.string().min(1),
    hotfixRevision: z.string().min(1),
    dataDragonVersion: z.string().min(1),
    communityDragonRevision: z.string().min(1),
    regionApplicability: z.array(identifier).min(1),
    requiredArtifactIds: z.array(identifier).min(1),
    sourceArtifacts: z.array(RetainedSourceArtifactSchema).min(1),
    sourceSetHash: ContentHashSchema,
  })
  .strict()
  .superRefine((value, context) => {
    const artifactIds = value.sourceArtifacts.map(({ artifact }) => artifact.artifactId);
    if (new Set(artifactIds).size !== artifactIds.length) {
      context.addIssue({
        code: "custom",
        path: ["sourceArtifacts"],
        message: "retained source artifact IDs must be unique",
      });
    }
    const retainedPaths = value.sourceArtifacts.map(({ retainedPath }) => retainedPath);
    if (new Set(retainedPaths).size !== retainedPaths.length) {
      context.addIssue({
        code: "custom",
        path: ["sourceArtifacts"],
        message: "retained source paths must be unique",
      });
    }
    if (new Set(value.requiredArtifactIds).size !== value.requiredArtifactIds.length) {
      context.addIssue({
        code: "custom",
        path: ["requiredArtifactIds"],
        message: "required source artifact IDs must be unique",
      });
    }
    if (new Set(value.regionApplicability).size !== value.regionApplicability.length) {
      context.addIssue({
        code: "custom",
        path: ["regionApplicability"],
        message: "region applicability IDs must be unique",
      });
    }
  });
export type PinnedSourceSet = z.infer<typeof PinnedSourceSetSchema>;

export type RetainedSourceBytes = Readonly<{
  artifactId: string;
  bytes: Uint8Array;
}>;

type SourceSetDraft = Omit<PinnedSourceSet, "sourceArtifacts" | "sourceSetHash"> &
  Readonly<{
    sourceArtifacts: ReadonlyArray<
      Omit<RetainedSourceArtifact, "artifact"> &
        Readonly<{ artifact: Omit<SourceArtifact, "contentHash"> }>
    >;
  }>;

declare const verifiedPinnedSources: unique symbol;
export type VerifiedPinnedSourceSet = Readonly<PinnedSourceSet> & {
  readonly [verifiedPinnedSources]: true;
};

function sourceSetHashBytes(value: PinnedSourceSet): unknown {
  return {
    schemaVersion: value.schemaVersion,
    sourceSetId: value.sourceSetId,
    patch: value.patch,
    hotfixRevision: value.hotfixRevision,
    dataDragonVersion: value.dataDragonVersion,
    communityDragonRevision: value.communityDragonRevision,
    regionApplicability: value.regionApplicability,
    requiredArtifactIds: value.requiredArtifactIds,
    sourceArtifacts: value.sourceArtifacts.map(({ artifact, retainedPath }) => ({
      artifact: {
        artifactId: artifact.artifactId,
        kind: artifact.kind,
        uri: artifact.uri,
        version: artifact.version,
        contentHash: artifact.contentHash,
      },
      retainedPath,
    })),
  };
}

function assertExplicitVersionPin(value: PinnedSourceSet): void {
  const forbidden = /(^|[./_-])(?:latest|current)(?:$|[./_-])/i;
  if (
    forbidden.test(value.patch) ||
    forbidden.test(value.hotfixRevision) ||
    forbidden.test(value.dataDragonVersion) ||
    forbidden.test(value.communityDragonRevision)
  ) {
    throw new TypeError("ruleset sources must use explicit versions, never latest/current");
  }

  for (const { artifact } of value.sourceArtifacts) {
    if (forbidden.test(artifact.uri) || forbidden.test(artifact.version)) {
      throw new TypeError(
        `source artifact ${artifact.artifactId} is not explicitly version-pinned`,
      );
    }
    if (
      artifact.kind === "data-dragon" &&
      (artifact.version !== value.dataDragonVersion ||
        !artifact.uri.includes(`/${value.dataDragonVersion}/`))
    ) {
      throw new TypeError(
        `Data Dragon artifact ${artifact.artifactId} must match the pinned version`,
      );
    }
    if (
      artifact.kind === "community-dragon" &&
      (artifact.version !== value.communityDragonRevision ||
        !artifact.uri.includes(`/${value.communityDragonRevision}/`))
    ) {
      throw new TypeError(
        `CommunityDragon artifact ${artifact.artifactId} must match the pinned revision`,
      );
    }
  }
}

function retainedBytesById(
  sources: readonly RetainedSourceBytes[],
): ReadonlyMap<string, Uint8Array> {
  const result = new Map<string, Uint8Array>();
  for (const source of sources) {
    if (result.has(source.artifactId))
      throw new TypeError(`retained source bytes duplicate artifact ${source.artifactId}`);
    result.set(source.artifactId, source.bytes);
  }
  return result;
}

async function hashBytes(bytes: Uint8Array): Promise<ContentHash> {
  const stableBytes = Uint8Array.from(bytes);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", stableBytes.buffer);
  const hex = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `sha256:${hex}`;
}

function deepFreeze(value: unknown): void {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return;
  for (const child of Object.values(value)) deepFreeze(child);
  Object.freeze(value);
}

export async function buildPinnedSourceSet(
  draft: SourceSetDraft,
  retainedSources: readonly RetainedSourceBytes[],
): Promise<PinnedSourceSet> {
  const bytesById = retainedBytesById(retainedSources);
  const declaredArtifactIds = new Set(
    draft.sourceArtifacts.map(({ artifact }) => artifact.artifactId),
  );
  if (bytesById.size !== declaredArtifactIds.size)
    throw new TypeError("retained source bytes must match the declared artifact inventory exactly");
  for (const artifactId of bytesById.keys()) {
    if (!declaredArtifactIds.has(artifactId))
      throw new TypeError(`retained bytes for undeclared source artifact ${artifactId}`);
  }
  const sourceArtifacts = await Promise.all(
    [...draft.sourceArtifacts]
      .sort((left, right) => left.artifact.artifactId.localeCompare(right.artifact.artifactId))
      .map(async ({ artifact, retainedPath }) => {
        const bytes = bytesById.get(artifact.artifactId);
        if (!bytes) throw new TypeError(`missing retained bytes for ${artifact.artifactId}`);
        return {
          artifact: { ...artifact, contentHash: await hashBytes(bytes) },
          retainedPath,
        };
      }),
  );
  const candidate = parseContract(PinnedSourceSetSchema, {
    ...draft,
    regionApplicability: [...draft.regionApplicability].sort(),
    requiredArtifactIds: [...draft.requiredArtifactIds].sort(),
    sourceArtifacts,
    sourceSetHash: `sha256:${"0".repeat(64)}`,
  });
  candidate.sourceSetHash = await hashCanonical(sourceSetHashBytes(candidate));
  return parseContract(PinnedSourceSetSchema, candidate);
}

export async function assertPinnedSourceSet(
  value: unknown,
  retainedSources: readonly RetainedSourceBytes[],
): Promise<VerifiedPinnedSourceSet> {
  const sourceSet = parseContract(PinnedSourceSetSchema, value);
  assertExplicitVersionPin(sourceSet);
  const artifactsById = new Map(
    sourceSet.sourceArtifacts.map(({ artifact }) => [artifact.artifactId, artifact]),
  );
  for (const artifactId of sourceSet.requiredArtifactIds) {
    if (!artifactsById.has(artifactId))
      throw new TypeError(`required source artifact ${artifactId} is missing`);
  }

  const bytesById = retainedBytesById(retainedSources);
  if (bytesById.size !== artifactsById.size)
    throw new TypeError("retained source bytes must match the declared artifact inventory exactly");
  for (const [artifactId, artifact] of artifactsById) {
    const bytes = bytesById.get(artifactId);
    if (!bytes) throw new TypeError(`missing retained bytes for ${artifactId}`);
    if ((await hashBytes(bytes)) !== artifact.contentHash)
      throw new TypeError(`retained source hash mismatch for ${artifactId}`);
  }
  for (const artifactId of bytesById.keys()) {
    if (!artifactsById.has(artifactId))
      throw new TypeError(`retained bytes for undeclared source artifact ${artifactId}`);
  }

  const actualSourceSetHash = await hashCanonical(sourceSetHashBytes(sourceSet));
  if (actualSourceSetHash !== sourceSet.sourceSetHash)
    throw new TypeError("source-set hash must match canonical pinned source metadata");

  // Prove the value remains a canonical P01-compatible data value before publication.
  canonicalJson(sourceSet);
  deepFreeze(sourceSet);
  return sourceSet as VerifiedPinnedSourceSet;
}
