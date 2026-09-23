import { expect, test } from "bun:test";
import { sampleTrace } from "../contracts/fixtures";
import { assertMechanicTrace, TraceExpectationsSchema } from "./harness";

test("contract trace passes independent numeric, order, and proc assertions", () => {
  expect(
    assertMechanicTrace(sampleTrace, {
      eventOrder: ["event-001", "event-002"],
      damage: [{ targetEntityId: "enemy", expected: 100, absoluteTolerance: 0 }],
      effectCounts: [{ kind: "damage", expected: 1 }],
    }),
  ).toEqual(sampleTrace);
});

test("wrong modifier, reversed event order, and extra proc each fail", () => {
  expect(() =>
    assertMechanicTrace(sampleTrace, {
      damage: [{ targetEntityId: "enemy", expected: 99, absoluteTolerance: 0 }],
    }),
  ).toThrow("Damage for enemy");
  expect(() =>
    assertMechanicTrace(sampleTrace, { eventOrder: ["event-002", "event-001"] }),
  ).toThrow("Event order violation");
  expect(() =>
    assertMechanicTrace(sampleTrace, { effectCounts: [{ kind: "damage", expected: 2 }] }),
  ).toThrow("Effect count for damage");
});

test("invalid tolerance cannot mask a failed modifier", () => {
  expect(() =>
    assertMechanicTrace(sampleTrace, {
      damage: [{ targetEntityId: "enemy", expected: 99, absoluteTolerance: Number.NaN }],
    }),
  ).toThrow("finite");
});

test("CLI assertion input cannot be empty or silently ignore unknown fields", () => {
  expect(TraceExpectationsSchema.safeParse({}).success).toBe(false);
  expect(
    TraceExpectationsSchema.safeParse({
      damage: [{ targetEntityId: "enemy", expected: 100, absoluteTolerance: 0 }],
      typo: true,
    }).success,
  ).toBe(false);
});
