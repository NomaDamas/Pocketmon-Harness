import { describe, expect, it } from "vitest";
import {
  STAGE1_ACTIVE_ROUTE_KNOWLEDGE_SOURCE,
  STAGE1_VIRIDIAN_ROUTE_ACTIVE_MAP_IDS,
  STAGE1_VIRIDIAN_ROUTE_ID,
  STAGE1_VIRIDIAN_ROUTE_KNOWLEDGE,
  STAGE1_VIRIDIAN_ROUTE_KNOWLEDGE_IDS,
  STAGE1_VIRIDIAN_ROUTE_KNOWLEDGE_LIST,
  STAGE1_VIRIDIAN_ROUTE_REQUIRED_RULE_SCOPES,
} from "../src/stage1-active-route-knowledge";
import {
  STAGE1_VIRIDIAN_ACTIVE_MAP_IDS,
  STAGE1_VIRIDIAN_OBJECTIVE,
} from "../src/stage1-active-rules";
import {
  POKEMON_RED_STAGE1_MAP_IDS,
  STAGE1_VICTORY_CONDITION,
} from "../src/stage1-evaluator";
import {
  STAGE1_GAMEPLAY_GAME,
  STAGE1_GAMEPLAY_STAGE,
  type Stage1RouteKnowledge,
  validateStage1RouteKnowledge,
} from "../src/stage1-gameplay-schema";

const UNSAFE_TOOL_PATTERN =
  /(?:^|[\s_:-])(?:reset|restart|rom|load|save|delete)(?:$|[\s_:-])/i;
const LEARNED_OR_CANDIDATE_PATTERN =
  /\b(?:candidate|learned|promotion|promoted|qa-verdict|human-override)\b/i;
const FPS_PATTERN = /\bfps\b/i;
const ROUTE_ID_PREFIX_PATTERN = /^route:/;

function mapIdsFor(route: Stage1RouteKnowledge) {
  return route.maps.map((map) => map.mapId);
}

function waypointMapIdsFor(route: Stage1RouteKnowledge) {
  return route.planning.waypointOrder.map(
    (waypoint) => waypoint.position.mapId
  );
}

function transitionMapPairsFor(route: Stage1RouteKnowledge) {
  return route.transitions.map((transition) => [
    transition.from.mapId,
    transition.to.mapId,
  ]);
}

