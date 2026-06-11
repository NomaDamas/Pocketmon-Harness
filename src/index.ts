import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { Agent, type SessionHandle } from "@minpeter/pss-runtime";
import { createControllerPrimaryFailureReport } from "./controller-primary-failure-report";
import {
  chooseDeterministicPolicyAction,
  type DeterministicExpectedOutcome,
  type DeterministicPolicyDecision,
} from "./deterministic-policy";
import {
  resolveDeterministicVerificationExpectedOutcome,
  verifyDeterministicOutcome,
} from "./deterministic-verification";
import {
  type AiProviderPreset,
  createHarnessStartupConfig,
  env,
  getFallbackMicroAiRuntimeConfig,
  getMicroAiRuntimeConfig,
} from "./env";
import {
  ControllerFirstFallbackGateAttemptTracker,
  createBoundedLlmFallbackInvocationEvent,
  getRivalBattleLlmControlGuard,
  type LlmFallbackAttemptAdmission,
  LlmFallbackGate,
} from "./fallback-gate";
import { readLatestImprovementHints } from "./improvement-hints";
import { startMetricsServer } from "./metrics-server";
import { MgbaHttpClient } from "./mgba-http";
import {
  captureMgbaObservation,
  createObservedInput,
  type MgbaObservation,
} from "./observation";
import { ObservationBookkeeping } from "./observation-bookkeeping";
import {
  POKEMON_MILESTONES,
  PokemonMilestoneTracker,
} from "./pokemon-milestones";
import { createPrettyLogger } from "./pretty-log";
import { RunMetricsTracker } from "./run-metrics";
import {
  createOptimizedFreshRunTrace,
  createRuntimeGameStateEvidence,
  updateRunTraceMetadata,
} from "./run-trace";
import {
  createTurnPrompt,
  type RunnerEvent,
  type RunnerLimitReason,
  streamSupervisedRun,
} from "./runner";
import { improveLatestTrace } from "./self-improvement";
import { SharedStrategyMemory } from "./shared-strategy";
import { POKEMON_RED_STAGE1_MAP_IDS } from "./stage1-evaluator";
import type { AutopilotAction } from "./stage1-fast-autopilot";
import { shouldStopHarness } from "./stop-controller";
import { StuckMemory } from "./stuck-memory";
import {
  createSupervisorEvent,
  type SupervisorIntervention,
  waitForPostActionSettle,
  waitThroughBlackFrames,
} from "./supervisor";
import {
  createTrackedModel,
  type TokenUsageCallMetadata,
  TokenUsageTracker,
} from "./token-usage";
import { createMgbaControlPlane, describeMgbaControlPlane } from "./tools";
import { createViewerEventRecorder } from "./viewer-recorder";

const aiRuntimeConfig = getMicroAiRuntimeConfig();
const fallbackAiRuntimeConfig = getFallbackMicroAiRuntimeConfig();

const instructions = [
  "You are a concise Pokemon-playing control agent.",
  describeMgbaControlPlane(),
  "When playing autonomously, use a loop of injected observation -> decide -> one action -> brief summary.",
  "Use red movement guide lines to distinguish blocked cells, open walkable cells, and interactable-looking objects. Prefer exploring open unseen space or facing likely objects and pressing A.",
  "Movement duration calibration: 10=1 red cell, 20=2 cells, 45=3 cells, 60=4 cells, 75=5 cells, 90=6 cells. Longer movement is possible with larger duration on clearly open straight paths; near obstacles, move one cell and re-observe.",
  "Track recent action context and avoid repeating actions that did not visibly change progress.",
  "Before any tool call, output exactly one <action_plan>...</action_plan> block containing the medium-term goal, visible blocked/open/object assessment, intended target, next action, and recent repetition to avoid.",
  "Keep final user-facing answers under 3 lines, but use tools whenever game control is requested.",
].join("\n\n");
const mgbaClient = new MgbaHttpClient({
  authToken: env.MGBA_HTTP_AUTH_TOKEN,
  baseUrl: env.MGBA_HTTP_BASE_URL,
});
const tools = createMgbaControlPlane({
  client: mgbaClient,
  onSupervisorIntervention: recordSupervisorIntervention,
});
let runTrace = await createOptimizedFreshRunTrace();
const viewerEventRecorder = createViewerEventRecorder({ trace: runTrace });
const prettyLogger = createPrettyLogger();
prettyLogger.runTrace(runTrace);
const runMetricsTracker = new RunMetricsTracker({
  experimentId: runTrace.experimentId,
  iteration: runTrace.iteration,
  mode: runTrace.mode,
  runId: runTrace.runId,
});
const tokenUsageTracker = new TokenUsageTracker({
  iteration: runTrace.iteration,
  metricsDir: runTrace.metricsDir,
  runId: runTrace.runId,
  onMetric: (metric) => {
    prettyLogger.tokenUsage(metric);
    runMetricsTracker.recordTokenUsageMetric(metric);
  },
});
const harnessBudget = {
  maxMinutes: env.HARNESS_MAX_MINUTES,
  maxRamUnavailableTurns: env.HARNESS_MAX_RAM_UNAVAILABLE_TURNS,
  maxSteps: env.HARNESS_MAX_STEPS,
  maxTokens: env.HARNESS_MAX_TOKENS,
  maxTurns: env.HARNESS_MAX_TURNS,
};
const harnessStartupConfig = createHarnessStartupConfig(env);
const harnessStartedAtMs = Date.now();

