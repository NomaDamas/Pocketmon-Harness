import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

const TRACE_ROOT = ".pss-mgba/traces";
const RUNS_DIR = join(TRACE_ROOT, "runs");

export interface TuiActionSummary {
  count: number;
  lastInput: unknown;
  lastToolName?: string;
}

export interface TuiDashboardState {
  actions: TuiActionSummary;
  assistantReasoning?: string;
  events: {
    agent: number;
    observations: number;
    total: number;
  };
  lastEventAt?: string;
  lastFrame?: number;
  lastMap?: number;
  lastPosition?: {
    x?: number;
    y?: number;
  };
  macroProgress: TuiMacroProgress;
  modelId?: string;
  run: {
    experimentId?: string;
    milestone?: string;
    mode?: string;
    objective?: string;
    runId: string;
    startedAt?: string;
  };
  supervisorInterventions: number;
  tokenUsage?: {
    inputTokens?: number;
    outputTokens?: number;
    reasoningTokens?: number;
    step?: number;
    totalTokens?: number;
    turn?: number;
  };
}

export interface TuiMacroProgress {
  confidence: number;
  gaps: string[];
  health: "healthy" | "watch" | "blocked";
  phaseId: string;
  phaseIndex: number;
  phaseLabel: string;
  progress: number;
  signals: string[];
  totalPhases: number;
}

interface LoadTuiDashboardStateOptions {
  runId?: string;
  traceRoot?: string;
}

interface RunMetadata {
  experimentId?: string;
  milestone?: string;
  mode?: string;
  objective?: string;
  runId?: string;
  startedAt?: string;
}

interface JsonRecord {
  [key: string]: unknown;
}

export async function loadTuiDashboardState({
  runId,
  traceRoot = TRACE_ROOT,
}: LoadTuiDashboardStateOptions = {}): Promise<TuiDashboardState> {
  const resolvedRunId = runId ?? (await findLatestRunId(traceRoot));
  const runDir = join(traceRoot, "runs", resolvedRunId);
  const run = await readJsonFile<RunMetadata>(join(runDir, "run.json"));
  const eventRecords = await readJsonl(join(runDir, "events.jsonl"));
  const tokenRecords = await readJsonl(join(runDir, "token-usage.jsonl"));

  const state: TuiDashboardState = {
    actions: {
      count: 0,
      lastInput: undefined,
      lastToolName: undefined,
    },
    events: {
      agent: 0,
      observations: 0,
      total: eventRecords.length,
    },
    macroProgress: createEmptyMacroProgress(),
    run: {
      experimentId: run.experimentId,
      milestone: run.milestone,
      mode: run.mode,
      objective: run.objective,
      runId: run.runId ?? resolvedRunId,
      startedAt: run.startedAt,
    },
    supervisorInterventions: 0,
  };

  for (const record of eventRecords) {
    applyEventRecord(state, record);
  }

  const tokenRecord = lastRecord(tokenRecords);
  if (tokenRecord) {
    applyTokenRecord(state, tokenRecord);
  }
  state.macroProgress = computeMacroProgress(state);

  return state;
}

export async function findLatestRunId(traceRoot = TRACE_ROOT): Promise<string> {
  const runsDir = join(traceRoot, "runs");
  const entries = await readdir(runsDir);
  const runIds = (
    await Promise.all(
      entries.map(async (entry) => {
        const entryStat = await stat(join(runsDir, entry));
        return entryStat.isDirectory() ? entry : undefined;
      })
    )
  ).filter((entry): entry is string => typeof entry === "string");

  runIds.sort();
  const latest = runIds.at(-1);
  if (!latest) {
    throw new Error(`No trace runs found in ${runsDir}`);
  }
  return latest;
}

function applyEventRecord(state: TuiDashboardState, record: JsonRecord): void {
  if (typeof record.timestamp === "string") {
    state.lastEventAt = record.timestamp;
  }

  if (record.type === "observation") {
    state.events.observations += 1;
    applyObservationRecord(state, record);
    return;
  }

  if (record.type !== "agent-event") {
    return;
  }

  state.events.agent += 1;
  const summary = asRecord(record.summary);
  if (!summary) {
    return;
  }

  if (summary.kind === "action_tool_call") {
    state.actions.count += 1;
    state.actions.lastInput = summary.input;
    if (typeof summary.toolName === "string") {
      state.actions.lastToolName = summary.toolName;
    }
    return;
  }

  if (summary.kind === "supervisor_intervention") {
    state.supervisorInterventions += 1;
    return;
  }

  if (
    summary.kind === "assistant_reasoning" &&
    typeof summary.text === "string"
  ) {
    state.assistantReasoning = compactText(summary.text);
  }
}

