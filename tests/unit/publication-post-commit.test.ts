import { afterEach, describe, expect, it, vi } from "vitest";
import { callerFromIdentity } from "@/modules/identity/domain/caller-context";
import type { CallerContext } from "@/modules/identity/domain/caller-context";
import {
  HUB_PERSONAL_WRITE_METHODS,
  SOURCE_PERSONAL_WRITE_METHODS,
  schedulePublicationDrain,
  withPostCommitDrain,
} from "@/server/publication-post-commit";

const identity = {
  id: "0199f600-0000-7000-8000-0000000000aa",
  emp_id: "POST-COMMIT",
  name: "Ann",
  org_code: "HRSD",
};

function caller(): CallerContext {
  return {
    ...callerFromIdentity(identity),
    validatedExternalGroupIds: ["validated-group"],
  };
}

const previousFlag = process.env.KM_TEAM_WORKSPACES_ENABLED;

afterEach(() => {
  if (previousFlag === undefined) delete process.env.KM_TEAM_WORKSPACES_ENABLED;
  else process.env.KM_TEAM_WORKSPACES_ENABLED = previousFlag;
  vi.restoreAllMocks();
});

describe("schedulePublicationDrain", () => {
  it("schedules nothing while team workspaces are switched off", () => {
    process.env.KM_TEAM_WORKSPACES_ENABLED = "false";
    const schedule = vi.fn();
    const drain = vi.fn(async () => ({ applied: 1, pending: 0, frozen: 0, failed: 0 }));

    schedulePublicationDrain(caller(), { schedule, drain });

    expect(schedule).not.toHaveBeenCalled();
    expect(drain).not.toHaveBeenCalled();
  });

  it("captures the validated caller and returns before the drain resolves", async () => {
    process.env.KM_TEAM_WORKSPACES_ENABLED = "true";
    let task: (() => Promise<void>) | undefined;
    const schedule = vi.fn((scheduled: () => Promise<void>) => {
      task = scheduled;
    });
    let released: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      released = resolve;
    });
    const drain = vi.fn(async (caller: CallerContext) => {
      void caller;
      await gate;
      return { applied: 1, pending: 0, frozen: 0, failed: 0 };
    });
    const trusted = caller();

    schedulePublicationDrain(trusted, { schedule, drain });

    expect(schedule).toHaveBeenCalledTimes(1);
    expect(drain).not.toHaveBeenCalled();
    expect(task).toBeTypeOf("function");

    // A later mutation of the request's caller must not reach the scheduled task.
    trusted.validatedExternalGroupIds = ["late-group"];
    released?.();
    await task?.();

    expect(drain).toHaveBeenCalledTimes(1);
    const captured = drain.mock.calls[0][0] as CallerContext;
    expect(captured.identity).toEqual(identity);
    expect(captured.validatedExternalGroupIds).toEqual(["validated-group"]);
    expect(captured).not.toBe(trusted);
  });

  it("logs a drain failure and never rejects the scheduled task", async () => {
    process.env.KM_TEAM_WORKSPACES_ENABLED = "true";
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    let task: (() => Promise<void>) | undefined;
    const schedule = (scheduled: () => Promise<void>) => {
      task = scheduled;
    };
    const drain = vi.fn(async () => {
      throw new Error("publication database is unreachable");
    });

    schedulePublicationDrain(caller(), { schedule, drain });
    await expect(task?.()).resolves.toBeUndefined();

    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0][0])).toContain("Publication drain");
  });

  it("logs a scheduling failure instead of failing the request", () => {
    process.env.KM_TEAM_WORKSPACES_ENABLED = "true";
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const schedule = () => {
      throw new Error("after() is unavailable outside a request");
    };

    expect(() => schedulePublicationDrain(caller(), {
      schedule,
      drain: async () => ({ applied: 0, pending: 0, frozen: 0, failed: 0 }),
    })).not.toThrow();
    expect(error).toHaveBeenCalledTimes(1);
  });
});

describe("wrapped mutator lists", () => {
  it("includes source archive/restore, which records a SOURCE event", () => {
    expect(SOURCE_PERSONAL_WRITE_METHODS).toEqual(expect.arrayContaining([
      "applyKnownEntry",
      "archiveKnownEntry",
      "archiveSource",
      "restoreSource",
    ]));
    expect(HUB_PERSONAL_WRITE_METHODS).toEqual(expect.arrayContaining([
      "createDocument",
      "createRevision",
      "duplicateDocument",
      "moveTreeNode",
      "renameFolder",
      "archiveDocument",
      "restoreDocument",
      "archiveFolder",
      "restoreFolder",
    ]));
  });

  it("schedules a source archive just like a known-entry write", async () => {
    const schedule = vi.fn();
    const target = {
      async archiveSource(caller: CallerContext): Promise<void> {
        void caller;
      },
    };
    const wrapped = withPostCommitDrain(target, SOURCE_PERSONAL_WRITE_METHODS, schedule);
    await wrapped.archiveSource(caller());
    expect(schedule).toHaveBeenCalledTimes(1);
  });
});

describe("withPostCommitDrain", () => {
  it("schedules only wrapped mutators and only after they resolve", async () => {
    const schedule = vi.fn();
    const target = {
      async save(_caller: CallerContext, value: number): Promise<number> {
        if (value < 0) throw new Error("rollback");
        return value + 1;
      },
      async read(): Promise<number> {
        return 1;
      },
    };
    const wrapped = withPostCommitDrain(target, ["save"], schedule);

    await expect(wrapped.save(caller(), 4)).resolves.toBe(5);
    expect(schedule).toHaveBeenCalledTimes(1);
    expect(schedule).toHaveBeenLastCalledWith(expect.objectContaining({ identity }));

    await expect(wrapped.read()).resolves.toBe(1);
    expect(schedule).toHaveBeenCalledTimes(1);

    await expect(wrapped.save(caller(), -1)).rejects.toThrow("rollback");
    expect(schedule).toHaveBeenCalledTimes(1);
  });

  it("does not await the scheduled drain before returning the mutation result", async () => {
    let task: (() => Promise<void>) | undefined;
    const target = {
      async save(caller: CallerContext): Promise<string> {
        void caller;
        return "saved";
      },
    };
    const wrapped = withPostCommitDrain(target, ["save"], () => {
      task = async () => new Promise<void>(() => {});
    });

    await expect(wrapped.save(caller())).resolves.toBe("saved");
    expect(task).toBeTypeOf("function");
  });
});
