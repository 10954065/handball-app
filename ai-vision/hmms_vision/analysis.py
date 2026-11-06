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
from .court import FRAME_EDGE, court_mask, on_court
from .numbers import NumberVotes, NumberWorker
from .roles import RoleAssigner
from .tracker import Tracker, pan_shift, small_grey

log = logging.getLogger(__name__)

STATS_WINDOW_S = 3.0
#: Officials have no number to read.
TEAM_SIDES = ("a", "b")


@dataclass
class CameraAnalysis:
    tracker: Tracker = field(default_factory=Tracker)
    last_seq: int = 0
    roles: RoleAssigner | None = None
    previous: np.ndarray | None = None
    votes: NumberVotes = field(default_factory=NumberVotes)


class AnalysisWorker:
    def __init__(self, detect: Callable[[np.ndarray], Detections], cameras: Callable[[], list[CameraWorker]], send: Callable[[dict[str, Any]], None], rate: float, shirts: dict[str, str] | None, on_error: Callable[[str], None], numbers: NumberWorker | None = None) -> None:
        self.detect = detect
        self.cameras = cameras
        self.send = send
        self.interval = 1.0 / rate
        self.shirts = shirts or {}
        self.on_error = on_error
        self.numbers = numbers
        self.state: dict[str, CameraAnalysis] = {}
        self.paused = threading.Event()
        self.stopping = threading.Event()
        self.times: list[float] = []
        self.inference_ms = 0.0
        self.dropped = 0
        self.thread = threading.Thread(target=self.run, name="analysis", daemon=True)

    def start(self) -> None:
        if self.numbers is not None:
            self.numbers.start()
        self.thread.start()

    def stop(self) -> None:
        self.stopping.set()
        self.thread.join(timeout=3.0)
        if self.numbers is not None:
            self.numbers.stop()

    def fps(self) -> float:
        times = self.times
        return round((len(times) - 1) / (times[-1] - times[0]), 1) if len(times) > 1 and times[-1] > times[0] else 0.0

    def analyse(self, worker: CameraWorker) -> None:
        frame = worker.latest()
        camera = worker.spec.id
        state = self.state.setdefault(camera, CameraAnalysis(roles=RoleAssigner(self.shirts)))
        if frame is None or frame.seq == state.last_seq:
            return
        if state.last_seq:
            self.dropped += max(0, frame.seq - state.last_seq - 1)
        state.last_seq = frame.seq
        started = time.monotonic()
        detections = self.on_the_court(frame.image, self.detect(frame.image))
        now = time.monotonic()
        self.inference_ms = round((now - started) * 1000, 1)
        self.times = [t for t in self.times if now - t < STATS_WINDOW_S] + [now]
        height, width = frame.image.shape[:2]
        self.send({"type": "tracks", "camera": camera, "seq": frame.seq, "width": width, "height": height, "tracks": self.describe(frame.image, state, detections), "fps": self.fps(), "inferenceMs": self.inference_ms, "dropped": self.dropped})

    def set_shirts(self, shirts: dict[str, str]) -> None:
        """Takes effect at once. Tracks keep their numbers and their roles are worked out afresh."""
        self.shirts = shirts
        for state in self.state.values():
            state.roles = RoleAssigner(shirts)

    def set_numbers(self, numbers: NumberWorker | None) -> None:
        """Takes effect at once. Numbers read against the last sheet mean nothing against this one."""
        if self.numbers is not None:
            self.numbers.stop()
        self.numbers = numbers
        if numbers is not None:
            numbers.start()
        for state in self.state.values():
            state.votes = NumberVotes()

    def name_players(self, image: np.ndarray, state: CameraAnalysis, tracks: list[Any], assigned: dict[int, str]) -> dict[int, int]:
        numbers = self.numbers
        if numbers is None:
            return {}
        sides = {t.id: assigned[t.id] for t in tracks if assigned.get(t.id) in TEAM_SIDES}
        numbers.offer(state.votes, image, [(t.id, sides[t.id], t.box.copy()) for t in tracks if t.id in sides])
        state.votes.forget_except({t.id for t in state.tracker.tracks})
        return state.votes.assign(sides)

    @staticmethod
    def on_the_court(image: np.ndarray, detections: Detections) -> Detections:
        height, width = image.shape[:2]
        mask = court_mask(image)
        keep = np.array([on_court(mask, height, width, box) for box in detections.boxes], bool)
        # Nobody on it means this is not a court at all. Losing real players is the worse mistake.
        return Detections(detections.boxes[keep], detections.scores[keep]) if keep.any() else detections

    def describe(self, image: np.ndarray, state: CameraAnalysis, detections: Detections) -> list[dict[str, Any]]:
        grey = small_grey(image)
        shift = pan_shift(state.previous, grey, image.shape[1]) if state.previous is not None and state.previous.shape == grey.shape else (0.0, 0.0)
        state.previous = grey
        tracks = state.tracker.update(detections.boxes, detections.scores, shift)
        roles = state.roles
        for track in tracks:
            roles.observe(image, track.id, track.box)
        assigned = roles.assign([t.id for t in tracks])
        roles.forget_except({t.id for t in state.tracker.tracks})
        named = self.name_players(image, state, tracks, assigned)
        found = []
        for track in tracks:
            x1, y1, x2, y2 = (float(v) for v in track.box)
            # Hiding a real player is the worse mistake, so an unmatched shirt only hides someone
            # whose feet are out of view: there, the court cannot vouch for them.
            if roles.active and track.id not in assigned and y2 >= image.shape[0] * FRAME_EDGE:
                continue
            found.append({"id": track.id, "x": round(x1), "y": round(y1), "w": round(x2 - x1), "h": round(y2 - y1), "score": round(track.score, 2), "role": assigned.get(track.id), "number": named.get(track.id)})
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
