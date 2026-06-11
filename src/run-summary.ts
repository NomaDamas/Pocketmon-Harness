import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { RunExperimentMetadata } from "./run-trace";
import { POKEMON_RED_STAGE1_MAP_IDS } from "./stage1-evaluator";
import { STAGE1_VIRIDIAN_CITY_TERMINAL_MILESTONE_ID } from "./stage1-gameplay-schema";
import type {
  TokenCostEstimate,
  TokenUsageCallMetadata,
  TokenUsageMetric,
  TokenUsageSnapshot,
} from "./token-usage";

export const DEFAULT_RUNS_DIR = ".pss-mgba/traces/runs";

export interface RunSummary extends Partial<RunExperimentMetadata> {
  avgTokensImprovementPercentVsPrevious: number;
  avgTokensPerTurn: number;
  avgTokensSavedVsPrevious: number;
  iteration: number;
  llmCalls: RunSummaryLlmCall[];
  llmEstimatedCostUsd: number;
  llmPricedCalls: number;
  llmTokenUsage: TokenUsageSnapshot;
  llmUnpricedCalls: number;
  runId: string;
  startedAt: string | undefined;
  timing: RunSummaryTiming;
  totalTokens: TokenUsageSnapshot;
  totalTokensSavedVsPrevious: number;
  turns: number;
}

interface RawRunSummary extends Partial<RunExperimentMetadata> {
  avgTokensPerTurn: number;
  iteration: number;
  llmCalls: RunSummaryLlmCall[];
  llmEstimatedCostUsd: number;
  llmPricedCalls: number;
  llmTokenUsage: TokenUsageSnapshot;
  llmUnpricedCalls: number;
  runId: string;
  startedAt: string | undefined;
  timing: RunSummaryTiming;
  totalTokens: TokenUsageSnapshot;
  turns: number;
}

export interface RunSummaryLlmCall {
  callMetadata?: TokenUsageCallMetadata;
  completionTokens: number;
  costEstimate?: TokenCostEstimate;
  estimatedCostUsd: number;
  modelId: string;
  modelName?: string;
  pricingStatus: "estimated" | "unpriced" | "unknown";
  promptTokens: number;
  step: number;
  timestamp: string;
  totalTokens: number;
  turn: number;
  usage: TokenUsageSnapshot;
}

export interface RunSummaryTiming {
  firstMetricAt: string | undefined;
  lastMetricAt: string | undefined;
  observedDurationMs: number;
  observedDurationSeconds: number;
  startedAt: string | undefined;
}

export interface Stage1ViridianRunReport {
  completedRuns: number;
  generatedAt: string;
  runCount: number;
  runs: Stage1ViridianRunReportEntry[];
  targetMilestone: typeof STAGE1_VIRIDIAN_CITY_TERMINAL_MILESTONE_ID;
  totalBlockedRepeatedActions: number;
  totalObservedDurationMs: number;
  totalStuckEvents: number;
  totalVerificationFailures: number;
}

export interface Stage1ViridianRunReportEntry {
  completionEvidence: string | undefined;
  experimentId: string | undefined;
  failures: Stage1ViridianRunReportFailures;
  iteration: number;
  milestone: Stage1ViridianRunReportMilestone;
  mode: string | undefined;
  runId: string;
  stopReason: string | undefined;
  timing: RunSummaryTiming;
  turns: number;
  viridianCompleted: boolean;
}

export interface Stage1ViridianRunReportFailures {
  blockedRepeatedActions: number;
  stuckEvents: number;
  supervisorInterventions: number;
  total: number;
  verificationFailures: number;
}

export interface Stage1ViridianRunReportMilestone {
  completedRatio: number;
  current: string | undefined;
  furthest: string | undefined;
  furthestRank: number;
  source: string;
}

