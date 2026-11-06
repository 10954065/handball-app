"""Works out who is who from shirt colours an operator picked on the picture.

Automatic grouping was tried on real footage and failed: the smallest shirt group was not the
officials, and goalkeepers and people at the edge of the court confused it. One click per shirt is
reliable. A role is given only when a shirt matches. Shirts are not always clear, so whether an
unmatched person is shown at all is decided by the analysis, not here.
"""

from collections import Counter, deque

import cv2
import numpy as np

#: The shirt, avoiding the head, the legs and the background at the sides of the box.
TORSO_TOP, TORSO_BOTTOM, TORSO_SIDE = 0.2, 0.55, 0.25
MIN_CROP_PIXELS = 16
#: Brightness counts for less than colour: sun and shadow change it, a shirt's colour stays.
BRIGHTNESS_WEIGHT = 0.4
#: These were measured on a real match in strong sun, with yellow, dark teal and green shirts.
MIN_HUE_MATCH = 0.8
MIN_CHROMA = 2.5
MAX_BRIGHTNESS_GAP = 60.0
NEUTRAL = np.array([128.0, 128.0], np.float32)
VOTES_KEPT = 12
MIN_VOTES = 3
MIN_SHARE = 0.5
MAX_OFFICIALS = 2
#: A goalkeeper belongs to a team, in a shirt of their own.
ROLE_OF = {"a": "a", "b": "b", "official": "official", "keeperA": "a", "keeperB": "b"}


def scaled_lab(image: np.ndarray) -> np.ndarray:
    return cv2.cvtColor(image, cv2.COLOR_BGR2LAB).reshape(-1, 3).astype(np.float32) * np.array([BRIGHTNESS_WEIGHT, 1.0, 1.0], np.float32)


def hex_to_lab(colour: str) -> np.ndarray:
    value = colour.lstrip("#")
    return scaled_lab(np.array([[[int(value[4:6], 16), int(value[2:4], 16), int(value[0:2], 16)]]], np.uint8))[0]


def torso_colour(image: np.ndarray, box: np.ndarray) -> np.ndarray | None:
    x1, y1, x2, y2 = (float(v) for v in box)
    width, height = x2 - x1, y2 - y1
    left, right = int(x1 + width * TORSO_SIDE), int(x2 - width * TORSO_SIDE)
    top, bottom = int(y1 + height * TORSO_TOP), int(y1 + height * TORSO_BOTTOM)
    crop = image[max(top, 0) : max(bottom, 0), max(left, 0) : max(right, 0)]
    return np.median(scaled_lab(crop), axis=0) if crop.size >= MIN_CROP_PIXELS * 3 else None


def same_hue(colour: np.ndarray, picked: np.ndarray) -> float:
    """1 when two colours point the same way from grey. Sun and shadow change a colour's strength, not its direction."""
    a, b = colour[1:] - NEUTRAL, picked[1:] - NEUTRAL
    size = float(np.linalg.norm(a) * np.linalg.norm(b))
    if float(np.linalg.norm(a)) < MIN_CHROMA or size == 0:
        return -1.0
    return float(np.dot(a, b)) / size


class RoleAssigner:
    def __init__(self, shirts: dict[str, str]) -> None:
        self.shirts = {slot: hex_to_lab(colour) for slot, colour in shirts.items() if slot in ROLE_OF}
        self.votes: dict[int, deque[str | None]] = {}

    @property
    def active(self) -> bool:
        return bool(self.shirts)

    def matching(self, colour: np.ndarray) -> str | None:
        """The picked shirt nearest in hue, within reach in brightness, or nobody."""
        scored = [(same_hue(colour, lab), slot) for slot, lab in self.shirts.items() if abs(float(colour[0] - lab[0])) <= MAX_BRIGHTNESS_GAP]
        best = max(scored, default=(-1.0, ""))
        return ROLE_OF[best[1]] if best[0] >= MIN_HUE_MATCH else None

    def observe(self, image: np.ndarray, track_id: int, box: np.ndarray) -> None:
        if not self.active:
            return
        colour = torso_colour(image, box)
        votes = self.votes.setdefault(track_id, deque(maxlen=VOTES_KEPT))
        votes.append(self.matching(colour) if colour is not None else None)

    def role_of(self, track_id: int) -> str | None:
        votes = self.votes.get(track_id, ())
        counted = Counter(v for v in votes if v is not None)
        if not counted or len(votes) < MIN_VOTES:
            return None
        role, count = counted.most_common(1)[0]
        return role if count / len(votes) >= MIN_SHARE else None

    def assign(self, track_ids: list[int]) -> dict[int, str]:
        """Those who match a picked shirt, with at most two officials."""
        roles = {t: role for t in track_ids if (role := self.role_of(t)) is not None}
        officials = [t for t, role in roles.items() if role == "official"]
        officials.sort(key=lambda t: -self.votes[t].count("official"))
        for extra in officials[MAX_OFFICIALS:]:
            del roles[extra]
        return roles

    def forget_except(self, track_ids: set[int]) -> None:
        for track_id in set(self.votes) - track_ids:
            del self.votes[track_id]
