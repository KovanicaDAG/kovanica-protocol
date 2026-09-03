"""
FastAPI entrypoint. Two routes:
  POST /chat     - send a message, get the agent's response (or a
                    "pending_confirmation" if it proposed a diff)
  POST /confirm  - approve or reject a pending diff, resumes the graph

Role is derived from auth, not from the request body. The `Authorization`
header is verified with real JWT auth (see auth.py): JWKS mode when
AUTH_JWKS_URL is set, dev-token mode otherwise. Only `dev` may confirm.
"""

import json
import os
import time
from pathlib import Path

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel

from auth import verify_token
from graph import build_graph

app = FastAPI(title="Kovanica DevTeam Agent")
agent_graph = build_graph()

AUDIT_LOG = Path(os.environ.get("AGENT_AUDIT_LOG", "/data/audit.jsonl"))
AUDIT_LOG.parent.mkdir(parents=True, exist_ok=True)


def audit(event: dict) -> None:
    event["ts"] = time.time()
    with AUDIT_LOG.open("a") as f:
        f.write(json.dumps(event) + "\n")


class ChatRequest(BaseModel):
    session_id: str
    message: str


class ConfirmRequest(BaseModel):
    session_id: str
    approve: bool


@app.post("/chat")
def chat(req: ChatRequest, authorization: str | None = Header(default=None)):
    role = verify_token(authorization)
    config = {"configurable": {"thread_id": req.session_id}}

    result = agent_graph.invoke(
        {"messages": [("user", req.message)], "role": role, "pending_confirmation": None},
        config=config,
    )

    audit({"session_id": req.session_id, "role": role, "event": "chat",
           "message": req.message})

    if result.get("pending_confirmation"):
        return {
            "status": "pending_confirmation",
            "detail": "Agent proposed a repo change. Review and POST /confirm.",
            "messages": [str(m.content) for m in result["messages"][-3:]],
        }

    return {"status": "ok", "reply": result["messages"][-1].content}


@app.post("/confirm")
def confirm(req: ConfirmRequest, authorization: str | None = Header(default=None)):
    role = verify_token(authorization)
    if role != "dev":
        raise HTTPException(status_code=403, detail="Only dev role can confirm changes")

    config = {"configurable": {"thread_id": req.session_id}}

    audit({"session_id": req.session_id, "role": role, "event": "confirm",
           "approved": req.approve})

    if not req.approve:
        return {"status": "rejected"}

    # Resuming here re-enters the graph past human_gate. Actual patch
    # application (writing to the real repo / opening a PR) belongs in a
    # dedicated apply_patch tool called only from this authenticated path —
    # deliberately not implemented in this skeleton.
    result = agent_graph.invoke(None, config=config)
    return {"status": "approved", "reply": result["messages"][-1].content}


@app.get("/healthz")
def healthz():
    return {"status": "ok"}
