"""Watches one camera for thrown balls, at the camera's own speed and on the processor.

A shot crosses metres between frames at the detector's ten frames a second, so this runs separately.
It only sends what it saw, and how long ago. The main process turns that into a match time.
"""

import logging
import threading
import time
from collections.abc import Callable
from typing import Any

from .ball import BallTracker, MotionFinder
from .camera import CameraWorker
from .shots import GoalAreas, judge

log = logging.getLogger(__name__)

IDLE_WAIT_S = 0.005
MARKER_INTERVAL_S = 0.1


class BallWorker:
    def __init__(self, camera: CameraWorker, goals: GoalAreas, send: Callable[[dict[str, Any]], None], ignore: Callable[[], list]) -> None:
        self.camera = camera
        self.goals = goals
        self.send = send
        self.ignore = ignore
        self.finder = MotionFinder()
        self.tracker = BallTracker()
        self.paused = threading.Event()
        self.stopping = threading.Event()
        self.last_seq = 0
        self.last_marker = 0.0
        self.thread = threading.Thread(target=self.run, name=f"ball-{camera.spec.id}", daemon=True)

    def start(self) -> None:
        self.thread.start()

    def stop(self) -> None:
        self.stopping.set()
        self.thread.join(timeout=2.0)

    def step(self) -> bool:
        frame = self.camera.latest()
        if frame is None or frame.seq == self.last_seq or self.paused.is_set():
            return False
        self.last_seq = frame.seq
        sightings = self.finder.find(frame.image, self.ignore())
        for flight in self.tracker.update(frame.captured_at, sightings):
            call = judge(flight, self.goals)
            if call is not None:
                self.send({
                    "type": "suggestion", "category": call.category, "side": call.side, "jersey": None, "trackId": None, "confidence": call.confidence,
                    "camera": self.camera.spec.id, "ageMs": max(0, round((time.monotonic() - call.last.t) * 1000)), "evidence": {"sightings": len(flight.points), "speed": round(flight.speed(), 2)},
                })
        self.mark_ball()
        return True

    def mark_ball(self) -> None:
        now = time.monotonic()
        flight = self.tracker.current()
        if flight is not None and now - self.last_marker >= MARKER_INTERVAL_S:
            self.last_marker = now
            self.send({"type": "ball", "camera": self.camera.spec.id, "x": round(flight.last.x, 4), "y": round(flight.last.y, 4)})

    def run(self) -> None:
        try:
            while not self.stopping.is_set():
                if not self.step():
                    self.stopping.wait(IDLE_WAIT_S)
        except Exception:
            # Ball tracking stops. Player tracking, the cameras and the service carry on.
            log.exception("Ball tracking stopped on camera %s", self.camera.spec.id)
