import {
  chooseBattlePolicyAction,
  selectBasicBattlePolicyForRivalEncounter,
} from "./battle-policy";
import { env } from "./env";
import { type MgbaButton, MgbaHttpClient } from "./mgba-http";
import { captureMgbaObservation, type MgbaObservation } from "./observation";
import type { PokemonStateObservation } from "./pokemon-state";
import {
  createRunTrace,
  createRuntimeGameStateEvidence,
  type EvaluatorMilestoneState,
  updateRunTraceMetadata,
} from "./run-trace";
import { POKEMON_RED_STAGE1_MAP_IDS } from "./stage1-evaluator";
import { planStage1Path } from "./stage1-pathfinder";
import type { FailedMovementEdge, StuckMemorySnapshot } from "./stuck-memory";
import {
  createSupervisorEvent,
  type SupervisorIntervention,
  waitForPostActionSettle,
} from "./supervisor";
import { createViewerEventRecorder } from "./viewer-recorder";

const DEFAULT_MAX_STEPS = 240;
const MOVEMENT_HOLD_FRAMES = parsePositiveInt(
  process.env.STAGE1_FAST_MOVEMENT_FRAMES,
  10
);
const OBSERVATION_SETTLE_MS = parsePositiveInt(
  process.env.STAGE1_FAST_SETTLE_MS,
  45
);
const STUCK_ATTEMPT_THRESHOLD = 3;
const MAX_FAILED_EDGES = 12;
const FAST_MILESTONE_RANKS = new Map<string, number>([
  ["ram-unavailable", 0],
  ["pallet-town", 2],
  ["route-1", 3],
  ["reach-viridian-city", 4],
]);

export interface AutopilotAction {
  button: MgbaButton;
  buttons?: readonly MgbaButton[];
  duration?: number;
  reason: string;
  toolName: "mgba_hold" | "mgba_tap";
}

export interface ChooseStage1FastActionOptions {
  unknownFallback?: "llm" | "probe";
}

interface MovementAttempt {
  action: string;
  context: string;
}

interface FastEventRecorder {
  recordEvent(event: unknown, context: { turn: number }): Promise<void>;
}

class FastBacktrackingMemory {
  readonly #failedEdges = new Map<string, FailedMovementEdge>();
  #lastAttempt: MovementAttempt | undefined;
  #stuckEvents = 0;

  beforeAction(observation: MgbaObservation, action: AutopilotAction): void {
    if (action.toolName !== "mgba_hold") {
      this.#lastAttempt = undefined;
      return;
    }
    const context = contextFromState(observation.state);
    this.#lastAttempt = context
      ? {
          action: `hold:${action.button}`,
          context,
        }
      : undefined;
  }

  afterObservation(observation: MgbaObservation): void {
    const attempt = this.#lastAttempt;
    this.#lastAttempt = undefined;
    if (!attempt) {
      return;
    }
    const nextContext = contextFromState(observation.state);
    if (nextContext !== attempt.context) {
      return;
    }

    const key = `${attempt.context}|${attempt.action}`;
    const previous = this.#failedEdges.get(key);
    const attempts = (previous?.attempts ?? 0) + 1;
    if (attempts === STUCK_ATTEMPT_THRESHOLD) {
      this.#stuckEvents += 1;
    }
    this.#failedEdges.delete(key);
    this.#failedEdges.set(key, {
      action: attempt.action,
      attempts,
      context: attempt.context,
      lastSeenTurn: attempts,
    });
    while (this.#failedEdges.size > MAX_FAILED_EDGES) {
      const oldest = this.#failedEdges.keys().next().value;
      if (!oldest) {
        return;
      }
      this.#failedEdges.delete(oldest);
    }
  }

  snapshot(): StuckMemorySnapshot {
    return {
      failedMovementEdges: [...this.#failedEdges.values()],
      repeatedStateContexts: [],
      recentRecoveryAttempts: [],
      stuckEvents: this.#stuckEvents,
    };
  }
}

