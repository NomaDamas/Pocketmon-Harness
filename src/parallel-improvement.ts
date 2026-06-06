import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DEFAULT_RUNS_DIR } from "./run-summary";
import type { RunTrace } from "./run-trace";
import type { ViewerEvent } from "./viewer-events";

const DEFAULT_CANDIDATES_DIR = ".pss-mgba/candidates";
const MILESTONE_SCORE: Record<string, number> = {
  "player-control-reached": 10,
  "first-map-transition": 20,
  "first-battle-detected": 30,
  "starter-obtained": 40,
  "route1-reached": 50,
  "viridian-reached": 60,
};

export interface ParallelBatchRunScore {
  deterministicActions: number;
  fallbackCalls: number;
  fallbackRate: number;
  hypothesis?: string;
  milestoneFurthest?: string;
  progressScore: number;
  runId: string;
  score: number;
  stuckEvents: number;
  totalTokens: number;
  transitions: number;
  verificationFailures: number;
  verificationSuccesses: number;
}

export interface ParallelBatchProposal {
  batchId: string;
  createdAt: string;
  qaGate: {
    blocked: boolean;
    reasons: string[];
  };
  recommendations: {
    pathfinderPatches: unknown[];
    rules: unknown[];
    skills: unknown[];
  };
  runs: ParallelBatchRunScore[];
  summary: {
    bestRunId?: string;
    runCount: number;
  };
}

