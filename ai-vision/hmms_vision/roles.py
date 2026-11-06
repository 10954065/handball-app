"""Works out who is who from shirt colours an operator picked on the picture.

Automatic grouping was tried on real footage and failed: the smallest shirt group was not the
officials, and goalkeepers and people at the edge of the court confused it. One click per shirt is
reliable. A role is given only when a shirt matches. Shirts are not always clear, so whether an
unmatched person is shown at all is decided by the analysis, not here.

Two teams can wear the same shirts, as Fire and Air Force did in black, with only their shorts
different. Shorts can be picked too, and then they decide the team. An official or a goalkeeper
still goes by their own shirt.
"""

from collections import Counter, deque

import cv2
import numpy as np

#: The shirt, avoiding the head, the legs and the background at the sides of the box.
TORSO_TOP, TORSO_BOTTOM, TORSO_SIDE = 0.2, 0.55, 0.25
#: Between the hem of the shirt and the knees, and narrow enough to miss the gap between the legs.
SHORTS_TOP, SHORTS_BOTTOM, SHORTS_SIDE = 0.5, 0.72, 0.3
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
#: Below this a pixel counts as black, grey or white, which have no hue to compare.
#: Measured on a real match: black shorts stayed under it and dark red ones were well over.
MIN_SHORTS_CHROMA = 10.0
#: Coloured shorts win when this share of the area shows them, because legs and shadow fill the rest.
MIN_COLOURED_SHARE = 0.2
#: Below this share there is no trace of the coloured shorts, so the plain ones can be trusted.
NO_COLOUR_SHARE = 0.05
MIN_PLAIN_SHARE = 0.5
#: Plain shorts have only their brightness, so it must be close: black is not grey or white.
MAX_PLAIN_GAP = 16.0
#: Scales the coloured share of the shorts so it counts about as much as a change of shirt colour.
LOOK_SHORTS_WEIGHT = 40.0
#: A goalkeeper belongs to a team, in a shirt of their own.
ROLE_OF = {"a": "a", "b": "b", "official": "official", "keeperA": "a", "keeperB": "b"}
SHORTS_OF = {"shortsA": "a", "shortsB": "b"}
#: Shirts that say who someone is whatever their team's shorts look like.
OWN_SHIRTS = ("official", "keeperA", "keeperB")
SLOTS = (*ROLE_OF, *SHORTS_OF)


def scaled_lab(image: np.ndarray) -> np.ndarray:
    return cv2.cvtColor(image, cv2.COLOR_BGR2LAB).reshape(-1, 3).astype(np.float32) * np.array([BRIGHTNESS_WEIGHT, 1.0, 1.0], np.float32)


def hex_to_lab(colour: str) -> np.ndarray:
    value = colour.lstrip("#")
    return scaled_lab(np.array([[[int(value[4:6], 16), int(value[2:4], 16), int(value[0:2], 16)]]], np.uint8))[0]


def body_colour(image: np.ndarray, box: np.ndarray, top: float, bottom: float, side: float) -> np.ndarray | None:
    x1, y1, x2, y2 = (float(v) for v in box)
    width, height = x2 - x1, y2 - y1
    left, right = int(x1 + width * side), int(x2 - width * side)
    upper, lower = int(y1 + height * top), int(y1 + height * bottom)
    crop = image[max(upper, 0) : max(lower, 0), max(left, 0) : max(right, 0)]
    return np.median(scaled_lab(crop), axis=0) if crop.size >= MIN_CROP_PIXELS * 3 else None


def torso_colour(image: np.ndarray, box: np.ndarray) -> np.ndarray | None:
    return body_colour(image, box, TORSO_TOP, TORSO_BOTTOM, TORSO_SIDE)


def kit_look(image: np.ndarray, box: np.ndarray) -> np.ndarray:
    """The shirt's colour and how much of the shorts area is coloured, to tell one person from another.

    The middle colour of the shorts area is no use: legs and shadow turn red shorts dark. How much of
    it is coloured does separate red shorts from black. NaN where the box is too small to measure.
    """
    shirt, shorts = torso_colour(image, box), shorts_pixels(image, box)
    if shirt is None or shorts is None:
        return np.full(4, np.nan, np.float32)
    coloured = float(np.mean(np.linalg.norm(shorts[:, 1:] - NEUTRAL, axis=1) >= MIN_SHORTS_CHROMA))
    return np.array([*shirt, coloured * LOOK_SHORTS_WEIGHT], np.float32)


