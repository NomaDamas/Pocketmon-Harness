import type { UserMessageContentPart } from "@minpeter/pss-runtime";
import type { MgbaHttpClient, MgbaStatus } from "./mgba-http";
import {
  formatPokemonStateObservation,
  type PokemonStateObservation,
  readPokemonStateObservation,
} from "./pokemon-state";
import { readOptimizedGameBoyScreenshotBase64 } from "./screenshot-image";
import { createScreenshotPath } from "./screenshot-path";
import { formatStage1RuntimePlan } from "./stage1-runtime-plan";
import { formatStuckMemory, type StuckMemorySnapshot } from "./stuck-memory";

export type ObservedAgentInput = readonly UserMessageContentPart[];

export interface MgbaObservation {
  screenshot: {
    data: string;
    mediaType: "image/png";
    path: string;
  };
  state?: PokemonStateObservation;
  status: MgbaStatus;
}

export async function captureMgbaObservation(
  client: MgbaHttpClient,
  signal?: AbortSignal
): Promise<MgbaObservation> {
  const screenshotPath = await createScreenshotPath();
  const [status, state] = await Promise.all([
    client.status(signal),
    readPokemonStateObservation(client, signal),
    client.screenshot(screenshotPath, signal),
  ]);
  const data = await readOptimizedGameBoyScreenshotBase64(screenshotPath, {
    overlayGrid: true,
  });

  return {
    screenshot: {
      data,
      mediaType: "image/png",
      path: screenshotPath,
    },
    state,
    status,
  };
}

export function createObservedInput({
  observation,
  recentActions = [],
  improvementHints = [],
  stuckMemory,
  text,
}: {
  improvementHints?: readonly string[];
  observation: MgbaObservation;
  recentActions?: readonly string[];
  stuckMemory?: StuckMemorySnapshot;
  text: string;
}): ObservedAgentInput {
  return [
    {
      text: createObservedText({
        observation,
        improvementHints,
        recentActions,
        stuckMemory,
        text,
      }),
      type: "text",
    },
    {
      image: `data:${observation.screenshot.mediaType};base64,${observation.screenshot.data}`,
      mediaType: observation.screenshot.mediaType,
      type: "image",
    },
  ] satisfies ObservedAgentInput;
}

function createObservedText({
  observation,
  improvementHints = [],
  recentActions = [],
  stuckMemory,
  text,
}: Parameters<typeof createObservedInput>[0]): string {
  return `${text}\n\nCurrent mGBA status:\n${formatStatus(observation.status)}${formatState(observation.state)}${formatRecentActions(recentActions)}${formatImprovementHints(improvementHints)}${formatStuckMemory(stuckMemory)}${formatStage1RuntimePlan({ recentActions, state: observation.state, stuckMemory })}\n\nCurrent screenshot: attached image below. Red grid lines are movement guide lines marking 16x16 Game Boy movement-cell boundaries. Treat the red grid as movement guide lines. First follow the Stage 1 Rule Memory Read recommendation when it has a recommended skill/action. If the runtime plan is unavailable or ambiguous, distinguish blocked cells, open walkable cells, and interactable-looking objects. In indoor scenes, solid black areas/borders/void, walls, furniture, and counters are blocked; visible floor tiles are walkable unless occupied. However, if a black/dark tile looks like a doorway, carpet, threshold, stairs, mat, path marker, or other movement-guiding feature, approach or test it once as a possible transition/exit. Then either move through open floor to explore unseen areas or face an object and press A to interact. Avoid repeating recent actions that did not visibly change progress.`;
}

export function formatStatus(status: MgbaStatus): string {
  const activeButtons = status.activeButtons.join(", ") || "none";
  return [
    `frame: ${status.frame ?? "unknown"}`,
    `game: ${[status.gameTitle, status.gameCode].filter(Boolean).join(" ") || "unknown"}`,
    `active buttons: ${activeButtons}`,
  ].join("\n");
}

function formatRecentActions(recentActions: readonly string[]): string {
  if (recentActions.length === 0) {
    return "";
  }

  return `\nrecent actions to avoid repeating blindly:\n${recentActions.map((action) => `- ${action}`).join("\n")}`;
}

function formatImprovementHints(improvementHints: readonly string[]): string {
  if (improvementHints.length === 0) {
    return "";
  }

  return `\nlatest self-improvement candidate hints:\n${improvementHints.map((hint) => `- ${hint}`).join("\n")}`;
}

function formatState(state: PokemonStateObservation | undefined): string {
  if (!state) {
    return "";
  }

  return `\n\nCurrent compact Pokémon state:\n${formatPokemonStateObservation(state)}`;
}
