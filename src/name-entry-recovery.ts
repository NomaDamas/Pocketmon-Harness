import type { MgbaButton } from "./mgba-http";
import type { PokemonStateObservation } from "./pokemon-state";

export interface NameEntryRecoveryAction {
  button: MgbaButton;
  reason: string;
  toolName: "mgba_tap";
}

const NAME_ENTRY_MAP_ID = 38;
const NAME_ENTRY_POSITION = { x: 3, y: 6 } as const;
const CONFIRM_OR_START_PATTERN = /\b(Start|A)\b/;

export function isLikelyNameEntryState(
  state: PokemonStateObservation | undefined
): boolean {
  return (
    state?.readStatus === "available" &&
    state.mapId === NAME_ENTRY_MAP_ID &&
    state.position.x === NAME_ENTRY_POSITION.x &&
    state.position.y === NAME_ENTRY_POSITION.y &&
    state.battle === false
  );
}

export function chooseNameEntryRecoveryAction(
  state: PokemonStateObservation | undefined,
  recentActions: readonly string[] = []
): NameEntryRecoveryAction | undefined {
  if (!isLikelyNameEntryState(state)) {
    return;
  }

  const recent = recentActions.join(" ");
  const rightCount = countRecentButton(recentActions, "Right");
  const downCount = countRecentButton(recentActions, "Down");

  if (CONFIRM_OR_START_PATTERN.test(recent) && rightCount >= 3) {
    return {
      button: "A",
      reason:
        "Name-entry recovery: enough rightward cursor movement has been attempted; confirm the likely END/menu item.",
      toolName: "mgba_tap",
    };
  }
  if (downCount < 2) {
    return {
      button: "Down",
      reason:
        "Name-entry recovery: move toward the lower END/menu row instead of adding random letters.",
      toolName: "mgba_tap",
    };
  }
  return {
    button: "Right",
    reason:
      "Name-entry recovery: walk the cursor right along the lower keyboard row toward END before confirming.",
    toolName: "mgba_tap",
  };
}

function countRecentButton(
  recentActions: readonly string[],
  button: MgbaButton
): number {
  const pattern = new RegExp(`"button"\\s*:\\s*"${button}"`);
  return recentActions.filter((action) => pattern.test(action)).length;
}
