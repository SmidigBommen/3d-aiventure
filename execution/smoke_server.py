#!/usr/bin/env python3
"""The game server as the browser smoke test starts it: web.app with d20 rolls that can be set from outside.

    uv run python execution/smoke_server.py --port 8123        (AIVENTURE_DATA must name the data folder)

While `$AIVENTURE_DATA/d20.txt` exists and holds numbers (separated by blanks), every d20 roll takes
the first of them and removes it from the file; with the file missing or empty the dice roll as
always. This is how the smoke test gets a success, a failure and a fight out of an event without a
switch in the game: nothing under web/, engine/ or client/ knows about the file.
"""

import argparse
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import uvicorn  # noqa: E402

from dice import Dice  # noqa: E402


def fix_d20(queue: Path) -> None:
    """Make Dice.roll_d20 take its rolls from `queue` for as long as that file holds any."""
    rolled = Dice.roll_d20

    def roll_d20() -> int:
        try:
            numbers = queue.read_text(encoding="utf-8").split()
        except OSError:
            numbers = []
        if not numbers:
            return rolled()
        queue.write_text(" ".join(numbers[1:]), encoding="utf-8")
        return int(numbers[0])

    Dice.roll_d20 = staticmethod(roll_d20)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--host", default="127.0.0.1")
    args = parser.parse_args()
    data = os.environ.get("AIVENTURE_DATA")
    if not data:
        parser.error("AIVENTURE_DATA is not set: the smoke server needs a data folder of its own")
    fix_d20(Path(data) / "d20.txt")
    from web.app import app
    uvicorn.run(app, host=args.host, port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