describe("Stage 1 Viridian active route knowledge", () => {
  it("defines a base-guide Pokemon Red route from Pallet Town through Route 1 to Viridian City", () => {
    expect(STAGE1_ACTIVE_ROUTE_KNOWLEDGE_SOURCE).toBe("base-guide");
    expect(STAGE1_VIRIDIAN_ROUTE_ID).toBe("route:pallet-to-viridian");
    expect(STAGE1_VIRIDIAN_ROUTE_KNOWLEDGE_LIST).toHaveLength(1);
    expect(STAGE1_VIRIDIAN_ROUTE_KNOWLEDGE_IDS).toEqual([
      STAGE1_VIRIDIAN_ROUTE_ID,
    ]);
    expect(STAGE1_VIRIDIAN_ROUTE_ACTIVE_MAP_IDS).toEqual(
      STAGE1_VIRIDIAN_ACTIVE_MAP_IDS
    );
    expect(STAGE1_VIRIDIAN_ROUTE_KNOWLEDGE).toMatchObject({
      game: STAGE1_GAMEPLAY_GAME,
      id: STAGE1_VIRIDIAN_ROUTE_ID,
      planning: {
        objective: STAGE1_VICTORY_CONDITION,
        preferredStrategy: "progress-first",
      },
      stage: STAGE1_GAMEPLAY_STAGE,
      status: "active",
    });
  });

  it("schema-validates the route knowledge and keeps map scope narrow", () => {
    const parsed = validateStage1RouteKnowledge(
      STAGE1_VIRIDIAN_ROUTE_KNOWLEDGE
    );
    const activeMapIds = new Set<number>(STAGE1_VIRIDIAN_ROUTE_ACTIVE_MAP_IDS);

    expect(mapIdsFor(parsed)).toEqual([
      POKEMON_RED_STAGE1_MAP_IDS.palletTown,
      POKEMON_RED_STAGE1_MAP_IDS.route1,
      POKEMON_RED_STAGE1_MAP_IDS.viridianCity,
    ]);
    expect(parsed.planning.activeMapIds).toEqual([
      POKEMON_RED_STAGE1_MAP_IDS.palletTown,
      POKEMON_RED_STAGE1_MAP_IDS.route1,
      POKEMON_RED_STAGE1_MAP_IDS.viridianCity,
    ]);
    expect(mapIdsFor(parsed).every((mapId) => activeMapIds.has(mapId))).toBe(
      true
    );
    expect(
      waypointMapIdsFor(parsed).every((mapId) => activeMapIds.has(mapId))
    ).toBe(true);
    expect(
      transitionMapPairsFor(parsed)
        .flat()
        .every((mapId) => activeMapIds.has(mapId))
    ).toBe(true);
  });

  it("orders the path from early-game start to Route 1 corridor to Viridian victory", () => {
    const waypoints = STAGE1_VIRIDIAN_ROUTE_KNOWLEDGE.planning.waypointOrder;

    expect(waypoints.map((waypoint) => waypoint.kind)).toEqual([
      "start",
      "transition",
      "checkpoint",
      "landmark",
      "avoid",
      "transition",
      "goal",
    ]);
    expect(waypoints[0]).toMatchObject({
      locationId: "world:pallet-town.early-overworld",
      position: {
        mapId: POKEMON_RED_STAGE1_MAP_IDS.palletTown,
        y: 12,
      },
    });
    expect(waypoints.at(-1)).toMatchObject({
      landmarkId: "world:viridian-city.arrival",
      locationId: "world:viridian-city.south-entry",
      position: {
        mapId: STAGE1_VIRIDIAN_OBJECTIVE.mapId,
      },
    });
    expect(
      waypoints.some(
        (waypoint) =>
          waypoint.kind === "avoid" &&
          waypoint.landmarkId === "world:route-1.south-entry"
      )
    ).toBe(true);
  });

  it("connects exits and transitions for the route path without live mGBA orchestration", () => {
    const exitTransitionIds = new Set(
      STAGE1_VIRIDIAN_ROUTE_KNOWLEDGE.maps.flatMap((map) =>
        map.exits.flatMap((exit) =>
          exit.transitionId ? [exit.transitionId] : []
        )
      )
    );
    const transitionIds = new Set(
      STAGE1_VIRIDIAN_ROUTE_KNOWLEDGE.transitions.map(
        (transition) => transition.id
      )
    );

    expect(transitionIds).toEqual(
      new Set([
        "route:pallet-to-route-1",
        "route:route-1-northbound-corridor",
        "route:route-1-to-viridian",
      ])
    );
    expect(exitTransitionIds.has("route:pallet-to-route-1")).toBe(true);
    expect(exitTransitionIds.has("route:route-1-to-viridian")).toBe(true);
    expect(
      [...exitTransitionIds]
        .filter((id) => id !== "route:route-1-to-pallet-regression")
        .every((id) => transitionIds.has(id))
    ).toBe(true);
  });

  it("uses frame-native route planning metadata and required rule scopes", () => {
    expect(STAGE1_VIRIDIAN_ROUTE_KNOWLEDGE.planning.estimatedFrameBudget).toBe(
      18_000
    );
    expect(STAGE1_VIRIDIAN_ROUTE_KNOWLEDGE.planning.requiredRuleScopes).toEqual(
      STAGE1_VIRIDIAN_ROUTE_REQUIRED_RULE_SCOPES
    );
    expect(
      STAGE1_VIRIDIAN_ROUTE_KNOWLEDGE.transitions.every(
        (transition) =>
          transition.expectedFrameCost === undefined ||
          Number.isInteger(transition.expectedFrameCost)
      )
    ).toBe(true);
    expect(
      JSON.stringify(STAGE1_VIRIDIAN_ROUTE_KNOWLEDGE.planning)
    ).not.toMatch(FPS_PATTERN);
  });

  it("keeps base route knowledge separate from model-facing tools and candidate patches", () => {
    const serialized = JSON.stringify(STAGE1_VIRIDIAN_ROUTE_KNOWLEDGE);

    expect(serialized).not.toMatch(UNSAFE_TOOL_PATTERN);
    expect(serialized).not.toMatch(LEARNED_OR_CANDIDATE_PATTERN);
    expect(STAGE1_VIRIDIAN_ROUTE_KNOWLEDGE_IDS).toEqual([
      expect.stringMatching(ROUTE_ID_PREFIX_PATTERN),
    ]);
    expect(STAGE1_VIRIDIAN_ROUTE_KNOWLEDGE.status).toBe("active");
  });
});