export async function readRunSummaries(
  runsDir = DEFAULT_RUNS_DIR
): Promise<RunSummary[]> {
  let runIds: string[];
  try {
    runIds = await readdir(runsDir);
  } catch (error) {
    if (error instanceof Error && hasCode(error, "ENOENT")) {
      return [];
    }
    throw error;
  }

  const summaries = await Promise.all(
    runIds.map(async (runId) => readRawRunSummary(runsDir, runId))
  );
  const sorted = summaries
    .filter((summary): summary is RawRunSummary => Boolean(summary))
    .sort((left, right) => left.iteration - right.iteration);

  return sorted.map((summary, index) => {
    const previous = sorted[index - 1];
    const avgTokensSavedVsPrevious = previous
      ? previous.avgTokensPerTurn - summary.avgTokensPerTurn
      : 0;
    return {
      ...summary,
      avgTokensImprovementPercentVsPrevious:
        previous && previous.avgTokensPerTurn > 0
          ? (avgTokensSavedVsPrevious / previous.avgTokensPerTurn) * 100
          : 0,
      avgTokensSavedVsPrevious,
      totalTokensSavedVsPrevious: previous
        ? previous.totalTokens.totalTokens - summary.totalTokens.totalTokens
        : 0,
    };
  });
}

export function renderRunSummaryPrometheus(
  summaries: readonly RunSummary[]
): string {
  if (summaries.length === 0) {
    return "";
  }

  return [
    "# HELP pss_mgba_run_summary_turns Completed turns recorded for a run iteration.",
    "# TYPE pss_mgba_run_summary_turns gauge",
    ...summaries.map(
      (summary) =>
        `pss_mgba_run_summary_turns${labels(summary)} ${summary.turns}`
    ),
    "# HELP pss_mgba_run_summary_tokens Total tokens recorded for a completed or current run by kind.",
    "# TYPE pss_mgba_run_summary_tokens gauge",
    ...summaries.flatMap((summary) => usageLines(summary)),
    "# HELP pss_mgba_run_llm_calls_total LLM model calls recorded for a completed or current run.",
    "# TYPE pss_mgba_run_llm_calls_total gauge",
    ...summaries.map(
      (summary) =>
        `pss_mgba_run_llm_calls_total${labels(summary)} ${summary.llmCalls.length}`
    ),
    "# HELP pss_mgba_run_llm_tokens_total LLM per-call token usage aggregated across recorded model calls by kind.",
    "# TYPE pss_mgba_run_llm_tokens_total gauge",
    ...summaries.flatMap((summary) => llmUsageLines(summary)),
    "# HELP pss_mgba_run_llm_token_cost_estimated_usd Estimated LLM token cost in USD aggregated across recorded model calls.",
    "# TYPE pss_mgba_run_llm_token_cost_estimated_usd gauge",
    ...summaries.map(
      (summary) =>
        `pss_mgba_run_llm_token_cost_estimated_usd${labels(summary)} ${summary.llmEstimatedCostUsd}`
    ),
    "# HELP pss_mgba_run_llm_token_cost_pricing_calls_total LLM model calls by pricing resolution status.",
    "# TYPE pss_mgba_run_llm_token_cost_pricing_calls_total gauge",
    ...summaries.flatMap((summary) => [
      `pss_mgba_run_llm_token_cost_pricing_calls_total${labels(summary, "priced")} ${summary.llmPricedCalls}`,
      `pss_mgba_run_llm_token_cost_pricing_calls_total${labels(summary, "unpriced")} ${summary.llmUnpricedCalls}`,
    ]),
    "# HELP pss_mgba_run_avg_tokens_per_turn Average total tokens per turn for a run iteration.",
    "# TYPE pss_mgba_run_avg_tokens_per_turn gauge",
    ...summaries.map(
      (summary) =>
        `pss_mgba_run_avg_tokens_per_turn${labels(summary)} ${summary.avgTokensPerTurn}`
    ),
    "# HELP pss_mgba_run_avg_tokens_saved_vs_previous Average tokens per turn saved versus previous iteration. Positive means improved.",
    "# TYPE pss_mgba_run_avg_tokens_saved_vs_previous gauge",
    ...summaries.map(
      (summary) =>
        `pss_mgba_run_avg_tokens_saved_vs_previous${labels(summary)} ${summary.avgTokensSavedVsPrevious}`
    ),
    "# HELP pss_mgba_run_avg_tokens_improvement_percent_vs_previous Percent improvement in average tokens per turn versus previous iteration. Positive means improved.",
    "# TYPE pss_mgba_run_avg_tokens_improvement_percent_vs_previous gauge",
    ...summaries.map(
      (summary) =>
        `pss_mgba_run_avg_tokens_improvement_percent_vs_previous${labels(summary)} ${summary.avgTokensImprovementPercentVsPrevious}`
    ),
    "# HELP pss_mgba_run_total_tokens_saved_vs_previous Total tokens saved versus previous iteration. Positive means improved.",
    "# TYPE pss_mgba_run_total_tokens_saved_vs_previous gauge",
    ...summaries.map(
      (summary) =>
        `pss_mgba_run_total_tokens_saved_vs_previous${labels(summary)} ${summary.totalTokensSavedVsPrevious}`
    ),
    "# HELP pss_mgba_run_verification_failures_total Completed-run post-action verification failures, distinct from blocked repeated actions.",
    "# TYPE pss_mgba_run_verification_failures_total gauge",
    ...summaries.map(
      (summary) =>
        `pss_mgba_run_verification_failures_total${labels(summary)} ${summary.verificationFailuresTotal ?? 0}`
    ),
    "# HELP pss_mgba_run_blocked_repeated_actions_total Completed-run same state/action no-progress blocks, distinct from verification failures.",
    "# TYPE pss_mgba_run_blocked_repeated_actions_total gauge",
    ...summaries.map(
      (summary) =>
        `pss_mgba_run_blocked_repeated_actions_total${labels(summary)} ${summary.blockedRepeatedActionsTotal ?? 0}`
    ),
    "# HELP pss_mgba_run_milestone_progress_rank Completed-run furthest Stage 1 milestone rank captured during controller-primary execution.",
    "# TYPE pss_mgba_run_milestone_progress_rank gauge",
    ...summaries.map(
      (summary) =>
        `pss_mgba_run_milestone_progress_rank${milestoneLabels(summary)} ${summary.milestoneProgress?.furthestRank ?? 0}`
    ),
    "# HELP pss_mgba_run_milestone_progress_ratio Completed-run furthest Stage 1 milestone progress ratio captured during controller-primary execution.",
    "# TYPE pss_mgba_run_milestone_progress_ratio gauge",
    ...summaries.map(
      (summary) =>
        `pss_mgba_run_milestone_progress_ratio${milestoneLabels(summary)} ${summary.milestoneProgress?.completedRatio ?? 0}`
    ),
    "",
  ].join("\n");
}

