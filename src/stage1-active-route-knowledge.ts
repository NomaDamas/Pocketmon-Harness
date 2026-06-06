import { POKEMON_RED_STAGE1_MAP_IDS } from "./stage1-evaluator";
import {
  STAGE1_GAMEPLAY_GAME,
  STAGE1_GAMEPLAY_SCHEMA_VERSION,
  STAGE1_GAMEPLAY_STAGE,
  STAGE1_GAMEPLAY_VICTORY_CONDITION,
  type Stage1RouteKnowledge,
  validateStage1RouteKnowledge,
} from "./stage1-gameplay-schema";

export const STAGE1_ACTIVE_ROUTE_KNOWLEDGE_SOURCE = "base-guide" as const;

export const STAGE1_VIRIDIAN_ROUTE_ID = "route:pallet-to-viridian" as const;

export const STAGE1_VIRIDIAN_ROUTE_ACTIVE_MAP_IDS = [
  POKEMON_RED_STAGE1_MAP_IDS.palletTown,
  POKEMON_RED_STAGE1_MAP_IDS.route1,
  POKEMON_RED_STAGE1_MAP_IDS.viridianCity,
] as const;

export const STAGE1_VIRIDIAN_ROUTE_REQUIRED_RULE_SCOPES = [
  "navigation",
  "route-guide",
] as const;

const baseRouteFields = {
  game: STAGE1_GAMEPLAY_GAME,
  schemaVersion: STAGE1_GAMEPLAY_SCHEMA_VERSION,
  stage: STAGE1_GAMEPLAY_STAGE,
  status: "active",
} as const;

function activeRouteKnowledge(
  route: Omit<Stage1RouteKnowledge, keyof typeof baseRouteFields>
) {
  return validateStage1RouteKnowledge({
    ...baseRouteFields,
    ...route,
  });
}