function applyObservationRecord(
  state: TuiDashboardState,
  record: JsonRecord
): void {
  const status = asRecord(record.status);
  if (typeof status?.frame === "number") {
    state.lastFrame = status.frame;
  }

  const pokemonState = asRecord(record.pokemonState);
  if (!pokemonState) {
    return;
  }

  if (typeof pokemonState.mapId === "number") {
    state.lastMap = pokemonState.mapId;
  }

  const position = asRecord(pokemonState.position);
  if (position) {
    state.lastPosition = {
      x: typeof position.x === "number" ? position.x : undefined,
      y: typeof position.y === "number" ? position.y : undefined,
    };
  }
}

function applyTokenRecord(state: TuiDashboardState, record: JsonRecord): void {
  const usage = asRecord(record.usage);
  if (!usage) {
    return;
  }

  state.modelId =
    typeof record.modelId === "string" ? record.modelId : undefined;
  state.tokenUsage = {
    inputTokens:
      typeof usage.inputTokens === "number" ? usage.inputTokens : undefined,
    outputTokens:
      typeof usage.outputTokens === "number" ? usage.outputTokens : undefined,
    reasoningTokens:
      typeof usage.reasoningTokens === "number"
        ? usage.reasoningTokens
        : undefined,
    step: typeof record.step === "number" ? record.step : undefined,
    totalTokens:
      typeof usage.totalTokens === "number" ? usage.totalTokens : undefined,
    turn: typeof record.turn === "number" ? record.turn : undefined,
  };
}

async function readJsonFile<T>(path: string): Promise<T> {
  const raw = await readFile(path, "utf8");
  return JSON.parse(raw) as T;
}

async function readJsonl(path: string): Promise<JsonRecord[]> {
  try {
    const raw = await readFile(path, "utf8");
    return raw
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as JsonRecord);
  } catch (error) {
    if (error instanceof Error && hasCode(error, "ENOENT")) {
      return [];
    }
    throw error;
  }
}

function asRecord(value: unknown): JsonRecord | undefined {
  return typeof value === "object" && value !== null
    ? (value as JsonRecord)
    : undefined;
}

function compactText(text: string): string {
  return text.replaceAll(/\s+/g, " ").trim();
}

function hasCode(error: Error, code: string): boolean {
  return (error as Error & { code?: unknown }).code === code;
}

function lastRecord(records: JsonRecord[]): JsonRecord | undefined {
  return records.at(-1);
}

const MACRO_PHASES = [
  {
    id: "runtime-ready",
    label: "Runtime ready",
  },
  {
    id: "model-loop-active",
    label: "Model loop active",
  },
  {
    id: "observation-grounded",
    label: "Observation grounded",
  },
  {
    id: "first-battle-detected",
    label: "First battle detected",
  },
  {
    id: "first-battle-completed",
    label: "First battle completed",
  },
  {
    id: "route-navigation-active",
    label: "Route navigation active",
  },
  {
    id: "viridian-reached",
    label: "Viridian reached",
  },
] as const;

function computeMacroProgress(state: TuiDashboardState): TuiMacroProgress {
  const reached = reachedMacroPhaseIds(state);
  const phaseIndex = Math.max(
    ...MACRO_PHASES.map((phase, index) => (reached.has(phase.id) ? index : -1))
  );
  const safePhaseIndex = Math.max(0, phaseIndex);
  const phase = MACRO_PHASES[safePhaseIndex] ?? MACRO_PHASES[0];
  const signals = macroSignals(state);
  const gaps = macroGaps(state, reached);
  const progress = (safePhaseIndex + 1) / MACRO_PHASES.length;
  const health = macroHealth(state, gaps);

  return {
    confidence: macroConfidence(state, signals),
    gaps,
    health,
    phaseId: phase.id,
    phaseIndex: safePhaseIndex + 1,
    phaseLabel: phase.label,
    progress,
    signals,
    totalPhases: MACRO_PHASES.length,
  };
}

function createEmptyMacroProgress(): TuiMacroProgress {
  return {
    confidence: 0,
    gaps: ["No trace data loaded yet."],
    health: "watch",
    phaseId: MACRO_PHASES[0].id,
    phaseIndex: 1,
    phaseLabel: MACRO_PHASES[0].label,
    progress: 1 / MACRO_PHASES.length,
    signals: [],
    totalPhases: MACRO_PHASES.length,
  };
}