async function readRawRunSummary(
  runsDir: string,
  runId: string
): Promise<RawRunSummary | null> {
  const run = JSON.parse(
    await readFile(join(runsDir, runId, "run.json"), "utf8")
  ) as {
    iteration: number;
    runId: string;
    startedAt?: string;
  } & Partial<RunExperimentMetadata>;
  const usageJsonl = await readFile(
    join(runsDir, runId, "token-usage.jsonl"),
    "utf8"
  ).catch((error: unknown) => {
    if (error instanceof Error && hasCode(error, "ENOENT")) {
      return "";
    }
    throw error;
  });

  const metrics = usageJsonl
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as TokenUsageMetric);
  const timing = createRunSummaryTiming(run.startedAt, metrics);
  const turnSummaries = metrics.filter(
    (metric) => metric.type === "turn-summary"
  );
  const llmCalls = metrics
    .filter(
      (metric): metric is Extract<TokenUsageMetric, { type: "llm-step" }> =>
        metric.type === "llm-step"
    )
    .map(toRunSummaryLlmCall);
  const llmTokenUsage = llmCalls.reduce(
    (accumulator, call) => addUsage(accumulator, call.usage),
    emptyUsage()
  );
  const llmEstimatedCostUsd = llmCalls.reduce(
    (sum, call) => sum + call.estimatedCostUsd,
    0
  );
  const llmPricedCalls = llmCalls.filter(
    (call) => call.pricingStatus === "estimated"
  ).length;
  const llmUnpricedCalls = llmCalls.filter(
    (call) => call.pricingStatus === "unpriced"
  ).length;

  if (turnSummaries.length === 0) {
    return {
      ...experimentFields(run),
      avgTokensPerTurn: 0,
      iteration: run.iteration,
      llmCalls,
      llmEstimatedCostUsd,
      llmPricedCalls,
      llmTokenUsage,
      llmUnpricedCalls,
      runId: run.runId,
      startedAt: run.startedAt,
      timing,
      totalTokens: emptyUsage(),
      turns: 0,
    };
  }

  const totalTokens = turnSummaries.reduce(
    (accumulator, metric) => addUsage(accumulator, metric.usage),
    emptyUsage()
  );

  return {
    ...experimentFields(run),
    avgTokensPerTurn: totalTokens.totalTokens / turnSummaries.length,
    iteration: run.iteration,
    llmCalls,
    llmEstimatedCostUsd,
    llmPricedCalls,
    llmTokenUsage,
    llmUnpricedCalls,
    runId: run.runId,
    startedAt: run.startedAt,
    timing,
    totalTokens,
    turns: turnSummaries.length,
  };
}

