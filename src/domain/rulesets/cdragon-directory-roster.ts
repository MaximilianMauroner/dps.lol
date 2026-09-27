import { SourceArtifactSchema, hashCanonical } from "../contracts";
import { discoverDataDragonIndex } from "./ddragon-discovery";
import { assertPinnedSourceArtifactUrl, hashRetainedSourceBytes } from "./source-validation";

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

type ListingRow = {
  cellCount: number;
  linkCellCount: number;
  linkCellText: string;
  sizeCellCount: number;
  dateCellCount: number;
  anchorCount: number;
  links: Array<{ href: string | null; title: string | null; label: string }>;
};

async function parsedListing(html: string) {
  let bodyCount = 0;
  let headingCount = 0;
  let heading = "";
  let headingOrder = 0;
  let tableCount = 0;
  let tableOrder = 0;
  let tableBodyCount = 0;
  let tableAnchorCount = 0;
  const sortHrefs: Array<string | null> = [];
  let templateCount = 0;
  let canvasCount = 0;
  let baseCount = 0;
  let hiddenCount = 0;
  let order = 0;
  const rows: ListingRow[] = [];
  function currentRow(): ListingRow {
    const current = rows.at(-1);
    if (!current)
      throw new TypeError("character directory contains a cell outside its listing row");
    return current;
  }
  const selector = "body table#list > tbody > tr";
  const rewriter = new HTMLRewriter()
    .on("*", {
      element: (element) => {
        // Bun returns null for valueless boolean attributes via getAttribute.
        if ([...element.attributes].some(([name]) => name.toLowerCase() === "hidden"))
          hiddenCount++;
      },
    })
    .on("body", {
      element: () => {
        bodyCount++;
      },
    })
    .on("template", {
      element: () => {
        templateCount++;
      },
    })
    .on("canvas", {
      element: () => {
        canvasCount++;
      },
    })
    .on("base", {
      element: () => {
        baseCount++;
      },
    })
    .on("body h1", {
      element: () => {
        headingCount++;
        headingOrder = ++order;
      },
      text: (chunk) => {
        heading += chunk.text;
      },
    })
    .on("body table#list", {
      element: () => {
        tableCount++;
        tableOrder = ++order;
      },
    })
    .on("body table#list > tbody", {
      element: () => {
        tableBodyCount++;
      },
    })
    .on("body table#list a", {
      element: () => {
        tableAnchorCount++;
      },
    })
    .on("body table#list > thead > tr > th > a", {
      element: (element) => {
        sortHrefs.push(element.getAttribute("href"));
      },
    })
    .on(selector, {
      element: () => {
        rows.push({
          cellCount: 0,
          linkCellCount: 0,
          linkCellText: "",
          sizeCellCount: 0,
          dateCellCount: 0,
          anchorCount: 0,
          links: [],
        });
      },
    })
    .on(`${selector} > td`, {
      element: () => {
        currentRow().cellCount++;
      },
    })
    .on(`${selector} > td.link`, {
      element: () => {
        currentRow().linkCellCount++;
      },
      text: (chunk) => {
        currentRow().linkCellText += chunk.text;
      },
    })
    .on(`${selector} > td.size`, {
      element: () => {
        currentRow().sizeCellCount++;
      },
    })
    .on(`${selector} > td.date`, {
      element: () => {
        currentRow().dateCellCount++;
      },
    })
    .on(`${selector} a`, {
      element: () => {
        currentRow().anchorCount++;
      },
    })
    .on(`${selector} > td.link > a`, {
      element: (element) => {
        currentRow().links.push({
          href: element.getAttribute("href"),
          title: element.getAttribute("title"),
          label: "",
        });
      },
      text: (chunk) => {
        const link = currentRow().links.at(-1);
        if (!link) throw new TypeError("character directory link text lacks a listing anchor");
        link.label += chunk.text;
      },
    });
  // HTMLRewriter distinguishes elements from comments, attributes and raw text.
  // Draining the response is required for all parser callbacks to run.
  await rewriter.transform(new Response(html)).text();
  return {
    bodyCount,
    headingCount,
    heading,
    headingOrder,
    tableCount,
    tableOrder,
    tableBodyCount,
    tableAnchorCount,
    sortHrefs,
    templateCount,
    canvasCount,
    baseCount,
    hiddenCount,
    rows,
  };
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
  const html = new TextDecoder("utf-8", { fatal: true }).decode(retained);
  const listing = await parsedListing(html);
  if (listing.templateCount || listing.canvasCount || listing.baseCount || listing.hiddenCount)
    throw new TypeError("character directory contains inert, base URL or hidden elements");
  if (
    listing.bodyCount !== 1 ||
    listing.headingCount !== 1 ||
    listing.heading.trim() !== url.pathname
  )
    throw new TypeError("CommunityDragon directory heading conflicts with its pinned URL");
  if (
    listing.tableCount !== 1 ||
    listing.tableBodyCount !== 1 ||
    listing.tableOrder <= listing.headingOrder
  )
    throw new TypeError("character directory requires one listing table after its heading");
  if (listing.rows.length < 2) throw new TypeError("character directory has missing listing rows");
  const expectedSortHrefs = [
    "?C=M&amp;O=A",
    "?C=M&amp;O=D",
    "?C=N&amp;O=A",
    "?C=N&amp;O=D",
    "?C=S&amp;O=A",
    "?C=S&amp;O=D",
  ];
  if (
    listing.tableAnchorCount !== listing.rows.length + listing.sortHrefs.length ||
    (listing.sortHrefs.length !== 0 &&
      (listing.sortHrefs.length !== expectedSortHrefs.length ||
        listing.sortHrefs
          .map((href) => href ?? "")
          .sort(compare)
          .join("\n") !== expectedSortHrefs.join("\n")))
  )
    throw new TypeError("character directory contains anchors outside its listing rows");
  const directories: string[] = [];
  let parentCount = 0;
  for (const row of listing.rows) {
    if (
      row.cellCount !== 3 ||
      row.linkCellCount !== 1 ||
      row.sizeCellCount !== 1 ||
      row.dateCellCount !== 1 ||
      row.anchorCount !== 1 ||
      row.links.length !== 1 ||
      row.linkCellText !== row.links[0]!.label
    )
      throw new TypeError("character directory contains a malformed listing row");
    const { href, title, label } = row.links[0]!;
    if (href === "../" && title === null && label === "Parent directory/") {
      parentCount++;
      continue;
    }
    if (!href || !/^[a-z0-9_]+\/$/.test(href) || title !== href.slice(0, -1) || label !== href)
      throw new TypeError(`character directory contains an unsafe or conflicting link ${href}`);
    directories.push(href.slice(0, -1));
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
