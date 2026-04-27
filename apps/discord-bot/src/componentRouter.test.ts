import { describe, expect, it } from "vitest";
import { routeDiscordComponent } from "./componentRouter.js";

describe("routeDiscordComponent", () => {
  it("maps safe Discord buttons to the same text commands used by message routing", () => {
    expect(routeDiscordComponent("cdc:sync:25")).toBe("sync select 25");
    expect(routeDiscordComponent("cdc:sync:select:25")).toBe("sync select 25");
    expect(routeDiscordComponent("cdc:sync:all:25")).toBe("sync all 25");
    expect(routeDiscordComponent("cdc:sync:mode:on-chat")).toBe("sync mode on-chat");
    expect(routeDiscordComponent("cdc:sync:mode:realtime")).toBe("sync mode realtime");
    expect(routeDiscordComponent("cdc:chat:new:general")).toBe("chat new");
    expect(routeDiscordComponent("cdc:chat:new:current")).toBe("chat new current");
    expect(routeDiscordComponent("cdc:chat:new:here")).toBe("chat new current");
    expect(routeDiscordComponent("cdc:self:dev-chat")).toContain("__cdc_new_chat ");
    expect(decodeURIComponent(routeDiscordComponent("cdc:self:dev-chat") ?? "")).toContain('"name":"봇 유지보수"');
    expect(routeDiscordComponent("cdc:delete:preview")).toBe("sync delete preview");
    expect(routeDiscordComponent("cdc:delete:session:selected", ["session-1"])).toBe("sync delete session session-1");
    expect(routeDiscordComponent("cdc:delete:session:session-1:confirm")).toBe("sync delete session session-1 confirm");
    expect(routeDiscordComponent("cdc:archive:current:confirm")).toBe("archive confirm");
    expect(routeDiscordComponent("cdc:fs:up")).toBe("__cdc_exec cd ..");
    expect(routeDiscordComponent("cdc:fs:refresh")).toBe("__cdc_exec __cdc_ls 0");
    expect(routeDiscordComponent("cdc:fs:page:2")).toBe("__cdc_exec __cdc_ls 2");
  });

  it("maps destructive confirmation buttons explicitly", () => {
    expect(routeDiscordComponent("cdc:delete:channels:confirm")).toBe("sync delete channels confirm");
    expect(routeDiscordComponent("cdc:delete:all:confirm")).toBe("sync delete all confirm");
  });

  it("ignores unknown component ids", () => {
    expect(routeDiscordComponent("other-app:sync")).toBeNull();
  });

  it("maps file browser select values into safe cd commands", () => {
    expect(routeDiscordComponent("cdc:fs:open", ["docs"])).toBe("__cdc_exec __cdc_open docs");
    expect(routeDiscordComponent("cdc:fs:view", ["Project Notes"])).toBe("__cdc_exec __cdc_view 'Project Notes'");
    expect(routeDiscordComponent("cdc:fs:summarize", ["README.md"])).toBe("codex 선택한 파일을 요약해줘: README.md");
    expect(routeDiscordComponent("cdc:fs:edit", ["README.md"])).toBe(
      "codex 선택한 파일을 개선하거나 수정해줘. 파일: README.md",
    );
    expect(routeDiscordComponent("cdc:fs:open", ["bad`name"])).toBeNull();
  });

  it("maps command palette and workflow buttons", () => {
    expect(routeDiscordComponent("cdc:palette", ["browse"])).toBe("__cdc_exec __cdc_ls 0");
    expect(routeDiscordComponent("cdc:palette", ["where"])).toBe("where");
    expect(routeDiscordComponent("cdc:maintenance:panel")).toBe("maintenance");
    expect(routeDiscordComponent("cdc:palette", ["sync-status"])).toBe("sync status");
    expect(routeDiscordComponent("cdc:palette", ["reload-commands"])).toBe("reload commands");
    expect(routeDiscordComponent("cdc:palette", ["git-status"])).toBe("__cdc_exec git status --short");
    expect(routeDiscordComponent("cdc:palette", ["git-diff"])).toBe("__cdc_exec git diff --stat");
    expect(routeDiscordComponent("cdc:palette", ["git-conflicts"])).toBe("__cdc_exec git diff --check");
    expect(routeDiscordComponent("cdc:palette", ["test"])).toBe("__cdc_exec pnpm test");
    expect(routeDiscordComponent("cdc:verify:typecheck")).toBe("__cdc_exec pnpm typecheck");
    expect(routeDiscordComponent("cdc:git:review")).toBe("__cdc_codex_review 현재 변경사항을 리뷰하고 위험한 부분을 알려줘");
    expect(routeDiscordComponent("cdc:git:status")).toBe("__cdc_exec git status --short");
    expect(routeDiscordComponent("cdc:git:conflicts")).toBe("__cdc_exec git diff --check");
    expect(routeDiscordComponent("cdc:palette", ["codex-review"])).toBe("__cdc_codex_review 현재 변경사항을 리뷰하고 위험한 부분을 알려줘");
    expect(routeDiscordComponent("cdc:palette", ["fix-tests"])).toBe(
      "codex 테스트를 실행하고 실패 원인을 분석한 뒤 수정해줘. 수정 후 테스트를 다시 실행해줘",
    );
    expect(routeDiscordComponent("cdc:test:run")).toBe("__cdc_exec pnpm test");
    expect(routeDiscordComponent("cdc:test:fix")).toBe("codex 테스트 실패를 분석하고 수정해줘. 수정 후 테스트도 다시 실행해줘");
    expect(routeDiscordComponent("cdc:reload:commands")).toBe("reload commands");
    expect(routeDiscordComponent("cdc:reload:restart:confirm")).toBe("reload restart confirm");
  });

  it("maps selected Codex session ids into a selected sync request", () => {
    expect(
      routeDiscordComponent("cdc:sync:selected", [
        "019db2be-b2b3-7e82-9e61-8c84b28ad287",
        "019db2be-b2b3-7e82-9e61-8c84b28ad288",
      ]),
    ).toBe("sync selected 019db2be-b2b3-7e82-9e61-8c84b28ad287 019db2be-b2b3-7e82-9e61-8c84b28ad288");
    expect(routeDiscordComponent("cdc:sync:selected", ["bad;id"])).toBeNull();
  });
});
