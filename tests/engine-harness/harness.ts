import { TraceSchema, type Trace } from "../../src/domain/contracts";
import { z } from "zod";

export interface NumericExpectation {
  targetEntityId: string;
  expected: number;
  absoluteTolerance: number;
}

export interface TraceExpectations {
  eventOrder?: readonly string[];
  damage?: readonly NumericExpectation[];
  effectCounts?: readonly {
    kind: Trace["events"][number]["effects"][number]["kind"];
    expected: number;
  }[];
}

export const TraceExpectationsSchema = z
  .object({
    eventOrder: z.array(z.string().min(1)).min(2).optional(),
    damage: z
      .array(
        z
          .object({
            targetEntityId: z.string().min(1),
            expected: z.number().finite(),
            absoluteTolerance: z.number().finite().nonnegative(),
          })
          .strict(),
      )
      .min(1)
      .optional(),
    effectCounts: z
      .array(
        z
          .object({
            kind: z.enum(["damage", "heal", "shield", "resource", "buff", "lifecycle"]),
            expected: z.number().int().nonnegative(),
          })
          .strict(),
      )
      .min(1)
      .optional(),
  })
  .strict()
  .refine(
    (value) => value.eventOrder || value.damage || value.effectCounts,
    "At least one trace assertion is required",
  );

/** Assertions intentionally consume only the public trace, never engine internals. */
export function assertMechanicTrace(value: unknown, expected: TraceExpectations): Trace {
  const trace = TraceSchema.parse(value);
  const positions = new Map(trace.events.map((event, index) => [event.eventId, index]));

  for (let index = 1; index < (expected.eventOrder?.length ?? 0); index += 1) {
    const before = expected.eventOrder![index - 1]!;
    const after = expected.eventOrder![index]!;
    if (positions.get(before) === undefined || positions.get(after) === undefined)
      throw new Error(`Missing expected event in order assertion: ${before}, ${after}`);
    if (positions.get(before)! >= positions.get(after)!)
      throw new Error(`Event order violation: ${before} must precede ${after}`);
  }

  for (const assertion of expected.damage ?? []) {
    if (
      !Number.isFinite(assertion.expected) ||
      !Number.isFinite(assertion.absoluteTolerance) ||
      assertion.absoluteTolerance < 0
    )
      throw new Error(
        "Damage expectation and tolerance must be finite; tolerance cannot be negative",
      );
    const actual = trace.events
      .flatMap((event) => event.effects)
      .reduce(
        (sum, effect) =>
          effect.kind === "damage" && effect.targetEntityId === assertion.targetEntityId
            ? sum + effect.amount
            : sum,
        0,
      );
    if (Math.abs(actual - assertion.expected) > assertion.absoluteTolerance)
      throw new Error(
        `Damage for ${assertion.targetEntityId}: expected ${assertion.expected} ± ${assertion.absoluteTolerance}, got ${actual}`,
      );
  }

  for (const assertion of expected.effectCounts ?? []) {
    if (!Number.isSafeInteger(assertion.expected) || assertion.expected < 0)
      throw new Error("Expected effect count must be a nonnegative integer");
    const actual = trace.events
      .flatMap((event) => event.effects)
      .filter((effect) => effect.kind === assertion.kind).length;
    if (actual !== assertion.expected)
      throw new Error(
        `Effect count for ${assertion.kind}: expected ${assertion.expected}, got ${actual}`,
      );
  }
  return trace;
}
