import type {
  DeterministicExpectedOutcome,
  DeterministicPolicyDecision,
} from "./deterministic-policy";
import type { LlmFallbackAttemptBlock } from "./fallback-gate";
import type { MgbaObservation } from "./observation";
import type { RunMetricsSnapshot } from "./run-metrics";
import {
  createRuntimeGameStateEvidence,
  type EvaluatorMilestoneState,
  type RuntimeGameStateEvidence,
} from "./run-trace";
import type { AutopilotAction } from "./stage1-fast-autopilot";
import type { StuckMemorySnapshot } from "./stuck-memory";

export type ControllerPrimaryFailureVerificationStage =
  "bounded-fallback-recovery-verification";

export interface ControllerPrimaryFailureReport {
  deterministicRecovery: {
    action: {
      button: AutopilotAction["button"];
      duration: number | undefined;
      expectedOutcome: DeterministicExpectedOutcome | undefined;
      reason: string;
      toolName: AutopilotAction["toolName"];
    };
    verificationReason: string;
  };
  failedVerificationStage: ControllerPrimaryFailureVerificationStage;
  fallback: {
    edgeKey: string;
    lastResult: LlmFallbackAttemptBlock["lastResult"];
    maxAttempts: number;
    phase: DeterministicPolicyDecision["phase"];
    policy: DeterministicPolicyDecision["policy"];
    reason: string;
    waypoint: string;
  };
  finalHarnessState: {
    currentPhase: string | undefined;
    currentWaypoint: string | undefined;
    finalRuntimeGameState: RuntimeGameStateEvidence | null;
    metrics: Pick<
      RunMetricsSnapshot,
      | "deterministicActionsTotal"
      | "deterministicController"
      | "fallbackRate"
      | "llmFallback"
      | "llmFallbackCallsTotal"
      | "blockedRepeatedActionsTotal"
      | "stuckEvents"
      | "verificationFailuresTotal"
      | "verificationSuccessesTotal"
    >;
    runId: string;
    stopReason: string;
    stuckMemory: Pick<
      StuckMemorySnapshot,
      "failedMovementEdges" | "recentRecoveryAttempts" | "stuckEvents"
    >;
    turn: number;
  };
  retryCount: {
    deterministicRecoveryAttempts: number;
    llmFallbackAttempts: number;
    maxLlmFallbackAttempts: number;
  };
  schemaVersion: 1;
  timeoutStatus: {
    lastFallbackResult: LlmFallbackAttemptBlock["lastResult"] | "none";
    timedOut: boolean;
    timeoutMs: number;
  };
  type: "controller-primary-terminal-failure";
}

export function createControllerPrimaryFailureReport({
  currentPhase,
  currentWaypoint,
  decision,
  deterministicRecoveryAction,
  deterministicRecoveryExpectedOutcome,
  evaluatorMilestone,
  fallbackBlock,
  finalObservation,
  metrics,
  runId,
  stopReason,
  stuckMemory,
  turn,
  verification,
  verificationStage,
}: {
  currentPhase: string | undefined;
  currentWaypoint: string | undefined;
  decision: DeterministicPolicyDecision;
  deterministicRecoveryAction: AutopilotAction;
  deterministicRecoveryExpectedOutcome:
    | DeterministicExpectedOutcome
    | undefined;
  evaluatorMilestone: EvaluatorMilestoneState;
  fallbackBlock: LlmFallbackAttemptBlock;
  finalObservation: MgbaObservation;
  metrics: RunMetricsSnapshot;
  runId: string;
  stopReason: string;
  stuckMemory: StuckMemorySnapshot;
  turn: number;
  verification: { reason: string; success: boolean };
  verificationStage: ControllerPrimaryFailureVerificationStage;
}): ControllerPrimaryFailureReport {
  const finalRuntimeGameState =
    createRuntimeGameStateEvidence(finalObservation, evaluatorMilestone) ??
    null;

  return {
    deterministicRecovery: {
      action: {
        button: deterministicRecoveryAction.button,
        duration: deterministicRecoveryAction.duration,
        expectedOutcome: deterministicRecoveryExpectedOutcome,
        reason: deterministicRecoveryAction.reason,
        toolName: deterministicRecoveryAction.toolName,
      },
      verificationReason: verification.reason,
    },
    failedVerificationStage: verificationStage,
    fallback: {
      edgeKey: fallbackBlock.edgeKey,
      lastResult: fallbackBlock.lastResult,
      maxAttempts: fallbackBlock.maxAttempts,
      phase: decision.phase,
      policy: decision.policy,
      reason: fallbackBlock.reason,
      waypoint: decision.waypoint,
    },
    finalHarnessState: {
      currentPhase,
      currentWaypoint,
      finalRuntimeGameState,
      metrics: {
        deterministicActionsTotal: metrics.deterministicActionsTotal,
        deterministicController: metrics.deterministicController,
        fallbackRate: metrics.fallbackRate,
        llmFallback: metrics.llmFallback,
        llmFallbackCallsTotal: metrics.llmFallbackCallsTotal,
        blockedRepeatedActionsTotal: metrics.blockedRepeatedActionsTotal,
        stuckEvents: metrics.stuckEvents,
        verificationFailuresTotal: metrics.verificationFailuresTotal,
        verificationSuccessesTotal: metrics.verificationSuccessesTotal,
      },
      runId,
      stopReason,
      stuckMemory: {
        failedMovementEdges: stuckMemory.failedMovementEdges,
        recentRecoveryAttempts: stuckMemory.recentRecoveryAttempts,
        stuckEvents: stuckMemory.stuckEvents,
      },
      turn,
    },
    retryCount: {
      deterministicRecoveryAttempts: 1,
      llmFallbackAttempts: fallbackBlock.attempts,
      maxLlmFallbackAttempts: fallbackBlock.maxAttempts,
    },
    schemaVersion: 1,
    timeoutStatus: {
      lastFallbackResult: fallbackBlock.lastResult ?? "none",
      timedOut: fallbackBlock.timedOut,
      timeoutMs: fallbackBlock.timeoutMs,
    },
    type: "controller-primary-terminal-failure",
  };
}