const metricsServer = startMetricsServer(tokenUsageTracker, runMetricsTracker, {
  host: env.METRICS_HTTP_HOST,
  port: env.METRICS_HTTP_PORT,
});

const recentActions: string[] = [];
const milestoneTracker = new PokemonMilestoneTracker();
const stuckMemory = new StuckMemory();
const llmFallbackGate = new LlmFallbackGate();
const controllerFirstFallbackGateAttempts =
  new ControllerFirstFallbackGateAttemptTracker();
const sharedStrategyMemory = new SharedStrategyMemory({
  runId: runTrace.runId,
});
const observationBookkeeping = new ObservationBookkeeping({
  runMetricsTracker,
  stuckMemory,
});
let session: SessionHandle;
let activeAiRuntimeConfig = aiRuntimeConfig;
let ramUnavailableFallbacks = 0;
let requestedStopReason: string | undefined;
let boundedFallbackActive = false;
let pendingFallbackAttempt: LlmFallbackAttemptAdmission | undefined;
let turnsRun = 0;

session = await createPokemonSession(activeAiRuntimeConfig);

class HarnessStopError extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(reason);
    this.name = "HarnessStopError";
    this.reason = reason;
  }
}

async function createPokemonSession(config: {
  apiKey?: string;
  baseURL: string;
  model: string;
  provider: AiProviderPreset;
}): Promise<SessionHandle> {
  const provider = createOpenAICompatible({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    name: "pokemon",
  });
  const agent = await Agent.create({
    hooks: {
      afterStep: async ({ result, signal, stepIndex }) => {
        if (result !== "continue") {
          return;
        }
        if (boundedFallbackActive) {
          return;
        }

        await waitThroughBlackFrames({
          client: mgbaClient,
          onIntervention: recordSupervisorIntervention,
          signal,
        });
        const observation = await captureMgbaObservation(mgbaClient, signal);
        await recordStepObservation(observation);
        await session.steer(
          createObservedInput({
            improvementHints: await readLatestImprovementHints(),
            observation,
            recentActions,
            stuckMemory: stuckMemory.snapshot(),
            text: `Fresh mGBA observation after continuing step ${stepIndex + 1}.`,
          })
        );
      },
      beforeTurn: async ({ signal }) => {
        const observation = await captureMgbaObservation(mgbaClient, signal);
        await recordTurnObservation(observation);
        await session.steer(
          createObservedInput({
            improvementHints: await readLatestImprovementHints(),
            observation,
            recentActions,
            stuckMemory: stuckMemory.snapshot(),
            text: `Fresh mGBA observation before turn ${turnsRun}. Use it with the current objective prompt to choose the next control action.`,
          })
        );
      },
    },
    instructions,
    model: createTrackedModel({
      model: provider(config.model),
      tracker: tokenUsageTracker,
    }),
    toolChoice: "required",
    tools,
  });
  return agent.session(`pokemon-run-${config.provider}-${config.model}`);
}

while (true) {
  const stopReason = shouldStopHarness(harnessBudget, {
    runMetrics: runMetricsTracker.snapshot(),
    ramUnavailableFallbacks,
    startedAtMs: harnessStartedAtMs,
    tokenUsage: tokenUsageTracker.snapshot(),
    turnsRun,
  });
  if (stopReason) {
    await stopHarness(stopReason);
    break;
  }

  turnsRun += 1;
  observationBookkeeping.clearCurrentObservation();

  try {
    if (await tryExecuteDeterministicPolicy()) {
      await persistRunMetricsMetadata();
      continue;
    }
  } catch (error) {
    if (error instanceof HarnessStopError) {
      await stopHarness(error.reason);
      break;
    }
    throw error;
  }

  tokenUsageTracker.startTurn(turnsRun);

  try {
    let fallbackLimitReason: RunnerLimitReason | undefined;
    const fallbackCallMetadata = currentFallbackCallMetadata();
    if (fallbackCallMetadata) {
      tokenUsageTracker.setActiveCallMetadata(fallbackCallMetadata);
    }
    const run = await session.send(createTurnPrompt(turnsRun));
    boundedFallbackActive = true;
    await streamSupervisedRun({
      client: mgbaClient,
      maxDurationMs: pendingFallbackAttempt?.timeoutMs,
      maxSteps: 1,
      maxToolResults: 1,
      onLimit: (reason) => {
        fallbackLimitReason = reason;
        session.interrupt();
      },
      onEvent: (event) => {
        const ownedEvent = markFallbackControlEvent(event);
        runMetricsTracker.recordEvent(ownedEvent);
        observationBookkeeping.recordEvent(ownedEvent, turnsRun);
        recordRecentAction(ownedEvent, recentActions);
        prettyLogger.event(ownedEvent as never);
        fireAndReportViewerWrite(
          viewerEventRecorder.recordEvent(ownedEvent, { turn: turnsRun })
        );
        const streamStopReason = currentStopReason();
        if (streamStopReason) {
          requestedStopReason = streamStopReason;
          throw new HarnessStopError(streamStopReason);
        }
      },
      run,
    });
    completePendingFallbackAttempt(fallbackLimitReason ?? "interrupted");
    await tokenUsageTracker.endTurn();
  } catch (error) {
    boundedFallbackActive = false;
    completePendingFallbackAttempt(
      error instanceof HarnessStopError ? "interrupted" : "error"
    );
    if (error instanceof HarnessStopError) {
      await tokenUsageTracker.endTurn();
      await stopHarness(error.reason);
      break;
    }
    if (await trySwitchToFallbackModel(error)) {
      await tokenUsageTracker.endTurn();
      await persistRunMetricsMetadata();
      continue;
    }
    throw error;
  } finally {
    boundedFallbackActive = false;
    tokenUsageTracker.clearActiveCallMetadata();
  }
  await persistRunMetricsMetadata();
}

