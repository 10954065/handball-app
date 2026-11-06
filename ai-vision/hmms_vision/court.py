"""Finds the court in each frame from its surface colour, so spectators can be left out.

No marking by hand: the camera may pan, and a fixed outline would be wrong a moment later. A court
is one colour with two shades of sun and shadow, so this matches on colour and ignores brightness.
Whoever has their feet on it counts. Anyone behind the barrier stands on something else.
"""

import cv2
import numpy as np

WORK_WIDTH = 480
#: How far from the court's colour a pixel may be, in OpenCV's 8-bit Lab units.
COLOUR_TOLERANCE = 5
MIN_BRIGHTNESS = 70
#: Below this share of the frame, no court was found and nobody is filtered out.
MIN_COURT_SHARE = 0.1
CHROMA_BIN = 3
#: Feet sit a little above the bottom of a box. A box reaching the frame's edge has lost its feet.
FOOT_OFFSET = 0.03
FRAME_EDGE = 0.97


def court_mask(image: np.ndarray) -> np.ndarray | None:
    """A mask of the court at WORK_WIDTH, or None if no court can be made out."""
    height, width = image.shape[:2]
    small = cv2.resize(image, (WORK_WIDTH, max(1, round(height * WORK_WIDTH / width))), interpolation=cv2.INTER_AREA)
    lab = cv2.cvtColor(cv2.GaussianBlur(small, (5, 5), 0), cv2.COLOR_BGR2LAB)
    # The bottom of a raised view is court. The sky and the buildings say nothing about it.
    chroma = lab[lab.shape[0] * 2 // 3 :][..., 1:].reshape(-1, 2).astype(int)
    keys = (chroma[:, 0] // CHROMA_BIN) * 100 + chroma[:, 1] // CHROMA_BIN
    values, counts = np.unique(keys, return_counts=True)
    colour = np.median(chroma[keys == values[counts.argmax()]], axis=0)

    distance = np.abs(lab[..., 1:].astype(np.int16) - colour)
    near = ((distance[..., 0] <= COLOUR_TOLERANCE) & (distance[..., 1] <= COLOUR_TOLERANCE) & (lab[..., 0] > MIN_BRIGHTNESS)).astype(np.uint8) * 255
    near = cv2.morphologyEx(near, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    near = cv2.morphologyEx(near, cv2.MORPH_CLOSE, np.ones((15, 15), np.uint8))
    count, labels, stats, _ = cv2.connectedComponentsWithStats(near)
    if count < 2:
        return None
    biggest = 1 + int(stats[1:, cv2.CC_STAT_AREA].argmax())
    if stats[biggest, cv2.CC_STAT_AREA] < MIN_COURT_SHARE * near.size:
        return None
    # The hull fills in the lines, the centre logo and the players standing on the court.
    hull = cv2.convexHull(cv2.findNonZero((labels == biggest).astype(np.uint8)))
    mask = np.zeros(near.shape, np.uint8)
    cv2.fillConvexPoly(mask, hull, 255)
    return mask


def on_court(mask: np.ndarray | None, frame_height: int, frame_width: int, box: np.ndarray) -> bool:
    """With no court found, everyone stays: dropping real players is worse than keeping a spectator."""
    if mask is None:
        return True
    x1, y1, x2, y2 = (float(v) for v in box)
    if y2 >= frame_height * FRAME_EDGE:
        return True
    scale = mask.shape[1] / frame_width
    foot_x = min(int((x1 + x2) / 2 * scale), mask.shape[1] - 1)
    foot_y = min(int((y2 - (y2 - y1) * FOOT_OFFSET) * scale), mask.shape[0] - 1)
    return bool(mask[max(foot_y, 0), max(foot_x, 0)])
