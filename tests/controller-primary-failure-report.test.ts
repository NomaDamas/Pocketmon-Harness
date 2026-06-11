import { describe, expect, it } from "vitest";
import { createControllerPrimaryFailureReport } from "../src/controller-primary-failure-report";
import type { DeterministicPolicyDecision } from "../src/deterministic-policy";
import { BoundedLlmFallbackBudget } from "../src/fallback-gate";
import type { MgbaObservation } from "../src/observation";
import type { PokemonStateObservation } from "../src/pokemon-state";
import { RunMetricsTracker } from "../src/run-metrics";
import type { StuckMemorySnapshot } from "../src/stuck-memory";

const decision: DeterministicPolicyDecision = {
  phase: "route1",
  policy: "llm-fallback",
  reason:
    "known Stage 1 route exhausted movement candidates; fallback analyst must inspect unexpected event or collision state",
  waypoint: "fallback-analysis",
};

const state: PokemonStateObservation = {
  battle: false,
  battleResult: 0,
  battleType: 0,
  dialogueLike: "visual-fallback",
  direction: "up",
  mapId: 12,
  menuLike: "visual-fallback",
  position: { x: 10, y: 14 },
  readStatus: "available",
};

const stuckMemory: StuckMemorySnapshot = {
  failedMovementEdges: [
    {
      action: "hold:Up",
      attempts: 3,
      context: "map=12 x=10 y=14 facing=up",
      lastSeenTurn: 8,
    },
  ],
  recentRecoveryAttempts: [],
  repeatedStateContexts: [],
  stuckEvents: 1,
};

function observation(): MgbaObservation {
  return {
    screenshot: {
      data: "screen",
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

describe("createControllerPrimaryFailureReport", () => {
  it("reports terminal deterministic recovery plus bounded LLM fallback failure evidence", () => {
    const fallbackBudget = new BoundedLlmFallbackBudget({
      maxAttemptsPerEdge: 1,
      timeoutMs: 250,
    });
    const firstAdmission = fallbackBudget.beginAttempt(decision);
    if ("recoveryAction" in firstAdmission) {
      throw new Error("expected first fallback attempt to be admitted");
    }
    fallbackBudget.completeAttempt({
      edgeKey: firstAdmission.edgeKey,
      result: "timeout",
    });
    const blocked = fallbackBudget.beginAttempt(decision);
    if (!("recoveryAction" in blocked)) {
      throw new Error("expected fallback attempt to be blocked");
    }

    const metrics = new RunMetricsTracker({ runId: "run-1" });
    metrics.recordControllerAction({
      phase: decision.phase,
      waypoint: decision.waypoint,
    });
    metrics.recordLlmFallback({
      phase: decision.phase,
      waypoint: decision.waypoint,
    });
    metrics.recordVerification("failure");
    metrics.recordBlockedRepeatedAction({
      phase: decision.phase,
      waypoint: decision.waypoint,
    });

    const report = createControllerPrimaryFailureReport({
      currentPhase: metrics.snapshot().currentPhase,
      currentWaypoint: metrics.snapshot().currentWaypoint,
      decision,
      deterministicRecoveryAction: blocked.recoveryAction,
      deterministicRecoveryExpectedOutcome: "dialogue-progress",
      evaluatorMilestone: {
        current: "pallet-town",
        furthest: "route-1",
      },
      fallbackBlock: blocked,
      finalObservation: observation(),
      metrics: metrics.snapshot(),
      runId: "run-1",
      stopReason:
        "controller-primary-terminal-failure:bounded-fallback-recovery-verification",
      stuckMemory,
      turn: 9,
      verification: {
        reason: "no dialogue/script progress after mgba_tap:B",
        success: false,
      },
      verificationStage: "bounded-fallback-recovery-verification",
    });

    expect(report).toMatchObject({
      failedVerificationStage: "bounded-fallback-recovery-verification",
      finalHarnessState: {
        currentPhase: "route1",
        currentWaypoint: "fallback-analysis",
        finalRuntimeGameState: {
          battle: false,
          evaluatorMilestone: "route-1",
          evaluatorMilestoneCurrent: "pallet-town",
          evaluatorMilestoneFurthest: "route-1",
          mapId: 12,
          phase: "route1",
          readStatus: "available",
          source: "pokemon-red-ram",
          statusFrame: 2817,
          x: 10,
          y: 14,
        },
        metrics: {
          deterministicController: {
            actionsTotal: 1,
            namespace: "deterministic-controller",
            source: "runtime-game-state-controller",
          },
          deterministicActionsTotal: 1,
          llmFallback: {
            callsTotal: 1,
            namespace: "llm-fallback",
            source: "bounded-fallback-tracker",
          },
          llmFallbackCallsTotal: 1,
          blockedRepeatedActionsTotal: 1,
          verificationFailuresTotal: 1,
        },
        stopReason:
          "controller-primary-terminal-failure:bounded-fallback-recovery-verification",
        stuckMemory: {
          failedMovementEdges: [
            expect.objectContaining({
              action: "hold:Up",
              attempts: 3,
            }),
          ],
          stuckEvents: 1,
        },
        turn: 9,
      },
      retryCount: {
        deterministicRecoveryAttempts: 1,
        llmFallbackAttempts: 1,
        maxLlmFallbackAttempts: 1,
      },
      timeoutStatus: {
        lastFallbackResult: "timeout",
        timedOut: true,
        timeoutMs: 250,
      },
      type: "controller-primary-terminal-failure",
    });
    expect(
      report.finalHarnessState.metrics.deterministicController
    ).not.toHaveProperty("callsTotal");
    expect(report.finalHarnessState.metrics.llmFallback).not.toHaveProperty(
      "actionsTotal"
    );
  });
});
