import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { compileRetainedCommunityDragonDirectoryRoster } from "../../scripts/rulesets/compile-retained-cdragon-roster";
import { discoverCommunityDragonDirectoryRoster } from "../../src/domain/rulesets/cdragon-directory-roster";
import {
  buildPinnedSourceSet,
  hashRetainedSourceBytes,
} from "../../src/domain/rulesets/source-validation";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function directoryHtml(slugs = ["yunara", "aatrox", "annietibbers", "tft16_yunara"]) {
  const row = (href: string) =>
    `<tr><td class="link"><a href="${href}" title="${href.slice(0, -1)}">${href}</a></td><td class="size">-</td><td class="date">2026-Sep-10 05:57</td></tr>`;
  return `<!DOCTYPE html><html><body><h1>\n/16.18/game/data/characters/</h1><table id="list"><tbody><tr><td class="link"><a href="../">Parent directory/</a></td><td class="size">-</td><td class="date">-</td></tr>\r\n${slugs.map((slug) => row(`${slug}/`)).join("\r\n")}\r\n</tbody></table></body></html>`;
}

function championIndex() {
  return {
    type: "champion",
    version: "16.18.1",
    data: {
      Aatrox: { version: "16.18.1", id: "Aatrox", key: "266", name: "Aatrox" },
      Yunara: { version: "16.18.1", id: "Yunara", key: "904", name: "Yunara" },
    },
  };
}

async function sources(
  html = directoryHtml(),
  indexValue: unknown = championIndex(),
  retrievedAt = "2026-09-27T00:00:00Z",
) {
  const indexBytes = new TextEncoder().encode(JSON.stringify(indexValue));
  const directoryBytes = new TextEncoder().encode(html);
  return {
    indexBytes,
    directoryBytes,
    index: {
      artifactId: "ddragon-champions",
      kind: "data-dragon" as const,
      uri: "https://ddragon.leagueoflegends.com/cdn/16.18.1/data/en_US/champion.json",
      version: "16.18.1",
      contentHash: await hashRetainedSourceBytes(indexBytes),
      retrievedAt,
    },
    directory: {
      artifactId: "cdragon-characters-directory",
      kind: "community-dragon" as const,
      uri: "https://raw.communitydragon.org/16.18/game/data/characters/",
      version: "16.18",
      contentHash: await hashRetainedSourceBytes(directoryBytes),
      retrievedAt,
    },
  };
}

async function retainedFixture(extra = "unselected", hotfix = "fixture-hotfix") {
  const root = await mkdtemp(join(tmpdir(), "p02-cdragon-directory-"));
  roots.push(root);
  const source = await sources();
  const manualBytes = new TextEncoder().encode(extra);
  const sourceSet = await buildPinnedSourceSet(
    {
      schemaVersion: 1,
      sourceSetId: "directory-roster-fixture",
      patch: "26.18",
      hotfixRevision: hotfix,
      dataDragonVersion: "16.18.1",
      communityDragonRevision: "16.18",
      regionApplicability: ["EUW1"],
      requiredArtifactIds: [source.index.artifactId, source.directory.artifactId, "manual-scope"],
      sourceArtifacts: [
        {
          retainedPath: "champion.json",
          artifact: {
            artifactId: source.index.artifactId,
            kind: source.index.kind,
            uri: source.index.uri,
            version: source.index.version,
            retrievedAt: source.index.retrievedAt,
          },
        },
        {
          retainedPath: "characters.html",
          artifact: {
            artifactId: source.directory.artifactId,
            kind: source.directory.kind,
            uri: source.directory.uri,
            version: source.directory.version,
            retrievedAt: source.directory.retrievedAt,
          },
        },
        {
          retainedPath: "manual.txt",
          artifact: {
            artifactId: "manual-scope",
            kind: "manual" as const,
            uri: "https://example.invalid/fixture-1/manual.txt",
            version: "fixture-1",
            retrievedAt: source.directory.retrievedAt,
          },
        },
      ],
    },
    [
      { artifactId: source.index.artifactId, bytes: source.indexBytes },
      { artifactId: source.directory.artifactId, bytes: source.directoryBytes },
      { artifactId: "manual-scope", bytes: manualBytes },
    ],
  );
  await writeFile(join(root, "champion.json"), source.indexBytes);
  await writeFile(join(root, "characters.html"), source.directoryBytes);
  await writeFile(join(root, "manual.txt"), manualBytes);
  await writeFile(join(root, "source-set.json"), JSON.stringify(sourceSet));
  return { root, sourceSet };
}

