import type { MgbaButton } from "./mgba-http";
import type {
  PokemonBattleActionKind,
  PokemonBattleActionState,
  PokemonBattleItemSlot,
  PokemonBattleMoveSlot,
  PokemonBattlePartySlot,
  PokemonStateObservation,
} from "./pokemon-state";

export const BATTLE_POLICY_REQUIRED_INPUTS = [
  "runtimeGameState.readStatus",
  "runtimeGameState.battle",
  "runtimeGameState.battleType",
  "runtimeGameState.battleResult",
  "runtimeGameState.battleActionState.readStatus",
  "runtimeGameState.battleActionState.ui.mode",
  "runtimeGameState.battleActionState.ui.cursorIndex",
  "runtimeGameState.battleActionState.moves[].moveId",
  "runtimeGameState.battleActionState.moves[].pp",
  "runtimeGameState.battleActionState.moves[].disabled",
  "runtimeGameState.battleActionState.items[].itemId",
  "runtimeGameState.battleActionState.items[].quantity",
  "runtimeGameState.battleActionState.items[].usableInBattle",
  "runtimeGameState.battleActionState.items[].disabled",
  "runtimeGameState.battleActionState.party[].speciesId",
  "runtimeGameState.battleActionState.party[].hp",
  "runtimeGameState.battleActionState.party[].active",
  "runtimeGameState.battleActionState.party[].fainted",
  "runtimeGameState.battleActionState.canRun",
] as const;

const MAIN_MENU_CHOICES = ["fight", "item", "switch", "run"] as const;
const BATTLE_ACTION_KIND_ORDER: readonly PokemonBattleActionKind[] = [
  "fight",
  "item",
  "switch",
  "run",
];
export const BASIC_BATTLE_POLICY_RULE_ORDER = BATTLE_ACTION_KIND_ORDER;

export interface BattlePolicy {
  id: "basic-battle-policy";
  ruleOrder: readonly PokemonBattleActionKind[];
}

export const BASIC_BATTLE_POLICY = {
  id: "basic-battle-policy",
  ruleOrder: BASIC_BATTLE_POLICY_RULE_ORDER,
} as const satisfies BattlePolicy;

export function selectBasicBattlePolicyForRivalEncounter(): BattlePolicy {
  return BASIC_BATTLE_POLICY;
}

export interface BattlePolicyInput {
  battlePolicy?: BattlePolicy;
  battleState?: PokemonBattleActionState;
  runtimeGameState: PokemonStateObservation;
}

export interface BattlePolicyAction {
  buttons: readonly MgbaButton[];
  id: string;
  kind: PokemonBattleActionKind;
  reason: string;
  target:
    | { move: PokemonBattleMoveSlot; type: "move" }
    | { item: PokemonBattleItemSlot; type: "item" }
    | { partyMember: PokemonBattlePartySlot; type: "party" }
    | { type: "run" };
}

export function enumerateValidBattleActions({
  battleState,
  battlePolicy = BASIC_BATTLE_POLICY,
  runtimeGameState,
}: BattlePolicyInput): BattlePolicyAction[] {
  if (
    runtimeGameState.readStatus !== "available" ||
    runtimeGameState.battle !== true
  ) {
    return [];
  }

  const state = battleState ?? runtimeGameState.battleActionState;
  if (!state || state.readStatus === "unavailable") {
    return [];
  }

  const actions = [
    ...enumerateFightActions(state),
    ...enumerateItemActions(state),
    ...enumerateSwitchActions(state),
    ...enumerateRunActions(state),
  ].filter(isExecutableBattleAction);

  return actions.sort((left, right) =>
    compareBattlePolicyActions(left, right, battlePolicy)
  );
}

function isExecutableBattleAction(action: BattlePolicyAction): boolean {
  return action.buttons.length > 0;
}

export function chooseBattlePolicyAction(
  input: BattlePolicyInput
): BattlePolicyAction | undefined {
  return enumerateValidBattleActions(input)[0];
}

function enumerateFightActions(
  state: PokemonBattleActionState
): BattlePolicyAction[] {
  return [...state.moves]
    .filter(isUsableMove)
    .sort((left, right) => left.slot - right.slot)
    .map((move) => ({
      buttons: buttonsForAction(state, "fight", move.slot - 1),
      id: `fight:${move.slot}`,
      kind: "fight",
      reason: `BattlePolicy: move slot ${move.slot} has PP and is selectable.`,
      target: { move, type: "move" },
    }));
}

