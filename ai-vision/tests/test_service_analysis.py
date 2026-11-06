import io
import threading
import time
import unittest

import numpy as np

from hmms_vision import service as service_module
from hmms_vision.camera import CameraSpec, Frame
from hmms_vision.detector import Detections
from hmms_vision.models import model_folder, verified_path
from hmms_vision.protocol import Channel, read_frame
from hmms_vision.service import CommandError, Service


class SafeBytes(io.BytesIO):
    def __init__(self):
        super().__init__()
        self.lock = threading.Lock()


def headers(out):
    stream = io.BytesIO(out.getvalue())
    found = []
    while True:
        try:
            frame = read_frame(stream)
        except ValueError:
            return found
        if frame is None:
            return found
        found.append(frame[0])


class StillCamera:
    spec = CameraSpec("a", "file", "x")

    def __init__(self, image=None):
        self.seq = 0
        self.image = np.zeros((720, 1280, 3), np.uint8) if image is None else image

    def latest(self):
        self.seq += 1
        return Frame(self.image, self.seq, 0.0)

    def stop(self):
        pass

    def input_fps(self):
        return 0.0


class FakeDetector:
    backend = "Processor"
    loads = 0

    def __init__(self, *_args):
        FakeDetector.loads += 1

    def warm_up(self):
        pass

    def detect(self, _image):
        return Detections(np.array([[10, 10, 110, 310]], np.float32), np.array([0.9], np.float32))


class FakeReader:
    loads = 0

    def __init__(self, *_args):
        FakeReader.loads += 1

    def read(self, _image, _box, allowed):
        return allowed[0]


class BrokenDetector(FakeDetector):
    def warm_up(self):
        raise RuntimeError("out of graphics memory at C:/private/path")


