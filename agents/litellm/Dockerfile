# Sandbox image for litellm.agent(Harness.CLAUDE_CODE, ...).
#
# Build from the repository root, then point run_agent.py at it:
#   docker build -t my-agents:latest agents/litellm
#   python3 agents/litellm/run_agent.py --repo ./repo "Reason about the failing test"
#
# litellm.agent() does not install the harness runtime (`install=` covers Deep
# Agents / Tool Loop only), so the `claude` binary has to be on PATH here.
FROM node:24-slim

ARG CLAUDE_CODE_VERSION=latest

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates \
      git \
      python3 \
      python3-pip \
      python3-venv \
      build-essential \
 && rm -rf /var/lib/apt/lists/*

RUN npm install -g "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" \
 && claude --version

WORKDIR /workspace

# permissions="full" lets the agent install missing dependencies itself, so the
# image only needs the language runtimes, not every test dependency.
CMD ["bash"]
