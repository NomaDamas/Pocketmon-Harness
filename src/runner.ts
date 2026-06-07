import type { AgentEvent, AgentRun } from "@minpeter/pss-runtime";
import type { MgbaHttpClient } from "./mgba-http";
import {
  captureMgbaObservation,
  createObservedInput,
  type MgbaObservation,
  type ObservedAgentInput,
} from "./observation";
import type { StuckMemorySnapshot } from "./stuck-memory";
import {
  createSupervisorEvent,
  type SupervisorIntervention,
  type SupervisorInterventionEvent,
  waitThroughBlackFrames,
} from "./supervisor";

export type RunnerEvent = AgentEvent | SupervisorInterventionEvent;

export const POKEMON_OBJECTIVE_PROMPT = [
  "You are a fallback analyst, not the main Pokémon player.",
  "The harness owns route memory, phase/waypoint state, deterministic execution, and verification.",
  "You are called only when RAM/pathfinder/controller cannot classify the state or verification repeatedly failed.",
  "Use the injected RAM state, screenshot, failed action memory, and controller fallback reason to propose one recovery hypothesis only.",
  "Execute exactly one constrained recovery control action, then stop. Do not take over long-term routing.",
  "Prefer actions that resolve unknown UI state: advance confirmed dialogue, cancel unexpected menu, or test one safe movement/object interaction.",
  "Never reset, reload, restart, erase progress, or intentionally diverge from the controller objective.",
  "If recent A presses did not change state, do not spam A; choose B, a directional reorientation, or a single alternative hypothesis.",
  "Do not reset, reload the ROM, restart, or erase progress under any circumstance.",
].join("\n");

export function createTurnPrompt(turn: number): string {
  return turn <= 1
    ? POKEMON_OBJECTIVE_PROMPT
    : createContinuationPrompt(turn - 1);
}

export function createContinuationPrompt(turn: number): string {
  return [
    `Fallback turn ${turn} ended. Continue only as recovery analyst.`,
    "Fallback contract:",
    POKEMON_OBJECTIVE_PROMPT,
    "Before any tool call, output exactly one <action_plan>...</action_plan> block with controller gap, visible evidence, one recovery hypothesis, next action, and repetition to avoid.",
  ].join("\n");
}

export async function streamRun(
  run: AgentRun,
  onEvent: (event: AgentEvent) => void = console.dir,
  {
    maxSteps,
    maxToolResults,
    onLimit,
  }: {
    maxSteps?: number;
    maxToolResults?: number;
    onLimit?: (reason: "max-steps" | "max-tool-results") => void;
  } = {}
): Promise<void> {
  let steps = 0;
  let toolResults = 0;
  const iterator = run.stream()[Symbol.asyncIterator]();
  try {
    while (true) {
      const next = await iterator.next();
      if (next.done) {
        return;
      }
      const event = next.value;
      onEvent(event);
      if (event.type === "step-end") {
        steps += 1;
        if (maxSteps !== undefined && steps >= maxSteps) {
          onLimit?.("max-steps");
          await iterator.return?.();
          return;
        }
      }
      if (event.type === "tool-result") {
        toolResults += 1;
        if (maxToolResults !== undefined && toolResults >= maxToolResults) {
          onLimit?.("max-tool-results");
          await iterator.return?.();
          return;
        }
      }
    }
  } finally {
    await iterator.return?.();
  }
}

export async function streamSupervisedRun({
  client,
  maxSteps,
  maxToolResults,
  onLimit,
  onEvent = console.dir,
  run,
}: {
  client: MgbaHttpClient;
  maxSteps?: number;
  maxToolResults?: number;
  onLimit?: (reason: "max-steps" | "max-tool-results") => void;
  onEvent?: (event: RunnerEvent) => void;
  run: AgentRun;
}): Promise<void> {
  await streamRun(run, onEvent, { maxSteps, maxToolResults, onLimit });
  await waitThroughBlackFrames({
    client,
    onIntervention: (intervention) =>
      onEvent(createSupervisorEvent(intervention)),
  });
}

export function createSupervisorInterventionEvent(
  intervention: SupervisorIntervention
): SupervisorInterventionEvent {
  return createSupervisorEvent(intervention);
}

export async function createObservedTurnInput({
  client,
  onObservation,
  recentActions,
  stuckMemory,
  turn,
}: {
  client: MgbaHttpClient;
  onObservation?: (observation: MgbaObservation) => void | Promise<void>;
  recentActions?: readonly string[];
  stuckMemory?: StuckMemorySnapshot;
  turn: number;
}): Promise<ObservedAgentInput> {
  const observation = await captureMgbaObservation(client);
  await onObservation?.(observation);
  return createObservedInput({
    observation,
    recentActions,
    stuckMemory,
    text: createTurnPrompt(turn),
  });
}

export async function createObservedContinuationInput({
  client,
  onObservation,
  recentActions,
  stuckMemory,
  turn,
}: {
  client: MgbaHttpClient;
  onObservation?: (observation: MgbaObservation) => void | Promise<void>;
  recentActions?: readonly string[];
  stuckMemory?: StuckMemorySnapshot;
  turn: number;
}): Promise<ObservedAgentInput> {
  return await createObservedTurnInput({
    client,
    onObservation,
    recentActions,
    stuckMemory,
    turn: turn + 1,
  });
}
