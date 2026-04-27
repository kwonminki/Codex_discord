import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createDirectSyncStateStore } from "./directState.js";
import { manageScheduledCommand, nextRunAt, runDueScheduledCommands } from "./scheduler.js";

describe("scheduler", () => {
  it("calculates next run times for once, interval, daily, and weekly schedules", () => {
    const now = new Date("2026-04-24T01:00:00.000Z");

    expect(nextRunAt({ type: "once", runAt: "2026-04-24T02:00:00.000Z" }, now)).toBe(
      "2026-04-24T02:00:00.000Z",
    );
    expect(nextRunAt({ type: "interval", everyMs: 600_000 }, now)).toBe("2026-04-24T01:10:00.000Z");
    expect(nextRunAt({ type: "daily", time: "12:30" }, now)).toEqual(expect.any(String));
    expect(nextRunAt({ type: "weekly", time: "12:30", weekdays: [5] }, now)).toEqual(expect.any(String));
  });

  it("creates, lists, deletes, and executes persisted schedules", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "scheduler-"));

    try {
      const stateStore = createDirectSyncStateStore(path.join(tempRoot, "state.json"));
      const now = new Date("2026-04-24T01:00:00.000Z");
      const created = await manageScheduledCommand({
        stateStore,
        now,
        channelId: "channel-1",
        userId: "user-1",
        roleIds: ["role-operator"],
        request: {
          action: "create",
          mode: "every",
          every: "10m",
          command: "shell pwd",
        },
      });

      expect(created).toMatchObject({
        status: "created",
        schedule: {
          channelId: "channel-1",
          command: "shell pwd",
          nextRunAt: "2026-04-24T01:10:00.000Z",
        },
      });
      await expect(
        manageScheduledCommand({
          stateStore,
          channelId: "channel-1",
          userId: "user-1",
          roleIds: ["role-operator"],
          request: { action: "list" },
        }),
      ).resolves.toMatchObject({
        status: "listed",
        schedules: [expect.objectContaining({ command: "shell pwd" })],
      });

      const execute = vi.fn().mockResolvedValue(undefined);
      await expect(
        runDueScheduledCommands({
          stateStore,
          now: new Date("2026-04-24T01:10:00.000Z"),
          execute,
        }),
      ).resolves.toEqual({ checked: 1, executed: 1, failed: 0 });
      expect(execute).toHaveBeenCalledWith(expect.objectContaining({ command: "shell pwd" }));

      const stateAfterRun = await stateStore.read();
      expect(stateAfterRun.scheduledCommands[0]).toMatchObject({
        runCount: 1,
        lastRunAt: "2026-04-24T01:10:00.000Z",
        nextRunAt: "2026-04-24T01:20:00.000Z",
      });

      await expect(
        manageScheduledCommand({
          stateStore,
          channelId: "channel-1",
          userId: "user-1",
          roleIds: ["role-operator"],
          request: { action: "delete", id: stateAfterRun.scheduledCommands[0].id },
        }),
      ).resolves.toMatchObject({ status: "deleted", deleted: true });
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("disables one-time schedules after their due run", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "scheduler-"));

    try {
      const stateStore = createDirectSyncStateStore(path.join(tempRoot, "state.json"));
      const now = new Date("2026-04-24T01:00:00.000Z");
      await manageScheduledCommand({
        stateStore,
        now,
        channelId: "channel-1",
        userId: "user-1",
        roleIds: ["role-operator"],
        request: {
          action: "create",
          mode: "once",
          at: "2026-04-24T01:10:00.000Z",
          command: "shell pwd",
        },
      });

      await runDueScheduledCommands({
        stateStore,
        now: new Date("2026-04-24T01:10:00.000Z"),
        execute: vi.fn().mockResolvedValue(undefined),
      });

      await expect(stateStore.read()).resolves.toMatchObject({
        scheduledCommands: [
          {
            enabled: false,
            runCount: 1,
            lastRunAt: "2026-04-24T01:10:00.000Z",
          },
        ],
      });
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});