export function createStage1ViridianRunReport(
  summaries: readonly RunSummary[],
  now = new Date()
): Stage1ViridianRunReport {
  const runs = summaries.map(toStage1ViridianRunReportEntry);
  return {
    completedRuns: runs.filter((run) => run.viridianCompleted).length,
    generatedAt: now.toISOString(),
    runCount: runs.length,
    runs,
    targetMilestone: STAGE1_VIRIDIAN_CITY_TERMINAL_MILESTONE_ID,
    totalBlockedRepeatedActions: runs.reduce(
      (sum, run) => sum + run.failures.blockedRepeatedActions,
      0
    ),
    totalObservedDurationMs: runs.reduce(
      (sum, run) => sum + run.timing.observedDurationMs,
      0
    ),
    totalStuckEvents: runs.reduce(
      (sum, run) => sum + run.failures.stuckEvents,
      0
    ),
    totalVerificationFailures: runs.reduce(
      (sum, run) => sum + run.failures.verificationFailures,
      0
    ),
  };
}

export function renderStage1ViridianRunReportMarkdown(
  report: Stage1ViridianRunReport
): string {
  const lines = [
    "# Pokemon Red Stage 1 Viridian Run Report",
    "",
    `Generated: ${report.generatedAt}`,
    `Target milestone: ${report.targetMilestone}`,
    `Runs: ${report.runCount}`,
    `Viridian completions: ${report.completedRuns}`,
    `Observed duration: ${formatDuration(report.totalObservedDurationMs)}`,
    `Verification failures: ${report.totalVerificationFailures}`,
    `Blocked repeated actions: ${report.totalBlockedRepeatedActions}`,
    `Stuck events: ${report.totalStuckEvents}`,
  ];

  for (const [index, run] of report.runs.entries()) {
    lines.push(
      "",
      `## ${index + 1}. ${run.runId}`,
      `- Iteration: ${run.iteration}`,
      `- Mode: ${run.mode ?? "unknown"}`,
      `- Experiment: ${run.experimentId ?? "unknown"}`,
      `- Viridian completed: ${run.viridianCompleted ? "yes" : "no"}`,
      `- Completion evidence: ${run.completionEvidence ?? "none"}`,
      `- Milestone current: ${run.milestone.current ?? "none"}`,
      `- Milestone furthest: ${run.milestone.furthest ?? "none"}`,
      `- Milestone progress: ${formatRatio(run.milestone.completedRatio)} (${run.milestone.source}, rank ${run.milestone.furthestRank})`,
      `- Timing: ${formatDuration(run.timing.observedDurationMs)} observed, ${run.turns} turns, first metric ${run.timing.firstMetricAt ?? "none"}, last metric ${run.timing.lastMetricAt ?? "none"}`,
      `- Failures: verification=${run.failures.verificationFailures}, blockedRepeatedActions=${run.failures.blockedRepeatedActions}, stuckEvents=${run.failures.stuckEvents}, supervisorInterventions=${run.failures.supervisorInterventions}`,
      `- Stop reason: ${run.stopReason ?? "none"}`
    );
  }

  return `${lines.join("\n")}\n`;
}

function experimentFields(
  run: Partial<RunExperimentMetadata>
): Partial<RunExperimentMetadata> {
  return {
    experimentId: run.experimentId,
    milestone: run.milestone,
    milestoneCurrent: run.milestoneCurrent ?? run.milestone,
    milestoneFurthest: run.milestoneFurthest ?? run.milestone,
    milestoneProgress: run.milestoneProgress,
    mode: run.mode,
    objective: run.objective,
    ramReadStatus: run.ramReadStatus,
    runBudget: run.runBudget,
    runtimeGameState: run.runtimeGameState,
    saveStatePath: run.saveStatePath,
    stateSource: run.stateSource,
    stopReason: run.stopReason,
    blockedRepeatedActionsTotal: run.blockedRepeatedActionsTotal,
    stuckEvents: run.stuckEvents,
    supervisorEnabled: run.supervisorEnabled,
    supervisorInterventions: run.supervisorInterventions,
    verificationFailuresTotal: run.verificationFailuresTotal,
    verificationSuccessesTotal: run.verificationSuccessesTotal,
  };
}