function currentStopReason(): string | undefined {
  return (
    requestedStopReason ??
    shouldStopHarness(harnessBudget, {
      runMetrics: runMetricsTracker.snapshot(),
      ramUnavailableFallbacks,
      startedAtMs: harnessStartedAtMs,
      tokenUsage: tokenUsageTracker.snapshot(),
      turnsRun,
    })
  );
}

function isStage1ViridianVictoryObservation(
  observation: MgbaObservation
): boolean {
  return (
    observation.state?.readStatus === "available" &&
    observation.state.mapId === POKEMON_RED_STAGE1_MAP_IDS.viridianCity
  );
}

function completePendingFallbackAttempt(
  result: RunnerLimitReason | "completed" | "error" | "interrupted"
): void {
  if (!pendingFallbackAttempt) {
    return;
  }

  const completionResult =
    result === "max-steps" || result === "max-tool-results"
      ? "completed"
      : result;
  llmFallbackGate.completeAttempt({
    edgeKey: pendingFallbackAttempt.edgeKey,
    result: completionResult,
  });
  const usage = tokenUsageTracker.currentTurnUsage();
  const callMetadata = currentFallbackCallMetadata();
  recordHarnessEvent({
    attempt: pendingFallbackAttempt.attempt,
    ...(callMetadata ? { callMetadata } : {}),
    completionTokens: usage.outputTokens,
    controlOwner: "llm-fallback",
    edgeKey: pendingFallbackAttempt.edgeKey,
    maxAttempts: pendingFallbackAttempt.maxAttempts,
    modelName: currentModelName(),
    promptTokens: usage.inputTokens,
    result: completionResult,
    timeoutMs: pendingFallbackAttempt.timeoutMs,
    totalTokens: usage.totalTokens,
    type: "llm-fallback-completion",
    usage,
  });
  recordHarnessEvent({
    text: `<fallback_budget edge="${pendingFallbackAttempt.edgeKey}" status="attempt-finished" result="${result}" attempt="${pendingFallbackAttempt.attempt}" max="${pendingFallbackAttempt.maxAttempts}" timeoutMs="${pendingFallbackAttempt.timeoutMs}" />`,
    type: "assistant-text",
  });
  pendingFallbackAttempt = undefined;
}

async function stopHarness(stopReason: string): Promise<void> {
  requestedStopReason = stopReason;
  stopActiveSession();
  runTrace = await updateRunTraceMetadata(runTrace, { stopReason });
  try {
    const improvement = await improveLatestTrace({ runId: runTrace.runId });
    runTrace = await updateRunTraceMetadata(runTrace, {
      latestImprovementStatus: improvement.status,
    });
    console.dir({ improvement, type: "self-improvement-stop-audit" });
  } catch (error) {
    console.dir({
      message: error instanceof Error ? error.message : String(error),
      type: "self-improvement-stop-audit-error",
    });
  }
  console.dir({ runId: runTrace.runId, stopReason, type: "harness-stop" });
  await closeMetricsServer();
}

function stopActiveSession(): void {
  try {
    session.interrupt();
    session.kill();
  } catch (error) {
    console.dir({
      message: error instanceof Error ? error.message : String(error),
      type: "session-stop-error",
    });
  }
}

