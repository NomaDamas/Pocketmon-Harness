import { POKEMON_RED_STAGE1_MAP_IDS } from "./stage1-evaluator";
import {
  STAGE1_GAMEPLAY_GAME,
  STAGE1_GAMEPLAY_SCHEMA_VERSION,
  STAGE1_GAMEPLAY_STAGE,
  STAGE1_GAMEPLAY_VICTORY_CONDITION,
  type Stage1GameplayRule,
  validateStage1GameplayRule,
} from "./stage1-gameplay-schema";

export const STAGE1_ACTIVE_RULE_SOURCE = "base-guide" as const;

export const STAGE1_VIRIDIAN_ACTIVE_MAP_IDS = [
  POKEMON_RED_STAGE1_MAP_IDS.palletTown,
  POKEMON_RED_STAGE1_MAP_IDS.route1,
  POKEMON_RED_STAGE1_MAP_IDS.viridianCity,
] as const;

export const STAGE1_VIRIDIAN_REQUIRED_RULE_SCOPES = [
  "control",
  "mode",
  "navigation",
  "story",
  "battle",
  "resource",
  "route-guide",
] as const;

export const STAGE1_VIRIDIAN_OBJECTIVE = {
  description:
    "Reach Viridian City from an early-game Pokemon Red overworld state.",
  mapId: POKEMON_RED_STAGE1_MAP_IDS.viridianCity,
  victoryCondition: STAGE1_GAMEPLAY_VICTORY_CONDITION,
} as const;

const baseRuleFields = {
  game: STAGE1_GAMEPLAY_GAME,
  schemaVersion: STAGE1_GAMEPLAY_SCHEMA_VERSION,
  stage: STAGE1_GAMEPLAY_STAGE,
} as const;

function activeRule(
  rule: Omit<Stage1GameplayRule, keyof typeof baseRuleFields>
) {
  return validateStage1GameplayRule({
    ...baseRuleFields,
    ...rule,
  });
}

