import { createHash } from "node:crypto";
import type { AgentEvent } from "@minpeter/pss-runtime";
import type { ExperimentMode } from "./run-trace";
import type {
  SupervisorInterventionEvent,
  SupervisorInterventionReason,
} from "./supervisor";
import type {
  TokenCostEstimate,
  TokenUsageCallMetadata,
  TokenUsageMetric,
  TokenUsageSnapshot,
} from "./token-usage";
import { estimateTokenCost } from "./token-usage";

const CONTROL_TOOLS = new Set([
  "mgba_tap",
  "mgba_tap_many",
  "mgba_hold",
  "mgba_hold_many",
  "mgba_release",
]);

type ControlOwner = "deterministic-controller" | "llm-fallback";
type OwnedAgentEvent = AgentEvent & { controlOwner?: ControlOwner };

export interface LlmFallbackInvocationEvent {
  attempt?: number;
  callMetadata?: TokenUsageCallMetadata;
  controlOwner?: "llm-fallback";
  directControl?: false;
  edgeKey?: string;
  maxAttempts?: number;
  phase?: string;
  policy?: string;
  reason?: string;
  timeoutMs?: number;
  type: "llm-fallback-invocation";
  validationReason?: string;
  waypoint?: string;
}

export type LlmFallbackOutcome =
  | "completed"
  | "error"
  | "interrupted"
  | "timeout";

export interface LlmFallbackCompletionEvent {
  attempt?: number;
  callMetadata?: TokenUsageCallMetadata;
  completionTokens?: number;
  controlOwner?: "llm-fallback";
  durationMs?: number;
  edgeKey?: string;
  maxAttempts?: number;
  modelName?: string;
  phase?: string;
  promptTokens?: number;
  result: LlmFallbackOutcome;
  timeoutMs?: number;
  totalTokens?: number;
  type: "llm-fallback-completion";
  usage?: TokenUsageSnapshot;
  waypoint?: string;
}

export interface VerificationFailureEvent {
  action?: string;
  expectedOutcome?: string;
  phase?: string;
  policy?: string;
  reason?: string;
  type: "verification-failure";
  waypoint?: string;
}

export interface BlockedRepeatedActionEvent {
  action?: string;
  attempts?: number;
  context?: string;
  phase?: string;
  policy?: string;
  type: "blocked-repeated-action";
  waypoint?: string;
}

type RunMetricsEvent =
  | BlockedRepeatedActionEvent
  | LlmFallbackCompletionEvent
  | LlmFallbackInvocationEvent
  | TokenUsageMetric
  | VerificationFailureEvent
  | OwnedAgentEvent
  | SupervisorInterventionEvent;

export interface GameplayActionMetricsSnapshot {
  aButtonControlCalls: number;
  actionEntropy: number;
  blockedRepeatedActionsTotal: number;
  controlToolCalls: number;
  currentPhase: string | undefined;
  currentStepStartedAt: number | undefined;
  currentTurnStartedAt: number | undefined;
  currentWaypoint: string | undefined;
  deterministicActionsTotal: number;
  deterministicControllerActionsTotal: number;
  deterministicControllerLastActionDurationMs: number;
  deterministicControllerTotalActionDurationMs: number;
  deterministicVsLlmActionRatio: number;
  failedToolCalls: number;
  fallbackRate: number;
  lastStepDurationMs: number;
  lastToolDurationMs: number;
  lastTurnDurationMs: number;
  llmFallbackCallsTotal: number;
  maxSameActionStreak: number;
  observeBeforeActRatio: number;
  sameActionStreak: number;
  screenChangedCount: number;
  screenshotCalls: number;
  screenUnchangedStreak: number;
  statusCalls: number;
  stepCount: number;
  stuckEvents: number;
  supervisorInterventions: number;
  toolCalls: number;
  toolErrorRate: number;
  turnCount: number;
  turnsWithControl: number;
  turnsWithObserveBeforeControl: number;
  uniqueActionCount: number;
  uniqueScreenCount: number;
  verificationFailuresTotal: number;
  verificationSuccessesTotal: number;
}

export interface LlmFallbackMetricsBoundary {
  averageDurationMs: number;
  callsTotal: number;
  completionTokensTotal: number;
  lastCallMetadata: TokenUsageCallMetadata | undefined;
  lastCostEstimate: TokenCostEstimate | undefined;
  lastDurationMs: number;
  lastEstimatedCostUsd: number;
  lastModelName: string | undefined;
  lastOutcome: LlmFallbackOutcome | undefined;
  lastTokenUsage: LlmFallbackTokenUsageSnapshot | undefined;
  namespace: "llm-fallback";
  outcomesTotal: Record<LlmFallbackOutcome, number>;
  pendingCalls: number;
  pricedCallsTotal: number;
  promptTokensTotal: number;
  source: "bounded-fallback-tracker";
  tokenUsageCalls: LlmFallbackCallTokenUsageSnapshot[];
  totalDurationMs: number;
  totalEstimatedCostUsd: number;
  totalTokensTotal: number;
  totalUsage: TokenUsageSnapshot;
  unpricedCallsTotal: number;
}

export interface LlmFallbackTokenUsageSnapshot {
  completionTokens: number;
  modelName: string | undefined;
  promptTokens: number;
  totalTokens: number;
  usage: TokenUsageSnapshot | undefined;
}

export interface LlmFallbackCallTokenUsageSnapshot
  extends LlmFallbackTokenUsageSnapshot {
  callKey: string | undefined;
  callMetadata: TokenUsageCallMetadata | undefined;
  costEstimate: TokenCostEstimate | undefined;
  estimatedCostUsd: number;
  pricingStatus: TokenCostEstimate["status"] | "unknown";
}

export interface DeterministicControllerMetricsBoundary {
  actionsTotal: number;
  averageActionDurationMs: number;
  lastActionDurationMs: number;
  namespace: "deterministic-controller";
  source: "runtime-game-state-controller";
  totalActionDurationMs: number;
}

export interface TokenCostMetricsBoundary {
  lastCostEstimate: TokenCostEstimate | undefined;
  lastEstimatedCostUsd: number;
  namespace: "token-cost";
  pricedCallsTotal: number;
  source: "token-usage-tracker";
  totalEstimatedCostUsd: number;
  totalTokens: number;
  unpricedCallsTotal: number;
}

export interface MilestoneProgressMetricsBoundary {
  completedRatio: number;
  current: string | undefined;
  currentRank: number;
  furthest: string | undefined;
  furthestRank: number;
  namespace: "milestone-progress";
  sequenceLength: number;
  source: "milestone-progress-tracker";
}

