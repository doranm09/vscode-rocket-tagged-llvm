#!/usr/bin/env python3
import argparse
import struct
import json
import re
import sys
from pathlib import Path


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Validate FSM transitions from asm TAG markers or sideband trace binary"
    )
    p.add_argument("--asm", help="Path to generated assembly file")
    p.add_argument("--sideband-bin", help="Path to little-endian 32-bit tag ID sideband binary")
    p.add_argument("--policy", required=True, help="Path to FSM policy JSON")
    args = p.parse_args()
    if bool(args.asm) == bool(args.sideband_bin):
        p.error("Provide exactly one of --asm or --sideband-bin")
    return args


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


def _parse_state_id(value: object) -> int:
    if isinstance(value, int):
        return value
    if isinstance(value, str):
        return int(value, 0)
    raise ValueError(f"Invalid state ID type: {type(value)}")


def extract_tags_from_sideband(sideband_bytes: bytes, policy: dict) -> list[str]:
    if len(sideband_bytes) % 4 != 0:
        raise ValueError(
            f"Sideband stream length ({len(sideband_bytes)}) is not a multiple of 4 bytes."
        )

    ids = policy.get("ids", {})
    id_to_state: dict[int, str] = {}
    for state, raw_id in ids.items():
        parsed = _parse_state_id(raw_id)
        id_to_state[parsed] = state

    tags: list[str] = []
    for (raw_id,) in struct.iter_unpack("<I", sideband_bytes):
        tags.append(id_to_state.get(raw_id, f"ID_{raw_id}"))
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
    policy_path = Path(args.policy)

    if not policy_path.exists():
        print(f"ERROR: policy file not found: {policy_path}", file=sys.stderr)
        return 2

    policy = load_policy(policy_path)

    if args.asm:
        asm_path = Path(args.asm)
        if not asm_path.exists():
            print(f"ERROR: asm file not found: {asm_path}", file=sys.stderr)
            return 2
        tags = extract_tags(asm_path.read_text(encoding="utf-8"))
    else:
        sideband_path = Path(args.sideband_bin)
        if not sideband_path.exists():
            print(f"ERROR: sideband file not found: {sideband_path}", file=sys.stderr)
            return 2
        try:
            tags = extract_tags_from_sideband(sideband_path.read_bytes(), policy)
        except ValueError as exc:
            print(f"ERROR: {exc}", file=sys.stderr)
            return 2

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
