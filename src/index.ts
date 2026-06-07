import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { Agent, type SessionHandle } from "@minpeter/pss-runtime";
import { chooseDeterministicPolicyAction } from "./deterministic-policy";
import {
  type AiProviderPreset,
  env,
  getFallbackMicroAiRuntimeConfig,
  getMicroAiRuntimeConfig,
} from "./env";
import { readLatestImprovementHints } from "./improvement-hints";
import { startMetricsServer } from "./metrics-server";
import { MgbaHttpClient } from "./mgba-http";
import {
  captureMgbaObservation,
  createObservedInput,
  type MgbaObservation,
} from "./observation";
import { ObservationBookkeeping } from "./observation-bookkeeping";
import { PokemonMilestoneTracker } from "./pokemon-milestones";
import { createPrettyLogger } from "./pretty-log";
import { RunMetricsTracker } from "./run-metrics";
import {
  createOptimizedFreshRunTrace,
  updateRunTraceMetadata,
} from "./run-trace";
import { createTurnPrompt, streamSupervisedRun } from "./runner";
import { improveLatestTrace } from "./self-improvement";
import { SharedStrategyMemory } from "./shared-strategy";
import type { AutopilotAction } from "./stage1-fast-autopilot";
import { shouldStopHarness } from "./stop-controller";
import { StuckMemory } from "./stuck-memory";
import {
  createSupervisorEvent,
  type SupervisorIntervention,
  waitThroughBlackFrames,
} from "./supervisor";
import { createTrackedModel, TokenUsageTracker } from "./token-usage";
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
  onMetric: prettyLogger.tokenUsage,
});
const harnessBudget = {
  maxMinutes: env.HARNESS_MAX_MINUTES,
  maxRamUnavailableTurns: env.HARNESS_MAX_RAM_UNAVAILABLE_TURNS,
  maxSteps: env.HARNESS_MAX_STEPS,
  maxTokens: env.HARNESS_MAX_TOKENS,
  maxTurns: env.HARNESS_MAX_TURNS,
};
const harnessStartedAtMs = Date.now();

const metricsServer = startMetricsServer(tokenUsageTracker, runMetricsTracker, {
  host: env.METRICS_HTTP_HOST,
  port: env.METRICS_HTTP_PORT,
});