class AnalysisCommands(unittest.TestCase):
    def setUp(self):
        self.out = SafeBytes()
        self.service = Service(Channel(self.out))
        self.addCleanup(self.service.close_all)
        self.originals = (service_module.Detector, service_module.verified_path, service_module.NumberReader)
        service_module.NumberReader = FakeReader
        FakeReader.loads = 0
        service_module.verified_path = lambda _key: "model.onnx"
        service_module.Detector = FakeDetector
        FakeDetector.loads = 0
        self.addCleanup(self.restore)

    def restore(self):
        service_module.Detector, service_module.verified_path, service_module.NumberReader = self.originals

    def wait_for(self, predicate, timeout=4.0):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            found = [h for h in headers(self.out) if predicate(h)]
            if found:
                return found
            time.sleep(0.01)
        self.fail("Nothing matching arrived")

    def state(self, name):
        return self.wait_for(lambda h: h["type"] == "analysis" and h["state"] == name)[0]

    def test_loads_the_model_away_from_the_command_thread_and_reports_what_it_runs_on(self):
        self.service.start_analysis({"rate": 30})
        self.assertEqual(self.state("loading")["state"], "loading")
        self.assertEqual(self.state("running")["backend"], "Processor")

    def test_sends_tracks_for_an_open_camera(self):
        self.service.cameras["a"] = StillCamera()
        self.service.start_analysis({"rate": 30})
        track = self.wait_for(lambda h: h["type"] == "tracks" and h["tracks"])[0]
        self.assertEqual(track["tracks"][0]["h"], 300)

    def test_says_so_when_the_model_is_missing(self):
        service_module.verified_path = lambda _key: None
        with self.assertRaisesRegex(CommandError, "model is not installed"):
            self.service.start_analysis({})

    def test_tracking_runs_on_without_names_when_the_number_models_are_missing(self):
        service_module.verified_path = lambda key: None if key.startswith("number") else "model.onnx"
        self.service.start_analysis({"rate": 30, "numbers": {"a": [7, 13]}})
        self.assertIn("shirt number models are not installed", self.state("running")["message"])

    def test_a_reader_that_will_not_load_leaves_tracking_running(self):
        def broken(*_args):
            raise RuntimeError("detail")

        service_module.NumberReader = broken
        with self.assertLogs(level="ERROR"):
            self.service.start_analysis({"rate": 30, "numbers": {"a": [7]}})
            self.assertIn("could not be loaded", self.state("running")["message"])

    def test_does_not_load_the_reader_without_a_team_sheet(self):
        self.service.start_analysis({"rate": 30})
        self.assertIsNone(self.state("running")["message"])
        self.assertEqual(FakeReader.loads, 0)

    def test_a_team_sheet_can_be_chosen_while_running(self):
        self.service.start_analysis({"rate": 30})
        self.state("running")
        self.service.set_numbers({"numbers": {"a": [7]}})
        self.assertEqual(self.service.analysis.numbers.sheet, {"a": [7]})
        self.service.set_numbers({"numbers": None})
        self.assertIsNone(self.service.analysis.numbers)

    def test_choosing_a_team_sheet_before_analysis_starts_does_nothing_here(self):
        self.assertEqual(self.service.set_numbers({"numbers": {"a": [7]}}), {})

    def test_refuses_a_bad_team_sheet(self):
        for bad in ("13", {"c": [1]}, {"a": "13"}, {"a": ["13"]}, {"a": [True]}, {"a": [-1]}, {"a": [1000]}, {"a": list(range(61))}):
            with self.assertRaisesRegex(CommandError, "team sheet"):
                self.service.start_analysis({"numbers": bad})

    def test_refuses_bad_settings(self):
        for bad in ({"model": "nope"}, {"rate": 500}, {"rate": "fast"}, {"device": "x"}):
            with self.assertRaises(CommandError):
                self.service.start_analysis(bad)

    def test_a_model_that_will_not_load_is_reported_without_details_of_the_failure(self):
        service_module.Detector = BrokenDetector
        with self.assertLogs(level="ERROR"):
            self.service.start_analysis({})
            failed = self.state("failed")
        self.assertEqual(failed["message"], "The model could not be loaded. Details are in the log folder.")

    def test_keeps_the_model_loaded_between_runs(self):
        self.service.start_analysis({"rate": 30})
        self.state("running")
        self.service.stop_analysis()
        self.service.start_analysis({"rate": 30})
        self.wait_for(lambda h: h["type"] == "analysis" and h["state"] == "running")
        time.sleep(0.05)
        self.assertEqual(FakeDetector.loads, 1)

    def test_pausing_stops_tracks_and_resuming_restores_them(self):
        self.service.cameras["a"] = StillCamera()
        self.service.start_analysis({"rate": 30})
        self.wait_for(lambda h: h["type"] == "tracks")
        self.service.pause_analysis({"paused": True})
        self.state("paused")
        time.sleep(0.1)
        count = len([h for h in headers(self.out) if h["type"] == "tracks"])
        time.sleep(0.15)
        self.assertLessEqual(len([h for h in headers(self.out) if h["type"] == "tracks"]), count + 1)
        self.service.pause_analysis({"paused": False})
        self.wait_for(lambda h: h["type"] == "analysis" and h["state"] == "running")

    def test_cannot_pause_what_is_not_running(self):
        with self.assertRaisesRegex(CommandError, "not running"):
            self.service.pause_analysis({"paused": True})

    def test_stopping_twice_is_harmless(self):
        self.service.start_analysis({"rate": 30})
        self.state("running")
        self.service.stop_analysis()
        self.service.stop_analysis()
        self.assertIsNone(self.service.analysis)

    def test_a_camera_can_close_while_analysis_runs(self):
        self.service.cameras["a"] = StillCamera()
        self.service.start_analysis({"rate": 30})
        self.wait_for(lambda h: h["type"] == "tracks")
        self.service.close_camera({"id": "a"})
        time.sleep(0.05)
        self.assertIsNotNone(self.service.analysis)
        self.assertTrue(self.service.analysis.thread.is_alive())


@unittest.skipUnless(verified_path("yolox_s") and (model_folder() / "people-sample.jpg").is_file(), "The model is not installed")
class RealPipeline(unittest.TestCase):
    def test_a_real_photograph_gives_confirmed_tracks_from_the_real_model(self):
        import cv2

        out = SafeBytes()
        service = Service(Channel(out))
        self.addCleanup(service.close_all)
        service.cameras["a"] = StillCamera(cv2.imread(str(model_folder() / "people-sample.jpg")))
        service.start_analysis({"rate": 10})
        deadline = time.monotonic() + 30
        tracks = []
        while time.monotonic() < deadline and not tracks:
            tracks = [h for h in headers(out) if h["type"] == "tracks" and h["tracks"]]
            time.sleep(0.05)
        self.assertTrue(tracks, "No tracks arrived")
        self.assertGreater(tracks[-1]["inferenceMs"], 0)


if __name__ == "__main__":
    unittest.main()
