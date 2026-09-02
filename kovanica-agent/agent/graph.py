"""
LangGraph skeleton for the Kovanica DevTeam agent.

Design rules baked into this file (do not weaken without a reason):
  1. `role` comes from the auth layer (main.py), never from the LLM or the
     user's message. A user can't talk their way into `dev` tools.
  2. run_cargo_command only ever executes inside the ephemeral sandbox
     container, never on the host, and only against the whitelisted verbs.
  3. Anything that would mutate the real repo (git_diff_suggest -> apply)
     is proposed, never applied, and requires a human confirmation via the
     /confirm endpoint before it goes further.
"""

import os
import time
import uuid
from typing import Literal, Optional, TypedDict, Annotated

import docker
from langchain_core.messages import AnyMessage, SystemMessage
from langchain_core.tools import tool
from langchain_openai import ChatOpenAI
from langgraph.graph import StateGraph, END
from langgraph.graph.message import add_messages
from langgraph.checkpoint.memory import MemorySaver

VLLM_BASE_URL = os.environ.get("VLLM_BASE_URL", "http://vllm:8000/v1")
QDRANT_URL = os.environ.get("QDRANT_URL", "http://qdrant:6333")
SANDBOX_IMAGE = os.environ.get("SANDBOX_IMAGE", "kovanica-sandbox:latest")
REPOS_PATH = os.environ.get("REPOS_PATH", "/repos")

ALLOWED_CARGO_COMMANDS = {"check", "test", "clippy", "build"}
CARGO_TIMEOUT_SECONDS = 180


# ---------------------------------------------------------------------------
# State
# ---------------------------------------------------------------------------

class AgentState(TypedDict):
    messages: Annotated[list[AnyMessage], add_messages]
    role: Literal["dev", "user"]
    pending_confirmation: Optional[dict]  # set when a diff is proposed


# ---------------------------------------------------------------------------
# Tools
# ---------------------------------------------------------------------------

@tool
def search_codebase(query: str) -> str:
    """Semantic + keyword search over the indexed Kovanica codebase and docs.
    Returns matching chunks with file path + line range so the agent can cite them.
    """
    # from qdrant_client import QdrantClient
    # client = QdrantClient(url=QDRANT_URL)
    # ... embed `query`, search collection "kovanica_codebase", return hits
    return "TODO: wire to Qdrant collection 'kovanica_codebase'"


@tool
def read_file(path: str, start_line: int = 1, end_line: Optional[int] = None) -> str:
    """Read a slice of a file from the read-only repo mount. Path is relative
    to the repo root, e.g. 'consensus/src/ghostdag.rs'.
    """
    full_path = os.path.join(REPOS_PATH, path.lstrip("/"))
    if not os.path.abspath(full_path).startswith(os.path.abspath(REPOS_PATH)):
        return "ERROR: path escapes repo root"
    with open(full_path, "r", errors="replace") as f:
        lines = f.readlines()
    end_line = end_line or len(lines)
    return "".join(lines[start_line - 1:end_line])


@tool
def run_cargo_command(command: str, args: list[str] = []) -> str:
    """Run a whitelisted cargo command (check, test, clippy, build) against
    the repo, inside an ephemeral, network-disabled sandbox container.
    """
    if command not in ALLOWED_CARGO_COMMANDS:
        return f"REJECTED: '{command}' is not whitelisted ({sorted(ALLOWED_CARGO_COMMANDS)})"

    client = docker.from_env()
    container_name = f"kovanica-sandbox-{uuid.uuid4().hex[:8]}"
    try:
        result = client.containers.run(
            image=SANDBOX_IMAGE,
            command=[command, *args],
            name=container_name,
            volumes={os.path.abspath(REPOS_PATH): {"bind": "/workspace", "mode": "ro"}},
            network_disabled=True,
            mem_limit="2g",
            nano_cpus=int(2e9),          # 2 CPUs
            user="sandbox",
            remove=True,
            detach=False,
            stdout=True,
            stderr=True,
            # runtime="runsc",           # uncomment once gVisor is installed on the host
        )
        return result.decode("utf-8", errors="replace")
    except docker.errors.ContainerError as e:
        return f"cargo {command} failed:\n{e.stderr.decode('utf-8', errors='replace') if e.stderr else e}"
    except Exception as e:
        return f"ERROR running sandbox: {e}"


