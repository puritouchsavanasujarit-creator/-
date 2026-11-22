#!/usr/bin/env python3
"""Run one Claude Code turn through litellm.agent() inside a Docker sandbox.

Two ways to get model access, picked automatically from the environment:

  Direct Anthropic API (no gateway):
    export ANTHROPIC_API_KEY=sk-ant-...
    python3 agents/litellm/run_agent.py --repo ./repo \
        "Find why tests/test_router.py is flaky, fix it, and show it passing."

  LiteLLM AI Gateway (gateway vars win when both are set):
    export LITELLM_PROXY_API_BASE=litellm.example.com   # gateway root, no /v1
    export LITELLM_PROXY_API_KEY=sk-...                 # gateway virtual key

permissions="full" is required for this kind of task: "edit" only allows file
reads and writes, so the agent could not run the tests it is diagnosing.

Exit codes: 0 = success, 1 = the agent run failed, 2 = configuration problem.
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path
from typing import Any, Sequence

DEFAULT_IMAGE = "my-agents:latest"
DEFAULT_REPO = "repo"
DEFAULT_WORKDIR = "/workspace"

DIRECT_KEY_ENV = "ANTHROPIC_API_KEY"
DIRECT_MODEL = "anthropic/claude-sonnet-4-5"

# litellm strips these from the sandbox environment; the gateway credentials
# travel as call arguments instead of leaking into the container.
GATEWAY_BASE_ENV = "LITELLM_PROXY_API_BASE"
GATEWAY_KEY_ENV = "LITELLM_PROXY_API_KEY"
GATEWAY_MODEL = "litellm_proxy/claude"

CONFIG_ERROR = 2
RUN_ERROR = 1


class ConfigError(Exception):
    """The environment or arguments cannot produce a run."""


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run one Claude Code turn through litellm.agent() in Docker.",
    )
    parser.add_argument("prompt", help="Task for the agent, as one string.")
    parser.add_argument(
        "--repo",
        default=DEFAULT_REPO,
        help=f"Host directory mounted into the sandbox (default: ./{DEFAULT_REPO}).",
    )
    parser.add_argument(
        "--workdir",
        default=DEFAULT_WORKDIR,
        help=f"Mount point inside the container (default: {DEFAULT_WORKDIR}).",
    )
    parser.add_argument(
        "--image",
        default=DEFAULT_IMAGE,
        help=f"Docker image with the claude CLI installed (default: {DEFAULT_IMAGE}).",
    )
    parser.add_argument(
        "--model",
        default=None,
        help=(
            "Override the model or gateway model group "
            f"(defaults: {DIRECT_MODEL} direct, {GATEWAY_MODEL} via gateway)."
        ),
    )
    return parser.parse_args(argv)


def normalize_base(raw: str) -> str:
    """Gateway root URL as litellm.agent() expects it: scheme, no trailing /v1."""
    if "://" not in raw:
        host = raw.split("/", 1)[0]
        scheme = "http" if host.startswith(("localhost", "127.0.0.1")) else "https"
        raw = f"{scheme}://{raw}"

    # litellm appends the provider path itself, so /v1 is not part of api_base.
    raw = raw.rstrip("/")
    if raw.endswith("/v1"):
        raw = raw[: -len("/v1")]
    return raw


def read_settings(model: str | None) -> tuple[str, str, str | None, str]:
    """Return (label, model, api_base, api_key) for the configured provider."""
    gateway_base = os.environ.get(GATEWAY_BASE_ENV, "").strip()
    gateway_key = os.environ.get(GATEWAY_KEY_ENV, "").strip()
    direct_key = os.environ.get(DIRECT_KEY_ENV, "").strip()

    if gateway_base or gateway_key:
        missing = [
            name
            for name, value in ((GATEWAY_BASE_ENV, gateway_base), (GATEWAY_KEY_ENV, gateway_key))
            if not value
        ]
        if missing:
            raise ConfigError(f"set {', '.join(missing)} in the environment (or .env).")
        return "gateway", model or GATEWAY_MODEL, normalize_base(gateway_base), gateway_key

    if direct_key:
        # api_base stays None so litellm talks to the Anthropic API itself.
        return "direct", model or DIRECT_MODEL, None, direct_key

    raise ConfigError(
        f"no credentials: set {DIRECT_KEY_ENV}, or both {GATEWAY_BASE_ENV} and "
        f"{GATEWAY_KEY_ENV} in the environment (or .env)."
    )


def resolve_repo(raw: str) -> Path:
    repo = Path(raw).expanduser().resolve()
    if not repo.is_dir():
        raise ConfigError(f"repo directory not found: {repo}")
    return repo


def print_summary(result: Any) -> None:
    text = (getattr(result, "text", "") or "").strip()
    cost = getattr(result, "cost", None)
    files = list(getattr(result, "files", None) or [])

    print("── text ──")
    print(text or "(no text returned)")
    print()
    print("── cost ──")
    if isinstance(cost, (int, float)):
        print(f"${cost:.4f}")
    else:
        print("(not reported)")
    print()
    print(f"── files ({len(files)}) ──")
    if not files:
        print("(none)")
        return
    for item in files:
        kind = getattr(item, "kind", "?")
        path = getattr(item, "path", "?")
        print(f"  {str(kind):<10} {path}")


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)

    try:
        provider, model, api_base, api_key = read_settings(args.model)
        repo = resolve_repo(args.repo)
    except ConfigError as err:
        print(f"config error: {err}", file=sys.stderr)
        return CONFIG_ERROR

    try:
        import litellm
        from litellm import Harness, sandbox
    except ImportError as err:
        print(
            f"config error: {err}. Install the runner deps first: "
            "pip install -r agents/litellm/requirements.txt",
            file=sys.stderr,
        )
        return CONFIG_ERROR

    box = sandbox.docker(args.image, mounts={str(repo): args.workdir})

    print(f"provider: {provider}  model: {model}", file=sys.stderr)

    try:
        result = litellm.agent(
            Harness.CLAUDE_CODE,
            args.prompt,
            sandbox=box,
            model=model,
            permissions="full",
            api_base=api_base,
            api_key=api_key,
        )
    except Exception as err:  # harness, provider and container failures alike
        print(f"agent run failed: {type(err).__name__}: {err}", file=sys.stderr)
        return RUN_ERROR

    print_summary(result)
    return 0


if __name__ == "__main__":
    sys.exit(main())
