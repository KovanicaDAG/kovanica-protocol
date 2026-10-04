#!/usr/bin/env python3
"""Structural checks for the GitHub Actions workflows.

`ci.yml`'s `changes` filters do not match `.github/workflows/**`, so before this
gate a workflow-only pull request ran no validation at all: a `needs:` pointing
at a renamed job, or a step that referenced an output nobody declares, would
only surface on the next real push.

What it checks, per workflow file:

* it parses as YAML;
* every job has exactly one of `runs-on` / `uses`;
* every `needs:` entry names a job that exists in the same file;
* every `needs.<job>.outputs.<name>` reference names a job in that file and an
  output that job declares;
* every `steps[].uses` is pinned (owner/repo@ref, docker://image, or ./path);
* every `${{ env.X }}` reference names a variable the workflow or job declares.

It deliberately does not try to be actionlint: no network, no shell parsing.

Usage: python3 ops/ci/validate-workflows.py [workflow.yml ...]
"""

from __future__ import annotations

import os
import re
import sys

try:
    import yaml
except ImportError:  # pragma: no cover - CI installs PyYAML via the runner image
    print("validate-workflows: PyYAML is required", file=sys.stderr)
    sys.exit(2)

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
WORKFLOW_DIR = os.path.join(REPO_ROOT, ".github", "workflows")

# `actions/checkout@v4`, `docker://rhysd/actionlint:latest`, `./local/action`
USES_RE = re.compile(r"^(?:[^@\s/]+/[^@\s]+@[^@\s]+|docker://[^\s]+|\./.*)$")
NEEDS_OUTPUT_RE = re.compile(r"needs\.([A-Za-z0-9_-]+)\.outputs\.([A-Za-z0-9_-]+)")
ENV_RE = re.compile(r"\benv\.([A-Za-z0-9_]+)")


def walk_strings(node, path="$"):
    """Yield (json-path, string) for every string in a nested structure."""
    if isinstance(node, str):
        yield path, node
    elif isinstance(node, dict):
        for key, value in node.items():
            yield from walk_strings(value, f"{path}.{key}")
    elif isinstance(node, list):
        for index, value in enumerate(node):
            yield from walk_strings(value, f"{path}[{index}]")


def check(path):
    rel = os.path.relpath(path, REPO_ROOT)
    with open(path, encoding="utf-8") as handle:
        try:
            doc = yaml.safe_load(handle)
        except yaml.YAMLError as exc:
            return [f"{rel}: not valid YAML: {exc}"]

    if not isinstance(doc, dict):
        return [f"{rel}: top level is not a mapping"]

    errors = []
    # PyYAML resolves a bare `on:` key to the boolean True (YAML 1.1), so accept
    # either spelling before declaring the trigger missing.
    if "on" not in doc and True not in doc:
        errors.append(f"{rel}: no `on:` trigger")

    jobs = doc.get("jobs")
    if not isinstance(jobs, dict) or not jobs:
        return errors + [f"{rel}: no `jobs:`"]

    declared_env = set()
    workflow_env = doc.get("env")
    if isinstance(workflow_env, dict):
        declared_env |= set(workflow_env)

    for job_id, job in jobs.items():
        where = f"{rel}: jobs.{job_id}"
        if not isinstance(job, dict):
            errors.append(f"{where}: not a mapping")
            continue

        if ("runs-on" in job) == ("uses" in job):
            errors.append(f"{where}: needs exactly one of `runs-on` / `uses`")

        job_env = job.get("env")
        if isinstance(job_env, dict):
            declared_env |= set(job_env)

        needs = job.get("needs")
        if needs is not None:
            names = needs if isinstance(needs, list) else [needs]
            for name in names:
                if name not in jobs:
                    errors.append(f"{where}: needs `{name}`, which is not a job in this file")

        steps = job.get("steps")
        if steps is not None and not isinstance(steps, list):
            errors.append(f"{where}: `steps` is not a list")
            steps = None
        for index, step in enumerate(steps or []):
            step_where = f"{where}.steps[{index}]"
            if not isinstance(step, dict):
                errors.append(f"{step_where}: not a mapping")
                continue
            uses = step.get("uses")
            if uses is not None and not USES_RE.match(str(uses)):
                errors.append(
                    f"{step_where}: `uses: {uses}` is not pinned"
                    " (expected owner/repo@ref, docker://image, or ./path)"
                )
            if uses is None and "run" not in step:
                errors.append(f"{step_where}: has neither `uses` nor `run`")

    for json_path, text in walk_strings(doc):
        for job_name, output in NEEDS_OUTPUT_RE.findall(text):
            if job_name not in jobs:
                errors.append(f"{rel}: {json_path}: needs.{job_name} is not a job in this file")
                continue
            declared = jobs[job_name].get("outputs") or {}
            if output not in declared:
                errors.append(
                    f"{rel}: {json_path}: needs.{job_name}.outputs.{output}"
                    " is not declared by that job"
                )
        # Only treat `env.X` as an expression inside a GitHub expression, so a
        # shell script that happens to contain the text is not flagged.
        if "${{" in text:
            for name in ENV_RE.findall(text):
                if name not in declared_env:
                    errors.append(f"{rel}: {json_path}: env.{name} is not declared")

    return errors


def main(argv):
    if argv:
        paths = [os.path.abspath(argument) for argument in argv]
    else:
        if not os.path.isdir(WORKFLOW_DIR):
            print("validate-workflows: no .github/workflows directory", file=sys.stderr)
            return 1
        paths = sorted(
            os.path.join(WORKFLOW_DIR, name)
            for name in os.listdir(WORKFLOW_DIR)
            if name.endswith((".yml", ".yaml"))
        )

    all_errors = []
    for path in paths:
        rel = os.path.relpath(path, REPO_ROOT)
        print(f"=== {rel} ===")
        errors = check(path)
        if errors:
            for error in errors:
                print(f"  FAIL: {error}")
            all_errors.extend(errors)
        else:
            print("  OK")

    print("---")
    if all_errors:
        print(f"validate-workflows: FAIL ({len(all_errors)} problem(s))")
        return 1
    print("validate-workflows: PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