test("retained listing matches every roster slug and preserves unclassified paths", async () => {
  const source = await sources();
  const roster = await discoverCommunityDragonDirectoryRoster(
    source.index,
    source.indexBytes,
    source.directory,
    source.directoryBytes,
  );
  expect(roster.scope).toBe("community-dragon-directory-roster-only");
  expect(roster.pcPatchMappingReviewed).toBe(false);
  expect(roster.combatComplete).toBe(false);
  expect(roster.rosterDirectories).toEqual([
    { id: "266", slug: "Aatrox", championIndexPointer: "/data/Aatrox", directoryHref: "aatrox/" },
    { id: "904", slug: "Yunara", championIndexPointer: "/data/Yunara", directoryHref: "yunara/" },
  ]);
  expect(roster.unclassifiedDirectoryHrefs).toEqual(["annietibbers/", "tft16_yunara/"]);
  expect(roster.rosterHash).toMatch(/^sha256:[0-9a-f]{64}$/);
  const recaptured = await sources(directoryHtml(), championIndex(), "2026-09-28T00:00:00Z");
  expect(
    (
      await discoverCommunityDragonDirectoryRoster(
        recaptured.index,
        recaptured.indexBytes,
        recaptured.directory,
        recaptured.directoryBytes,
      )
    ).rosterHash,
  ).toBe(roster.rosterHash);
  const pending = discoverCommunityDragonDirectoryRoster(
    source.index,
    source.indexBytes,
    source.directory,
    source.directoryBytes,
  );
  source.indexBytes.fill(0);
  source.directoryBytes.fill(0);
  source.directory.version = "changed";
  expect(await pending).toEqual(roster);
});

test("changed source bytes change roster identity; missing and conflicting links fail", async () => {
  const original = await sources();
  const first = await discoverCommunityDragonDirectoryRoster(
    original.index,
    original.indexBytes,
    original.directory,
    original.directoryBytes,
  );
  const changed = await sources(
    directoryHtml(["aatrox", "yunara", "annietibbers", "tft16_yunara", "zedshadow"]),
  );
  expect(
    (
      await discoverCommunityDragonDirectoryRoster(
        changed.index,
        changed.indexBytes,
        changed.directory,
        changed.directoryBytes,
      )
    ).rosterHash,
  ).not.toBe(first.rosterHash);
  for (const html of [
    directoryHtml(["aatrox", "annietibbers"]),
    directoryHtml(["aatrox", "yunara", "yunara"]),
    directoryHtml(["aatrox", "yunara", "../evil"]),
    directoryHtml().replace('title="yunara"', 'title="other"'),
    directoryHtml().replace(
      "/16.18/game/data/characters/</h1>",
      "/latest/game/data/characters/</h1>",
    ),
    directoryHtml().replace("<tbody>", "<tbody><tr>broken</tr>"),
    `<!DOCTYPE html><html><body><!-- ${directoryHtml()} --></body></html>`,
    `<!DOCTYPE html><html><body><script type="text/plain">${directoryHtml()}</script></body></html>`,
    `<!DOCTYPE html><html><body><xmp>${directoryHtml()}</xmp></body></html>`,
    directoryHtml().replace('<table id="list">', '<div id="list">').replace("</table>", "</div>"),
  ]) {
    const invalid = await sources(html);
    await expect(
      discoverCommunityDragonDirectoryRoster(
        invalid.index,
        invalid.indexBytes,
        invalid.directory,
        invalid.directoryBytes,
      ),
    ).rejects.toThrow();
  }
});

