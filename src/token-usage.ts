import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AgentModel } from "@minpeter/pss-runtime";
import {
  type LanguageModelMiddleware,
  type LanguageModelUsage,
  wrapLanguageModel,
} from "ai";

export interface TokenUsageTrackerOptions {
  iteration?: number;
  metricsDir?: string;
  modelPricing?: TokenPricingCatalog;
  onMetric?: (metric: TokenUsageMetric) => void;
  prometheusPath?: string;
  runId?: string;
}

export interface TokenUsageSnapshot {
  cacheReadTokens: number;
  cacheWriteTokens: number;
  inputTokens: number;
  noCacheTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  textTokens: number;
  totalTokens: number;
}

export type TokenUsageCallMetadata = Record<
  string,
  boolean | number | string | undefined
>;

export type TokenPricingCatalog = Record<string, ModelTokenPricing>;

export interface ModelTokenPricing {
  cacheReadUsdPerMillionTokens?: number;
  cacheWriteUsdPerMillionTokens?: number;
  inputUsdPerMillionTokens: number;
  outputUsdPerMillionTokens: number;
}

export interface TokenCostEstimate {
  cacheReadCostUsd: number;
  cacheWriteCostUsd: number;
  currency: "USD";
  estimatedCostUsd: number;
  inputCostUsd: number;
  matchedModelId?: string;
  modelId: string;
  outputCostUsd: number;
  pricing: ModelTokenPricing | undefined;
  status: "estimated" | "unpriced";
}

export interface TokenCostMetricsSnapshot {
  lastCostEstimate: TokenCostEstimate | undefined;
  namespace: "token-cost";
  pricedCalls: number;
  source: "token-usage-tracker";
  step: number;
  totalEstimatedCostUsd: number;
  totalUsage: TokenUsageSnapshot;
  turn: number;
  turnEstimatedCostUsd: number;
  turnUsage: TokenUsageSnapshot;
  unpricedCalls: number;
}

export interface TokenUsageTrackerSnapshot {
  iteration: number;
  runId: string;
  tokenCost: TokenCostMetricsSnapshot;
}

export type TokenUsageMetric =
  | {
      callMetadata?: TokenUsageCallMetadata;
      completionTokens?: number;
      iteration: number;
      modelId: string;
      modelName?: string;
      promptTokens?: number;
      runId: string;
      schemaVersion: 1;
      step: number;
      timestamp: string;
      totalTokens?: number;
      turn: number;
      type: "llm-step";
      usage: TokenUsageSnapshot;
      costEstimate?: TokenCostEstimate;
    }
  | {
      iteration: number;
      runId: string;
      schemaVersion: 1;
      steps: number;
      timestamp: string;
      turn: number;
      type: "turn-summary";
      usage: TokenUsageSnapshot;
    };

interface CreateTrackedModelOptions {
  model: AgentModel;
  tracker: TokenUsageTracker;
}

interface ProviderUsage {
  inputTokens: {
    cacheRead: number | undefined;
    cacheWrite: number | undefined;
    noCache: number | undefined;
    total: number | undefined;
  };
  outputTokens: {
    reasoning: number | undefined;
    text: number | undefined;
    total: number | undefined;
  };
}

const DEFAULT_METRICS_DIR = ".pss-mgba/metrics";

export const DEFAULT_MODEL_TOKEN_PRICING: TokenPricingCatalog = {
  "gpt-5.3-codex-spark": {
    cacheReadUsdPerMillionTokens: 0.125,
    inputUsdPerMillionTokens: 1.25,
    outputUsdPerMillionTokens: 10,
  },
  "gpt-5.5": {
    cacheReadUsdPerMillionTokens: 0.125,
    inputUsdPerMillionTokens: 1.25,
    outputUsdPerMillionTokens: 10,
  },
  "grok-3-mini-fast": {
    inputUsdPerMillionTokens: 0.3,
    outputUsdPerMillionTokens: 0.5,
  },
  "grok-4.3": {
    inputUsdPerMillionTokens: 3,
    outputUsdPerMillionTokens: 15,
  },
};

export class TokenUsageTracker {
  readonly #jsonlPath: string;
  readonly #onMetric?: (metric: TokenUsageMetric) => void;
  readonly #prometheusPath: string;
  readonly #runId: string;
  readonly #iteration: number;
  readonly #modelPricing: TokenPricingCatalog;
  #currentStep = 0;
  #currentTurn = 0;
  #activeCallMetadata: TokenUsageCallMetadata | undefined;
  #lastCostEstimate: TokenCostEstimate | undefined;
  #pricedCalls = 0;
  #totalEstimatedCostUsd = 0;
  #totalUsage = emptyUsage();
  #turnEstimatedCostUsd = 0;
  #turnUsage = emptyUsage();
  #unpricedCalls = 0;

