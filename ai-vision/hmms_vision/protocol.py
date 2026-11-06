"""Messages between HMMS and this service.

Commands arrive on stdin as one JSON object per line. Messages leave on stdout as frames: two
little-endian uint32 lengths, then a JSON header, then an optional binary payload such as a JPEG.

Nothing here opens a network port, so no other program or computer can reach the service. When
HMMS closes, stdin ends and the service exits with it.
"""

import json
import struct
import threading
from typing import BinaryIO

_LENGTHS = struct.Struct("<II")


class Channel:
    """Writes frames. Capture and inference threads share it, so each frame is written whole."""

    def __init__(self, stream: BinaryIO) -> None:
        self._stream = stream
        self._lock = threading.Lock()

    def send(self, header: dict, payload: bytes = b"") -> None:
        body = json.dumps(header, separators=(",", ":")).encode("utf8")
        with self._lock:
            self._stream.write(_LENGTHS.pack(len(body), len(payload)))
            self._stream.write(body)
            if payload:
                self._stream.write(payload)
            self._stream.flush()


def read_frame(stream: BinaryIO) -> tuple[dict, bytes] | None:
    """Read one frame. Returns None at the end of the stream."""
    lengths = stream.read(_LENGTHS.size)
    if len(lengths) < _LENGTHS.size:
        return None
    header_size, payload_size = _LENGTHS.unpack(lengths)
    return json.loads(stream.read(header_size)), stream.read(payload_size)
