import json
import logging
import platform
from collections.abc import Callable, Iterable
from typing import Any

import psutil

from . import PROTOCOL_VERSION, __version__
from .protocol import Channel

log = logging.getLogger(__name__)


class CommandError(Exception):
    """A failure the operator should read. Anything else is reported as an internal error."""


class Service:
    def __init__(self, channel: Channel) -> None:
        self.channel = channel
        self.running = True
        self.commands: dict[str, Callable[[dict], Any]] = {
            "ping": lambda _args: {"pong": True},
            "health": lambda _args: self.health(),
            "shutdown": lambda _args: self.shutdown(),
        }

    def health(self) -> dict:
        memory = psutil.virtual_memory()
        return {
            "cpuPercent": psutil.cpu_percent(interval=None),
            "memoryUsedMb": round(memory.used / 1048576),
            "memoryTotalMb": round(memory.total / 1048576),
            "serviceMemoryMb": round(psutil.Process().memory_info().rss / 1048576),
        }

    def shutdown(self) -> dict:
        self.running = False
        return {}

    def handle(self, line: str) -> None:
        try:
            message = json.loads(line)
            request_id, name, args = message["id"], message["cmd"], message.get("args") or {}
        except (ValueError, KeyError, TypeError):
            log.error("Ignored a malformed command")
            return
        try:
            command = self.commands.get(name)
            if command is None:
                raise CommandError(f"Unknown command: {name}")
            self.channel.send({"type": "reply", "id": request_id, "ok": True, "data": command(args)})
        except CommandError as err:
            self.channel.send({"type": "reply", "id": request_id, "ok": False, "error": str(err)})
        except Exception:
            log.exception("Command %s failed", name)
            self.channel.send({"type": "reply", "id": request_id, "ok": False, "error": "The vision service hit an internal error."})

    def run(self, commands: Iterable[str]) -> None:
        self.channel.send({"type": "hello", "protocol": PROTOCOL_VERSION, "version": __version__, "python": platform.python_version()})
        for line in commands:
            if line.strip():
                self.handle(line)
            if not self.running:
                return