export interface RunMetricsSnapshot extends GameplayActionMetricsSnapshot {
  deterministicController: DeterministicControllerMetricsBoundary;
  gameplay: GameplayActionMetricsSnapshot;
  llmFallback: LlmFallbackMetricsBoundary;
  milestoneProgress: MilestoneProgressMetricsBoundary;
  tokenCost: TokenCostMetricsBoundary;
}

interface PendingToolCall {
  controlOwner?: ControlOwner;
  input: unknown;
  startedAt: number;
  toolName: string;
}

interface PendingLlmFallbackInvocation {
  startedAt: number;
}

export interface RunMetricsTrackerOptions {
  experimentId?: string;
  iteration?: number;
  mode?: ExperimentMode;
  runId?: string;
}

export class RunMetricsTracker {
  readonly #actionCounts = new Map<string, number>();
  readonly #llmFallbackOutcomes: Record<LlmFallbackOutcome, number> = {
    completed: 0,
    error: 0,
    interrupted: 0,
    timeout: 0,
  };
  readonly #pendingToolCalls = new Map<string, PendingToolCall>();
  readonly #pendingLlmFallbackInvocations = new Map<
    string,
    PendingLlmFallbackInvocation
  >();
  readonly #screenHashes = new Set<string>();
  #aButtonControlCalls = 0;
  #blockedRepeatedActionsTotal = 0;
  #controlToolCalls = 0;
  #currentPhase: string | undefined;
  #currentWaypoint: string | undefined;
  #currentStepStartedAt: number | undefined;
  #currentTurnHadControl = false;
  #currentTurnHadObservation = false;
  #currentTurnStartedAt: number | undefined;
  #failedToolCalls = 0;
  #deterministicActionsTotal = 0;
  #deterministicControllerLastActionDurationMs = 0;
  #deterministicControllerTotalActionDurationMs = 0;
  #lastActionKey: string | undefined;
  #lastScreenHash: string | undefined;
  #lastStepDurationMs = 0;
  #lastToolDurationMs = 0;
  #lastTurnDurationMs = 0;
  #llmFallbackLastDurationMs = 0;
  #llmFallbackLastCallMetadata: TokenUsageCallMetadata | undefined;
  #llmFallbackLastCostEstimate: TokenCostEstimate | undefined;
  #llmFallbackLastModelName: string | undefined;
  #llmFallbackLastOutcome: LlmFallbackOutcome | undefined;
  #llmFallbackLastTokenUsage: LlmFallbackTokenUsageSnapshot | undefined;
  readonly #llmFallbackTokenUsageCalls: LlmFallbackCallTokenUsageSnapshot[] =
    [];
  #llmFallbackCallsTotal = 0;
  #llmFallbackCompletionTokensTotal = 0;
  #llmFallbackPricedCallsTotal = 0;
  #llmFallbackPromptTokensTotal = 0;
  readonly #llmFallbackRecordedTokenMetricCallKeys = new Set<string>();
  #llmFallbackTotalEstimatedCostUsd = 0;
  #llmFallbackTokensTotal = 0;
  #llmFallbackTotalDurationMs = 0;
  #llmFallbackTotalUsage = emptyTokenUsage();
  #llmFallbackUnpricedCallsTotal = 0;
  #maxSameActionStreak = 0;
  #sameActionStreak = 0;
  #screenChangedCount = 0;
  #screenUnchangedStreak = 0;
  #screenshotCalls = 0;
  #statusCalls = 0;
  #stuckEvents = 0;
  #supervisorInterventions = 0;
  #tokenCostLastEstimate: TokenCostEstimate | undefined;
  #tokenCostPricedCallsTotal = 0;
  #tokenCostTotalEstimatedCostUsd = 0;
  #tokenCostTotalTokens = 0;
  #tokenCostUnpricedCallsTotal = 0;
  #verificationFailuresTotal = 0;
  #verificationSuccessesTotal = 0;
  #milestoneCurrent: string | undefined;
  #milestoneFurthest: string | undefined;
  #milestoneFurthestRank = 0;
  #milestoneSequence: readonly string[] = [];
  #milestoneSequenceLength = 0;
  #stepCount = 0;
  #toolCalls = 0;
  #turnCount = 0;
  #turnsWithControl = 0;
  #turnsWithObserveBeforeControl = 0;
  readonly #experimentId: string | undefined;
  readonly #iteration: number;
  readonly #mode: ExperimentMode | undefined;
  readonly #runId: string;

  constructor({
    experimentId,
    iteration = 0,
    mode,
    runId = "unknown",
  }: RunMetricsTrackerOptions = {}) {
    this.#experimentId = experimentId;
    this.#iteration = iteration;
    this.#mode = mode;
    this.#runId = runId;
  }

  recordEvent(event: RunMetricsEvent, now = Date.now()): void {
    if (event.type === "supervisor-intervention") {
      this.recordSupervisorIntervention(event.intervention.reason);
      return;
    }

    switch (event.type) {
      case "turn-start":
        this.#turnCount += 1;
        this.#currentTurnStartedAt = now;
        this.#currentTurnHadControl = false;
        this.#currentTurnHadObservation = false;
        return;
      case "turn-end":
      case "turn-abort":
      case "turn-error":
        if (this.#currentTurnStartedAt !== undefined) {
          this.#lastTurnDurationMs = now - this.#currentTurnStartedAt;
        }
        return;
      case "step-start":
        this.#stepCount += 1;
        this.#currentStepStartedAt = now;
        return;
      case "step-end":
        if (this.#currentStepStartedAt !== undefined) {
          this.#lastStepDurationMs = now - this.#currentStepStartedAt;
        }
        return;
      case "tool-call":
        this.#recordToolCall(event, now);
        return;
      case "tool-result":
        this.#recordToolResult(event, now);
        return;
      case "runtime-input":
        this.#recordRuntimeInput(event);
        return;
      case "llm-fallback-invocation":
        this.recordLlmFallbackInvocation(event, now);
        return;
      case "llm-fallback-completion":
        this.recordLlmFallbackCompletion(event, now);
        return;
      case "verification-failure":
        this.recordVerificationFailure({
          phase: event.phase,
          waypoint: event.waypoint,
        });
        return;
      case "blocked-repeated-action":
        this.recordBlockedRepeatedAction({
          phase: event.phase,
          waypoint: event.waypoint,
        });
        return;
      case "llm-step":
      case "turn-summary":
        this.recordTokenUsageMetric(event);
        return;
      default:
        return;
    }
  }

  recordSupervisorIntervention(_reason: SupervisorInterventionReason): void {
    this.#supervisorInterventions += 1;
  }

  recordStuckEvents(stuckEvents: number): void {
    this.#stuckEvents = Math.max(this.#stuckEvents, stuckEvents);
  }

  recordBlockedRepeatedActions(blockedRepeatedActions: number): void {
    this.#blockedRepeatedActionsTotal = Math.max(
      this.#blockedRepeatedActionsTotal,
      blockedRepeatedActions
    );
  }

  recordControllerAction({
    phase,
    waypoint,
  }: {
    phase?: string;
    waypoint?: string;
  } = {}): void {
    this.#deterministicActionsTotal += 1;
    this.recordPhase({ phase, waypoint });
  }

  recordLlmFallback({
    phase,
    waypoint,
  }: {
    phase?: string;
    waypoint?: string;
  } = {}): void {
    this.#llmFallbackCallsTotal += 1;
    this.recordPhase({ phase, waypoint });
  }

  recordLlmFallbackInvocation(
    event: LlmFallbackInvocationEvent,
    now = Date.now()
  ): void {
    this.recordLlmFallback({
      phase: event.phase,
      waypoint: event.waypoint,
    });
    this.#pendingLlmFallbackInvocations.set(llmFallbackInvocationKey(event), {
      startedAt: now,
    });
  }

  recordLlmFallbackCompletion(
    event: LlmFallbackCompletionEvent,
    now = Date.now()
  ): void {
    this.#llmFallbackOutcomes[event.result] += 1;
    this.#llmFallbackLastOutcome = event.result;
    this.#recordLlmFallbackTokenUsage(event);
    this.recordPhase({ phase: event.phase, waypoint: event.waypoint });

    const key = llmFallbackInvocationKey(event);
    const pending = this.#pendingLlmFallbackInvocations.get(key);
    const durationMs =
      event.durationMs ??
      (pending ? Math.max(0, now - pending.startedAt) : undefined);
    if (durationMs !== undefined) {
      this.#llmFallbackLastDurationMs = durationMs;
      this.#llmFallbackTotalDurationMs += durationMs;
    }
    this.#pendingLlmFallbackInvocations.delete(key);
  }

  #recordLlmFallbackTokenUsage(event: LlmFallbackCompletionEvent): void {
    const callKey = llmFallbackCallKey(event);
    const promptTokens = event.promptTokens ?? event.usage?.inputTokens ?? 0;
    const completionTokens =
      event.completionTokens ?? event.usage?.outputTokens ?? 0;
    const totalTokens =
      event.totalTokens ??
      event.usage?.totalTokens ??
      promptTokens + completionTokens;
    const usage =
      event.usage ??
      fallbackUsageFromTokenCounts({
        completionTokens,
        promptTokens,
        totalTokens,
      });
    const shouldAccumulate = !(
      callKey && this.#llmFallbackRecordedTokenMetricCallKeys.has(callKey)
    );

    if (shouldAccumulate) {
      this.#accumulateLlmFallbackUsage(usage, {
        callKey,
        callMetadata: event.callMetadata,
        costEstimate: event.modelName
          ? estimateTokenCost(usage, event.modelName)
          : undefined,
        modelName: event.modelName,
      });
    }
    this.#llmFallbackLastModelName = event.modelName;
    this.#llmFallbackLastCallMetadata = event.callMetadata
      ? { ...event.callMetadata }
      : undefined;
    this.#llmFallbackLastTokenUsage = {
      completionTokens,
      modelName: event.modelName,
      promptTokens,
      totalTokens,
      usage: event.usage ? { ...event.usage } : undefined,
    };
  }

  recordPhase({
    phase,
    waypoint,
  }: {
    phase?: string;
    waypoint?: string;
  }): void {
    this.#currentPhase = phase ?? this.#currentPhase;
    this.#currentWaypoint = waypoint ?? this.#currentWaypoint;
  }

  recordVerification(result: "failure" | "success"): void {
    if (result === "failure") {
      this.recordVerificationFailure();
      return;
    }
    this.#verificationSuccessesTotal += 1;
  }

  recordVerificationFailure({
    phase,
    waypoint,
  }: {
    phase?: string;
    waypoint?: string;
  } = {}): void {
    this.#verificationFailuresTotal += 1;
    this.recordPhase({ phase, waypoint });
  }

  recordBlockedRepeatedAction({
    phase,
    waypoint,
  }: {
    phase?: string;
    waypoint?: string;
  } = {}): void {
    this.#blockedRepeatedActionsTotal += 1;
    this.recordPhase({ phase, waypoint });
  }

  recordTokenUsageMetric(metric: TokenUsageMetric): void {
    if (metric.type !== "llm-step") {
      return;
    }
    this.#tokenCostTotalTokens += metric.usage.totalTokens;
    const costEstimate =
      metric.costEstimate ?? estimateTokenCost(metric.usage, metric.modelId);
    this.#tokenCostLastEstimate = costEstimate;
    this.#tokenCostTotalEstimatedCostUsd += costEstimate.estimatedCostUsd;
    if (costEstimate.status === "estimated") {
      this.#tokenCostPricedCallsTotal += 1;
    } else {
      this.#tokenCostUnpricedCallsTotal += 1;
    }
    if (isLlmFallbackTokenMetric(metric)) {
      const callKey = llmFallbackCallKey(metric);
      if (callKey) {
        this.#llmFallbackRecordedTokenMetricCallKeys.add(callKey);
      }
      this.#accumulateLlmFallbackUsage(metric.usage, {
        callKey,
        callMetadata: metric.callMetadata,
        costEstimate,
        modelName: metric.modelName ?? metric.modelId,
      });
    }
  }

  #accumulateLlmFallbackUsage(
    usage: TokenUsageSnapshot,
    {
      callKey,
      callMetadata,
      costEstimate,
      modelName,
    }: {
      callKey?: string;
      callMetadata?: TokenUsageCallMetadata;
      costEstimate?: TokenCostEstimate;
      modelName?: string;
    } = {}
  ): void {
    this.#llmFallbackPromptTokensTotal += usage.inputTokens;
    this.#llmFallbackCompletionTokensTotal += usage.outputTokens;
    this.#llmFallbackTokensTotal += usage.totalTokens;
    this.#llmFallbackTotalUsage = addTokenUsage(
      this.#llmFallbackTotalUsage,
      usage
    );
    if (costEstimate) {
      this.#llmFallbackLastCostEstimate = costEstimate;
      this.#llmFallbackTotalEstimatedCostUsd += costEstimate.estimatedCostUsd;
      if (costEstimate.status === "estimated") {
        this.#llmFallbackPricedCallsTotal += 1;
      } else {
        this.#llmFallbackUnpricedCallsTotal += 1;
      }
    }
    this.#llmFallbackLastModelName = modelName;
    this.#llmFallbackLastCallMetadata = callMetadata
      ? { ...callMetadata }
      : this.#llmFallbackLastCallMetadata;
    this.#llmFallbackLastTokenUsage = {
      completionTokens: usage.outputTokens,
      modelName,
      promptTokens: usage.inputTokens,
      totalTokens: usage.totalTokens,
      usage: { ...usage },
    };
    this.#llmFallbackTokenUsageCalls.push({
      callKey,
      callMetadata: callMetadata ? { ...callMetadata } : undefined,
      completionTokens: usage.outputTokens,
      costEstimate: costEstimate ? cloneCostEstimate(costEstimate) : undefined,
      estimatedCostUsd: costEstimate?.estimatedCostUsd ?? 0,
      modelName,
      pricingStatus: costEstimate?.status ?? "unknown",
      promptTokens: usage.inputTokens,
      totalTokens: usage.totalTokens,
      usage: { ...usage },
    });
  }

  recordMilestoneProgress({
    current,
    furthest,
    sequence,
  }: {
    current?: string | null;
    furthest?: string | null;
    sequence?: readonly string[];
  }): void {
    if (sequence) {
      this.#milestoneSequence = sequence;
      this.#milestoneSequenceLength = sequence.length;
    }

    const milestoneSequence = sequence ?? this.#milestoneSequence;
    const nextCurrent = current ?? undefined;
    const nextFurthest = furthest ?? nextCurrent;
    this.#milestoneCurrent = nextCurrent ?? this.#milestoneCurrent;
    if (!nextFurthest) {
      return;
    }

    const nextRank = rankMilestone(nextFurthest, milestoneSequence);
    if (!this.#milestoneFurthest || nextRank >= this.#milestoneFurthestRank) {
      this.#milestoneFurthest = nextFurthest;
      this.#milestoneFurthestRank = nextRank;
    }
  }

  prometheusMetrics(): string {
    const snapshot = this.snapshot();
    return [
      "# HELP pss_mgba_tool_calls_total Total tool calls in the current process by category.",
      "# TYPE pss_mgba_tool_calls_total counter",
      `pss_mgba_tool_calls_total${this.#labels("all")} ${snapshot.toolCalls}`,
      `pss_mgba_tool_calls_total${this.#labels("control")} ${snapshot.controlToolCalls}`,
      `pss_mgba_tool_calls_total${this.#labels("screenshot")} ${snapshot.screenshotCalls}`,
      `pss_mgba_tool_calls_total${this.#labels("status")} ${snapshot.statusCalls}`,
      `pss_mgba_tool_calls_total${this.#labels("failed")} ${snapshot.failedToolCalls}`,
      "# HELP pss_mgba_supervisor_interventions_total Total local supervisor action overrides or waits.",
      "# TYPE pss_mgba_supervisor_interventions_total counter",
      `pss_mgba_supervisor_interventions_total${this.#labels()} ${snapshot.supervisorInterventions}`,
      "# HELP pss_mgba_stuck_events_total Repeated failed movement detections in the current run.",
      "# TYPE pss_mgba_stuck_events_total counter",
      `pss_mgba_stuck_events_total${this.#labels()} ${snapshot.stuckEvents}`,
      "# HELP pss_mgba_blocked_repeated_actions_total Same state/action no-progress edges blocked after repeated attempts; distinct from verification failures.",
      "# TYPE pss_mgba_blocked_repeated_actions_total counter",
      `pss_mgba_blocked_repeated_actions_total${this.#labels()} ${snapshot.blockedRepeatedActionsTotal}`,
      "# HELP pss_mgba_controller_actions_total Deterministic controller and LLM fallback action counts.",
      "# TYPE pss_mgba_controller_actions_total counter",
      `pss_mgba_controller_actions_total${this.#labels("deterministic")} ${snapshot.deterministicActionsTotal}`,
      `pss_mgba_controller_actions_total${this.#labels("llm_fallback")} ${snapshot.llmFallbackCallsTotal}`,
      "# HELP pss_mgba_deterministic_controller_actions_total Deterministic controller actions selected before LLM fallback.",
      "# TYPE pss_mgba_deterministic_controller_actions_total counter",
      `pss_mgba_deterministic_controller_actions_total${this.#labels()} ${snapshot.deterministicControllerActionsTotal}`,
      "# HELP pss_mgba_llm_fallback_calls_total LLM fallback admissions after deterministic controller cannot act.",
      "# TYPE pss_mgba_llm_fallback_calls_total counter",
      `pss_mgba_llm_fallback_calls_total${this.#labels()} ${snapshot.llmFallbackCallsTotal}`,
      "# HELP pss_mgba_llm_fallback_outcomes_total LLM fallback completion outcomes independent of controller actions.",
      "# TYPE pss_mgba_llm_fallback_outcomes_total counter",
      `pss_mgba_llm_fallback_outcomes_total${this.#labelsWith({ outcome: "completed" })} ${snapshot.llmFallback.outcomesTotal.completed}`,
      `pss_mgba_llm_fallback_outcomes_total${this.#labelsWith({ outcome: "error" })} ${snapshot.llmFallback.outcomesTotal.error}`,
      `pss_mgba_llm_fallback_outcomes_total${this.#labelsWith({ outcome: "interrupted" })} ${snapshot.llmFallback.outcomesTotal.interrupted}`,
      `pss_mgba_llm_fallback_outcomes_total${this.#labelsWith({ outcome: "timeout" })} ${snapshot.llmFallback.outcomesTotal.timeout}`,
      "# HELP pss_mgba_llm_fallback_duration_ms LLM fallback analyst invocation durations independent of controller tool timings.",
      "# TYPE pss_mgba_llm_fallback_duration_ms gauge",
      `pss_mgba_llm_fallback_duration_ms${this.#labels("last")} ${snapshot.llmFallback.lastDurationMs}`,
      `pss_mgba_llm_fallback_duration_ms${this.#labels("total")} ${snapshot.llmFallback.totalDurationMs}`,
      `pss_mgba_llm_fallback_duration_ms${this.#labels("average")} ${snapshot.llmFallback.averageDurationMs}`,
      "# HELP pss_mgba_llm_fallback_pending Current LLM fallback invocations awaiting completion.",
      "# TYPE pss_mgba_llm_fallback_pending gauge",
      `pss_mgba_llm_fallback_pending${this.#labels()} ${snapshot.llmFallback.pendingCalls}`,
      "# HELP pss_mgba_llm_fallback_tokens_total LLM fallback analyst tokens by kind from bounded fallback usage and completion events.",
      "# TYPE pss_mgba_llm_fallback_tokens_total counter",
      `pss_mgba_llm_fallback_tokens_total${this.#labels("prompt")} ${snapshot.llmFallback.promptTokensTotal}`,
      `pss_mgba_llm_fallback_tokens_total${this.#labels("completion")} ${snapshot.llmFallback.completionTokensTotal}`,
      `pss_mgba_llm_fallback_tokens_total${this.#labels("total")} ${snapshot.llmFallback.totalTokensTotal}`,
      "# HELP pss_mgba_llm_fallback_token_cost_estimated_usd Estimated model token cost in USD for bounded LLM fallback analyst calls.",
      "# TYPE pss_mgba_llm_fallback_token_cost_estimated_usd gauge",
      `pss_mgba_llm_fallback_token_cost_estimated_usd${this.#labels("last")} ${snapshot.llmFallback.lastEstimatedCostUsd}`,
      `pss_mgba_llm_fallback_token_cost_estimated_usd${this.#labels("total")} ${snapshot.llmFallback.totalEstimatedCostUsd}`,
      "# HELP pss_mgba_llm_fallback_token_cost_pricing_calls_total Bounded LLM fallback usage calls by pricing resolution status.",
      "# TYPE pss_mgba_llm_fallback_token_cost_pricing_calls_total counter",
      `pss_mgba_llm_fallback_token_cost_pricing_calls_total${this.#labels("priced")} ${snapshot.llmFallback.pricedCallsTotal}`,
      `pss_mgba_llm_fallback_token_cost_pricing_calls_total${this.#labels("unpriced")} ${snapshot.llmFallback.unpricedCallsTotal}`,
      "# HELP pss_mgba_fallback_rate LLM fallback calls divided by controller plus fallback decisions.",
      "# TYPE pss_mgba_fallback_rate gauge",
      `pss_mgba_fallback_rate${this.#labels()} ${snapshot.fallbackRate}`,
      "# HELP pss_mgba_deterministic_vs_llm_action_ratio Deterministic actions divided by LLM fallback calls.",
      "# TYPE pss_mgba_deterministic_vs_llm_action_ratio gauge",
      `pss_mgba_deterministic_vs_llm_action_ratio${this.#labels()} ${snapshot.deterministicVsLlmActionRatio}`,
      "# HELP pss_mgba_verification_results_total Post-action verification result counts.",
      "# TYPE pss_mgba_verification_results_total counter",
      `pss_mgba_verification_results_total${this.#labels("success")} ${snapshot.verificationSuccessesTotal}`,
      `pss_mgba_verification_results_total${this.#labels("failure")} ${snapshot.verificationFailuresTotal}`,
      "# HELP pss_mgba_verification_failures_total Dedicated post-action verification failure count distinct from tool, stuck, supervisor, and fallback failures.",
      "# TYPE pss_mgba_verification_failures_total counter",
      `pss_mgba_verification_failures_total${this.#labels()} ${snapshot.verificationFailuresTotal}`,
      "# HELP pss_mgba_current_phase Current deterministic controller phase and waypoint.",
      "# TYPE pss_mgba_current_phase gauge",
      `pss_mgba_current_phase${this.#labelsWith({ phase: snapshot.currentPhase ?? "unknown", waypoint: snapshot.currentWaypoint ?? "unknown" })} 1`,
      "# HELP pss_mgba_milestone_progress_rank Furthest Stage 1 milestone rank from the dedicated milestone progress tracker.",
      "# TYPE pss_mgba_milestone_progress_rank gauge",
      `pss_mgba_milestone_progress_rank${this.#labelsWith({ milestone: snapshot.milestoneProgress.furthest ?? "none", source: snapshot.milestoneProgress.source })} ${snapshot.milestoneProgress.furthestRank}`,
      "# HELP pss_mgba_milestone_progress_ratio Furthest Stage 1 milestone progress ratio from the dedicated milestone progress tracker.",
      "# TYPE pss_mgba_milestone_progress_ratio gauge",
      `pss_mgba_milestone_progress_ratio${this.#labelsWith({ milestone: snapshot.milestoneProgress.furthest ?? "none", source: snapshot.milestoneProgress.source })} ${snapshot.milestoneProgress.completedRatio}`,
      "# HELP pss_mgba_token_cost_estimated_usd Estimated model token cost in USD from token usage events.",
      "# TYPE pss_mgba_token_cost_estimated_usd gauge",
      `pss_mgba_token_cost_estimated_usd${this.#labels("last")} ${snapshot.tokenCost.lastEstimatedCostUsd}`,
      `pss_mgba_token_cost_estimated_usd${this.#labels("total")} ${snapshot.tokenCost.totalEstimatedCostUsd}`,
      "# HELP pss_mgba_token_cost_pricing_calls_total Token usage calls by pricing resolution status.",
      "# TYPE pss_mgba_token_cost_pricing_calls_total counter",
      `pss_mgba_token_cost_pricing_calls_total${this.#labels("priced")} ${snapshot.tokenCost.pricedCallsTotal}`,
      `pss_mgba_token_cost_pricing_calls_total${this.#labels("unpriced")} ${snapshot.tokenCost.unpricedCallsTotal}`,
      "# HELP pss_mgba_control_a_button_ratio Ratio of control tool calls that include A.",
      "# TYPE pss_mgba_control_a_button_ratio gauge",
      `pss_mgba_control_a_button_ratio${this.#labels()} ${ratio(snapshot.aButtonControlCalls, snapshot.controlToolCalls)}`,
      "# HELP pss_mgba_action_entropy Diversity of control actions in bits. Lower values indicate repetitive controls.",
      "# TYPE pss_mgba_action_entropy gauge",
      `pss_mgba_action_entropy${this.#labels()} ${snapshot.actionEntropy}`,
      "# HELP pss_mgba_same_action_streak Current and max repeated same-action streak.",
      "# TYPE pss_mgba_same_action_streak gauge",
      `pss_mgba_same_action_streak${this.#labels("current")} ${snapshot.sameActionStreak}`,
      `pss_mgba_same_action_streak${this.#labels("max")} ${snapshot.maxSameActionStreak}`,
      "# HELP pss_mgba_visual_novelty Screens observed and changed.",
      "# TYPE pss_mgba_visual_novelty gauge",
      `pss_mgba_visual_novelty${this.#labels("unique_screens")} ${snapshot.uniqueScreenCount}`,
      `pss_mgba_visual_novelty${this.#labels("screen_changes")} ${snapshot.screenChangedCount}`,
      `pss_mgba_visual_novelty${this.#labels("unchanged_streak")} ${snapshot.screenUnchangedStreak}`,
      "# HELP pss_mgba_observe_before_act_ratio Ratio of control turns where observation happened before control.",
      "# TYPE pss_mgba_observe_before_act_ratio gauge",
      `pss_mgba_observe_before_act_ratio${this.#labels()} ${snapshot.observeBeforeActRatio}`,
      "# HELP pss_mgba_duration_ms Observed durations by kind, including controller-owned last and accumulated durations.",
      "# TYPE pss_mgba_duration_ms gauge",
      `pss_mgba_duration_ms${this.#labels("turn")} ${snapshot.lastTurnDurationMs}`,
      `pss_mgba_duration_ms${this.#labels("step")} ${snapshot.lastStepDurationMs}`,
      `pss_mgba_duration_ms${this.#labels("tool")} ${snapshot.lastToolDurationMs}`,
      `pss_mgba_duration_ms${this.#labels("deterministic_controller_tool")} ${snapshot.deterministicControllerLastActionDurationMs}`,
      `pss_mgba_duration_ms${this.#labels("deterministic_controller_total")} ${snapshot.deterministicControllerTotalActionDurationMs}`,
      "# HELP pss_mgba_tool_error_rate Failed tool calls divided by all tool calls.",
      "# TYPE pss_mgba_tool_error_rate gauge",
      `pss_mgba_tool_error_rate${this.#labels()} ${snapshot.toolErrorRate}`,
      "",
    ].join("\n");
  }

  snapshot(): RunMetricsSnapshot {
    const gameplay: GameplayActionMetricsSnapshot = {
      aButtonControlCalls: this.#aButtonControlCalls,
      actionEntropy: entropy([...this.#actionCounts.values()]),
      blockedRepeatedActionsTotal: this.#blockedRepeatedActionsTotal,
      controlToolCalls: this.#controlToolCalls,
      currentPhase: this.#currentPhase,
      currentStepStartedAt: this.#currentStepStartedAt,
      currentTurnStartedAt: this.#currentTurnStartedAt,
      currentWaypoint: this.#currentWaypoint,
      deterministicControllerActionsTotal: this.#deterministicActionsTotal,
      deterministicControllerLastActionDurationMs:
        this.#deterministicControllerLastActionDurationMs,
      deterministicControllerTotalActionDurationMs:
        this.#deterministicControllerTotalActionDurationMs,
      deterministicActionsTotal: this.#deterministicActionsTotal,
      deterministicVsLlmActionRatio: ratio(
        this.#deterministicActionsTotal,
        this.#llmFallbackCallsTotal
      ),
      failedToolCalls: this.#failedToolCalls,
      fallbackRate: ratio(
        this.#llmFallbackCallsTotal,
        this.#deterministicActionsTotal + this.#llmFallbackCallsTotal
      ),
      lastStepDurationMs: this.#lastStepDurationMs,
      lastToolDurationMs: this.#lastToolDurationMs,
      lastTurnDurationMs: this.#lastTurnDurationMs,
      llmFallbackCallsTotal: this.#llmFallbackCallsTotal,
      maxSameActionStreak: this.#maxSameActionStreak,
      observeBeforeActRatio: ratio(
        this.#turnsWithObserveBeforeControl,
        this.#turnsWithControl
      ),
      sameActionStreak: this.#sameActionStreak,
      screenshotCalls: this.#screenshotCalls,
      screenChangedCount: this.#screenChangedCount,
      screenUnchangedStreak: this.#screenUnchangedStreak,
      statusCalls: this.#statusCalls,
      supervisorInterventions: this.#supervisorInterventions,
      verificationFailuresTotal: this.#verificationFailuresTotal,
      verificationSuccessesTotal: this.#verificationSuccessesTotal,
      stuckEvents: this.#stuckEvents,
      stepCount: this.#stepCount,
      toolCalls: this.#toolCalls,
      toolErrorRate: ratio(this.#failedToolCalls, this.#toolCalls),
      turnCount: this.#turnCount,
      turnsWithControl: this.#turnsWithControl,
      turnsWithObserveBeforeControl: this.#turnsWithObserveBeforeControl,
      uniqueActionCount: this.#actionCounts.size,
      uniqueScreenCount: this.#screenHashes.size,
    };

    return {
      ...gameplay,
      deterministicController: {
        actionsTotal: this.#deterministicActionsTotal,
        averageActionDurationMs: ratio(
          this.#deterministicControllerTotalActionDurationMs,
          this.#deterministicActionsTotal
        ),
        lastActionDurationMs: this.#deterministicControllerLastActionDurationMs,
        namespace: "deterministic-controller",
        source: "runtime-game-state-controller",
        totalActionDurationMs:
          this.#deterministicControllerTotalActionDurationMs,
      },
      gameplay,
      llmFallback: {
        averageDurationMs: ratio(
          this.#llmFallbackTotalDurationMs,
          completedLlmFallbackOutcomes(this.#llmFallbackOutcomes)
        ),
        completionTokensTotal: this.#llmFallbackCompletionTokensTotal,
        callsTotal: this.#llmFallbackCallsTotal,
        lastCallMetadata: this.#llmFallbackLastCallMetadata
          ? { ...this.#llmFallbackLastCallMetadata }
          : undefined,
        lastCostEstimate: this.#llmFallbackLastCostEstimate
          ? cloneCostEstimate(this.#llmFallbackLastCostEstimate)
          : undefined,
        lastDurationMs: this.#llmFallbackLastDurationMs,
        lastEstimatedCostUsd:
          this.#llmFallbackLastCostEstimate?.estimatedCostUsd ?? 0,
        lastModelName: this.#llmFallbackLastModelName,
        lastOutcome: this.#llmFallbackLastOutcome,
        lastTokenUsage: this.#llmFallbackLastTokenUsage
          ? {
              ...this.#llmFallbackLastTokenUsage,
              usage: this.#llmFallbackLastTokenUsage.usage
                ? { ...this.#llmFallbackLastTokenUsage.usage }
                : undefined,
            }
          : undefined,
        namespace: "llm-fallback",
        outcomesTotal: { ...this.#llmFallbackOutcomes },
        pendingCalls: this.#pendingLlmFallbackInvocations.size,
        promptTokensTotal: this.#llmFallbackPromptTokensTotal,
        pricedCallsTotal: this.#llmFallbackPricedCallsTotal,
        source: "bounded-fallback-tracker",
        totalEstimatedCostUsd: this.#llmFallbackTotalEstimatedCostUsd,
        totalTokensTotal: this.#llmFallbackTokensTotal,
        totalUsage: { ...this.#llmFallbackTotalUsage },
        totalDurationMs: this.#llmFallbackTotalDurationMs,
        tokenUsageCalls: this.#llmFallbackTokenUsageCalls.map(
          cloneLlmFallbackCallTokenUsage
        ),
        unpricedCallsTotal: this.#llmFallbackUnpricedCallsTotal,
      },
      milestoneProgress: {
        completedRatio:
          this.#milestoneSequenceLength > 0
            ? this.#milestoneFurthestRank / this.#milestoneSequenceLength
            : 0,
        current: this.#milestoneCurrent,
        currentRank: rankMilestone(
          this.#milestoneCurrent,
          this.#milestoneSequence
        ),
        furthest: this.#milestoneFurthest,
        furthestRank: this.#milestoneFurthestRank,
        namespace: "milestone-progress",
        sequenceLength: this.#milestoneSequenceLength,
        source: "milestone-progress-tracker",
      },
      tokenCost: {
        lastCostEstimate: this.#tokenCostLastEstimate
          ? {
              ...this.#tokenCostLastEstimate,
              pricing: this.#tokenCostLastEstimate.pricing
                ? { ...this.#tokenCostLastEstimate.pricing }
                : undefined,
            }
          : undefined,
        lastEstimatedCostUsd:
          this.#tokenCostLastEstimate?.estimatedCostUsd ?? 0,
        namespace: "token-cost",
        pricedCallsTotal: this.#tokenCostPricedCallsTotal,
        source: "token-usage-tracker",
        totalEstimatedCostUsd: this.#tokenCostTotalEstimatedCostUsd,
        totalTokens: this.#tokenCostTotalTokens,
        unpricedCallsTotal: this.#tokenCostUnpricedCallsTotal,
      },
    };
  }

  #labels(category?: string): string {
    return this.#labelsWith(category ? { category, kind: category } : {});
  }

  #labelsWith(extra: Record<string, string | undefined>): string {
    const entries = [
      `run_id="${escapeLabel(this.#runId)}"`,
      `iteration="${this.#iteration}"`,
    ];
    if (this.#mode) {
      entries.push(`mode="${escapeLabel(this.#mode)}"`);
    }
    if (this.#experimentId) {
      entries.push(`experiment_id="${escapeLabel(this.#experimentId)}"`);
    }
    for (const [key, value] of Object.entries(extra)) {
      if (value !== undefined) {
        entries.push(`${key}="${escapeLabel(value)}"`);
      }
    }
    return `{${entries.join(",")}}`;
  }

  #recordToolCall(
    event: Extract<OwnedAgentEvent, { type: "tool-call" }>,
    now: number
  ): void {
    this.#toolCalls += 1;
    this.#pendingToolCalls.set(event.toolCallId, {
      controlOwner: event.controlOwner,
      input: event.input,
      startedAt: now,
      toolName: event.toolName,
    });

    if (event.toolName === "mgba_screenshot") {
      this.#screenshotCalls += 1;
      this.#currentTurnHadObservation = true;
      return;
    }

    if (event.toolName === "mgba_status") {
      this.#statusCalls += 1;
      this.#currentTurnHadObservation = true;
      return;
    }

    if (CONTROL_TOOLS.has(event.toolName)) {
      if (event.controlOwner === "deterministic-controller") {
        this.#deterministicActionsTotal += 1;
      }
      this.#recordControl(event.toolName, event.input);
    }
  }

  #recordToolResult(
    event: Extract<AgentEvent, { type: "tool-result" }>,
    now: number
  ): void {
    const pending = this.#pendingToolCalls.get(event.toolCallId);
    if (pending) {
      const durationMs = now - pending.startedAt;
      this.#lastToolDurationMs = durationMs;
      if (
        pending.controlOwner === "deterministic-controller" &&
        CONTROL_TOOLS.has(pending.toolName)
      ) {
        this.#deterministicControllerLastActionDurationMs = durationMs;
        this.#deterministicControllerTotalActionDurationMs += durationMs;
      }
      this.#pendingToolCalls.delete(event.toolCallId);
    }

    if (isToolError(event.output)) {
      this.#failedToolCalls += 1;
    }

    if (event.toolName === "mgba_screenshot") {
      this.#recordScreenshotResult(event.output);
    }
  }

  #recordControl(toolName: string, input: unknown): void {
    this.#controlToolCalls += 1;
    if (!this.#currentTurnHadControl) {
      this.#turnsWithControl += 1;
      if (this.#currentTurnHadObservation) {
        this.#turnsWithObserveBeforeControl += 1;
      }
      this.#currentTurnHadControl = true;
    }

    const buttons = extractButtons(input);
    if (buttons.includes("A")) {
      this.#aButtonControlCalls += 1;
    }

    const actionKey = `${toolName}:${buttons.join("+") || JSON.stringify(input)}`;
    this.#actionCounts.set(
      actionKey,
      (this.#actionCounts.get(actionKey) ?? 0) + 1
    );
    if (this.#lastActionKey === actionKey) {
      this.#sameActionStreak += 1;
    } else {
      this.#sameActionStreak = 1;
      this.#lastActionKey = actionKey;
    }
    this.#maxSameActionStreak = Math.max(
      this.#maxSameActionStreak,
      this.#sameActionStreak
    );
  }

  #recordScreenshotResult(output: unknown): void {
    const data = extractScreenshotData(output);
    if (!data) {
      return;
    }

    this.#recordScreenData(data);
  }

  #recordRuntimeInput(
    event: Extract<AgentEvent, { type: "runtime-input" }>
  ): void {
    const data = extractObservedRuntimeInputScreenshotData(event.input);
    if (!data) {
      return;
    }

    this.#currentTurnHadObservation = true;
    this.#recordScreenData(data);
  }

  #recordScreenData(data: string): void {
    const hash = createHash("sha256").update(data).digest("hex");
    this.#screenHashes.add(hash);
    if (this.#lastScreenHash && this.#lastScreenHash !== hash) {
      this.#screenChangedCount += 1;
      this.#screenUnchangedStreak = 0;
    } else if (this.#lastScreenHash === hash) {
      this.#screenUnchangedStreak += 1;
    }
    this.#lastScreenHash = hash;
  }
}

