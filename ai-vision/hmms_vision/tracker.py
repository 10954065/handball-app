"""Multi-object tracking in the style of ByteTrack, written here to avoid a dependency.

Confident detections are matched to tracks first. Weak ones then rescue tracks left unmatched, which
is what holds a player through an overlap, where the detector's confidence drops.

A track number is a temporary computer vision identity and nothing more. It says this box is
probably the same person as the last one. It never says who that person is.
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

    @property
    def confirmed(self) -> bool:
        return self.hits >= CONFIRM_HITS

    def predicted(self) -> np.ndarray:
        return self.box + self.velocity

    def update(self, box: np.ndarray, score: float) -> None:
        change = (box - self.box) / (self.misses + 1)
        self.velocity = VELOCITY_SMOOTHING * self.velocity + (1 - VELOCITY_SMOOTHING) * change
        self.box = box
        self.score = score
        self.hits += 1
        self.misses = 0


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
        self.next_id = 1

    def update(self, boxes: np.ndarray, scores: np.ndarray, shift: tuple[float, float] = (0.0, 0.0)) -> list[Track]:
        """shift is how far the whole picture moved, so a panning camera does not lose everyone."""
        moved = np.array([shift[0], shift[1], shift[0], shift[1]], np.float32)
        for track in self.tracks:
            track.box = track.box + moved
        strong = scores >= HIGH_SCORE
        strong_boxes, strong_scores = boxes[strong], scores[strong]
        weak_boxes, weak_scores = boxes[~strong], scores[~strong]

        pairs, unmatched, new = match(self.tracks, strong_boxes, MATCH_IOU)
        for t, b in pairs:
            self.tracks[t].update(strong_boxes[b], float(strong_scores[b]))

        waiting = [self.tracks[i] for i in unmatched]
        rescued, still_lost, _ = match(waiting, weak_boxes, RESCUE_IOU)
        for t, b in rescued:
            waiting[t].update(weak_boxes[b], float(weak_scores[b]))

        for i in still_lost:
            waiting[i].misses += 1
            waiting[i].box = waiting[i].predicted()

        for b in new:
            self.tracks.append(Track(self.next_id, strong_boxes[b], float(strong_scores[b]), np.zeros(4, np.float32)))
            self.next_id += 1

        self.tracks = [t for t in self.tracks if t.misses <= MAX_MISSES and (t.confirmed or t.misses == 0)]
        return [t for t in self.tracks if t.confirmed and t.misses == 0]
