"""Reads shirt numbers, choosing only from the numbers on the match's team sheet.

The models read any text, so asking them what a shirt says invites a guess. This asks instead how
well each number on that team's list fits, and a shirt showing a number not on the list gets no
answer. One reading never names anyone: several frames must agree, because a wrong reading rarely
repeats and a real number does.

Only numbers reach this service. Names stay in the main process.

The thresholds were set on three frames of one real match, so they are a starting point, not a
measured result. Reading runs on its own thread and the processor, and it never slows tracking.
"""

import logging
import math
import threading
import time
from collections import Counter, defaultdict
from collections.abc import Callable, Iterable
from pathlib import Path
from typing import Any

import cv2
import numpy as np

log = logging.getLogger(__name__)

#: The shirt: below the head, above the legs.
SHIRT_TOP, SHIRT_BOTTOM = 0.1, 0.6
ENLARGE = 4
MIN_DETECT_SIDE = 736
DETECT_STRIDE = 32
TEXT_THRESHOLD = 0.3
MIN_REGION_SCORE = 0.5
GROW_TEXT = 1.6
MIN_REGION_AREA = 9.0
READ_HEIGHT, READ_WIDTH = 48, 320
#: A reading must fit this well, and must beat the rest of the list by this share.
MIN_PROBABILITY = 0.4
MIN_SHARE = 0.9
#: Readings that must agree, and how far ahead of the next number they must be.
MIN_READINGS = 3
MIN_LEAD = 2
#: Numbers were read from people this tall or more, in pixels. Smaller ones were not legible.
MIN_BOX_HEIGHT = 120.0
#: Sharing this much of a shirt with someone else could put their number on the wrong person.
MAX_SHIRT_OVERLAP = 0.15
#: How much of what the model reads must be digits. Squeezed into digits, a badge or a sponsor's
#: name reads as "1" or "2". On a real match this cut those from 52 of 140 readings to 5 of 67.
#: A minimum text size was tried as well, and lost more real numbers than badges.
MIN_DIGIT_SHARE = 0.8
RETRY_S = 0.5
FORGET_TRIED_S = 60.0
READER_THREADS = 2

Person = tuple[int, str, np.ndarray]


def number_probability(probs: np.ndarray, text: str) -> float:
    """How likely these per-step class probabilities are to spell the text: the CTC forward pass.

    Class 0 is the gap between characters, and class n + 1 is digit n.
    """
    states = [0]
    for digit in text:
        states += [int(digit) + 1, 0]
    alpha = np.zeros(len(states))
    alpha[0], alpha[1] = probs[0, 0], probs[0, states[1]]
    for step in probs[1:]:
        following = np.zeros(len(states))
        for s, label in enumerate(states):
            total = alpha[s] + (alpha[s - 1] if s else 0.0)
            # Two digits in a row only need no gap when they differ.
            if s > 1 and label and states[s - 2] != label:
                total += alpha[s - 2]
            following[s] = total * step[label]
        alpha = following
    return float(alpha[-1] + alpha[-2])


def best_number(regions: Iterable[np.ndarray], allowed: list[int]) -> int | None:
    """The listed number the regions fit, or None unless it clearly beats the others."""
    best: tuple[float, float, int] | None = None
    for probs in regions:
        scored = sorted(((number_probability(probs, str(n)), n) for n in allowed), reverse=True)
        top, number = scored[0]
        runner_up = scored[1][0] if len(scored) > 1 else 0.0
        if best is None or top > best[0]:
            best = (top, top / max(top + runner_up, 1e-12), number)
    return best[2] if best and best[0] >= MIN_PROBABILITY and best[1] >= MIN_SHARE else None


def digit_share(output: np.ndarray, digit_classes: list[int]) -> float:
    """Of the characters the model sees, the share it takes for digits rather than letters."""
    text = 1.0 - output[:, 0]
    steps = text > 0.5
    if not steps.any():
        return 0.0
    digits = output[:, digit_classes[1:]].sum(1)
    return float(np.mean(digits[steps] / text[steps]))


def shirt_area(box: np.ndarray) -> tuple[float, float, float, float]:
    x1, y1, x2, y2 = (float(v) for v in box)
    return x1, y1 + (y2 - y1) * SHIRT_TOP, x2, y1 + (y2 - y1) * SHIRT_BOTTOM


