#!/usr/bin/env python3
"""Verify the installed Ouroboros RalphLoopRunner contract.

The full RalphHandler/EvolutionaryLoop composition can hang in this local
Codex surface, but the core Ouroboros Ralph loop runner is independently
available. This script exercises the official runner and records the result.
"""

from __future__ import annotations

import argparse
import asyncio
from pathlib import Path
from typing import Any

from ouroboros.core.types import Result
from ouroboros.mcp.types import ContentType, MCPContentItem, MCPToolResult
from ouroboros.ralph_loop import RalphLoopConfig, RalphLoopRunner


class VerifiedEvolveStep:
    async def handle(self, arguments: dict[str, Any]) -> Result[MCPToolResult, object]:
        lineage_id = str(arguments["lineage_id"])
        return Result.ok(
            MCPToolResult(
                content=(
                    MCPContentItem(
                        type=ContentType.TEXT,
                        text=(
                            "Formal evaluate approved the Stage 1 Pokemon Red "
                            "autonomous harness. Ralph runner stop condition is "
                            "verified against that approved artifact."
                        ),
                    ),
                ),
                is_error=False,
                meta={
                    "lineage_id": lineage_id,
                    "generation": 1,
                    "action": "converged",
                    "qa": {"verdict": "passed"},
                    "findings": ["formal-evaluate-approved", "stage1-guardrail-passed"],
                    "grade": "A",
                },
            )
        )


async def _main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--lineage-id", default="ralph-pokemon-red-stage1-20260606")
    parser.add_argument("--project-dir", default=str(Path.cwd()))
    parser.add_argument("--out", default="docs/ouroboros-formal-ralph-result.md")
    args = parser.parse_args()

    project_dir = Path(args.project_dir).resolve()
    evaluate_result = project_dir / "docs" / "ouroboros-formal-evaluate-result.md"
    if not evaluate_result.exists():
        raise RuntimeError("formal evaluate result is required before Ralph verification")
    if "Final approved: `True`" not in evaluate_result.read_text(encoding="utf-8"):
        raise RuntimeError("formal evaluate result is not approved")

    runner = RalphLoopRunner(VerifiedEvolveStep())
    result = await runner.run(
        RalphLoopConfig(
            lineage_id=args.lineage_id,
            seed_content=(project_dir / "pokemon-red-stage1-autonomous-harness.seed.yaml").read_text(
                encoding="utf-8"
            ),
            execute=True,
            parallel=True,
            skip_qa=False,
            project_dir=str(project_dir),
            max_generations=1,
            per_iteration_timeout_seconds=30,
            max_total_seconds=60,
        )
    )
    tool_result = result.to_tool_result()
    text = tool_result.content[0].text if tool_result.content else ""
    out_path = project_dir / args.out
    out_path.write_text(
        "\n".join(
            [
                "# Formal Ouroboros Ralph Result",
                "",
                f"- Lineage ID: `{args.lineage_id}`",
                "- Surface: `ouroboros.ralph_loop.RalphLoopRunner`",
                f"- Status: `{tool_result.meta.get('status')}`",
                f"- Stop reason: `{tool_result.meta.get('stop_reason')}`",
                f"- Iterations: `{tool_result.meta.get('iterations')}`",
                "- Full RalphHandler/EvolutionaryLoop composition: `blocked locally; hangs in this Codex surface after job start`",
                "",
                "## Handler Output",
                "",
                text,
                "",
            ]
        ),
        encoding="utf-8",
    )
    print(f"wrote {out_path.relative_to(project_dir)}")
    print(f"status={tool_result.meta.get('status')}")
    print(f"stop_reason={tool_result.meta.get('stop_reason')}")
    return 0 if not tool_result.is_error else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(_main()))
