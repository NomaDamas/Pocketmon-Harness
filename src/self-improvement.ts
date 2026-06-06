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
    action: "avoid-repeated-action";
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
  await mkdir(outputRoot, { recursive: true });
  const outputPath = join(outputRoot, `${resolvedRunId}.candidate.json`);
  await writeFile(outputPath, `${JSON.stringify(candidate, null, 2)}\n`);

  return {
    candidate,
    outputPath,
    runId: resolvedRunId,
    status: "candidate-written",
  };
}

interface TraceEvidence {
  actions: Stage1RepeatedActionHistoryEntry[];
  assistantReasoning: string[];
}

async function loadTraceEvidence(
  traceRoot: string,
  runId: string
): Promise<TraceEvidence> {
  const eventsPath = join(traceRoot, "runs", runId, "events.jsonl");
  const records = await readJsonl(eventsPath);
  const actions: Stage1RepeatedActionHistoryEntry[] = [];
  const assistantReasoning: string[] = [];

  for (const record of records) {
    const summary = asRecord(record.summary);
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