def readable_people(people: list[Person]) -> list[Person]:
    """Those close enough to read, whose shirts nobody else is standing in front of."""
    areas = [shirt_area(box) for _, _, box in people]

    def overlapped(index: int) -> bool:
        ax1, ay1, ax2, ay2 = areas[index]
        size = max((ax2 - ax1) * (ay2 - ay1), 1.0)
        for other, (bx1, by1, bx2, by2) in enumerate(areas):
            width, height = min(ax2, bx2) - max(ax1, bx1), min(ay2, by2) - max(ay1, by1)
            if other != index and width > 0 and height > 0 and width * height / size > MAX_SHIRT_OVERLAP:
                return True
        return False

    return [p for i, p in enumerate(people) if float(p[2][3] - p[2][1]) >= MIN_BOX_HEIGHT and not overlapped(i)]


def straighten(image: np.ndarray, corners: np.ndarray) -> np.ndarray | None:
    """The text region cut out square-on, with its corners in reading order."""
    sums, differences = corners.sum(1), np.diff(corners, axis=1).ravel()
    ordered = np.array([corners[sums.argmin()], corners[differences.argmin()], corners[sums.argmax()], corners[differences.argmax()]], np.float32)
    width = int(max(np.linalg.norm(ordered[0] - ordered[1]), np.linalg.norm(ordered[3] - ordered[2])))
    height = int(max(np.linalg.norm(ordered[0] - ordered[3]), np.linalg.norm(ordered[1] - ordered[2])))
    if width < 3 or height < 3:
        return None
    target = np.array([[0, 0], [width, 0], [width, height], [0, height]], np.float32)
    return cv2.warpPerspective(image, cv2.getPerspectiveTransform(ordered, target), (width, height), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)


