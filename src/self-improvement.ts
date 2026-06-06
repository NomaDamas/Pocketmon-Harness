import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  evaluateStage1RepeatedActionScore,
  type Stage1RepeatedActionHistoryEntry,
} from "./stage1-evaluator";
import { findLatestRunId } from "./tui-summary";

const DEFAULT_TRACE_ROOT = ".pss-mgba/traces";
const DEFAULT_OUTPUT_ROOT = ".pss-mgba/improvements";
const DIALOGUE_REASONING_PATTERN = /\b(dialogue|text|story|intro)\b/i;
const NAME_ENTRY_REASONING_PATTERN =
  /\b(name|keyboard|NEW NAME|RED|ASH|JACK|END)\b/i;
const PROGRESSING_REASONING_PATTERN =
  /\b(progress|progressing|continuing)\b|advanc|visible text change|text changes/i;

export interface TraceImprovementCandidate {
  audit: {
    createdAt: string;
    runId: string;
    source: "trace-self-improvement";
  };
  candidateId: string;
  evidence: string[];
  patch: {
    action: "avoid-no-progress-state" | "avoid-repeated-action";
    evaluatorGate: string;
    minimumFailures: number;
    recommendation: string;
  };
  status: "candidate";
}

export interface TraceImprovementResult {
  candidate?: TraceImprovementCandidate;
  outputPath?: string;
  runId: string;
  status:
    | "candidate-written"
    | "no-candidate"
    | "suppressed-progressing-dialogue";
}

interface ImproveLatestTraceOptions {
  now?: Date;
  outputRoot?: string;
  runId?: string;
  traceRoot?: string;
}

