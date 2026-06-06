import { describe, expect, it } from "vitest";
import { formatStage1RuntimePlan } from "../src/stage1-runtime-plan";

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
        recentRecoveryAttempts: [],
        stuckEvents: 0,
      },
    });

    expect(text).toContain(
      "recommended skill: skill:route-1.lateral-obstacle-recovery"
    );
    expect(text).toContain("recommended action: mgba_hold Left");
  });
});
