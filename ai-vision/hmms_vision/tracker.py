"""Multi-object tracking in the style of ByteTrack, written here to avoid a dependency.

Confident detections are matched to tracks first. Weak ones then rescue tracks left unmatched, which
is what holds a player through an overlap, where the detector's confidence drops.

A track number is a temporary computer vision identity and nothing more. It says this box is
probably the same person as the last one. It never says who that person is.

On a real match most tracks ended within two seconds: players cross, run behind each other, leave
the picture or simply go undetected for a moment. A new number loses everything learnt about the
player, so someone who reappears close to where a player was lost, at a similar size and in the
same kit, gets that player's number back. The kit is whatever the caller measures. Without it,
place and size alone decide.
"""

from dataclasses import dataclass

import cv2
import numpy as np

HIGH_SCORE = 0.5
MATCH_IOU = 0.2
RESCUE_IOU = 0.3
#: A new track must be seen this often before it is shown, which filters one-frame false alarms.
CONFIRM_HITS = 3
#: Frames a lost track survives. At 10 frames a second this is 1.5 seconds.
MAX_MISSES = 15
VELOCITY_SMOOTHING = 0.6
PAN_WIDTH = 320
#: How long a lost player is remembered, in frames, after the 1.5 seconds above. Longer joined the wrong people.
REMEMBER_FRAMES = 20
#: How far a lost player may have gone, in body heights: a start, and more for each frame unseen.
REVIVE_REACH = 0.6
REVIVE_REACH_PER_FRAME = 0.04
MAX_SIZE_CHANGE = 1.5
#: The furthest two kits may be apart and still be the same person, in scaled Lab colours.
MAX_LOOK_GAP = 10.0
#: Below this the two frames do not agree on a single movement, so nothing is assumed.
MIN_PAN_RESPONSE = 0.1


@dataclass
class Track:
    id: int
    box: np.ndarray
    score: float
    velocity: np.ndarray
    hits: int = 1
    misses: int = 0
    look: np.ndarray | None = None
    #: Where the player was last actually seen, and how many frames ago.
    seen_box: np.ndarray | None = None
    unseen: int = 0

    @property
    def confirmed(self) -> bool:
        return self.hits >= CONFIRM_HITS

    def predicted(self) -> np.ndarray:
        return self.box + self.velocity

    def update(self, box: np.ndarray, score: float, look: np.ndarray | None = None) -> None:
        change = (box - self.box) / (self.misses + 1)
        self.velocity = VELOCITY_SMOOTHING * self.velocity + (1 - VELOCITY_SMOOTHING) * change
        self.box = box
        self.seen_box = box
        self.unseen = 0
        self.score = score
        self.hits += 1
        self.misses = 0
        if look is not None:
            self.look = look if self.look is None else VELOCITY_SMOOTHING * self.look + (1 - VELOCITY_SMOOTHING) * look

    def revive(self, box: np.ndarray, score: float, look: np.ndarray | None) -> None:
        """Back after a gap: where they went says nothing about how fast they are moving now."""
        self.velocity = np.zeros(4, np.float32)
        self.misses = 0
        self.box = box
        self.update(box, score, look)

    def revival_cost(self, box: np.ndarray, look: np.ndarray | None) -> float | None:
        """How unlikely this box is to be this player, or None if it cannot be them."""
        last = self.seen_box if self.seen_box is not None else self.box
        height, other = float(last[3] - last[1]), float(box[3] - box[1])
        if height <= 0 or other <= 0 or max(height / other, other / height) > MAX_SIZE_CHANGE:
            return None
        distance = float(np.linalg.norm((last[:2] + last[2:]) / 2 - (box[:2] + box[2:]) / 2)) / height
        if distance > REVIVE_REACH + REVIVE_REACH_PER_FRAME * self.unseen:
            return None
        if look is None or self.look is None:
            return distance
        gap = float(np.linalg.norm(self.look - look))
        return None if gap > MAX_LOOK_GAP else distance + gap / MAX_LOOK_GAP


def small_grey(image: np.ndarray) -> np.ndarray:
    height, width = image.shape[:2]
    small = cv2.resize(image, (PAN_WIDTH, max(1, round(height * PAN_WIDTH / width))), interpolation=cv2.INTER_AREA)
    return np.float32(cv2.cvtColor(small, cv2.COLOR_BGR2GRAY))


def pan_shift(previous: np.ndarray, current: np.ndarray, frame_width: int) -> tuple[float, float]:
    """How far the whole picture moved between two small_grey frames, in frame pixels."""
    (dx, dy), response = cv2.phaseCorrelate(previous, current)
    if response < MIN_PAN_RESPONSE:
        return 0.0, 0.0
    scale = frame_width / PAN_WIDTH
    return dx * scale, dy * scale


def look_at(looks: np.ndarray | None, index: int) -> np.ndarray | None:
    """One box's kit, or None when there is none or part of it could not be measured."""
    if looks is None or np.isnan(looks[index]).any():
        return None
    return looks[index]