class NumberReader:
    def __init__(self, detector_path: Path, recogniser_path: Path) -> None:
        import onnxruntime as ort  # Slow to load, and only needed once a team sheet is in use.

        options = ort.SessionOptions()
        options.intra_op_num_threads = READER_THREADS
        providers = ["CPUExecutionProvider"]
        self.detector = ort.InferenceSession(str(detector_path), options, providers=providers)
        self.recogniser = ort.InferenceSession(str(recogniser_path), options, providers=providers)
        characters = self.recogniser.get_modelmeta().custom_metadata_map["character"].split("\n")
        # The recogniser's class 0 is its gap, so a character's class is one past its place here.
        self.digit_classes = [0] + [characters.index(str(digit)) + 1 for digit in range(10)]

    def text_regions(self, image: np.ndarray) -> list[np.ndarray]:
        height, width = image.shape[:2]
        ratio = max(1.0, MIN_DETECT_SIDE / min(height, width))
        rows = max(DETECT_STRIDE, round(height * ratio / DETECT_STRIDE) * DETECT_STRIDE)
        columns = max(DETECT_STRIDE, round(width * ratio / DETECT_STRIDE) * DETECT_STRIDE)
        pixels = (cv2.resize(image, (columns, rows)).astype(np.float32) / 255 - 0.5) / 0.5
        heat = self.detector.run(None, {self.detector.get_inputs()[0].name: pixels.transpose(2, 0, 1)[None]})[0][0, 0]
        mask = cv2.dilate((heat > TEXT_THRESHOLD).astype(np.uint8), np.ones((2, 2), np.uint8))
        contours, _ = cv2.findContours(mask, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
        regions = []
        for contour in contours:
            area = cv2.contourArea(contour)
            if len(contour) < 4 or area < MIN_REGION_AREA:
                continue
            inside = np.zeros_like(mask)
            cv2.drawContours(inside, [contour], -1, 1, -1)
            if float(heat[inside > 0].mean()) < MIN_REGION_SCORE:
                continue
            # The detector marks the middle of the text, so the region is grown back out to its edges.
            grow = area * GROW_TEXT / max(cv2.arcLength(contour, True), 1.0)
            centre, (side_a, side_b), angle = cv2.minAreaRect(contour)
            corners = cv2.boxPoints((centre, (side_a + 2 * grow, side_b + 2 * grow), angle))
            regions.append(corners * np.array([width / columns, height / rows], np.float32))
        return regions

    def digit_probabilities(self, region: np.ndarray) -> tuple[np.ndarray, float]:
        """Each step's chance of a gap or each digit, and how much of the text was digits at all."""
        height, width = region.shape[:2]
        limit = max(READ_WIDTH, int(READ_HEIGHT * width / height))
        scaled = min(limit, math.ceil(READ_HEIGHT * width / height))
        pixels = (cv2.resize(region, (scaled, READ_HEIGHT)).astype(np.float32).transpose(2, 0, 1) / 255 - 0.5) / 0.5
        padded = np.zeros((3, READ_HEIGHT, limit), np.float32)
        padded[:, :, :scaled] = pixels
        output = self.recogniser.run(None, {self.recogniser.get_inputs()[0].name: padded[None]})[0][0]
        digits = output[:, self.digit_classes]
        return digits / np.maximum(digits.sum(1, keepdims=True), 1e-9), digit_share(output, self.digit_classes)

    def read(self, image: np.ndarray, box: np.ndarray, allowed: list[int]) -> int | None:
        left, top, right, bottom = (max(int(v), 0) for v in shirt_area(box))
        shirt = image[top:bottom, left:right]
        if shirt.size == 0 or not allowed:
            return None
        large = cv2.resize(shirt, None, fx=ENLARGE, fy=ENLARGE, interpolation=cv2.INTER_CUBIC)
        cut = (straighten(large, corners) for corners in self.text_regions(large))
        read = (self.digit_probabilities(region) for region in cut if region is not None)
        return best_number([probs for probs, share in read if share >= MIN_DIGIT_SHARE], allowed)


class NumberVotes:
    """Readings per tracked person, kept by team so that a change of team starts afresh."""

    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.readings: dict[int, dict[str, Counter[int]]] = defaultdict(lambda: defaultdict(Counter))

    def add(self, track_id: int, side: str, number: int) -> None:
        with self.lock:
            self.readings[track_id][side][number] += 1

    def settled(self, track_id: int, side: str) -> tuple[int, int] | None:
        ranked = self.readings[track_id][side].most_common(2) if track_id in self.readings else []
        if not ranked or ranked[0][1] < MIN_READINGS:
            return None
        lead = ranked[1][1] if len(ranked) > 1 else 0
        return (ranked[0][0], ranked[0][1]) if ranked[0][1] >= lead * MIN_LEAD else None

    def assign(self, roles: dict[int, str]) -> dict[int, int]:
        """Each person's settled number. Two people claiming one goes to the one with more readings."""
        with self.lock:
            claims = [(settled[1], track_id, side, settled[0]) for track_id, side in roles.items() if (settled := self.settled(track_id, side))]
        assigned, taken = {}, set()
        for _count, track_id, side, number in sorted(claims, reverse=True):
            if (side, number) not in taken:
                taken.add((side, number))
                assigned[track_id] = number
        return assigned

    def forget_except(self, track_ids: set[int]) -> None:
        with self.lock:
            for track_id in set(self.readings) - track_ids:
                del self.readings[track_id]


class NumberWorker:
    """Takes the newest picture from each camera and reads one person at a time. Nothing queues."""

    def __init__(self, read: Callable[[np.ndarray, np.ndarray, list[int]], int | None], sheet: dict[str, list[int]], on_error: Callable[[str], None], retry_s: float = RETRY_S) -> None:
        self.read = read
        self.sheet = sheet
        self.on_error = on_error
        self.retry_s = retry_s
        self.waiting: dict[int, tuple[NumberVotes, np.ndarray, list[Person]]] = {}
        self.tried: dict[tuple[int, int], float] = {}
        self.wake = threading.Condition()
        self.stopping = False
        self.thread = threading.Thread(target=self.run, name="numbers", daemon=True)

    def start(self) -> None:
        self.thread.start()

    def stop(self) -> None:
        with self.wake:
            self.stopping = True
            self.wake.notify_all()
        self.thread.join(timeout=3.0)

    def offer(self, votes: NumberVotes, image: np.ndarray, people: list[Person]) -> None:
        with self.wake:
            self.waiting[id(votes)] = (votes, image, people)
            self.wake.notify_all()

    def next_job(self) -> tuple[NumberVotes, np.ndarray, Person] | None:
        """The person gone longest without a try, or None to wait for the next picture."""
        with self.wake:
            while not self.waiting and not self.stopping:
                self.wake.wait(0.5)
            if self.stopping:
                return None
            _key, (votes, image, people) = self.waiting.popitem()
        now = time.monotonic()
        self.tried = {key: at for key, at in self.tried.items() if now - at < FORGET_TRIED_S}
        due = [p for p in readable_people(people) if now - self.tried.get((id(votes), p[0]), 0.0) >= self.retry_s]
        if not due:
            return None
        person = min(due, key=lambda p: self.tried.get((id(votes), p[0]), 0.0))
        self.tried[(id(votes), person[0])] = now
        return votes, image, person

    def run(self) -> None:
        try:
            while not self.stopping:
                job: Any = self.next_job()
                if job is None:
                    # With nobody due, take a moment rather than spin on every new picture.
                    time.sleep(0.01)
                    continue
                votes, image, (track_id, side, box) = job
                number = self.read(image, box, self.sheet.get(side, []))
                if number is not None:
                    votes.add(track_id, side, number)
        except Exception:
            # Tracking carries on without names.
            log.exception("Shirt number reading stopped")
            self.on_error("Shirt numbers stopped because of an internal error, so players are no longer being named. Details are in the log folder.")
