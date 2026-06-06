import { loadTuiDashboardState, type TuiDashboardState } from "./tui-summary";

const DEFAULT_INTERVAL_MS = 1000;
const DONE_PROGRESS_STEPS = 20;

interface TuiOptions {
  intervalMs: number;
  once: boolean;
  runId?: string;
}

const colors = {
  blue: "\u001b[34m",
  bold: "\u001b[1m",
  cyan: "\u001b[36m",
  dim: "\u001b[2m",
  green: "\u001b[32m",
  reset: "\u001b[0m",
  yellow: "\u001b[33m",
};

const options = parseArgs(process.argv.slice(2));

if (!options.once) {
  process.stdout.write("\u001b[?25l");
  process.on("SIGINT", () => {
    process.stdout.write("\u001b[?25h\n");
    process.exit(0);
  });
}

await renderLoop(options);

async function renderLoop(options: TuiOptions): Promise<void> {
  while (true) {
    const rendered = await renderDashboard(options.runId);
    if (options.once) {
      process.stdout.write(`${rendered}\n`);
      return;
    }

    process.stdout.write(`\u001b[2J\u001b[H${rendered}`);
    await sleep(options.intervalMs);
  }
}

async function renderDashboard(runId?: string): Promise<string> {
  try {
    const state = await loadTuiDashboardState({ runId });
    return formatDashboard(state);
  } catch (error) {
    return [
      title("Pokemon Harness TUI"),
      "",
      `${colors.yellow}Waiting for trace data...${colors.reset}`,
      error instanceof Error ? error.message : String(error),
    ].join("\n");
  }
}

export function formatDashboard(state: TuiDashboardState): string {
  const tokenTotal = state.tokenUsage?.totalTokens ?? 0;
  const macro = state.macroProgress;
  const macroBar = progressBar(macro.progress, DONE_PROGRESS_STEPS);
  const tokenBar = progressBar(
    Math.min(tokenTotal / 50_000, 1),
    DONE_PROGRESS_STEPS
  );
  const actionBar = progressBar(
    Math.min(state.actions.count / 100, 1),
    DONE_PROGRESS_STEPS
  );

  return [
    title("Pokemon Harness TUI"),
    kv("Run", state.run.runId),
    kv("Mode", state.run.mode ?? "unknown"),
    kv("Milestone", state.run.milestone ?? "none"),
    kv("Model", state.modelId ?? "waiting"),
    "",
    section("Macro Progress"),
    kv(
      "Phase",
      `${macroBar} ${macro.phaseIndex}/${macro.totalPhases} ${macro.phaseLabel}`
    ),
    kv("Health", `${macro.health} · confidence ${macro.confidence}`),
    wrap("Signals", macro.signals.join(" · ") || "waiting", 92),
    wrap("Gaps", macro.gaps.join(" ") || "none", 92),
    "",
    section("Runtime"),
    kv(
      "Events",
      `${state.events.total} total / ${state.events.observations} obs`
    ),
    kv("Actions", `${actionBar} ${state.actions.count}`),
    kv("Supervisor", `${state.supervisorInterventions} interventions`),
    kv("Frame", state.lastFrame?.toLocaleString() ?? "unknown"),
    kv("Map", state.lastMap?.toString() ?? "unknown"),
    kv("Position", formatPosition(state)),
    "",
    section("Tokens"),
    kv("Step", `${state.tokenUsage?.step ?? "?"}`),
    kv("Turn", `${state.tokenUsage?.turn ?? "?"}`),
    kv("Total", `${tokenBar} ${tokenTotal.toLocaleString()}`),
    kv("Input", `${state.tokenUsage?.inputTokens?.toLocaleString() ?? "?"}`),
    kv("Output", `${state.tokenUsage?.outputTokens?.toLocaleString() ?? "?"}`),
    kv(
      "Reasoning",
      `${state.tokenUsage?.reasoningTokens?.toLocaleString() ?? "?"}`
    ),
    "",
    section("Latest"),
    kv("Action", formatLatestAction(state)),
    kv("Event At", state.lastEventAt ?? "unknown"),
    wrap("Reasoning", state.assistantReasoning ?? "waiting", 92),
    "",
    `${colors.dim}Ctrl-C to close the observer. The TUI is read-only.${colors.reset}`,
  ].join("\n");
}

function formatLatestAction(state: TuiDashboardState): string {
  return state.actions.lastToolName
    ? `${state.actions.lastToolName} ${safeJson(state.actions.lastInput)}`
    : "none";
}

function formatPosition(state: TuiDashboardState): string {
  if (
    !state.lastPosition ||
    (state.lastPosition.x === undefined && state.lastPosition.y === undefined)
  ) {
    return "unknown";
  }

  return `x=${state.lastPosition.x ?? "?"}, y=${state.lastPosition.y ?? "?"}`;
}

function parseArgs(args: string[]): TuiOptions {
  const options: TuiOptions = {
    intervalMs: DEFAULT_INTERVAL_MS,
    once: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--once") {
      options.once = true;
      continue;
    }
    if (arg === "--run") {
      options.runId = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--interval-ms") {
      options.intervalMs = Number(args[index + 1]);
      index += 1;
    }
  }

  if (!Number.isFinite(options.intervalMs) || options.intervalMs < 250) {
    options.intervalMs = DEFAULT_INTERVAL_MS;
  }

  return options;
}

function title(text: string): string {
  return `${colors.bold}${colors.cyan}${text}${colors.reset}`;
}

function section(text: string): string {
  return `${colors.bold}${colors.blue}${text}${colors.reset}`;
}

function kv(key: string, value: string): string {
  return `${colors.green}${key.padEnd(12)}${colors.reset} ${value}`;
}

function progressBar(value: number, width: number): string {
  const filled = Math.round(value * width);
  return `[${"█".repeat(filled)}${"░".repeat(width - filled)}]`;
}

function safeJson(value: unknown): string {
  if (value === undefined) {
    return "";
  }
  const json = JSON.stringify(value);
  return json.length > 80 ? `${json.slice(0, 77)}...` : json;
}

function wrap(label: string, text: string, width: number): string {
  const prefix = `${colors.green}${label.padEnd(12)}${colors.reset} `;
  const plainPrefixLength = label.padEnd(12).length + 1;
  const available = Math.max(20, width - plainPrefixLength);
  const words = text.split(" ");
  const lines: string[] = [];
  let line = "";

  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > available && line) {
      lines.push(line);
      line = word;
      continue;
    }
    line = next;
  }
  if (line) {
    lines.push(line);
  }

  return lines
    .map((item, index) =>
      index === 0
        ? `${prefix}${item}`
        : `${" ".repeat(plainPrefixLength)}${item}`
    )
    .join("\n");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
