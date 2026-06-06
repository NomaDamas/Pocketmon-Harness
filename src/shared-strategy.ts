import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { MgbaButton } from "./mgba-http";
import type { MgbaObservation } from "./observation";
import type { AutopilotAction } from "./stage1-fast-autopilot";

const DEFAULT_SHARED_STRATEGY_DIR = ".pss-mgba/shared-strategy";

export interface SharedStrategyMemoryOptions {
  batchId?: string;
  now?: () => Date;
  path?: string;
  runId: string;
}

export interface SharedStrategyActionRecord {
  action: {
    button: MgbaButton;
    duration?: number;
    toolName: "mgba_hold" | "mgba_tap";
  };
  batchId: string;
  createdAt: string;
  expectedOutcome?: string;
  phase: string;
  runId: string;
  stateKey: string;
  success: boolean;
  waypoint: string;
}

export interface SharedStrategySuggestion {
  action: AutopilotAction;
  evidenceCount: number;
  phase: string;
  reason: string;
  stateKey: string;
  waypoint: string;
}

export class SharedStrategyMemory {
  readonly #batchId?: string;
  readonly #now: () => Date;
  readonly #path: string;
  readonly #runId: string;

  constructor({
    batchId = process.env.PARALLEL_BATCH_ID,
    now = () => new Date(),
    path,
    runId,
  }: SharedStrategyMemoryOptions) {
    this.#batchId = batchId;
    this.#now = now;
    this.#path =
      path ??
      (batchId
        ? join(DEFAULT_SHARED_STRATEGY_DIR, `${safeFileName(batchId)}.jsonl`)
        : "");
    this.#runId = runId;
  }

  get enabled(): boolean {
    return Boolean(this.#batchId && this.#path);
  }

  async recordActionSuccess({
    action,
    before,
    expectedOutcome,
    phase,
    success,
    waypoint,
  }: {
    action: AutopilotAction;
    before: MgbaObservation;
    expectedOutcome?: string;
    phase: string;
    success: boolean;
    waypoint: string;
  }): Promise<void> {
    if (!(this.enabled && success)) {
      return;
    }
    if (!(action.toolName === "mgba_hold" || action.toolName === "mgba_tap")) {
      return;
    }
    const stateKey = observationStateKey(before);
    if (!stateKey) {
      return;
    }
    const record: SharedStrategyActionRecord = {
      action: {
        button: action.button,
        duration: action.duration,
        toolName: action.toolName,
      },
      batchId: this.#batchId ?? "unknown-batch",
      createdAt: this.#now().toISOString(),
      expectedOutcome,
      phase,
      runId: this.#runId,
      stateKey,
      success,
      waypoint,
    };
    await appendJsonl(this.#path, record);
  }

  async suggest(observation: MgbaObservation): Promise<SharedStrategySuggestion | undefined> {
    if (!this.enabled) {
      return;
    }
    const stateKey = observationStateKey(observation);
    if (!stateKey) {
      return;
    }
    const records = await readJsonl<SharedStrategyActionRecord>(this.#path);
    const matches = records.filter(
      (record) =>
        record.success &&
        record.stateKey === stateKey &&
        record.runId !== this.#runId
    );
    if (matches.length === 0) {
      return;
    }
    const grouped = new Map<string, SharedStrategyActionRecord[]>();
    for (const record of matches) {
      const key = JSON.stringify(record.action);
      grouped.set(key, [...(grouped.get(key) ?? []), record]);
    }
    const [bestKey, bestRecords] = [...grouped.entries()].sort(
      (left, right) =>
        right[1].length - left[1].length ||
        right[1].at(-1)!.createdAt.localeCompare(left[1].at(-1)!.createdAt)
    )[0] ?? [undefined, undefined];
    if (!(bestKey && bestRecords)) {
      return;
    }
    const action = JSON.parse(bestKey) as SharedStrategyActionRecord["action"];
    const latest = bestRecords.at(-1)!;
    return {
      action: {
        button: action.button,
        duration: action.duration,
        reason: `SharedStrategy: ${bestRecords.length} peer success record(s) for ${stateKey}; follow ${latest.runId}.`,
        toolName: action.toolName,
      },
      evidenceCount: bestRecords.length,
      phase: latest.phase,
      reason: `peer run ${latest.runId} reached waypoint=${latest.waypoint} from same RAM state`,
      stateKey,
      waypoint: latest.waypoint,
    };
  }
}

export function observationStateKey(observation: MgbaObservation): string | undefined {
  const state = observation.state;
  if (!state || state.readStatus !== "available" || state.mapId === null) {
    return;
  }
  const x = state.position.x;
  const y = state.position.y;
  if (x === null || y === null) {
    return;
  }
  return `map=${state.mapId};x=${x};y=${y};facing=${state.direction};battle=${state.battle ? "1" : "0"};dialogue=${state.dialogueLike ? "1" : "0"};menu=${state.menuLike ? "1" : "0"}`;
}

async function appendJsonl(path: string, record: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const previous = await readFile(path, "utf8").catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return "";
    }
    throw error;
  });
  await writeFile(path, `${previous}${JSON.stringify(record)}\n`);
}

async function readJsonl<T>(path: string): Promise<T[]> {
  const raw = await readFile(path, "utf8").catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return "";
    }
    throw error;
  });
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

function safeFileName(value: string): string {
  return value.replaceAll(/[^A-Za-z0-9._-]/g, "_");
}
