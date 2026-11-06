import os
import tempfile
import threading
import time
import unittest
from unittest import mock

import cv2
import numpy as np

from hmms_vision.camera import CameraSpec, CameraWorker, FAILED_READS_BEFORE_RECONNECT, discover_usb, open_capture

IMAGE = np.zeros((48, 64, 3), np.uint8)


class FakeCapture:
    """Delivers frames, then a run of failures."""

    def __init__(self, frames=None, opened=True, delay=0.001):
        self.frames = frames
        self.opened = opened
        self.delay = delay
        self.released = False

    def isOpened(self):
        return self.opened

    def read(self):
        time.sleep(self.delay)
        if self.frames is None:
            return True, IMAGE
        if self.frames > 0:
            self.frames -= 1
            return True, IMAGE
        return False, None

    def get(self, _prop):
        return 0

    def release(self):
        self.released = True


class Recorder:
    def __init__(self):
        self.states = []
        self.seen = threading.Condition()

    def __call__(self, camera, state, details, message):
        with self.seen:
            self.states.append((state, details, message))
            self.seen.notify_all()

    def names(self):
        return [s[0] for s in self.states]

    def wait_for(self, name, timeout=5.0):
        with self.seen:
            self.seen.wait_for(lambda: name in self.names(), timeout)
        return name in self.names()


def video_file(path, frames=10, fps=30):
    writer = cv2.VideoWriter(path, cv2.VideoWriter_fourcc(*"mp4v"), fps, (64, 48))
    for i in range(frames):
        writer.write(np.full((48, 64, 3), i * 10, np.uint8))
    writer.release()


class CameraWorkerTest(unittest.TestCase):
    def worker(self, opener, kind="network", source="rtsp://kofi:s3cret@10.0.0.5/live"):
        recorder = Recorder()
        worker = CameraWorker(CameraSpec("cam", kind, source), recorder, opener)
        self.addCleanup(worker.stop)
        worker.start()
        return worker, recorder

    def test_goes_live_and_reports_the_picture_size(self):
        _, states = self.worker(lambda _s: FakeCapture())
        self.assertTrue(states.wait_for("live"))
        self.assertEqual(states.states[1][1], {"width": 64, "height": 48})

    def test_keeps_only_the_newest_frame(self):
        worker, states = self.worker(lambda _s: FakeCapture())
        states.wait_for("live")
        time.sleep(0.05)
        first = worker.latest()
        time.sleep(0.05)
        self.assertGreater(worker.latest().seq, first.seq)
        self.assertGreater(worker.input_fps(), 0)

    def test_retries_a_camera_that_is_not_there_yet(self):
        attempts = []

        def opener(_spec):
            attempts.append(1)
            return FakeCapture(opened=len(attempts) > 1)

        _, states = self.worker(opener)
        self.assertTrue(states.wait_for("live"))
        self.assertEqual(states.names()[:3], ["connecting", "reconnecting", "reconnecting"])

    def test_reconnects_when_a_camera_stops_sending(self):
        attempts = []

        def opener(_spec):
            attempts.append(1)
            return FakeCapture(frames=2 if len(attempts) == 1 else None)

        _, states = self.worker(opener)
        self.assertTrue(states.wait_for("live"))
        with states.seen:
            states.seen.wait_for(lambda: states.names().count("live") == 2, 5)
        self.assertEqual(states.names().count("live"), 2)
        self.assertGreaterEqual(len(attempts), 2)

    def test_closes_the_capture_when_the_connection_is_lost(self):
        captures = []

        def opener(_spec):
            captures.append(FakeCapture(frames=1))
            return captures[-1]

        _, states = self.worker(opener)
        states.wait_for("reconnecting")
        time.sleep(0.05)
        self.assertTrue(captures[0].released)

    def test_tolerates_a_few_failed_reads_without_reconnecting(self):
        class Flaky(FakeCapture):
            reads = 0

            def read(self):
                Flaky.reads += 1
                return (False, None) if Flaky.reads % 2 else (True, IMAGE)

        _, states = self.worker(lambda _s: Flaky())
        states.wait_for("live")
        time.sleep(0.05)
        self.assertEqual(states.names().count("reconnecting"), 0)

    def test_survives_an_opener_that_throws(self):
        def opener(_spec):
            raise RuntimeError("driver exploded at rtsp://kofi:s3cret@10.0.0.5/live")

        with self.assertLogs(level="ERROR"):
            _, states = self.worker(opener)
            self.assertTrue(states.wait_for("reconnecting"))

    def test_never_puts_a_password_in_a_message(self):
        _, states = self.worker(lambda _s: FakeCapture(opened=False))
        states.wait_for("reconnecting")
        text = repr(states.states)
        self.assertNotIn("s3cret", text)
        self.assertNotIn("10.0.0.5", text)

    def test_stops_promptly(self):
        worker, states = self.worker(lambda _s: FakeCapture())
        states.wait_for("live")
        started = time.monotonic()
        worker.stop()
        self.assertLess(time.monotonic() - started, 1)
        self.assertTrue(states.wait_for("closed"))


