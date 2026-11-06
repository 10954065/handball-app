import logging
import os
import sys

from .protocol import Channel
from .service import Service


def main() -> int:
    # Anything printed by a library must not land in the middle of a frame.
    out = os.fdopen(os.dup(sys.stdout.fileno()), "wb")
    sys.stdout = sys.stderr
    logging.basicConfig(stream=sys.stderr, level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    Service(Channel(out)).run(sys.stdin)
    return 0


if __name__ == "__main__":
    sys.exit(main())