class FastMilestoneTracker {
  #furthest: string | null = null;

  observe(state: PokemonStateObservation | undefined): EvaluatorMilestoneState {
    const current = milestoneFromState(state);
    if (isFastMilestoneAfter(current, this.#furthest)) {
      this.#furthest = current;
    }
    return {
      current,
      furthest: this.#furthest,
    };
  }
}

if (isMainModule()) {
  await runStage1FastAutopilot();
}

export async function runStage1FastAutopilot({
  maxSteps = parseMaxSteps(process.env.STAGE1_FAST_MAX_STEPS),
}: {
  maxSteps?: number;
} = {}): Promise<void> {
  const client = new MgbaHttpClient({ baseUrl: env.MGBA_HTTP_BASE_URL });
  let trace = await createRunTrace(new Date(), {
    experimentId: process.env.EXPERIMENT_ID ?? "stage1-fast-autopilot",
    mode: "deterministic-replay",
    objective:
      "Reach Viridian City using RAM route knowledge, Dijkstra pathfinding, and local backtracking without LLM calls.",
    runBudget: `${maxSteps} fast steps`,
    stateSource: "already-running-mgba-http",
    stuckEvents: 0,
    supervisorEnabled: false,
    supervisorInterventions: 0,
  });
  const recorder = createViewerEventRecorder({ trace });
  const memory = new FastBacktrackingMemory();
  const milestoneTracker = new FastMilestoneTracker();

  for (let step = 1; step <= maxSteps; step += 1) {
    const before = await captureMgbaObservation(client);
    await recorder.recordObservation(step, before);
    const beforeMilestone = milestoneTracker.observe(before.state);
    const beforeRuntimeGameState = createRuntimeGameStateEvidence(
      before,
      beforeMilestone
    );
    if (isViridian(before.state)) {
      trace = await updateRunTraceMetadata(trace, {
        milestone: beforeMilestone.furthest ?? "reach-viridian-city",
        milestoneCurrent: beforeMilestone.current ?? "reach-viridian-city",
        milestoneFurthest: beforeMilestone.furthest ?? "reach-viridian-city",
        ...(beforeRuntimeGameState
          ? {
              ramReadStatus: beforeRuntimeGameState.readStatus,
              runtimeGameState: beforeRuntimeGameState,
            }
          : {}),
        stuckEvents: memory.snapshot().stuckEvents,
      });
      console.dir({ runId: trace.runId, step, type: "stage1-fast-victory" });
      return;
    }

    const action = chooseStage1FastAction(before, memory.snapshot()) ?? {
      button: "A",
      reason: "standalone fallback probe",
      toolName: "mgba_tap",
    };
    await recorder.recordEvent(actionPlanEvent(step, action), { turn: step });
    await recorder.recordEvent(toolCallEvent(step, action), { turn: step });
    memory.beforeAction(before, action);
    await executeFastActionWithSettle({
      action,
      client,
      recorder,
      step,
    });
    const after = await captureMgbaObservation(client);
    memory.afterObservation(after);
    const afterMilestone = milestoneTracker.observe(after.state);
    const afterRuntimeGameState = createRuntimeGameStateEvidence(
      after,
      afterMilestone
    );
    trace = await updateRunTraceMetadata(trace, {
      milestone: afterMilestone.furthest ?? undefined,
      milestoneCurrent: afterMilestone.current ?? undefined,
      milestoneFurthest: afterMilestone.furthest ?? undefined,
      ...(afterRuntimeGameState
        ? {
            ramReadStatus: afterRuntimeGameState.readStatus,
            runtimeGameState: afterRuntimeGameState,
          }
        : {}),
      stuckEvents: memory.snapshot().stuckEvents,
    });
    console.dir({
      action: action.button,
      mapId: after.state?.mapId,
      runId: trace.runId,
      step,
      stuckEvents: memory.snapshot().stuckEvents,
      type: "stage1-fast-step",
      x: after.state?.position.x,
      y: after.state?.position.y,
    });
  }
}

async function executeFastActionWithSettle({
  action,
  client,
  recorder,
  step,
}: {
  action: AutopilotAction;
  client: MgbaHttpClient;
  recorder: FastEventRecorder;
  step: number;
}): Promise<void> {
  const settleInterventions: SupervisorIntervention[] = [];
  const outputs: string[] = [];

  if (action.toolName === "mgba_hold") {
    outputs.push(
      await client.hold(action.button, action.duration ?? MOVEMENT_HOLD_FRAMES)
    );
    await sleep(OBSERVATION_SETTLE_MS);
  } else {
    const buttons = action.buttons?.length ? action.buttons : [action.button];
    for (const button of buttons) {
      const settleStartFrame =
        button === "A" ? (await client.status()).frame : undefined;
      outputs.push(await client.tap(button));
      if (button === "A") {
        await waitForPostActionSettle({
          client,
          onIntervention: (intervention) => {
            settleInterventions.push(intervention);
          },
          startFrame: settleStartFrame,
        });
      } else {
        await sleep(OBSERVATION_SETTLE_MS);
      }
    }
  }
  await recorder.recordEvent(
    toolResultEvent(step, action, outputs.join("\n")),
    {
      turn: step,
    }
  );
  for (const intervention of settleInterventions) {
    await recorder.recordEvent(createSupervisorEvent(intervention), {
      turn: step,
    });
  }
}

export function chooseStage1FastAction(
  observation: MgbaObservation,
  stuckMemory: StuckMemorySnapshot,
  { unknownFallback = "probe" }: ChooseStage1FastActionOptions = {}
): AutopilotAction | undefined {
  const state = observation.state;
  if (!state || state.readStatus !== "available") {
    if (unknownFallback === "llm") {
      return;
    }
    return {
      button: "A",
      reason: "RAM unavailable; advance visible state",
      toolName: "mgba_tap",
    };
  }
  if (isViridian(state)) {
    return;
  }
  if (state.battle) {
    const battleAction = chooseBattlePolicyAction({
      battlePolicy: selectBasicBattlePolicyForRivalEncounter(),
      runtimeGameState: state,
    });
    if (!battleAction) {
      return;
    }
    return {
      button: battleAction.buttons[0],
      buttons: battleAction.buttons,
      reason: battleAction.reason,
      toolName: "mgba_tap",
    };
  }
  if (state.dialogueLike === true) {
    return {
      button: "A",
      reason: "dialogue fallback",
      toolName: "mgba_tap",
    };
  }
  if (state.menuLike === true) {
    return {
      button: "B",
      reason: "close menu-like state",
      toolName: "mgba_tap",
    };
  }
  const bootstrap = chooseHouseBootstrapAction(state, stuckMemory);
  if (bootstrap) {
    return bootstrap;
  }
  const plan = planStage1Path({ state, stuckMemory });
  if (!plan) {
    if (unknownFallback === "llm") {
      return;
    }
    return {
      button: "A",
      reason: "no path plan; probe interaction",
      toolName: "mgba_tap",
    };
  }
  if (plan.action === "A") {
    return { button: "A", reason: plan.reason, toolName: "mgba_tap" };
  }
  return {
    button: plan.action,
    duration: MOVEMENT_HOLD_FRAMES,
    reason: plan.reason,
    toolName: "mgba_hold",
  };
}

function chooseHouseBootstrapAction(
  state: PokemonStateObservation,
  stuckMemory: StuckMemorySnapshot
): AutopilotAction | undefined {
  if (state.mapId === 38) {
    return chooseRedHouse2fBootstrapAction(state, stuckMemory);
  }

  if (state.mapId === 37) {
    return chooseRedHouse1fBootstrapAction(state, stuckMemory);
  }

  return;
}

function chooseRedHouse2fBootstrapAction(
  state: PokemonStateObservation,
  stuckMemory: StuckMemorySnapshot
): AutopilotAction {
  if (shouldEscapeLeftWallStairApproach(state, stuckMemory)) {
    return holdAction(
      "Right",
      "Red house 2F bootstrap: escape the blocked left-wall stair approach before resuming the bedroom route."
    );
  }
  if (
    (state.position.x ?? 99) <= 3 &&
    (state.position.y ?? 99) < 7 &&
    !blockedAtCurrentPosition(state, "Down", stuckMemory)
  ) {
    return holdAction(
      "Down",
      "Red house 2F bootstrap: avoid the SNES/TV lane and move down toward the stair corner."
    );
  }
  if (
    (state.position.y ?? 0) >= 7 &&
    (state.position.x ?? 99) < 7 &&
    !blockedAtCurrentPosition(state, "Right", stuckMemory)
  ) {
    return holdAction(
      "Right",
      "Red house 2F bootstrap: cross right along the lower row toward the stair warp."
    );
  }
  if (
    blockedAtCurrentPosition(state, "Up", stuckMemory) &&
    !blockedAtCurrentPosition(state, "Right", stuckMemory)
  ) {
    return holdAction(
      "Right",
      "Red house 2F bootstrap: Up is blocked near the stair landing; step Right to use the stairs warp."
    );
  }
  if (
    (state.position.y ?? 99) > 1 &&
    !blockedAtCurrentPosition(state, "Up", stuckMemory)
  ) {
    return holdAction(
      "Up",
      "Red house 2F bootstrap: walk north to the stair landing before leaving the bedroom."
    );
  }
  if (
    (state.position.x ?? 0) < 7 &&
    !blockedAtCurrentPosition(state, "Right", stuckMemory)
  ) {
    return holdAction(
      "Right",
      "Red house 2F bootstrap: move east along the north row toward the stairs warp."
    );
  }
  if (!blockedAtCurrentPosition(state, "Left", stuckMemory)) {
    return holdAction(
      "Left",
      "Red house 2F bootstrap: backtrack from a blocked bedroom lane and re-align."
    );
  }
  return {
    button: "A",
    reason: "Red house 2F bootstrap exhausted movement probes; interact once.",
    toolName: "mgba_tap",
  };
}

function shouldEscapeLeftWallStairApproach(
  state: PokemonStateObservation,
  stuckMemory: StuckMemorySnapshot
): boolean {
  return (
    (state.position.x ?? 99) <= 0 &&
    (state.position.y ?? 0) >= 4 &&
    !blockedAtCurrentPosition(state, "Right", stuckMemory)
  );
}

function chooseRedHouse1fBootstrapAction(
  state: PokemonStateObservation,
  stuckMemory: StuckMemorySnapshot
): AutopilotAction {
  if (
    (state.position.y ?? 99) <= 3 &&
    (state.position.x ?? 99) > 3 &&
    !blockedAtCurrentPosition(state, "Left", stuckMemory)
  ) {
    return holdAction(
      "Left",
      "Red house 1F bootstrap: align left on the upper floor row before descending toward the front door."
    );
  }
  if (
    (state.position.y ?? 0) < 6 &&
    !blockedAtCurrentPosition(state, "Down", stuckMemory)
  ) {
    return holdAction(
      "Down",
      "Red house 1F bootstrap: descend from the stairs toward the front door row."
    );
  }
  if (
    (state.position.x ?? 99) > 3 &&
    !blockedAtCurrentPosition(state, "Left", stuckMemory)
  ) {
    return holdAction(
      "Left",
      "Red house 1F bootstrap: move left toward the front door column."
    );
  }
  if (!blockedAtCurrentPosition(state, "Down", stuckMemory)) {
    return holdAction(
      "Down",
      "Red house 1F bootstrap: walk through the front door to Pallet Town."
    );
  }
  return {
    button: "A",
    reason:
      "Red house bootstrap exhausted local movement; probe interaction once before re-observing.",
    toolName: "mgba_tap",
  };
}

function holdAction(button: MgbaButton, reason: string): AutopilotAction {
  return {
    button,
    duration: MOVEMENT_HOLD_FRAMES,
    reason,
    toolName: "mgba_hold",
  };
}

function blockedAtCurrentPosition(
  state: PokemonStateObservation,
  button: MgbaButton,
  stuckMemory: StuckMemorySnapshot
): boolean {
  return stuckMemory.failedMovementEdges.some(
    (edge) =>
      edge.attempts >= STUCK_ATTEMPT_THRESHOLD &&
      edge.action === `hold:${button}` &&
      edge.context.includes(`map=${state.mapId}`) &&
      edge.context.includes(`x=${state.position.x}`) &&
      edge.context.includes(`y=${state.position.y}`)
  );
}

function actionPlanEvent(step: number, action: AutopilotAction): unknown {
  const buttons =
    action.toolName === "mgba_tap" && action.buttons?.length
      ? action.buttons.join(" -> ")
      : action.button;
  return {
    text: `<action_plan>fast deterministic step ${step}: ${action.reason}; execute ${action.toolName} ${buttons}</action_plan>`,
    type: "assistant",
  };
}

function toolCallEvent(step: number, action: AutopilotAction): unknown {
  const buttons = action.buttons?.length ? action.buttons : [action.button];
  const input =
    action.toolName === "mgba_hold"
      ? { button: action.button, duration: action.duration }
      : toolCallTapInput(action, buttons);
  return {
    input,
    toolCallId: `fast-${step}`,
    toolName: action.toolName,
    type: "tool-call",
  };
}

function toolCallTapInput(
  action: AutopilotAction,
  buttons: readonly MgbaButton[]
): { button: MgbaButton; buttons?: readonly MgbaButton[] } {
  if (buttons.length === 1) {
    return { button: action.button };
  }
  return { button: action.button, buttons };
}

function toolResultEvent(
  step: number,
  action: AutopilotAction,
  output: string
): unknown {
  return {
    output: { ok: true, output },
    toolCallId: `fast-${step}`,
    toolName: action.toolName,
    type: "tool-result",
  };
}

function contextFromState(
  state: PokemonStateObservation | undefined
): string | undefined {
  if (
    !state ||
    state.readStatus !== "available" ||
    state.mapId === null ||
    state.position.x === null ||
    state.position.y === null
  ) {
    return;
  }
  return `map=${state.mapId} x=${state.position.x} y=${state.position.y}`;
}

function isViridian(state: PokemonStateObservation | undefined): boolean {
  return (
    state?.readStatus === "available" &&
    state.mapId === POKEMON_RED_STAGE1_MAP_IDS.viridianCity
  );
}

function milestoneFromState(
  state: PokemonStateObservation | undefined
): string | null {
  if (!state || state.readStatus !== "available") {
    return "ram-unavailable";
  }
  if (state.mapId === POKEMON_RED_STAGE1_MAP_IDS.viridianCity) {
    return "reach-viridian-city";
  }
  if (state.mapId === POKEMON_RED_STAGE1_MAP_IDS.route1) {
    return "route-1";
  }
  if (state.mapId === POKEMON_RED_STAGE1_MAP_IDS.palletTown) {
    return "pallet-town";
  }
  return `map-${state.mapId}`;
}

function isFastMilestoneAfter(
  candidate: string | null,
  current: string | null
): boolean {
  if (!candidate) {
    return false;
  }
  if (!current) {
    return true;
  }
  return fastMilestoneRank(candidate) > fastMilestoneRank(current);
}

function fastMilestoneRank(milestone: string): number {
  if (milestone.startsWith("map-")) {
    return 1;
  }
  return FAST_MILESTONE_RANKS.get(milestone) ?? -1;
}

function parseMaxSteps(value: string | undefined): number {
  return parsePositiveInt(value, DEFAULT_MAX_STEPS);
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isMainModule(): boolean {
  return process.argv[1]?.endsWith("/stage1-fast-autopilot.ts") ?? false;
}