class VideoFileTest(unittest.TestCase):
    def test_plays_a_file_to_the_end_at_its_own_speed(self):
        with tempfile.TemporaryDirectory() as folder:
            path = os.path.join(folder, "clip.mp4")
            video_file(path, frames=10, fps=30)
            recorder = Recorder()
            worker = CameraWorker(CameraSpec("f", "file", path), recorder)
            started = time.monotonic()
            worker.start()
            self.assertTrue(recorder.wait_for("ended"))
            self.assertGreaterEqual(time.monotonic() - started, 0.25)
            self.assertEqual(worker.latest().seq, 10)

    def test_reports_a_file_that_cannot_be_read(self):
        recorder = Recorder()
        worker = CameraWorker(CameraSpec("f", "file", "no-such-file.mp4"), recorder)
        worker.start()
        self.assertTrue(recorder.wait_for("failed"))
        self.assertEqual(recorder.states[-1][2], "This video file cannot be read.")


class RealNetworkTest(unittest.TestCase):
    def test_an_address_with_nothing_there_is_reported_without_hanging(self):
        recorder = Recorder()
        worker = CameraWorker(CameraSpec("n", "network", "rtsp://127.0.0.1:1/none"), recorder)
        worker.start()
        self.addCleanup(worker.stop)
        self.assertTrue(recorder.wait_for("reconnecting", timeout=12))
        self.assertIn("cannot be reached", recorder.states[-1][2])


class OpenCaptureTest(unittest.TestCase):
    def settings(self, spec):
        with mock.patch("hmms_vision.camera.cv2.VideoCapture") as capture:
            open_capture(spec)
        return [call.args for call in capture.return_value.set.call_args_list]

    def test_asks_a_usb_camera_for_compressed_video_after_its_size_and_speed(self):
        # DirectShow ignores this unless it comes after both, and a webcam then runs at half speed.
        settings = self.settings(CameraSpec("c", "usb", 1, 1280, 720, 30))
        names = [name for name, _ in settings]
        self.assertIn((cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*"MJPG")), settings)
        self.assertGreater(names.index(cv2.CAP_PROP_FOURCC), names.index(cv2.CAP_PROP_FRAME_WIDTH))
        self.assertGreater(names.index(cv2.CAP_PROP_FOURCC), names.index(cv2.CAP_PROP_FPS))

    def test_leaves_the_format_of_other_sources_alone(self):
        for kind, source in (("network", "rtsp://10.0.0.5/live"), ("file", "C:/match.mp4")):
            names = [name for name, _ in self.settings(CameraSpec("c", kind, source, 1280, 720, 30))]
            self.assertNotIn(cv2.CAP_PROP_FOURCC, names)


class DiscoveryTest(unittest.TestCase):
    def test_lists_devices_with_their_numbers_in_order(self):
        devices = discover_usb()
        self.assertEqual([d["index"] for d in devices], list(range(len(devices))))
        for device in devices:
            self.assertTrue(device["name"])


if __name__ == "__main__":
    unittest.main()
