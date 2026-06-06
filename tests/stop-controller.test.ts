import { describe, expect, it } from "vitest";
import { shouldStopHarness } from "../src/stop-controller";

function state({
  controlToolCalls = 0,
  startedAtMs,
  totalTokens = 0,
  turnsRun = 0,
}: {
  controlToolCalls?: number;
  startedAtMs?: number;
  totalTokens?: number;
  turnsRun?: number;
}) {
  return {
    runMetrics: {
      controlToolCalls,
      turnCount: turnsRun,
    },
    tokenUsage: {
      totalUsage: {
        totalTokens,
      },
    },
    startedAtMs,
    turnsRun,
  };
}

describe("shouldStopHarness", () => {
  it("stops when max step budget is reached", () => {
    expect(
      shouldStopHarness({ maxSteps: 50 }, state({ controlToolCalls: 50 }))
    ).toBe("max-steps:50");
  });

  it("stops when max turn budget is reached", () => {
    expect(shouldStopHarness({ maxTurns: 3 }, state({ turnsRun: 3 }))).toBe(
      "max-turns:3"
    );
  });

  it("stops when max token budget is reached", () => {
    expect(
      shouldStopHarness({ maxTokens: 200_000 }, state({ totalTokens: 200_000 }))
    ).toBe("max-tokens:200000");
  });

  it("stops when max wall-clock minute budget is reached", () => {
    expect(
      shouldStopHarness(
        { maxMinutes: 0.001 },
        state({ startedAtMs: Date.now() - 1000 })
      )
    ).toBe("max-minutes:0.001");
  });

  it("continues while all budgets remain below threshold", () => {
    expect(
      shouldStopHarness(
        { maxSteps: 50, maxTokens: 200_000, maxTurns: 10 },
        state({ controlToolCalls: 49, totalTokens: 199_999, turnsRun: 9 })
      )
    ).toBeUndefined();
  });
});
