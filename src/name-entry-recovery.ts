import type { MgbaButton } from "./mgba-http";
import type { PokemonStateObservation } from "./pokemon-state";

export interface NameEntryRecoveryAction {
  button: MgbaButton;
  reason: string;
  toolName: "mgba_tap";
}

const NAME_ENTRY_MAP_ID = 158;
const NAME_ENTRY_CONFIRM_RIGHT_ATTEMPTS = 5;

export function isLikelyNameEntryState(
  state: PokemonStateObservation | undefined
): boolean {
  return (
    state?.readStatus === "available" &&
    state.mapId === NAME_ENTRY_MAP_ID &&
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

  const rightCount = countRecentButton(recentActions, "Right");
  const downCount = countRecentButton(recentActions, "Down");

  if (rightCount >= NAME_ENTRY_CONFIRM_RIGHT_ATTEMPTS) {
    return {
      button: "A",
      reason:
        "Name-entry recovery: enough rightward cursor movement has been attempted; confirm the likely END/menu item instead of looping.",
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
