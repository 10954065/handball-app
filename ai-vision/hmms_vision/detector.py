"""Person detection with YOLOX through ONNX Runtime.

DirectML runs on the graphics card with no CUDA install, and ONNX Runtime falls back to the
processor by itself. Which one is in use is reported, never assumed. On a laptop with two graphics
adapters, device numbers are not predictable: the target laptop has the RTX 3050 at 0.
"""

import logging
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

log = logging.getLogger(__name__)

PERSON_CLASS = 0
#: Low on purpose: the tracker uses weak detections to hold on to a player through an overlap.
MIN_SCORE = 0.1
NMS_IOU = 0.5
STRIDES = (8, 16, 32)
PADDING = 114


@dataclass(frozen=True)
class Detections:
    boxes: np.ndarray  # x1, y1, x2, y2 in frame pixels
    scores: np.ndarray


NOTHING = Detections(np.zeros((0, 4), np.float32), np.zeros(0, np.float32))


def letterbox(image: np.ndarray, size: int) -> tuple[np.ndarray, float]:
    """Scale to fit a square without distorting people, as YOLOX was trained."""
    ratio = min(size / image.shape[0], size / image.shape[1])
    resized = cv2.resize(image, (int(image.shape[1] * ratio), int(image.shape[0] * ratio)), interpolation=cv2.INTER_LINEAR)
    canvas = np.full((size, size, 3), PADDING, np.uint8)
    canvas[: resized.shape[0], : resized.shape[1]] = resized
    return canvas.transpose(2, 0, 1)[None].astype(np.float32), ratio


def decode_grid(output: np.ndarray, size: int) -> np.ndarray:
    """Turn raw YOLOX output into centre, width and height in input pixels."""
    grids, strides = [], []
    for stride in STRIDES:
        cells = size // stride
        xs, ys = np.meshgrid(np.arange(cells), np.arange(cells))
        grid = np.stack((xs, ys), 2).reshape(-1, 2)
        grids.append(grid)
        strides.append(np.full((grid.shape[0], 1), stride))
    grid, stride = np.concatenate(grids), np.concatenate(strides)
    decoded = output.copy()
    decoded[:, :2] = (output[:, :2] + grid) * stride
    decoded[:, 2:4] = np.exp(output[:, 2:4]) * stride
    return decoded


def people_from_output(output: np.ndarray, size: int, ratio: float) -> Detections:
    decoded = decode_grid(output, size)
    scores = decoded[:, 4] * decoded[:, 5 + PERSON_CLASS]
    keep = scores > MIN_SCORE
    if not keep.any():
        return NOTHING
    kept, kept_scores = decoded[keep], scores[keep]
    half = kept[:, 2:4] / 2
    boxes = np.concatenate((kept[:, :2] - half, kept[:, :2] + half), 1) / ratio
    xywh = np.concatenate((boxes[:, :2], boxes[:, 2:] - boxes[:, :2]), 1)
    chosen = np.array(cv2.dnn.NMSBoxes(xywh.tolist(), kept_scores.tolist(), MIN_SCORE, NMS_IOU)).reshape(-1)
    return Detections(boxes[chosen].astype(np.float32), kept_scores[chosen].astype(np.float32))


class Detector:
    def __init__(self, model_path: Path, size: int, device: int = 0) -> None:
        import onnxruntime as ort  # Slow to load, and only needed once analysis starts.

        options = ort.SessionOptions()
        options.enable_mem_pattern = False  # Required by DirectML.
        options.log_severity_level = 3
        providers: list = ["CPUExecutionProvider"]
        if "DmlExecutionProvider" in ort.get_available_providers():
            providers.insert(0, ("DmlExecutionProvider", {"device_id": device}))
        self.session = ort.InferenceSession(str(model_path), options, providers=providers)
        self.input_name = self.session.get_inputs()[0].name
        self.size = size
        self.backend = "Graphics card" if self.session.get_providers()[0] == "DmlExecutionProvider" else "Processor"
        log.info("Detector ready on %s", self.session.get_providers()[0])

    def warm_up(self) -> None:
        """The first run on a graphics card is far slower than the rest."""
        self.detect(np.zeros((self.size, self.size, 3), np.uint8))

    def detect(self, image: np.ndarray) -> Detections:
        tensor, ratio = letterbox(image, self.size)
        output = self.session.run(None, {self.input_name: tensor})[0][0]
        return people_from_output(output, self.size, ratio)
