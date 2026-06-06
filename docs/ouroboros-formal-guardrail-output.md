# Formal Guardrail Output

Environment:

```text
Node: v22.22.2
Package manager: pnpm 11.2.2
Mechanical test command: pnpm test:ci
```

Commands executed after the Stage 1 runtime Rule Memory Read integration:

```text
pnpm typecheck
$ tsc --noEmit && pnpm web:typecheck
$ tsc -p tsconfig.web.json --noEmit
PASS
```

```text
pnpm test:ci
$ vitest run --passWithNoTests --fileParallelism=false
Test Files  25 passed (25)
Tests       173 passed (173)
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
Checked 78 files. No fixes applied.
PASS
```

Formal Ouroboros Stage 1 mechanical verification also passes through
`.ouroboros/mechanical.toml`:

```text
lint true
build true
test true
static true
coverage skipped
```
