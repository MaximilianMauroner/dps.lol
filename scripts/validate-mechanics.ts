import { readFile } from "node:fs/promises";
import { ValidationRecordSchema } from "../tests/observations/records";
import { assertMechanicTrace, TraceExpectationsSchema } from "../tests/engine-harness/harness";

if (import.meta.main) {
  const paths = process.argv.slice(2);
  if (paths.length !== 3) {
    console.error(
      "Usage: bun scripts/validate-mechanics.ts <record.json> <trace.json> <expectations.json>",
    );
    process.exit(2);
  }
  try {
    const [record, trace, expectations] = await Promise.all(
      paths.map(async (path) => JSON.parse(await readFile(path, "utf8"))),
    );
    const parsed = ValidationRecordSchema.parse(record);
    assertMechanicTrace(trace, TraceExpectationsSchema.parse(expectations));
    console.log(
      `${parsed.fixtureId}: ${parsed.evidenceKind} fixture passed; discrepancy=${parsed.discrepancy}`,
    );
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
