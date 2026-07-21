import { randomUUID } from "node:crypto";
import type {
  DirectSyncStateStore,
  ScheduledCommandSpec,
  ScheduledCommandState,
} from "./directState.js";

export type ScheduleCommandRequest =
  | {
      action: "create";
      mode: "once" | "every" | "daily" | "weekly";
      command: string;
      at?: string | null;
      every?: string | null;
      weekdays?: string | null;
    }
  | { action: "list" }
  | { action: "delete"; id: string };

export type ScheduleCommandResult =
  | { status: "created"; schedule: ScheduledCommandState }
  | { status: "listed"; schedules: ScheduledCommandState[] }
  | { status: "deleted"; id: string; deleted: boolean };

const WEEKDAYS = new Map([
  ["sun", 0],
  ["sunday", 0],
  ["일", 0],
  ["mon", 1],
  ["monday", 1],
  ["월", 1],
  ["tue", 2],
  ["tuesday", 2],
  ["화", 2],
  ["wed", 3],
  ["wednesday", 3],
  ["수", 3],
  ["thu", 4],
  ["thursday", 4],
  ["목", 4],
  ["fri", 5],
  ["friday", 5],
  ["금", 5],
  ["sat", 6],
  ["saturday", 6],
  ["토", 6],
]);

function parseDurationMs(value: string | null | undefined): number {
  const match = value?.trim().match(/^(\d+)\s*(m|min|minute|minutes|h|hour|hours|d|day|days)$/i);

  if (!match) {
    throw new Error("every 값은 10m, 1h, 1d 형식이어야 합니다.");
  }

  const amount = Number.parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  const multiplier = unit.startsWith("m")
    ? 60_000
    : unit.startsWith("h")
      ? 3_600_000
      : 86_400_000;

  return amount * multiplier;
}

function parseTime(value: string | null | undefined): { hour: number; minute: number } {
  const match = value?.trim().match(/^(\d{1,2}):(\d{2})$/);

  if (!match) {
    throw new Error("at 값은 HH:mm 형식이어야 합니다.");
  }

  const hour = Number.parseInt(match[1], 10);
  const minute = Number.parseInt(match[2], 10);

  if (hour > 23 || minute > 59) {
    throw new Error("at 시간은 00:00부터 23:59 사이여야 합니다.");
  }

  return { hour, minute };
}

function parseRunAt(value: string | null | undefined): Date {
  const raw = value?.trim();

  if (!raw) {
    throw new Error("once 스케줄에는 at 값이 필요합니다.");
  }

  const localMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})$/);

  if (localMatch) {
    return new Date(
      Number.parseInt(localMatch[1], 10),
      Number.parseInt(localMatch[2], 10) - 1,
      Number.parseInt(localMatch[3], 10),
      Number.parseInt(localMatch[4], 10),
      Number.parseInt(localMatch[5], 10),
    );
  }

  const parsed = new Date(raw);

  if (Number.isNaN(parsed.getTime())) {
    throw new Error("once at 값은 YYYY-MM-DD HH:mm 또는 ISO 날짜여야 합니다.");
  }

  return parsed;
}

function parseWeekdays(value: string | null | undefined): number[] {
  const days = (value ?? "")
    .split(/[,\s]+/)
    .map((day) => day.trim().toLowerCase())
    .filter(Boolean)
    .map((day) => WEEKDAYS.get(day))
    .filter((day): day is number => typeof day === "number");

  if (days.length === 0) {
    throw new Error("weekly 스케줄에는 weekdays 값이 필요합니다. 예: mon,wed,fri");
  }

  return [...new Set(days)].sort((a, b) => a - b);
}

export function buildScheduleSpec(request: Extract<ScheduleCommandRequest, { action: "create" }>): ScheduledCommandSpec {
  switch (request.mode) {
    case "once":
      return { type: "once", runAt: parseRunAt(request.at).toISOString() };
    case "every":
      return { type: "interval", everyMs: parseDurationMs(request.every) };
    case "daily":
      parseTime(request.at);
      return { type: "daily", time: request.at?.trim() ?? "" };
    case "weekly":
      parseTime(request.at);
      return {
        type: "weekly",
        time: request.at?.trim() ?? "",
        weekdays: parseWeekdays(request.weekdays),
      };
  }
}

