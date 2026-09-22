import { describe, expect, test } from "bun:test";

import {
  assertPinnedSourceSet,
  buildPinnedSourceSet,
  type PinnedSourceSet,
  type RetainedSourceBytes,
} from "../../src/domain/rulesets/source-validation";

const encoder = new TextEncoder();
const retainedSources: RetainedSourceBytes[] = [
  { artifactId: "ddragon-champions", bytes: encoder.encode('{"data":{"804":"Yunara"}}') },
  { artifactId: "ddragon-items", bytes: encoder.encode('{"data":{"3032":"Yun Tal"}}') },
  { artifactId: "cdragon-yunara", bytes: encoder.encode('{"mSpell":{"Buff_Duration":5}}') },
];

const sourceDraft = {
  schemaVersion: 1 as const,
  sourceSetId: "ruleset-26.18-sources",
  patch: "26.18",
  hotfixRevision: "26.18-cutoff-2026-09-18",
  dataDragonVersion: "16.18.1",
  communityDragonRevision: "16.18",
  regionApplicability: ["EUW1", "NA1"],
  requiredArtifactIds: ["ddragon-champions", "ddragon-items", "cdragon-yunara"],
  sourceArtifacts: [
    {
      artifact: {
        artifactId: "ddragon-items",
        kind: "data-dragon" as const,
        uri: "https://ddragon.leagueoflegends.com/cdn/16.18.1/data/en_US/item.json",
        version: "16.18.1",
        retrievedAt: "2026-09-18T12:00:00Z",
      },
      retainedPath: "static/patch=26.18/source=ddragon-items/item.json",
    },
    {
      artifact: {
        artifactId: "cdragon-yunara",
        kind: "community-dragon" as const,
        uri: "https://raw.communitydragon.org/16.18/game/data/characters/yunara/yunara.bin.json",
        version: "16.18",
        retrievedAt: "2026-09-18T12:00:00Z",
      },
      retainedPath: "static/patch=26.18/source=cdragon-yunara/yunara.bin.json",
    },
    {
      artifact: {
        artifactId: "ddragon-champions",
        kind: "data-dragon" as const,
        uri: "https://ddragon.leagueoflegends.com/cdn/16.18.1/data/en_US/champion.json",
        version: "16.18.1",
        retrievedAt: "2026-09-18T12:00:00Z",
      },
      retainedPath: "static/patch=26.18/source=ddragon-champions/champion.json",
    },
  ],
};

function clone<T>(value: T): T {
  return structuredClone(value);
}

describe("P02 retained source validation", () => {
  test("builds and verifies deterministic pinned source identity from retained bytes", async () => {
    const first = await buildPinnedSourceSet(sourceDraft, retainedSources);
    const reordered = await buildPinnedSourceSet(
      {
        ...sourceDraft,
        regionApplicability: [...sourceDraft.regionApplicability].reverse(),
        requiredArtifactIds: [...sourceDraft.requiredArtifactIds].reverse(),
        sourceArtifacts: [...sourceDraft.sourceArtifacts].reverse(),
      },
      [...retainedSources].reverse(),
    );

    expect(reordered).toEqual(first);
    expect(Object.isFrozen(first)).toBe(false);
    const verified = await assertPinnedSourceSet(first, retainedSources);
    expect(JSON.stringify(verified)).toBe(JSON.stringify(first));
    expect(Object.isFrozen(verified)).toBe(true);
    expect(verified.sourceSetHash).toMatch(/^sha256:[0-9a-f]{64}$/);

    const recaptured = await buildPinnedSourceSet(
      {
        ...sourceDraft,
        sourceArtifacts: sourceDraft.sourceArtifacts.map((source) => ({
          ...source,
          artifact: { ...source.artifact, retrievedAt: "2026-09-19T12:00:00Z" },
        })),
      },
      retainedSources,
    );
    expect(recaptured.sourceSetHash).toBe(first.sourceSetHash);
  });

  test("changes artifact and source-set hashes when retained bytes change", async () => {
    const original = await buildPinnedSourceSet(sourceDraft, retainedSources);
    const changedSources = retainedSources.map((source) =>
      source.artifactId === "ddragon-items"
        ? { ...source, bytes: encoder.encode('{"data":{"3032":"changed"}}') }
        : source,
    );
    const changed = await buildPinnedSourceSet(sourceDraft, changedSources);

    expect(
      changed.sourceArtifacts.find(({ artifact }) => artifact.artifactId === "ddragon-items")!
        .artifact.contentHash,
    ).not.toBe(
      original.sourceArtifacts.find(({ artifact }) => artifact.artifactId === "ddragon-items")!
        .artifact.contentHash,
    );
    expect(changed.sourceSetHash).not.toBe(original.sourceSetHash);

    const changedHotfix = await buildPinnedSourceSet(
      { ...sourceDraft, hotfixRevision: "26.18-cutoff-2026-09-19" },
      retainedSources,
    );
    expect(changedHotfix.sourceSetHash).not.toBe(original.sourceSetHash);
  });

  test("fails closed for missing, changed, undeclared, or traversal-prone retained sources", async () => {
    const built = await buildPinnedSourceSet(sourceDraft, retainedSources);
    await expect(assertPinnedSourceSet(built, retainedSources.slice(1))).rejects.toThrow(
      /must match the declared artifact inventory|missing retained bytes/,
    );
    await expect(
      assertPinnedSourceSet(built, [
        ...retainedSources.slice(0, 2),
        { artifactId: "cdragon-yunara", bytes: encoder.encode("changed") },
      ]),
    ).rejects.toThrow(/hash mismatch/);
    await expect(
      assertPinnedSourceSet(built, [
        ...retainedSources,
        { artifactId: "undeclared", bytes: encoder.encode("extra") },
      ]),
    ).rejects.toThrow(/inventory exactly|undeclared/);

    const traversal = clone(built);
    traversal.sourceArtifacts[0]!.retainedPath = "../outside.json";
    await expect(assertPinnedSourceSet(traversal, retainedSources)).rejects.toThrow(
      /cannot traverse parents/,
    );
  });

  test("rejects missing required sources, latest aliases, version drift, and stale set hashes", async () => {
    const built = await buildPinnedSourceSet(sourceDraft, retainedSources);

    const missingRequired = clone(built);
    missingRequired.requiredArtifactIds.push("manual-modes");
    await expect(assertPinnedSourceSet(missingRequired, retainedSources)).rejects.toThrow(
      /required source artifact manual-modes is missing/,
    );

    const latest = clone(built);
    latest.hotfixRevision = "latest";
    await expect(assertPinnedSourceSet(latest, retainedSources)).rejects.toThrow(/never latest/);

    const versionDrift = clone(built);
    const ddragon = versionDrift.sourceArtifacts.find(
      ({ artifact }) => artifact.kind === "data-dragon",
    )!;
    ddragon.artifact.version = "16.19.1";
    await expect(assertPinnedSourceSet(versionDrift, retainedSources)).rejects.toThrow(
      /must match the pinned version/,
    );

    const staleHash = clone(built) as PinnedSourceSet;
    staleHash.regionApplicability = ["KR"];
    await expect(assertPinnedSourceSet(staleHash, retainedSources)).rejects.toThrow(
      /source-set hash must match/,
    );
  });
});
