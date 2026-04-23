export type ReconciliationInput = {
  discordExists: boolean;
  dbExists: boolean;
  localSessionExists: boolean;
};

export type ReconciliationDecision =
  | {
      action: "offer-adopt-channel";
      executionAllowed: false;
    }
  | {
      action: "mark-channel-tombstoned";
      executionAllowed: false;
    }
  | {
      action: "mark-session-unavailable";
      executionAllowed: false;
    }
  | {
      action: "no-action";
      executionAllowed: true;
    };

export function decideReconciliationAction(
  input: ReconciliationInput,
): ReconciliationDecision {
  if (input.discordExists && !input.dbExists) {
    return {
      action: "offer-adopt-channel",
      executionAllowed: false,
    };
  }

  if (!input.discordExists && input.dbExists) {
    return {
      action: "mark-channel-tombstoned",
      executionAllowed: false,
    };
  }

  if (input.discordExists && input.dbExists && !input.localSessionExists) {
    return {
      action: "mark-session-unavailable",
      executionAllowed: false,
    };
  }

  return {
    action: "no-action",
    executionAllowed: true,
  };
}
