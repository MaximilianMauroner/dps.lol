import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sampleTrace } from "../contracts/fixtures";
import { validateMechanicFiles } from "../../scripts/validate-mechanics";

test("CLI binds a trace, rejects unresolved discrepancies, and checks observed target", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dps-validation-"));
  const recordPath = join(directory, "record.json");
  const tracePath = join(directory, "trace.json");
  const otherTracePath = join(directory, "other.json");
  const assertionsPath = join(directory, "assertions.json");
  const record = {
    fixtureId: "fixture-1",
    mechanicId: "attack",
    expectedTracePath: "trace.json",
    discrepancy: "none",
    evidenceKind: "synthetic",
    purpose: "contract assertion",
  };
  try {
    await writeFile(tracePath, JSON.stringify(sampleTrace));
    await writeFile(otherTracePath, JSON.stringify(sampleTrace));
    await writeFile(assertionsPath, JSON.stringify({ eventOrder: ["event-001", "event-002"] }));
    await writeFile(recordPath, JSON.stringify(record));
    expect(await validateMechanicFiles(recordPath, tracePath, assertionsPath)).toContain(
      "synthetic fixture passed",
    );
    expect(validateMechanicFiles(recordPath, otherTracePath, assertionsPath)).rejects.toThrow(
      "does not match",
    );
    await writeFile(recordPath, JSON.stringify({ ...record, discrepancy: "implementation" }));
    expect(validateMechanicFiles(recordPath, tracePath, assertionsPath)).rejects.toThrow(
      "unresolved implementation",
    );

    const observed = {
      ...record,
      discrepancy: "none",
      evidenceKind: "observed",
      observationId: "observation-1",
      source: {
        sourceId: "capture-1",
        contentHash: `sha256:${"a".repeat(64)}`,
        locator: "frame-1",
        category: "client-capture",
      },
      protocol: {
        patch: "26.18",
        clientVersion: "26.18.1",
        hotfixId: "cutoff-1",
        modeId: "sr",
        championId: "yunara",
        itemIds: [],
        initialState: { health: 100 },
        actionTimelineMs: [0],
        targetStats: { armor: 0 },
        repetitions: 1,
      },
      observedPatch: "26.18",
      reviewerId: "reviewer",
      mechanicAuthorId: "author",
      disputed: false,
    };
    delete (observed as Partial<typeof observed>).purpose;
    await writeFile(recordPath, JSON.stringify(observed));
    expect(validateMechanicFiles(recordPath, tracePath, assertionsPath)).rejects.toThrow(
      "require target",
    );
    expect(
      validateMechanicFiles(recordPath, tracePath, assertionsPath, {
        patch: "26.18",
        clientVersion: "26.19.1",
        hotfixId: "cutoff-1",
      }),
    ).rejects.toThrow("does not match");
    expect(
      await validateMechanicFiles(recordPath, tracePath, assertionsPath, {
        patch: "26.18",
        clientVersion: "26.18.1",
        hotfixId: "cutoff-1",
      }),
    ).toContain("observed fixture passed");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
