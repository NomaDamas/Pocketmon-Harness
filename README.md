<img width="1584" height="672" alt="Gemini_Generated_Image_9zanze9zanze9zan" src="https://github.com/user-attachments/assets/a045c07e-d090-4f49-bb71-19c411d41c0d" />


# 🎮 Pocketmon Harness

Pocketmon Harness is minsingjin's autonomous Pokemon Red research harness for
controller-primary gameplay, evidence-based self-improvement, and parallel
strategy exploration. It controls an already-running mGBA instance through
`mGBA-http`, reads RAM and screenshots, executes deterministic skills first,
uses the model only as a fallback analyst, and records enough trace/metric data
to compare experiments from trace evidence.

This branch is intentionally local-harness focused: Pokemon RAM reads, movement
supervision, stuck memory, milestone scoring, screenshot processing, and run
metrics all live here unless separate evidence proves a generic runtime need.

## 📚 Index

- [Mission](#-mission)
- [Seed Philosophy](#-seed-philosophy)
- [Architecture At A Glance](#-architecture-at-a-glance)
- [Full-Game Goal Hierarchy](#-full-game-goal-hierarchy)
- [Layered Memory Design](#-layered-memory-design)
- [Codebase Map](#-codebase-map)
- [Requirements](#️-requirements)
- [Live Demo Runbook](#-live-demo-runbook)
- [Runtime Loop](#-runtime-loop)
- [Self-Improvement And Parallel Runs](#-self-improvement-and-parallel-runs)
- [Methodology Coverage](#-methodology-coverage)
- [Gap Closure Contract](#-gap-closure-contract)
- [Verification](#-verification)
- [License](#-license)
- [Contributors](#-contributors)

## 🧭 Mission

Build a Pokemon Red autonomous-play harness that can eventually beat the whole
game by evidence, not by guessing. The runner should read the current game
state, select only the rules that apply now, execute a small skill/action,
evaluate the trace, and feed verified improvement hints into later runs.

```text
Rulebook memorization        ❌
Current-state rule reading   ✅

Raw button spam              ❌
Rule -> Skill -> Action      ✅

Vague reflection             ❌
Trace-backed candidate patch ✅
```

The final objective is `beat-pokemon-red`: clear the game through Victory Road,
Elite Four, Champion, and credits. The currently active deterministic runtime
slice is Stage 0/1 because those stages are where controller-primary execution,
RAM verification, stuck memory, and self-improvement gates are already wired.
Later stages are explicit roadmap targets, not vague future wishes.

## 🧬 Seed Philosophy

This repository follows minsingjin's original seed:

1. The model is not the player.
   The harness owns state, route memory, verification, budget, and promotion.
   The model is a fallback analyst when deterministic authority is insufficient.
2. Pokemon knowledge is not one huge prompt.
   Rules, maps, quests, battles, resources, skills, failures, and proposals are
   separated into machine-readable memory layers.
3. Gameplay improves from evidence.
   Runs write traces, repeated failures become candidates, candidates are scored,
   and only QA-gated promotions can update active hierarchy.
4. Parallel runs are hypothesis experiments.
   Multiple emulator endpoints test different strategies, share tactical
   subgoal evidence, and produce promotion proposals instead of silently
   rewriting the rulebook.
5. Full-game completion is staged, not hand-waved.
   Stage 1 proves the controller-primary loop; later stages expand the same
   memory/controller/evaluator pattern until Champion completion.

## 🧱 Architecture At A Glance

```text
┌──────────────────────┐
│ mGBA + Pokemon Red   │
└──────────┬───────────┘
           │ screenshots + RAM
┌──────────▼───────────┐
│ Observation Parser   │
│ vision + RAM state   │
└──────────┬───────────┘
           │ mode, map, x/y, battle, recent actions
┌──────────▼───────────┐
│ Rule Memory Read     │
│ active Stage 1 rules │
└──────────┬───────────┘
           │ recommended skill/action
┌──────────▼───────────┐
│ Skill Executor       │
│ route, dialogue,     │
│ recovery, battle     │
└──────────┬───────────┘
           │ supervised button action
┌──────────▼───────────┐
│ Evaluator + Trace    │
│ progress, loops,     │
│ stuck, token usage   │
└──────────┬───────────┘
           │ evidence
┌──────────▼───────────┐
│ Self-Improvement     │
│ candidate + hints    │
└──────────────────────┘
```

🧠 The harness is not a single LLM pressing buttons forever. The LLM is a
planner/fallback inside a stricter local loop. RAM, screenshots, rules,
supervised controls, trace scoring, and candidate gates are first-class runtime
objects.

## 🏁 Full-Game Goal Hierarchy

The project goal is bigger than Viridian City. Viridian is the first active
proof slice, not the end state.

| Stage | Status | Goal | Completion signal |
| --- | --- | --- | --- |
| 🎛️ Stage 0 | Active | Boot, intro, name/control recovery | Player can issue overworld inputs |
| 🧭 Stage 1 | Active | Pallet Town -> Route 1 -> Viridian City | RAM reports Viridian City |
| 📦 Stage 2 | Planned | Oak's Parcel and Pokedex | Pokedex obtained after delivery |
| 🪨 Stage 3 | Planned | Viridian Forest and Brock | Boulder Badge obtained |
| 🗺️ Stage 4 | Planned | Badges, HMs, dungeons, resources | Eight badges and required HM gates cleared |
| 🏆 Stage 5 | Planned | Victory Road, Elite Four, Champion | Champion defeated and credits reachable |

`src/pokemon-red-full-game-plan.ts` keeps this hierarchy in code so tests can
guard against accidentally shrinking the objective back to Stage 1 only.

## 🧠 Layered Memory Design

The memory system is intentionally layered so the model reads only what is
needed for the current phase.

| Layer | Authority | Purpose |
| --- | --- | --- |
| 🎮 Control Memory | Runtime | Safe button tools, movement normalization, settle frames, reset boundary |
| 🧭 Mode / Phase Memory | Runtime | Title, name, overworld, dialogue, battle, menu, unknown classification |
| 🗺️ World / Route Memory | Runtime | Map ids, x/y waypoints, transitions, blocked edges, pathfinder authority |
| 📖 Rule Memory | Runtime | Machine-readable rules selected by current state |
| 🛠️ Skill Library | Runtime | Rule/waypoint to executable skill/action mapping |
| 🔁 Trace / Failure Memory | Runtime | No-progress states, repeated failed actions, stuck edges, verification failures |
| 🌳 Shared Strategy Memory | Runtime | Peer-proven subgoal actions shared within a parallel batch |
| 🌲 Strategy Tree Memory | Proposal | Global -> stage -> hypothesis -> run-attempt hierarchy with pruning/backtracking status |
| 🧪 Candidate / Promotion Memory | Proposal | QA-gated rule/skill/pathfinder patch proposals |
| 📚 Manual / Roadmap Memory | Reference | Full-game roadmap, guide structure, and staged expansion boundaries |

This is the core seed philosophy: the model does not memorize Pokemon Red. The
harness owns structured memory and lets the model act only as a fallback analyst
when deterministic controller authority is insufficient.

## 🧩 Codebase Map

The README is intentionally tied to code paths so architecture claims can be
checked quickly.

| Responsibility | Primary files |
| --- | --- |
| 🎯 Full-game roadmap | `src/pokemon-red-full-game-plan.ts`, `tests/pokemon-red-full-game-plan.test.ts` |
| 🧠 Runtime authority loop | `src/index.ts`, `src/deterministic-policy.ts`, `src/runner.ts` |
| 👀 Observation and RAM state | `src/observation.ts`, `src/pokemon-state.ts`, `src/screenshot-image.ts` |
| 🧭 Phase and route planning | `src/phase-detector.ts`, `src/stage1-pathfinder.ts`, `src/stage1-fast-autopilot.ts` |
| 📖 Rule/skill/manual memory | `src/stage1-memory.ts`, `src/stage1-active-rules.ts`, `src/stage1-active-skills.ts`, `src/stage1-active-route-knowledge.ts` |
| ✅ Verification and stop control | `src/observation-bookkeeping.ts`, `src/stuck-memory.ts`, `src/stop-controller.ts`, `src/run-metrics.ts`, `src/token-usage.ts` |
| 🧪 Self-improvement | `src/self-improvement.ts`, `src/self-improvement-watch.ts`, `src/improvement-hints.ts`, `src/strategy-book.ts` |
| 🧵 Parallel evidence | `src/parallel-runner.ts`, `src/parallel-improvement.ts`, `src/parallel-promote.ts`, `src/shared-strategy.ts`, `src/strategy-tree.ts` |
| 📊 Observability | `src/tui.ts`, `src/tui-summary.ts`, `src/viewer-server.ts`, `src/viewer-events.ts`, `src/metrics-server.ts` |
| 🐍 Formal process evidence | `docs/ouroboros-formal-process.md`, `docs/ouroboros-formal-evaluate-result.md`, `docs/ouroboros-formal-ralph-result.md` |

## ⚙️ Requirements

- Node.js 22.22.2 or newer. The repository includes `.nvmrc` and
  `.node-version`; run `nvm use` before `pnpm` commands so local shells and
  automation do not fall back to Node 20.
- pnpm 11.2.2
- mGBA with the `mGBASocketServer.lua` script
- `mGBA-http`
- A legally obtained Game Boy ROM already loaded in mGBA

Install dependencies:

```bash
pnpm install
```

Copy `.env.example` to `.env` and configure the local emulator and model:

```bash
MGBA_HTTP_BASE_URL=http://127.0.0.1:5100
POKEMON_ROM_PATH=
AI_PROVIDER=openai-compatible
AI_BASE_URL=
AI_API_KEY=
AI_MODEL=
AI_MICRO_MODEL=gpt-5.3-codex-spark
HARNESS_MAX_STEPS=120
HARNESS_MAX_MINUTES=10
HARNESS_STARTER_PREFERENCE=charmander
METRICS_HTTP_HOST=0.0.0.0
METRICS_HTTP_PORT=9464
```

`AI_PROVIDER` supports model preset switching without code changes:

- `openai-compatible`: defaults `AI_MODEL` to `gpt-5.5` and `AI_MICRO_MODEL` to `gpt-5.3-codex-spark`
- `grok`: defaults `AI_MODEL` to `grok-4.3` and `AI_MICRO_MODEL` to `grok-3-mini-fast`

Always set `AI_BASE_URL` and `AI_API_KEY` in local `.env`; provider endpoint
URLs and keys are intentionally not committed. For Grok model experiments, keep
`AI_PROVIDER=grok` and switch `AI_MODEL` between compatible model ids such as
`grok-4.3`, `grok-4.20-0309-reasoning`,
`grok-4.20-0309-non-reasoning`, `grok-4.20-multi-agent-0309`,
`grok-3-mini`, or `grok-3-mini-fast`.

Use `AI_MICRO_MODEL` for the fast per-action controller. Keep macro planning on
the stronger `AI_MODEL`, but run micro button decisions on a low-latency model
such as `gpt-5.3-codex-spark` or `grok-3-mini-fast`.

Start mGBA and `mGBA-http` separately, then run the harness:

```bash
mkdir -p .pss-mgba/saves
/Applications/mGBA.app/Contents/MacOS/mGBA \
  -C savegamePath=/Users/jinminseong/Desktop/pocketmon-harness/.pss-mgba/saves \
  /absolute/path/to/legal/rom.gb
POKEMON_PARALLEL_MGBA_PORTS=5100 scripts/start-mgba-http-parallel.sh
pnpm dev
```

If your mGBA build does not support a CLI `--script` flag, open
`Tools > Scripting...` inside mGBA and run:

```lua
dofile("/Users/jinminseong/Desktop/pocketmon-harness/.local-tools/mgba-http/mGBASocketServer.lua")
```

The writable `savegamePath` avoids mGBA's `Failed to open save file` warning
when the ROM is outside a writable experiment directory.

## 🚀 Live Demo Runbook

Use this sequence when demonstrating the current harness locally with one visible
GUI emulator. Long-running commands should be started in separate terminals.
Port `5100` avoids macOS services that commonly occupy or intercept port `5000`:

```bash
# Terminal 1: emulator
mkdir -p .pss-mgba/saves

/Applications/mGBA.app/Contents/MacOS/mGBA \
  -C savegamePath=/Users/jinminseong/Desktop/pocketmon-harness/.pss-mgba/saves \
  /Users/jinminseong/Downloads/Pokemon\ -\ Red\ Version.gb

# Terminal 2: mGBA HTTP bridge
POKEMON_PARALLEL_MGBA_PORTS=5100 scripts/start-mgba-http-parallel.sh

# Terminal 3: web dashboard
pnpm viewer

# Terminal 4: terminal observer
pnpm tui

# Terminal 5: Grok gameplay runner
AI_PROVIDER=grok \
AI_MODEL=grok-4.3 \
AI_MICRO_MODEL=grok-3-mini-fast \
MGBA_HTTP_BASE_URL=http://127.0.0.1:5100 \
HARNESS_MAX_STEPS=120 \
HARNESS_MAX_MINUTES=10 \
pnpm dev
```

🔐 Keep `AI_BASE_URL` and `AI_API_KEY` in `.env`. Do not paste secrets into
README, logs, traces, screenshots, or commits.

Reset the current emulator before a clean attempt:

```bash
curl -i -X POST http://127.0.0.1:5100/coreadapter/reset
```

Run the deterministic Stage 1 autopilot when you want a fast non-LLM baseline:

```bash
MGBA_HTTP_BASE_URL=http://127.0.0.1:5100 pnpm stage1:fast
```

The visible GUI harness expects one connected emulator server. For multiple
visible GUI windows, each mGBA window must load the Lua socket script and bind a
separate socket such as `8888`, `8889`, and `8890`; each socket then needs its own
`mGBA-http` bridge such as `5100`, `5101`, and `5102`. Do not point multiple
harness processes at the same emulator.

Check all live prerequisites before a run:

```bash
pnpm readiness
```

This probes local model config, ROM path, mGBA HTTP reachability, trace
observer state, dashboard availability, self-improvement status, Ralph status,
and parallel-run configuration without printing secrets.

## 🔁 Runtime Loop

`src/index.ts` creates a persistent `pokemon-run` session, but the LLM is no
longer the default player. The current authority order is:

1. Capture mGBA status, screenshot, and Pokemon Red RAM state when available.
2. Detect the phase from map id, coordinates, battle/menu/dialogue signals, and
   recent action evidence.
3. Check shared strategy memory for peer-proven subgoal actions in the same
   batch.
4. Run deterministic Stage 1 policy/pathfinder when the phase and map are known.
5. Execute the supervised button action and verify whether state changed as
   expected.
6. Call the LLM only when the controller reports unknown phase, unsupported UI,
   repeated verification failure, missing RAM, or route graph escape.
7. Stream runtime events into pretty logs, token traces, behavior metrics,
   shared strategy records, and Prometheus output.

The model prompt is fallback-analyst oriented, not player-authority oriented:
the harness owns route memory, deterministic execution, and verification.

Stop and budget controls are environment variables:

```bash
HARNESS_MAX_STEPS=50
HARNESS_MAX_TURNS=50
HARNESS_MAX_TOKENS=200000
HARNESS_MAX_MINUTES=5
HARNESS_MAX_RAM_UNAVAILABLE_TURNS=1
```

`HARNESS_STARTER_PREFERENCE` controls the deterministic Oak Lab starter target.
Allowed values are `bulbasaur`, `charmander`, and `squirtle`; unset runs keep
the deterministic default `charmander`.

When a limit is reached, the run exits gracefully and records the stop reason in
trace metadata.

## 🎛️ Control Plane

The model can use these tools:

- `mgba_tap`
- `mgba_tap_many`
- `mgba_hold`
- `mgba_hold_many`
- `mgba_release`

ROM loading and reset tools are intentionally not exposed. The underlying client
still has helpers for mGBA endpoints, but model-facing tools must not reset,
reload, or restart game progress.

The local supervisor wraps control calls before they reach mGBA. It normalizes
directional movement to one tile, normalizes non-directional taps, rejects unsafe
directional multi-holds, waits for post-action settle frames, and polls through
short black/loading frames before the next observation.

## 👀 Observation And Progress Signals

The harness combines visual and state signals:

- `src/screenshot-image.ts` decodes PNG screenshots, crops mGBA Game Boy frames,
  draws the movement grid, and detects black/loading frames.
- `src/pokemon-state.ts` reads compact Pokemon Red RAM fields such as map,
  position, facing direction, and battle state. If RAM reads fail, the run falls
  back to visual-only observation.
- `src/stuck-memory.ts` records repeated failed movement edges and recent
  recovery attempts so the prompt can avoid blind repetition.
- `src/pokemon-milestones.ts` scores coarse progress milestones such as player
  control reached, first map transition, and battle detected/completed.

The current RAM map is Pokemon Red oriented. Do not interpret those state fields
as authoritative for another ROM unless separate validation proves they match.

## 📈 Metrics And Traces

Each run creates a trace directory under `.pss-mgba/traces/runs/<run-id>/` and
appends an iteration record to `.pss-mgba/traces/iterations.jsonl`.

Important outputs:

- `run.json`: run metadata, mode, experiment id, milestone, stuck count, and
  supervisor count.
- `events.jsonl`: structured viewer event log with observation screenshots and
  status, `action_plan` summaries, action tool calls and results, and supervisor
  interventions.
- `token-usage.jsonl`: per-step and per-turn token usage.
- Prometheus endpoint: `http://127.0.0.1:9464/metrics` by default.
- `pnpm trace:report`: local comparison report across recorded iterations.

Behavior metrics include action entropy, A-button ratio, same-action streaks,
visual novelty, observe-before-act ratio, tool error rate, turn/step/tool
durations, stuck events, and supervisor interventions. Token savings only count
as improvement when progress, stuck behavior, action diversity, and tool
reliability do not regress.

## 🖥️ Trace Viewer

New runs write `events.jsonl` automatically. Build the React viewer with
`pnpm web:build`, then serve the built viewer and local API with `pnpm viewer`.
The default viewer URL is `http://127.0.0.1:9474`.

During UI development, run `pnpm viewer` for the local API and `pnpm web:dev`
for Vite. Vite proxies `/api` requests to the viewer server. Older runs without
`events.jsonl` still show metadata and token metrics, but they do not have
screenshots or an action timeline. No deployment or API keys are required, and
the server is local-only by default.

## 🧾 Terminal Observer

Use the read-only terminal dashboard while a run is active:

```bash
pnpm tui
```

For a single snapshot:

```bash
pnpm tui -- --once
```

The TUI reads the latest trace under `.pss-mgba/traces/runs/` and shows macro
progress phase, health, confidence, gaps, run id, milestone, model, action
count, supervisor interventions, token usage, and the latest action/reasoning
without touching mGBA or the model process. See
`pokemon-red-macro-progress-observer.seed.yaml` for the macro progress model and
`docs/ouroboros-ralph-readiness.md` for the Ouroboros/Ralph completion and gap
audit.

## 🧬 Self-Improvement And Parallel Runs

🧠 The harness follows the project architecture from the seed:

```text
Observation(RAM + screenshot)
  -> Mode / progress inference
  -> Rule Memory Read
  -> Skill / pathfinder selection
  -> supervised mGBA action
  -> evaluator / trace evidence
  -> self-improvement candidate
  -> next-run improvement hint
```

🎮 Runtime policy:

- Micro gameplay actions run on the low-latency `AI_MICRO_MODEL`.
- For Grok runs, use `AI_PROVIDER=grok`, `AI_MODEL=grok-4.3`, and
  `AI_MICRO_MODEL=grok-3-mini-fast`.
- Codex is not required for live gameplay decisions; it is only used for code
  edits and local orchestration in this workspace.
- The model never receives reset/reload tools. Emulator lifecycle remains
  outside the model-facing control plane.

🧭 Active controller slice:

- Stage 1 is the first active proof route toward the full `beat-pokemon-red`
  objective.
- RAM state is used for `mapId`, player coordinates, facing, and battle state.
- Screenshots remain attached so the model can recover when RAM mode detection
  is ambiguous.
- Dijkstra/backtracking route planning is used for the Pallet Town / Route 1
  path, and repeated failed edges are blocked after 3 attempts.
- The next expansion target is Stage 2: Oak's Parcel, Pokedex receipt, and
  verified return-route execution.

Generate a QA-gated improvement candidate from the latest trace:

```bash
pnpm improve:trace
```

The command reads `events.jsonl`, evaluates repeated-action and no-progress
state evidence, suppresses progressing dialogue, and writes
`.pss-mgba/improvements/<run-id>.candidate.json` only when evidence supports a
candidate. It does not silently promote candidates into active rules.

🔁 Run the self-improvement watcher beside a live Grok run:

```bash
SELF_IMPROVEMENT_WATCH_INTERVAL_MS=15000 pnpm improve:watch
```

The watcher repeatedly evaluates the latest trace and writes candidate evidence
when the run stalls. New candidates are injected into later observations as
self-improvement hints, so the next Grok action loop can adapt without exposing
API secrets.

🌳 Shared strategy memory for parallel runs:

- Each parallel batch writes peer-visible subgoal evidence to
  `.pss-mgba/shared-strategy/<batch-id>.jsonl`.
- When one harness reaches a useful RAM state transition such as moving from the
  bedroom toward the stair waypoint, sibling harnesses in the same batch can
  reuse that state/action hint before calling the LLM.
- This is fast tactical sharing, not unrestricted self-modifying code. Active
  rules, skills, and pathfinder knowledge still move through
  `improve:parallel` proposal files and explicit QA-gated promotion.

📚 Strategy hierarchy update flow:

```text
parallel live runs
  -> trace collection
  -> hypothesis scoring
  -> successful transition / anti-pattern extraction
  -> candidate rule / skill / pathfinder proposal
  -> conflict and evidence gate
  -> explicit promote command
  -> active hierarchy used by the next run
```

This means a sibling harness can immediately imitate a proven subgoal action
through shared strategy memory, but durable guidebook updates still require
proposal and promotion. That boundary prevents reward hacking where a bad run
rewrites the guidebook just because it generated a confident explanation.

🌲 Guidebook tree model:

```text
Pokemon Red Global Guidebook
  -> Stage Guidebook
    -> Hypothesis Branch
      -> Run Attempt
```

Each parallel agent instance is treated as a run attempt inside a hypothesis
branch. The batch evaluator scores branches by milestone progress, map
transitions, verification success, stuck events, fallback rate, and token use.
Promising branches remain proposal candidates; branches with repeated stuck
events, verification failures, no progress, or poor score gaps are marked
`pruned`. This is the backtracking mechanism: bad methods are not deleted from
evidence, but they are cut off from promotion unless later runs produce stronger
proof.

`pnpm improve:parallel -- --batch <batch-id>` writes:

- `.pss-mgba/candidates/<batch-id>/strategy-tree.json`
- `.pss-mgba/candidates/<batch-id>/proposal.json`
- `.pss-mgba/candidates/<batch-id>/rules.json`
- `.pss-mgba/candidates/<batch-id>/skills.json`
- `.pss-mgba/candidates/<batch-id>/pathfinder-patches.json`

📊 Watch progress while the loop runs:

```bash
pnpm viewer
pnpm tui
```

- Web dashboard: `http://127.0.0.1:9474`
- TUI: macro phase, health, confidence, gaps, latest action, model id, token
  usage, and supervisor interventions.
- Trace files: `.pss-mgba/traces/runs/<run-id>/events.jsonl`

Run multiple live harness instances when multiple independent emulator endpoints
are already running. For classic visible GUI `mGBA-http`, use independent ports:

```bash
scripts/start-mgba-http-parallel.sh
POKEMON_PARALLEL_MGBA_PORTS=5100,5101,5102 pnpm parallel:run
```

That starts or targets bridges only; each bridge still needs a separate mGBA GUI
window with the Lua socket script loaded on a matching socket. If you want the
parallel boards visible without manually wiring several GUI windows, use
`mgba-server` sessions and watch them in the web viewer.

For `mgba-server` session URLs, keep the generated session principals in a
local env file and do not print them:

```bash
set -a
. .pss-mgba/mgba-server/parallel-endpoints.env
set +a
AI_PROVIDER=grok HARNESS_MAX_STEPS=50 HARNESS_MAX_RAM_UNAVAILABLE_TURNS=1 pnpm parallel:run
pnpm improve:parallel -- --batch <batch-id>
```

Each instance receives a separate `MGBA_HTTP_BASE_URL`, optional
`MGBA_HTTP_AUTH_TOKEN`, `PARALLEL_BATCH_ID`, metrics port, and hypothesis label.
This is real process orchestration, not replay simulation; every listed port or
session URL must point to an independent emulator/session.

For controller-primary gameplay, a parallel endpoint must expose both:

- `/core/currentframe` so the process can prove the emulator/session is alive.
- Pokemon Red RAM reads through `/core/read8` or memory-domain fallback so the
  controller can trust `mapId/x/y`.

`pnpm parallel:run` enforces this by default. A frame-only endpoint is skipped
before child harnesses are spawned because it would otherwise look visually
alive while the deterministic controller has no state authority. Only set
`POKEMON_PARALLEL_REQUIRE_RAM=0` for screenshot-only exploratory experiments;
do not use it for serious controller-primary runs.

If a headless/session endpoint cannot expose system RAM, the controller cannot
trust `mapId/x/y` and should not spend tokens wandering. With the RAM preflight
enabled, that endpoint is skipped. If RAM disappears after a run starts, keep
`HARNESS_MAX_RAM_UNAVAILABLE_TURNS=1` so the batch records
`stopReason=ram-unavailable-turns:1`, writes evidence candidates, and exits
cleanly instead of handing long-horizon play back to the LLM.

Latest local boundary evidence:

- Batch `batch-8a021bbb-72fb-4b9c-9957-246ef3171385` produced runs
  `00083`, `00084`, and `00085` from visible `mgba-server` session URLs.
- The web viewer lists all three under `http://127.0.0.1:9474`.
- `improve:parallel` pruned every branch because the endpoints did not expose
  Pokemon RAM to the controller: no progress milestone, no map transition, and
  `stopReason=ram-unavailable-turns:1`.
- This is the intended safety behavior: visible emulator/session is not enough;
  the active harness must have RAM authority before claiming autonomous play.

⚠️ Current parallel evidence boundary:

- `parallel:run` is an evidence generator: it creates live traces for multiple
  hypotheses.
- `improve:parallel` scores a batch and writes proposals under
  `.pss-mgba/candidates/<batch-id>/`.
- `improve:promote` is intentionally explicit and QA-gated; active
  rules/skills/pathfinder files are not silently self-mutated.
- A proposal can be blocked even after successful runs when evidence is too weak
  to promote, for example no map transition or progress milestone.

## ✅ Methodology Coverage

| User-planned method | Current implementation |
| --- | --- |
| 🎮 Pokemon Red full-game goal | `src/pokemon-red-full-game-plan.ts` defines the `beat-pokemon-red` hierarchy through Champion; active runtime is Stage 0/1. |
| 📖 Rule Memory / Game Manual / Skill Library | `src/stage1-memory.ts`, active rules, active skills, route knowledge, and runtime Rule Memory Read injection. |
| 🧠 Rule -> Skill -> Action loop | Each observation includes recommended rules, skill, and action before model fallback. |
| 👀 RAM + vision observation | RAM parser reads map/x/y/facing/battle; screenshot pipeline crops and overlays movement grid. |
| 🔁 3+ repeated loop evidence | Self-improvement evaluator detects repeated action and no-progress state loops before emitting candidates. |
| 🧪 Evaluator before promotion | `pnpm improve:trace` writes candidate JSON only; it does not auto-mutate active rules. |
| 🧭 Dijkstra/backtracking | Stage 1 pathfinder plans Pallet Town / Route 1 route and blocks failed edges. |
| ⚡ Fast micro actions | `AI_MICRO_MODEL` separates fast controller model from stronger macro model. |
| 🤖 Grok gameplay mode | `AI_PROVIDER=grok` switches defaults to `grok-4.3` / `grok-3-mini-fast`. |
| 📊 Observer dashboard | Web viewer, TUI, Prometheus, and optional Grafana show trace, macro progress, and health. |
| 🧵 Parallel hypotheses | `parallel:run` launches multiple harness processes against independent mGBA HTTP ports or authenticated `mgba-server` session URLs. |
| 🌳 Evidence hierarchy proposal | `improve:parallel` turns parallel traces into QA-gated rule/skill/pathfinder proposals under `.pss-mgba/candidates/<batch-id>/`. |
| 🧑 Human intervention | The model cannot reset/reload ROM; humans can reset or stop/restart processes externally. |
| 🐍 Ouroboros/Ralph process | Formal local evaluate/Ralph artifacts are documented in `docs/`; live Ralph MCP is gated on missing MCP tools. |

## 🚧 Gap Closure Contract

The project does not hide gaps or claim fake completion. A gap is acceptable
only when it is attached to a closure path, evidence source, and promotion gate.

| Gap | Current boundary | Closure path |
| --- | --- | --- |
| 🕹️ Visible parallel gameplay | Requires independent emulator endpoints: separate mGBA + Lua socket + `mGBA-http`, or independent `mgba-server` sessions | Start one harness per RAM-capable endpoint with `parallel:run`, then score the batch with `improve:parallel` |
| 🧠 RAM-capable parallel endpoints | Frame-only sessions can look alive but cannot support controller-primary route memory | `parallel:run` now skips endpoints that pass `/core/currentframe` but fail Pokemon RAM read preflight unless `POKEMON_PARALLEL_REQUIRE_RAM=0` is explicitly set |
| 🧪 Automatic rulebook mutation | Active rules/skills/pathfinder are not silently rewritten | Generate proposals, run QA/tests/replay, then explicitly promote with `improve:promote` |
| 🗺️ Full world graph | Runtime controller authority is active for Stage 0/1, with full-game stages represented in code | Promote Stage 2-5 map/quest/route memory incrementally from trace evidence |
| 🥊 Deep battle strategy | Current battle policy is basic and safe | Add Gen 1 type chart, PP/status/item/team policy as battle memory and evaluator-tested skills |
| 📦 Oak/Pokedex onward | Stage 2 is planned, not claimed as solved runtime | Add Viridian Mart, return route, Oak Lab, and Pokedex waypoints with RAM verification |
| 🐍 Ralph MCP live loop | Formal docs exist, but live MCP Ralph depends on session tool availability | Run local evaluate artifacts now; start MCP Ralph only when `ouroboros_ralph` is exposed |

Nothing moves from `planned` to `active` because it sounds plausible. It must
produce trace evidence, pass tests, avoid regressions, and keep controller
authority ahead of LLM fallback.

### Gap-To-Test Traceability

The current controller-primary closure work is locked by tests instead of README
claims. This matrix is the handoff contract for future work:

| Gap being closed | Runtime implementation | Guardrail tests |
| --- | --- | --- |
| LLM still acting like a one-button player | `src/index.ts`, `src/fallback-gate.ts`, and `src/deterministic-policy.ts` route known phases through controller decisions first, then admit bounded fallback only after controller verification fails | `tests/fallback-gate.test.ts`, `tests/deterministic-policy.test.ts`, `tests/runner.test.ts` |
| RAM state not treated as controller authority | `src/pokemon-state.ts`, `src/phase-detector.ts`, and `src/deterministic-verification.ts` make map/x/y/battle/dialogue state part of phase, outcome, and failure decisions | `tests/phase-detector.test.ts`, `tests/deterministic-verification.test.ts`, `tests/observation.test.ts` |
| Weak expected-outcome verification | `src/deterministic-verification.ts` verifies movement, dialogue/script progress, Oak checkpoints, starter sequence, and battle transition evidence before accepting progress | `tests/deterministic-verification.test.ts`, `tests/starter-preference.test.ts`, `tests/battle-policy.test.ts` |
| Repeated fallback or loop without terminal evidence | `src/fallback-gate.ts`, `src/controller-primary-failure-report.ts`, `src/run-metrics.ts`, and `src/stop-controller.ts` cap fallback attempts and emit structured terminal failure reports | `tests/fallback-gate.test.ts`, `tests/controller-primary-failure-report.test.ts`, `tests/run-metrics.test.ts`, `tests/stop-controller.test.ts` |
| Parallel agents not sharing useful subgoal evidence | `src/shared-strategy.ts` and `src/parallel-improvement.ts` keep batch-scoped tactical evidence separate from active rule promotion | `tests/shared-strategy.test.ts`, `tests/parallel-improvement.test.ts`, `tests/parallel-runner.test.ts` |
| Guidebook hierarchy lacking pruning/backtracking | `src/strategy-tree.ts` records hypothesis/run-attempt branches and prunes weak branches before proposal promotion | `tests/strategy-tree.test.ts`, `tests/parallel-improvement.test.ts` |
| Promotion safety boundary unclear | `src/parallel-promote.ts` keeps active rule/skill/pathfinder writes behind explicit promotion and QA gates | `tests/parallel-improvement.test.ts`, `tests/stage1-gameplay-schema.test.ts` |
| Metrics not proving controller-primary behavior | `src/run-metrics.ts`, `src/run-summary.ts`, `src/run-trace.ts`, and `src/token-usage.ts` record deterministic action counts, fallback calls, verification failures, token ratios, and stop reasons | `tests/run-metrics.test.ts`, `tests/run-summary.test.ts`, `tests/run-trace.test.ts`, `tests/token-usage.test.ts` |
| Viewer/TUI not showing the controller state clearly | `src/viewer-events.ts`, `src/viewer-recorder.ts`, `src/viewer-server.ts`, and `web/src/app.tsx` expose controller decisions, fallback, verification, and run health from local traces | `tests/viewer-events.test.ts`, `tests/viewer-server.test.ts`, `pnpm web:typecheck` |

The remaining high-priority runtime gap is not architecture anymore; it is
coverage. Stage 2+ needs more RAM-verified waypoints, quest memory, item/battle
policy, and replay evidence before it can be marked active.

## 📊 Grafana

Start the local observability stack:

```bash
docker compose -f docker-compose.grafana.yml up -d
```

Then run the harness normally:

```bash
pnpm dev
```

Prometheus scrapes the harness through `host.docker.internal:9464`, and Grafana
provisions the `pss-mgba Run Iterations` dashboard at
`http://127.0.0.1:3000`. Keep the stack running during experiments so each new
`run_id` and iteration remains visible as a separate time series.

## ✅ Verification

Run the full guardrail before accepting changes or experiment evidence:

```bash
pnpm typecheck && pnpm test && pnpm build && pnpm check
```

This project targets Node `>=22`. Server listen tests are opt-in because some
sandboxed runners reject `127.0.0.1` binds with `EPERM`; run them explicitly in a
normal local environment:

```bash
POKEMON_ENABLE_SERVER_TESTS=1 pnpm test -- tests/metrics-server.test.ts tests/viewer-server.test.ts
```

Useful focused commands while iterating:

```bash
pnpm test -- tests/mgba-http.test.ts tests/runner.test.ts tests/observation.test.ts
pnpm test -- tests/screenshot-image.test.ts tests/run-metrics.test.ts tests/metrics-server.test.ts
pnpm test -- tests/viewer-events.test.ts tests/viewer-server.test.ts
pnpm web:typecheck
pnpm web:build
pnpm trace:report
```

Connectivity probe before a live run:

```bash
python3 - <<'PY'
import urllib.request
for path in ['/core/currentframe','/core/getgamecode','/core/getgametitle','/mgba-http/button/getall']:
    with urllib.request.urlopen('http://127.0.0.1:5100'+path, timeout=2) as response:
        print(path, response.status, response.read(200).decode('utf-8','replace'))
PY
```

Five-minute experiment window:

```bash
MGBA_HTTP_BASE_URL=http://127.0.0.1:5100 pnpm dev > .omo/evidence/<task>-pnpm-dev.log 2>&1 & PID=$!; sleep 300; kill -INT $PID; wait $PID || true
```

Valid run modes are `fresh`, `resumed`, `recovery`, `deterministic-replay`, and
`exploratory`. Use `fresh` only for a normal run from the current live emulator
state. Recovery and deterministic replay metrics must not be mixed with fresh
progress metrics.

## ⚠️ Evidence Caveats

Keep evidence tied to run id and ROM identity.

- Baseline Task 1 run `00058-2026-05-24T06-19-02-489Z` used Pokemon Red identity
  `DMG-AR` / `PKMN RED ST`, with 29 summarized turns, `1,189,899` total tokens,
  and `41,031.0` average tokens per turn.
- Combined Task 8 run `00064-2026-05-24T07-51-35-549Z` was metadata-valid with
  `mode=fresh`, `experimentId=combined-optimized`, 20 summarized turns,
  `607,453` total tokens, `30,372.7` average tokens per turn, `stuckEvents=0`,
  `supervisorInterventions=24`, and milestone `player-control-reached`.
- Do not claim this proves a clean Pokemon Red gameplay improvement: Task 8 used
  Pokemon Gold identity `DMG-AAUE` / `POKEMON_GLD`, not the baseline Pokemon Red
  identity.

Reject or roll back an improvement when token usage improves but progress,
stuck behavior, action entropy, tool reliability, or ROM identity gets worse.

## 📄 License

This project uses a custom source-available attribution license:

- Free use, modification, and redistribution are allowed.
- Commercial use is allowed only with visible attribution to Pocketmon Harness
  by minsingjin.
- The license covers this project's original code and documentation only. It
  does not grant rights to Pokemon ROMs, game assets, Nintendo, Game Freak,
  Creatures, The Pokemon Company IP, or third-party dependencies.

See [LICENSE](LICENSE) for the full terms.

## 👤 Contributors

<table>
  <tr>
    <td align="center">
      <a href="https://github.com/minsing-jin">
        <img src="https://avatars.githubusercontent.com/minsing-jin?s=120" width="96" height="96" alt="minsingjin" />
        <br />
        <sub><b>minsingjin</b></sub>
      </a>
      <br />
      <sub>Project owner and maintainer</sub>
    </td>
    <td align="center">
      <a href="https://github.com/minpeter">
        <img src="https://avatars.githubusercontent.com/minpeter?s=120" width="96" height="96" alt="Woonggi Min / 민웅기" />
        <br />
        <sub><b>Woonggi Min / 민웅기</b></sub>
      </a>
      <br />
      <sub>Baseline harness contributor</sub>
    </td>
  </tr>
</table>

The GitHub home for this project is
`https://github.com/NomaDamas/Pocketmon-Harness`.