def shorts_pixels(image: np.ndarray, box: np.ndarray) -> np.ndarray | None:
    """Every pixel around the shorts. Legs, shadow and the shirt hem fall in too, so no one colour is taken."""
    x1, y1, x2, y2 = (float(v) for v in box)
    width, height = x2 - x1, y2 - y1
    left, right = int(x1 + width * SHORTS_SIDE), int(x2 - width * SHORTS_SIDE)
    upper, lower = int(y1 + height * SHORTS_TOP), int(y1 + height * SHORTS_BOTTOM)
    crop = image[max(upper, 0) : max(lower, 0), max(left, 0) : max(right, 0)]
    return scaled_lab(crop) if crop.size >= MIN_CROP_PIXELS * 3 else None


def same_hue(colour: np.ndarray, picked: np.ndarray) -> float:
    """1 when two colours point the same way from grey. Sun and shadow change a colour's strength, not its direction."""
    a, b = colour[1:] - NEUTRAL, picked[1:] - NEUTRAL
    size = float(np.linalg.norm(a) * np.linalg.norm(b))
    if float(np.linalg.norm(a)) < MIN_CHROMA or size == 0:
        return -1.0
    return float(np.dot(a, b)) / size


def chroma(colour: np.ndarray) -> float:
    return float(np.linalg.norm(colour[1:] - NEUTRAL))


def shorts_share(pixels: np.ndarray, picked: np.ndarray) -> float:
    """The share of pixels in the picked shorts colour. Plain shorts are matched by brightness alone."""
    offsets = pixels[:, 1:] - NEUTRAL
    strength = np.linalg.norm(offsets, axis=1)
    gap = np.abs(pixels[:, 0] - picked[0])
    if chroma(picked) < MIN_SHORTS_CHROMA:
        return float(np.mean((gap <= MAX_PLAIN_GAP) & (strength < MIN_SHORTS_CHROMA)))
    near = gap <= MAX_BRIGHTNESS_GAP
    direction = picked[1:] - NEUTRAL
    hue = offsets @ direction / np.maximum(strength * float(np.linalg.norm(direction)), 1e-6)
    return float(np.mean(near & (strength >= MIN_SHORTS_CHROMA) & (hue >= MIN_HUE_MATCH)))


class RoleAssigner:
    def __init__(self, shirts: dict[str, str]) -> None:
        self.shirts = {slot: hex_to_lab(colour) for slot, colour in shirts.items() if slot in ROLE_OF}
        self.shorts = {SHORTS_OF[slot]: hex_to_lab(colour) for slot, colour in shirts.items() if slot in SHORTS_OF}
        self.votes: dict[int, deque[str | None]] = {}

    @property
    def active(self) -> bool:
        return bool(self.shirts or self.shorts)

    def shirt_matching(self, colour: np.ndarray) -> str | None:
        """The picked shirt nearest in hue, within reach in brightness, or nobody."""
        scored = [(same_hue(colour, lab), slot) for slot, lab in self.shirts.items() if abs(float(colour[0] - lab[0])) <= MAX_BRIGHTNESS_GAP]
        best = max(scored, default=(-1.0, ""))
        return best[1] if best[0] >= MIN_HUE_MATCH else None

    def team_by_shorts(self, pixels: np.ndarray) -> str | None:
        coloured = {team: shorts_share(pixels, lab) for team, lab in self.shorts.items() if chroma(lab) >= MIN_SHORTS_CHROMA}
        plain = {team: shorts_share(pixels, lab) for team, lab in self.shorts.items() if team not in coloured}
        best = max(coloured.items(), key=lambda item: item[1], default=(None, 0.0))
        if best[1] >= MIN_COLOURED_SHARE:
            return best[0]
        if best[1] > NO_COLOUR_SHARE:
            return None
        team, share = max(plain.items(), key=lambda item: item[1], default=(None, 0.0))
        return team if share >= MIN_PLAIN_SHARE else None

    def matching(self, shirt: np.ndarray | None, shorts: np.ndarray | None = None) -> str | None:
        slot = self.shirt_matching(shirt) if shirt is not None else None
        if not self.shorts or slot in OWN_SHIRTS:
            return ROLE_OF[slot] if slot else None
        return self.team_by_shorts(shorts) if shorts is not None else None

    def observe(self, image: np.ndarray, track_id: int, box: np.ndarray) -> None:
        if not self.active:
            return
        votes = self.votes.setdefault(track_id, deque(maxlen=VOTES_KEPT))
        votes.append(self.matching(torso_colour(image, box), shorts_pixels(image, box) if self.shorts else None))

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