async function closeMetricsServer(): Promise<void> {
  if (!metricsServer.listening) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    metricsServer.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function tryExecuteDeterministicPolicy(): Promise<boolean> {
  const observation = await captureMgbaObservation(mgbaClient);
  if (isStage1ViridianVictoryObservation(observation)) {
    await recordTurnObservation(observation);
    runMetricsTracker.recordPhase({
      phase: "viridian",
      waypoint: "stage1-complete",
    });
    runTrace = await updateRunTraceMetadata(runTrace, {
      currentPhase: "viridian",
      currentWaypoint: "stage1-complete",
    });
    throw new HarnessStopError("stage1-victory:reach-viridian-city");
  }
  const sharedSuggestion = await sharedStrategyMemory.suggest(observation);
  if (sharedSuggestion) {
    pendingFallbackAttempt = undefined;
    runMetricsTracker.recordPhase({
      phase: sharedSuggestion.phase,
      waypoint: sharedSuggestion.waypoint,
    });
    runTrace = await updateRunTraceMetadata(runTrace, {
      currentPhase: sharedSuggestion.phase,
      currentWaypoint: sharedSuggestion.waypoint,
    });
    await recordTurnObservation(observation);
    await executeDeterministicButtonAction({
      action: sharedSuggestion.action,
      before: observation,
      expectedOutcome:
        sharedSuggestion.action.toolName === "mgba_hold"
          ? "movement-or-map-change"
          : "dialogue-progress",
      id: `shared-strategy-${turnsRun}`,
      phase: sharedSuggestion.phase,
      policy: "shared-strategy",
      waypoint: sharedSuggestion.waypoint,
    });
    return true;
  }

  const decision = chooseDeterministicPolicyAction({
    observation,
    recentActions,
    starterPreference: harnessStartupConfig.starterPreference,
    stuckMemory: stuckMemory.snapshot(),
  });
  if (!decision.action) {
    if (
      await tryGateControllerFirstLlmFallback({ before: observation, decision })
    ) {
      return true;
    }
    if (
      await tryGuardRivalBattleLlmFallback({ before: observation, decision })
    ) {
      return true;
    }
    if (observation.state?.readStatus === "unavailable") {
      ramUnavailableFallbacks += 1;
    } else {
      ramUnavailableFallbacks = 0;
    }

    const controllerFirstGateExhaustion =
      controllerFirstFallbackGateAttempts.exhaustionFor(decision);
    const fallbackAdmission = llmFallbackGate.beginInvocation({
      controllerFirstGateExhaustion,
      decision,
    });
    if ("allowed" in fallbackAdmission) {
      await recordTurnObservation(observation);
      recordHarnessEvent({
        text: `<fallback_gate phase="${decision.phase}" waypoint="${decision.waypoint}" status="denied" edge="${fallbackAdmission.edgeKey}">${fallbackAdmission.reason}</fallback_gate>`,
        type: "assistant-text",
      });
      runMetricsTracker.recordPhase({
        phase: decision.phase,
        waypoint: decision.waypoint,
      });
      runTrace = await updateRunTraceMetadata(runTrace, {
        currentPhase: decision.phase,
        currentWaypoint: decision.waypoint,
      });
      return true;
    }
    if ("recoveryAction" in fallbackAdmission) {
      await recordTurnObservation(observation);
      recordHarnessEvent({
        text: `<fallback_budget edge="${fallbackAdmission.edgeKey}" status="blocked" attempts="${fallbackAdmission.attempts}" max="${fallbackAdmission.maxAttempts}">${fallbackAdmission.reason}</fallback_budget>`,
        type: "assistant-text",
      });
      runMetricsTracker.recordPhase({
        phase: decision.phase,
        waypoint: decision.waypoint,
      });
      runTrace = await updateRunTraceMetadata(runTrace, {
        currentPhase: decision.phase,
        currentWaypoint: decision.waypoint,
      });
      const { after, verification } = await executeDeterministicButtonAction({
        action: fallbackAdmission.recoveryAction,
        before: observation,
        expectedOutcome: "dialogue-progress",
        id: `bounded-fallback-recovery-${turnsRun}`,
        phase: decision.phase,
        policy: "fallback-budget",
        waypoint: decision.waypoint,
      });
      if (!verification.success) {
        emitControllerPrimaryTerminalFailure({
          after,
          decision,
          fallbackBlock: fallbackAdmission,
          recoveryAction: fallbackAdmission.recoveryAction,
          recoveryExpectedOutcome: "dialogue-progress",
          verification,
        });
      }
      return true;
    }

    pendingFallbackAttempt = fallbackAdmission;
    recordHarnessEvent(
      createBoundedLlmFallbackInvocationEvent({
        admission: fallbackAdmission,
        callMetadata: currentFallbackCallMetadata(fallbackAdmission),
        controllerFirstGateExhaustion,
        decision,
      })
    );
    runTrace = await updateRunTraceMetadata(runTrace, {
      currentPhase: decision.phase,
      currentWaypoint: decision.waypoint,
    });
    console.dir({
      attempt: fallbackAdmission.attempt,
      edgeKey: fallbackAdmission.edgeKey,
      maxAttempts: fallbackAdmission.maxAttempts,
      phase: decision.phase,
      policy: decision.policy,
      reason: decision.reason,
      timeoutMs: fallbackAdmission.timeoutMs,
      type: "llm-fallback-required",
      waypoint: decision.waypoint,
    });
    const ramStopReason = currentStopReason();
    if (ramStopReason?.startsWith("ram-unavailable-turns:")) {
      throw new HarnessStopError(ramStopReason);
    }
    return false;
  }
  pendingFallbackAttempt = undefined;
  ramUnavailableFallbacks = 0;

  runMetricsTracker.recordPhase({
    phase: decision.phase,
    waypoint: decision.waypoint,
  });
  runTrace = await updateRunTraceMetadata(runTrace, {
    currentPhase: decision.phase,
    currentWaypoint: decision.waypoint,
  });
  await recordTurnObservation(observation);
  await executeDeterministicButtonAction({
    action: decision.action,
    before: observation,
    controllerRoutine: decision.controllerRoutine,
    expectedOutcome: decision.expectedOutcome,
    id: `deterministic-${decision.policy}-${turnsRun}`,
    phase: decision.phase,
    policy: decision.policy,
    waypoint: decision.waypoint,
  });
  return true;
}

function currentFallbackCallMetadata(
  attempt = pendingFallbackAttempt
): TokenUsageCallMetadata | undefined {
  if (!attempt) {
    return;
  }
  const metrics = runMetricsTracker.snapshot();

  return {
    attempt: attempt.attempt,
    callPath: "bounded-llm-fallback",
    controlOwner: "llm-fallback",
    edgeKey: attempt.edgeKey,
    maxAttempts: attempt.maxAttempts,
    modelName: currentModelName(),
    phase: metrics.currentPhase,
    provider: activeAiRuntimeConfig.provider,
    runId: runTrace.runId,
    timeoutMs: attempt.timeoutMs,
    turn: turnsRun,
    waypoint: metrics.currentWaypoint,
  };
}

function currentModelName(): string {
  return `${activeAiRuntimeConfig.provider}:${activeAiRuntimeConfig.model}`;
}

async function tryGuardRivalBattleLlmFallback({
  before,
  decision,
}: {
  before: MgbaObservation;
  decision: DeterministicPolicyDecision;
}): Promise<boolean> {
  const guard = getRivalBattleLlmControlGuard(decision);
  if (!guard) {
    return false;
  }

  await recordTurnObservation(before);
  pendingFallbackAttempt = undefined;
  ramUnavailableFallbacks = 0;
  runMetricsTracker.recordPhase({
    phase: decision.phase,
    waypoint: decision.waypoint,
  });
  runTrace = await updateRunTraceMetadata(runTrace, {
    currentPhase: decision.phase,
    currentWaypoint: decision.waypoint,
  });
  recordHarnessEvent({
    text: `<fallback_guard phase="${decision.phase}" waypoint="${decision.waypoint}" status="blocked" stopReason="${guard.stopReason}">${guard.reason} controller_reason="${decision.reason}"</fallback_guard>`,
    type: "assistant-text",
  });
  throw new HarnessStopError(guard.stopReason);
}

function emitControllerPrimaryTerminalFailure({
  after,
  decision,
  fallbackBlock,
  recoveryAction,
  recoveryExpectedOutcome,
  verification,
}: {
  after: MgbaObservation;
  decision: DeterministicPolicyDecision;
  fallbackBlock: Extract<
    ReturnType<LlmFallbackGate["beginInvocation"]>,
    { recoveryAction: AutopilotAction }
  >;
  recoveryAction: AutopilotAction;
  recoveryExpectedOutcome: DeterministicExpectedOutcome;
  verification: ReturnType<typeof verifyDeterministicOutcome>;
}): never {
  const stopReason =
    "controller-primary-terminal-failure:bounded-fallback-recovery-verification";
  const metrics = runMetricsTracker.snapshot();
  const report = createControllerPrimaryFailureReport({
    currentPhase: metrics.currentPhase,
    currentWaypoint: metrics.currentWaypoint,
    decision,
    deterministicRecoveryAction: recoveryAction,
    deterministicRecoveryExpectedOutcome: recoveryExpectedOutcome,
    evaluatorMilestone: {
      current: runTrace.milestoneCurrent ?? null,
      furthest: runTrace.milestoneFurthest ?? null,
    },
    fallbackBlock,
    finalObservation: after,
    metrics,
    runId: runTrace.runId,
    stopReason,
    stuckMemory: stuckMemory.snapshot(),
    turn: turnsRun,
    verification,
    verificationStage: "bounded-fallback-recovery-verification",
  });
  recordHarnessEvent({
    text: `<controller_primary_terminal_failure>${JSON.stringify(report)}</controller_primary_terminal_failure>`,
    type: "assistant-text",
  });
  console.dir(report);
  throw new HarnessStopError(stopReason);
}

async function tryGateControllerFirstLlmFallback({
  before,
  decision,
}: {
  before: MgbaObservation;
  decision: DeterministicPolicyDecision;
}): Promise<boolean> {
  const gateAttempt =
    controllerFirstFallbackGateAttempts.beginAttempt(decision);
  if (!gateAttempt) {
    return false;
  }
  if ("fallbackEligible" in gateAttempt) {
    recordHarnessEvent({
      text: `<fallback_gate phase="${decision.phase}" waypoint="${decision.waypoint}" status="exhausted" attempts="${gateAttempt.attempts}" max="${gateAttempt.maxAttempts}">${gateAttempt.reason}</fallback_gate>`,
      type: "assistant-text",
    });
    return false;
  }

  await recordTurnObservation(before);
  recordHarnessEvent({
    text: `<fallback_gate phase="${decision.phase}" waypoint="${decision.waypoint}" status="deterministic-a-settle-verify" attempt="${gateAttempt.attempt}" max="${gateAttempt.maxAttempts}">${gateAttempt.reason} controller_reason="${decision.reason}"</fallback_gate>`,
    type: "assistant-text",
  });

  ramUnavailableFallbacks = 0;
  runMetricsTracker.recordPhase({
    phase: decision.phase,
    waypoint: decision.waypoint,
  });
  runTrace = await updateRunTraceMetadata(runTrace, {
    currentPhase: decision.phase,
    currentWaypoint: decision.waypoint,
  });
  const { after, verification } = await executeDeterministicButtonAction({
    action: gateAttempt.action,
    before,
    expectedOutcome: gateAttempt.expectedOutcome,
    id: `deterministic-fallback-gate-${turnsRun}-${gateAttempt.attempt}`,
    phase: decision.phase,
    policy: "fallback-gate",
    waypoint: decision.waypoint,
  });
  const gateExhaustion = controllerFirstFallbackGateAttempts.completeAttempt({
    edgeKey: gateAttempt.edgeKey,
    success: verification.success,
    verificationReason: verification.reason,
  });
  if (verification.success) {
    return true;
  }
  const retry = chooseDeterministicPolicyAction({
    observation: after,
    recentActions,
    starterPreference: harnessStartupConfig.starterPreference,
    stuckMemory: stuckMemory.snapshot(),
  });

  if (!retry.action) {
    recordHarnessEvent({
      text: gateExhaustion
        ? `<fallback_gate phase="${retry.phase}" waypoint="${retry.waypoint}" status="exhausted" attempts="${gateExhaustion.attempts}" max="${gateExhaustion.maxAttempts}" verification="failed">${gateExhaustion.reason}; last_verification="${gateExhaustion.lastVerificationReason ?? "unknown"}"</fallback_gate>`
        : `<fallback_gate phase="${retry.phase}" waypoint="${retry.waypoint}" status="retry-pending" attempt="${gateAttempt.attempt}" max="${gateAttempt.maxAttempts}" verification="failed">${retry.reason}</fallback_gate>`,
      type: "assistant-text",
    });
    return true;
  }

  ramUnavailableFallbacks = 0;
  runMetricsTracker.recordPhase({
    phase: retry.phase,
    waypoint: retry.waypoint,
  });
  runTrace = await updateRunTraceMetadata(runTrace, {
    currentPhase: retry.phase,
    currentWaypoint: retry.waypoint,
  });
  await executeDeterministicButtonAction({
    action: retry.action,
    before: after,
    controllerRoutine: retry.controllerRoutine,
    expectedOutcome: retry.expectedOutcome,
    id: `deterministic-${retry.policy}-post-oak-gate-${turnsRun}`,
    phase: retry.phase,
    policy: retry.policy,
    waypoint: retry.waypoint,
  });
  return true;
}

async function executeDeterministicButtonAction({
  action,
  before,
  controllerRoutine,
  expectedOutcome,
  id,
  phase,
  policy,
  waypoint,
}: {
  action: AutopilotAction;
  before: MgbaObservation;
  controllerRoutine?: DeterministicPolicyDecision["controllerRoutine"];
  expectedOutcome?: DeterministicExpectedOutcome;
  id: string;
  phase: string;
  policy: string;
  waypoint: string;
}): Promise<{
  after: MgbaObservation;
  verification: ReturnType<typeof verifyDeterministicOutcome>;
}> {
  const buttons = action.buttons?.length ? action.buttons : [action.button];
  const actionPlan = {
    text: `<action_plan>${policy}: ${action.reason}; execute ${formatDeterministicAction(action, buttons)} without LLM.</action_plan>`,
    type: "assistant-text",
  } as const;

  recordHarnessEvent(actionPlan);
  await executeDeterministicControlAction({ action, buttons, id });

  const after = await captureMgbaObservation(mgbaClient);
  const verificationExpectedOutcome =
    resolveDeterministicVerificationExpectedOutcome({
      controllerRoutine,
      expectedOutcome,
    });
  const verification = verifyDeterministicOutcome({
    action,
    after,
    before,
    expectedOutcome: verificationExpectedOutcome,
  });
  if (verification.success) {
    runMetricsTracker.recordVerification("success");
  } else {
    runMetricsTracker.recordEvent({
      action: formatDeterministicAction(action, buttons),
      expectedOutcome: verificationExpectedOutcome,
      phase,
      policy,
      reason: verification.reason,
      type: "verification-failure",
      waypoint,
    });
  }
  if (
    !verification.success &&
    expectedOutcome === "movement-or-map-change" &&
    action.toolName === "mgba_hold"
  ) {
    stuckMemory.recordVerifiedMovementFailure({
      action: `hold:${action.button}`,
      observation: before,
      turn: turnsRun,
    });
    const stuckSnapshot = stuckMemory.snapshot();
    runMetricsTracker.recordStuckEvents(stuckSnapshot.stuckEvents);
    runMetricsTracker.recordBlockedRepeatedActions(
      stuckSnapshot.blockedRepeatedActions ?? 0
    );
  }
  await sharedStrategyMemory.recordActionSuccess({
    action,
    before,
    expectedOutcome: verificationExpectedOutcome,
    phase,
    success: verification.success,
    waypoint,
  });
  const verificationEvent = {
    text: `<verification_result success="${verification.success}" expected="${verificationExpectedOutcome ?? "none"}">${verification.reason}</verification_result>`,
    type: "assistant-text",
  } as const;
  prettyLogger.event(verificationEvent as never);
  fireAndReportViewerWrite(
    viewerEventRecorder.recordEvent(verificationEvent, { turn: turnsRun })
  );
  await recordStepObservation(after);
  return { after, verification };
}

async function executeDeterministicControlAction({
  action,
  buttons,
  id,
}: {
  action: AutopilotAction;
  buttons: readonly AutopilotAction["button"][];
  id: string;
}): Promise<void> {
  if (action.toolName === "mgba_hold") {
    await executeDeterministicSingleControl({
      button: action.button,
      duration: action.duration,
      id,
      toolName: action.toolName,
    });
    return;
  }

  for (const [index, button] of buttons.entries()) {
    await executeDeterministicSingleControl({
      button,
      id: buttons.length === 1 ? id : `${id}-${index + 1}`,
      toolName: action.toolName,
    });
  }
}

async function executeDeterministicSingleControl({
  button,
  duration,
  id,
  toolName,
}: {
  button: AutopilotAction["button"];
  duration?: number;
  id: string;
  toolName: AutopilotAction["toolName"];
}): Promise<void> {
  const toolCall = {
    controlOwner: "deterministic-controller",
    input: toolName === "mgba_hold" ? { button, duration } : { button },
    toolCallId: id,
    toolName,
    type: "tool-call",
  } as const;
  recordHarnessEvent(toolCall);

  const settleStartFrame =
    toolName === "mgba_tap" && button === "A"
      ? (await mgbaClient.status()).frame
      : undefined;
  const output =
    toolName === "mgba_hold"
      ? await mgbaClient.hold(button, duration ?? 10)
      : await mgbaClient.tap(button);
  if (toolName === "mgba_tap" && button === "A") {
    await waitForPostActionSettle({
      client: mgbaClient,
      onIntervention: recordSupervisorIntervention,
      startFrame: settleStartFrame,
    });
  } else {
    await new Promise((resolve) => setTimeout(resolve, 260));
  }

  const toolResult = {
    output: { ok: true, output },
    toolCallId: id,
    toolName,
    type: "tool-result",
  } as const;
  recordHarnessEvent(toolResult);
}

function formatDeterministicAction(
  action: AutopilotAction,
  buttons: readonly AutopilotAction["button"][]
): string {
  if (action.toolName === "mgba_tap" && buttons.length > 1) {
    return `${action.toolName} ${buttons.join(" -> ")}`;
  }
  return `${action.toolName} ${action.button}`;
}

function recordHarnessEvent(
  event: Parameters<typeof runMetricsTracker.recordEvent>[0]
): void {
  runMetricsTracker.recordEvent(event);
  observationBookkeeping.recordEvent(event, turnsRun);
  recordRecentAction(event, recentActions);
  prettyLogger.event(event as never);
  fireAndReportViewerWrite(
    viewerEventRecorder.recordEvent(event, { turn: turnsRun })
  );
}

function markFallbackControlEvent(
  event: RunnerEvent
): Parameters<typeof runMetricsTracker.recordEvent>[0] {
  if (!isControlToolCall(event)) {
    return event;
  }
  const controlOwner = (event as { controlOwner?: unknown }).controlOwner;
  if (
    controlOwner === "deterministic-controller" ||
    controlOwner === "llm-fallback"
  ) {
    return event as Parameters<typeof runMetricsTracker.recordEvent>[0];
  }

  return {
    ...event,
    controlOwner: "llm-fallback",
  };
}

async function trySwitchToFallbackModel(error: unknown): Promise<boolean> {
  if (!fallbackAiRuntimeConfig) {
    return false;
  }
  if (
    activeAiRuntimeConfig.baseURL === fallbackAiRuntimeConfig.baseURL &&
    activeAiRuntimeConfig.model === fallbackAiRuntimeConfig.model
  ) {
    return false;
  }

  const event = {
    detail: error instanceof Error ? error.message : String(error),
    model: fallbackAiRuntimeConfig.model,
    provider: fallbackAiRuntimeConfig.provider,
    type: "model-fallback",
  };
  console.dir(event);
  activeAiRuntimeConfig = fallbackAiRuntimeConfig;
  session = await createPokemonSession(activeAiRuntimeConfig);
  return true;
}

async function recordTurnObservation(
  observation: MgbaObservation
): Promise<void> {
  prettyLogger.observationInjection({
    nextTurn: turnsRun,
    observation,
  });
  await recordObservationProgress(observation);
}

async function recordStepObservation(
  observation: MgbaObservation
): Promise<void> {
  await recordObservationProgress(observation);
}

async function recordObservationProgress(
  observation: MgbaObservation
): Promise<void> {
  observationBookkeeping.promoteObservation(observation, turnsRun);
  await viewerEventRecorder.recordObservation(turnsRun, observation);
  const milestone = milestoneTracker.observe(observation);
  runMetricsTracker.recordMilestoneProgress({
    current: milestone.current,
    furthest: milestone.furthest,
    sequence: POKEMON_MILESTONES,
  });
  const milestoneProgress = runMetricsTracker.snapshot().milestoneProgress;
  const milestoneMetadata = {
    milestone: milestone.furthest ?? undefined,
    milestoneCurrent: milestone.current ?? undefined,
    milestoneFurthest: milestone.furthest ?? undefined,
    milestoneProgress,
  };
  const runtimeGameState = createRuntimeGameStateEvidence(
    observation,
    milestone
  );
  if (runtimeGameState) {
    runTrace = await updateRunTraceMetadata(runTrace, {
      ...milestoneMetadata,
      ramReadStatus: runtimeGameState.readStatus,
      runtimeGameState,
    });
    return;
  }
  if (
    milestone.current !== (runTrace.milestoneCurrent ?? null) ||
    milestone.furthest !== (runTrace.milestoneFurthest ?? null)
  ) {
    runTrace = await updateRunTraceMetadata(runTrace, {
      ...milestoneMetadata,
    });
  }
}

function recordRecentAction(event: unknown, recentActions: string[]): void {
  if (!isControlToolCall(event)) {
    return;
  }

  recentActions.push(formatAction(event.toolName, event.input));
  recentActions.splice(0, Math.max(0, recentActions.length - 10));
}

function isControlToolCall(
  event: unknown
): event is { input: unknown; toolName: string; type: "tool-call" } {
  return (
    typeof event === "object" &&
    event !== null &&
    "type" in event &&
    event.type === "tool-call" &&
    "toolName" in event &&
    typeof event.toolName === "string" &&
    [
      "mgba_tap",
      "mgba_tap_many",
      "mgba_hold",
      "mgba_hold_many",
      "mgba_release",
    ].includes(event.toolName)
  );
}

function formatAction(toolName: string, input: unknown): string {
  return `${toolName.replace("mgba_", "")}: ${JSON.stringify(input)}`;
}

function recordSupervisorIntervention(
  intervention: SupervisorIntervention
): void {
  runMetricsTracker.recordSupervisorIntervention(intervention.reason);
  const event = createSupervisorEvent(intervention);
  prettyLogger.event(event as never);
  fireAndReportViewerWrite(
    viewerEventRecorder.recordEvent(event, { turn: turnsRun })
  );
}

async function persistRunMetricsMetadata(): Promise<void> {
  const snapshot = runMetricsTracker.snapshot();
  if (
    snapshot.blockedRepeatedActionsTotal ===
      runTrace.blockedRepeatedActionsTotal &&
    snapshot.stuckEvents === runTrace.stuckEvents &&
    snapshot.supervisorInterventions === runTrace.supervisorInterventions &&
    snapshot.verificationFailuresTotal === runTrace.verificationFailuresTotal &&
    snapshot.verificationSuccessesTotal === runTrace.verificationSuccessesTotal
  ) {
    return;
  }

  runTrace = await updateRunTraceMetadata(runTrace, {
    blockedRepeatedActionsTotal: snapshot.blockedRepeatedActionsTotal,
    stuckEvents: snapshot.stuckEvents,
    supervisorInterventions: snapshot.supervisorInterventions,
    verificationFailuresTotal: snapshot.verificationFailuresTotal,
    verificationSuccessesTotal: snapshot.verificationSuccessesTotal,
  });
}

function fireAndReportViewerWrite(write: Promise<void>): void {
  write.catch((error: unknown) => {
    console.dir({
      message: error instanceof Error ? error.message : String(error),
      type: "viewer-recorder-error",
    });
  });
}
