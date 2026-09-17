"""Apply all pending Alembic schema migrations before the API starts."""

import argparse
from pathlib import Path

from alembic import command
from alembic.config import Config


def main() -> None:
    parser = argparse.ArgumentParser(description="Manage Alembic database migrations.")
    parser.add_argument(
        "action",
        choices=("upgrade", "stamp", "current"),
        nargs="?",
        default="upgrade",
        help="Migration action to run (default: upgrade).",
    )
    parser.add_argument(
        "revision",
        nargs="?",
        default="head",
        help="Target revision (default: head).",
    )
    args = parser.parse_args()

    config_path = Path(__file__).resolve().parents[1] / "alembic.ini"
    config = Config(str(config_path))

    if args.action == "upgrade":
        command.upgrade(config, args.revision)
    elif args.action == "stamp":
        command.stamp(config, args.revision)
    else:
        command.current(config)


if __name__ == "__main__":
    main()
