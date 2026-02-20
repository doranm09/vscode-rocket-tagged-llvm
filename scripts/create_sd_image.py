#!/usr/bin/env python3
"""
Create and populate an SD-card image from a staging layout directory.

This script expects a staging directory such as:
  build/tagged/sdcard/<name>/
and builds a partitioned FAT image with the directory contents copied into
the boot partition.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Iterable


PARTITION_OFFSET_BYTES = 1 * 1024 * 1024  # 1 MiB
REQUIRED_TOOLS = ("parted", "mformat", "mcopy", "mmd", "mdir", "dd")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Create a partitioned FAT SD image from a staging layout directory."
    )
    parser.add_argument(
        "--layout-dir",
        required=True,
        help="Path to SD-card staging directory to copy into image boot partition.",
    )
    parser.add_argument(
        "--output-image",
        required=True,
        help="Path to output .img file.",
    )
    parser.add_argument(
        "--size-mb",
        type=int,
        default=256,
        help="Image size in MB (default: 256).",
    )
    parser.add_argument(
        "--volume-label",
        default="ROCKETFSM",
        help="FAT volume label (default: ROCKETFSM).",
    )
    parser.add_argument(
        "--manifest-out",
        default="",
        help="Optional output path for generated image manifest JSON.",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Overwrite output image if it exists.",
    )
    parser.add_argument(
        "--flash-device",
        default="",
        help="Optional block device path to flash (e.g. /dev/sdX).",
    )
    parser.add_argument(
        "--confirm-flash-device",
        default="",
        help="Required safety string: must exactly match --flash-device.",
    )
    return parser.parse_args()


def run(cmd: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(cmd, check=True, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)


def ensure_tools_exist() -> None:
    missing = [tool for tool in REQUIRED_TOOLS if shutil.which(tool) is None]
    if missing:
        raise RuntimeError(f"Missing required tools: {', '.join(missing)}")


def iter_layout_files(layout_dir: Path) -> Iterable[Path]:
    for path in sorted(layout_dir.rglob("*")):
        if path.is_file():
            yield path


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        while True:
            chunk = f.read(1024 * 1024)
            if not chunk:
                break
            h.update(chunk)
    return h.hexdigest()


def create_partitioned_image(output_image: Path, size_mb: int, label: str) -> None:
    output_image.parent.mkdir(parents=True, exist_ok=True)
    run(["truncate", "-s", f"{size_mb}M", str(output_image)])
    run(["parted", "-s", str(output_image), "mklabel", "msdos"])
    run(["parted", "-s", str(output_image), "mkpart", "primary", "fat32", "1MiB", "100%"])
    run(["parted", "-s", str(output_image), "set", "1", "boot", "on"])
    run(
        [
            "mformat",
            "-i",
            f"{output_image}@@{PARTITION_OFFSET_BYTES}",
            "-F",
            "-v",
            label,
            "::",
        ]
    )


def mtools_mkdir(image: Path, rel_dir: str) -> None:
    if not rel_dir:
        return
    run(["mmd", "-i", f"{image}@@{PARTITION_OFFSET_BYTES}", f"::{rel_dir}"])


def mtools_copy_file(image: Path, src: Path, rel_dest: str) -> None:
    run(["mcopy", "-i", f"{image}@@{PARTITION_OFFSET_BYTES}", str(src), f"::{rel_dest}"])


def populate_image_from_layout(layout_dir: Path, output_image: Path) -> list[dict]:
    files = list(iter_layout_files(layout_dir))
    if not files:
        raise RuntimeError(f"Layout directory contains no files: {layout_dir}")

    created_dirs: set[str] = set()
    copied_entries: list[dict] = []

    for src in files:
        rel = src.relative_to(layout_dir).as_posix()
        parent = str(Path(rel).parent).replace("\\", "/")
        if parent == ".":
            parent = ""

        if parent:
            parts = parent.split("/")
            acc = ""
            for part in parts:
                acc = f"{acc}/{part}" if acc else part
                if acc not in created_dirs:
                    mtools_mkdir(output_image, acc)
                    created_dirs.add(acc)

        mtools_copy_file(output_image, src, rel)
        copied_entries.append(
            {
                "relativePath": rel,
                "sizeBytes": src.stat().st_size,
                "sha256": sha256_file(src),
            }
        )

    return copied_entries


def flash_image(image: Path, device: str) -> None:
    run(["dd", f"if={image}", f"of={device}", "bs=4M", "conv=fsync", "status=progress"])
    run(["sync"])


def write_manifest(
    manifest_path: Path,
    args: argparse.Namespace,
    copied_entries: list[dict],
    output_image: Path,
) -> None:
    manifest = {
        "generatedAt": subprocess.run(
            ["date", "-u", "+%Y-%m-%dT%H:%M:%SZ"],
            check=True,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        ).stdout.strip(),
        "layoutDir": str(Path(args.layout_dir).resolve()),
        "outputImage": str(output_image.resolve()),
        "imageSizeMB": args.size_mb,
        "partitionOffsetBytes": PARTITION_OFFSET_BYTES,
        "volumeLabel": args.volume_label,
        "outputImageSha256": sha256_file(output_image),
        "files": copied_entries,
    }
    if args.flash_device:
        manifest["flashDevice"] = args.flash_device

    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")


def main() -> int:
    args = parse_args()
    layout_dir = Path(args.layout_dir).resolve()
    output_image = Path(args.output_image).resolve()

    if args.size_mb < 32:
        print("ERROR: --size-mb must be at least 32", file=sys.stderr)
        return 2

    if not layout_dir.exists() or not layout_dir.is_dir():
        print(f"ERROR: layout directory not found: {layout_dir}", file=sys.stderr)
        return 2

    if output_image.exists() and not args.force:
        print(f"ERROR: output image exists (use --force): {output_image}", file=sys.stderr)
        return 2

    if args.flash_device and args.confirm_flash_device != args.flash_device:
        print(
            "ERROR: flash confirmation mismatch. "
            "Pass --confirm-flash-device with the exact same path.",
            file=sys.stderr,
        )
        return 2

    try:
        ensure_tools_exist()
        if output_image.exists() and args.force:
            output_image.unlink()

        create_partitioned_image(output_image, args.size_mb, args.volume_label)
        copied_entries = populate_image_from_layout(layout_dir, output_image)

        run(["mdir", "-i", f"{output_image}@@{PARTITION_OFFSET_BYTES}", "::"])

        if args.flash_device:
            flash_image(output_image, args.flash_device)

        manifest_path = (
            Path(args.manifest_out).resolve()
            if args.manifest_out
            else output_image.with_suffix(".manifest.json")
        )
        write_manifest(manifest_path, args, copied_entries, output_image)

        print(f"Created image: {output_image}")
        print(f"Manifest: {manifest_path}")
        if args.flash_device:
            print(f"Flashed device: {args.flash_device}")
        return 0
    except subprocess.CalledProcessError as exc:
        print("ERROR: command failed:", " ".join(exc.cmd), file=sys.stderr)
        if exc.stdout:
            print(exc.stdout, file=sys.stderr)
        if exc.stderr:
            print(exc.stderr, file=sys.stderr)
        return 1
    except RuntimeError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