function withTime(date: Date, time: string): Date {
  const { hour, minute } = parseTime(time);
  const next = new Date(date);
  next.setHours(hour, minute, 0, 0);
  return next;
}

export function nextRunAt(spec: ScheduledCommandSpec, after: Date): string | null {
  switch (spec.type) {
    case "once":
      return new Date(spec.runAt).getTime() > after.getTime() ? spec.runAt : null;
    case "interval":
      return new Date(after.getTime() + spec.everyMs).toISOString();
    case "daily": {
      const today = withTime(after, spec.time);
      if (today.getTime() > after.getTime()) {
        return today.toISOString();
      }
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      return tomorrow.toISOString();
    }
    case "weekly": {
      for (let offset = 0; offset <= 7; offset += 1) {
        const candidate = withTime(after, spec.time);
        candidate.setDate(candidate.getDate() + offset);
        if (spec.weekdays.includes(candidate.getDay()) && candidate.getTime() > after.getTime()) {
          return candidate.toISOString();
        }
      }
      return null;
    }
  }
}

export async function manageScheduledCommand(input: {
  stateStore: DirectSyncStateStore;
  request: ScheduleCommandRequest;
  channelId: string;
  userId: string;
  roleIds: string[];
  now?: Date;
}): Promise<ScheduleCommandResult> {
  const state = await input.stateStore.read();
  const request = input.request;

  if (request.action === "list") {
    return { status: "listed", schedules: state.scheduledCommands };
  }

  if (request.action === "delete") {
    const nextSchedules = state.scheduledCommands.filter((schedule) => schedule.id !== request.id);
    await input.stateStore.update((latestState) => ({
      ...latestState,
      scheduledCommands: latestState.scheduledCommands.filter((schedule) => schedule.id !== request.id),
    }));
    return {
      status: "deleted",
      id: request.id,
      deleted: nextSchedules.length !== state.scheduledCommands.length,
    };
  }

  const command = request.command.trim();

  if (!command || /^schedule\b/i.test(command)) {
    throw new Error("예약할 command 값이 비어 있거나 schedule 명령 자체입니다.");
  }

  const now = input.now ?? new Date();
  const spec = buildScheduleSpec(request);
  const next = nextRunAt(spec, now);

  if (!next) {
    throw new Error("다음 실행 시간이 없습니다. once 시간은 현재보다 이후여야 합니다.");
  }

  const schedule: ScheduledCommandState = {
    id: randomUUID(),
    channelId: input.channelId,
    userId: input.userId,
    roleIds: input.roleIds,
    command,
    schedule: spec,
    enabled: true,
    nextRunAt: next,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    lastRunAt: null,
    runCount: 0,
  };

  await input.stateStore.update((latestState) => ({
    ...latestState,
    scheduledCommands: [...latestState.scheduledCommands, schedule],
  }));

  return { status: "created", schedule };
}

export async function runDueScheduledCommands(input: {
  stateStore: DirectSyncStateStore;
  now?: Date;
  execute(schedule: ScheduledCommandState): Promise<void>;
}): Promise<{ checked: number; executed: number; failed: number }> {
  const now = input.now ?? new Date();
  const state = await input.stateStore.read();
  let executed = 0;
  let failed = 0;
  const nextSchedules: ScheduledCommandState[] = [];

  for (const schedule of state.scheduledCommands) {
    if (!schedule.enabled || new Date(schedule.nextRunAt).getTime() > now.getTime()) {
      nextSchedules.push(schedule);
      continue;
    }

    try {
      await input.execute(schedule);
      executed += 1;
    } catch (error) {
      failed += 1;
      console.error("discord-bot scheduled command failed", error);
    }

    const followingRunAt = nextRunAt(schedule.schedule, now);
    nextSchedules.push({
      ...schedule,
      enabled: Boolean(followingRunAt),
      nextRunAt: followingRunAt ?? schedule.nextRunAt,
      lastRunAt: now.toISOString(),
      updatedAt: now.toISOString(),
      runCount: schedule.runCount + 1,
    });
  }

  const processedScheduleIds = new Set(state.scheduledCommands.map((schedule) => schedule.id));
  await input.stateStore.update((latestState) => ({
    ...latestState,
    scheduledCommands: [
      ...latestState.scheduledCommands.filter((schedule) => !processedScheduleIds.has(schedule.id)),
      ...nextSchedules,
    ],
  }));

  return { checked: state.scheduledCommands.length, executed, failed };
}