if (isMainModule()) {
  const result = await improveLatestTrace();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

export async function improveLatestTrace({
  now = new Date(),
  outputRoot = DEFAULT_OUTPUT_ROOT,
  runId,
  traceRoot = DEFAULT_TRACE_ROOT,
}: ImproveLatestTraceOptions = {}): Promise<TraceImprovementResult> {
  const resolvedRunId = runId ?? (await findLatestRunId(traceRoot));
  const trace = await loadTraceEvidence(traceRoot, resolvedRunId);
  const noProgressState = detectNoProgressState(trace);
  if (noProgressState && !isProgressingDialogue(trace)) {
    const candidate: TraceImprovementCandidate = {
      audit: {
        createdAt: now.toISOString(),
        runId: resolvedRunId,
        source: "trace-self-improvement",
      },
      candidateId: `candidate:${resolvedRunId}.avoid-no-progress-state`,
      evidence: [
        `sameState=${noProgressState.stateKey}`,
        `observationCount=${noProgressState.count}`,
        `uniqueActionCount=${noProgressState.uniqueActionCount}`,
        `actions=${noProgressState.actions.join(",")}`,
      ],
      patch: {
        action: "avoid-no-progress-state",
        evaluatorGate: "trace-self-improvement.no-progress-state",
        minimumFailures: 3,
        recommendation: noProgressRecommendation(trace),
      },
      status: "candidate",
    };
    return await writeCandidate(outputRoot, resolvedRunId, candidate);
  }

  const evaluation = evaluateStage1RepeatedActionScore({
    history: trace.actions,
    metadata: {
      evaluatorId: "trace-self-improvement.repeated-action",
      runId: resolvedRunId,
    },
    repetitionThreshold: 3,
    windowSize: 12,
  });

  if (evaluation.progressStatus !== "stuck") {
    return {
      runId: resolvedRunId,
      status: "no-candidate",
    };
  }

  if (isProgressingDialogue(trace)) {
    return {
      runId: resolvedRunId,
      status: "suppressed-progressing-dialogue",
    };
  }

  const repeatedAction = trace.actions.at(-1);
  const candidate: TraceImprovementCandidate = {
    audit: {
      createdAt: now.toISOString(),
      runId: resolvedRunId,
      source: "trace-self-improvement",
    },
    candidateId: `candidate:${resolvedRunId}.avoid-repeated-action`,
    evidence: evaluation.diagnostics.flatMap((diagnostic) => [
      diagnostic.message,
      ...(diagnostic.evidence ?? []),
    ]),
    patch: {
      action: "avoid-repeated-action",
      evaluatorGate: "evaluateStage1RepeatedActionScore",
      minimumFailures: 3,
      recommendation: repeatedAction?.toolName
        ? `Do not repeat ${repeatedAction.toolName} with the same input three or more times unless observation changes.`
        : "Do not repeat the same control action three or more times unless observation changes.",
    },
    status: "candidate",
  };
  return await writeCandidate(outputRoot, resolvedRunId, candidate);
}

interface TraceEvidence {
  actions: Stage1RepeatedActionHistoryEntry[];
  assistantReasoning: string[];
  observations: string[];
}

async function loadTraceEvidence(
  traceRoot: string,
  runId: string
): Promise<TraceEvidence> {
  const eventsPath = join(traceRoot, "runs", runId, "events.jsonl");
  const records = await readJsonl(eventsPath);
  const actions: Stage1RepeatedActionHistoryEntry[] = [];
  const assistantReasoning: string[] = [];
  const observations: string[] = [];

  for (const record of records) {
    const summary = asRecord(record.summary);
    if (record.type === "observation") {
      const state = asRecord(record.pokemonState);
      const position = asRecord(state?.position);
      if (
        typeof state?.mapId === "number" &&
        typeof position?.x === "number" &&
        typeof position.y === "number"
      ) {
        observations.push(`map=${state.mapId} x=${position.x} y=${position.y}`);
      }
      continue;
    }
    if (record.type !== "agent-event") {
      continue;
    }
    if (
      summary?.kind === "assistant_reasoning" &&
      typeof summary.text === "string"
    ) {
      assistantReasoning.push(summary.text);
      continue;
    }
    if (summary?.kind !== "action_tool_call") {
      continue;
    }
    actions.push({
      action: `${String(summary.toolName)}:${JSON.stringify(summary.input ?? {})}`,
      input: summary.input,
      toolName:
        typeof summary.toolName === "string" ? summary.toolName : undefined,
    });
  }

  return {
    actions,
    assistantReasoning,
    observations,
  };
}

function detectNoProgressState(trace: TraceEvidence):
  | {
      actions: string[];
      count: number;
      stateKey: string;
      uniqueActionCount: number;
    }
  | undefined {
  const latestState = trace.observations.at(-1);
  if (!latestState) {
    return;
  }
  const count = trace.observations.filter(
    (state) => state === latestState
  ).length;
  if (count < 3) {
    return;
  }
  const actions = trace.actions
    .slice(-count)
    .map((action) => action.action)
    .filter((action): action is string => typeof action === "string");
  const uniqueActionCount = new Set(actions).size;
  if (uniqueActionCount < 2) {
    return;
  }
  return {
    actions,
    count,
    stateKey: latestState,
    uniqueActionCount,
  };
}

function noProgressRecommendation(trace: TraceEvidence): string {
  const reasoning = trace.assistantReasoning.slice(-8).join(" ");
  if (NAME_ENTRY_REASONING_PATTERN.test(reasoning)) {
    return "Name-entry recovery: prefer default menu choices such as RED; if the custom keyboard opens, navigate to END and confirm instead of alternating A/B or adding random letters.";
  }
  return "When three or more observations remain on the same map/x/y with mixed actions, switch to a known mode-specific rule or deterministic recovery sequence instead of continuing free-form probing.";
}

async function writeCandidate(
  outputRoot: string,
  runId: string,
  candidate: TraceImprovementCandidate
): Promise<TraceImprovementResult> {
  await mkdir(outputRoot, { recursive: true });
  const outputPath = join(outputRoot, `${runId}.candidate.json`);
  await writeFile(outputPath, `${JSON.stringify(candidate, null, 2)}\n`);

  return {
    candidate,
    outputPath,
    runId,
    status: "candidate-written",
  };
}

function isProgressingDialogue(trace: TraceEvidence): boolean {
  const lastAction = trace.actions.at(-1);
  const input = asRecord(lastAction?.input);
  if (lastAction?.toolName !== "mgba_tap" || input?.button !== "A") {
    return false;
  }

  const recentReasoning = trace.assistantReasoning.slice(-5).join(" ");
  return (
    DIALOGUE_REASONING_PATTERN.test(recentReasoning) &&
    PROGRESSING_REASONING_PATTERN.test(recentReasoning)
  );
}

async function readJsonl(path: string): Promise<Record<string, unknown>[]> {
  const content = await readFile(path, "utf8");
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

export async function hasTraceRun(
  traceRoot: string,
  runId: string
): Promise<boolean> {
  try {
    return (await stat(join(traceRoot, "runs", runId))).isDirectory();
  } catch {
    return false;
  }
}

export async function listTraceRuns(
  traceRoot = DEFAULT_TRACE_ROOT
): Promise<string[]> {
  const runsDir = join(traceRoot, "runs");
  const entries = await readdir(runsDir);
  return entries.sort();
}

function isMainModule(): boolean {
  return process.argv[1]?.endsWith("/self-improvement.ts") ?? false;
}
