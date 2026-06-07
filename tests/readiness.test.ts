import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { formatHarnessReadiness, loadHarnessReadiness } from "../src/readiness";

describe("harness readiness", () => {
  it("reports ready and blocked execution surfaces", async () => {
    const traceRoot = await mkdtemp(join(tmpdir(), "pss-readiness-"));
    await mkdir(join(traceRoot, "runs", "run-1"), { recursive: true });
    const romPath = join(traceRoot, "Pokemon Red.gb");
    await writeFile(romPath, "");

    const readiness = await loadHarnessReadiness({
      env: {
        AI_API_KEY: "test-key",
        AI_BASE_URL: "https://example.test/v1",
        AI_PROVIDER: "grok",
        MGBA_HTTP_BASE_URL: "http://127.0.0.1:5001",
        POKEMON_ROM_PATH: romPath,
      },
      fetchImpl: async () =>
        new Response("123", {
          status: 200,
        }),
      now: new Date("2026-06-06T00:00:00.000Z"),
      traceRoot,
    });

    expect(readiness.summary.ready).toBeGreaterThanOrEqual(5);
    expect(readiness.items).toContainEqual(
      expect.objectContaining({
        label: "mGBA HTTP",
        status: "ready",
      })
    );
    expect(readiness.items).toContainEqual(
      expect.objectContaining({
        label: "RAM controller",
        status: "ready",
      })
    );
    expect(formatHarnessReadiness(readiness)).toContain(
      "Pokemon Harness Readiness"
    );
  });

  it("blocks when model base URL and mGBA HTTP are unavailable", async () => {
    const traceRoot = await mkdtemp(join(tmpdir(), "pss-readiness-"));
    const readiness = await loadHarnessReadiness({
      env: {
        AI_API_KEY: "test-key",
        MGBA_HTTP_BASE_URL: "http://127.0.0.1:5001",
      },
      fetchImpl: () => {
        throw new Error("offline");
      },
      traceRoot,
    });

    expect(readiness.items).toContainEqual(
      expect.objectContaining({
        label: "Model config",
        status: "blocked",
      })
    );
    expect(readiness.items).toContainEqual(
      expect.objectContaining({
        label: "mGBA HTTP",
        status: "blocked",
      })
    );
    expect(readiness.items).toContainEqual(
      expect.objectContaining({
        label: "RAM controller",
        status: "blocked",
      })
    );
  });
});
