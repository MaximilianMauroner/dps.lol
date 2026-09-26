import { z } from "zod";
import { EntityStateSchema, type LifecycleTransition, type ScheduledEvent } from "../../contracts";

const LifecycleEventPayloadSchema = z
  .object({
    entityId: z.string().min(1),
    transition: z.enum(["death", "revive", "transform"]),
    replacement: EntityStateSchema,
  })
  .strict();

/** A lifecycle event carries its full replacement; no live lookup is needed on replay. */
export function lifecycleTransitionFromEvent(event: ScheduledEvent): LifecycleTransition | null {
  if (event.kind !== "lifecycle-transition") return null;
  if (event.phase !== "lifecycle")
    throw new TypeError("lifecycle transitions must use the lifecycle phase");
  return LifecycleEventPayloadSchema.parse(event.payload);
}
