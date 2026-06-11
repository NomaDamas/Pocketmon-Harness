import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createStage1ViridianRunReport,
  readRunSummaries,
  renderRunSummaryPrometheus,
  renderStage1ViridianRunReportMarkdown,
} from "../src/run-summary";

async function writeRun(
  runsDir: string,
  runId: string,
  iteration: number,
  totals: number[],
  metadata: Record<string, unknown> = {},
  llmSteps: Record<string, unknown>[] = [],
  turnTimestamps: string[] = []
): Promise<void> {
  const runDir = join(runsDir, runId);
  await mkdir(runDir, { recursive: true });
  await writeFile(
    join(runDir, "run.json"),
    JSON.stringify({ iteration, runId, ...metadata })
  );
  const turnSummaryLines = totals.map((total, index) =>
    JSON.stringify({
      iteration,
      runId,
      schemaVersion: 1,
      steps: 1,
      timestamp: turnTimestamps[index] ?? new Date(index).toISOString(),
      turn: index + 1,
      type: "turn-summary",
      usage: {
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        inputTokens: total,
        noCacheTokens: total,
        outputTokens: 0,
        reasoningTokens: 0,
        textTokens: 0,
        totalTokens: total,
      },
    })
  );
  await writeFile(
    join(runDir, "token-usage.jsonl"),
    [...llmSteps.map((step) => JSON.stringify(step)), ...turnSummaryLines].join(
      "\n"
    )
  );
}

function llmStep({
  inputTokens,
  iteration,
  outputTokens,
  runId,
  step,
  turn,
}: {
  inputTokens: number;
  iteration: number;
  outputTokens: number;
  runId: string;
  step: number;
  turn: number;
}): Record<string, unknown> {
  const totalTokens = inputTokens + outputTokens;
  return {
    callMetadata: {
      attempt: step,
      callPath: "bounded-llm-fallback",
      controlOwner: "llm-fallback",
      edgeKey: `unknown|fallback-analysis|${step}`,
    },
    completionTokens: outputTokens,
    costEstimate: {
      cacheReadCostUsd: 0,
      cacheWriteCostUsd: 0,
      currency: "USD",
      estimatedCostUsd: (inputTokens * 2 + outputTokens * 10) / 1_000_000,
      inputCostUsd: (inputTokens * 2) / 1_000_000,
      matchedModelId: "provider:model",
      modelId: "provider:model",
      outputCostUsd: (outputTokens * 10) / 1_000_000,
      pricing: {
        inputUsdPerMillionTokens: 2,
        outputUsdPerMillionTokens: 10,
      },
      status: "estimated",
    },
    iteration,
    modelId: "provider:model",
    modelName: "provider:model",
    promptTokens: inputTokens,
    runId,
    schemaVersion: 1,
    step,
    timestamp: new Date(step).toISOString(),
    totalTokens,
    turn,
    type: "llm-step",
    usage: {
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      inputTokens,
      noCacheTokens: inputTokens,
      outputTokens,
      reasoningTokens: 0,
      textTokens: outputTokens,
      totalTokens,
    },
  };
}

