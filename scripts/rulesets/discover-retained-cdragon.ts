import { canonicalJson, hashCanonical } from "../../src/domain/contracts";
import { discoverCommunityDragonChampionGraph } from "../../src/domain/rulesets/cdragon-champion-graph";
import {
  loadVerifiedRetainedSourceFiles,
  readRetainedManifest,
  type RetainedFileLimits,
} from "./verify-retained";

/** Verify the whole retained set, then inventory one selected CommunityDragon character. */
export async function discoverRetainedCommunityDragonChampion(
  manifest: unknown,
  directory: string,
  artifactId: string,
  limits?: RetainedFileLimits,
) {
  if (!artifactId) throw new TypeError("select one CommunityDragon artifact ID");
  const { sourceSet, retained } = await loadVerifiedRetainedSourceFiles(
    manifest,
    directory,
    limits,
  );
  const entry = sourceSet.sourceArtifacts.find(
    (source) => source.artifact.artifactId === artifactId,
  );
  const bytes = retained.find((source) => source.artifactId === artifactId)?.bytes;
  if (!entry || !bytes) throw new TypeError(`unknown retained source artifact ${artifactId}`);
  const graph = await discoverCommunityDragonChampionGraph(entry.artifact, bytes);
  const body = {
    schemaVersion: 1 as const,
    scope: "retained-community-dragon-character-graph-only" as const,
    sourceSetId: sourceSet.sourceSetId,
    sourceSetHash: sourceSet.sourceSetHash,
    selectedRetainedPath: entry.retainedPath,
    graph,
    undiscoveredArtifactIds: sourceSet.sourceArtifacts
      .map((source) => source.artifact.artifactId)
      .filter((id) => id !== artifactId),
  };
  return { ...body, reportHash: await hashCanonical(body) };
}

if (import.meta.main) {
  const [manifestPath, directory, artifactId] = process.argv.slice(2);
  if (!manifestPath || !directory || !artifactId || process.argv.length !== 5) {
    console.error(
      "Usage: bun scripts/rulesets/discover-retained-cdragon.ts <source-set.json> <retained-directory> <artifact-id>",
    );
    process.exitCode = 2;
  } else {
    try {
      console.log(
        canonicalJson(
          await discoverRetainedCommunityDragonChampion(
            await readRetainedManifest(manifestPath),
            directory,
            artifactId,
          ),
        ),
      );
    } catch (error) {
      console.error(error instanceof Error ? error.message : "retained graph discovery failed");
      process.exitCode = 1;
    }
  }
}