const recentActions: string[] = [];
const milestoneTracker = new PokemonMilestoneTracker();
const stuckMemory = new StuckMemory();
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
    const run = await session.send(createTurnPrompt(turnsRun));
    boundedFallbackActive = true;
    await streamSupervisedRun({
      client: mgbaClient,
      maxSteps: 1,
      maxToolResults: 1,
      onLimit: () => {
        session.interrupt();
      },
      onEvent: (event) => {
        runMetricsTracker.recordEvent(event);
        observationBookkeeping.recordEvent(event, turnsRun);
        recordRecentAction(event, recentActions);
        prettyLogger.event(event as never);
        fireAndReportViewerWrite(
          viewerEventRecorder.recordEvent(event, { turn: turnsRun })
        );
        const streamStopReason = currentStopReason();
        if (streamStopReason) {
          requestedStopReason = streamStopReason;
          throw new HarnessStopError(streamStopReason);
        }
      },
      run,
    });
    await tokenUsageTracker.endTurn();
  } catch (error) {
    boundedFallbackActive = false;
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
  const sharedSuggestion = await sharedStrategyMemory.suggest(observation);
  if (sharedSuggestion) {
    runMetricsTracker.recordControllerAction({
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
    stuckMemory: stuckMemory.snapshot(),
  });
  if (!decision.action) {
    if (observation.state?.readStatus === "unavailable") {
      ramUnavailableFallbacks += 1;
    } else {
      ramUnavailableFallbacks = 0;
    }
    runMetricsTracker.recordLlmFallback({
      phase: decision.phase,
      waypoint: decision.waypoint,
    });
    runTrace = await updateRunTraceMetadata(runTrace, {
      currentPhase: decision.phase,
      currentWaypoint: decision.waypoint,
    });
    console.dir({
      phase: decision.phase,
      policy: decision.policy,
      reason: decision.reason,
      type: "llm-fallback-required",
      waypoint: decision.waypoint,
    });
    const ramStopReason = currentStopReason();
    if (ramStopReason?.startsWith("ram-unavailable-turns:")) {
      throw new HarnessStopError(ramStopReason);
    }
    return false;
  }
  ramUnavailableFallbacks = 0;

  runMetricsTracker.recordControllerAction({
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
    expectedOutcome: decision.expectedOutcome,
    id: `deterministic-${decision.policy}-${turnsRun}`,
    phase: decision.phase,
    policy: decision.policy,
    waypoint: decision.waypoint,
  });
  return true;
}

async function executeDeterministicButtonAction({
  action,
  before,
  expectedOutcome,
  id,
  phase,
  policy,
  waypoint,
}: {
  action: AutopilotAction;
  before: MgbaObservation;
  expectedOutcome?:
    | "battle-progress"
    | "dialogue-progress"
    | "movement-or-map-change";
  id: string;
  phase: string;
  policy: string;
  waypoint: string;
}): Promise<void> {
  const actionPlan = {
    text: `<action_plan>${policy}: ${action.reason}; execute ${action.toolName} ${action.button} without LLM.</action_plan>`,
    type: "assistant-text",
  } as const;
  const toolCall = {
    input:
      action.toolName === "mgba_hold"
        ? { button: action.button, duration: action.duration }
        : { button: action.button },
    toolCallId: id,
    toolName: action.toolName,
    type: "tool-call",
  } as const;
  const output =
    action.toolName === "mgba_hold"
      ? await mgbaClient.hold(action.button, action.duration ?? 10)
      : await mgbaClient.tap(action.button);
  const toolResult = {
    output: { ok: true, output },
    toolCallId: id,
    toolName: action.toolName,
    type: "tool-result",
  } as const;

  for (const event of [actionPlan, toolCall, toolResult] as const) {
    runMetricsTracker.recordEvent(event);
    observationBookkeeping.recordEvent(event, turnsRun);
    recordRecentAction(event, recentActions);
    prettyLogger.event(event as never);
    fireAndReportViewerWrite(
      viewerEventRecorder.recordEvent(event, { turn: turnsRun })
    );
  }

  await new Promise((resolve) => setTimeout(resolve, 260));
  const after = await captureMgbaObservation(mgbaClient);
  const verification = verifyDeterministicOutcome({
    action,
    after,
    before,
    expectedOutcome,
  });
  runMetricsTracker.recordVerification(
    verification.success ? "success" : "failure"
  );
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
    runMetricsTracker.recordStuckEvents(stuckMemory.snapshot().stuckEvents);
  }
  await sharedStrategyMemory.recordActionSuccess({
    action,
    before,
    expectedOutcome,
    phase,
    success: verification.success,
    waypoint,
  });
  const verificationEvent = {
    text: `<verification_result success="${verification.success}" expected="${expectedOutcome ?? "none"}">${verification.reason}</verification_result>`,
    type: "assistant-text",
  } as const;
  prettyLogger.event(verificationEvent as never);
  fireAndReportViewerWrite(
    viewerEventRecorder.recordEvent(verificationEvent, { turn: turnsRun })
  );
  await recordStepObservation(after);
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
  if (milestone.furthest && milestone.furthest !== runTrace.milestoneFurthest) {
    runTrace = await updateRunTraceMetadata(runTrace, {
      milestone: milestone.furthest,
      milestoneCurrent: milestone.current ?? undefined,
      milestoneFurthest: milestone.furthest,
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

function verifyDeterministicOutcome({
  action,
  after,
  before,
  expectedOutcome,
}: {
  action: AutopilotAction;
  after: MgbaObservation;
  before: MgbaObservation;
  expectedOutcome?:
    | "battle-progress"
    | "dialogue-progress"
    | "movement-or-map-change";
}): { reason: string; success: boolean } {
  if (!expectedOutcome) {
    return { reason: "no explicit expected outcome", success: true };
  }
  const beforeState = before.state;
  const afterState = after.state;
  if (!(beforeState && afterState)) {
    return { reason: "state unavailable for verification", success: false };
  }
  if (expectedOutcome === "movement-or-map-change") {
    const moved =
      beforeState.mapId !== afterState.mapId ||
      beforeState.position.x !== afterState.position.x ||
      beforeState.position.y !== afterState.position.y;
    return {
      reason: moved
        ? "RAM map/position changed after movement"
        : `no RAM movement after ${action.toolName}:${action.button}`,
      success: moved,
    };
  }
  if (expectedOutcome === "battle-progress") {
    return {
      reason:
        before.status.frame === after.status.frame
          ? "frame did not advance during battle action"
          : "frame advanced during battle action",
      success: before.status.frame !== after.status.frame,
    };
  }
  const progressed =
    beforeState.dialogueLike !== afterState.dialogueLike ||
    beforeState.menuLike !== afterState.menuLike ||
    beforeState.battle !== afterState.battle ||
    beforeState.mapId !== afterState.mapId ||
    beforeState.position.x !== afterState.position.x ||
    beforeState.position.y !== afterState.position.y;
  const confirmedUiAdvanced =
    (beforeState.dialogueLike === true || beforeState.menuLike === true) &&
    before.status.frame !== after.status.frame;
  return {
    reason:
      progressed || confirmedUiAdvanced
        ? "dialogue/menu/script RAM state changed or confirmed UI advanced"
        : `no dialogue/script progress after ${action.toolName}:${action.button}`,
    success: progressed || confirmedUiAdvanced,
  };
}

async function persistRunMetricsMetadata(): Promise<void> {
  const snapshot = runMetricsTracker.snapshot();
  if (
    snapshot.stuckEvents === runTrace.stuckEvents &&
    snapshot.supervisorInterventions === runTrace.supervisorInterventions
  ) {
    return;
  }

  runTrace = await updateRunTraceMetadata(runTrace, {
    stuckEvents: snapshot.stuckEvents,
    supervisorInterventions: snapshot.supervisorInterventions,
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
