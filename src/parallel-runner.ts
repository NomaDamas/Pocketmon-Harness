import { type ChildProcess, spawn } from "node:child_process";

export interface ParallelHarnessInstance {
  command: string;
  env: Record<string, string>;
  index: number;
  label: string;
  port: string;
}

export interface ParallelHarnessPlan {
  instances: ParallelHarnessInstance[];
}

const DEFAULT_COMMAND = "pnpm";
const DEFAULT_ARGS = ["dev"];

if (isMainModule()) {
  const plan = createParallelHarnessPlan({
    command: process.env.POKEMON_PARALLEL_COMMAND ?? DEFAULT_COMMAND,
    ports: parseParallelPorts(process.env.POKEMON_PARALLEL_MGBA_PORTS),
  });
  runParallelHarnessPlan(plan);
}

export function parseParallelPorts(value?: string): string[] {
  return (value ?? "")
    .split(",")
    .map((port) => port.trim())
    .filter(Boolean);
}

export function createParallelHarnessPlan({
  command = DEFAULT_COMMAND,
  ports,
}: {
  command?: string;
  ports: readonly string[];
}): ParallelHarnessPlan {
  if (ports.length < 2) {
    throw new Error(
      "POKEMON_PARALLEL_MGBA_PORTS must contain at least two comma-separated ports, for example 5001,5002"
    );
  }

  return {
    instances: ports.map((port, index) => ({
      command,
      env: {
        EXPERIMENT_ID: `parallel-${index + 1}`,
        MGBA_HTTP_BASE_URL: `http://127.0.0.1:${port}`,
        POKEMON_RUN_INSTANCE: String(index + 1),
      },
      index,
      label: `pokemon-${index + 1}`,
      port,
    })),
  };
}

export function runParallelHarnessPlan(plan: ParallelHarnessPlan): void {
  const children = plan.instances.map(startInstance);

  const stop = () => {
    for (const child of children) {
      child.kill("SIGINT");
    }
  };

  process.on("SIGINT", () => {
    stop();
    process.exit(130);
  });
  process.on("SIGTERM", () => {
    stop();
    process.exit(143);
  });
}

function startInstance(instance: ParallelHarnessInstance): ChildProcess {
  const child = spawn(instance.command, DEFAULT_ARGS, {
    env: {
      ...process.env,
      ...instance.env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.stdout?.on("data", (chunk) => {
    process.stdout.write(prefixLines(instance.label, chunk));
  });
  child.stderr?.on("data", (chunk) => {
    process.stderr.write(prefixLines(instance.label, chunk));
  });
  child.on("exit", (code, signal) => {
    process.stderr.write(
      `[${instance.label}] exited code=${code ?? "null"} signal=${signal ?? "null"}\n`
    );
  });

  process.stdout.write(
    `[${instance.label}] started ${instance.command} ${DEFAULT_ARGS.join(" ")} on ${instance.env.MGBA_HTTP_BASE_URL}\n`
  );
  return child;
}

function prefixLines(label: string, chunk: unknown): string {
  return String(chunk)
    .split("\n")
    .map((line, index, lines) =>
      index === lines.length - 1 && line === "" ? "" : `[${label}] ${line}`
    )
    .join("\n");
}

function isMainModule(): boolean {
  return process.argv[1]?.endsWith("/parallel-runner.ts") ?? false;
}
