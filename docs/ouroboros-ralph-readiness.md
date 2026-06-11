# Ouroboros / Ralph Readiness

## Current Completion State

Stage 1 foundation is implemented for the Pokemon Red autonomous harness:

- Machine-readable Stage 1 schemas, rule memory, active rules, skills, route knowledge, quests, candidates, and human overrides.
- Goal-scoped active memory read for the Pallet Town -> Route 1 -> Viridian City objective.
- Rule -> Skill -> Action structures with LLM fallback remaining in the live runner.
- Progress-first evaluators for map progress, Viridian success, loop score, repeated action score, stuck score, tool error score, frame windows, candidate gates, human override, and replay scoring.
- Evidence-driven patch candidate scaffolding without directly mutating active knowledge.
- Read-only TUI observer over trace files.

The stale Ouroboros session from the original local run was closed in the local
operator environment. The repository intentionally does not include, require, or
reference the global Ouroboros database.

```text
orchestrator.session.cancelled
session: orch_d43d5ea98fe3
reason: stale run stopped after manual completion and local evaluation passed
```

Do not commit `~/.ouroboros`, `ouroboros.db`, global event-store backups, or
other projects' sessions into this repository. The only Ouroboros material that
belongs here is project-local specification and verification evidence for
Pocketmon Harness.

## Runtime Commands

Run the live harness:

```bash
pnpm dev
```

Observe the latest run in a terminal dashboard:

```bash
pnpm tui
```

Render one TUI snapshot and exit:

```bash
pnpm tui -- --once
```

Run the local viewer:

```bash
pnpm viewer
```

## Ralph Path

The Ralph skill requires the Ouroboros MCP tools:

```text
ouroboros_ralph
ouroboros_job_wait
ouroboros_job_status
ouroboros_job_result
ouroboros_cancel_job
```

In this Codex session, deferred tool search did not expose those tools. It only
exposed multi-agent tools, so a real Ralph MCP loop could not be started from
this surface.

When the MCP tools are available, start Ralph with the validated seed:

```text
lineage_id: ralph-pokemon-red-stage1-20260606
seed_content: pokemon-red-stage1-autonomous-harness.seed.yaml
project_dir: .
execute: true
parallel: true
skip_qa: false
max_generations: 10
```

## Gap Audit

Completed now:

- Stage 1 rule/skill/evaluator foundation.
- Repeated loop and same-action evidence at/after 3 attempts.
- Frame-native 640-frame evaluation policy.
- Candidate-only self-improvement artifacts and QA gating structures.
- Human override schema and handling.
- Replay-ready trace scoring interfaces.
- Grok/OpenAI-compatible provider switching.
- Live Grok smoke test and active Pokemon Red harness run.
- TUI observer for live trace monitoring.

Known follow-up gaps:

- Ralph MCP execution is blocked until the `ouroboros_ralph` MCP tool is exposed.
- Multi-port live mGBA parallel execution is intentionally not built in Stage 1.
- Full-game rulebook beyond the Viridian City Stage 1 slice remains future work.
- Active live runner now uses the Stage 1 hybrid path required for this phase: each observation includes a Rule Memory Read summary, selected rules, recommended skill, and recommended action. LLM direct action remains only the fallback for unavailable or ambiguous runtime plan evidence.

## Guardrail

Use the project-pinned Node 22 locally:

```bash
nvm use
pnpm typecheck
pnpm test:ci
pnpm build
pnpm check
```
