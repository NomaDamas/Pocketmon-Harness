export const POKEMON_RED_FULL_GAME_OBJECTIVE = "beat-pokemon-red" as const;

export const FULL_GAME_STAGE_STATUSES = [
  "active",
  "planned",
  "blocked",
] as const;

export type FullGameStageStatus = (typeof FULL_GAME_STAGE_STATUSES)[number];

export interface PokemonRedGoalStage {
  completionSignal: string;
  controllerScope: string;
  id: string;
  memoryRequirements: string[];
  objective: string;
  status: FullGameStageStatus;
  title: string;
}

export interface PokemonRedMemoryLayer {
  activeFiles: string[];
  authority: "runtime" | "proposal" | "reference";
  id: string;
  purpose: string;
  title: string;
}

export const POKEMON_RED_GOAL_STAGES = [
  {
    completionSignal: "Player can issue overworld inputs from Red bedroom.",
    controllerScope: "Boot/name/control recovery and safe mGBA supervision.",
    id: "stage0-control-bootstrap",
    memoryRequirements: ["control", "mode", "trace-failure"],
    objective: "reach-player-control",
    status: "active",
    title: "Boot, intro, and player control",
  },
  {
    completionSignal: "Pokemon Red RAM reports Viridian City.",
    controllerScope:
      "Controller-primary route through bedroom, house 1F, Pallet, Route 1, and Viridian.",
    id: "stage1-viridian-route",
    memoryRequirements: ["world-map", "route", "quest", "skill"],
    objective: "reach-viridian-city",
    status: "active",
    title: "Pallet Town to Viridian City",
  },
  {
    completionSignal: "Pokedex obtained after Oak's Parcel delivery.",
    controllerScope:
      "Viridian Mart interaction, return route, Oak Lab dialogue, and Pokedex receipt.",
    id: "stage2-oaks-parcel",
    memoryRequirements: ["quest", "inventory", "dialogue", "route"],
    objective: "deliver-oaks-parcel-and-get-pokedex",
    status: "planned",
    title: "Oak's Parcel and Pokedex",
  },
  {
    completionSignal: "Boulder Badge obtained from Brock.",
    controllerScope:
      "Viridian Forest navigation, trainer/wild battle handling, Pewter Gym, and Brock strategy.",
    id: "stage3-brock",
    memoryRequirements: ["battle", "resource", "world-map", "quest"],
    objective: "beat-brock",
    status: "planned",
    title: "Viridian Forest and Brock",
  },
  {
    completionSignal: "All eight badges and required HM gates are cleared.",
    controllerScope:
      "Badge route, HM acquisition/use, dungeons, inventory planning, and route graph expansion.",
    id: "stage4-badges-hms-dungeons",
    memoryRequirements: ["world-map", "quest", "resource", "battle", "skill"],
    objective: "clear-badges-hms-and-dungeons",
    status: "planned",
    title: "Badges, HMs, and dungeons",
  },
  {
    completionSignal: "Champion is defeated and credits can roll.",
    controllerScope:
      "Victory Road, team/resource readiness, Elite Four, rival champion battle, and endgame verification.",
    id: "stage5-elite-four-champion",
    memoryRequirements: ["battle", "resource", "quest", "evaluator"],
    objective: POKEMON_RED_FULL_GAME_OBJECTIVE,
    status: "planned",
    title: "Victory Road, Elite Four, and Champion",
  },
] as const satisfies readonly PokemonRedGoalStage[];

export const POKEMON_RED_MEMORY_LAYERS = [
  {
    activeFiles: ["src/supervisor.ts", "src/mgba-http.ts"],
    authority: "runtime",
    id: "control-memory",
    purpose:
      "Defines safe button tools, movement normalization, settle frames, and reset boundary.",
    title: "Control Memory",
  },
  {
    activeFiles: ["src/phase-detector.ts", "src/pokemon-state.ts"],
    authority: "runtime",
    id: "mode-phase-memory",
    purpose:
      "Classifies title/name/overworld/dialogue/battle/menu/unknown phases from RAM and action evidence.",
    title: "Mode and Phase Memory",
  },
  {
    activeFiles: [
      "src/stage1-active-route-knowledge.ts",
      "src/stage1-pathfinder.ts",
    ],
    authority: "runtime",
    id: "world-route-memory",
    purpose:
      "Stores map ids, waypoints, transitions, blocked edges, and pathfinder authority.",
    title: "World and Route Memory",
  },
  {
    activeFiles: ["src/stage1-active-rules.ts"],
    authority: "runtime",
    id: "rule-memory",
    purpose:
      "Stores machine-readable rules selected by current state instead of loading a whole guidebook.",
    title: "Rule Memory",
  },
  {
    activeFiles: ["src/stage1-active-skills.ts", "src/deterministic-policy.ts"],
    authority: "runtime",
    id: "skill-library",
    purpose:
      "Maps active rules and waypoints to executable skills before any LLM fallback.",
    title: "Skill Library",
  },
  {
    activeFiles: ["src/stuck-memory.ts", "src/observation-bookkeeping.ts"],
    authority: "runtime",
    id: "trace-failure-memory",
    purpose:
      "Records no-progress states, repeated failed actions, stuck edges, and verification failures.",
    title: "Trace and Failure Memory",
  },
  {
    activeFiles: ["src/shared-strategy.ts"],
    authority: "runtime",
    id: "shared-strategy-memory",
    purpose:
      "Shares successful subgoal actions across sibling parallel runs in the same batch.",
    title: "Shared Strategy Memory",
  },
  {
    activeFiles: ["src/parallel-improvement.ts", "src/parallel-promote.ts"],
    authority: "proposal",
    id: "candidate-promotion-memory",
    purpose:
      "Turns trace evidence into QA-gated proposals before explicit promotion into active hierarchy.",
    title: "Candidate and Promotion Memory",
  },
  {
    activeFiles: ["README.md", "src/pokemon-red-full-game-plan.ts"],
    authority: "reference",
    id: "manual-roadmap-memory",
    purpose:
      "Keeps the full-game roadmap visible while runtime implementation expands stage by stage.",
    title: "Manual and Roadmap Memory",
  },
] as const satisfies readonly PokemonRedMemoryLayer[];

export function getActiveGoalStages(): PokemonRedGoalStage[] {
  return POKEMON_RED_GOAL_STAGES.filter((stage) => stage.status === "active");
}

export function getFullGameCompletionStage(): PokemonRedGoalStage {
  const stage = POKEMON_RED_GOAL_STAGES.find(
    (candidate) => candidate.objective === POKEMON_RED_FULL_GAME_OBJECTIVE
  );
  if (!stage) {
    throw new Error("Full-game completion stage is missing");
  }
  return stage;
}

export function getRuntimeMemoryLayers(): PokemonRedMemoryLayer[] {
  return POKEMON_RED_MEMORY_LAYERS.filter(
    (layer) => layer.authority === "runtime"
  );
}