function createRunSummaryTiming(
  startedAt: string | undefined,
  metrics: readonly TokenUsageMetric[]
): RunSummaryTiming {
  const timestamps = metrics
    .map((metric) => Date.parse(metric.timestamp))
    .filter((timestamp) => Number.isFinite(timestamp))
    .sort((left, right) => left - right);
  const firstTimestamp = timestamps[0];
  const lastTimestamp = timestamps.at(-1);
  const observedDurationMs =
    firstTimestamp === undefined || lastTimestamp === undefined
      ? 0
      : Math.max(0, lastTimestamp - firstTimestamp);

  return {
    firstMetricAt:
      firstTimestamp === undefined
        ? undefined
        : new Date(firstTimestamp).toISOString(),
    lastMetricAt:
      lastTimestamp === undefined
        ? undefined
        : new Date(lastTimestamp).toISOString(),
    observedDurationMs,
    observedDurationSeconds: observedDurationMs / 1000,
    startedAt,
  };
}

function toStage1ViridianRunReportEntry(
  summary: RunSummary
): Stage1ViridianRunReportEntry {
  const completionEvidence = viridianCompletionEvidence(summary);
  const verificationFailures = summary.verificationFailuresTotal ?? 0;
  const blockedRepeatedActions = summary.blockedRepeatedActionsTotal ?? 0;
  const stuckEvents = summary.stuckEvents ?? 0;
  const supervisorInterventions = summary.supervisorInterventions ?? 0;
  return {
    completionEvidence,
    experimentId: summary.experimentId,
    failures: {
      blockedRepeatedActions,
      stuckEvents,
      supervisorInterventions,
      total: verificationFailures + blockedRepeatedActions + stuckEvents,
      verificationFailures,
    },
    iteration: summary.iteration,
    milestone: {
      completedRatio:
        completionEvidence === undefined
          ? (summary.milestoneProgress?.completedRatio ?? 0)
          : 1,
      current: summary.milestoneProgress?.current ?? summary.milestoneCurrent,
      furthest:
        summary.milestoneProgress?.furthest ?? summary.milestoneFurthest,
      furthestRank: summary.milestoneProgress?.furthestRank ?? 0,
      source: summary.milestoneProgress?.source ?? "run-trace",
    },
    mode: summary.mode,
    runId: summary.runId,
    stopReason: summary.stopReason,
    timing: summary.timing,
    turns: summary.turns,
    viridianCompleted: completionEvidence !== undefined,
  };
}

function viridianCompletionEvidence(summary: RunSummary): string | undefined {
  const milestones = [
    summary.milestoneProgress?.furthest,
    summary.milestoneProgress?.current,
    summary.milestoneFurthest,
    summary.milestoneCurrent,
    summary.milestone,
  ];
  if (milestones.includes(STAGE1_VIRIDIAN_CITY_TERMINAL_MILESTONE_ID)) {
    return `milestone=${STAGE1_VIRIDIAN_CITY_TERMINAL_MILESTONE_ID}`;
  }
  if (
    summary.runtimeGameState?.source === "pokemon-red-ram" &&
    summary.runtimeGameState.readStatus === "available" &&
    summary.runtimeGameState.mapId === POKEMON_RED_STAGE1_MAP_IDS.viridianCity
  ) {
    return `runtimeGameState.mapId=${POKEMON_RED_STAGE1_MAP_IDS.viridianCity}`;
  }
  return;
}

function formatDuration(durationMs: number): string {
  if (durationMs <= 0) {
    return "0.0s";
  }
  return `${(durationMs / 1000).toFixed(1)}s`;
}

function formatRatio(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}

function emptyUsage(): TokenUsageSnapshot {
  return {
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    inputTokens: 0,
    noCacheTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    textTokens: 0,
    totalTokens: 0,
  };
}