  constructor({
    iteration = 0,
    metricsDir = DEFAULT_METRICS_DIR,
    modelPricing,
    onMetric,
    prometheusPath = join(DEFAULT_METRICS_DIR, "token-usage.prom"),
    runId = "unknown",
  }: TokenUsageTrackerOptions = {}) {
    this.#jsonlPath = join(metricsDir, "token-usage.jsonl");
    this.#prometheusPath = prometheusPath;
    this.#onMetric = onMetric;
    this.#runId = runId;
    this.#iteration = iteration;
    this.#modelPricing = { ...DEFAULT_MODEL_TOKEN_PRICING, ...modelPricing };
  }

  startTurn(turn: number): void {
    this.#currentTurn = turn;
    this.#currentStep = 0;
    this.#turnEstimatedCostUsd = 0;
    this.#turnUsage = emptyUsage();
  }

  setActiveCallMetadata(metadata: TokenUsageCallMetadata): void {
    this.#activeCallMetadata = { ...metadata };
  }

  clearActiveCallMetadata(): void {
    this.#activeCallMetadata = undefined;
  }

  currentTurnUsage(): TokenUsageSnapshot {
    return { ...this.#turnUsage };
  }

  async recordLlmStep(
    usage: LanguageModelUsage,
    {
      callMetadata,
      modelId,
    }: { callMetadata?: TokenUsageCallMetadata; modelId: string }
  ): Promise<void> {
    await this.recordUsageSnapshot(normalizeUsage(usage), {
      callMetadata,
      modelId,
    });
  }

  async recordProviderUsage(
    usage: ProviderUsage,
    {
      callMetadata,
      modelId,
    }: { callMetadata?: TokenUsageCallMetadata; modelId: string }
  ): Promise<void> {
    await this.recordUsageSnapshot(normalizeProviderUsage(usage), {
      callMetadata,
      modelId,
    });
  }

  async recordUsageSnapshot(
    snapshot: TokenUsageSnapshot,
    {
      callMetadata,
      modelId,
    }: { callMetadata?: TokenUsageCallMetadata; modelId: string }
  ): Promise<void> {
    this.#currentStep += 1;
    this.#turnUsage = addUsage(this.#turnUsage, snapshot);
    this.#totalUsage = addUsage(this.#totalUsage, snapshot);
    const resolvedCallMetadata = callMetadata ?? this.#activeCallMetadata;
    const costEstimate = estimateTokenCost(snapshot, modelId, {
      modelPricing: this.#modelPricing,
    });
    this.#lastCostEstimate = costEstimate;
    if (costEstimate.status === "estimated") {
      this.#pricedCalls += 1;
    } else {
      this.#unpricedCalls += 1;
    }
    this.#turnEstimatedCostUsd += costEstimate.estimatedCostUsd;
    this.#totalEstimatedCostUsd += costEstimate.estimatedCostUsd;

    await this.#writeMetric({
      ...(resolvedCallMetadata
        ? { callMetadata: { ...resolvedCallMetadata } }
        : {}),
      completionTokens: snapshot.outputTokens,
      costEstimate,
      iteration: this.#iteration,
      modelId,
      modelName: modelId,
      promptTokens: snapshot.inputTokens,
      runId: this.#runId,
      schemaVersion: 1,
      step: this.#currentStep,
      timestamp: new Date().toISOString(),
      totalTokens: snapshot.totalTokens,
      turn: this.#currentTurn,
      type: "llm-step",
      usage: snapshot,
    });
  }

  async endTurn(): Promise<void> {
    await this.#writeMetric({
      iteration: this.#iteration,
      runId: this.#runId,
      schemaVersion: 1,
      steps: this.#currentStep,
      timestamp: new Date().toISOString(),
      turn: this.#currentTurn,
      type: "turn-summary",
      usage: this.#turnUsage,
    });
  }

  prometheusMetrics(): string {
    return renderPrometheus(this.snapshot());
  }

  snapshot(): TokenUsageTrackerSnapshot {
    const tokenCost: TokenCostMetricsSnapshot = {
      lastCostEstimate: this.#lastCostEstimate
        ? cloneCostEstimate(this.#lastCostEstimate)
        : undefined,
      namespace: "token-cost",
      pricedCalls: this.#pricedCalls,
      source: "token-usage-tracker",
      step: this.#currentStep,
      totalEstimatedCostUsd: this.#totalEstimatedCostUsd,
      totalUsage: this.#totalUsage,
      turn: this.#currentTurn,
      turnEstimatedCostUsd: this.#turnEstimatedCostUsd,
      turnUsage: this.#turnUsage,
      unpricedCalls: this.#unpricedCalls,
    };

    return {
      iteration: this.#iteration,
      runId: this.#runId,
      tokenCost,
    };
  }

  async #writeMetric(metric: TokenUsageMetric): Promise<void> {
    this.#onMetric?.(metric);
    await Promise.all([
      mkdir(dirname(this.#jsonlPath), { recursive: true }),
      mkdir(dirname(this.#prometheusPath), { recursive: true }),
    ]);
    await appendFile(this.#jsonlPath, `${JSON.stringify(metric)}\n`);
    await writeFile(this.#prometheusPath, this.prometheusMetrics());
  }
}

export function estimateTokenCost(
  usage: TokenUsageSnapshot,
  modelId: string,
  {
    modelPricing = DEFAULT_MODEL_TOKEN_PRICING,
  }: { modelPricing?: TokenPricingCatalog } = {}
): TokenCostEstimate {
  const resolved = resolveModelPricing(modelId, modelPricing);
  const pricing = resolved?.pricing;
  if (!pricing) {
    return {
      cacheReadCostUsd: 0,
      cacheWriteCostUsd: 0,
      currency: "USD",
      estimatedCostUsd: 0,
      inputCostUsd: 0,
      modelId,
      outputCostUsd: 0,
      pricing: undefined,
      status: "unpriced",
    };
  }

  const cacheReadTokens = usage.cacheReadTokens;
  const cacheWriteTokens = usage.cacheWriteTokens;
  const hasCacheBreakdown = cacheReadTokens > 0 || cacheWriteTokens > 0;
  const noCacheTokens =
    usage.noCacheTokens > 0
      ? usage.noCacheTokens
      : Math.max(0, usage.inputTokens - cacheReadTokens - cacheWriteTokens);
  const billableInputTokens = hasCacheBreakdown
    ? noCacheTokens
    : usage.inputTokens;
  const inputCostUsd = perMillionCost(
    billableInputTokens,
    pricing.inputUsdPerMillionTokens
  );
  const outputCostUsd = perMillionCost(
    usage.outputTokens,
    pricing.outputUsdPerMillionTokens
  );
  const cacheReadCostUsd = perMillionCost(
    cacheReadTokens,
    pricing.cacheReadUsdPerMillionTokens ?? pricing.inputUsdPerMillionTokens
  );
  const cacheWriteCostUsd = perMillionCost(
    cacheWriteTokens,
    pricing.cacheWriteUsdPerMillionTokens ?? pricing.inputUsdPerMillionTokens
  );

  return {
    cacheReadCostUsd,
    cacheWriteCostUsd,
    currency: "USD",
    estimatedCostUsd: roundUsd(
      inputCostUsd + outputCostUsd + cacheReadCostUsd + cacheWriteCostUsd
    ),
    inputCostUsd,
    matchedModelId: resolved.modelId,
    modelId,
    outputCostUsd,
    pricing,
    status: "estimated",
  };
}

export function createTrackedModel({
  model,
  tracker,
}: CreateTrackedModelOptions): AgentModel {
  return wrapLanguageModel({
    model: model as never,
    middleware: createTokenUsageMiddleware(tracker),
  }) as AgentModel;
}

function createTokenUsageMiddleware(
  tracker: TokenUsageTracker
): LanguageModelMiddleware {
  return {
    wrapGenerate: async ({ doGenerate, model }) => {
      const result = await doGenerate();
      await tracker.recordProviderUsage(result.usage, {
        modelId: `${model.provider}:${model.modelId}`,
      });
      return result;
    },
  };
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

function normalizeUsage(usage: LanguageModelUsage): TokenUsageSnapshot {
  return {
    cacheReadTokens: tokenCount(usage.inputTokenDetails.cacheReadTokens),
    cacheWriteTokens: tokenCount(usage.inputTokenDetails.cacheWriteTokens),
    inputTokens: tokenCount(usage.inputTokens),
    noCacheTokens: tokenCount(usage.inputTokenDetails.noCacheTokens),
    outputTokens: tokenCount(usage.outputTokens),
    reasoningTokens: tokenCount(usage.outputTokenDetails.reasoningTokens),
    textTokens: tokenCount(usage.outputTokenDetails.textTokens),
    totalTokens: tokenCount(usage.totalTokens),
  };
}

function normalizeProviderUsage(usage: ProviderUsage): TokenUsageSnapshot {
  return {
    cacheReadTokens: tokenCount(usage.inputTokens.cacheRead),
    cacheWriteTokens: tokenCount(usage.inputTokens.cacheWrite),
    inputTokens: tokenCount(usage.inputTokens.total),
    noCacheTokens: tokenCount(usage.inputTokens.noCache),
    outputTokens: tokenCount(usage.outputTokens.total),
    reasoningTokens: tokenCount(usage.outputTokens.reasoning),
    textTokens: tokenCount(usage.outputTokens.text),
    totalTokens:
      tokenCount(usage.inputTokens.total) +
      tokenCount(usage.outputTokens.total),
  };
}

function tokenCount(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
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

function cloneCostEstimate(estimate: TokenCostEstimate): TokenCostEstimate {
  return {
    ...estimate,
    pricing: estimate.pricing ? { ...estimate.pricing } : undefined,
  };
}

function perMillionCost(tokens: number, usdPerMillionTokens: number): number {
  return roundUsd((tokens / 1_000_000) * usdPerMillionTokens);
}

function roundUsd(value: number): number {
  return Math.round(value * 1_000_000_000_000) / 1_000_000_000_000;
}

function resolveModelPricing(
  modelId: string,
  modelPricing: TokenPricingCatalog
): { modelId: string; pricing: ModelTokenPricing } | undefined {
  const direct = modelPricing[modelId];
  if (direct) {
    return { modelId, pricing: direct };
  }

  const shortModelId = modelId.includes(":")
    ? modelId.slice(modelId.lastIndexOf(":") + 1)
    : modelId;
  const short = modelPricing[shortModelId];
  return short ? { modelId: shortModelId, pricing: short } : undefined;
}

function renderPrometheus({
  iteration,
  runId,
  tokenCost,
}: ReturnType<TokenUsageTracker["snapshot"]>): string {
  const { step, totalUsage, turn, turnUsage } = tokenCost;
  return [
    "# HELP pss_mgba_run_iteration Current run iteration number.",
    "# TYPE pss_mgba_run_iteration gauge",
    `pss_mgba_run_iteration${labels({ iteration, runId })} ${iteration}`,
    "# HELP pss_mgba_turn_current Current autonomous loop turn.",
    "# TYPE pss_mgba_turn_current gauge",
    `pss_mgba_turn_current${labels({ iteration, runId })} ${turn}`,
    "# HELP pss_mgba_step_current Current model step within the turn.",
    "# TYPE pss_mgba_step_current gauge",
    `pss_mgba_step_current${labels({ iteration, runId })} ${step}`,
    "# HELP pss_mgba_turn_tokens Tokens used in the current turn by kind.",
    "# TYPE pss_mgba_turn_tokens gauge",
    ...usageLines("pss_mgba_turn_tokens", turnUsage, { iteration, runId }),
    "# HELP pss_mgba_tokens_total Cumulative tokens used by kind.",
    "# TYPE pss_mgba_tokens_total counter",
    ...usageLines("pss_mgba_tokens_total", totalUsage, { iteration, runId }),
    "# HELP pss_mgba_token_cost_usd Estimated model token cost in USD.",
    "# TYPE pss_mgba_token_cost_usd gauge",
    `pss_mgba_token_cost_usd${labels({ iteration, kind: "turn", runId })} ${tokenCost.turnEstimatedCostUsd}`,
    `pss_mgba_token_cost_usd${labels({ iteration, kind: "total", runId })} ${tokenCost.totalEstimatedCostUsd}`,
    "# HELP pss_mgba_token_cost_calls_total Token usage calls by pricing resolution status.",
    "# TYPE pss_mgba_token_cost_calls_total counter",
    `pss_mgba_token_cost_calls_total${labels({ iteration, kind: "priced", runId })} ${tokenCost.pricedCalls}`,
    `pss_mgba_token_cost_calls_total${labels({ iteration, kind: "unpriced", runId })} ${tokenCost.unpricedCalls}`,
    "",
  ].join("\n");
}

function escapeLabel(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function labels({
  iteration,
  kind,
  runId,
}: {
  iteration: number;
  kind?: string;
  runId: string;
}): string {
  const entries = [
    `run_id="${escapeLabel(runId)}"`,
    `iteration="${iteration}"`,
  ];
  if (kind) {
    entries.push(`kind="${escapeLabel(kind)}"`);
  }
  return `{${entries.join(",")}}`;
}

function usageLines(
  metricName: string,
  usage: TokenUsageSnapshot,
  context: { iteration: number; runId: string }
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
    return `${metricName}${labels({ ...context, kind })} ${value}`;
  });
}
