"""Decides what a ball flight might have been, using the goal areas an operator marked by hand.

This produces suggestions and never decides anything. A flight ending inside a goal area is a
possible goal. One ending close to a goal, or heading into one, is a possible shot: the official
says how it ended. Saves are not suggested yet, because telling a save from a miss needs footage
to tune against, and a guess here would only waste the official's attention.
"""

from dataclasses import dataclass

from .ball import Flight, Point

#: How far outside a goal area a flight may end and still count as aimed at it, as a frame fraction.
NEAR_GOAL = 0.08
BASE_CONFIDENCE = 0.45
CONFIDENCE_PER_POINT = 0.03
MAX_CONFIDENCE = 0.85

Zone = tuple[float, float, float, float]


@dataclass(frozen=True)
class GoalAreas:
    left: Zone | None
    right: Zone | None
    #: The team defending the left goal, which scores at the other end. Swaps at half time.
    left_defended_by: str

    def attacker_at(self, end: str) -> str:
        defender = self.left_defended_by if end == "left" else ("away" if self.left_defended_by == "home" else "home")
        return "away" if defender == "home" else "home"


@dataclass(frozen=True)
class Call:
    category: str
    side: str
    confidence: float
    last: Point


def inside(point: Point, zone: Zone, margin: float = 0.0) -> bool:
    x1, y1, x2, y2 = zone
    return x1 - margin <= point.x <= x2 + margin and y1 - margin <= point.y <= y2 + margin


def heading_towards(flight: Flight, zone: Zone) -> bool:
    centre_x = (zone[0] + zone[2]) / 2
    start, end = flight.points[0], flight.last
    return abs(end.x - centre_x) < abs(start.x - centre_x)


def judge(flight: Flight, goals: GoalAreas) -> Call | None:
    """A flight is judged once, when it ends. A flight near no goal says nothing about the match."""
    confidence = min(MAX_CONFIDENCE, BASE_CONFIDENCE + CONFIDENCE_PER_POINT * len(flight.points)) * flight.straightness()
    for end, zone in (("left", goals.left), ("right", goals.right)):
        if zone is None or not heading_towards(flight, zone):
            continue
        if inside(flight.last, zone):
            return Call("goal", goals.attacker_at(end), round(confidence, 2), flight.last)
        if inside(flight.last, zone, NEAR_GOAL):
            return Call("shot", goals.attacker_at(end), round(confidence * 0.8, 2), flight.last)
    return None
