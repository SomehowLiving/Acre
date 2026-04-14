#!/usr/bin/env python3
"""Compile acre_verification.py into TEAL and ABI artifacts."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

CONTRACT_FILE = Path(__file__).resolve().parent / "acre_verification.py"
EXPECTED_OUTPUTS = ["acre_approval.teal", "acre_clear.teal", "acre_abi.json"]


def main() -> int:
    if not CONTRACT_FILE.exists():
        print(f"Contract file not found: {CONTRACT_FILE}", file=sys.stderr)
        return 1

    cmd = [sys.executable, str(CONTRACT_FILE)]
    result = subprocess.run(cmd, cwd=CONTRACT_FILE.parent, check=False)
    if result.returncode != 0:
        return result.returncode

    missing = [name for name in EXPECTED_OUTPUTS if not (CONTRACT_FILE.parent / name).exists()]
    if missing:
        print(f"Build failed; missing outputs: {', '.join(missing)}", file=sys.stderr)
        return 1

    print("Build complete:")
    for name in EXPECTED_OUTPUTS:
        path = CONTRACT_FILE.parent / name
        print(f"- {path.name} ({path.stat().st_size} bytes)")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
