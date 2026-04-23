import { describe, expect, it } from "vitest";
import { decideReconciliationAction } from "./reconcile.js";

describe("decideReconciliationAction", () => {
  it('offers adopt when Discord exists but DB is missing', () => {
    expect(
      decideReconciliationAction({
        discordExists: true,
        dbExists: false,
        localSessionExists: true,
      }),
    ).toEqual({
      action: "offer-adopt-channel",
      executionAllowed: false,
    });
  });

  it('marks a channel tombstoned when Discord is missing but DB exists', () => {
    expect(
      decideReconciliationAction({
        discordExists: false,
        dbExists: true,
        localSessionExists: true,
      }),
    ).toEqual({
      action: "mark-channel-tombstoned",
      executionAllowed: false,
    });
  });

  it('marks a session unavailable when Discord and DB exist but the local session is missing', () => {
    expect(
      decideReconciliationAction({
        discordExists: true,
        dbExists: true,
        localSessionExists: false,
      }),
    ).toEqual({
      action: "mark-session-unavailable",
      executionAllowed: false,
    });
  });

  it("takes no action when everything is consistent", () => {
    expect(
      decideReconciliationAction({
        discordExists: true,
        dbExists: true,
        localSessionExists: true,
      }),
    ).toEqual({
      action: "no-action",
      executionAllowed: true,
    });
  });
});
