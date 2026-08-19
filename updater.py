#!/usr/bin/env python3
"""DeveloperHCR controlled updater.

Usage:
  python updater.py --apply <validated-zip>

The updater works relative to this file's project directory, backs up source
files, preserves data/settings, validates archive paths, then overlays the
release. It never executes arbitrary archive commands.
"""
from __future__ import annotations
import argparse, shutil, tempfile, zipfile, os
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
BACKUPS = DATA / "backups"

def safe_members(z: zipfile.ZipFile):
    bad=[]
    for name in z.namelist():
        p=Path(name)
        if p.is_absolute() or ".." in p.parts:
            bad.append(name)
    if bad:
        raise ValueError("unsafe archive paths: " + ", ".join(bad[:5]))

def source_root(temp: Path):
    candidate=temp/"DeveloperHCR"
    return candidate if candidate.is_dir() else temp

def backup():
    stamp=datetime.now().strftime("%Y%m%d_%H%M%S")
    dest=BACKUPS/f"update_{stamp}"
    dest.mkdir(parents=True, exist_ok=True)
    for item in ROOT.iterdir():
        if item.name in {"data","__pycache__",".pytest_cache"}:
            continue
        target=dest/item.name
        if item.is_dir():
            shutil.copytree(item,target,dirs_exist_ok=True,ignore=shutil.ignore_patterns("__pycache__",".pytest_cache"))
        else:
            shutil.copy2(item,target)
    return dest

def apply_archive(archive: Path):
    if not archive.exists():
        raise FileNotFoundError(archive)
    with zipfile.ZipFile(archive) as z:
        safe_members(z)
        with tempfile.TemporaryDirectory(prefix="hcr_update_") as td:
            tmp=Path(td)
            z.extractall(tmp)
            src=source_root(tmp)
            backup_path=backup()
            # Never overwrite runtime data, credentials, settings, models or logs.
            ignored={"data","__pycache__",".pytest_cache"}
            for item in src.iterdir():
                if item.name in ignored:
                    continue
                dest=ROOT/item.name
                if item.is_dir():
                    shutil.copytree(item,dest,dirs_exist_ok=True,
                                    ignore=shutil.ignore_patterns("__pycache__",".pytest_cache"))
                else:
                    shutil.copy2(item,dest)
    return backup_path

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--apply", required=True, help="validated update ZIP")
    args=ap.parse_args()
    print("DeveloperHCR controlled updater")
    print("Project:", ROOT)
    print("Archive:", args.apply)
    backup_path=apply_archive(Path(args.apply).expanduser().resolve())
    print("Update applied.")
    print("Backup:", backup_path)
    print("Restart DeveloperHCR to load the new version.")
    return 0

if __name__=="__main__":
    raise SystemExit(main())
