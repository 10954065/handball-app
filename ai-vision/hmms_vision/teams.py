"""Estimates which team a tracked player is on, from the shirt colour.

HMMS supplies both teams' colours from the match. Colour alone cannot be certain: lighting shifts,
and referees and goalkeepers wear something else. So the answer is a vote over recent frames, and
when the vote is not clear the result is None rather than a guess.
"""

from collections import Counter, deque

import cv2
import numpy as np

#: The shirt, avoiding the head, the legs and the background at the sides of the box.
TORSO_TOP, TORSO_BOTTOM, TORSO_SIDE = 0.2, 0.55, 0.25
#: Further than this in Lab from both teams means neither: a referee, or a goalkeeper in a third colour.
MAX_COLOUR_DISTANCE = 45.0
#: Must be clearly nearer one team: the distance to the nearest over the distance to the other.
MAX_DISTANCE_RATIO = 0.75
VOTES_KEPT = 15
MIN_VOTES = 3
MIN_SHARE = 0.65
MIN_CROP_PIXELS = 16


def hex_to_lab(colour: str) -> np.ndarray:
    value = colour.lstrip("#")
    bgr = np.array([[[int(value[4:6], 16), int(value[2:4], 16), int(value[0:2], 16)]]], np.uint8)
    return lab_of(bgr)[0, 0]


def lab_of(image: np.ndarray) -> np.ndarray:
    """True Lab values. OpenCV's 8-bit form shifts and scales them."""
    lab = cv2.cvtColor(image, cv2.COLOR_BGR2LAB).astype(np.float32)
    lab[..., 0] *= 100 / 255
    lab[..., 1:] -= 128
    return lab


def torso_colour(image: np.ndarray, box: np.ndarray) -> np.ndarray | None:
    x1, y1, x2, y2 = box
    width, height = x2 - x1, y2 - y1
    left, right = int(x1 + width * TORSO_SIDE), int(x2 - width * TORSO_SIDE)
    top, bottom = int(y1 + height * TORSO_TOP), int(y1 + height * TORSO_BOTTOM)
    crop = image[max(top, 0) : max(bottom, 0), max(left, 0) : max(right, 0)]
    if crop.size < MIN_CROP_PIXELS * 3:
        return None
    return np.median(lab_of(crop).reshape(-1, 3), axis=0)


def nearest_team(colour: np.ndarray, teams: dict[str, np.ndarray]) -> str | None:
    distances = sorted((float(np.linalg.norm(colour - lab)), side) for side, lab in teams.items())
    if len(distances) < 2 or distances[0][0] > MAX_COLOUR_DISTANCE:
        return None
    if distances[1][0] > 0 and distances[0][0] / distances[1][0] > MAX_DISTANCE_RATIO:
        return None
    return distances[0][1]


class TeamAssigner:
    def __init__(self, colours: dict[str, str]) -> None:
        self.teams = {side: hex_to_lab(colour) for side, colour in colours.items()}
        self.votes: dict[int, deque[str | None]] = {}

    def observe(self, image: np.ndarray, track_id: int, box: np.ndarray) -> tuple[str | None, float]:
        """Add this frame's evidence. Returns the team, and the share of votes behind it."""
        colour = torso_colour(image, box)
        vote = nearest_team(colour, self.teams) if colour is not None else None
        votes = self.votes.setdefault(track_id, deque(maxlen=VOTES_KEPT))
        votes.append(vote)
        return self.verdict(votes)

    @staticmethod
    def verdict(votes: deque[str | None]) -> tuple[str | None, float]:
        counted = Counter(v for v in votes if v is not None)
        if not counted or len(votes) < MIN_VOTES:
            return None, 0.0
        side, count = counted.most_common(1)[0]
        share = count / len(votes)
        return (side, round(share, 2)) if share >= MIN_SHARE else (None, 0.0)

    def forget_except(self, track_ids: set[int]) -> None:
        for track_id in set(self.votes) - track_ids:
            del self.votes[track_id]