function escapeLabel(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function extractButtons(input: unknown): string[] {
  if (!input || typeof input !== "object") {
    return [];
  }
  const record = input as { button?: unknown; buttons?: unknown };
  if (typeof record.button === "string") {
    return [record.button];
  }
  if (Array.isArray(record.buttons)) {
    return record.buttons.filter(
      (button): button is string => typeof button === "string"
    );
  }
  return [];
}

function extractScreenshotData(output: unknown): string | undefined {
  if (!output || typeof output !== "object") {
    return;
  }
  const value =
    "value" in output ? (output as { value?: unknown }).value : output;
  if (!value || typeof value !== "object") {
    return;
  }
  const data = (value as { data?: unknown }).data;
  return typeof data === "string" ? data : undefined;
}

function extractObservedRuntimeInputScreenshotData(
  input: Extract<AgentEvent, { type: "runtime-input" }>["input"]
): string | undefined {
  if (input.type !== "user-message") {
    return;
  }

  const hasObservedStatus = input.content.some(
    (part) => part.type === "text" && part.text.includes("Current mGBA status:")
  );
  if (!hasObservedStatus) {
    return;
  }

  const image = input.content.find((part) => part.type === "image");
  return image?.image;
}

function isToolError(output: unknown): boolean {
  if (!output || typeof output !== "object") {
    return false;
  }
  const value =
    "value" in output ? (output as { value?: unknown }).value : output;
  if (typeof value === "string") {
    return value.toLowerCase().includes("error");
  }
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as { ok?: unknown; type?: unknown };
  return record.ok === false || record.type === "error-text";
}

function entropy(counts: number[]): number {
  const total = counts.reduce((sum, count) => sum + count, 0);
  if (total === 0) {
    return 0;
  }
  return counts.reduce((sum, count) => {
    const probability = count / total;
    return sum - probability * Math.log2(probability);
  }, 0);
}

function ratio(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

function llmFallbackInvocationKey({ edgeKey }: { edgeKey?: string }): string {
  return edgeKey ?? "__unkeyed_llm_fallback__";
}

function llmFallbackCallKey({
  attempt: eventAttempt,
  callMetadata,
  edgeKey,
}: {
  attempt?: number | string;
  callMetadata?: TokenUsageCallMetadata;
  edgeKey?: string;
}): string | undefined {
  const metadataEdgeKey = stringMetadata(callMetadata, "edgeKey");
  const resolvedEdgeKey = edgeKey ?? metadataEdgeKey;
  const attempt = eventAttempt ?? scalarMetadata(callMetadata, "attempt");
  if (!resolvedEdgeKey && attempt === undefined) {
    return;
  }
  return `${resolvedEdgeKey ?? "__unknown_edge__"}:${attempt ?? "__unknown_attempt__"}`;
}

function isLlmFallbackTokenMetric(
  metric: Extract<TokenUsageMetric, { type: "llm-step" }>
): boolean {
  return (
    stringMetadata(metric.callMetadata, "controlOwner") === "llm-fallback" ||
    stringMetadata(metric.callMetadata, "callPath") === "bounded-llm-fallback"
  );
}

function cloneLlmFallbackCallTokenUsage(
  call: LlmFallbackCallTokenUsageSnapshot
): LlmFallbackCallTokenUsageSnapshot {
  return {
    callKey: call.callKey,
    callMetadata: call.callMetadata ? { ...call.callMetadata } : undefined,
    completionTokens: call.completionTokens,
    costEstimate: call.costEstimate
      ? cloneCostEstimate(call.costEstimate)
      : undefined,
    estimatedCostUsd: call.estimatedCostUsd,
    modelName: call.modelName,
    pricingStatus: call.pricingStatus,
    promptTokens: call.promptTokens,
    totalTokens: call.totalTokens,
    usage: call.usage ? { ...call.usage } : undefined,
  };
}

function stringMetadata(
  metadata: TokenUsageCallMetadata | undefined,
  key: string
): string | undefined {
  const value = metadata?.[key];
  return typeof value === "string" ? value : undefined;
}

function scalarMetadata(
  metadata: TokenUsageCallMetadata | undefined,
  key: string
): number | string | undefined {
  const value = metadata?.[key];
  return typeof value === "number" || typeof value === "string"
    ? value
    : undefined;
}

function fallbackUsageFromTokenCounts({
  completionTokens,
  promptTokens,
  totalTokens,
}: {
  completionTokens: number;
  promptTokens: number;
  totalTokens: number;
}): TokenUsageSnapshot {
  return {
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    inputTokens: promptTokens,
    noCacheTokens: promptTokens,
    outputTokens: completionTokens,
    reasoningTokens: 0,
    textTokens: completionTokens,
    totalTokens,
  };
}

function emptyTokenUsage(): TokenUsageSnapshot {
  return {
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    inputTokens: 0,
    noCacheTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    textTokens: 0,
    totalTokens: 0,
  };
}

function addTokenUsage(
  left: TokenUsageSnapshot,
  right: TokenUsageSnapshot
): TokenUsageSnapshot {
  return {
    cacheReadTokens: left.cacheReadTokens + right.cacheReadTokens,
    cacheWriteTokens: left.cacheWriteTokens + right.cacheWriteTokens,
    inputTokens: left.inputTokens + right.inputTokens,
    noCacheTokens: left.noCacheTokens + right.noCacheTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    reasoningTokens: left.reasoningTokens + right.reasoningTokens,
    textTokens: left.textTokens + right.textTokens,
    totalTokens: left.totalTokens + right.totalTokens,
  };
}

function cloneCostEstimate(estimate: TokenCostEstimate): TokenCostEstimate {
  return {
    ...estimate,
    pricing: estimate.pricing ? { ...estimate.pricing } : undefined,
  };
}

function completedLlmFallbackOutcomes(
  outcomes: Record<LlmFallbackOutcome, number>
): number {
  return (
    outcomes.completed +
    outcomes.error +
    outcomes.interrupted +
    outcomes.timeout
  );
}

function rankMilestone(
  milestone: string | undefined,
  sequence?: readonly string[]
): number {
  if (!milestone) {
    return 0;
  }
  const index = sequence?.indexOf(milestone) ?? -1;
  return index >= 0 ? index + 1 : 1;
}
