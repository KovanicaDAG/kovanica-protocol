#!/usr/bin/env python3
"""Negative tests for ``validate-tauri-config.py``.

A gate that never fails is not a gate. This script proves that
``validate-tauri-config.py`` actually rejects each defect class it claims to
catch, and that it accepts a clean config.

Each case mutates a copy of a known-good config, runs the gate against that
copy, and asserts both the exit code and the message. The copy is written next
to the original because the gate resolves referenced paths (``bundle.icon``,
``bundle.macOS.entitlements``, ...) relative to the config's own directory, so
a copy in a temporary directory would fail for the wrong reason. The copy is
always removed.

Usage: ``python3 ops/ci/test-validate-tauri-config.py``
"""

from __future__ import annotations

import copy
import json
import os
import subprocess
import sys

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
GATE = os.path.join(REPO_ROOT, "ops", "ci", "validate-tauri-config.py")

# A config that is known-good and whose referenced paths all resolve.
BASE = os.path.join(REPO_ROOT, "apps", "console-enterprise", "src-tauri", "tauri.conf.json")


def mutate_schema_violation(config: dict) -> None:
    """`appimage` is not a key of `bundle.windows` in v2 (it lives under `bundle.linux`)."""
    config["bundle"]["windows"]["appimage"] = {"depends": []}


def mutate_missing_icon(config: dict) -> None:
    config["bundle"]["icon"][0] = "icons/definitely-not-here.png"


def mutate_dangling_entitlements(config: dict) -> None:
    config["bundle"]["macOS"]["entitlements"] = "entitlements.plist"


def mutate_dangling_license_file(config: dict) -> None:
    config["bundle"]["windows"]["nsis"]["licenseFile"] = "../../../../LICENSE"


# (name, mutator or None, expected substring)
CASES = [
    ("schema violation under bundle.windows", mutate_schema_violation,
     "Additional properties are not allowed"),
    ("missing bundle.icon[0]", mutate_missing_icon,
     "referenced path does not exist"),
    ("dangling bundle.macOS.entitlements", mutate_dangling_entitlements,
     "referenced path does not exist"),
    ("dangling bundle.windows.nsis.licenseFile", mutate_dangling_license_file,
     "referenced path does not exist"),
    ("control (unmodified config)", None, None),
]


def run_gate(path: str) -> tuple[int, str]:
    proc = subprocess.run(
        [sys.executable, GATE, path],
        capture_output=True,
        text=True,
        cwd=REPO_ROOT,
    )
    return proc.returncode, proc.stdout + proc.stderr


def main() -> int:
    if not os.path.exists(BASE):
        print(f"test-validate-tauri-config: base config missing: {BASE}", file=sys.stderr)
        return 1

    with open(BASE, encoding="utf-8") as fh:
        good = json.load(fh)

    scratch = os.path.join(os.path.dirname(BASE), "tauri.conf.negtest.json")
    failures = 0

    try:
        for name, mutator, expected in CASES:
            config = copy.deepcopy(good)
            if mutator is not None:
                mutator(config)
            with open(scratch, "w", encoding="utf-8") as fh:
                json.dump(config, fh, indent=2)
                fh.write("\n")

            rc, output = run_gate(scratch)

            if expected is None:
                ok = rc == 0
                detail = "expected rc=0"
            else:
                ok = rc != 0 and expected in output
                detail = f"expected rc!=0 and {expected!r}"

            status = "PASS" if ok else "FAIL"
            if not ok:
                failures += 1
                print(f"[{status}] {name}: rc={rc} {detail}")
                for line in output.splitlines():
                    if "FAIL:" in line or "SKIP" in line:
                        print(f"         {line.strip()}")
            else:
                print(f"[{status}] {name}: rc={rc} {detail}")
    finally:
        if os.path.exists(scratch):
            os.remove(scratch)

    print("---")
    if failures:
        print(f"test-validate-tauri-config: FAIL ({failures} case(s))")
        return 1
    print("test-validate-tauri-config: PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
