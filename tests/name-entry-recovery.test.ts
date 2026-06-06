import { describe, expect, it } from "vitest";
import { chooseNameEntryRecoveryAction } from "../src/name-entry-recovery";
import type { PokemonStateObservation } from "../src/pokemon-state";

const nameEntryState: PokemonStateObservation = {
  battle: false,
  battleResult: null,
  battleType: null,
  dialogueLike: "visual-fallback",
  direction: "down",
  mapId: 38,
  menuLike: "visual-fallback",
  position: { x: 3, y: 6 },
  readStatus: "available",
};

describe("name entry recovery", () => {
  it("moves down before wandering through letters", () => {
    expect(chooseNameEntryRecoveryAction(nameEntryState, [])).toMatchObject({
      button: "Down",
      toolName: "mgba_tap",
    });
  });

  it("moves right after reaching the lower keyboard rows", () => {
    expect(
      chooseNameEntryRecoveryAction(nameEntryState, [
        'tap: {"button":"Down"}',
        'tap: {"button":"Down"}',
      ])
    ).toMatchObject({
      button: "Right",
      toolName: "mgba_tap",
    });
  });

  it("confirms after enough rightward movement", () => {
    expect(
      chooseNameEntryRecoveryAction(nameEntryState, [
        'tap: {"button":"Down"}',
        'tap: {"button":"Down"}',
        'tap: {"button":"Right"}',
        'tap: {"button":"Right"}',
        'tap: {"button":"Right"}',
        'tap: {"button":"Start"}',
      ])
    ).toMatchObject({
      button: "A",
      toolName: "mgba_tap",
    });
  });
});
