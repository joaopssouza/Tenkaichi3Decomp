#!/usr/bin/env python3
"""Prepares game assets for Self-Hosted Web deployment.

Splits a PS2 ISO image (SLUS-21678) into 1 MiB chunked slices (/disc/00000.bin ... /disc/index.json)
for efficient, immutable browser caching (pieceDisc mode in shell.html), and/or creates
symlink/copy of disc.iso for HTTP Range Request mode.

Usage:
    python port/tools/prep_web_assets.py [--iso PATH] [--out DIR] [--mode chunks|iso|both]
"""

import argparse
import json
import os
import pathlib
import sys

DEFAULT_ISO = "DBZ3_SLUS_21678_PTBR.ISO"
CHUNK_SIZE = 1024 * 1024  # 1 MiB

def prep_chunks(iso_path: pathlib.Path, out_disc_dir: pathlib.Path):
    out_disc_dir.mkdir(parents=True, exist_ok=True)
    file_size = iso_path.stat().st_size
    chunk_count = (file_size + CHUNK_SIZE - 1) // CHUNK_SIZE
    print(f"[Assets] Slicing {iso_path.name} ({file_size:,} bytes) into {chunk_count} 1 MiB chunks at {out_disc_dir}...")

    with open(iso_path, "rb") as f:
        for i in range(chunk_count):
            chunk_file = out_disc_dir / f"{i:05d}.bin"
            want_size = (file_size - i * CHUNK_SIZE) if (i == chunk_count - 1) else CHUNK_SIZE

            if chunk_file.exists() and chunk_file.stat().st_size == want_size:
                continue

            f.seek(i * CHUNK_SIZE)
            data = f.read(want_size)
            chunk_file.write_bytes(data)

            if (i + 1) % 500 == 0 or i == chunk_count - 1:
                print(f"  Processed {i + 1}/{chunk_count} chunks ({(i + 1) / chunk_count * 100:.1f}%)")

    index_json = out_disc_dir / "index.json"
    index_json.write_text(json.dumps({"size": file_size, "piece": CHUNK_SIZE}, indent=2) + "\n")
    print(f"[Assets] index.json written ({file_size} bytes, piece={CHUNK_SIZE}).")

def prep_iso_file(iso_path: pathlib.Path, out_dir: pathlib.Path):
    out_dir.mkdir(parents=True, exist_ok=True)
    target = out_dir / "disc.iso"
    if target.resolve() == iso_path.resolve():
        print(f"[Assets] disc.iso already in place at {target}.")
        return

    try:
        # Try symbolic link first
        if target.exists() or target.is_symlink():
            target.unlink()
        target.symlink_to(iso_path.resolve())
        print(f"[Assets] Created symlink disc.iso -> {iso_path}.")
    except (OSError, NotImplementedError):
        print(f"[Assets] Copying {iso_path} to {target} (Range requests enabled)...")
        with open(iso_path, "rb") as src, open(target, "wb") as dst:
            while chunk := src.read(8 * 1024 * 1024):
                dst.write(chunk)
        print(f"[Assets] Copied disc.iso successfully.")

def main():
    parser = argparse.ArgumentParser(description="Prepare game assets for Web deployment")
    parser.add_argument("--iso", default=DEFAULT_ISO, help="Path to input ISO")
    parser.add_argument("--out", default="port/build/web", help="Output directory for web build")
    parser.add_argument("--mode", choices=["chunks", "iso", "both"], default="both", help="Packaging mode")
    args = parser.parse_args()

    iso_path = pathlib.Path(args.iso).resolve()
    if not iso_path.is_file():
        # Check alternative locations
        alt = pathlib.Path("DBZ3_SLUS_21678.ISO").resolve()
        if alt.is_file():
            iso_path = alt
        else:
            print(f"[Error] ISO not found: {iso_path}", file=sys.stderr)
            sys.exit(1)

    out_dir = pathlib.Path(args.out).resolve()
    disc_dir = out_dir / "disc"

    if args.mode in ("chunks", "both"):
        prep_chunks(iso_path, disc_dir)
    if args.mode in ("iso", "both"):
        prep_iso_file(iso_path, out_dir)

    print("[Assets] Asset preparation complete.")

if __name__ == "__main__":
    main()
