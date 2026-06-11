import { describe, expect, it } from "vitest";
import { formatStage1RuntimePlan } from "../src/stage1-runtime-plan";
import { rivalBattleObservation } from "./fixtures/rival-battle-states";

describe("formatStage1RuntimePlan", () => {
  it("injects Rule Memory Read with a route-following skill on the Stage 1 route", () => {
    const text = formatStage1RuntimePlan({
      state: {
        battle: false,
        battleResult: null,
        battleType: null,
        dialogueLike: "visual-fallback",
        direction: "up",
        mapId: 12,
        menuLike: "visual-fallback",
        position: { x: 5, y: 8 },
        readStatus: "available",
      },
    });

    expect(text).toContain("Stage 1 Rule Memory Read");
    expect(text).toContain(
      "recommended skill: skill:route-1.follow-north-path"
    );
    expect(text).toContain("recommended action: mgba_hold Up");
    expect(text).toContain("never reset, reload, or delete saves");
  });

  it("switches to lateral recovery after a 3-attempt loop signal", () => {
    const text = formatStage1RuntimePlan({
      state: {
        battle: false,
        battleResult: null,
        battleType: null,
        dialogueLike: "visual-fallback",
        direction: "up",
        mapId: 12,
        menuLike: "visual-fallback",
        position: { x: 5, y: 8 },
        readStatus: "available",
      },
      stuckMemory: {
        failedMovementEdges: [
          {
            action: "hold: Up",
            attempts: 3,
            context: "map=12,x=5,y=8",
            lastSeenTurn: 4,
          },
        ],
        repeatedStateContexts: [],
        recentRecoveryAttempts: [],
        stuckEvents: 0,
      },
    });

    expect(text).toContain(
      "recommended skill: skill:route-1.lateral-obstacle-recovery"
    );
    expect(text).toContain("recommended action: mgba_hold Left");
  });

  it("routes rival battle mode to deterministic BattlePolicy instead of fallback vision", () => {
    const text = formatStage1RuntimePlan({
      state: rivalBattleObservation({
        battle: true,
        battleActionState: {
          canRun: false,
          items: [],
          moves: [{ moveId: 33, pp: 35, slot: 1 }],
          party: [],
          readStatus: "available",
          ui: { cursorIndex: 0, mode: "main-menu", source: "ram" },
        },
        battleResult: 0,
        battleType: 1,
        dialogueLike: false,
        direction: "up",
        mapId: 40,
        menuLike: false,
        position: { x: 5, y: 6 },
        readStatus: "available",
      }).state,
    });

    expect(text).toContain(
      "recommended skill: policy:battle.basic-battle-policy"
    );
    expect(text).toContain(
      "recommended action: BattlePolicy deterministic rival-battle event"
    );
    expect(text).not.toContain("fallback:vision-guided-supervised-control");
  });

  it("marks Viridian City as terminal Stage 1 victory without fallback or route movement", () => {
    const text = formatStage1RuntimePlan({
      state: {
        battle: false,
        battleResult: null,
        battleType: null,
        dialogueLike: "visual-fallback",
        direction: "up",
        mapId: 1,
        menuLike: "visual-fallback",
        position: { x: 10, y: 30 },
        readStatus: "available",
      },
    });

    expect(text).toContain("evaluator: victory=true progress=victory");
    expect(text).toContain("recommended skill: stage1:victory-reached");
    expect(text).toContain(
      "recommended action: stop route movement; Stage 1 victory reached from RuntimeGameState mapId=1"
    );
    expect(text).toContain("rule:viridian-city.mark-stage1-victory");
    expect(text).not.toContain("fallback:vision-guided-supervised-control");
    expect(text).not.toContain("recommended action: mgba_hold");
  });
});
