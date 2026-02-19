#!/usr/bin/env python3
import argparse
import json
import re
import sys
from pathlib import Path


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Validate TAG transitions in generated asm")
    p.add_argument("--asm", required=True, help="Path to generated assembly file")
    p.add_argument("--policy", required=True, help="Path to FSM policy JSON")
    return p.parse_args()


def load_policy(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def extract_tags(asm_text: str) -> list[str]:
    tags: list[str] = []
    pattern = re.compile(r"TAG:([A-Za-z0-9_]+)")
    for line in asm_text.splitlines():
        m = pattern.search(line)
        if m:
            tags.append(m.group(1))
    return tags


def validate(tags: list[str], policy: dict) -> tuple[bool, list[str]]:
    errors: list[str] = []
    transitions = policy.get("transitions", {})
    start = policy.get("start")
    accept = set(policy.get("accept", []))

    if not tags:
        return False, ["No TAG:<STATE> markers were found in asm output."]

    if start and tags[0] != start:
        errors.append(f"First tag '{tags[0]}' does not match required start state '{start}'.")

    for prev, curr in zip(tags, tags[1:]):
        allowed = transitions.get(prev, [])
        if curr not in allowed:
            errors.append(
                f"Illegal transition {prev} -> {curr}. Allowed next states: {allowed}."
            )

    if accept and tags[-1] not in accept:
        errors.append(f"Final tag '{tags[-1]}' is not in accept set {sorted(accept)}.")

    return len(errors) == 0, errors


def main() -> int:
    args = parse_args()
    asm_path = Path(args.asm)
    policy_path = Path(args.policy)

    if not asm_path.exists():
        print(f"ERROR: asm file not found: {asm_path}", file=sys.stderr)
        return 2
    if not policy_path.exists():
        print(f"ERROR: policy file not found: {policy_path}", file=sys.stderr)
        return 2

    policy = load_policy(policy_path)
    tags = extract_tags(asm_path.read_text(encoding="utf-8"))
    ok, errors = validate(tags, policy)

    if ok:
        print("FSM CHECK PASS")
        print("Tag trace:", " -> ".join(tags))
        return 0

    print("FSM CHECK FAIL", file=sys.stderr)
    for e in errors:
        print(f"  - {e}", file=sys.stderr)
    print("Tag trace:", " -> ".join(tags), file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
