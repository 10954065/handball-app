"""The analysis loop. One thread takes each camera's newest frame in turn.

It never queues. If inference cannot keep up, frames are skipped, which the figures report as
dropped. Nothing here knows about the match clock, the score or any official record.
"""

import logging
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

import numpy as np

from .camera import CameraWorker
from .detector import Detections
from .teams import TeamAssigner
from .tracker import Tracker

log = logging.getLogger(__name__)

STATS_WINDOW_S = 3.0


@dataclass
class CameraAnalysis:
    tracker: Tracker = field(default_factory=Tracker)
    last_seq: int = 0
    teams: TeamAssigner | None = None


class AnalysisWorker:
    def __init__(self, detect: Callable[[np.ndarray], Detections], cameras: Callable[[], list[CameraWorker]], send: Callable[[dict[str, Any]], None], rate: float, colours: dict[str, str] | None, on_error: Callable[[str], None]) -> None:
        self.detect = detect
        self.cameras = cameras
        self.send = send
        self.interval = 1.0 / rate
        self.colours = colours
        self.on_error = on_error
        self.state: dict[str, CameraAnalysis] = {}
        #: Where players are on each camera, as frame fractions, so ball tracking can skip them.
        self.boxes: dict[str, list[tuple[float, float, float, float]]] = {}
        self.paused = threading.Event()
        self.stopping = threading.Event()
        self.times: list[float] = []
        self.inference_ms = 0.0
        self.dropped = 0
        self.thread = threading.Thread(target=self.run, name="analysis", daemon=True)

    def start(self) -> None:
        self.thread.start()

    def stop(self) -> None:
        self.stopping.set()
        self.thread.join(timeout=3.0)

    def fps(self) -> float:
        times = self.times
        return round((len(times) - 1) / (times[-1] - times[0]), 1) if len(times) > 1 and times[-1] > times[0] else 0.0

    def analyse(self, worker: CameraWorker) -> None:
        frame = worker.latest()
        camera = worker.spec.id
        state = self.state.setdefault(camera, CameraAnalysis(teams=TeamAssigner(self.colours) if self.colours else None))
        if frame is None or frame.seq == state.last_seq:
            return
        if state.last_seq:
            self.dropped += max(0, frame.seq - state.last_seq - 1)
        state.last_seq = frame.seq
        started = time.monotonic()
        detections = self.detect(frame.image)
        now = time.monotonic()
        self.inference_ms = round((now - started) * 1000, 1)
        self.times = [t for t in self.times if now - t < STATS_WINDOW_S] + [now]
        height, width = frame.image.shape[:2]
        self.boxes[camera] = [(float(b[0]) / width, float(b[1]) / height, float(b[2]) / width, float(b[3]) / height) for b in detections.boxes]
        self.send({"type": "tracks", "camera": camera, "seq": frame.seq, "width": width, "height": height, "tracks": self.describe(frame.image, state, detections), "fps": self.fps(), "inferenceMs": self.inference_ms, "dropped": self.dropped})

    def describe(self, image: np.ndarray, state: CameraAnalysis, detections: Detections) -> list[dict[str, Any]]:
        tracks = state.tracker.update(detections.boxes, detections.scores)
        found = []
        for track in tracks:
            team, confidence = state.teams.observe(image, track.id, track.box) if state.teams else (None, 0.0)
            x1, y1, x2, y2 = (float(v) for v in track.box)
            found.append({"id": track.id, "x": round(x1), "y": round(y1), "w": round(x2 - x1), "h": round(y2 - y1), "score": round(track.score, 2), "team": team, "teamConfidence": confidence})
        if state.teams:
            state.teams.forget_except({t.id for t in state.tracker.tracks})
        return found

    def run(self) -> None:
        try:
            while not self.stopping.is_set():
                started = time.monotonic()
                if not self.paused.is_set():
                    for worker in self.cameras():
                        self.analyse(worker)
                self.stopping.wait(max(0.0, self.interval - (time.monotonic() - started)))
        except Exception:
            # Stops analysis, and the cameras and the service carry on.
            log.exception("Analysis stopped")
            self.on_error("Analysis stopped because of an internal error. Details are in the log folder.")
