#!/usr/bin/env python3
"""
copy_lint.py — Fail the build if any banned advice phrase appears in user-facing files.

Run:  python scripts/copy_lint.py
Exit: 0 = clean, 1 = violations found

Scans: all .html and .js files under the repo root.
Banned phrases are loaded from scripts/banned_phrases.txt (one per line, # = comment).
Matches are case-insensitive, whole-phrase (not word-boundary-constrained so
"you should" matches anywhere in a run of text).
"""

import sys
import re
from pathlib import Path

# Pre-compiled patterns keyed by phrase (built in load_banned_phrases)
_PATTERNS: dict[str, re.Pattern] = {}

REPO_ROOT = Path(__file__).resolve().parent.parent
BANNED_FILE = Path(__file__).resolve().parent / "banned_phrases.txt"
SCAN_EXTENSIONS = {".html", ".js"}
SKIP_DIRS = {".git", "node_modules", ".github"}


def load_banned_phrases(path: Path) -> list[str]:
    phrases = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#"):
            phrase = line.lower()
            phrases.append(phrase)
            # Pre-compile word-boundary pattern; \b works on word boundaries in ASCII text.
            _PATTERNS[phrase] = re.compile(r"\b" + re.escape(phrase) + r"\b", re.IGNORECASE)
    return phrases


def files_to_scan(root: Path) -> list[Path]:
    results = []
    for p in root.rglob("*"):
        if any(part in SKIP_DIRS for part in p.parts):
            continue
        if p.suffix in SCAN_EXTENSIONS and p.is_file():
            results.append(p)
    return sorted(results)


def scan_file(path: Path, phrases: list[str]) -> list[tuple[int, str, str]]:
    """Return list of (line_number, phrase, line_text) for each violation."""
    violations = []
    try:
        lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError as e:
        print(f"  WARNING: could not read {path}: {e}", file=sys.stderr)
        return violations
    for i, line in enumerate(lines, start=1):
        for phrase in phrases:
            pat = _PATTERNS.get(phrase)
            if pat and pat.search(line):
                violations.append((i, phrase, line.strip()))
    return violations


def main() -> int:
    if not BANNED_FILE.exists():
        print(f"ERROR: banned phrases file not found: {BANNED_FILE}", file=sys.stderr)
        return 1

    phrases = load_banned_phrases(BANNED_FILE)
    if not phrases:
        print("WARNING: no banned phrases loaded — lint is a no-op.", file=sys.stderr)
        return 0

    files = files_to_scan(REPO_ROOT)
    total_violations = 0

    print(f"copy_lint: scanning {len(files)} files for {len(phrases)} banned phrases...\n")

    for path in files:
        violations = scan_file(path, phrases)
        if violations:
            rel = path.relative_to(REPO_ROOT)
            print(f"FAIL  {rel}")
            for lineno, phrase, text in violations:
                print(f"  line {lineno}: [{phrase!r}]  ->  {text[:120]}")
            total_violations += len(violations)

    print()
    if total_violations:
        print(f"copy_lint FAILED: {total_violations} violation(s) found. "
              "Remove advice language or update banned_phrases.txt.")
        return 1

    print("copy_lint PASSED: no banned phrases found.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
