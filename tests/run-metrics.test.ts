import type { AgentEvent } from "@minpeter/pss-runtime";
import { describe, expect, it, vi } from "vitest";
import { chooseDeterministicPolicyAction } from "../src/deterministic-policy";
import type { MgbaObservation } from "../src/observation";
import { POKEMON_MILESTONES } from "../src/pokemon-milestones";
import type { PokemonStateObservation } from "../src/pokemon-state";
import { RunMetricsTracker } from "../src/run-metrics";
import { StuckMemory } from "../src/stuck-memory";
import {
  RIVAL_BATTLE_STATE_FIXTURES,
  type RivalBattleStateFixture,
  rivalBattleObservation,
} from "./fixtures/rival-battle-states";

const baseState: PokemonStateObservation = {
  battle: false,
  battleResult: 0,
  battleType: 0,
  dialogueLike: "visual-fallback",
  direction: "up",
  mapId: 12,
  menuLike: "visual-fallback",
  position: {
    x: 10,
    y: 14,
  },
  readStatus: "available",
};

function observation(
  state: PokemonStateObservation | undefined = baseState
): MgbaObservation {
  return {
    screenshot: {
      data: "same-screen",
      mediaType: "image/png",
      path: "/tmp/screen.png",
    },
    state,
    status: {
      activeButtons: [],
      frame: 2817,
      gameCode: "DMG-AR",
      gameTitle: "PKMN RED ST",
    },
  };
}

function holdUp(
  toolCallId: string
): Extract<AgentEvent, { type: "tool-call" }> {
  return {
    input: { button: "Up", duration: 12 },
    toolCallId,
    toolName: "mgba_hold",
    type: "tool-call",
  };
}

type SupportedRivalBattleStateFixture = RivalBattleStateFixture & {
  expectedDecision: Extract<
    RivalBattleStateFixture["expectedDecision"],
    { buttons: readonly string[] }
  >;
};

function isSupportedRivalBattleFixture(
  fixture: RivalBattleStateFixture
): fixture is SupportedRivalBattleStateFixture {
  return "buttons" in fixture.expectedDecision;
}

