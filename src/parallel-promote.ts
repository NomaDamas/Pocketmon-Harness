import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ParallelBatchProposal } from "./parallel-improvement";

const DEFAULT_ACTIVE_HIERARCHY_DIR = ".pss-mgba/active-hierarchy";
const DEFAULT_CANDIDATES_DIR = ".pss-mgba/candidates";
const DEFAULT_STRATEGY_BOOK_PATH = ".pss-mgba/strategy-book.json";

export interface PromoteResult {
  activeHierarchyPath?: string;
  applied: boolean;
  batchId: string;
  blocked: boolean;
  message: string;
  proposalPath: string;
  requiredNextStep: string;
  strategyBookPath?: string;
}

interface PromoteOptions {
  activeHierarchyDir?: string;
  apply?: boolean;
  candidatesDir?: string;
  strategyBookPath?: string;
}

interface PromotedStrategyEntry {
  action: string;
  batchId: string;
  candidateIds: string[];
  evidenceCount: number;
  lastSeenAt: string;
  promoted: boolean;
  recommendation: string;
  sourceRuns: string[];
}

interface StrategyBook {
  generatedAt: string | null;
  promotionThreshold: number | null;
  strategies: PromotedStrategyEntry[];
}

if (isMainModule()) {
  const batchId = readArg("--batch");
  if (!batchId) {
    throw new Error(
      "Usage: pnpm improve:promote -- --batch <batch-id> [--apply]"
    );
  }
  const result = await promoteParallelProposal(batchId, {
    apply: process.argv.includes("--apply"),
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

export function inspectPromoteCandidate(
  batchId: string,
  candidatesDir = DEFAULT_CANDIDATES_DIR
): Promise<PromoteResult> {
  return promoteParallelProposal(batchId, { apply: false, candidatesDir });
}

export async function promoteParallelProposal(
  batchId: string,
  {
    activeHierarchyDir = DEFAULT_ACTIVE_HIERARCHY_DIR,
    apply = false,
    candidatesDir = DEFAULT_CANDIDATES_DIR,
    strategyBookPath = DEFAULT_STRATEGY_BOOK_PATH,
  }: PromoteOptions = {}
): Promise<PromoteResult> {
  const proposalPath = join(candidatesDir, batchId, "proposal.json");
  const proposal = JSON.parse(
    await readFile(proposalPath, "utf8")
  ) as ParallelBatchProposal;
  const blockedReasons = promotionBlockers(proposal);

  if (blockedReasons.length > 0) {
    return {
      applied: false,
      batchId,
      blocked: true,
      message: `Promotion blocked by QA gate: ${blockedReasons.join("; ")}`,
      proposalPath,
      requiredNextStep:
        "Collect stronger parallel evidence, rerun improve:parallel, then retry explicit promote.",
    };
  }

  if (!apply) {
    return {
      applied: false,
      batchId,
      blocked: true,
      message:
        "Promotion is QA-eligible but not applied. Re-run with --apply to update the active strategy hierarchy.",
      proposalPath,
      requiredNextStep:
        "Run pnpm improve:promote -- --batch <batch-id> --apply after review.",
    };
  }

  const activeHierarchyPath = join(activeHierarchyDir, `${batchId}.json`);
  const promotedAt = new Date().toISOString();
  const activeRecord = {
    batchId,
    promotedAt,
    proposalPath,
    recommendations: proposal.recommendations,
    runs: proposal.runs,
    source: "parallel-improvement",
    status: "promoted",
  };
  await mkdir(dirname(activeHierarchyPath), { recursive: true });
  await writeFile(
    activeHierarchyPath,
    `${JSON.stringify(activeRecord, null, 2)}\n`
  );

  const strategyBook = await readStrategyBook(strategyBookPath);
  const promotedEntries = entriesFromProposal(proposal, promotedAt);
  const merged = mergeStrategyEntries(strategyBook.strategies, promotedEntries);
  const nextBook = {
    ...strategyBook,
    generatedAt: promotedAt,
    strategies: merged,
  };
  await mkdir(dirname(strategyBookPath), { recursive: true });
  await writeFile(strategyBookPath, `${JSON.stringify(nextBook, null, 2)}\n`);

  return {
    activeHierarchyPath,
    applied: true,
    batchId,
    blocked: false,
    message:
      "Promotion applied to active hierarchy overlay and viewer strategy book.",
    proposalPath,
    requiredNextStep:
      "Run focused tests/replay before converting promoted strategy entries into code-level route/rule changes.",
    strategyBookPath,
  };
}

function promotionBlockers(proposal: ParallelBatchProposal): string[] {
  const reasons = [...(proposal.qaGate.reasons ?? [])];
  if (proposal.qaGate.blocked) {
    reasons.unshift("proposal qaGate is blocked");
  }
  if (proposal.summary.runCount < 2) {
    reasons.push("needs at least two independent runs");
  }
  if (!proposal.summary.bestRunId) {
    reasons.push("missing best run");
  }
  if (
    proposal.recommendations.pathfinderPatches.length === 0 &&
    proposal.recommendations.rules.length === 0 &&
    proposal.recommendations.skills.length === 0
  ) {
    reasons.push("proposal contains no recommendations to promote");
  }
  return [...new Set(reasons)];
}

function entriesFromProposal(
  proposal: ParallelBatchProposal,
  promotedAt: string
): PromotedStrategyEntry[] {
  const entries = [
    ...proposal.recommendations.pathfinderPatches.map((item, index) =>
      strategyEntry(proposal, item, `pathfinder:${index}`, promotedAt)
    ),
    ...proposal.recommendations.rules.map((item, index) =>
      strategyEntry(proposal, item, `rule:${index}`, promotedAt)
    ),
    ...proposal.recommendations.skills.map((item, index) =>
      strategyEntry(proposal, item, `skill:${index}`, promotedAt)
    ),
  ];
  return entries;
}

function strategyEntry(
  proposal: ParallelBatchProposal,
  item: unknown,
  fallbackAction: string,
  promotedAt: string
): PromotedStrategyEntry {
  const record = isRecord(item) ? item : {};
  const action =
    stringField(record, "type") ??
    stringField(record, "ruleId") ??
    stringField(record, "hypothesis") ??
    fallbackAction;
  const evidenceRunId =
    stringField(record, "evidenceRunId") ?? proposal.summary.bestRunId;
  return {
    action,
    batchId: proposal.batchId,
    candidateIds: [`parallel:${proposal.batchId}:${fallbackAction}`],
    evidenceCount: Math.max(1, proposal.runs.length),
    lastSeenAt: promotedAt,
    promoted: true,
    recommendation:
      stringField(record, "note") ??
      `Promoted parallel batch ${proposal.batchId} recommendation.`,
    sourceRuns: evidenceRunId ? [evidenceRunId] : [],
  };
}

function mergeStrategyEntries(
  existing: readonly PromotedStrategyEntry[],
  promoted: readonly PromotedStrategyEntry[]
): PromotedStrategyEntry[] {
  const byAction = new Map<string, PromotedStrategyEntry>();
  for (const entry of existing) {
    byAction.set(entry.action, { ...entry });
  }
  for (const entry of promoted) {
    const previous = byAction.get(entry.action);
    if (!previous) {
      byAction.set(entry.action, { ...entry });
      continue;
    }
    byAction.set(entry.action, {
      ...previous,
      batchId: entry.batchId,
      candidateIds: unique([...previous.candidateIds, ...entry.candidateIds]),
      evidenceCount: previous.evidenceCount + entry.evidenceCount,
      lastSeenAt: entry.lastSeenAt,
      promoted: true,
      recommendation: entry.recommendation,
      sourceRuns: unique([...previous.sourceRuns, ...entry.sourceRuns]),
    });
  }
  return [...byAction.values()].sort(
    (left, right) => right.evidenceCount - left.evidenceCount
  );
}

async function readStrategyBook(path: string): Promise<StrategyBook> {
  const raw = await readFile(path, "utf8").catch(() => "");
  if (!raw.trim()) {
    return {
      generatedAt: null,
      promotionThreshold: null,
      strategies: [],
    };
  }
  const parsed = JSON.parse(raw) as Partial<StrategyBook>;
  return {
    generatedAt: parsed.generatedAt ?? null,
    promotionThreshold: parsed.promotionThreshold ?? null,
    strategies: Array.isArray(parsed.strategies)
      ? parsed.strategies.map((entry) => normalizeStrategyEntry(entry))
      : [],
  };
}

function normalizeStrategyEntry(input: unknown): PromotedStrategyEntry {
  const record = isRecord(input) ? input : {};
  return {
    action: stringField(record, "action") ?? "unknown",
    batchId: stringField(record, "batchId") ?? "trace-candidate",
    candidateIds: stringArrayField(record, "candidateIds"),
    evidenceCount: numberField(record, "evidenceCount") ?? 0,
    lastSeenAt: stringField(record, "lastSeenAt") ?? new Date(0).toISOString(),
    promoted: booleanField(record, "promoted") ?? false,
    recommendation: stringField(record, "recommendation") ?? "",
    sourceRuns: stringArrayField(record, "sourceRuns"),
  };
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function stringField(
  record: Record<string, unknown>,
  key: string
): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberField(
  record: Record<string, unknown>,
  key: string
): number | undefined {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function booleanField(
  record: Record<string, unknown>,
  key: string
): boolean | undefined {
  const value = record[key];
  return typeof value === "boolean" ? value : undefined;
}

function stringArrayField(
  record: Record<string, unknown>,
  key: string
): string[] {
  const value = record[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readArg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function isMainModule(): boolean {
  return process.argv[1]?.endsWith("/parallel-promote.ts") ?? false;
}
