import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LanguageModelUsage } from "ai";
import { describe, expect, it } from "vitest";
import { estimateTokenCost, TokenUsageTracker } from "../src/token-usage";

function usage(partial: Partial<LanguageModelUsage>): LanguageModelUsage {
  return {
    inputTokenDetails: {
      cacheReadTokens: undefined,
      cacheWriteTokens: undefined,
      noCacheTokens: undefined,
    },
    inputTokens: undefined,
    outputTokenDetails: {
      reasoningTokens: undefined,
      textTokens: undefined,
    },
    outputTokens: undefined,
    totalTokens: undefined,
    ...partial,
  };
}

describe("TokenUsageTracker", () => {
  it("writes per-step JSONL and Prometheus token metrics", async () => {
    const metricsDir = await mkdtemp(join(tmpdir(), "pss-mgba-metrics-"));
    const observed: unknown[] = [];
    const tracker = new TokenUsageTracker({
      iteration: 9,
      metricsDir,
      modelPricing: {
        "provider:model": {
          inputUsdPerMillionTokens: 2,
          outputUsdPerMillionTokens: 10,
        },
      },
      onMetric: (metric) => observed.push(metric),
      prometheusPath: join(metricsDir, "token-usage.prom"),
      runId: "run-9",
    });

    tracker.startTurn(3);
    await tracker.recordLlmStep(
      usage({
        inputTokens: 10,
        outputTokenDetails: { reasoningTokens: 2, textTokens: 5 },
        outputTokens: 7,
        totalTokens: 17,
      }),
      {
        callMetadata: {
          attempt: 1,
          callPath: "bounded-llm-fallback",
          controlOwner: "llm-fallback",
          edgeKey: "unknown|fallback-analysis",
          timeoutMs: 15_000,
        },
        modelId: "provider:model",
      }
    );
    await tracker.endTurn();

    const jsonl = await readFile(join(metricsDir, "token-usage.jsonl"), "utf8");
    expect(jsonl.trim().split("\n")).toHaveLength(2);
    const llmStepMetric = JSON.parse(jsonl.trim().split("\n")[0] ?? "{}");
    expect(llmStepMetric).toMatchObject({
      iteration: 9,
      callMetadata: {
        attempt: 1,
        callPath: "bounded-llm-fallback",
        controlOwner: "llm-fallback",
        edgeKey: "unknown|fallback-analysis",
        timeoutMs: 15_000,
      },
      completionTokens: 7,
      modelId: "provider:model",
      modelName: "provider:model",
      promptTokens: 10,
      runId: "run-9",
      step: 1,
      totalTokens: 17,
      turn: 3,
      type: "llm-step",
      usage: { inputTokens: 10, outputTokens: 7, totalTokens: 17 },
      costEstimate: {
        currency: "USD",
        matchedModelId: "provider:model",
        status: "estimated",
      },
    });
    expect(llmStepMetric.costEstimate.estimatedCostUsd).toBeCloseTo(0.000_09);
    expect(observed).toHaveLength(2);

    const prometheus = await readFile(
      join(metricsDir, "token-usage.prom"),
      "utf8"
    );
    expect(prometheus).toContain(
      'pss_mgba_run_iteration{run_id="run-9",iteration="9"} 9'
    );
    expect(prometheus).toContain(
      'pss_mgba_turn_current{run_id="run-9",iteration="9"} 3'
    );
    expect(prometheus).toContain(
      'pss_mgba_tokens_total{run_id="run-9",iteration="9",kind="total"} 17'
    );
    expect(prometheus).toContain(
      'pss_mgba_turn_tokens{run_id="run-9",iteration="9",kind="reasoning"} 2'
    );
    expect(prometheus).toContain(
      'pss_mgba_token_cost_usd{run_id="run-9",iteration="9",kind="total"} 0.00009'
    );
    expect(prometheus).toContain(
      'pss_mgba_token_cost_calls_total{run_id="run-9",iteration="9",kind="priced"} 1'
    );

    const snapshot = tracker.snapshot();
    expect(snapshot).not.toHaveProperty("step");
    expect(snapshot).not.toHaveProperty("totalUsage");
    expect(snapshot).not.toHaveProperty("turn");
    expect(snapshot).not.toHaveProperty("turnUsage");
    expect(snapshot.tokenCost).toMatchObject({
      namespace: "token-cost",
      pricedCalls: 1,
      source: "token-usage-tracker",
      step: 1,
      totalEstimatedCostUsd: 0.000_09,
      totalUsage: { inputTokens: 10, outputTokens: 7, totalTokens: 17 },
      turn: 3,
      turnEstimatedCostUsd: 0.000_09,
      turnUsage: { inputTokens: 10, outputTokens: 7, totalTokens: 17 },
      unpricedCalls: 0,
    });
    expect(snapshot.tokenCost.lastCostEstimate).toMatchObject({
      matchedModelId: "provider:model",
      modelId: "provider:model",
      status: "estimated",
    });
    expect(snapshot.tokenCost.lastCostEstimate?.estimatedCostUsd).toBeCloseTo(
      0.000_09
    );
  });

  it("estimates per-call cost from model pricing and token usage", () => {
    const estimate = estimateTokenCost(
      {
        cacheReadTokens: 20,
        cacheWriteTokens: 10,
        inputTokens: 100,
        noCacheTokens: 70,
        outputTokens: 25,
        reasoningTokens: 10,
        textTokens: 15,
        totalTokens: 125,
      },
      "provider:fast-model",
      {
        modelPricing: {
          "fast-model": {
            cacheReadUsdPerMillionTokens: 0.5,
            cacheWriteUsdPerMillionTokens: 1.5,
            inputUsdPerMillionTokens: 2,
            outputUsdPerMillionTokens: 8,
          },
        },
      }
    );

    expect(estimate).toMatchObject({
      cacheReadCostUsd: 0.000_01,
      cacheWriteCostUsd: 0.000_015,
      currency: "USD",
      inputCostUsd: 0.000_14,
      matchedModelId: "fast-model",
      modelId: "provider:fast-model",
      outputCostUsd: 0.0002,
      status: "estimated",
    });
    expect(estimate.estimatedCostUsd).toBeCloseTo(0.000_365);
  });

  it("marks unknown model pricing as unpriced instead of inventing cost", () => {
    expect(
      estimateTokenCost(
        {
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          inputTokens: 100,
          noCacheTokens: 100,
          outputTokens: 50,
          reasoningTokens: 0,
          textTokens: 50,
          totalTokens: 150,
        },
        "provider:unknown-model",
        { modelPricing: {} }
      )
    ).toMatchObject({
      currency: "USD",
      estimatedCostUsd: 0,
      modelId: "provider:unknown-model",
      pricing: undefined,
      status: "unpriced",
    });
  });
});