describe("RunMetricsTracker", () => {
  it("tracks action repetition, observation discipline, screen novelty, and latency", () => {
    const tracker = new RunMetricsTracker({
      experimentId: "supervisor",
      iteration: 4,
      mode: "exploratory",
      runId: "run-4",
    });
    const events: [AgentEvent, number][] = [
      [{ type: "turn-start" }, 0],
      [{ type: "step-start" }, 5],
      [
        {
          input: {},
          toolCallId: "shot-1",
          toolName: "mgba_screenshot",
          type: "tool-call",
        },
        10,
      ],
      [
        {
          output: { data: "screen-a" },
          toolCallId: "shot-1",
          toolName: "mgba_screenshot",
          type: "tool-result",
        },
        20,
      ],
      [
        {
          input: { button: "A" },
          toolCallId: "tap-1",
          toolName: "mgba_tap",
          type: "tool-call",
        },
        30,
      ],
      [
        {
          output: { ok: true },
          toolCallId: "tap-1",
          toolName: "mgba_tap",
          type: "tool-result",
        },
        40,
      ],
      [{ type: "step-end" }, 50],
      [{ type: "turn-end" }, 100],
      [{ type: "turn-start" }, 200],
      [
        {
          input: { button: "A" },
          toolCallId: "tap-2",
          toolName: "mgba_tap",
          type: "tool-call",
        },
        210,
      ],
      [
        {
          output: { ok: false },
          toolCallId: "tap-2",
          toolName: "mgba_tap",
          type: "tool-result",
        },
        225,
      ],
      [{ type: "turn-end" }, 260],
    ];

    for (const [event, now] of events) {
      tracker.recordEvent(event, now);
    }

    expect(tracker.snapshot()).toMatchObject({
      aButtonControlCalls: 2,
      controlToolCalls: 2,
      failedToolCalls: 1,
      lastToolDurationMs: 15,
      lastTurnDurationMs: 60,
      maxSameActionStreak: 2,
      observeBeforeActRatio: 0.5,
      sameActionStreak: 2,
      screenshotCalls: 1,
      toolCalls: 3,
      toolErrorRate: 1 / 3,
      supervisorInterventions: 0,
      uniqueActionCount: 1,
      uniqueScreenCount: 1,
    });

    const prometheus = tracker.prometheusMetrics();
    expect(prometheus).toContain(
      'pss_mgba_control_a_button_ratio{run_id="run-4",iteration="4",mode="exploratory",experiment_id="supervisor"} 1'
    );
    expect(prometheus).toContain(
      'pss_mgba_same_action_streak{run_id="run-4",iteration="4",mode="exploratory",experiment_id="supervisor",category="max",kind="max"} 2'
    );
    expect(prometheus).toContain(
      'pss_mgba_tool_calls_total{run_id="run-4",iteration="4",mode="exploratory",experiment_id="supervisor",category="failed",kind="failed"} 1'
    );
    expect(prometheus).toContain(
      'pss_mgba_supervisor_interventions_total{run_id="run-4",iteration="4",mode="exploratory",experiment_id="supervisor"} 0'
    );
  });

  it("counts supervisor interventions from events and direct records", () => {
    const tracker = new RunMetricsTracker({ runId: "run-supervised" });

    tracker.recordEvent({
      intervention: {
        detail: "waited through black frame",
        reason: "black-frame-wait",
      },
      type: "supervisor-intervention",
    });
    tracker.recordSupervisorIntervention("long-movement-split");

    expect(tracker.snapshot().supervisorInterventions).toBe(2);
    expect(tracker.prometheusMetrics()).toContain(
      'pss_mgba_supervisor_interventions_total{run_id="run-supervised",iteration="0"} 2'
    );
  });

  it("counts observed runtime-input before control without observation tools", () => {
    const tracker = new RunMetricsTracker({ runId: "run-runtime-input" });

    tracker.recordEvent({ type: "turn-start" }, 0);
    tracker.recordEvent(
      {
        input: {
          content: [
            {
              text: "Fresh observation\n\nCurrent mGBA status:\nframe: 123",
              type: "text",
            },
            {
              image: "data:image/png;base64,screen-a",
              mediaType: "image/png",
              type: "image",
            },
          ],
          type: "user-message",
        },
        placement: "turn-start",
        type: "runtime-input",
      },
      5
    );
    tracker.recordEvent(
      {
        input: { button: "A" },
        toolCallId: "tap-1",
        toolName: "mgba_tap",
        type: "tool-call",
      },
      10
    );

    expect(tracker.snapshot()).toMatchObject({
      observeBeforeActRatio: 1,
      screenshotCalls: 0,
      statusCalls: 0,
      toolCalls: 1,
      turnsWithObserveBeforeControl: 1,
      uniqueScreenCount: 1,
    });
  });

  it("tracks stuck events in Prometheus metrics", () => {
    const tracker = new RunMetricsTracker({ runId: "run-stuck" });

    tracker.recordStuckEvents(1);
    tracker.recordBlockedRepeatedActions(1);

    expect(tracker.snapshot().stuckEvents).toBe(1);
    expect(tracker.snapshot().blockedRepeatedActionsTotal).toBe(1);
    expect(tracker.prometheusMetrics()).toContain(
      'pss_mgba_stuck_events_total{run_id="run-stuck",iteration="0"} 1'
    );
    expect(tracker.prometheusMetrics()).toContain(
      'pss_mgba_blocked_repeated_actions_total{run_id="run-stuck",iteration="0"} 1'
    );
  });

  it("tracks deterministic controller actions and LLM fallback calls as separate counters", () => {
    const tracker = new RunMetricsTracker({ runId: "run-controller-primary" });

    tracker.recordControllerAction({
      phase: "bedroom_2f",
      waypoint: "stairs",
    });
    tracker.recordControllerAction({
      phase: "house_1f",
      waypoint: "exit",
    });
    tracker.recordLlmFallback({
      phase: "unknown",
      waypoint: "fallback-analysis",
    });

    expect(tracker.snapshot()).toMatchObject({
      currentPhase: "unknown",
      currentWaypoint: "fallback-analysis",
      deterministicController: {
        actionsTotal: 2,
        namespace: "deterministic-controller",
        source: "runtime-game-state-controller",
      },
      deterministicActionsTotal: 2,
      deterministicControllerActionsTotal: 2,
      deterministicVsLlmActionRatio: 2,
      fallbackRate: 1 / 3,
      llmFallback: {
        callsTotal: 1,
        namespace: "llm-fallback",
        source: "bounded-fallback-tracker",
      },
      llmFallbackCallsTotal: 1,
    });
    expect(tracker.snapshot().deterministicController).not.toHaveProperty(
      "callsTotal"
    );
    expect(tracker.snapshot().deterministicController).not.toHaveProperty(
      "outcomesTotal"
    );
    expect(tracker.snapshot().llmFallback).not.toHaveProperty("actionsTotal");
    expect(tracker.snapshot().llmFallback).not.toHaveProperty(
      "totalActionDurationMs"
    );

    const prometheus = tracker.prometheusMetrics();
    expect(prometheus).toContain(
      'pss_mgba_deterministic_controller_actions_total{run_id="run-controller-primary",iteration="0"} 2'
    );
    expect(prometheus).toContain(
      'pss_mgba_llm_fallback_calls_total{run_id="run-controller-primary",iteration="0"} 1'
    );
    expect(prometheus).toContain(
      'pss_mgba_controller_actions_total{run_id="run-controller-primary",iteration="0",category="deterministic",kind="deterministic"} 2'
    );
    expect(prometheus).toContain(
      'pss_mgba_controller_actions_total{run_id="run-controller-primary",iteration="0",category="llm_fallback",kind="llm_fallback"} 1'
    );
    expect(prometheus).toContain(
      'pss_mgba_fallback_rate{run_id="run-controller-primary",iteration="0"} 0.3333333333333333'
    );
    expect(prometheus).toContain(
      'pss_mgba_deterministic_vs_llm_action_ratio{run_id="run-controller-primary",iteration="0"} 2'
    );
  });

  it("exposes gameplay metrics separately from token cost metrics", () => {
    const tracker = new RunMetricsTracker({ runId: "run-metric-namespaces" });

    tracker.recordControllerAction({
      phase: "bedroom_2f",
      waypoint: "stairs",
    });
    tracker.recordLlmFallback({
      phase: "unknown",
      waypoint: "fallback-analysis",
    });
    tracker.recordVerification("failure");

    const gameplayBeforeTokenUsage = tracker.snapshot().gameplay;

    tracker.recordTokenUsageMetric({
      iteration: 0,
      modelId: "provider:model",
      runId: "run-metric-namespaces",
      schemaVersion: 1,
      step: 1,
      timestamp: "2026-06-08T00:00:00.000Z",
      turn: 1,
      type: "llm-step",
      usage: {
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        inputTokens: 80,
        noCacheTokens: 80,
        outputTokens: 20,
        reasoningTokens: 10,
        textTokens: 10,
        totalTokens: 100,
      },
    });
    tracker.recordTokenUsageMetric({
      iteration: 0,
      runId: "run-metric-namespaces",
      schemaVersion: 1,
      steps: 1,
      timestamp: "2026-06-08T00:00:00.000Z",
      turn: 1,
      type: "turn-summary",
      usage: {
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        inputTokens: 80,
        noCacheTokens: 80,
        outputTokens: 20,
        reasoningTokens: 10,
        textTokens: 10,
        totalTokens: 100,
      },
    });

    const snapshot = tracker.snapshot();

    expect(snapshot.gameplay).toEqual(gameplayBeforeTokenUsage);
    expect(snapshot.gameplay).toMatchObject({
      deterministicActionsTotal: 1,
      fallbackRate: 1 / 2,
      llmFallbackCallsTotal: 1,
      verificationFailuresTotal: 1,
    });
    expect(snapshot.tokenCost).toEqual({
      lastCostEstimate: {
        cacheReadCostUsd: 0,
        cacheWriteCostUsd: 0,
        currency: "USD",
        estimatedCostUsd: 0,
        inputCostUsd: 0,
        modelId: "provider:model",
        outputCostUsd: 0,
        pricing: undefined,
        status: "unpriced",
      },
      lastEstimatedCostUsd: 0,
      namespace: "token-cost",
      pricedCallsTotal: 0,
      source: "token-usage-tracker",
      totalEstimatedCostUsd: 0,
      totalTokens: 100,
      unpricedCallsTotal: 1,
    });
    expect(snapshot.gameplay).not.toHaveProperty("totalTokens");
    expect(snapshot.gameplay).not.toHaveProperty("tokenCost");
    expect(snapshot.gameplay).not.toHaveProperty("tokenUsage");
    expect(snapshot.tokenCost).not.toHaveProperty("deterministicActionsTotal");
    expect(snapshot.deterministicController).toMatchObject({
      actionsTotal: 1,
      namespace: "deterministic-controller",
      source: "runtime-game-state-controller",
    });
    expect(snapshot.llmFallback).toMatchObject({
      callsTotal: 1,
      namespace: "llm-fallback",
      source: "bounded-fallback-tracker",
    });

    const prometheus = tracker.prometheusMetrics();
    expect(prometheus).toContain("pss_mgba_controller_actions_total");
    expect(prometheus).not.toContain("pss_mgba_tokens_total");
    expect(prometheus).not.toContain("pss_mgba_turn_tokens");
    expect(prometheus).toContain(
      'pss_mgba_token_cost_estimated_usd{run_id="run-metric-namespaces",iteration="0",category="total",kind="total"} 0'
    );
    expect(prometheus).toContain(
      'pss_mgba_token_cost_pricing_calls_total{run_id="run-metric-namespaces",iteration="0",category="unpriced",kind="unpriced"} 1'
    );
  });

  it("exposes milestone progress metrics independently from action, failure, and cost fields", () => {
    const tracker = new RunMetricsTracker({ runId: "run-milestone-progress" });

    tracker.recordMilestoneProgress({
      current: "player-control-reached",
      furthest: "player-control-reached",
      sequence: POKEMON_MILESTONES,
    });

    const milestoneBeforeUnrelatedMetrics =
      tracker.snapshot().milestoneProgress;

    tracker.recordControllerAction({
      phase: "bedroom_2f",
      waypoint: "stairs",
    });
    tracker.recordLlmFallback({
      phase: "unknown",
      waypoint: "fallback-analysis",
    });
    tracker.recordVerification("failure");
    tracker.recordBlockedRepeatedActions(2);
    tracker.recordStuckEvents(2);
    tracker.recordEvent({
      input: { button: "A" },
      toolCallId: "failed-control",
      toolName: "mgba_tap",
      type: "tool-call",
    });
    tracker.recordEvent({
      output: { ok: false },
      toolCallId: "failed-control",
      toolName: "mgba_tap",
      type: "tool-result",
    });
    tracker.recordTokenUsageMetric({
      iteration: 0,
      modelId: "provider:model",
      runId: "run-milestone-progress",
      schemaVersion: 1,
      step: 1,
      timestamp: "2026-06-08T00:00:00.000Z",
      turn: 1,
      type: "llm-step",
      usage: {
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        inputTokens: 80,
        noCacheTokens: 80,
        outputTokens: 20,
        reasoningTokens: 10,
        textTokens: 10,
        totalTokens: 100,
      },
    });

    const snapshot = tracker.snapshot();
    expect(snapshot.milestoneProgress).toEqual(milestoneBeforeUnrelatedMetrics);
    expect(snapshot.milestoneProgress).toEqual({
      completedRatio: 3 / POKEMON_MILESTONES.length,
      current: "player-control-reached",
      currentRank: 3,
      furthest: "player-control-reached",
      furthestRank: 3,
      namespace: "milestone-progress",
      sequenceLength: POKEMON_MILESTONES.length,
      source: "milestone-progress-tracker",
    });
    expect(snapshot.milestoneProgress).not.toHaveProperty(
      "deterministicActionsTotal"
    );
    expect(snapshot.milestoneProgress).not.toHaveProperty("fallbackRate");
    expect(snapshot.milestoneProgress).not.toHaveProperty(
      "verificationFailuresTotal"
    );
    expect(snapshot.milestoneProgress).not.toHaveProperty(
      "blockedRepeatedActionsTotal"
    );
    expect(snapshot.milestoneProgress).not.toHaveProperty("totalTokens");
    expect(snapshot.gameplay).not.toHaveProperty("milestoneProgress");
    expect(snapshot.tokenCost).not.toHaveProperty("milestoneProgress");

    const prometheus = tracker.prometheusMetrics();
    expect(prometheus).toContain(
      'pss_mgba_milestone_progress_rank{run_id="run-milestone-progress",iteration="0",milestone="player-control-reached",source="milestone-progress-tracker"} 3'
    );
    expect(prometheus).toContain(
      'pss_mgba_milestone_progress_ratio{run_id="run-milestone-progress",iteration="0",milestone="player-control-reached",source="milestone-progress-tracker"} 0.375'
    );
  });

  it("classifies executed controller-first controls as deterministic without fallback increments", () => {
    const tracker = new RunMetricsTracker({ runId: "run-owned-controls" });

    tracker.recordPhase({
      phase: "bedroom_2f",
      waypoint: "stairs",
    });
    tracker.recordEvent({
      controlOwner: "deterministic-controller",
      input: { button: "Down", duration: 10 },
      toolCallId: "deterministic-known-stage1-route-1",
      toolName: "mgba_hold",
      type: "tool-call",
    });
    tracker.recordEvent({
      input: { button: "A" },
      toolCallId: "fallback-stream-1",
      toolName: "mgba_tap",
      type: "tool-call",
    });

    expect(tracker.snapshot()).toMatchObject({
      controlToolCalls: 2,
      currentPhase: "bedroom_2f",
      currentWaypoint: "stairs",
      deterministicActionsTotal: 1,
      deterministicControllerActionsTotal: 1,
      fallbackRate: 0,
      llmFallbackCallsTotal: 0,
    });

    tracker.recordLlmFallback({
      phase: "unknown",
      waypoint: "fallback-analysis",
    });

    expect(tracker.snapshot()).toMatchObject({
      deterministicActionsTotal: 1,
      fallbackRate: 1 / 2,
      llmFallbackCallsTotal: 1,
    });
  });

  it.each(
    RIVAL_BATTLE_STATE_FIXTURES.filter(isSupportedRivalBattleFixture)
  )("records supported $label decisions as controller-owned battle actions with zero LLM fallback calls", (fixture) => {
    const tracker = new RunMetricsTracker({
      runId: `run-${fixture.id}`,
    });
    const fallbackAnalystSend = vi.fn((_: unknown) => {
      throw new Error("normal rival battle path must not call LLM fallback");
    });
    const decision = chooseDeterministicPolicyAction({
      observation: rivalBattleObservation(fixture.runtimeGameState),
      stuckMemory: {
        failedMovementEdges: [],
        recentRecoveryAttempts: [],
        repeatedStateContexts: [],
        stuckEvents: 0,
      },
    });

    if (decision.policy === "llm-fallback") {
      fallbackAnalystSend(decision);
    }

    expect(decision).toMatchObject({
      action: {
        buttons: fixture.expectedDecision.buttons,
        reason: expect.stringContaining("BattlePolicy"),
        toolName: "mgba_tap",
      },
      expectedOutcome: "battle-progress",
      phase: "rival_battle",
      policy: "battle",
      reason: "rival battle phase is controller-owned by BattlePolicy",
      waypoint: "win-current-battle",
    });

    tracker.recordPhase({
      phase: decision.phase,
      waypoint: decision.waypoint,
    });
    for (const [index, button] of fixture.expectedDecision.buttons.entries()) {
      tracker.recordEvent({
        controlOwner: "deterministic-controller",
        input: { button },
        toolCallId: `deterministic-battle-1-${index + 1}`,
        toolName: "mgba_tap",
        type: "tool-call",
      });
    }

    expect(fallbackAnalystSend).not.toHaveBeenCalled();
    expect(tracker.snapshot()).toMatchObject({
      currentPhase: "rival_battle",
      currentWaypoint: "win-current-battle",
      deterministicActionsTotal: fixture.expectedDecision.buttons.length,
      deterministicControllerActionsTotal:
        fixture.expectedDecision.buttons.length,
      fallbackRate: 0,
      llmFallbackCallsTotal: 0,
      tokenCost: {
        totalTokens: 0,
      },
    });
    expect(tracker.prometheusMetrics()).toContain(
      `pss_mgba_llm_fallback_calls_total{run_id="run-${fixture.id}",iteration="0"} 0`
    );
  });

  it("records LLM fallback invocation events without deterministic action inflation", () => {
    const tracker = new RunMetricsTracker({ runId: "run-fallback-event" });

    tracker.recordEvent({
      controlOwner: "deterministic-controller",
      input: { button: "Down", duration: 10 },
      toolCallId: "deterministic-bedroom-route",
      toolName: "mgba_hold",
      type: "tool-call",
    });
    tracker.recordEvent({
      controlOwner: "llm-fallback",
      attempt: 1,
      directControl: false,
      edgeKey: "unknown:fallback-analysis",
      maxAttempts: 2,
      phase: "unknown",
      policy: "llm-fallback",
      reason: "unknown RAM map requires bounded fallback analyst",
      timeoutMs: 1200,
      type: "llm-fallback-invocation",
      validationReason:
        "bounded fallback analyst invocation admitted after deterministic controller gap evidence",
      waypoint: "fallback-analysis",
    });
    tracker.recordEvent({
      controlOwner: "llm-fallback",
      input: { button: "A" },
      toolCallId: "fallback-stream-1",
      toolName: "mgba_tap",
      type: "tool-call",
    });

    expect(tracker.snapshot()).toMatchObject({
      controlToolCalls: 2,
      currentPhase: "unknown",
      currentWaypoint: "fallback-analysis",
      deterministicActionsTotal: 1,
      deterministicControllerActionsTotal: 1,
      fallbackRate: 1 / 2,
      llmFallbackCallsTotal: 1,
    });
  });

  it("records LLM fallback counts, timing, and outcomes independently of controller actions", () => {
    const tracker = new RunMetricsTracker({
      runId: "run-fallback-metrics-boundary",
    });

    tracker.recordEvent(
      {
        controlOwner: "llm-fallback",
        attempt: 1,
        directControl: false,
        edgeKey: "unknown|fallback-analysis",
        maxAttempts: 2,
        phase: "unknown",
        policy: "llm-fallback",
        reason: "unknown RAM map requires bounded fallback analyst",
        timeoutMs: 1200,
        type: "llm-fallback-invocation",
        validationReason:
          "bounded fallback analyst invocation admitted after deterministic controller gap evidence",
        waypoint: "fallback-analysis",
      },
      100
    );

    expect(tracker.snapshot()).toMatchObject({
      controlToolCalls: 0,
      deterministicActionsTotal: 0,
      deterministicControllerActionsTotal: 0,
      deterministicController: {
        actionsTotal: 0,
        averageActionDurationMs: 0,
        lastActionDurationMs: 0,
        namespace: "deterministic-controller",
        source: "runtime-game-state-controller",
        totalActionDurationMs: 0,
      },
      llmFallback: {
        callsTotal: 1,
        lastDurationMs: 0,
        outcomesTotal: {
          completed: 0,
          error: 0,
          interrupted: 0,
          timeout: 0,
        },
        pendingCalls: 1,
        totalDurationMs: 0,
      },
      llmFallbackCallsTotal: 1,
    });

    tracker.recordEvent(
      {
        attempt: 1,
        callMetadata: {
          attempt: 1,
          callPath: "bounded-llm-fallback",
          controlOwner: "llm-fallback",
          edgeKey: "unknown|fallback-analysis",
          timeoutMs: 1200,
        },
        completionTokens: 14,
        controlOwner: "llm-fallback",
        edgeKey: "unknown|fallback-analysis",
        maxAttempts: 2,
        modelName: "openai-compatible:gpt-test",
        promptTokens: 42,
        result: "timeout",
        timeoutMs: 1200,
        totalTokens: 56,
        type: "llm-fallback-completion",
      },
      1350
    );

    expect(tracker.snapshot()).toMatchObject({
      controlToolCalls: 0,
      deterministicActionsTotal: 0,
      deterministicControllerActionsTotal: 0,
      deterministicController: {
        actionsTotal: 0,
        averageActionDurationMs: 0,
        lastActionDurationMs: 0,
        namespace: "deterministic-controller",
        source: "runtime-game-state-controller",
        totalActionDurationMs: 0,
      },
      llmFallback: {
        averageDurationMs: 1250,
        completionTokensTotal: 14,
        callsTotal: 1,
        lastCallMetadata: {
          attempt: 1,
          callPath: "bounded-llm-fallback",
          controlOwner: "llm-fallback",
          edgeKey: "unknown|fallback-analysis",
          timeoutMs: 1200,
        },
        lastDurationMs: 1250,
        lastModelName: "openai-compatible:gpt-test",
        lastOutcome: "timeout",
        lastTokenUsage: {
          completionTokens: 14,
          modelName: "openai-compatible:gpt-test",
          promptTokens: 42,
          totalTokens: 56,
        },
        namespace: "llm-fallback",
        outcomesTotal: {
          completed: 0,
          error: 0,
          interrupted: 0,
          timeout: 1,
        },
        pendingCalls: 0,
        promptTokensTotal: 42,
        source: "bounded-fallback-tracker",
        totalTokensTotal: 56,
        totalDurationMs: 1250,
      },
      llmFallbackCallsTotal: 1,
    });

    const prometheus = tracker.prometheusMetrics();
    expect(prometheus).toContain(
      'pss_mgba_llm_fallback_outcomes_total{run_id="run-fallback-metrics-boundary",iteration="0",outcome="timeout"} 1'
    );
    expect(prometheus).toContain(
      'pss_mgba_llm_fallback_duration_ms{run_id="run-fallback-metrics-boundary",iteration="0",category="last",kind="last"} 1250'
    );
    expect(prometheus).toContain(
      'pss_mgba_llm_fallback_pending{run_id="run-fallback-metrics-boundary",iteration="0"} 0'
    );
    expect(prometheus).toContain(
      'pss_mgba_llm_fallback_tokens_total{run_id="run-fallback-metrics-boundary",iteration="0",category="prompt",kind="prompt"} 42'
    );
    expect(prometheus).toContain(
      'pss_mgba_llm_fallback_tokens_total{run_id="run-fallback-metrics-boundary",iteration="0",category="completion",kind="completion"} 14'
    );
    expect(prometheus).toContain(
      'pss_mgba_llm_fallback_tokens_total{run_id="run-fallback-metrics-boundary",iteration="0",category="total",kind="total"} 56'
    );
  });

  it("accumulates fallback token usage and estimated cost across all fallback model calls once", () => {
    const tracker = new RunMetricsTracker({
      runId: "run-fallback-token-cost",
    });

    tracker.recordEvent({
      controlOwner: "llm-fallback",
      attempt: 1,
      directControl: false,
      edgeKey: "unknown|fallback-analysis",
      phase: "unknown",
      policy: "llm-fallback",
      type: "llm-fallback-invocation",
      waypoint: "fallback-analysis",
    });
    tracker.recordTokenUsageMetric({
      callMetadata: {
        attempt: 1,
        callPath: "bounded-llm-fallback",
        controlOwner: "llm-fallback",
        edgeKey: "unknown|fallback-analysis",
      },
      costEstimate: {
        cacheReadCostUsd: 0,
        cacheWriteCostUsd: 0,
        currency: "USD",
        estimatedCostUsd: 0.0001,
        inputCostUsd: 0.000_04,
        matchedModelId: "provider:fallback-model",
        modelId: "provider:fallback-model",
        outputCostUsd: 0.000_06,
        pricing: {
          inputUsdPerMillionTokens: 4,
          outputUsdPerMillionTokens: 20,
        },
        status: "estimated",
      },
      iteration: 0,
      modelId: "provider:fallback-model",
      modelName: "provider:fallback-model",
      runId: "run-fallback-token-cost",
      schemaVersion: 1,
      step: 1,
      timestamp: "2026-06-08T00:00:00.000Z",
      totalTokens: 13,
      turn: 1,
      type: "llm-step",
      usage: {
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        inputTokens: 10,
        noCacheTokens: 10,
        outputTokens: 3,
        reasoningTokens: 1,
        textTokens: 2,
        totalTokens: 13,
      },
    });
    tracker.recordTokenUsageMetric({
      callMetadata: {
        attempt: 1,
        callPath: "bounded-llm-fallback",
        controlOwner: "llm-fallback",
        edgeKey: "unknown|fallback-analysis",
      },
      costEstimate: {
        cacheReadCostUsd: 0,
        cacheWriteCostUsd: 0,
        currency: "USD",
        estimatedCostUsd: 0.0002,
        inputCostUsd: 0.000_08,
        matchedModelId: "provider:fallback-model",
        modelId: "provider:fallback-model",
        outputCostUsd: 0.000_12,
        pricing: {
          inputUsdPerMillionTokens: 4,
          outputUsdPerMillionTokens: 30,
        },
        status: "estimated",
      },
      iteration: 0,
      modelId: "provider:fallback-model",
      modelName: "provider:fallback-model",
      runId: "run-fallback-token-cost",
      schemaVersion: 1,
      step: 2,
      timestamp: "2026-06-08T00:00:01.000Z",
      totalTokens: 24,
      turn: 1,
      type: "llm-step",
      usage: {
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        inputTokens: 20,
        noCacheTokens: 20,
        outputTokens: 4,
        reasoningTokens: 2,
        textTokens: 2,
        totalTokens: 24,
      },
    });
    tracker.recordEvent({
      attempt: 1,
      callMetadata: {
        attempt: 1,
        callPath: "bounded-llm-fallback",
        controlOwner: "llm-fallback",
        edgeKey: "unknown|fallback-analysis",
      },
      completionTokens: 7,
      controlOwner: "llm-fallback",
      edgeKey: "unknown|fallback-analysis",
      modelName: "provider:fallback-model",
      promptTokens: 30,
      result: "completed",
      totalTokens: 37,
      type: "llm-fallback-completion",
    });
    tracker.recordEvent({
      controlOwner: "llm-fallback",
      attempt: 1,
      directControl: false,
      edgeKey: "scripted|fallback-analysis",
      phase: "scripted",
      policy: "llm-fallback",
      type: "llm-fallback-invocation",
      waypoint: "fallback-analysis",
    });
    tracker.recordEvent({
      attempt: 1,
      completionTokens: 50,
      controlOwner: "llm-fallback",
      edgeKey: "scripted|fallback-analysis",
      modelName: "gpt-5.5",
      promptTokens: 100,
      result: "timeout",
      totalTokens: 150,
      type: "llm-fallback-completion",
    });

    const snapshot = tracker.snapshot();

    expect(snapshot.llmFallback).toMatchObject({
      callsTotal: 2,
      completionTokensTotal: 57,
      lastEstimatedCostUsd: 0.000_625,
      outcomesTotal: {
        completed: 1,
        error: 0,
        interrupted: 0,
        timeout: 1,
      },
      pricedCallsTotal: 3,
      promptTokensTotal: 130,
      totalEstimatedCostUsd: 0.000_925,
      totalTokensTotal: 187,
      totalUsage: {
        inputTokens: 130,
        outputTokens: 57,
        reasoningTokens: 3,
        textTokens: 54,
        totalTokens: 187,
      },
      tokenUsageCalls: [
        {
          callKey: "unknown|fallback-analysis:1",
          callMetadata: {
            attempt: 1,
            callPath: "bounded-llm-fallback",
            controlOwner: "llm-fallback",
            edgeKey: "unknown|fallback-analysis",
          },
          completionTokens: 3,
          estimatedCostUsd: 0.0001,
          modelName: "provider:fallback-model",
          pricingStatus: "estimated",
          promptTokens: 10,
          totalTokens: 13,
        },
        {
          callKey: "unknown|fallback-analysis:1",
          callMetadata: {
            attempt: 1,
            callPath: "bounded-llm-fallback",
            controlOwner: "llm-fallback",
            edgeKey: "unknown|fallback-analysis",
          },
          completionTokens: 4,
          estimatedCostUsd: 0.0002,
          modelName: "provider:fallback-model",
          pricingStatus: "estimated",
          promptTokens: 20,
          totalTokens: 24,
        },
        {
          callKey: "scripted|fallback-analysis:1",
          completionTokens: 50,
          estimatedCostUsd: 0.000_625,
          modelName: "gpt-5.5",
          pricingStatus: "estimated",
          promptTokens: 100,
          totalTokens: 150,
        },
      ],
      unpricedCallsTotal: 0,
    });
    expect(snapshot.llmFallback.lastCostEstimate).toMatchObject({
      matchedModelId: "gpt-5.5",
      modelId: "gpt-5.5",
      status: "estimated",
    });
    expect(snapshot.llmFallback.tokenUsageCalls[0]?.costEstimate).toMatchObject(
      {
        estimatedCostUsd: 0.0001,
        status: "estimated",
      }
    );
    expect(snapshot.tokenCost).toMatchObject({
      pricedCallsTotal: 2,
      totalTokens: 37,
    });
    expect(snapshot.tokenCost.totalEstimatedCostUsd).toBeCloseTo(0.0003);

    const prometheus = tracker.prometheusMetrics();
    expect(prometheus).toContain(
      'pss_mgba_llm_fallback_token_cost_estimated_usd{run_id="run-fallback-token-cost",iteration="0",category="total",kind="total"} 0.000925'
    );
    expect(prometheus).toContain(
      'pss_mgba_llm_fallback_token_cost_pricing_calls_total{run_id="run-fallback-token-cost",iteration="0",category="priced",kind="priced"} 3'
    );
    expect(prometheus).toContain(
      'pss_mgba_llm_fallback_tokens_total{run_id="run-fallback-token-cost",iteration="0",category="total",kind="total"} 187'
    );
  });

  it("records deterministic controller counts and timing independently of fallback events", () => {
    const tracker = new RunMetricsTracker({
      runId: "run-controller-timing-boundary",
    });

    tracker.recordEvent(
      {
        controlOwner: "deterministic-controller",
        input: { button: "Down", duration: 10 },
        toolCallId: "deterministic-bedroom-route",
        toolName: "mgba_hold",
        type: "tool-call",
      },
      10
    );
    tracker.recordEvent(
      {
        output: { ok: true },
        toolCallId: "deterministic-bedroom-route",
        toolName: "mgba_hold",
        type: "tool-result",
      },
      34
    );

    expect(tracker.snapshot()).toMatchObject({
      deterministicController: {
        actionsTotal: 1,
        averageActionDurationMs: 24,
        lastActionDurationMs: 24,
        namespace: "deterministic-controller",
        source: "runtime-game-state-controller",
        totalActionDurationMs: 24,
      },
      deterministicActionsTotal: 1,
      deterministicControllerActionsTotal: 1,
      deterministicControllerLastActionDurationMs: 24,
      deterministicControllerTotalActionDurationMs: 24,
      lastToolDurationMs: 24,
      llmFallbackCallsTotal: 0,
    });

    tracker.recordEvent(
      {
        controlOwner: "llm-fallback",
        directControl: false,
        edgeKey: "unknown:fallback-analysis",
        phase: "unknown",
        policy: "llm-fallback",
        reason: "unknown RAM map requires bounded fallback analyst",
        type: "llm-fallback-invocation",
        waypoint: "fallback-analysis",
      },
      40
    );
    tracker.recordEvent(
      {
        controlOwner: "llm-fallback",
        input: { button: "A" },
        toolCallId: "fallback-stream-1",
        toolName: "mgba_tap",
        type: "tool-call",
      },
      50
    );
    tracker.recordEvent(
      {
        output: { ok: true },
        toolCallId: "fallback-stream-1",
        toolName: "mgba_tap",
        type: "tool-result",
      },
      90
    );

    expect(tracker.snapshot()).toMatchObject({
      controlToolCalls: 2,
      deterministicController: {
        actionsTotal: 1,
        averageActionDurationMs: 24,
        lastActionDurationMs: 24,
        totalActionDurationMs: 24,
      },
      deterministicActionsTotal: 1,
      deterministicControllerActionsTotal: 1,
      deterministicControllerLastActionDurationMs: 24,
      deterministicControllerTotalActionDurationMs: 24,
      fallbackRate: 1 / 2,
      llmFallback: {
        callsTotal: 1,
        lastDurationMs: 0,
        pendingCalls: 1,
        totalDurationMs: 0,
      },
      lastToolDurationMs: 40,
      llmFallbackCallsTotal: 1,
    });

    tracker.recordEvent(
      {
        controlOwner: "llm-fallback",
        edgeKey: "unknown:fallback-analysis",
        result: "completed",
        type: "llm-fallback-completion",
      },
      140
    );

    expect(tracker.snapshot()).toMatchObject({
      deterministicController: {
        actionsTotal: 1,
        averageActionDurationMs: 24,
        lastActionDurationMs: 24,
        totalActionDurationMs: 24,
      },
      deterministicControllerLastActionDurationMs: 24,
      deterministicControllerTotalActionDurationMs: 24,
      lastToolDurationMs: 40,
      llmFallback: {
        lastDurationMs: 100,
        lastOutcome: "completed",
        outcomesTotal: {
          completed: 1,
          error: 0,
          interrupted: 0,
          timeout: 0,
        },
        pendingCalls: 0,
        totalDurationMs: 100,
      },
    });

    tracker.recordEvent(
      {
        controlOwner: "deterministic-controller",
        input: { button: "Up", duration: 10 },
        toolCallId: "deterministic-route1-route",
        toolName: "mgba_hold",
        type: "tool-call",
      },
      100
    );
    tracker.recordEvent(
      {
        output: { ok: true },
        toolCallId: "deterministic-route1-route",
        toolName: "mgba_hold",
        type: "tool-result",
      },
      115
    );

    expect(tracker.snapshot()).toMatchObject({
      controlToolCalls: 3,
      deterministicController: {
        actionsTotal: 2,
        averageActionDurationMs: 19.5,
        lastActionDurationMs: 15,
        totalActionDurationMs: 39,
      },
      deterministicActionsTotal: 2,
      deterministicControllerActionsTotal: 2,
      deterministicControllerLastActionDurationMs: 15,
      deterministicControllerTotalActionDurationMs: 39,
      fallbackRate: 1 / 3,
      lastToolDurationMs: 15,
      llmFallbackCallsTotal: 1,
    });

    const prometheus = tracker.prometheusMetrics();
    expect(prometheus).toContain(
      'pss_mgba_deterministic_controller_actions_total{run_id="run-controller-timing-boundary",iteration="0"} 2'
    );
    expect(prometheus).toContain(
      'pss_mgba_llm_fallback_calls_total{run_id="run-controller-timing-boundary",iteration="0"} 1'
    );
    expect(prometheus).toContain(
      'pss_mgba_duration_ms{run_id="run-controller-timing-boundary",iteration="0",category="deterministic_controller_tool",kind="deterministic_controller_tool"} 15'
    );
    expect(prometheus).toContain(
      'pss_mgba_duration_ms{run_id="run-controller-timing-boundary",iteration="0",category="deterministic_controller_total",kind="deterministic_controller_total"} 39'
    );
  });

  it("records verification failures as a dedicated event and counter", () => {
    const tracker = new RunMetricsTracker({
      runId: "run-verification-failure",
    });

    tracker.recordEvent({
      action: "mgba_hold Down for 10 frames",
      expectedOutcome: "movement-or-map-change",
      phase: "bedroom_2f",
      policy: "stage1-fast-autopilot",
      reason: "phase remained bedroom_2f and position did not change",
      type: "verification-failure",
      waypoint: "stairs",
    });
    tracker.recordVerification("success");

    expect(tracker.snapshot()).toMatchObject({
      blockedRepeatedActionsTotal: 0,
      currentPhase: "bedroom_2f",
      currentWaypoint: "stairs",
      failedToolCalls: 0,
      stuckEvents: 0,
      supervisorInterventions: 0,
      verificationFailuresTotal: 1,
      verificationSuccessesTotal: 1,
    });

    const prometheus = tracker.prometheusMetrics();
    expect(prometheus).toContain(
      'pss_mgba_verification_failures_total{run_id="run-verification-failure",iteration="0"} 1'
    );
    expect(prometheus).toContain(
      'pss_mgba_verification_results_total{run_id="run-verification-failure",iteration="0",category="failure",kind="failure"} 1'
    );
    expect(prometheus).toContain(
      'pss_mgba_tool_calls_total{run_id="run-verification-failure",iteration="0",category="failed",kind="failed"} 0'
    );
    expect(prometheus).toContain(
      'pss_mgba_stuck_events_total{run_id="run-verification-failure",iteration="0"} 0'
    );
    expect(prometheus).toContain(
      'pss_mgba_blocked_repeated_actions_total{run_id="run-verification-failure",iteration="0"} 0'
    );
  });

  it("records blocked repeated actions as a dedicated event distinct from verification failures", () => {
    const tracker = new RunMetricsTracker({ runId: "run-blocked-repeated" });

    tracker.recordEvent({
      action: "hold:Up",
      attempts: 3,
      context: "map=12 x=10 y=14 facing=up",
      phase: "route_1",
      policy: "stuck-memory",
      type: "blocked-repeated-action",
      waypoint: "viridian-city",
    });

    expect(tracker.snapshot()).toMatchObject({
      blockedRepeatedActionsTotal: 1,
      currentPhase: "route_1",
      currentWaypoint: "viridian-city",
      verificationFailuresTotal: 0,
      verificationSuccessesTotal: 0,
    });

    const prometheus = tracker.prometheusMetrics();
    expect(prometheus).toContain(
      'pss_mgba_blocked_repeated_actions_total{run_id="run-blocked-repeated",iteration="0"} 1'
    );
    expect(prometheus).toContain(
      'pss_mgba_verification_failures_total{run_id="run-blocked-repeated",iteration="0"} 0'
    );
  });

  it("emits verification failures and blocked repeated actions as separate metrics in the same run", () => {
    const tracker = new RunMetricsTracker({
      runId: "run-mixed-failure-evidence",
    });

    tracker.recordEvent({
      action: "mgba_hold Down for 10 frames",
      expectedOutcome: "movement-or-map-change",
      phase: "bedroom_2f",
      policy: "stage1-fast-autopilot",
      reason: "phase remained bedroom_2f and position did not change",
      type: "verification-failure",
      waypoint: "stairs",
    });
    tracker.recordEvent({
      action: "hold:Up",
      attempts: 3,
      context: "map=12 x=10 y=14 facing=up",
      phase: "route_1",
      policy: "stuck-memory",
      type: "blocked-repeated-action",
      waypoint: "viridian-city",
    });
    tracker.recordEvent({
      action: "hold:Left",
      attempts: 3,
      context: "map=12 x=10 y=14 facing=left",
      phase: "route_1",
      policy: "stuck-memory",
      type: "blocked-repeated-action",
      waypoint: "viridian-city",
    });

    expect(tracker.snapshot()).toMatchObject({
      blockedRepeatedActionsTotal: 2,
      currentPhase: "route_1",
      currentWaypoint: "viridian-city",
      failedToolCalls: 0,
      stuckEvents: 0,
      verificationFailuresTotal: 1,
      verificationSuccessesTotal: 0,
    });

    const prometheus = tracker.prometheusMetrics();
    expect(prometheus).toContain(
      'pss_mgba_verification_failures_total{run_id="run-mixed-failure-evidence",iteration="0"} 1'
    );
    expect(prometheus).toContain(
      'pss_mgba_verification_results_total{run_id="run-mixed-failure-evidence",iteration="0",category="failure",kind="failure"} 1'
    );
    expect(prometheus).toContain(
      'pss_mgba_blocked_repeated_actions_total{run_id="run-mixed-failure-evidence",iteration="0"} 2'
    );
    expect(prometheus).toContain(
      'pss_mgba_tool_calls_total{run_id="run-mixed-failure-evidence",iteration="0",category="failed",kind="failed"} 0'
    );
  });
});

