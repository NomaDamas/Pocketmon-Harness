import { describe, expect, it } from "vitest";
import { buildStrategyTree } from "../src/strategy-tree";

describe("strategy tree", () => {
  it("builds a hierarchy from global guidebook to stage, hypothesis, and run attempts", () => {
    const tree = buildStrategyTree({
      batchId: "batch-a",
      createdAt: "2026-06-07T00:00:00.000Z",
      runs: [
        {
          fallbackRate: 0,
          hypothesis: "pathfinder-first",
          milestoneFurthest: "first-map-transition",
          progressScore: 20,
          runId: "run-a",
          score: 25,
          stuckEvents: 0,
          totalTokens: 1000,
          transitions: 1,
          verificationFailures: 0,
        },
        {
          fallbackRate: 0.8,
          hypothesis: "wall-probing",
          milestoneFurthest: "player-control-reached",
          progressScore: 10,
          runId: "run-b",
          score: -5,
          stuckEvents: 3,
          totalTokens: 100_000,
          transitions: 0,
          verificationFailures: 1,
        },
      ],
    });

    expect(tree.root).toMatchObject({
      id: "guidebook:pokemon-red",
      kind: "global-guidebook",
      status: "active",
    });
    const stage = tree.root.children[0];
    expect(stage).toMatchObject({
      id: "stage:stage1-viridian-route",
      kind: "stage-guidebook",
      status: "active",
    });
    expect(stage?.children.map((node) => [node.title, node.status])).toEqual([
      ["pathfinder-first", "promising"],
      ["wall-probing", "pruned"],
    ]);
    expect(stage?.children[1]?.children[0]).toMatchObject({
      id: "run:run-b",
      status: "pruned",
    });
  });
});
