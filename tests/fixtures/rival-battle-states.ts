import type { MgbaButton } from "../../src/mgba-http";
import type { MgbaObservation } from "../../src/observation";
import type {
  PokemonBattleActionKind,
  PokemonBattleActionState,
  PokemonStateObservation,
} from "../../src/pokemon-state";

export type RivalBattleFixtureId =
  | "rival-battle-main-menu"
  | "rival-battle-move-select"
  | "rival-battle-bag-item-select"
  | "rival-battle-party-select"
  | "rival-battle-unsupported-ui";

export type RivalBattlePhase =
  | "main-menu"
  | "move-select"
  | "bag-item-select"
  | "party-select"
  | "unsupported-ui";

export interface RivalBattleStateFixture {
  expectedDecision: RivalBattleExpectedDecision;
  id: RivalBattleFixtureId;
  label: string;
  phase: RivalBattlePhase;
  runtimeGameState: PokemonStateObservation;
}

export type RivalBattleExpectedDecision =
  | {
      buttons: readonly MgbaButton[];
      fallbackAllowed: false;
      id: string;
      kind: PokemonBattleActionKind;
      policy: "battle";
      targetName: string;
      targetType: "item" | "move" | "party" | "run";
    }
  | {
      action: undefined;
      controllerGuarded: true;
      policy: "battle";
      reasonIncludes: string;
    };

export const RIVAL_BATTLE_BASE_ACTION_STATE = {
  canRun: false,
  items: [
    {
      itemId: 20,
      name: "Potion",
      quantity: 1,
      slot: 1,
      usableInBattle: true,
    },
    {
      itemId: 21,
      name: "Empty pocket",
      quantity: 0,
      slot: 2,
      usableInBattle: true,
    },
  ],
  moves: [
    { moveId: 33, name: "Tackle", pp: 35, slot: 1 },
    { moveId: 45, name: "Growl", pp: 0, slot: 2 },
    { moveId: null, pp: null, slot: 3 },
    { disabled: true, moveId: 99, pp: 1, slot: 4 },
  ],
  party: [
    {
      active: true,
      hp: 18,
      name: "Bulbasaur",
      slot: 1,
      speciesId: 153,
    },
    {
      active: false,
      hp: 12,
      name: "Pidgey",
      slot: 2,
      speciesId: 36,
    },
    {
      active: false,
      fainted: true,
      hp: 0,
      name: "Rattata",
      slot: 3,
      speciesId: 165,
    },
  ],
  readStatus: "available",
  ui: {
    cursorIndex: 0,
    mode: "main-menu",
    source: "ram",
  },
} as const satisfies PokemonBattleActionState;

const RIVAL_BATTLE_BASE_RUNTIME_STATE = {
  battle: true,
  battleResult: 0,
  battleType: 1,
  dialogueLike: false,
  direction: "up",
  mapId: 40,
  menuLike: false,
  position: { x: 5, y: 6 },
  readStatus: "available",
} as const satisfies Omit<PokemonStateObservation, "battleActionState">;

export const RIVAL_BATTLE_STATE_FIXTURES = [
  rivalBattleFixture({
    actionState: RIVAL_BATTLE_BASE_ACTION_STATE,
    expectedDecision: {
      buttons: ["A"],
      fallbackAllowed: false,
      id: "fight:1",
      kind: "fight",
      policy: "battle",
      targetName: "Tackle",
      targetType: "move",
    },
    id: "rival-battle-main-menu",
    label: "Oak Lab rival battle main menu",
    phase: "main-menu",
  }),
  rivalBattleFixture({
    actionState: {
      ...RIVAL_BATTLE_BASE_ACTION_STATE,
      ui: {
        cursorIndex: 1,
        mode: "move-select",
        source: "ram",
      },
    },
    expectedDecision: {
      buttons: ["Up", "A"],
      fallbackAllowed: false,
      id: "fight:1",
      kind: "fight",
      policy: "battle",
      targetName: "Tackle",
      targetType: "move",
    },
    id: "rival-battle-move-select",
    label: "Oak Lab rival battle move select",
    phase: "move-select",
  }),
  rivalBattleFixture({
    actionState: {
      ...RIVAL_BATTLE_BASE_ACTION_STATE,
      ui: {
        cursorIndex: 0,
        mode: "bag-item-select",
        source: "ram",
      },
    },
    expectedDecision: {
      buttons: ["A"],
      fallbackAllowed: false,
      id: "item:1",
      kind: "item",
      policy: "battle",
      targetName: "Potion",
      targetType: "item",
    },
    id: "rival-battle-bag-item-select",
    label: "Oak Lab rival battle bag item select",
    phase: "bag-item-select",
  }),
  rivalBattleFixture({
    actionState: {
      ...RIVAL_BATTLE_BASE_ACTION_STATE,
      ui: {
        cursorIndex: 1,
        mode: "party-select",
        source: "ram",
      },
    },
    expectedDecision: {
      buttons: ["A"],
      fallbackAllowed: false,
      id: "switch:2",
      kind: "switch",
      policy: "battle",
      targetName: "Pidgey",
      targetType: "party",
    },
    id: "rival-battle-party-select",
    label: "Oak Lab rival battle party select",
    phase: "party-select",
  }),
  rivalBattleFixture({
    actionState: {
      ...RIVAL_BATTLE_BASE_ACTION_STATE,
      ui: {
        cursorIndex: null,
        mode: "unknown",
        source: "ram",
      },
    },
    expectedDecision: {
      action: undefined,
      controllerGuarded: true,
      policy: "battle",
      reasonIncludes: "deterministic rival battle event",
    },
    id: "rival-battle-unsupported-ui",
    label: "Oak Lab rival battle unsupported UI",
    phase: "unsupported-ui",
  }),
] as const satisfies readonly RivalBattleStateFixture[];

export const SUPPORTED_RIVAL_BATTLE_STATE_FIXTURES =
  RIVAL_BATTLE_STATE_FIXTURES.filter(
    (fixture) => fixture.phase !== "unsupported-ui"
  );

export function rivalBattleObservation(
  state: PokemonStateObservation
): MgbaObservation {
  return {
    screenshot: {
      data: "screen",
      mediaType: "image/png",
      path: "/tmp/screen.png",
    },
    state,
    status: {
      activeButtons: [],
      frame: 1,
      gameCode: "DMG-AR",
      gameTitle: "PKMN RED ST",
    },
  };
}

function rivalBattleFixture({
  actionState,
  expectedDecision,
  id,
  label,
  phase,
}: {
  actionState: PokemonBattleActionState;
  expectedDecision: RivalBattleExpectedDecision;
  id: RivalBattleFixtureId;
  label: string;
  phase: RivalBattlePhase;
}): RivalBattleStateFixture {
  return {
    expectedDecision,
    id,
    label,
    phase,
    runtimeGameState: {
      ...RIVAL_BATTLE_BASE_RUNTIME_STATE,
      battleActionState: actionState,
    },
  };
}
