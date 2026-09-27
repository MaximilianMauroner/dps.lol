import { SourceArtifactSchema, hashCanonical } from "../contracts";
import { discoverDataDragonIndex } from "./ddragon-discovery";
import { assertPinnedSourceArtifactUrl, hashRetainedSourceBytes } from "./source-validation";

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function visibleListingHtml(html: string): string {
  // The pinned listing uses scripts in its page chrome. Their contents are not
  // directory markup, even when they contain literal <h1> or <table> strings.
  const visible = html.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "");
  if (
    /<\/?script\b/i.test(visible) ||
    /<!--|-->/.test(visible) ||
    /<\/?(?:style|template|textarea|noscript|xmp|iframe|noembed|noframes|plaintext)\b/i.test(
      visible,
    )
  )
    throw new TypeError("character directory contains unsupported or unclosed HTML containers");
  return visible;
}

/** Parse only the revision-pinned CommunityDragon character directory table. */
async function discoverCharacterDirectories(rawArtifact: unknown, bytes: Uint8Array) {
  const artifact = SourceArtifactSchema.parse(rawArtifact);
  if (artifact.kind !== "community-dragon")
    throw new TypeError("character directory requires a CommunityDragon artifact");
  const url = assertPinnedSourceArtifactUrl(artifact);
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(artifact.version) ||
    url.pathname !== `/${artifact.version}/game/data/characters/` ||
    artifact.uri.includes("?") ||
    artifact.version.toLowerCase() === "pbe"
  )
    throw new TypeError("character directory requires a pinned CommunityDragon listing URL");
  const retained = Uint8Array.from(bytes);
  if ((await hashRetainedSourceBytes(retained)) !== artifact.contentHash)
    throw new TypeError("CommunityDragon character directory bytes do not match the artifact hash");
  const html = visibleListingHtml(new TextDecoder("utf-8", { fatal: true }).decode(retained));
  const bodies = [...html.matchAll(/<body(?:\s[^>]*)?>([\s\S]*?)<\/body>/gi)];
  if (bodies.length !== 1) throw new TypeError("character directory requires one HTML body");
  const body = bodies[0]![1]!;
  if (/<\/?title\b/i.test(body))
    throw new TypeError("character directory body contains unsupported raw text");
  const headings = [...body.matchAll(/<h1>\s*([^<]*?)\s*<\/h1>/g)];
  if (headings.length !== 1 || headings[0]![1]!.trim() !== url.pathname)
    throw new TypeError("CommunityDragon directory heading conflicts with its pinned URL");
  const listings = [...body.matchAll(/<table id="list">([\s\S]*?)<\/table>/g)];
  if (listings.length !== 1 || listings[0]!.index! < headings[0]!.index!)
    throw new TypeError("character directory requires one listing table after its heading");
  const tables = [...listings[0]![1]!.matchAll(/<tbody>([\s\S]*?)<\/tbody>/g)];
  if (tables.length !== 1) throw new TypeError("character directory requires one table body");
  const table = tables[0]![1]!;
  const rowPattern = /<tr>[\s\S]*?<\/tr>/g;
  const rows = [...table.matchAll(rowPattern)].map((match) => match[0]);
  if (rows.length < 2 || table.replace(rowPattern, "").trim())
    throw new TypeError("character directory has missing or malformed listing rows");
  const rowShape =
    /^<tr><td class="link"><a href="([^"]+)"(?: title="([^"]+)")?>([^<]+)<\/a><\/td><td class="size">[^<]*<\/td><td class="date">[^<]*<\/td><\/tr>$/;
  const directories: string[] = [];
  let parentCount = 0;
  for (const row of rows) {
    const fields = rowShape.exec(row);
    if (!fields) throw new TypeError("character directory contains a malformed listing row");
    const [, href, title, label] = fields;
    if (href === "../" && title === undefined && label === "Parent directory/") {
      parentCount++;
      continue;
    }
    if (!/^[a-z0-9_]+\/$/.test(href!) || title !== href!.slice(0, -1) || label !== href)
      throw new TypeError(`character directory contains an unsafe or conflicting link ${href}`);
    directories.push(href!.slice(0, -1));
  }
  if (
    parentCount !== 1 ||
    directories.length === 0 ||
    new Set(directories).size !== directories.length
  )
    throw new TypeError("character directory requires one parent and unique source links");
  return { artifact, directories: directories.sort(compare) };
}

/** Match exact directory names to a verified Data Dragon roster; extras remain unclassified. */
export async function discoverCommunityDragonDirectoryRoster(
  rawChampionIndexArtifact: unknown,
  championIndexBytes: Uint8Array,
  rawDirectoryArtifact: unknown,
  directoryBytes: Uint8Array,
) {
  const stableIndex = Uint8Array.from(championIndexBytes);
  const stableDirectory = Uint8Array.from(directoryBytes);
  const [index, listing] = await Promise.all([
    discoverDataDragonIndex(rawChampionIndexArtifact, stableIndex),
    discoverCharacterDirectories(rawDirectoryArtifact, stableDirectory),
  ]);
  if (index.kind !== "champion-index")
    throw new TypeError("directory roster requires a Data Dragon champion index");
  if (index.artifact.artifactId === listing.artifact.artifactId)
    throw new TypeError("directory roster requires distinct source artifact IDs");
  const available = new Set(listing.directories);
  const missing = index.entries.filter((entry) => !available.has(entry.slug.toLowerCase()));
  if (missing.length)
    throw new TypeError(
      `CommunityDragon directory missing roster slugs: ${missing.map((entry) => entry.slug).join(", ")}`,
    );
  const rosterNames = new Set(index.entries.map((entry) => entry.slug.toLowerCase()));
  if (rosterNames.size !== index.entries.length)
    throw new TypeError("Data Dragon roster slugs conflict after directory normalization");
  const body = {
    schemaVersion: 1 as const,
    scope: "community-dragon-directory-roster-only" as const,
    pcPatchMappingReviewed: false as const,
    combatComplete: false as const,
    sources: {
      championIndex: {
        artifactId: index.artifact.artifactId,
        uri: index.artifact.uri,
        version: index.artifact.version,
        contentHash: index.artifact.contentHash,
      },
      characterDirectory: {
        artifactId: listing.artifact.artifactId,
        uri: listing.artifact.uri,
        revision: listing.artifact.version,
        contentHash: listing.artifact.contentHash,
      },
    },
    rosterDirectories: index.entries.map((entry) => ({
      id: entry.id,
      slug: entry.slug,
      championIndexPointer: entry.sourcePointer,
      directoryHref: `${entry.slug.toLowerCase()}/`,
    })),
    unclassifiedDirectoryHrefs: listing.directories
      .filter((slug) => !rosterNames.has(slug))
      .map((slug) => `${slug}/`),
  };
  return { ...body, rosterHash: await hashCanonical(body) };
}

export type CommunityDragonDirectoryRoster = Awaited<
  ReturnType<typeof discoverCommunityDragonDirectoryRoster>
>;
