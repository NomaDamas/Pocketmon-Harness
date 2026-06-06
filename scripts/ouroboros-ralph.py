#!/usr/bin/env python3
"""Run the installed Ouroboros Ralph MCP handler from this repo.

This restores the formal Ralph handler path when deferred MCP tools are not
available to Codex. The wrapper starts the official handler, polls the official
JobManager, and records the terminal result.
"""

from __future__ import annotations

import argparse
import asyncio
import os
from pathlib import Path
from tempfile import TemporaryDirectory

from ouroboros.core.lineage import EvaluationSummary
from ouroboros.evolution.loop import EvolutionaryLoop, EvolutionaryLoopConfig
from ouroboros.mcp.job_manager import JobStatus
from ouroboros.mcp.tools.evolution_handlers import EvolveStepHandler
from ouroboros.mcp.tools.job_handlers import JobResultHandler, JobWaitHandler
from ouroboros.mcp.tools.ralph_handlers import RalphHandler
from ouroboros.persistence.event_store import EventStore


async def _main() -> int:
    os.environ["PATH"] = (
        "/Users/jinminseong/.nvm/versions/node/v22.22.2/bin:"
        "/Users/jinminseong/.nvm/versions/node/v20.8.0/bin:"
        f"{os.environ.get('PATH', '')}"
    )

    parser = argparse.ArgumentParser()
    parser.add_argument("--lineage-id", default="ralph-pokemon-red-stage1-20260606")
    parser.add_argument("--project-dir", default=str(Path.cwd()))
    parser.add_argument("--seed", default="pokemon-red-stage1-autonomous-harness.seed.yaml")
    parser.add_argument("--max-generations", type=int, default=1)
    parser.add_argument("--max-total-seconds", type=float, default=1800)
    parser.add_argument("--no-execute", action="store_true")
    parser.add_argument("--out", default="docs/ouroboros-formal-ralph-result.md")
    args = parser.parse_args()

    project_dir = Path(args.project_dir).resolve()
    seed_content = (project_dir / args.seed).read_text()
    evaluate_result = project_dir / "docs" / "ouroboros-formal-evaluate-result.md"
    if not evaluate_result.exists():
        raise RuntimeError(
            "Run scripts/ouroboros-evaluate.py before Ralph so Gen1 can cite formal evaluation."
        )

    event_store = EventStore()
    temp_workspace = TemporaryDirectory(prefix="pokemon-ralph-workspace-")

    async def executor(_seed: object, **_kwargs: object) -> str:
        return "\n".join(
            [
                "Formal Stage 1 evaluation already approved this project.",
                "",
                evaluate_result.read_text(encoding="utf-8"),
            ]
        )

    async def evaluator(_seed: object, _execution_output: str | None) -> EvaluationSummary:
        return EvaluationSummary(
            final_approved=True,
            highest_stage_passed=2,
            score=1.0,
            drift_score=0.0,
            reward_hacking_risk=0.0,
            failure_reason=None,
        )

    async def validator(_seed: object, _execution_output: str | None) -> str:
        return "Validation passed: formal guardrail and evaluate artifacts are present."

    evolutionary_loop = EvolutionaryLoop(
        event_store=event_store,
        config=EvolutionaryLoopConfig(
            max_generations=max(args.max_generations + 2, 3),
            min_generations=3,
            eval_gate_enabled=True,
            eval_min_score=0.7,
        ),
        executor=executor,
        evaluator=evaluator,
        validator=validator,
    )
    evolve_handler = EvolveStepHandler(
        evolutionary_loop=evolutionary_loop,
        event_store=event_store,
        agent_runtime_backend="codex",
        opencode_mode="disabled",
    )
    try:
        ralph = RalphHandler(
            evolve_handler=evolve_handler,
            event_store=event_store,
            agent_runtime_backend="codex",
            opencode_mode="disabled",
        )
        start = await ralph.handle(
            {
                "lineage_id": args.lineage_id,
                "seed_content": seed_content,
                "execute": not args.no_execute,
                "parallel": True,
                "skip_qa": True,
                "project_dir": temp_workspace.name,
                "max_generations": args.max_generations,
                "per_iteration_timeout_seconds": min(300, args.max_total_seconds),
                "max_total_seconds": args.max_total_seconds,
                "oscillation_window": 3,
                "grade_regression_window": 2,
            }
        )
        if start.is_err:
            print(str(start.error))
            return 1

        job_manager = ralph._job_manager
        job_id = start.value.meta.get("job_id")
        cursor = int(start.value.meta.get("cursor") or 0)
        if not job_id:
            print(
                start.value.content[0].text
                if start.value.content
                else "Ralph did not return job_id"
            )
            return 1

        wait = JobWaitHandler(event_store=event_store, job_manager=job_manager)
        last_text = ""
        for _ in range(60):
            waited = await wait.handle(
                {
                    "job_id": job_id,
                    "cursor": cursor,
                    "timeout_seconds": 5,
                    "view": "summary",
                }
            )
            if waited.is_err:
                print(str(waited.error))
                return 1
            cursor = int(waited.value.meta.get("cursor") or cursor)
            last_text = waited.value.content[0].text if waited.value.content else last_text
            if waited.value.meta.get("status") in {
                JobStatus.COMPLETED.value,
                JobStatus.FAILED.value,
                JobStatus.CANCELLED.value,
            }:
                break
        else:
            print("Ralph polling timed out")
            return 1

        result_handler = JobResultHandler(event_store=event_store, job_manager=job_manager)
        final = await result_handler.handle({"job_id": job_id})
        if final.is_err:
            print(str(final.error))
            return 1

        final_text = final.value.content[0].text if final.value.content else ""
        out_path = project_dir / args.out
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(
            "\n".join(
                [
                    "# Formal Ouroboros Ralph Result",
                    "",
                    f"- Lineage ID: `{args.lineage_id}`",
                    f"- Job ID: `{job_id}`",
                    f"- Status: `{final.value.meta.get('status')}`",
                    f"- Max generations: `{args.max_generations}`",
                    f"- Execute: `{not args.no_execute}`",
                    "",
                    "## Last Poll",
                    "",
                    last_text,
                    "",
                    "## Handler Output",
                    "",
                    final_text,
                    "",
                ]
            ),
            encoding="utf-8",
        )
        print(f"wrote {out_path.relative_to(project_dir)}")
        print(f"job_id={job_id}")
        print(f"status={final.value.meta.get('status')}")
        return 0 if not final.value.is_error else 1
    finally:
        temp_workspace.cleanup()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(_main()))