function addUsage(
  left: TokenUsageSnapshot,
  right: TokenUsageSnapshot
): TokenUsageSnapshot {
  return {
    cacheReadTokens: left.cacheReadTokens + right.cacheReadTokens,
    cacheWriteTokens: left.cacheWriteTokens + right.cacheWriteTokens,
    inputTokens: left.inputTokens + right.inputTokens,
    noCacheTokens: left.noCacheTokens + right.noCacheTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    reasoningTokens: left.reasoningTokens + right.reasoningTokens,
    textTokens: left.textTokens + right.textTokens,
    totalTokens: left.totalTokens + right.totalTokens,
  };
}

function usageLines(summary: RunSummary): string[] {
  return usageMetricLines(
    "pss_mgba_run_summary_tokens",
    summary,
    summary.totalTokens
  );
}

function llmUsageLines(summary: RunSummary): string[] {
  return usageMetricLines(
    "pss_mgba_run_llm_tokens_total",
    summary,
    summary.llmTokenUsage
  );
}

function usageMetricLines(
  metricName: string,
  summary: RunSummary,
  usage: TokenUsageSnapshot
): string[] {
  return [
    `input ${usage.inputTokens}`,
    `output ${usage.outputTokens}`,
    `total ${usage.totalTokens}`,
    `reasoning ${usage.reasoningTokens}`,
    `text ${usage.textTokens}`,
    `cache_read ${usage.cacheReadTokens}`,
    `cache_write ${usage.cacheWriteTokens}`,
    `no_cache ${usage.noCacheTokens}`,
  ].map((entry) => {
    const [kind, value] = entry.split(" ");
    return `${metricName}${labels(summary, kind)} ${value}`;
  });
}

function toRunSummaryLlmCall(
  metric: Extract<TokenUsageMetric, { type: "llm-step" }>
): RunSummaryLlmCall {
  const costEstimate = metric.costEstimate;
  return {
    ...(metric.callMetadata
      ? { callMetadata: { ...metric.callMetadata } }
      : {}),
    completionTokens: metric.completionTokens ?? metric.usage.outputTokens,
    ...(costEstimate ? { costEstimate: cloneCostEstimate(costEstimate) } : {}),
    estimatedCostUsd: costEstimate?.estimatedCostUsd ?? 0,
    modelId: metric.modelId,
    ...(metric.modelName ? { modelName: metric.modelName } : {}),
    pricingStatus: costEstimate?.status ?? "unknown",
    promptTokens: metric.promptTokens ?? metric.usage.inputTokens,
    step: metric.step,
    timestamp: metric.timestamp,
    totalTokens: metric.totalTokens ?? metric.usage.totalTokens,
    turn: metric.turn,
    usage: { ...metric.usage },
  };
}

function cloneCostEstimate(estimate: TokenCostEstimate): TokenCostEstimate {
  return {
    ...estimate,
    pricing: estimate.pricing ? { ...estimate.pricing } : undefined,
  };
}

function labels(summary: RunSummary, kind?: string): string {
  return labelsWith(summary, kind ? { kind } : {});
}

function milestoneLabels(summary: RunSummary): string {
  return labelsWith(summary, {
    milestone:
      summary.milestoneProgress?.furthest ??
      summary.milestoneFurthest ??
      summary.milestone ??
      "none",
    source: summary.milestoneProgress?.source ?? "run-trace",
  });
}

function labelsWith(
  summary: RunSummary,
  extra: Record<string, string | undefined>
): string {
  const entries = [
    `run_id="${escapeLabel(summary.runId)}"`,
    `iteration="${summary.iteration}"`,
  ];
  if (summary.mode) {
    entries.push(`mode="${escapeLabel(summary.mode)}"`);
  }
  if (summary.experimentId) {
    entries.push(`experiment_id="${escapeLabel(summary.experimentId)}"`);
  }
  for (const [key, value] of Object.entries(extra)) {
    if (value !== undefined) {
      entries.push(`${key}="${escapeLabel(value)}"`);
    }
  }
  return `{${entries.join(",")}}`;
}

function escapeLabel(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function hasCode(error: Error, code: string): boolean {
  return (error as Error & { code?: unknown }).code === code;
}
