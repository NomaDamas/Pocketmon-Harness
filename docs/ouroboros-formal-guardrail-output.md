# Formal Guardrail Output

Environment:

```text
Node: v22.22.2
Package manager: pnpm 11.2.2
Mechanical test command: pnpm test:ci
Server listen tests: POKEMON_ENABLE_SERVER_TESTS=1 pnpm test -- tests/metrics-server.test.ts tests/viewer-server.test.ts
```

The repository includes `.nvmrc` and `.node-version` set to `22.22.2`.
Run `nvm use` before local `pnpm` commands so the shell does not fall back to
Node 20.8.0, where pnpm 11.2.2 fails before project scripts run.

Commands executed after the controller-primary Stage 1 gap closure:

```text
pnpm typecheck
$ tsc --noEmit && pnpm web:typecheck
$ tsc -p tsconfig.web.json --noEmit
PASS
```

```text
pnpm test:ci
$ vitest run --passWithNoTests --fileParallelism=false
Test Files  41 passed | 2 skipped (43)
Tests       462 passed | 12 skipped (474)
PASS
```

```text
pnpm build
$ tsc -p tsconfig.json
PASS
```

```text
pnpm check
$ ultracite check
Checked 119 files. No fixes applied.
PASS
```

```text
POKEMON_ENABLE_SERVER_TESTS=1 pnpm test -- tests/metrics-server.test.ts tests/viewer-server.test.ts
$ vitest run --passWithNoTests -- tests/metrics-server.test.ts tests/viewer-server.test.ts
Test Files  43 passed (43)
Tests       474 passed (474)
PASS
```

Ouroboros MCP evaluate still reports Stage 1 mechanical failure in this Codex
surface because its subprocess uses the ambient Node 20.8.0 runtime instead of
the project-pinned Node 22 path. A direct `pnpm --version` under that ambient
runtime fails before scripts execute with:

```text
TypeError: Invalid host defined options
Node.js v20.8.0
```

Therefore the authoritative mechanical evidence for this working tree is the
Node 22 command output above. The MCP evaluate failure is tracked as an
environment runner mismatch, not as a source-code failure.
