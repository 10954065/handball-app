import io
import os
import tempfile
import threading
import time
import unittest

import cv2
import numpy as np

from hmms_vision.camera import CameraSpec, CameraWorker
from hmms_vision.preview import PreviewPublisher
from hmms_vision.protocol import Channel, read_frame
from hmms_vision.service import MAX_CAMERAS, CommandError, Service


class SafeBytes(io.BytesIO):
    """Written from several threads."""

    def __init__(self):
        super().__init__()
        self.lock = threading.Lock()

    def snapshot(self):
        with self.lock:
            return self.getvalue()


def frames_in(out):
    stream = io.BytesIO(out.snapshot())
    found = []
    while True:
        try:
            frame = read_frame(stream)
        except ValueError:
            return found  # A frame still being written.
        if frame is None:
            return found
        found.append(frame)


def clip(folder, width=1920, height=1080, frames=30):
    path = os.path.join(folder, "clip.mp4")
    writer = cv2.VideoWriter(path, cv2.VideoWriter_fourcc(*"mp4v"), 30, (width, height))
    for i in range(frames):
        writer.write(np.full((height, width, 3), (i * 8) % 255, np.uint8))
    writer.release()
    return path


class OpeningCameras(unittest.TestCase):
    def setUp(self):
        self.out = SafeBytes()
        self.service = Service(Channel(self.out))
        self.addCleanup(self.service.close_all)

    def wait_for(self, predicate, timeout=6.0):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            found = [f for f in frames_in(self.out) if predicate(f[0])]
            if found:
                return found
            time.sleep(0.02)
        self.fail("Nothing matching arrived")

    def test_a_video_file_reaches_hmms_as_jpeg_frames(self):
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as folder:
            self.service.open_camera({"id": "a", "kind": "file", "source": clip(folder)})
            header, payload = self.wait_for(lambda h: h["type"] == "frame")[0]
            self.assertEqual(header["camera"], "a")
            self.assertEqual((header["width"], header["height"]), (1920, 1080))
            self.assertEqual(payload[:2], b"\xff\xd8")
            self.service.close_all()

    def test_reports_state_changes(self):
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as folder:
            self.service.open_camera({"id": "a", "kind": "file", "source": clip(folder, 320, 240, 3)})
            live = self.wait_for(lambda h: h["type"] == "camera" and h["state"] == "live")[0][0]
            self.assertEqual((live["width"], live["height"]), (320, 240))
            self.wait_for(lambda h: h["type"] == "camera" and h["state"] == "ended")
            self.service.close_all()

    def test_refuses_more_cameras_than_the_laptop_can_run(self):
        for n in range(MAX_CAMERAS):
            self.service.open_camera({"id": str(n), "kind": "file", "source": "missing.mp4"})
        with self.assertRaisesRegex(CommandError, "Up to 3 cameras"):
            self.service.open_camera({"id": "extra", "kind": "file", "source": "missing.mp4"})

    def test_reopening_a_camera_replaces_it(self):
        self.service.open_camera({"id": "a", "kind": "file", "source": "missing.mp4"})
        first = self.service.cameras["a"]
        self.service.open_camera({"id": "a", "kind": "file", "source": "missing.mp4"})
        self.assertIsNot(self.service.cameras["a"], first)

    def test_refuses_nonsense_arguments(self):
        for bad in ({}, {"id": 1, "kind": "file", "source": "x"}, {"id": "a", "kind": "fax", "source": "x"}, {"id": "a", "kind": "usb", "source": True}):
            with self.assertRaises(CommandError):
                self.service.open_camera(bad)

    def test_closing_an_unknown_camera_is_harmless(self):
        self.assertEqual(self.service.close_camera({"id": "nope"}), {})

    def test_health_reports_each_camera(self):
        self.service.open_camera({"id": "a", "kind": "file", "source": "missing.mp4"})
        self.assertIn("a", self.service.health()["cameras"])


class Preview(unittest.TestCase):
    def worker_with_frames(self, seq_image):
        class Stub:
            spec = CameraSpec("a", "file", "x")

            def latest(self):
                return seq_image()

        return Stub()

    def test_shrinks_a_large_picture_but_reports_its_true_size(self):
        out = SafeBytes()
        from hmms_vision.camera import Frame

        frame = Frame(np.zeros((2160, 3840, 3), np.uint8), 1, 0.0)
        PreviewPublisher(Channel(out), lambda: []).publish(self.worker_with_frames(lambda: frame))
        header, payload = frames_in(out)[0]
        self.assertEqual(header["width"], 3840)
        decoded = cv2.imdecode(np.frombuffer(payload, np.uint8), cv2.IMREAD_COLOR)
        self.assertEqual(decoded.shape[1], 1280)

    def test_sends_each_frame_once(self):
        out = SafeBytes()
        from hmms_vision.camera import Frame

        frame = Frame(np.zeros((48, 64, 3), np.uint8), 1, 0.0)
        preview = PreviewPublisher(Channel(out), lambda: [])
        worker = self.worker_with_frames(lambda: frame)
        preview.publish(worker)
        preview.publish(worker)
        self.assertEqual(len(frames_in(out)), 1)


class ClosingKeepsTheFileFree(unittest.TestCase):
    def test_a_finished_video_can_be_deleted_straight_away(self):
        with tempfile.TemporaryDirectory() as folder:
            path = clip(folder, 64, 48, 3)
            ended = threading.Event()
            worker = CameraWorker(CameraSpec("f", "file", path), lambda _c, state, _d, _m: state == "ended" and ended.set())
            worker.start()
            self.assertTrue(ended.wait(5))
            os.remove(path)


if __name__ == "__main__":
    unittest.main()
