import {
  createStage1ViridianRunReport,
  readRunSummaries,
  renderStage1ViridianRunReportMarkdown,
} from "./run-summary";

const runs = await readRunSummaries();
if (runs.length === 0) {
  console.log("No pss-mgba run traces found.");
} else {
  console.table(
    runs.map((run) => ({
      iteration: run.iteration,
      runId: run.runId,
      mode: run.mode ?? "",
      experimentId: run.experimentId ?? "",
      milestoneCurrent: run.milestoneCurrent ?? "",
      milestoneFurthest: run.milestoneFurthest ?? "",
      turns: run.turns,
      totalTokens: run.totalTokens.totalTokens,
      avgTokensPerTurn: run.avgTokensPerTurn.toFixed(1),
      avgTokensSavedVsPrevious: run.avgTokensSavedVsPrevious.toFixed(1),
      improvementPercentVsPrevious:
        run.avgTokensImprovementPercentVsPrevious.toFixed(1),
      llmCalls: run.llmCalls.length,
      llmPromptTokens: run.llmTokenUsage.inputTokens,
      llmCompletionTokens: run.llmTokenUsage.outputTokens,
      llmTotalTokens: run.llmTokenUsage.totalTokens,
      llmEstimatedCostUsd: run.llmEstimatedCostUsd.toFixed(6),
      llmPricedCalls: run.llmPricedCalls,
      llmUnpricedCalls: run.llmUnpricedCalls,
    }))
  );
  const llmCallRows = runs.flatMap((run) =>
    run.llmCalls.map((call, index) => ({
      iteration: run.iteration,
      runId: run.runId,
      call: index + 1,
      turn: call.turn,
      step: call.step,
      modelId: call.modelId,
      promptTokens: call.promptTokens,
      completionTokens: call.completionTokens,
      totalTokens: call.totalTokens,
      estimatedCostUsd: call.estimatedCostUsd.toFixed(6),
      pricingStatus: call.pricingStatus,
      controlOwner: call.callMetadata?.controlOwner ?? "",
      edgeKey: call.callMetadata?.edgeKey ?? "",
      attempt: call.callMetadata?.attempt ?? "",
    }))
  );
  if (llmCallRows.length > 0) {
    console.log("LLM token calls:");
    console.table(llmCallRows);
  }
  console.log(
    renderStage1ViridianRunReportMarkdown(createStage1ViridianRunReport(runs))
  );
}