@tool
def git_diff_suggest(path: str, explanation: str, patch: str) -> str:
    """Propose a patch to a file. This NEVER writes to the real repo — it
    only stages a proposal that a human must approve via POST /confirm.
    """
    return (
        "PROPOSED (not applied). This diff is queued for human review.\n"
        f"File: {path}\nWhy: {explanation}\n---\n{patch}"
    )


@tool
def query_node_api(endpoint: str) -> str:
    """Read-only GET against the local/testnet Kovanica node RPC, e.g. '/status'."""
    # import requests
    # r = requests.get(f"http://kovanica-node:PORT{endpoint}", timeout=5)
    # return r.text
    return f"TODO: wire to node RPC, endpoint={endpoint}"


@tool
def explain_concept(term: str) -> str:
    """Explain a GHOSTDAG/PHANTOM/consensus term using the project's own
    vocabulary (see SYSTEM_PROMPT.md glossary), grounded in the indexed docs.
    """
    return search_codebase.invoke({"query": f"definition and usage of {term}"})


DEV_TOOLS = [search_codebase, read_file, run_cargo_command, git_diff_suggest,
             query_node_api, explain_concept]
USER_TOOLS = [search_codebase, query_node_api, explain_concept]


# ---------------------------------------------------------------------------
# LLM
# ---------------------------------------------------------------------------

llm = ChatOpenAI(
    base_url=VLLM_BASE_URL,
    api_key="not-needed",  # vLLM's OpenAI-compatible server ignores this
    model="Qwen/Qwen2.5-Coder-32B-Instruct-AWQ",
    temperature=0.1,
)

with open(os.path.join(os.path.dirname(__file__), "..", "SYSTEM_PROMPT.md")) as f:
    SYSTEM_PROMPT = f.read()


# ---------------------------------------------------------------------------
# Nodes
# ---------------------------------------------------------------------------

def router(state: AgentState) -> AgentState:
    # `role` must already be set by main.py from the authenticated caller
    # (JWT/Keycloak claim), not inferred here from message content.
    return state


def agent_node(state: AgentState) -> AgentState:
    tools = DEV_TOOLS if state["role"] == "dev" else USER_TOOLS
    bound_llm = llm.bind_tools(tools)
    messages = [SystemMessage(content=SYSTEM_PROMPT), *state["messages"]]
    response = bound_llm.invoke(messages)
    return {"messages": [response]}


def human_gate(state: AgentState) -> AgentState:
    """Reached only when the agent called git_diff_suggest. Graph execution
    stops here (see interrupt_before in build_graph) until main.py's
    /confirm endpoint resumes it with an approval or rejection.
    """
    last = state["messages"][-1]
    state["pending_confirmation"] = {
        "tool_call_id": getattr(last, "tool_call_id", None),
        "queued_at": time.time(),
    }
    return state


def should_continue(state: AgentState) -> str:
    last = state["messages"][-1]
    tool_calls = getattr(last, "tool_calls", None)
    if not tool_calls:
        return END
    if any(tc["name"] == "git_diff_suggest" for tc in tool_calls):
        return "human_gate"
    return "tools"


# ---------------------------------------------------------------------------
# Graph assembly
# ---------------------------------------------------------------------------

def build_graph():
    from langgraph.prebuilt import ToolNode

    graph = StateGraph(AgentState)
    graph.add_node("router", router)
    graph.add_node("agent", agent_node)
    graph.add_node("tools", ToolNode(DEV_TOOLS))
    graph.add_node("human_gate", human_gate)

    graph.set_entry_point("router")
    graph.add_edge("router", "agent")
    graph.add_conditional_edges("agent", should_continue,
                                 {"tools": "tools", "human_gate": "human_gate", END: END})
    graph.add_edge("tools", "agent")
    graph.add_edge("human_gate", END)  # execution pauses; resumed externally

    checkpointer = MemorySaver()  # swap for a persistent store in production
    return graph.compile(checkpointer=checkpointer, interrupt_before=["human_gate"])