test("artifact identity, provider, revision, byte hash and role conflicts fail", async () => {
  const source = await sources();
  const run = (
    index: unknown,
    directory: unknown,
    indexBytes = source.indexBytes,
    directoryBytes = source.directoryBytes,
  ) => discoverCommunityDragonDirectoryRoster(index, indexBytes, directory, directoryBytes);
  for (const directory of [
    { ...source.directory, kind: "data-dragon" },
    { ...source.directory, version: "16.17" },
    {
      ...source.directory,
      uri: source.directory.uri.replace("raw.communitydragon.org", "example.invalid"),
    },
    { ...source.directory, uri: source.directory.uri.replace("/16.18/", "/pbe/") },
    { ...source.directory, uri: `${source.directory.uri}?latest=1` },
    { ...source.directory, uri: `${source.directory.uri}?` },
    { ...source.directory, contentHash: source.index.contentHash },
  ])
    await expect(run(source.index, directory)).rejects.toThrow();
  const item = await sources(directoryHtml(), { ...championIndex(), type: "item" });
  await expect(run(item.index, source.directory, item.indexBytes)).rejects.toThrow();
  const corrupt = Uint8Array.from(source.indexBytes);
  corrupt[0] = 0;
  await expect(run(source.index, source.directory, corrupt)).rejects.toThrow("artifact hash");
  await expect(
    run(source.index, { ...source.directory, artifactId: source.index.artifactId }),
  ).rejects.toThrow("distinct source artifact IDs");
  const nested = await sources(
    directoryHtml().replace(
      "/16.18/game/data/characters/</h1>",
      "/16.18/extra/game/data/characters/</h1>",
    ),
  );
  await expect(
    run(
      source.index,
      {
        ...nested.directory,
        version: "16.18/extra",
        uri: "https://raw.communitydragon.org/16.18/extra/game/data/characters/",
      },
      source.indexBytes,
      nested.directoryBytes,
    ),
  ).rejects.toThrow();
});

test("offline report checks all retained bytes, source-set identity and CLI output", async () => {
  const { root, sourceSet } = await retainedFixture();
  const compile = (manifest: unknown = sourceSet, directory = root) =>
    compileRetainedCommunityDragonDirectoryRoster(
      manifest,
      directory,
      "ddragon-champions",
      "cdragon-characters-directory",
    );
  const first = await compile();
  expect(first.scope).toBe("retained-community-dragon-directory-roster-only");
  expect(first.undiscoveredArtifactIds).toEqual(["manual-scope"]);
  expect(await compile()).toEqual(first);
  const changedHotfix = await retainedFixture("unselected", "changed-hotfix");
  expect((await compile(changedHotfix.sourceSet, changedHotfix.root)).reportHash).not.toBe(
    first.reportHash,
  );
  const changedUnselected = await retainedFixture("changed");
  expect((await compile(changedUnselected.sourceSet, changedUnselected.root)).reportHash).not.toBe(
    first.reportHash,
  );
  const run = (indexId = "ddragon-champions") =>
    Bun.spawn(
      [
        process.execPath,
        "scripts/rulesets/compile-retained-cdragon-roster.ts",
        join(root, "source-set.json"),
        root,
        indexId,
        "cdragon-characters-directory",
      ],
      { stdout: "pipe", stderr: "pipe" },
    );
  const success = run();
  expect(await success.exited).toBe(0);
  expect(JSON.parse(await new Response(success.stdout).text())).toEqual(first);
  const unknown = run("missing");
  expect(await new Response(unknown.stdout).text()).toBe("");
  expect(await unknown.exited).toBe(1);
  await writeFile(join(root, "manual.txt"), "corrupt");
  const corrupt = run();
  expect(await new Response(corrupt.stdout).text()).toBe("");
  expect(await corrupt.exited).toBe(1);
  await rm(join(root, "characters.html"));
  await expect(compile()).rejects.toThrow();
});
