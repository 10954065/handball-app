import logging
import threading
import time
from collections.abc import Callable

import cv2

from .camera import CameraWorker
from .protocol import Channel

log = logging.getLogger(__name__)

PREVIEW_FPS = 10
PREVIEW_MAX_WIDTH = 1280
JPEG_QUALITY = 70


class PreviewPublisher(threading.Thread):
    """Sends each camera's newest frame to HMMS at a capped rate. Older frames are simply skipped."""

    def __init__(self, channel: Channel, workers: Callable[[], list[CameraWorker]], fps: int = PREVIEW_FPS) -> None:
        super().__init__(name="preview", daemon=True)
        self.channel = channel
        self.workers = workers
        self.interval = 1.0 / fps
        self.sent: dict[str, int] = {}

    def publish(self, worker: CameraWorker) -> None:
        frame = worker.latest()
        if frame is None or self.sent.get(worker.spec.id) == frame.seq:
            return
        self.sent[worker.spec.id] = frame.seq
        image = frame.image
        height, width = image.shape[:2]
        if width > PREVIEW_MAX_WIDTH:
            image = cv2.resize(image, (PREVIEW_MAX_WIDTH, round(height * PREVIEW_MAX_WIDTH / width)), interpolation=cv2.INTER_AREA)
        ok, jpeg = cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, JPEG_QUALITY])
        if ok:
            self.channel.send({"type": "frame", "camera": worker.spec.id, "seq": frame.seq, "width": width, "height": height}, jpeg.tobytes())

    def run(self) -> None:
        try:
            while True:
                started = time.monotonic()
                for worker in self.workers():
                    self.publish(worker)
                time.sleep(max(0.0, self.interval - (time.monotonic() - started)))
        except (BrokenPipeError, OSError, ValueError):
            # HMMS has closed, and stdin ending stops the service.
            log.info("Preview stopped")
