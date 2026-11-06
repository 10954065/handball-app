"""Camera input. Each camera has one thread and one slot holding its newest frame.

Nothing queues: a frame nobody took is overwritten, so a slow consumer costs dropped frames and
never memory. Sources can hold passwords, so they never appear in a log or in a message.
"""

import logging
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

import cv2
import numpy as np

log = logging.getLogger(__name__)

KINDS = ("usb", "network", "file")
MAX_RECONNECT_DELAY_S = 10.0
FAILED_READS_BEFORE_RECONNECT = 5
NETWORK_OPEN_TIMEOUT_MS = 8000
NETWORK_READ_TIMEOUT_MS = 5000
FPS_WINDOW_S = 2.0


@dataclass(frozen=True)
class CameraSpec:
    id: str
    kind: str
    source: str | int
    width: int | None = None
    height: int | None = None
    fps: int | None = None


@dataclass(frozen=True)
class Frame:
    image: np.ndarray
    seq: int
    captured_at: float


def open_capture(spec: CameraSpec) -> Any:
    if spec.kind == "usb":
        capture = cv2.VideoCapture(int(spec.source), cv2.CAP_DSHOW)
    elif spec.kind == "network":
        timeouts = [cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, NETWORK_OPEN_TIMEOUT_MS, cv2.CAP_PROP_READ_TIMEOUT_MSEC, NETWORK_READ_TIMEOUT_MS]
        capture = cv2.VideoCapture(str(spec.source), cv2.CAP_FFMPEG, timeouts)
    else:
        capture = cv2.VideoCapture(str(spec.source))
    if spec.width:
        capture.set(cv2.CAP_PROP_FRAME_WIDTH, spec.width)
    if spec.height:
        capture.set(cv2.CAP_PROP_FRAME_HEIGHT, spec.height)
    if spec.fps:
        capture.set(cv2.CAP_PROP_FPS, spec.fps)
    capture.set(cv2.CAP_PROP_BUFFERSIZE, 1)
    return capture


class CameraWorker:
    """Reads one camera until stopped, reconnecting when it can. States go to on_state."""

    def __init__(self, spec: CameraSpec, on_state: Callable[[str, str, dict[str, Any], str | None], None], opener: Callable[[CameraSpec], Any] = open_capture) -> None:
        self.spec = spec
        self._on_state = on_state
        self._open = opener
        self._stop = threading.Event()
        self._slot_lock = threading.Lock()
        self._frame: Frame | None = None
        self._seq = 0
        self._times: list[float] = []
        self._thread = threading.Thread(target=self._run, name=f"camera-{spec.id}", daemon=True)

    def start(self) -> None:
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        # A network read can block for its whole timeout, and the thread is a daemon either way.
        self._thread.join(timeout=2.0)

    def latest(self) -> Frame | None:
        with self._slot_lock:
            return self._frame

    def input_fps(self) -> float:
        with self._slot_lock:
            times = list(self._times)
        return round((len(times) - 1) / (times[-1] - times[0]), 1) if len(times) > 1 and times[-1] > times[0] else 0.0

    def _state(self, state: str, details: dict[str, Any] | None = None, message: str | None = None) -> None:
        self._on_state(self.spec.id, state, details or {}, message)

    def _store(self, image: np.ndarray) -> None:
        now = time.monotonic()
        with self._slot_lock:
            self._seq += 1
            self._frame = Frame(image, self._seq, now)
            self._times = [t for t in self._times if now - t < FPS_WINDOW_S] + [now]

    def _run(self) -> None:
        delay = 1.0
        first = True
        while not self._stop.is_set():
            self._state("connecting" if first else "reconnecting")
            first = False
            capture = self._open_safely()
            if capture is None:
                self._state("reconnecting", message=self._unreachable())
            else:
                delay = 1.0
                try:
                    outcome = self._read_until_lost(capture)
                finally:
                    capture.release()
                if outcome == "ended":
                    self._state("ended")
                    return
            if self.spec.kind == "file":
                self._state("failed", message="This video file cannot be read.")
                return
            if self._stop.wait(delay):
                break
            delay = min(delay * 2, MAX_RECONNECT_DELAY_S)
        self._state("closed")

    def _open_safely(self) -> Any:
        try:
            capture = self._open(self.spec)
        except Exception:
            log.exception("Could not open camera %s", self.spec.id)
            return None
        if capture.isOpened():
            return capture
        capture.release()
        return None

    def _unreachable(self) -> str:
        if self.spec.kind == "usb":
            return "The camera is not responding. Check it is connected and not in use by another program."
        return "The camera cannot be reached. Check the address, and that it is on the same network."

    def _read_until_lost(self, capture: Any) -> str:
        pace = self._file_pace(capture)
        failed = 0
        announced = False
        next_due = time.monotonic()
        while not self._stop.is_set():
            ok, image = capture.read()
            if not ok or image is None:
                if self.spec.kind == "file":
                    return "ended"
                failed += 1
                if failed >= FAILED_READS_BEFORE_RECONNECT:
                    self._state("reconnecting", message="The camera stopped sending pictures. Trying to reconnect.")
                    return "lost"
                continue
            failed = 0
            self._store(image)
            if not announced:
                announced = True
                self._state("live", {"width": int(image.shape[1]), "height": int(image.shape[0])})
            if pace:
                next_due += pace
                if self._stop.wait(max(0.0, next_due - time.monotonic())):
                    break
        return "stopped"

    def _file_pace(self, capture: Any) -> float:
        """A file plays at its own speed, as a camera would deliver it."""
        if self.spec.kind != "file":
            return 0.0
        fps = capture.get(cv2.CAP_PROP_FPS)
        return 1.0 / fps if fps and fps > 0 else 1.0 / 25


def discover_usb() -> list[dict[str, Any]]:
    """Cameras Windows knows about, in the order VideoCapture numbers them."""
    from pygrabber.dshow_graph import FilterGraph

    return [{"index": index, "name": name} for index, name in enumerate(FilterGraph().get_input_devices())]
