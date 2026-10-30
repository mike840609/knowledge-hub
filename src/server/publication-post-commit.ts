import { after } from "next/server";
import type { CallerContext } from "@/modules/identity/domain/caller-context";
import { DomainError } from "@/shared/domain/errors";
import { teamWorkspacesEnabled } from "./config";

export type PublicationDrainResult = {
  applied: number;
  pending: number;
  frozen: number;
  failed: number;
};

export type PublicationDrain = (caller: CallerContext) => Promise<unknown>;
export type AfterScheduler = (task: () => Promise<void>) => void;

type ScheduleOptions = {
  /** Defaults to the deployment flag; tests inject their own. */
  enabled?: () => boolean;
  /** Defaults to Next's `after`; tests capture the task instead. */
  schedule?: AfterScheduler;
  /** Defaults to the application service drain; tests inject a fake. */
  drain?: PublicationDrain;
};

function errorLabel(error: unknown): string {
  if (error instanceof DomainError) return error.code;
  return error instanceof Error ? error.name : "UnknownError";
}

/**
 * A request-scoped caller may be mutated or discarded after the response.
 * Capture only the validated identity and grants the drain needs.
 */
function captureCaller(caller: CallerContext): CallerContext {
  return {
    identity: { ...caller.identity },
    ...(caller.identitySynced ? { identitySynced: true as const } : {}),
    ...(caller.personalWorkspaceOnly ? { personalWorkspaceOnly: caller.personalWorkspaceOnly } : {}),
    validatedExternalGroupIds: [...caller.validatedExternalGroupIds],
    platformCapabilities: [...caller.platformCapabilities],
  };
}

async function defaultDrain(caller: CallerContext): Promise<PublicationDrainResult> {
  // Imported lazily so composition can import this module without a cycle.
  const { applicationServices } = await import("./composition");
  const { drainPublicationEvents } = await import(
    "@/modules/sources/application/publication-drain"
  );
  const { unitOfWork } = applicationServices();
  return drainPublicationEvents(unitOfWork, {
    judge: { kind: "CALLER", caller },
  });
}

/**
 * Register a caller-scoped publication drain after the response commits.
 *
 * Next's `after` keeps the task alive past the response without blocking it.
 * The task is never a bare unawaited promise. Failures are logged and
 * swallowed, and nothing is registered while Team workspaces are off (events
 * stay unconsumed, and no contributor is frozen).
 */
export function schedulePublicationDrain(
  caller: CallerContext,
  options: ScheduleOptions = {},
): void {
  if (!(options.enabled ?? teamWorkspacesEnabled)()) return;

  const captured = captureCaller(caller);
  const drain = options.drain ?? defaultDrain;
  const schedule = options.schedule ?? ((task) => after(task));
  try {
    schedule(async () => {
      try {
        await drain(captured);
      } catch (error) {
        console.error("Publication drain failed after a personal save.", errorLabel(error));
      }
    });
  } catch (error) {
    console.error("Publication drain could not be scheduled.", errorLabel(error));
  }
}

/**
 * Wrap the mutators that write personal originals so a successful call
 * registers a post-response drain. A rejection (validation, conflict,
 * rollback) registers nothing. The wrapped method keeps its exact return
 * value and never waits for the drain.
 */
export function withPostCommitDrain<T extends object>(
  target: T,
  methods: readonly string[],
  schedule: (caller: CallerContext) => void,
): T {
  const names = new Set(methods);
  const wrapped = new Map<PropertyKey, (...args: unknown[]) => Promise<unknown>>();

  return new Proxy(target, {
    get(object, property) {
      const value = Reflect.get(object, property, object);
      if (typeof value !== "function" || !names.has(String(property))) return value;
      const existing = wrapped.get(property);
      if (existing) return existing;
      const method = async (...args: unknown[]): Promise<unknown> => {
        const result = await (value as (...inner: unknown[]) => Promise<unknown>).apply(object, args);
        const caller = args[0] as CallerContext | undefined;
        if (caller) schedule(caller);
        return result;
      };
      wrapped.set(property, method);
      return method;
    },
  });
}