export const STAGE1_VIRIDIAN_ACTIVE_RULES = [
  activeRule({
    description:
      "Stage 1 autonomy may only emit supervised mGBA button-control actions; emulator lifecycle authority stays outside the model boundary.",
    effects: [
      {
        confidenceDelta: 0,
        description:
          "Record the control boundary before selecting any route or recovery action.",
        kind: "record-fact",
        priorityDelta: 0,
      },
    ],
    id: "rule:stage1.control.supervised-buttons-only",
    preconditions: [
      {
        evidence: ["Pokemon Red RAM read is the only active game context"],
        field: "state.readStatus",
        operator: "equals",
        value: "available",
      },
    ],
    priority: 100,
    scope: "control",
    trigger: {
      conditions: [
        {
          evidence: ["Every Stage 1 turn must preserve the control boundary"],
          field: "status.frame",
          operator: "known",
        },
      ],
      kind: "observation",
      label: "stage1 supervised control boundary",
    },
  }),
  activeRule({
    description:
      "When the player is in the normal overworld on Pallet Town or Route 1, activate the route-following skill instead of asking for direct model button choice.",
    effects: [
      {
        confidenceDelta: 0.25,
        description:
          "Route-following converts active route-guide rules into safe button candidates.",
        kind: "activate-skill",
        priorityDelta: 35,
        skillId: "skill:route-1.follow-north-path",
      },
    ],
    id: "rule:stage1.mode.overworld-route-skill",
    preconditions: [
      {
        evidence: ["Pokemon Red RAM read is available"],
        field: "state.readStatus",
        operator: "equals",
        value: "available",
      },
      {
        evidence: ["Route guide is only defined for Pallet Town and Route 1"],
        field: "state.mapId",
        operator: "in",
        value: [
          POKEMON_RED_STAGE1_MAP_IDS.palletTown,
          POKEMON_RED_STAGE1_MAP_IDS.route1,
        ],
      },
      {
        evidence: ["Do not run route movement while battle UI is active"],
        field: "state.battle",
        operator: "equals",
        value: false,
      },
    ],
    priority: 95,
    scope: "mode",
    trigger: {
      conditions: [
        {
          evidence: ["Stage 1 route objective remains active"],
          field: "evaluator.progressStatus",
          operator: "not-equals",
          value: "victory",
        },
      ],
      kind: "observation",
      label: "overworld Viridian route mode",
    },
  }),
  activeRule({
    description:
      "From Pallet Town, prefer northbound walking toward the Route 1 map edge.",
    effects: [
      {
        action: {
          buttons: ["Up"],
          durationFrames: 16,
          toolName: "mgba_hold",
        },
        confidenceDelta: 0.2,
        description:
          "Move one supervised northbound segment toward the Pallet Town north exit.",
        kind: "prefer-action",
        priorityDelta: 30,
      },
    ],
    id: "rule:pallet-town.walk-north-to-route-1",
    preconditions: [
      {
        evidence: ["Pallet Town map is visible in Pokemon Red RAM"],
        field: "state.mapId",
        operator: "equals",
        value: POKEMON_RED_STAGE1_MAP_IDS.palletTown,
      },
      {
        evidence: ["Normal overworld movement only"],
        field: "state.battle",
        operator: "equals",
        value: false,
      },
    ],
    priority: 90,
    scope: "navigation",
    trigger: {
      conditions: [
        {
          evidence: ["Player y coordinate determines northbound progress"],
          field: "state.position.y",
          operator: "known",
        },
      ],
      kind: "observation",
      label: "Pallet Town northbound progress",
    },
  }),
  activeRule({
    description:
      "On Route 1, keep the route objective focused on moving north into Viridian City.",
    effects: [
      {
        action: {
          buttons: ["Up"],
          durationFrames: 16,
          toolName: "mgba_hold",
        },
        confidenceDelta: 0.2,
        description:
          "Continue supervised northbound walking through Route 1 toward Viridian City.",
        kind: "prefer-action",
        priorityDelta: 30,
      },
    ],
    id: "rule:route-1.walk-north-to-viridian",
    preconditions: [
      {
        evidence: ["Route 1 map is visible in Pokemon Red RAM"],
        field: "state.mapId",
        operator: "equals",
        value: POKEMON_RED_STAGE1_MAP_IDS.route1,
      },
      {
        evidence: ["Normal overworld movement only"],
        field: "state.battle",
        operator: "equals",
        value: false,
      },
    ],
    priority: 90,
    scope: "route-guide",
    trigger: {
      conditions: [
        {
          evidence: ["Route 1 northbound y coordinate is visible"],
          field: "state.position.y",
          operator: "known",
        },
      ],
      kind: "observation",
      label: "Route 1 northbound progress",
    },
  }),
  activeRule({
    description:
      "If repeated northbound movement on Route 1 is stationary, try a short lateral obstacle recovery before resuming north.",
    effects: [
      {
        action: {
          buttons: ["Up"],
          durationFrames: 16,
          toolName: "mgba_hold",
        },
        confidenceDelta: -0.15,
        description:
          "Avoid repeating the same blocked northbound action while stuck evidence is fresh.",
        kind: "avoid-action",
        priorityDelta: -30,
      },
      {
        action: {
          buttons: ["Left"],
          durationFrames: 12,
          toolName: "mgba_hold",
        },
        confidenceDelta: 0.1,
        description:
          "Try a supervised lateral detour around Route 1 trees, ledges, or NPC blocking.",
        kind: "prefer-action",
        priorityDelta: 15,
      },
      {
        action: {
          buttons: ["Right"],
          durationFrames: 12,
          toolName: "mgba_hold",
        },
        confidenceDelta: 0.1,
        description:
          "Keep a mirrored lateral detour available when the left side is blocked.",
        kind: "prefer-action",
        priorityDelta: 12,
      },
    ],
    id: "rule:route-1.recover-from-stationary-north",
    preconditions: [
      {
        evidence: ["Route 1 map is visible in Pokemon Red RAM"],
        field: "state.mapId",
        operator: "equals",
        value: POKEMON_RED_STAGE1_MAP_IDS.route1,
      },
      {
        evidence: ["Existing StuckMemory records stationary movement evidence"],
        field: "stuckMemory.stuckEvents",
        operator: "known",
      },
    ],
    priority: 85,
    scope: "navigation",
    trigger: {
      conditions: [
        {
          evidence: ["Failed movement edges indicate repeated blocked motion"],
          field: "stuckMemory.failedMovementEdges",
          operator: "known",
        },
      ],
      kind: "stuck-event",
      label: "Route 1 blocked northbound recovery",
    },
  }),
  activeRule({
    description:
      "If mandatory dialogue or text boxes appear while following the route, advance them with A without adding optional interactions.",
    effects: [
      {
        action: {
          buttons: ["A"],
          durationFrames: 8,
          toolName: "mgba_tap",
        },
        confidenceDelta: 0.1,
        description:
          "Advance blocking text so route movement can resume under the same objective.",
        kind: "prefer-action",
        priorityDelta: 20,
      },
    ],
    id: "rule:stage1.story.advance-blocking-dialogue",
    preconditions: [
      {
        evidence: ["Dialogue-like state is visible in Pokemon Red RAM"],
        field: "state.dialogueLike",
        operator: "equals",
        value: true,
      },
    ],
    priority: 80,
    scope: "story",
    trigger: {
      conditions: [
        {
          evidence: ["Blocking dialogue can prevent map progress"],
          field: "state.dialogueLike",
          operator: "equals",
          value: true,
        },
      ],
      kind: "observation",
      label: "blocking dialogue advance",
    },
  }),
  activeRule({
    description:
      "If a Stage 1 battle appears, treat it as a deterministic battle-policy event that must be cleared before route progress resumes.",
    effects: [
      {
        action: {
          buttons: ["A"],
          durationFrames: 8,
          toolName: "mgba_tap",
        },
        confidenceDelta: 0.1,
        description:
          "Use the deterministic BasicBattlePolicy path instead of fallback analyst handling or non-button battle control tools.",
        kind: "prefer-action",
        priorityDelta: 18,
      },
    ],
    id: "rule:stage1.battle.clear-rival-battle",
    preconditions: [
      {
        evidence: ["Battle state is visible in Pokemon Red RAM"],
        field: "state.battle",
        operator: "equals",
        value: true,
      },
    ],
    priority: 75,
    scope: "battle",
    trigger: {
      conditions: [
        {
          evidence: ["Rival battle mode blocks overworld route progress"],
          field: "state.battle",
          operator: "equals",
          value: true,
        },
      ],
      kind: "observation",
      label: "deterministic rival battle clear",
    },
  }),
  activeRule({
    description:
      "Do not detour for optional items, Pokemon Center visits, Pokedex tasks, or inventory/resource management before Viridian City is reached.",
    effects: [
      {
        confidenceDelta: 0,
        description:
          "Keep optional resource behavior out of the active Stage 1 route objective.",
        kind: "record-fact",
        priorityDelta: 0,
      },
    ],
    id: "rule:stage1.resource.ignore-optional-detours",
    preconditions: [
      {
        evidence: ["Viridian City has not been reached yet"],
        field: "evaluator.progressStatus",
        operator: "not-equals",
        value: "victory",
      },
    ],
    priority: 70,
    scope: "resource",
    trigger: {
      conditions: [
        {
          evidence: ["Stage 1 progress-first objective is active"],
          field: "status.frame",
          operator: "known",
        },
      ],
      kind: "observation",
      label: "skip optional resources before Viridian",
    },
  }),
  activeRule({
    description:
      "When Pokemon Red RAM reports Viridian City, stop route movement and mark the Stage 1 victory condition.",
    effects: [
      {
        confidenceDelta: 1,
        description:
          "Record that the active route objective has reached the Viridian City map.",
        kind: "record-fact",
        priorityDelta: 100,
      },
    ],
    id: "rule:viridian-city.mark-stage1-victory",
    preconditions: [
      {
        evidence: ["Viridian City map is visible in Pokemon Red RAM"],
        field: "state.mapId",
        operator: "equals",
        value: POKEMON_RED_STAGE1_MAP_IDS.viridianCity,
      },
    ],
    priority: 100,
    scope: "route-guide",
    trigger: {
      conditions: [
        {
          evidence: ["Evaluator recognizes the explicit Stage 1 objective"],
          field: "evaluator.progressStatus",
          operator: "equals",
          value: "victory",
        },
      ],
      kind: "milestone",
      label: "Viridian City reached",
    },
  }),
] as const satisfies readonly Stage1GameplayRule[];

export const STAGE1_VIRIDIAN_ACTIVE_RULE_IDS = STAGE1_VIRIDIAN_ACTIVE_RULES.map(
  (rule) => rule.id
);
