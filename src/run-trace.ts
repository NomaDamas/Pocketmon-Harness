import {
  appendFile,
  mkdir,
  readFile,
  rename,
  rmdir,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import type { MgbaObservation } from "./observation";
import { detectPokemonPhase, type PokemonPhase } from "./phase-detector";
import type { PokemonStateReadStatus } from "./pokemon-state";
import type { MilestoneProgressMetricsBoundary } from "./run-metrics";

const TRACE_ROOT = ".pss-mgba/traces";
const ITERATION_COUNTER_PATH = join(TRACE_ROOT, "iteration-counter.json");
const ITERATION_COUNTER_LOCK_DIR = join(TRACE_ROOT, "iteration-counter.lock");
const ITERATIONS_JSONL_PATH = join(TRACE_ROOT, "iterations.jsonl");

export const EXPERIMENT_MODES = [
  "fresh",
  "resumed",
  "recovery",
  "deterministic-replay",
  "exploratory",
] as const;

export const SAVE_STATE_UNSUPPORTED_BY_CURRENT_MGBA_HTTP =
  "SAVE_STATE_UNSUPPORTED_BY_CURRENT_MGBA_HTTP" as const;

export type ExperimentMode = (typeof EXPERIMENT_MODES)[number];
export type SaveStateSupportStatus =
  | "supported"
  | typeof SAVE_STATE_UNSUPPORTED_BY_CURRENT_MGBA_HTTP;

export interface RuntimeGameStateEvidence {
  battle: boolean;
  evaluatorMilestone: string | null;
  evaluatorMilestoneCurrent: string | null;
  evaluatorMilestoneFurthest: string | null;
  mapId: number | null;
  phase: PokemonPhase;
  readStatus: PokemonStateReadStatus;
  source: "pokemon-red-ram";
  statusFrame: number | null;
  x: number | null;
  y: number | null;
}

export interface RunExperimentMetadata {
  blockedRepeatedActionsTotal?: number;
  currentPhase?: string;
  currentWaypoint?: string;
  experimentId?: string;
  latestImprovementStatus?: string;
  milestone?: string;
  milestoneCurrent?: string;
  milestoneFurthest?: string;
  milestoneProgress?: MilestoneProgressMetricsBoundary;
  mode: ExperimentMode;
  objective?: string;
  parallelBatchId?: string;
  parallelEndpointLabel?: string;
  parallelHypothesis?: string;
  parallelInstance?: string;
  ramReadStatus?: string;
  runBudget?: string;
  runtimeGameState?: RuntimeGameStateEvidence;
  saveStatePath?: string;
  saveStateStatus?: SaveStateSupportStatus;
  stateSource?: string;
  stopReason?: string;
  stuckEvents?: number;
  supervisorEnabled?: boolean;
  supervisorInterventions?: number;
  verificationFailuresTotal?: number;
  verificationSuccessesTotal?: number;
}

export interface RunTrace extends Partial<RunExperimentMetadata> {
  iteration: number;
  metricsDir: string;
  runId: string;
  startedAt: string;
}

export interface EvaluatorMilestoneState {
  current: string | null;
  furthest: string | null;
}

export const OPTIMIZED_FRESH_RUN_METADATA = {
  experimentId: "combined-optimized",
  mode: "fresh",
  objective:
    "Continue playing the already-loaded Pokemon game autonomously without reset, reload, or restart.",
  runBudget: "300s",
  stateSource: "already-running-mgba-http",
  stuckEvents: 0,
  supervisorEnabled: true,
  supervisorInterventions: 0,
} satisfies RunExperimentMetadata;

interface IterationCounter {
  nextIteration: number;
}

export async function createRunTrace(
  now = new Date(),
  metadata?: RunExperimentMetadata
): Promise<RunTrace> {
  await mkdir(TRACE_ROOT, { recursive: true });

  const iteration = await allocateIteration();

  const startedAt = now.toISOString();
  const runId = `${iteration.toString().padStart(5, "0")}-${startedAt.replaceAll(/[:.]/g, "-")}`;
  const metricsDir = join(TRACE_ROOT, "runs", runId);
  await mkdir(metricsDir, { recursive: true });

  const trace = {
    iteration,
    metricsDir,
    runId,
    startedAt,
    ...(metadata ? validateRunExperimentMetadata(metadata) : {}),
  } satisfies RunTrace;
  await appendFile(
    ITERATIONS_JSONL_PATH,
    `${JSON.stringify({ schemaVersion: 2, type: "run-start", ...trace })}
`
  );
  await writeFile(
    join(metricsDir, "run.json"),
    `${JSON.stringify(trace, null, 2)}
`
  );

  return trace;
}

export async function createOptimizedFreshRunTrace(
  now = new Date()
): Promise<RunTrace> {
  return await createRunTrace(now, {
    ...OPTIMIZED_FRESH_RUN_METADATA,
    experimentId:
      process.env.EXPERIMENT_ID ?? OPTIMIZED_FRESH_RUN_METADATA.experimentId,
    parallelBatchId: process.env.PARALLEL_BATCH_ID,
    parallelEndpointLabel: process.env.POKEMON_PARALLEL_ENDPOINT_LABEL,
    parallelHypothesis: process.env.EXPERIMENT_HYPOTHESIS,
    parallelInstance: process.env.POKEMON_RUN_INSTANCE,
  });
}

export async function updateRunTraceMetadata(
  trace: RunTrace,
  metadata: Partial<RunExperimentMetadata>
): Promise<RunTrace> {
  const next = {
    ...trace,
    ...metadata,
    ...(metadata.runtimeGameState && metadata.currentPhase === undefined
      ? { currentPhase: metadata.runtimeGameState.phase }
      : {}),
  } satisfies RunTrace;
  validateRuntimeGameStateEvaluatorMilestone(next);
  await writeFile(
    join(trace.metricsDir, "run.json"),
    `${JSON.stringify(next, null, 2)}
`
  );
  return next;
}

export function validateRunExperimentMetadata(
  metadata: RunExperimentMetadata
): RunExperimentMetadata {
  if (!EXPERIMENT_MODES.includes(metadata.mode)) {
    throw new Error(`Invalid experiment mode: ${String(metadata.mode)}`);
  }
  if (
    metadata.saveStateStatus === "supported" &&
    (metadata.mode === "recovery" ||
      metadata.mode === "deterministic-replay") &&
    !metadata.saveStatePath
  ) {
    throw new Error(
      `saveStatePath is required for ${metadata.mode} when save-state support is available`
    );
  }
  if (
    metadata.saveStateStatus === SAVE_STATE_UNSUPPORTED_BY_CURRENT_MGBA_HTTP &&
    metadata.saveStatePath
  ) {
    throw new Error(
      "saveStatePath must be omitted when save-state is unsupported by current mGBA-http"
    );
  }
  validateRuntimeGameStateEvaluatorMilestone(metadata);
  return withRuntimeGameStatePhase(metadata);
}

function validateRuntimeGameStateEvaluatorMilestone(
  metadata: Partial<RunExperimentMetadata>
): void {
  if (!metadata.runtimeGameState) {
    return;
  }

  const runtimeGameState =
    metadata.runtimeGameState as Partial<RuntimeGameStateEvidence>;
  requireRuntimeGameStateField(runtimeGameState, "evaluatorMilestone");
  requireRuntimeGameStateField(runtimeGameState, "evaluatorMilestoneCurrent");
  requireRuntimeGameStateField(runtimeGameState, "evaluatorMilestoneFurthest");
  requireRuntimeGameStateField(runtimeGameState, "phase");
  requireRuntimeGameStateField(runtimeGameState, "readStatus");
  requireRuntimeGameStateField(runtimeGameState, "mapId");
  requireRuntimeGameStateField(runtimeGameState, "x");
  requireRuntimeGameStateField(runtimeGameState, "y");
  requireRuntimeGameStateField(runtimeGameState, "battle");

  const expectedMilestone =
    metadata.milestoneFurthest ?? metadata.milestoneCurrent;
  if (
    expectedMilestone !== undefined &&
    runtimeGameState.evaluatorMilestone !== expectedMilestone
  ) {
    throw new Error(
      `runtimeGameState.evaluatorMilestone must match evaluator milestone metadata: expected ${expectedMilestone}, got ${String(runtimeGameState.evaluatorMilestone)}`
    );
  }

  if (
    metadata.milestoneCurrent !== undefined &&
    runtimeGameState.evaluatorMilestoneCurrent !== metadata.milestoneCurrent
  ) {
    throw new Error(
      `runtimeGameState.evaluatorMilestoneCurrent must match evaluator milestone metadata: expected ${metadata.milestoneCurrent}, got ${String(runtimeGameState.evaluatorMilestoneCurrent)}`
    );
  }
  if (
    metadata.milestoneFurthest !== undefined &&
    runtimeGameState.evaluatorMilestoneFurthest !== metadata.milestoneFurthest
  ) {
    throw new Error(
      `runtimeGameState.evaluatorMilestoneFurthest must match evaluator milestone metadata: expected ${metadata.milestoneFurthest}, got ${String(runtimeGameState.evaluatorMilestoneFurthest)}`
    );
  }
}

function requireRuntimeGameStateField(
  runtimeGameState: Partial<RuntimeGameStateEvidence>,
  field: keyof RuntimeGameStateEvidence
): void {
  if (
    !Object.hasOwn(runtimeGameState, field) ||
    runtimeGameState[field] === undefined
  ) {
    throw new Error(
      `runtimeGameState.${field} is required for RAM evidence records`
    );
  }
}

function withRuntimeGameStatePhase<T extends Partial<RunExperimentMetadata>>(
  metadata: T
): T {
  if (!metadata.runtimeGameState || metadata.currentPhase !== undefined) {
    return metadata;
  }
  return {
    ...metadata,
    currentPhase: metadata.runtimeGameState.phase,
  };
}

export function createRuntimeGameStateEvidence(
  observation: Pick<MgbaObservation, "state" | "status">,
  evaluatorMilestone: string | EvaluatorMilestoneState | null
): RuntimeGameStateEvidence | undefined {
  const state = observation.state;
  if (!state) {
    return;
  }
  const milestoneState = normalizeEvaluatorMilestoneState(evaluatorMilestone);

  return {
    battle: state.battle,
    evaluatorMilestone: milestoneState.furthest ?? milestoneState.current,
    evaluatorMilestoneCurrent: milestoneState.current,
    evaluatorMilestoneFurthest: milestoneState.furthest,
    mapId: state.mapId,
    phase: detectPokemonPhase({ observation }).phase,
    readStatus: state.readStatus,
    source: "pokemon-red-ram",
    statusFrame:
      typeof observation.status.frame === "number"
        ? observation.status.frame
        : null,
    x: state.position.x,
    y: state.position.y,
  };
}

function normalizeEvaluatorMilestoneState(
  evaluatorMilestone: string | EvaluatorMilestoneState | null
): EvaluatorMilestoneState {
  if (
    evaluatorMilestone &&
    typeof evaluatorMilestone === "object" &&
    "current" in evaluatorMilestone &&
    "furthest" in evaluatorMilestone
  ) {
    return {
      current: evaluatorMilestone.current,
      furthest: evaluatorMilestone.furthest,
    };
  }
  return {
    current: evaluatorMilestone,
    furthest: evaluatorMilestone,
  };
}

async function readIterationCounter(): Promise<IterationCounter> {
  try {
    const raw = await readFile(ITERATION_COUNTER_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<IterationCounter>;
    if (
      typeof parsed.nextIteration === "number" &&
      Number.isInteger(parsed.nextIteration) &&
      parsed.nextIteration > 0
    ) {
      return { nextIteration: parsed.nextIteration };
    }
  } catch (error) {
    if (!(error instanceof Error && hasCode(error, "ENOENT"))) {
      throw error;
    }
  }

  return { nextIteration: 1 };
}

async function allocateIteration(): Promise<number> {
  return await withIterationCounterLock(async () => {
    const counter = await readIterationCounter();
    const iteration = counter.nextIteration;
    await writeIterationCounter({
      nextIteration: iteration + 1,
    });
    return iteration;
  });
}

async function writeIterationCounter(counter: IterationCounter): Promise<void> {
  const tempPath = `${ITERATION_COUNTER_PATH}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(counter)}\n`);
  await rename(tempPath, ITERATION_COUNTER_PATH);
}

async function withIterationCounterLock<T>(run: () => Promise<T>): Promise<T> {
  await acquireIterationCounterLock();
  try {
    return await run();
  } finally {
    await rmdir(ITERATION_COUNTER_LOCK_DIR).catch(() => undefined);
  }
}

async function acquireIterationCounterLock(): Promise<void> {
  const startedAt = Date.now();
  while (true) {
    try {
      await mkdir(ITERATION_COUNTER_LOCK_DIR);
      return;
    } catch (error) {
      if (!(error instanceof Error && hasCode(error, "EEXIST"))) {
        throw error;
      }
      if (Date.now() - startedAt > 10_000) {
        throw new Error("Timed out waiting for trace iteration counter lock");
      }
      await sleep(20);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hasCode(error: Error, code: string): boolean {
  return (error as Error & { code?: unknown }).code === code;
}
