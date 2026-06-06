import { improveLatestTrace } from "./self-improvement";
import { updateStrategyBook } from "./strategy-book";

const DEFAULT_INTERVAL_MS = 15_000;

if (isMainModule()) {
  await watchSelfImprovement();
}

export async function watchSelfImprovement({
  intervalMs = parsePositiveInt(
    process.env.SELF_IMPROVEMENT_WATCH_INTERVAL_MS,
    DEFAULT_INTERVAL_MS
  ),
}: {
  intervalMs?: number;
} = {}): Promise<void> {
  let lastStatus = "";
  while (true) {
    try {
      const result = await improveLatestTrace();
      if (result.status === "candidate-written") {
        await updateStrategyBook();
      }
      const status = `${result.runId}:${result.status}:${result.outputPath ?? ""}`;
      if (status !== lastStatus) {
        lastStatus = status;
        process.stdout.write(`${JSON.stringify(result)}\n`);
      }
    } catch (error) {
      process.stderr.write(
        `${JSON.stringify({
          message: error instanceof Error ? error.message : String(error),
          type: "self-improvement-watch-error",
        })}\n`
      );
    }
    await sleep(intervalMs);
  }
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isMainModule(): boolean {
  return process.argv[1]?.endsWith("/self-improvement-watch.ts") ?? false;
}
