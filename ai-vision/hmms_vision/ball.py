"""Finds a thrown ball from motion, without a trained model.

A handball in a wide shot is about ten pixels across, too small and blurred for a general detector.
A thrown ball does have something a limb does not: it is small, fast, and moves in a straight line.
So this looks for exactly that across consecutive frames.

This is a stand-in until a model is trained on handball footage, and its accuracy on real matches
has not been measured. It reports candidates for an official to check, and nothing more.
Positions are fractions of the frame, so they do not depend on the camera's resolution.
"""

import math
from dataclasses import dataclass, field
from typing import NamedTuple

import cv2
import numpy as np

WORK_WIDTH = 960
MOTION_THRESHOLD = 25
#: In pixels at WORK_WIDTH. Smaller is noise, larger is a person.
MIN_AREA, MAX_AREA = 6, 500
MAX_ELONGATION = 4.0
#: How far a ball may stray from where it was heading, as a fraction of the frame width.
GATE = 0.05
#: A straight throw needs this many sightings, covering at least this much of the frame a second.
MIN_POINTS = 4
MIN_SPEED = 0.25
MIN_STRAIGHTNESS = 0.9
#: With no sighting for this long, the flight is over.
END_GAP_S = 0.25


class Point(NamedTuple):
    t: float
    x: float
    y: float


class MotionFinder:
    """Small moving blobs, from three consecutive frames.

    Two frames show a moving ball twice, where it was and where it is. What changed in both pairs of
    three frames is only the middle position, so each ball gives one sighting, one frame late.
    """

    def __init__(self) -> None:
        self.frames: list[np.ndarray] = []

    def find(self, image: np.ndarray, ignore: list[tuple[float, float, float, float]] | None = None) -> list[tuple[float, float]]:
        height, width = image.shape[:2]
        scale = WORK_WIDTH / width
        small = cv2.resize(image, (WORK_WIDTH, round(height * scale)), interpolation=cv2.INTER_AREA) if width != WORK_WIDTH else image
        grey = cv2.GaussianBlur(cv2.cvtColor(small, cv2.COLOR_BGR2GRAY), (3, 3), 0)
        if self.frames and self.frames[-1].shape != grey.shape:
            self.frames = []
        self.frames = [*self.frames[-2:], grey]
        if len(self.frames) < 3:
            return []
        first, middle, last = self.frames
        _, before = cv2.threshold(cv2.absdiff(first, middle), MOTION_THRESHOLD, 255, cv2.THRESH_BINARY)
        _, after = cv2.threshold(cv2.absdiff(middle, last), MOTION_THRESHOLD, 255, cv2.THRESH_BINARY)
        moving = cv2.bitwise_and(before, after)
        count, _, stats, centres = cv2.connectedComponentsWithStats(moving, connectivity=8)
        found = []
        for label in range(1, count):
            area = stats[label, cv2.CC_STAT_AREA]
            w, h = stats[label, cv2.CC_STAT_WIDTH], stats[label, cv2.CC_STAT_HEIGHT]
            if not MIN_AREA <= area <= MAX_AREA or max(w, h) > MAX_ELONGATION * max(min(w, h), 1):
                continue
            x, y = centres[label][0] / grey.shape[1], centres[label][1] / grey.shape[0]
            if not any(a <= x <= c and b <= y <= d for a, b, c, d in ignore or []):
                found.append((float(x), float(y)))
        return found


@dataclass
class Flight:
    id: int
    points: list[Point] = field(default_factory=list)

    @property
    def last(self) -> Point:
        return self.points[-1]

    def predicted(self, t: float) -> tuple[float, float]:
        if len(self.points) < 2:
            return self.last.x, self.last.y
        a, b = self.points[-2], self.points[-1]
        dt = max(b.t - a.t, 1e-3)
        return b.x + (b.x - a.x) / dt * (t - b.t), b.y + (b.y - a.y) / dt * (t - b.t)

    def length(self) -> float:
        return sum(math.dist(a[1:], b[1:]) for a, b in zip(self.points, self.points[1:]))

    def speed(self) -> float:
        return self.length() / max(self.last.t - self.points[0].t, 1e-3)

    def straightness(self) -> float:
        return math.dist(self.points[0][1:], self.last[1:]) / max(self.length(), 1e-6)

    def is_throw(self) -> bool:
        return len(self.points) >= MIN_POINTS and self.speed() >= MIN_SPEED and self.straightness() >= MIN_STRAIGHTNESS


class BallTracker:
    """Joins sightings into flights. Returns each flight that has just ended and looks like a throw."""

    def __init__(self) -> None:
        self.flights: list[Flight] = []
        self.next_id = 1

    def update(self, t: float, sightings: list[tuple[float, float]]) -> list[Flight]:
        remaining = list(sightings)
        for flight in sorted(self.flights, key=lambda f: -len(f.points)):
            if not remaining:
                break
            px, py = flight.predicted(t)
            nearest = min(remaining, key=lambda s: math.dist(s, (px, py)))
            if math.dist(nearest, (px, py)) <= GATE * (1 + (len(flight.points) == 1) * 2):
                flight.points.append(Point(t, *nearest))
                remaining.remove(nearest)
        for x, y in remaining:
            self.flights.append(Flight(self.next_id, [Point(t, x, y)]))
            self.next_id += 1
        ended = [f for f in self.flights if t - f.last.t > END_GAP_S]
        self.flights = [f for f in self.flights if t - f.last.t <= END_GAP_S]
        return [f for f in ended if f.is_throw()]

    def current(self) -> Flight | None:
        """The flight most likely to be the ball right now, for the on-screen marker."""
        throws = [f for f in self.flights if f.is_throw()]
        return max(throws, key=lambda f: len(f.points), default=None)
