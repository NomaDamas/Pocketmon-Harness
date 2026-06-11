#!/usr/bin/env python3
"""Run the installed Ouroboros evaluate MCP handler from this repo.

The installed CLI lacks a first-party `ouroboros evaluate` command in this
environment, but the official MCP handler is present. This wrapper restores the
formal handler path without printing provider secrets.
"""

from __future__ import annotations

import argparse
import asyncio
from pathlib import Path

from ouroboros.mcp.tools.evaluation_handlers import EvaluateHandler


DEFAULT_SESSION_ID = "orch_06558ebdd7d5"
DEFAULT_EXECUTION_ID = "exec_37d83bee108f"


def _read_artifact(project_dir: Path) -> str:
    paths = [
        project_dir / "docs" / "ouroboros-stage1-completed-acs.yaml",
        project_dir / "docs" / "ouroboros-formal-guardrail-output.md",
        project_dir / "docs" / "ouroboros-ralph-readiness.md",
        project_dir / "README.md",
        project_dir / "package.json",
    ]
    chunks: list[str] = []
    for path in paths:
        if path.exists():
            chunks.append(f"## {path.relative_to(project_dir)}\n\n{path.read_text()}")
    return "\n\n".join(chunks)


async def _main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--session-id", default=DEFAULT_SESSION_ID)
    parser.add_argument("--execution-id", default=DEFAULT_EXECUTION_ID)
    parser.add_argument("--project-dir", default=str(Path.cwd()))
    parser.add_argument("--seed", default="pokemon-red-stage1-autonomous-harness.seed.yaml")
    parser.add_argument("--out", default="docs/ouroboros-formal-evaluate-result.md")
    args = parser.parse_args()

    project_dir = Path(args.project_dir).resolve()
    (project_dir / args.out).unlink(missing_ok=True)
    (project_dir / "docs" / "ouroboros-formal-evaluate-precheck.md").unlink(
        missing_ok=True
    )
    seed_content = (project_dir / args.seed).read_text()
    artifact = _read_artifact(project_dir)
    if not artifact.strip():
        raise RuntimeError("No evaluation artifact content found")

    handler = EvaluateHandler(llm_backend="codex", agent_runtime_backend="codex")
    result = await handler.handle(
        {
            "session_id": args.session_id,
            "artifact": artifact,
            "seed_content": seed_content,
            "artifact_type": "code",
            "working_dir": str(project_dir),
            "trigger_consensus": False,
        }
    )
    if result.is_err:
        print(str(result.error))
        return 1

    value = result.value
    text = value.content[0].text if value.content else ""
    out_path = project_dir / args.out
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(
        "\n".join(
            [
                "# Formal Ouroboros Evaluate Result",
                "",
                f"- Session ID: `{args.session_id}`",
                f"- Execution ID: `{args.execution_id}`",
                f"- Final approved: `{value.meta.get('final_approved')}`",
                f"- Highest stage: `{value.meta.get('highest_stage')}`",
                f"- Stage 1 passed: `{value.meta.get('stage1_passed')}`",
                f"- Stage 2 AC compliance: `{value.meta.get('stage2_ac_compliance')}`",
                f"- Stage 2 score: `{value.meta.get('stage2_score')}`",
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
    print(f"final_approved={value.meta.get('final_approved')}")
    print(f"stage1_passed={value.meta.get('stage1_passed')}")
    return 0 if not value.is_error else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(_main()))
