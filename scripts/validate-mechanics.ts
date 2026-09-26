import { readFile, realpath } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { ValidationRecordSchema, assertObservationForPatch } from "../tests/observations/records";
import { assertMechanicTrace, TraceExpectationsSchema } from "../tests/engine-harness/harness";

export async function validateMechanicFiles(
  recordPath: string,
  tracePath: string,
  expectationsPath: string,
  target?: { patch: string; clientVersion: string; hotfixId: string },
): Promise<string> {
  const [record, trace, expectations] = await Promise.all(
    [recordPath, tracePath, expectationsPath].map(async (path) =>
      JSON.parse(await readFile(path, "utf8")),
    ),
  );
  const parsed = ValidationRecordSchema.parse(record);
  const linkedTrace = await realpath(resolve(dirname(recordPath), parsed.expectedTracePath));
  if (linkedTrace !== (await realpath(tracePath)))
    throw new Error("Supplied trace does not match the validation record's expectedTracePath");
  if (parsed.evidenceKind === "observed") {
    if (!target)
      throw new Error("Observed records require target patch, client version, and hotfix");
    assertObservationForPatch(parsed, target.patch, target.clientVersion, target.hotfixId);
  }
  assertMechanicTrace(trace, TraceExpectationsSchema.parse(expectations));
  if (parsed.discrepancy !== "none")
    throw new Error(`${parsed.fixtureId} has unresolved ${parsed.discrepancy} discrepancy`);
  return `${parsed.fixtureId}: ${parsed.evidenceKind} fixture passed; discrepancy=none`;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.length !== 3 && args.length !== 6) {
    console.error(
      "Usage: bun scripts/validate-mechanics.ts <record.json> <trace.json> <expectations.json> [<patch> <client-version> <hotfix-id>]",
    );
    process.exit(2);
  }
  try {
    console.log(
      await validateMechanicFiles(
        args[0]!,
        args[1]!,
        args[2]!,
        args.length === 6
          ? { patch: args[3]!, clientVersion: args[4]!, hotfixId: args[5]! }
          : undefined,
      ),
    );
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
