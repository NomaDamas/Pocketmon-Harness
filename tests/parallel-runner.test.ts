import { describe, expect, it } from "vitest";
import {
  createParallelHarnessPlan,
  createReachableParallelHarnessPlan,
  parseParallelEndpoints,
  parseParallelPorts,
} from "../src/parallel-runner";

describe("parallel harness runner", () => {
  it("parses configured mGBA ports", () => {
    expect(parseParallelPorts("5001, 5002,,5003")).toEqual([
      "5001",
      "5002",
      "5003",
    ]);
  });

  it("parses configured session URLs without printing auth tokens", () => {
    expect(
      parseParallelEndpoints(
        "http://127.0.0.1:8787/api/sessions/a|token-a, http://127.0.0.1:8787/api/sessions/b|token-b"
      )
    ).toEqual([
      {
        authToken: "token-a",
        baseUrl: "http://127.0.0.1:8787/api/sessions/a",
        label: "127.0.0.1:8787/api/sessions/a",
        port: "8787",
      },
      {
        authToken: "token-b",
        baseUrl: "http://127.0.0.1:8787/api/sessions/b",
        label: "127.0.0.1:8787/api/sessions/b",
        port: "8787",
      },
    ]);
  });

  it("creates one real harness process plan per mGBA port", () => {
    const plan = createParallelHarnessPlan({
      batchId: "batch-test",
      command: "pnpm",
      ports: ["5001", "5002"],
    });

    expect(plan.instances).toEqual([
      expect.objectContaining({
        env: expect.objectContaining({
          EXPERIMENT_HYPOTHESIS: "pathfinder-first",
          EXPERIMENT_ID: "batch-test:parallel-1:pathfinder-first",
          HARNESS_MAX_RAM_UNAVAILABLE_TURNS: "1",
          MGBA_HTTP_BASE_URL: "http://127.0.0.1:5001",
          PARALLEL_BATCH_ID: "batch-test",
          POKEMON_RUN_INSTANCE: "1",
        }),
        hypothesis: "pathfinder-first",
        label: "pokemon-1:pathfinder-first",
      }),
      expect.objectContaining({
        env: expect.objectContaining({
          EXPERIMENT_HYPOTHESIS: "dialogue-recovery",
          EXPERIMENT_ID: "batch-test:parallel-2:dialogue-recovery",
          HARNESS_MAX_RAM_UNAVAILABLE_TURNS: "1",
          MGBA_HTTP_BASE_URL: "http://127.0.0.1:5002",
          PARALLEL_BATCH_ID: "batch-test",
          POKEMON_RUN_INSTANCE: "2",
        }),
        hypothesis: "dialogue-recovery",
        label: "pokemon-2:dialogue-recovery",
      }),
    ]);
  });

  it("preserves an explicit RAM-unavailable fallback budget override", () => {
    const previous = process.env.HARNESS_MAX_RAM_UNAVAILABLE_TURNS;
    process.env.HARNESS_MAX_RAM_UNAVAILABLE_TURNS = "3";
    try {
      const plan = createParallelHarnessPlan({
        batchId: "batch-test",
        ports: ["5001", "5002"],
      });

      expect(
        plan.instances.map(
          (instance) => instance.env.HARNESS_MAX_RAM_UNAVAILABLE_TURNS
        )
      ).toEqual(["3", "3"]);
    } finally {
      if (previous === undefined) {
        delete process.env.HARNESS_MAX_RAM_UNAVAILABLE_TURNS;
      } else {
        process.env.HARNESS_MAX_RAM_UNAVAILABLE_TURNS = previous;
      }
    }
  });

  it("preflights mGBA-http ports and skips offline slots", async () => {
    const seen: string[] = [];
    const fetchImpl = ((url: string | URL | Request) => {
      const text = String(url);
      seen.push(text);
      return Promise.resolve(
        new Response("", { status: text.includes("5002") ? 500 : 200 })
      );
    }) as typeof fetch;

    const plan = await createReachableParallelHarnessPlan({
      fetchImpl,
      ports: ["5001", "5002", "5003"],
    });

    expect(seen).toEqual([
      "http://127.0.0.1:5001/core/currentframe",
      "http://127.0.0.1:5002/core/currentframe",
      "http://127.0.0.1:5003/core/currentframe",
    ]);
    expect(plan.instances.map((instance) => instance.port)).toEqual([
      "5001",
      "5003",
    ]);
  });

  it("preflights independent session URLs with auth headers", async () => {
    const seen: { token: string | null; url: string }[] = [];
    const fetchImpl = ((url: string | URL | Request, init?: RequestInit) => {
      seen.push({
        token: new Headers(init?.headers).get("Authorization"),
        url: String(url),
      });
      return Promise.resolve(new Response("", { status: 200 }));
    }) as typeof fetch;

    const plan = await createReachableParallelHarnessPlan({
      endpoints: parseParallelEndpoints(
        "http://127.0.0.1:8787/api/sessions/a|token-a,http://127.0.0.1:8787/api/sessions/b|token-b"
      ),
      fetchImpl,
      ports: [],
    });

    expect(seen).toEqual([
      {
        token: "Bearer token-a",
        url: "http://127.0.0.1:8787/api/sessions/a/core/currentframe",
      },
      {
        token: "Bearer token-b",
        url: "http://127.0.0.1:8787/api/sessions/b/core/currentframe",
      },
    ]);
    expect(plan.instances.map((instance) => instance.env)).toEqual([
      expect.objectContaining({
        MGBA_HTTP_AUTH_TOKEN: "token-a",
        MGBA_HTTP_BASE_URL: "http://127.0.0.1:8787/api/sessions/a",
      }),
      expect.objectContaining({
        MGBA_HTTP_AUTH_TOKEN: "token-b",
        MGBA_HTTP_BASE_URL: "http://127.0.0.1:8787/api/sessions/b",
      }),
    ]);
  });

  it("requires at least two ports", () => {
    expect(() => createParallelHarnessPlan({ ports: ["5001"] })).toThrow(
      "at least two reachable"
    );
  });

  it("requires at least two reachable ports after preflight", async () => {
    const fetchImpl = ((url: string | URL | Request) =>
      Promise.resolve(
        new Response("", { status: String(url).includes("5001") ? 200 : 500 })
      )) as typeof fetch;

    await expect(
      createReachableParallelHarnessPlan({
        fetchImpl,
        ports: ["5001", "5002", "5003"],
      })
    ).rejects.toThrow("reachable=5001 skipped=5002,5003");
  });
});