if (isMainModule()) {
  const result = await improveParallelBatch({
    batchId: readArg("--batch") ?? process.env.PARALLEL_BATCH_ID,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

export async function improveParallelBatch({
  batchId,
  candidatesDir = DEFAULT_CANDIDATES_DIR,
  now = new Date(),
  runsDir = DEFAULT_RUNS_DIR,
}: {
  batchId?: string;
  candidatesDir?: string;
  now?: Date;
  runsDir?: string;
} = {}): Promise<{ batchId: string; outputDir: string; proposal: ParallelBatchProposal }> {
  const runs = await readBatchRuns(runsDir, batchId);
  const resolvedBatchId = batchId ?? inferLatestBatchId(runs);
  const selectedRuns = runs.filter((run) => run.parallelBatchId === resolvedBatchId);
  if (selectedRuns.length === 0) {
    throw new Error(`No parallel runs found for batch ${resolvedBatchId}`);
  }
  const scoredRuns = (
    await Promise.all(selectedRuns.map((run) => scoreRun(runsDir, run)))
  ).sort((left, right) => right.score - left.score);
  const proposal = createProposal(resolvedBatchId, now, scoredRuns);
  const outputDir = join(candidatesDir, resolvedBatchId);
  await mkdir(outputDir, { recursive: true });
  await Promise.all([
    writeFile(join(outputDir, "summary.md"), renderSummary(proposal)),
    writeFile(join(outputDir, "rules.json"), `${JSON.stringify(proposal.recommendations.rules, null, 2)}\n`),
    writeFile(join(outputDir, "skills.json"), `${JSON.stringify(proposal.recommendations.skills, null, 2)}\n`),
    writeFile(
      join(outputDir, "pathfinder-patches.json"),
      `${JSON.stringify(proposal.recommendations.pathfinderPatches, null, 2)}\n`
    ),
    writeFile(join(outputDir, "proposal.json"), `${JSON.stringify(proposal, null, 2)}\n`),
  ]);
  return { batchId: resolvedBatchId, outputDir, proposal };
}

async function readBatchRuns(
  runsDir: string,
  batchId?: string
): Promise<RunTrace[]> {
  const runIds = await readdir(runsDir).catch(() => []);
  const runs = await Promise.all(
    runIds.map(async (runId) => {
      try {
        return JSON.parse(
          await readFile(join(runsDir, runId, "run.json"), "utf8")
        ) as RunTrace;
      } catch {
        return;
      }
    })
  );
  return runs.filter(
    (run): run is RunTrace =>
      run !== undefined &&
      Boolean(run.parallelBatchId) &&
      (batchId ? run.parallelBatchId === batchId : true)
  );
}

function inferLatestBatchId(runs: readonly RunTrace[]): string {
  const latest = [...runs].sort((left, right) =>
    right.startedAt.localeCompare(left.startedAt)
  )[0];
  if (!latest?.parallelBatchId) {
    throw new Error("No parallel batch traces found");
  }
  return latest.parallelBatchId;
}

async function scoreRun(
  runsDir: string,
  run: RunTrace
): Promise<ParallelBatchRunScore> {
  const events = await readEvents(runsDir, run.runId);
  const totalTokens = await readTotalTokens(runsDir, run.runId);
  const states = events
    .filter((event) => event.type === "observation")
    .map((event) => event.pokemonState)
    .filter(Boolean);
  const transitions = countMapTransitions(
    states.map((state) => state?.mapId ?? null)
  );
  const verificationSuccesses = countText(events, /verification_result success="true"/u);
  const verificationFailures = countText(events, /verification_result success="false"/u);
  const deterministicActions = events.filter(
    (event) =>
      event.type === "agent-event" &&
      event.summary?.kind === "action_tool_call" &&
      isControllerToolCallId(String(event.summary.toolCallId ?? ""))
  ).length;
  const fallbackCalls = events.filter(
    (event) =>
      event.type === "agent-event" &&
      event.summary?.kind === "action_tool_call" &&
      !isControllerToolCallId(String(event.summary.toolCallId ?? ""))
  ).length;
  const progressScore =
    MILESTONE_SCORE[run.milestoneFurthest ?? ""] ?? transitions * 5;
  return {
    deterministicActions,
    fallbackCalls,
    fallbackRate: ratio(fallbackCalls, deterministicActions + fallbackCalls),
    hypothesis: run.parallelHypothesis,
    milestoneFurthest: run.milestoneFurthest,
    progressScore,
    runId: run.runId,
    score:
      progressScore +
      transitions * 3 +
      verificationSuccesses -
      verificationFailures * 8 -
      (run.stuckEvents ?? 0) * 4 -
      totalTokens / 10_000,
    stuckEvents: run.stuckEvents ?? 0,
    totalTokens,
    transitions,
    verificationFailures,
    verificationSuccesses,
  };
}

function isControllerToolCallId(toolCallId: string): boolean {
  return (
    toolCallId.startsWith("deterministic-") ||
    toolCallId.startsWith("shared-strategy-")
  );
}

function createProposal(
  batchId: string,
  now: Date,
  runs: readonly ParallelBatchRunScore[]
): ParallelBatchProposal {
  const best = runs[0];
  const qaReasons: string[] = [];
  if (runs.length < 2) {
    qaReasons.push("needs at least two independent runs in the same batch");
  }
  if (!best || best.verificationFailures > 0) {
    qaReasons.push("best run has verification failures or is missing");
  }
  if (!best || best.progressScore <= 0) {
    qaReasons.push("no measurable progress milestone or map transition");
  }
  const commonAntiPatterns = runs
    .filter((run) => run.stuckEvents >= 3 || run.verificationFailures > 0)
    .map((run) => ({
      evidenceRunId: run.runId,
      ruleId: `avoid-${run.hypothesis ?? "unknown"}-stuck-loop`,
      scope: "rule-memory",
      type: "anti-pattern",
    }));
  const pathfinderPatches =
    best && best.transitions > 0
      ? [
          {
            evidenceRunId: best.runId,
            hypothesis: best.hypothesis,
            note: "Promote only after replay confirms the observed map transition from trace events.",
            type: "waypoint-transition-candidate",
          },
        ]
      : [];
  return {
    batchId,
    createdAt: now.toISOString(),
    qaGate: {
      blocked: qaReasons.length > 0,
      reasons: qaReasons,
    },
    recommendations: {
      pathfinderPatches,
      rules: commonAntiPatterns,
      skills: best
        ? [
            {
              evidenceRunId: best.runId,
              hypothesis: best.hypothesis,
              note: "Skill candidate requires explicit promote plus replay/test gate.",
              type: "best-hypothesis-skill-candidate",
            },
          ]
        : [],
    },
    runs: [...runs],
    summary: {
      bestRunId: best?.runId,
      runCount: runs.length,
    },
  };
}

async function readEvents(
  runsDir: string,
  runId: string
): Promise<ViewerEvent[]> {
  const raw = await readFile(join(runsDir, runId, "events.jsonl"), "utf8").catch(
    () => ""
  );
  return raw
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ViewerEvent);
}

async function readTotalTokens(runsDir: string, runId: string): Promise<number> {
  const raw = await readFile(join(runsDir, runId, "token-usage.jsonl"), "utf8").catch(
    () => ""
  );
  return raw
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { type?: string; usage?: { totalTokens?: number } })
    .filter((record) => record.type === "turn-summary")
    .reduce((sum, record) => sum + (record.usage?.totalTokens ?? 0), 0);
}

function countMapTransitions(mapIds: readonly (number | null)[]): number {
  let transitions = 0;
  let previous = mapIds[0];
  for (const mapId of mapIds.slice(1)) {
    if (mapId !== null && previous !== null && mapId !== previous) {
      transitions += 1;
    }
    previous = mapId;
  }
  return transitions;
}

function countText(events: readonly ViewerEvent[], pattern: RegExp): number {
  return events.filter(
    (event) =>
      event.type === "agent-event" &&
      typeof event.summary?.text === "string" &&
      pattern.test(event.summary.text)
  ).length;
}

function renderSummary(proposal: ParallelBatchProposal): string {
  return [
    `# Parallel Improvement Proposal: ${proposal.batchId}`,
    "",
    `- runs: ${proposal.summary.runCount}`,
    `- bestRunId: ${proposal.summary.bestRunId ?? "none"}`,
    `- qaBlocked: ${proposal.qaGate.blocked}`,
    `- qaReasons: ${proposal.qaGate.reasons.join("; ") || "none"}`,
    "",
    "This file is evidence/proposal only. It does not modify active rules, skills, or pathfinder code.",
  ].join("\n");
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function readArg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function isMainModule(): boolean {
  return process.argv[1]?.endsWith("/parallel-improvement.ts") ?? false;
}
