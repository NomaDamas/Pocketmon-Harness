import { env } from "./env";
import { type MgbaButton, MgbaHttpClient } from "./mgba-http";
import { captureMgbaObservation, type MgbaObservation } from "./observation";
import type { PokemonStateObservation } from "./pokemon-state";
import { createRunTrace, updateRunTraceMetadata } from "./run-trace";
import { POKEMON_RED_STAGE1_MAP_IDS } from "./stage1-evaluator";
import { planStage1Path } from "./stage1-pathfinder";
import type { FailedMovementEdge, StuckMemorySnapshot } from "./stuck-memory";
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

interface AutopilotAction {
  button: MgbaButton;
  duration?: number;
  reason: string;
  toolName: "mgba_hold" | "mgba_tap";
}

interface MovementAttempt {
  action: string;
  context: string;
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
      recentRecoveryAttempts: [],
      stuckEvents: this.#stuckEvents,
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

  for (let step = 1; step <= maxSteps; step += 1) {
    const before = await captureMgbaObservation(client);
    await recorder.recordObservation(step, before);
    if (isViridian(before.state)) {
      trace = await updateRunTraceMetadata(trace, {
        milestone: "reach-viridian-city",
        milestoneCurrent: "reach-viridian-city",
        milestoneFurthest: "reach-viridian-city",
        ramReadStatus: before.state?.readStatus,
        stuckEvents: memory.snapshot().stuckEvents,
      });
      console.dir({ runId: trace.runId, step, type: "stage1-fast-victory" });
      return;
    }

    const action = chooseAction(before, memory.snapshot());
    await recorder.recordEvent(actionPlanEvent(step, action), { turn: step });
    await recorder.recordEvent(toolCallEvent(step, action), { turn: step });
    memory.beforeAction(before, action);
    const output =
      action.toolName === "mgba_hold"
        ? await client.hold(
            action.button,
            action.duration ?? MOVEMENT_HOLD_FRAMES
          )
        : await client.tap(action.button);
    await recorder.recordEvent(toolResultEvent(step, action, output), {
      turn: step,
    });
    await sleep(OBSERVATION_SETTLE_MS);
    const after = await captureMgbaObservation(client);
    memory.afterObservation(after);
    trace = await updateRunTraceMetadata(trace, {
      milestone: milestoneFromState(after.state),
      milestoneCurrent: milestoneFromState(after.state),
      milestoneFurthest: milestoneFromState(after.state),
      ramReadStatus: after.state?.readStatus,
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

function chooseAction(
  observation: MgbaObservation,
  stuckMemory: StuckMemorySnapshot
): AutopilotAction {
  const state = observation.state;
  if (!state || state.readStatus !== "available") {
    return {
      button: "A",
      reason: "RAM unavailable; advance visible state",
      toolName: "mgba_tap",
    };
  }
  if (state.battle || state.dialogueLike === true) {
    return {
      button: "A",
      reason: "battle/dialogue fallback",
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
    (state.position.x ?? 0) < 4 &&
    !blockedAtCurrentPosition(state, "Right", stuckMemory)
  ) {
    return holdAction(
      "Right",
      "Red house 2F bootstrap: step from the bedroom start tile toward the center lane."
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

function chooseRedHouse1fBootstrapAction(
  state: PokemonStateObservation,
  stuckMemory: StuckMemorySnapshot
): AutopilotAction {
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
  return {
    text: `<action_plan>fast deterministic step ${step}: ${action.reason}; execute ${action.toolName} ${action.button}</action_plan>`,
    type: "assistant",
  };
}

function toolCallEvent(step: number, action: AutopilotAction): unknown {
  return {
    input:
      action.toolName === "mgba_hold"
        ? { button: action.button, duration: action.duration }
        : { button: action.button },
    toolCallId: `fast-${step}`,
    toolName: action.toolName,
    type: "tool-call",
  };
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
): string | undefined {
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
