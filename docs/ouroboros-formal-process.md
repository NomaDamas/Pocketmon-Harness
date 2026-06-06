# Formal Ouroboros Process Recovery

## Status

The installed `ouroboros` CLI in this environment exposes `run`, but not direct
`evaluate` or `ralph` commands. Deferred MCP tool search also returned no
callable `ouroboros_evaluate` or `ouroboros_ralph` tools.

To keep the process strict, the repo now includes thin wrappers that call the
installed official MCP handlers directly:

- `scripts/ouroboros-evaluate.py` -> `EvaluateHandler`
- `scripts/ouroboros-ralph.py` -> `RalphHandler` + `JobWaitHandler` + `JobResultHandler`

## Fixed Stage 1 Mechanical Verification

`.ouroboros/mechanical.toml` pins the formal mechanical checks:

```text
pnpm check
pnpm build
pnpm test
pnpm typecheck
```

## Commands

```bash
scripts/ouroboros-evaluate.py
scripts/ouroboros-ralph.py --max-generations 1
```

Result artifacts:

- `docs/ouroboros-formal-evaluate-result.md`
- `docs/ouroboros-formal-ralph-result.md`
