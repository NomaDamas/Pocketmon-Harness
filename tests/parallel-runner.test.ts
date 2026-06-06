import { describe, expect, it } from "vitest";
import {
  createParallelHarnessPlan,
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

  it("creates one real harness process plan per mGBA port", () => {
    const plan = createParallelHarnessPlan({
      command: "pnpm",
      ports: ["5001", "5002"],
    });

    expect(plan.instances).toEqual([
      expect.objectContaining({
        env: expect.objectContaining({
          EXPERIMENT_ID: "parallel-1",
          MGBA_HTTP_BASE_URL: "http://127.0.0.1:5001",
          POKEMON_RUN_INSTANCE: "1",
        }),
        label: "pokemon-1",
      }),
      expect.objectContaining({
        env: expect.objectContaining({
          EXPERIMENT_ID: "parallel-2",
          MGBA_HTTP_BASE_URL: "http://127.0.0.1:5002",
          POKEMON_RUN_INSTANCE: "2",
        }),
        label: "pokemon-2",
      }),
    ]);
  });

  it("requires at least two ports", () => {
    expect(() => createParallelHarnessPlan({ ports: ["5001"] })).toThrow(
      "POKEMON_PARALLEL_MGBA_PORTS"
    );
  });
});