describe("run summary metrics", () => {
  it("computes per-run efficiency and improvement versus previous run", async () => {
    const root = await mkdtemp(join(tmpdir(), "pss-mgba-summary-"));
    const runsDir = join(root, "runs");
    await writeRun(runsDir, "run-1", 1, [100, 100]);
    await writeRun(runsDir, "run-2", 2, [60, 60]);

    const summaries = await readRunSummaries(runsDir);

    expect(summaries).toHaveLength(2);
    expect(summaries[0]).toMatchObject({
      avgTokensPerTurn: 100,
      avgTokensSavedVsPrevious: 0,
      turns: 2,
    });
    expect(summaries[1]).toMatchObject({
      avgTokensImprovementPercentVsPrevious: 40,
      avgTokensPerTurn: 60,
      avgTokensSavedVsPrevious: 40,
      totalTokensSavedVsPrevious: 80,
      turns: 2,
    });

    const prometheus = renderRunSummaryPrometheus(summaries);
    expect(prometheus).toContain(
      'pss_mgba_run_avg_tokens_per_turn{run_id="run-2",iteration="2"} 60'
    );
    expect(prometheus).toContain(
      'pss_mgba_run_avg_tokens_improvement_percent_vs_previous{run_id="run-2",iteration="2"} 40'
    );
    expect(prometheus).toContain(
      'pss_mgba_run_summary_tokens{run_id="run-2",iteration="2",kind="total"} 120'
    );
  });

  it("preserves experiment metadata and labels recovery runs distinctly", async () => {
    const root = await mkdtemp(join(tmpdir(), "pss-mgba-summary-metadata-"));
    const runsDir = join(root, "runs");
    await writeRun(runsDir, "fresh-run", 1, [100], {
      blockedRepeatedActionsTotal: 2,
      experimentId: "state-observation",
      milestoneProgress: {
        completedRatio: 0.375,
        current: "player-control-reached",
        currentRank: 3,
        furthest: "player-control-reached",
        furthestRank: 3,
        namespace: "milestone-progress",
        sequenceLength: 8,
        source: "milestone-progress-tracker",
      },
      mode: "fresh",
      runtimeGameState: {
        battle: false,
        evaluatorMilestone: "player-control-reached",
        evaluatorMilestoneCurrent: "player-control-reached",
        evaluatorMilestoneFurthest: "player-control-reached",
        mapId: 38,
        phase: "bedroom_2f",
        readStatus: "available",
        source: "pokemon-red-ram",
        statusFrame: 2817,
        x: 3,
        y: 6,
      },
      stateSource: "new-game",
      verificationFailuresTotal: 1,
      verificationSuccessesTotal: 3,
    });
    await writeRun(runsDir, "recovery-run", 2, [75], {
      experimentId: "retry-recovery",
      milestoneCurrent: "player-control-reached",
      milestoneFurthest: "first-map-transition",
      mode: "recovery",
      saveStatePath: ".pss-mgba/states/retry.ss0",
      stateSource: "save-state",
    });

    const summaries = await readRunSummaries(runsDir);

    expect(summaries[0]).toMatchObject({
      blockedRepeatedActionsTotal: 2,
      experimentId: "state-observation",
      milestoneProgress: {
        completedRatio: 0.375,
        current: "player-control-reached",
        currentRank: 3,
        furthest: "player-control-reached",
        furthestRank: 3,
        namespace: "milestone-progress",
        sequenceLength: 8,
        source: "milestone-progress-tracker",
      },
      mode: "fresh",
      runtimeGameState: {
        battle: false,
        evaluatorMilestone: "player-control-reached",
        evaluatorMilestoneCurrent: "player-control-reached",
        evaluatorMilestoneFurthest: "player-control-reached",
        mapId: 38,
        phase: "bedroom_2f",
        readStatus: "available",
        source: "pokemon-red-ram",
        statusFrame: 2817,
        x: 3,
        y: 6,
      },
      stateSource: "new-game",
      verificationFailuresTotal: 1,
      verificationSuccessesTotal: 3,
    });
    expect(summaries[1]).toMatchObject({
      experimentId: "retry-recovery",
      milestoneCurrent: "player-control-reached",
      milestoneFurthest: "first-map-transition",
      mode: "recovery",
      saveStatePath: ".pss-mgba/states/retry.ss0",
      stateSource: "save-state",
    });

    const prometheus = renderRunSummaryPrometheus(summaries);
    expect(prometheus).toContain(
      'pss_mgba_run_avg_tokens_per_turn{run_id="fresh-run",iteration="1",mode="fresh",experiment_id="state-observation"} 100'
    );
    expect(prometheus).toContain(
      'pss_mgba_run_verification_failures_total{run_id="fresh-run",iteration="1",mode="fresh",experiment_id="state-observation"} 1'
    );
    expect(prometheus).toContain(
      'pss_mgba_run_blocked_repeated_actions_total{run_id="fresh-run",iteration="1",mode="fresh",experiment_id="state-observation"} 2'
    );
    expect(prometheus).toContain(
      'pss_mgba_run_milestone_progress_rank{run_id="fresh-run",iteration="1",mode="fresh",experiment_id="state-observation",milestone="player-control-reached",source="milestone-progress-tracker"} 3'
    );
    expect(prometheus).toContain(
      'pss_mgba_run_milestone_progress_ratio{run_id="fresh-run",iteration="1",mode="fresh",experiment_id="state-observation",milestone="player-control-reached",source="milestone-progress-tracker"} 0.375'
    );
    expect(prometheus).toContain(
      'pss_mgba_run_avg_tokens_per_turn{run_id="recovery-run",iteration="2",mode="recovery",experiment_id="retry-recovery"} 75'
    );
    expect(prometheus).toContain(
      'pss_mgba_run_verification_failures_total{run_id="recovery-run",iteration="2",mode="recovery",experiment_id="retry-recovery"} 0'
    );
    expect(prometheus).toContain(
      'pss_mgba_run_blocked_repeated_actions_total{run_id="recovery-run",iteration="2",mode="recovery",experiment_id="retry-recovery"} 0'
    );
    expect(prometheus).toContain(
      'pss_mgba_run_milestone_progress_rank{run_id="recovery-run",iteration="2",mode="recovery",experiment_id="retry-recovery",milestone="first-map-transition",source="run-trace"} 0'
    );
  });

  it("generates a Viridian path run report with milestone, timing, and failure evidence", async () => {
    const root = await mkdtemp(join(tmpdir(), "pss-mgba-viridian-report-"));
    const runsDir = join(root, "runs");
    await writeRun(
      runsDir,
      "partial-run",
      1,
      [100, 100],
      {
        blockedRepeatedActionsTotal: 2,
        experimentId: "controller-primary",
        milestoneCurrent: "stage1-viridian-route-1-entered",
        milestoneFurthest: "stage1-viridian-route-1-entered",
        milestoneProgress: {
          completedRatio: 0.6,
          current: "stage1-viridian-route-1-entered",
          currentRank: 2,
          furthest: "stage1-viridian-route-1-entered",
          furthestRank: 2,
          namespace: "milestone-progress",
          sequenceLength: 5,
          source: "milestone-progress-tracker",
        },
        mode: "fresh",
        startedAt: "2026-06-01T00:00:00.000Z",
        stopReason: "max-steps",
        stuckEvents: 1,
        verificationFailuresTotal: 1,
      },
      [],
      ["2026-06-01T00:00:01.000Z", "2026-06-01T00:00:06.000Z"]
    );
    await writeRun(
      runsDir,
      "viridian-run",
      2,
      [80],
      {
        experimentId: "controller-primary",
        milestoneCurrent: "stage1-viridian-route-1-north-progress",
        milestoneFurthest: "stage1-viridian-route-1-north-progress",
        milestoneProgress: {
          completedRatio: 0.8,
          current: "stage1-viridian-route-1-north-progress",
          currentRank: 3,
          furthest: "stage1-viridian-route-1-north-progress",
          furthestRank: 3,
          namespace: "milestone-progress",
          sequenceLength: 5,
          source: "milestone-progress-tracker",
        },
        mode: "fresh",
        runtimeGameState: {
          battle: false,
          evaluatorMilestone: "stage1-viridian-route-1-north-progress",
          evaluatorMilestoneCurrent: "stage1-viridian-route-1-north-progress",
          evaluatorMilestoneFurthest: "stage1-viridian-route-1-north-progress",
          mapId: 1,
          phase: "viridian",
          readStatus: "available",
          source: "pokemon-red-ram",
          statusFrame: 9120,
          x: 10,
          y: 35,
        },
        startedAt: "2026-06-01T00:01:00.000Z",
        verificationFailuresTotal: 0,
      },
      [],
      ["2026-06-01T00:01:03.000Z"]
    );

    const summaries = await readRunSummaries(runsDir);
    const report = createStage1ViridianRunReport(
      summaries,
      new Date("2026-06-01T00:02:00.000Z")
    );

    expect(report).toMatchObject({
      completedRuns: 1,
      generatedAt: "2026-06-01T00:02:00.000Z",
      runCount: 2,
      targetMilestone: "stage1-viridian-city-reached",
      totalBlockedRepeatedActions: 2,
      totalObservedDurationMs: 5000,
      totalStuckEvents: 1,
      totalVerificationFailures: 1,
    });
    expect(report.runs[0]).toMatchObject({
      completionEvidence: undefined,
      failures: {
        blockedRepeatedActions: 2,
        stuckEvents: 1,
        total: 4,
        verificationFailures: 1,
      },
      milestone: {
        completedRatio: 0.6,
        furthest: "stage1-viridian-route-1-entered",
      },
      stopReason: "max-steps",
      timing: {
        firstMetricAt: "2026-06-01T00:00:01.000Z",
        lastMetricAt: "2026-06-01T00:00:06.000Z",
        observedDurationMs: 5000,
      },
      viridianCompleted: false,
    });
    expect(report.runs[1]).toMatchObject({
      completionEvidence: "runtimeGameState.mapId=1",
      milestone: {
        completedRatio: 1,
      },
      viridianCompleted: true,
    });

    const markdown = renderStage1ViridianRunReportMarkdown(report);
    expect(markdown).toContain("Pokemon Red Stage 1 Viridian Run Report");
    expect(markdown).toContain("Viridian completions: 1");
    expect(markdown).toContain("Observed duration: 5.0s");
    expect(markdown).toContain("Completion evidence: runtimeGameState.mapId=1");
    expect(markdown).toContain(
      "Failures: verification=1, blockedRepeatedActions=2, stuckEvents=1"
    );
  });

  it("reports per-call and aggregate LLM token usage and estimated cost", async () => {
    const root = await mkdtemp(join(tmpdir(), "pss-mgba-summary-llm-"));
    const runsDir = join(root, "runs");
    await writeRun(
      runsDir,
      "llm-run",
      1,
      [1000],
      {
        experimentId: "controller-primary",
        mode: "fresh",
      },
      [
        llmStep({
          inputTokens: 120,
          iteration: 1,
          outputTokens: 30,
          runId: "llm-run",
          step: 1,
          turn: 1,
        }),
        llmStep({
          inputTokens: 80,
          iteration: 1,
          outputTokens: 20,
          runId: "llm-run",
          step: 2,
          turn: 1,
        }),
      ]
    );

    const [summary] = await readRunSummaries(runsDir);

    expect(summary).toMatchObject({
      llmCalls: [
        {
          callMetadata: {
            attempt: 1,
            controlOwner: "llm-fallback",
            edgeKey: "unknown|fallback-analysis|1",
          },
          completionTokens: 30,
          estimatedCostUsd: 0.000_54,
          modelId: "provider:model",
          pricingStatus: "estimated",
          promptTokens: 120,
          totalTokens: 150,
          turn: 1,
        },
        {
          callMetadata: {
            attempt: 2,
            controlOwner: "llm-fallback",
            edgeKey: "unknown|fallback-analysis|2",
          },
          completionTokens: 20,
          estimatedCostUsd: 0.000_36,
          modelId: "provider:model",
          pricingStatus: "estimated",
          promptTokens: 80,
          totalTokens: 100,
          turn: 1,
        },
      ],
      llmEstimatedCostUsd: 0.0009,
      llmPricedCalls: 2,
      llmTokenUsage: {
        inputTokens: 200,
        outputTokens: 50,
        textTokens: 50,
        totalTokens: 250,
      },
      llmUnpricedCalls: 0,
    });
    expect(summary?.llmCalls[0]?.costEstimate).toMatchObject({
      estimatedCostUsd: 0.000_54,
      status: "estimated",
    });

    const prometheus = renderRunSummaryPrometheus(summary ? [summary] : []);
    expect(prometheus).toContain(
      'pss_mgba_run_llm_calls_total{run_id="llm-run",iteration="1",mode="fresh",experiment_id="controller-primary"} 2'
    );
    expect(prometheus).toContain(
      'pss_mgba_run_llm_tokens_total{run_id="llm-run",iteration="1",mode="fresh",experiment_id="controller-primary",kind="input"} 200'
    );
    expect(prometheus).toContain(
      'pss_mgba_run_llm_tokens_total{run_id="llm-run",iteration="1",mode="fresh",experiment_id="controller-primary",kind="total"} 250'
    );
    expect(prometheus).toContain(
      'pss_mgba_run_llm_token_cost_estimated_usd{run_id="llm-run",iteration="1",mode="fresh",experiment_id="controller-primary"} 0.0009'
    );
    expect(prometheus).toContain(
      'pss_mgba_run_llm_token_cost_pricing_calls_total{run_id="llm-run",iteration="1",mode="fresh",experiment_id="controller-primary",kind="priced"} 2'
    );
  });
});
