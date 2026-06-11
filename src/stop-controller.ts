import type { RunMetricsSnapshot } from "./run-metrics";
import type { TokenUsageSnapshot } from "./token-usage";

export interface HarnessBudget {
  maxMinutes?: number;
  maxRamUnavailableTurns?: number;
  maxSteps?: number;
  maxTokens?: number;
  maxTurns?: number;
}

export interface HarnessStopState {
  ramUnavailableFallbacks?: number;
  runMetrics: Pick<RunMetricsSnapshot, "controlToolCalls" | "turnCount">;
  startedAtMs?: number;
  tokenUsage: {
    tokenCost: {
      totalUsage: Pick<TokenUsageSnapshot, "totalTokens">;
    };
  };
  turnsRun: number;
}

export function shouldStopHarness(
  budget: HarnessBudget,
  state: HarnessStopState
): string | undefined {
  if (
    budget.maxMinutes !== undefined &&
    state.startedAtMs !== undefined &&
    Date.now() - state.startedAtMs >= budget.maxMinutes * 60_000
  ) {
    return `max-minutes:${budget.maxMinutes}`;
  }
  if (
    budget.maxSteps !== undefined &&
    state.runMetrics.controlToolCalls >= budget.maxSteps
  ) {
    return `max-steps:${budget.maxSteps}`;
  }
  if (
    budget.maxRamUnavailableTurns !== undefined &&
    (state.ramUnavailableFallbacks ?? 0) >= budget.maxRamUnavailableTurns
  ) {
    return `ram-unavailable-turns:${budget.maxRamUnavailableTurns}`;
  }
  if (budget.maxTurns !== undefined && state.turnsRun >= budget.maxTurns) {
    return `max-turns:${budget.maxTurns}`;
  }
  if (
    budget.maxTokens !== undefined &&
    state.tokenUsage.tokenCost.totalUsage.totalTokens >= budget.maxTokens
  ) {
    return `max-tokens:${budget.maxTokens}`;
  }
  return;
}