function reachedMacroPhaseIds(state: TuiDashboardState): Set<string> {
  const reached = new Set<string>(["runtime-ready"]);
  const milestone = state.run.milestone;

  if (state.modelId || (state.tokenUsage?.step ?? 0) > 0) {
    reached.add("model-loop-active");
  }
  if (state.events.observations > 0 || state.lastFrame !== undefined) {
    reached.add("observation-grounded");
  }
  if (isMilestoneAtLeast(milestone, "first-battle-detected")) {
    reached.add("first-battle-detected");
  }
  if (isMilestoneAtLeast(milestone, "first-battle-completed")) {
    reached.add("first-battle-completed");
  }
  if (state.actions.count >= 3 && movementActionCountSignal(state) > 0) {
    reached.add("route-navigation-active");
  }
  if (milestone === "reach-viridian-city" || state.lastMap === 1) {
    reached.add("viridian-reached");
  }

  return reached;
}

function macroSignals(state: TuiDashboardState): string[] {
  const signals = [
    `events=${state.events.total}`,
    `observations=${state.events.observations}`,
    `actions=${state.actions.count}`,
  ];
  if (state.modelId) {
    signals.push(`model=${state.modelId}`);
  }
  if (state.run.milestone) {
    signals.push(`milestone=${state.run.milestone}`);
  }
  if (state.lastMap !== undefined) {
    signals.push(`map=${state.lastMap}`);
  }
  if (state.supervisorInterventions > 0) {
    signals.push(`supervisor=${state.supervisorInterventions}`);
  }
  return signals;
}

function macroGaps(
  state: TuiDashboardState,
  reached: ReadonlySet<string>
): string[] {
  const gaps: string[] = [];
  const missing = MACRO_PHASES.find((phase) => !reached.has(phase.id));
  if (missing) {
    gaps.push(`Next macro phase: ${missing.label}.`);
  }
  if (state.events.observations <= 1 && state.actions.count > 20) {
    gaps.push(
      "Trace observer has sparse observation events; live step observations are not persisted as viewer observations yet."
    );
  }
  if (state.supervisorInterventions > Math.max(20, state.actions.count)) {
    gaps.push(
      "Supervisor interventions are high relative to actions; inspect repeated settle waits or action loops."
    );
  }
  if (
    (state.tokenUsage?.totalTokens ?? 0) > 50_000 &&
    state.run.milestone !== "reach-viridian-city"
  ) {
    gaps.push(
      "Token budget is growing before Stage 1 victory; prefer rule/skill integration over direct LLM wandering."
    );
  }
  return gaps;
}

function macroHealth(
  state: TuiDashboardState,
  gaps: readonly string[]
): TuiMacroProgress["health"] {
  if (gaps.length >= 3) {
    return "blocked";
  }
  if (
    gaps.length > 0 ||
    state.supervisorInterventions > Math.max(20, state.actions.count)
  ) {
    return "watch";
  }
  return "healthy";
}

function macroConfidence(
  state: TuiDashboardState,
  signals: readonly string[]
): number {
  const score =
    (state.events.observations > 0 ? 0.25 : 0) +
    (state.modelId ? 0.2 : 0) +
    (state.actions.count > 0 ? 0.2 : 0) +
    (state.run.milestone ? 0.25 : 0) +
    (signals.length >= 5 ? 0.1 : 0);
  return Math.round(score * 100) / 100;
}

function movementActionCountSignal(state: TuiDashboardState): number {
  const input = asRecord(state.actions.lastInput);
  const button = input?.button;
  return ["Up", "Down", "Left", "Right"].includes(String(button)) ? 1 : 0;
}

const MILESTONE_ORDER = [
  "title-menu-handled",
  "new-game-started-or-resumed",
  "player-control-reached",
  "first-map-transition",
  "first-dialogue-completed",
  "first-battle-detected",
  "first-battle-completed",
  "first-pokemon-obtained",
  "reach-viridian-city",
] as const;

function isMilestoneAtLeast(
  current: string | undefined,
  target: (typeof MILESTONE_ORDER)[number]
): boolean {
  if (!current) {
    return false;
  }
  return (
    MILESTONE_ORDER.indexOf(current as never) >= MILESTONE_ORDER.indexOf(target)
  );
}

export const DEFAULT_TUI_TRACE_ROOT = TRACE_ROOT;
export const DEFAULT_TUI_RUNS_DIR = RUNS_DIR;