describe("StuckMemory", () => {
  it("detects repeated failed movement exactly on the 3rd stationary overworld attempt", () => {
    const memory = new StuckMemory();

    for (let turn = 1; turn <= 2; turn += 1) {
      memory.recordEvent(holdUp(`hold-${turn}`), observation(), turn);
      memory.observe(observation(), turn + 1);

      expect(memory.snapshot().stuckEvents).toBe(0);
    }

    memory.recordEvent(holdUp("hold-3"), observation(), 3);
    memory.observe(observation(), 4);

    expect(memory.snapshot()).toMatchObject({
      blockedRepeatedActions: 1,
      failedMovementEdges: [
        {
          action: "hold:Up",
          attempts: 3,
          context: "map=12 x=10 y=14 facing=up",
          lastSeenTurn: 4,
        },
      ],
      repeatedStateContexts: [
        {
          attempts: 3,
          context: "map=12 x=10 y=14 facing=up",
          lastAction: "hold:Up",
          lastSeenTurn: 4,
        },
      ],
      stuckEvents: 1,
    });
  });

  it("does not mark battle, dialogue, menu, title-like, or unavailable contexts as stuck", () => {
    const contexts: (PokemonStateObservation | undefined)[] = [
      { ...baseState, battle: true },
      { ...baseState, dialogueLike: true },
      { ...baseState, menuLike: true },
      { ...baseState, mapId: null },
      { ...baseState, readStatus: "unavailable" },
    ];

    for (const state of contexts) {
      const memory = new StuckMemory();
      for (let turn = 1; turn <= 3; turn += 1) {
        memory.recordEvent(holdUp(`hold-${turn}`), observation(state), turn);
        memory.observe(observation(state), turn + 1);
      }

      expect(memory.snapshot().stuckEvents).toBe(0);
      expect(memory.snapshot().failedMovementEdges).toEqual([]);
      expect(memory.snapshot().repeatedStateContexts).toEqual([]);
    }
  });
});