def iou(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """Overlap between every box in a and every box in b."""
    if len(a) == 0 or len(b) == 0:
        return np.zeros((len(a), len(b)))
    top_left = np.maximum(a[:, None, :2], b[None, :, :2])
    bottom_right = np.minimum(a[:, None, 2:], b[None, :, 2:])
    overlap = np.clip(bottom_right - top_left, 0, None).prod(2)
    area_a = (a[:, 2:] - a[:, :2]).prod(1)
    area_b = (b[:, 2:] - b[:, :2]).prod(1)
    return overlap / np.maximum(area_a[:, None] + area_b[None, :] - overlap, 1e-6)


def match(tracks: list[Track], boxes: np.ndarray, threshold: float) -> tuple[list[tuple[int, int]], list[int], list[int]]:
    """Pair tracks and boxes, best overlap first. Greedy is enough for about twenty players."""
    predicted = np.array([t.predicted() for t in tracks]) if tracks else np.zeros((0, 4))
    scores = iou(predicted, boxes)
    pairs: list[tuple[int, int]] = []
    free_tracks, free_boxes = set(range(len(tracks))), set(range(len(boxes)))
    for index in np.argsort(-scores, axis=None):
        t, b = np.unravel_index(index, scores.shape)
        if scores[t, b] < threshold:
            break
        if t in free_tracks and b in free_boxes:
            pairs.append((int(t), int(b)))
            free_tracks.discard(t)
            free_boxes.discard(b)
    return pairs, sorted(int(t) for t in free_tracks), sorted(int(b) for b in free_boxes)


class Tracker:
    def __init__(self) -> None:
        self.tracks: list[Track] = []
        #: Confirmed players gone for longer than a brief gap.
        self.lost: list[Track] = []
        self.next_id = 1

    def update(self, boxes: np.ndarray, scores: np.ndarray, shift: tuple[float, float] = (0.0, 0.0), looks: np.ndarray | None = None) -> list[Track]:
        """shift is how far the whole picture moved, so a panning camera does not lose everyone.

        looks holds one kit measurement per box, used to tell people apart when reconnecting.
        """
        moved = np.array([shift[0], shift[1], shift[0], shift[1]], np.float32)
        for track in self.tracks + self.lost:
            track.box = track.box + moved
            if track.seen_box is not None:
                track.seen_box = track.seen_box + moved
        strong = scores >= HIGH_SCORE
        strong_boxes, strong_scores = boxes[strong], scores[strong]
        weak_boxes, weak_scores = boxes[~strong], scores[~strong]
        strong_looks = looks[strong] if looks is not None else None
        weak_looks = looks[~strong] if looks is not None else None

        pairs, unmatched, new = match(self.tracks, strong_boxes, MATCH_IOU)
        for t, b in pairs:
            self.tracks[t].update(strong_boxes[b], float(strong_scores[b]), look_at(strong_looks, b))

        waiting = [self.tracks[i] for i in unmatched]
        rescued, still_lost, _ = match(waiting, weak_boxes, RESCUE_IOU)
        for t, b in rescued:
            waiting[t].update(weak_boxes[b], float(weak_scores[b]), look_at(weak_looks, b))

        for i in still_lost:
            waiting[i].misses += 1
            waiting[i].unseen += 1
            waiting[i].box = waiting[i].predicted()
        for track in self.lost:
            track.unseen += 1

        missing = [waiting[i] for i in still_lost if waiting[i].confirmed]
        for b in self.reconnect(missing, strong_boxes, strong_scores, strong_looks, new):
            self.tracks.append(Track(self.next_id, strong_boxes[b], float(strong_scores[b]), np.zeros(4, np.float32), look=look_at(strong_looks, b), seen_box=strong_boxes[b]))
            self.next_id += 1

        gone = [t for t in self.tracks if t.misses > MAX_MISSES and t.confirmed]
        self.lost = [t for t in self.lost + gone if t.unseen <= REMEMBER_FRAMES + MAX_MISSES]
        self.tracks = [t for t in self.tracks if t.misses <= MAX_MISSES and (t.confirmed or t.misses == 0)]
        return [t for t in self.tracks if t.confirmed and t.misses == 0]

    def reconnect(self, missing: list[Track], boxes: np.ndarray, scores: np.ndarray, looks: np.ndarray | None, new: list[int]) -> list[int]:
        """Gives players who are missing or lost their number back. Returns the boxes nobody claimed."""
        candidates = missing + self.lost
        options = []
        for b in new:
            for c, track in enumerate(candidates):
                cost = track.revival_cost(boxes[b], look_at(looks, b))
                if cost is not None:
                    options.append((cost, c, b))
        taken_tracks: set[int] = set()
        taken_boxes: set[int] = set()
        for _cost, c, b in sorted(options):
            if c in taken_tracks or b in taken_boxes:
                continue
            taken_tracks.add(c)
            taken_boxes.add(b)
            track = candidates[c]
            track.revive(boxes[b], float(scores[b]), look_at(looks, b))
            if track in self.lost:
                self.lost.remove(track)
                self.tracks.append(track)
        return [b for b in new if b not in taken_boxes]
