# Formal Ouroboros Evaluate Result

- Session ID: `controller-primary-stage1-gap-closure-20260611-node22`
- Final approved by MCP evaluate: `False`
- Highest MCP stage completed: `1`
- MCP failure class: environment runner mismatch
- Local mechanical guardrails: `PASS`

## Current Handler Output

```text
Evaluation Results
============================================================
Execution ID: controller-primary-stage1-gap-closure-20260611-node22
Final Approval: REJECTED
Highest Stage Completed: 1

Stage 1: Mechanical Verification
----------------------------------------
Status: FAILED
Coverage: N/A
  [FAIL] lint: Check lint failed (exit code 1)
  [FAIL] build: Check build failed (exit code 1)
  [FAIL] test: Check test failed (exit code 1)
  [FAIL] static: Check static failed (exit code 1)
  [PASS] coverage: Check coverage skipped (no command configured)
```

## Interpretation

This MCP result does not match direct project verification. Direct verification
passes when commands are run under the repository-pinned Node 22.22.2 runtime:

- `pnpm typecheck`: pass
- `pnpm test:ci`: 41 passed test files, 2 skipped; 462 passed tests, 12 skipped
- `pnpm build`: pass
- `pnpm check`: pass
- `POKEMON_ENABLE_SERVER_TESTS=1 pnpm test -- tests/metrics-server.test.ts tests/viewer-server.test.ts`: 43 passed test files; 474 passed tests

The mismatch is explained by the ambient shell runtime. Outside the pinned Node
22 path, `node --version` is `v20.8.0`, and `pnpm --version` fails before any
project script runs:

```text
TypeError: Invalid host defined options
Node.js v20.8.0
```

The repository now contains `.nvmrc` and `.node-version` set to `22.22.2` to make
the expected runtime explicit. Until the Ouroboros MCP runner honors the pinned
runtime or accepts an injected PATH, the direct Node 22 guardrail output in
`docs/ouroboros-formal-guardrail-output.md` is the authoritative mechanical
evidence for this working tree.

## Semantic Status

The controller-primary gap closure is implemented and locally verified:

- Known Stage 1 phases go through deterministic controller policy before LLM
  fallback.
- LLM fallback is bounded and admitted only after controller-owned recovery or
  verification gates.
- RAM-derived state, phase, verification, fallback, battle, starter, run metrics,
  run summaries, token usage, viewer events, and parallel evidence paths have
  tests.
- README contains the gap-to-test traceability matrix tying each claimed closure
  to implementation and guardrail tests.

The remaining limitation is live emulator proof across a RAM-capable endpoint.
Frame-only emulator sessions are intentionally skipped or stopped because they
cannot support controller-primary `mapId/x/y` authority.