export const STAGE1_VIRIDIAN_ROUTE_KNOWLEDGE = activeRouteKnowledge({
  description:
    "Base Pokemon Red Stage 1 route knowledge for walking from the early-game Pallet Town overworld, through Route 1, into Viridian City.",
  id: STAGE1_VIRIDIAN_ROUTE_ID,
  maps: [
    {
      bounds: {
        height: 18,
        width: 20,
      },
      exits: [
        {
          description:
            "Walk through the north edge of Pallet Town to enter the south side of Route 1.",
          direction: "up",
          from: {
            mapId: POKEMON_RED_STAGE1_MAP_IDS.palletTown,
            x: 10,
            y: 0,
          },
          id: "world:pallet-town.north-exit",
          kind: "map-edge",
          to: {
            mapId: POKEMON_RED_STAGE1_MAP_IDS.route1,
            x: 10,
            y: 35,
          },
          transitionId: "route:pallet-to-route-1",
        },
      ],
      id: "world:pallet-town",
      kind: "town",
      landmarks: [
        {
          description:
            "The safe early-game overworld area before the Route 1 northbound path.",
          id: "world:pallet-town.start-orientation",
          kind: "orientation",
          name: "Pallet Town start orientation",
          position: {
            mapId: POKEMON_RED_STAGE1_MAP_IDS.palletTown,
            x: 10,
            y: 12,
          },
          tags: ["start", "early-game"],
        },
        {
          description:
            "The north opening is the only Stage 1 map-edge target before Route 1.",
          id: "world:pallet-town.north-opening",
          kind: "transition",
          name: "Pallet Town north opening",
          position: {
            mapId: POKEMON_RED_STAGE1_MAP_IDS.palletTown,
            x: 10,
            y: 0,
          },
          tags: ["northbound", "route-1"],
        },
      ],
      locations: [
        {
          description:
            "Early-game outdoor starting area used by the Stage 1 Viridian objective.",
          id: "world:pallet-town.early-overworld",
          kind: "spawn",
          name: "Pallet Town early overworld",
          position: {
            mapId: POKEMON_RED_STAGE1_MAP_IDS.palletTown,
            x: 10,
            y: 12,
          },
          tags: ["stage1", "start"],
        },
      ],
      mapId: POKEMON_RED_STAGE1_MAP_IDS.palletTown,
      name: "Pallet Town",
    },
    {
      bounds: {
        height: 36,
        width: 20,
      },
      exits: [
        {
          description:
            "Walk through the north edge of Route 1 to enter Viridian City.",
          direction: "up",
          from: {
            mapId: POKEMON_RED_STAGE1_MAP_IDS.route1,
            x: 10,
            y: 0,
          },
          id: "world:route-1.north-exit",
          kind: "map-edge",
          to: {
            mapId: POKEMON_RED_STAGE1_MAP_IDS.viridianCity,
            x: 10,
            y: 30,
          },
          transitionId: "route:route-1-to-viridian",
        },
        {
          description:
            "The south edge returns to Pallet Town and is a regression for the Stage 1 objective.",
          direction: "down",
          from: {
            mapId: POKEMON_RED_STAGE1_MAP_IDS.route1,
            x: 10,
            y: 35,
          },
          id: "world:route-1.south-exit",
          kind: "map-edge",
          to: {
            mapId: POKEMON_RED_STAGE1_MAP_IDS.palletTown,
            x: 10,
            y: 0,
          },
          transitionId: "route:route-1-to-pallet-regression",
        },
      ],
      id: "world:route-1",
      kind: "route",
      landmarks: [
        {
          description:
            "The south Route 1 entry is the expected arrival after leaving Pallet Town.",
          id: "world:route-1.south-entry",
          kind: "transition",
          name: "Route 1 south entry",
          position: {
            mapId: POKEMON_RED_STAGE1_MAP_IDS.route1,
            x: 10,
            y: 35,
          },
          tags: ["from-pallet-town"],
        },
        {
          description:
            "A northbound outdoor path that may require short lateral corrections around grass, ledges, trees, or NPCs.",
          id: "world:route-1.northbound-path",
          kind: "orientation",
          name: "Route 1 northbound path",
          position: {
            mapId: POKEMON_RED_STAGE1_MAP_IDS.route1,
            x: 10,
            y: 20,
          },
          tags: ["route-guide", "northbound"],
        },
        {
          description:
            "Outdoor route obstacles can stall straight Up movement; recovery remains limited to short Left or Right walking candidates.",
          id: "world:route-1.obstacle-band",
          kind: "obstacle",
          name: "Route 1 obstacle band",
          position: {
            mapId: POKEMON_RED_STAGE1_MAP_IDS.route1,
            x: 10,
            y: 16,
          },
          tags: ["stuck-recovery", "lateral-detour"],
        },
        {
          description:
            "The north map edge is the final Route 1 target before Viridian City.",
          id: "world:route-1.viridian-approach",
          kind: "transition",
          name: "Viridian City approach",
          position: {
            mapId: POKEMON_RED_STAGE1_MAP_IDS.route1,
            x: 10,
            y: 0,
          },
          tags: ["viridian-city", "northbound"],
        },
      ],
      locations: [
        {
          description:
            "Route 1 traversal corridor used by the Stage 1 path plan.",
          id: "world:route-1.main-corridor",
          kind: "path",
          name: "Route 1 main corridor",
          position: {
            mapId: POKEMON_RED_STAGE1_MAP_IDS.route1,
            x: 10,
            y: 20,
          },
          tags: ["route-guide", "stage1"],
        },
        {
          description:
            "Grass may trigger incidental battle mode; it is not an optional detour target.",
          id: "world:route-1.grass-risk",
          kind: "grass",
          name: "Route 1 grass risk",
          position: {
            mapId: POKEMON_RED_STAGE1_MAP_IDS.route1,
            x: 8,
            y: 18,
          },
          tags: ["hazard", "battle-risk"],
        },
      ],
      mapId: POKEMON_RED_STAGE1_MAP_IDS.route1,
      name: "Route 1",
    },
    {
      bounds: {
        height: 36,
        width: 40,
      },
      exits: [],
      id: "world:viridian-city",
      kind: "city",
      landmarks: [
        {
          description:
            "The first city reached after Route 1 and the Stage 1 victory location.",
          id: "world:viridian-city.arrival",
          kind: "objective",
          name: "Viridian City arrival",
          position: {
            mapId: POKEMON_RED_STAGE1_MAP_IDS.viridianCity,
            x: 10,
            y: 30,
          },
          tags: ["victory", "stage1"],
        },
      ],
      locations: [
        {
          description:
            "South-side Viridian City entry reached by walking north from Route 1.",
          id: "world:viridian-city.south-entry",
          kind: "city",
          name: "Viridian City south entry",
          position: {
            mapId: POKEMON_RED_STAGE1_MAP_IDS.viridianCity,
            x: 10,
            y: 30,
          },
          tags: ["goal", "victory"],
        },
      ],
      mapId: POKEMON_RED_STAGE1_MAP_IDS.viridianCity,
      name: "Viridian City",
    },
  ],
  planning: {
    activeMapIds: [...STAGE1_VIRIDIAN_ROUTE_ACTIVE_MAP_IDS],
    estimatedFrameBudget: 18_000,
    objective: STAGE1_GAMEPLAY_VICTORY_CONDITION,
    planningNotes: [
      "Use frame-native walking segments instead of wall-clock route timing.",
      "Prefer northbound movement while Pallet Town or Route 1 y-coordinate progress is available.",
      "If repeated northbound movement is stationary, try one short lateral correction and then resume Up.",
      "Stop route movement once Pokemon Red RAM reports the Viridian City map.",
    ],
    preferredStrategy: "progress-first",
    requiredRuleScopes: [...STAGE1_VIRIDIAN_ROUTE_REQUIRED_RULE_SCOPES],
    waypointOrder: [
      {
        description:
          "Begin in the early-game Pallet Town outdoor state and orient north.",
        kind: "start",
        locationId: "world:pallet-town.early-overworld",
        position: {
          mapId: POKEMON_RED_STAGE1_MAP_IDS.palletTown,
          x: 10,
          y: 12,
        },
      },
      {
        description:
          "Reach the Pallet Town north map edge before entering Route 1.",
        kind: "transition",
        landmarkId: "world:pallet-town.north-opening",
        position: {
          mapId: POKEMON_RED_STAGE1_MAP_IDS.palletTown,
          x: 10,
          y: 0,
        },
      },
      {
        description:
          "Confirm Route 1 south-side arrival after the first map transition.",
        kind: "checkpoint",
        landmarkId: "world:route-1.south-entry",
        position: {
          mapId: POKEMON_RED_STAGE1_MAP_IDS.route1,
          x: 10,
          y: 35,
        },
      },
      {
        description:
          "Follow the Route 1 northbound corridor, correcting laterally only when blocked.",
        kind: "landmark",
        landmarkId: "world:route-1.northbound-path",
        position: {
          mapId: POKEMON_RED_STAGE1_MAP_IDS.route1,
          x: 10,
          y: 20,
        },
      },
      {
        description:
          "Treat the Route 1 south edge as an avoid waypoint because it regresses toward Pallet Town.",
        kind: "avoid",
        landmarkId: "world:route-1.south-entry",
        position: {
          mapId: POKEMON_RED_STAGE1_MAP_IDS.route1,
          x: 10,
          y: 35,
        },
      },
      {
        description:
          "Reach the Route 1 north map edge to transition into Viridian City.",
        kind: "transition",
        landmarkId: "world:route-1.viridian-approach",
        position: {
          mapId: POKEMON_RED_STAGE1_MAP_IDS.route1,
          x: 10,
          y: 0,
        },
      },
      {
        description:
          "End the Stage 1 route once Viridian City is visible in Pokemon Red RAM.",
        kind: "goal",
        landmarkId: "world:viridian-city.arrival",
        locationId: "world:viridian-city.south-entry",
        position: {
          mapId: POKEMON_RED_STAGE1_MAP_IDS.viridianCity,
          x: 10,
          y: 30,
        },
      },
    ],
  },
  transitions: [
    {
      actionHint: "Hold Up in short frame-native segments until Route 1 loads.",
      description: "Pallet Town north edge to Route 1 south entry.",
      exitId: "world:pallet-town.north-exit",
      expectedFrameCost: 120,
      from: {
        mapId: POKEMON_RED_STAGE1_MAP_IDS.palletTown,
        x: 10,
        y: 0,
      },
      id: "route:pallet-to-route-1",
      kind: "walk",
      to: {
        mapId: POKEMON_RED_STAGE1_MAP_IDS.route1,
        x: 10,
        y: 35,
      },
    },
    {
      actionHint:
        "Keep moving Up through Route 1; use one-cell lateral correction only when stuck evidence appears.",
      description: "Route 1 south entry through the outdoor northbound path.",
      expectedFrameCost: 900,
      from: {
        mapId: POKEMON_RED_STAGE1_MAP_IDS.route1,
        x: 10,
        y: 35,
      },
      id: "route:route-1-northbound-corridor",
      kind: "walk",
      to: {
        mapId: POKEMON_RED_STAGE1_MAP_IDS.route1,
        x: 10,
        y: 0,
      },
    },
    {
      actionHint:
        "Cross the north map edge from Route 1 and stop when Viridian City map id is observed.",
      description: "Route 1 north edge to Viridian City south entry.",
      exitId: "world:route-1.north-exit",
      expectedFrameCost: 120,
      from: {
        mapId: POKEMON_RED_STAGE1_MAP_IDS.route1,
        x: 10,
        y: 0,
      },
      id: "route:route-1-to-viridian",
      kind: "walk",
      to: {
        mapId: POKEMON_RED_STAGE1_MAP_IDS.viridianCity,
        x: 10,
        y: 30,
      },
    },
  ],
});

export const STAGE1_VIRIDIAN_ROUTE_KNOWLEDGE_LIST = [
  STAGE1_VIRIDIAN_ROUTE_KNOWLEDGE,
] as const satisfies readonly Stage1RouteKnowledge[];

export const STAGE1_VIRIDIAN_ROUTE_KNOWLEDGE_IDS =
  STAGE1_VIRIDIAN_ROUTE_KNOWLEDGE_LIST.map((route) => route.id);
