"""Clears what an older checkout leaves behind where a package was removed.

Git removes the files of a deleted package but not the ignored bytecode beside them, so a folder
that was pulled from an older commit keeps e.g. web/<package>/__pycache__/. Python then imports
that empty folder as a namespace package, and the removed name seems to exist. A folder is deleted
only when nothing but bytecode caches is left in it.
"""

import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent

# Folders of Python packages that no longer exist in the repository
REMOVED_PACKAGES = ("web/" + "routes",)


def only_bytecode(folder: Path) -> bool:
    """Whether `folder` holds nothing but __pycache__ folders and compiled files."""
    for entry in folder.rglob("*"):
        if entry.is_dir():
            continue
        if entry.suffix not in (".pyc", ".pyo") or "__pycache__" not in entry.parts:
            return False
    return True


def clear_removed_packages(root: Path = ROOT) -> list:
    """Delete the leftovers of removed packages under `root`; returns the folders deleted."""
    cleared = []
    for name in REMOVED_PACKAGES:
        folder = root / name
        if folder.is_dir() and not folder.is_symlink() and only_bytecode(folder):
            shutil.rmtree(folder)
            cleared.append(folder)
    return cleared


clear_removed_packages()