function enumerateItemActions(
  state: PokemonBattleActionState
): BattlePolicyAction[] {
  return [...state.items]
    .filter(isUsableItem)
    .sort((left, right) => left.slot - right.slot)
    .map((item) => ({
      buttons: buttonsForAction(state, "item", item.slot - 1),
      id: `item:${item.slot}`,
      kind: "item",
      reason: `BattlePolicy: item slot ${item.slot} has quantity and is battle-usable.`,
      target: { item, type: "item" },
    }));
}

function enumerateSwitchActions(
  state: PokemonBattleActionState
): BattlePolicyAction[] {
  return [...state.party]
    .filter(isSwitchTarget)
    .sort((left, right) => left.slot - right.slot)
    .map((partyMember) => ({
      buttons: buttonsForAction(state, "switch", partyMember.slot - 1),
      id: `switch:${partyMember.slot}`,
      kind: "switch",
      reason: `BattlePolicy: party slot ${partyMember.slot} is conscious and not active.`,
      target: { partyMember, type: "party" },
    }));
}

function enumerateRunActions(
  state: PokemonBattleActionState
): BattlePolicyAction[] {
  if (state.canRun !== true) {
    return [];
  }
  return [
    {
      buttons: buttonsForAction(state, "run", 0),
      id: "run",
      kind: "run",
      reason: "BattlePolicy: runtime battle state confirms Run is valid.",
      target: { type: "run" },
    },
  ];
}

function isUsableMove(move: PokemonBattleMoveSlot): boolean {
  return (
    move.moveId !== null && move.pp !== null && move.pp > 0 && !move.disabled
  );
}

function isUsableItem(item: PokemonBattleItemSlot): boolean {
  return (
    item.itemId !== null &&
    item.quantity !== null &&
    item.quantity > 0 &&
    item.usableInBattle === true &&
    !item.disabled
  );
}

function isSwitchTarget(partyMember: PokemonBattlePartySlot): boolean {
  return (
    partyMember.speciesId !== null &&
    partyMember.hp !== null &&
    partyMember.hp > 0 &&
    !partyMember.active &&
    !partyMember.fainted
  );
}

function compareBattlePolicyActions(
  left: BattlePolicyAction,
  right: BattlePolicyAction,
  battlePolicy: BattlePolicy
): number {
  return (
    actionKindPriority(left.kind, battlePolicy) -
      actionKindPriority(right.kind, battlePolicy) ||
    battleActionTargetPriority(left) - battleActionTargetPriority(right) ||
    compareAscii(left.id, right.id)
  );
}

function actionKindPriority(
  kind: PokemonBattleActionKind,
  battlePolicy: BattlePolicy
): number {
  const index = battlePolicy.ruleOrder.indexOf(kind);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

function battleActionTargetPriority(action: BattlePolicyAction): number {
  switch (action.target.type) {
    case "item":
      return action.target.item.slot;
    case "move":
      return action.target.move.slot;
    case "party":
      return action.target.partyMember.slot;
    case "run":
      return 0;
    default:
      return Number.MAX_SAFE_INTEGER;
  }
}

function compareAscii(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

function buttonsForAction(
  state: PokemonBattleActionState,
  kind: PokemonBattleActionKind,
  targetIndex: number
): readonly MgbaButton[] {
  if (state.ui.cursorIndex === null || state.ui.mode === "unknown") {
    return [];
  }

  if (state.ui.mode === "main-menu") {
    return [
      ...buttonsBetweenIndexes(
        state.ui.cursorIndex,
        MAIN_MENU_CHOICES.indexOf(kind)
      ),
      "A",
    ];
  }

  if (kind === "fight" && state.ui.mode === "move-select") {
    return [...buttonsBetweenIndexes(state.ui.cursorIndex, targetIndex), "A"];
  }

  if (kind === "item" && state.ui.mode === "bag-item-select") {
    return [...buttonsBetweenIndexes(state.ui.cursorIndex, targetIndex), "A"];
  }

  if (kind === "switch" && state.ui.mode === "party-select") {
    return [...buttonsBetweenIndexes(state.ui.cursorIndex, targetIndex), "A"];
  }

  return [];
}

function buttonsBetweenIndexes(
  fromIndex: number,
  toIndex: number
): MgbaButton[] {
  const direction: MgbaButton = toIndex >= fromIndex ? "Down" : "Up";
  const distance = Math.abs(toIndex - fromIndex);
  return Array.from({ length: distance }, () => direction);
}
