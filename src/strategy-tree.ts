export type StrategyTreeNodeKind =
  | "global-guidebook"
  | "stage-guidebook"
  | "hypothesis-branch"
  | "run-attempt";

export type StrategyTreeNodeStatus =
  | "active"
  | "promising"
  | "pruned"
  | "proposal";

export interface StrategyTreeRunLike {
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
}

export interface StrategyTreeNode {
  children: StrategyTreeNode[];
  evidence: string[];
  id: string;
  kind: StrategyTreeNodeKind;
  parentId?: string;
  score: number;
  status: StrategyTreeNodeStatus;
  title: string;
}

export interface StrategyTree {
  batchId: string;
  createdAt: string;
  pruningPolicy: {
    maxVerificationFailures: number;
    minProgressScore: number;
    pruneScoreGap: number;
    stuckEventThreshold: number;
  };
  root: StrategyTreeNode;
}

const PRUNING_POLICY = {
  maxVerificationFailures: 0,
  minProgressScore: 1,
  pruneScoreGap: 20,
  stuckEventThreshold: 3,
} as const;

export function buildStrategyTree({
  batchId,
  createdAt,
  runs,
  stageId = "stage1-viridian-route",
}: {
  batchId: string;
  createdAt: string;
  runs: readonly StrategyTreeRunLike[];
  stageId?: string;
}): StrategyTree {
  const bestScore = Math.max(...runs.map((run) => run.score), 0);
  const hypothesisGroups = groupByHypothesis(runs);
  const stageChildren = [...hypothesisGroups.entries()]
    .map(([hypothesis, group]) =>
      hypothesisNode({
        bestScore,
        group,
        hypothesis,
        parentId: `stage:${stageId}`,
      })
    )
    .sort((left, right) => right.score - left.score);

  const stageNode: StrategyTreeNode = {
    children: stageChildren,
    evidence: [
      "Active runtime guidebook branch; later stages must be promoted by evidence.",
    ],
    id: `stage:${stageId}`,
    kind: "stage-guidebook",
    parentId: "guidebook:pokemon-red",
    score: stageChildren[0]?.score ?? 0,
    status: "active",
    title: "Pokemon Red Stage Guidebook",
  };

  return {
    batchId,
    createdAt,
    pruningPolicy: { ...PRUNING_POLICY },
    root: {
      children: [stageNode],
      evidence: [
        "Top-level guidebook aggregates stage guidebooks and promoted strategy branches.",
      ],
      id: "guidebook:pokemon-red",
      kind: "global-guidebook",
      score: stageNode.score,
      status: "active",
      title: "Pokemon Red Global Guidebook",
    },
  };
}

function hypothesisNode({
  bestScore,
  group,
  hypothesis,
  parentId,
}: {
  bestScore: number;
  group: readonly StrategyTreeRunLike[];
  hypothesis: string;
  parentId: string;
}): StrategyTreeNode {
  const score = Math.max(...group.map((run) => run.score));
  const status = branchStatus({ bestScore, group, score });
  const id = `hypothesis:${safeId(hypothesis)}`;
  return {
    children: group
      .map((run) => runNode({ parentId: id, run }))
      .sort((left, right) => right.score - left.score),
    evidence: [
      `runs=${group.length}`,
      `bestScore=${score.toFixed(2)}`,
      `bestMilestone=${bestMilestone(group) ?? "none"}`,
    ],
    id,
    kind: "hypothesis-branch",
    parentId,
    score,
    status,
    title: hypothesis,
  };
}

function runNode({
  parentId,
  run,
}: {
  parentId: string;
  run: StrategyTreeRunLike;
}): StrategyTreeNode {
  return {
    children: [],
    evidence: [
      `milestone=${run.milestoneFurthest ?? "none"}`,
      `progressScore=${run.progressScore}`,
      `transitions=${run.transitions}`,
      `verificationFailures=${run.verificationFailures}`,
      `stuckEvents=${run.stuckEvents}`,
      `fallbackRate=${run.fallbackRate.toFixed(3)}`,
      `tokens=${run.totalTokens}`,
    ],
    id: `run:${safeId(run.runId)}`,
    kind: "run-attempt",
    parentId,
    score: run.score,
    status: runStatus(run),
    title: run.runId,
  };
}

function branchStatus({
  bestScore,
  group,
  score,
}: {
  bestScore: number;
  group: readonly StrategyTreeRunLike[];
  score: number;
}): StrategyTreeNodeStatus {
  if (group.every((run) => runStatus(run) === "pruned")) {
    return "pruned";
  }
  if (score < bestScore - PRUNING_POLICY.pruneScoreGap) {
    return "pruned";
  }
  return score === bestScore ? "promising" : "proposal";
}

function runStatus(run: StrategyTreeRunLike): StrategyTreeNodeStatus {
  if (
    run.progressScore < PRUNING_POLICY.minProgressScore ||
    run.stuckEvents >= PRUNING_POLICY.stuckEventThreshold ||
    run.verificationFailures > PRUNING_POLICY.maxVerificationFailures
  ) {
    return "pruned";
  }
  return "proposal";
}

function groupByHypothesis(
  runs: readonly StrategyTreeRunLike[]
): Map<string, StrategyTreeRunLike[]> {
  const grouped = new Map<string, StrategyTreeRunLike[]>();
  for (const run of runs) {
    const key = run.hypothesis ?? "unknown-hypothesis";
    grouped.set(key, [...(grouped.get(key) ?? []), run]);
  }
  return grouped;
}

function bestMilestone(
  runs: readonly StrategyTreeRunLike[]
): string | undefined {
  return [...runs].sort((left, right) => right.score - left.score)[0]
    ?.milestoneFurthest;
}

function safeId(value: string): string {
  return value.replaceAll(/[^A-Za-z0-9._-]/g, "_");
}
