import tempfile
import threading
import time
import unittest
from pathlib import Path
from types import SimpleNamespace

import cv2
import numpy as np

from hmms_vision.analysis import AnalysisWorker
from hmms_vision.camera import Frame
from hmms_vision.detector import NOTHING, Detections, decode_grid, letterbox, people_from_output
from hmms_vision.models import MODELS, file_hash, list_models, model_folder, verified_path
from hmms_vision.teams import TeamAssigner, hex_to_lab, nearest_team, torso_colour
from hmms_vision.tracker import CONFIRM_HITS, MAX_MISSES, Tracker, iou

RED, BLUE, YELLOW = (0, 0, 220), (220, 0, 0), (0, 230, 230)
RED_HEX, BLUE_HEX = "#dc0000", "#0000dc"


def box(x, y, w=40, h=100):
    return np.array([x, y, x + w, y + h], np.float32)


def feed(tracker, boxes, scores=None):
    b = np.array(boxes, np.float32).reshape(-1, 4)
    s = np.array(scores if scores is not None else [0.9] * len(b), np.float32)
    return tracker.update(b, s)


class TrackerTest(unittest.TestCase):
    def test_overlap_of_identical_and_separate_boxes(self):
        self.assertAlmostEqual(iou(box(0, 0)[None], box(0, 0)[None])[0, 0], 1.0)
        self.assertEqual(iou(box(0, 0)[None], box(500, 0)[None])[0, 0], 0)

    def test_hides_a_track_until_it_has_been_seen_a_few_times(self):
        tracker = Tracker()
        for _ in range(CONFIRM_HITS - 1):
            self.assertEqual(feed(tracker, [box(10, 10)]), [])
        self.assertEqual(len(feed(tracker, [box(10, 10)])), 1)

    def test_ignores_a_one_frame_false_alarm(self):
        tracker = Tracker()
        feed(tracker, [box(10, 10)])
        for _ in range(5):
            feed(tracker, [])
        self.assertEqual(tracker.tracks, [])

    def test_keeps_one_id_for_a_moving_player(self):
        tracker = Tracker()
        ids = set()
        for step in range(30):
            ids |= {t.id for t in feed(tracker, [box(10 + step * 8, 50)])}
        self.assertEqual(len(ids), 1)

    def test_gives_each_player_their_own_id(self):
        tracker = Tracker()
        for _ in range(4):
            found = feed(tracker, [box(10, 10), box(200, 10), box(400, 10)])
        self.assertEqual(len({t.id for t in found}), 3)

    def test_two_players_passing_keep_their_ids(self):
        tracker = Tracker()
        for step in range(5):
            feed(tracker, [box(100 + step * 20, 50), box(400 - step * 20, 50)])
        before = {t.id: t.box[0] for t in tracker.tracks}
        left_id = min(before, key=before.get)
        for step in range(5, 12):
            found = feed(tracker, [box(100 + step * 20, 50), box(400 - step * 20, 50)])
        moved = {t.id: t.box[0] for t in found}
        self.assertEqual(len(moved), 2)
        self.assertEqual(max(moved, key=moved.get), left_id)

    def test_holds_a_player_through_a_weak_detection(self):
        tracker = Tracker()
        for _ in range(CONFIRM_HITS):
            found = feed(tracker, [box(100, 50)])
        first = found[0].id
        found = feed(tracker, [box(102, 50)], [0.2])
        self.assertEqual([t.id for t in found], [first])

    def test_a_weak_detection_alone_does_not_start_a_track(self):
        tracker = Tracker()
        for _ in range(6):
            feed(tracker, [box(100, 50)], [0.2])
        self.assertEqual(tracker.tracks, [])

    def test_recovers_the_same_id_after_a_brief_occlusion(self):
        tracker = Tracker()
        for step in range(6):
            found = feed(tracker, [box(100 + step * 5, 50)])
        first = found[0].id
        for _ in range(5):
            self.assertEqual(feed(tracker, []), [])
        again = feed(tracker, [box(155, 50)])
        self.assertEqual([t.id for t in again], [first])

    def test_gives_up_on_a_player_gone_too_long(self):
        tracker = Tracker()
        for _ in range(4):
            feed(tracker, [box(100, 50)])
        for _ in range(MAX_MISSES + 1):
            feed(tracker, [])
        self.assertEqual(tracker.tracks, [])


def shirt(colour, height=200, width=100):
    """A figure on a grey floor: only the torso band carries the shirt colour."""
    image = np.full((height, width, 3), 120, np.uint8)
    image[int(height * 0.2) : int(height * 0.55), :] = colour
    return image


FULL = np.array([0, 0, 100, 200], np.float32)


class TeamTest(unittest.TestCase):
    def setUp(self):
        self.teams = {"home": hex_to_lab(RED_HEX), "away": hex_to_lab(BLUE_HEX)}

    def test_reads_the_torso_colour(self):
        self.assertLess(np.linalg.norm(torso_colour(shirt(RED), FULL) - self.teams["home"]), 8)

    def test_a_box_too_small_gives_no_answer(self):
        self.assertIsNone(torso_colour(shirt(RED), np.array([0, 0, 4, 4], np.float32)))

    def test_a_box_partly_outside_the_frame_does_not_crash(self):
        self.assertIsNotNone(torso_colour(shirt(RED), np.array([-30, -30, 80, 150], np.float32)))

    def test_matches_a_shirt_to_its_team(self):
        self.assertEqual(nearest_team(torso_colour(shirt(BLUE), FULL), self.teams), "away")

    def test_a_third_colour_belongs_to_neither_team(self):
        self.assertIsNone(nearest_team(hex_to_lab("#101010"), {"home": hex_to_lab("#ffffff"), "away": hex_to_lab("#ffff00")}))

    def test_similar_kits_give_no_answer_rather_than_a_guess(self):
        teams = {"home": hex_to_lab("#dc0000"), "away": hex_to_lab("#c80a0a")}
        self.assertIsNone(nearest_team(hex_to_lab("#d20505"), teams))

    def test_needs_several_frames_before_answering(self):
        assigner = TeamAssigner({"home": RED_HEX, "away": BLUE_HEX})
        self.assertEqual(assigner.observe(shirt(RED), 1, FULL), (None, 0.0))
        assigner.observe(shirt(RED), 1, FULL)
        self.assertEqual(assigner.observe(shirt(RED), 1, FULL), ("home", 1.0))

    def test_a_split_vote_gives_no_answer(self):
        assigner = TeamAssigner({"home": RED_HEX, "away": BLUE_HEX})
        for colour in (RED, BLUE, RED, BLUE, RED, BLUE):
            result = assigner.observe(shirt(colour), 1, FULL)
        self.assertEqual(result, (None, 0.0))

    def test_forgets_players_no_longer_tracked(self):
        assigner = TeamAssigner({"home": RED_HEX, "away": BLUE_HEX})
        assigner.observe(shirt(RED), 1, FULL)
        assigner.observe(shirt(RED), 2, FULL)
        assigner.forget_except({2})
        self.assertEqual(set(assigner.votes), {2})


class DetectorMathsTest(unittest.TestCase):
    def test_letterbox_keeps_proportions_and_reports_the_scale(self):
        tensor, ratio = letterbox(np.zeros((1080, 1920, 3), np.uint8), 640)
        self.assertEqual(tensor.shape, (1, 3, 640, 640))
        self.assertAlmostEqual(ratio, 640 / 1920)

    def output_with_person_at(self, cell, size=64):
        cells = sum((size // s) ** 2 for s in (8, 16, 32))
        output = np.zeros((cells, 85), np.float32)
        output[:, 2:4] = np.log(1.0)
        output[cell, 4] = 0.9
        output[cell, 5] = 0.9
        return output

    def test_decodes_a_cell_to_input_pixels(self):
        output = self.output_with_person_at(9)
        decoded = decode_grid(output, 64)
        self.assertEqual(tuple(decoded[9, :2]), (8.0, 8.0))
        self.assertEqual(tuple(decoded[9, 2:4]), (8.0, 8.0))

    def test_returns_people_in_frame_pixels(self):
        found = people_from_output(self.output_with_person_at(9), 64, 0.5)
        self.assertEqual(len(found.boxes), 1)
        np.testing.assert_allclose(found.boxes[0], [8, 8, 24, 24])
        self.assertAlmostEqual(float(found.scores[0]), 0.81, places=5)

    def test_nothing_found_is_not_an_error(self):
        cells = sum((64 // s) ** 2 for s in (8, 16, 32))
        self.assertEqual(len(people_from_output(np.zeros((cells, 85), np.float32), 64, 1.0).boxes), 0)


class ModelCatalogueTest(unittest.TestCase):
    def test_every_model_states_its_licence_and_source(self):
        for model in MODELS.values():
            self.assertIn(model.license, ("Apache-2.0", "MIT", "BSD-3-Clause"))
            self.assertTrue(model.source.startswith("https://"))

    def test_treats_a_damaged_file_as_absent(self):
        with tempfile.TemporaryDirectory() as folder:
            Path(folder, "yolox_s.onnx").write_bytes(b"not the model")
            self.assertIsNone(verified_path("yolox_s", Path(folder)))
            self.assertFalse(next(m for m in list_models(Path(folder)) if m["key"] == "yolox_s")["installed"])

    def test_an_unknown_model_is_absent(self):
        self.assertIsNone(verified_path("something_else"))

    def test_hashes_a_file(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder, "x")
            path.write_bytes(b"abc")
            self.assertEqual(file_hash(path), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")


class FakeCamera:
    def __init__(self, camera="a"):
        self.spec = SimpleNamespace(id=camera)
        self.seq = 0

    def latest(self):
        self.seq += 1
        return Frame(shirt(RED, 720, 1280), self.seq, 0.0)


class AnalysisLoopTest(unittest.TestCase):
    def run_loop(self, detect, camera=None, colours=None, seconds=0.25, rate=50.0):
        sent, errors = [], []
        camera = camera or FakeCamera()
        worker = AnalysisWorker(detect, lambda: [camera], sent.append, rate, colours, errors.append)
        worker.start()
        time.sleep(seconds)
        worker.stop()
        return sent, errors, worker

    def test_sends_tracks_with_figures(self):
        detections = Detections(np.array([[100, 100, 200, 400]], np.float32), np.array([0.9], np.float32))
        sent, errors, _ = self.run_loop(lambda _image: detections)
        self.assertEqual(errors, [])
        last = sent[-1]
        self.assertEqual(last["type"], "tracks")
        self.assertEqual(last["tracks"][0]["w"], 100)
        self.assertGreater(last["fps"], 0)

    def test_estimates_the_team_when_colours_are_given(self):
        detections = Detections(np.array([[0, 0, 1280, 720]], np.float32), np.array([0.9], np.float32))
        sent, _, _ = self.run_loop(lambda _image: detections, colours={"home": RED_HEX, "away": BLUE_HEX})
        self.assertEqual(sent[-1]["tracks"][0]["team"], "home")

    def test_leaves_team_unknown_without_colours(self):
        detections = Detections(np.array([[0, 0, 1280, 720]], np.float32), np.array([0.9], np.float32))
        sent, _, _ = self.run_loop(lambda _image: detections)
        self.assertIsNone(sent[-1]["tracks"][0]["team"])

    def test_counts_frames_it_could_not_keep_up_with(self):
        camera = FakeCamera()
        camera.latest = lambda c=camera: (setattr(c, "seq", c.seq + 5), Frame(np.zeros((48, 64, 3), np.uint8), c.seq, 0.0))[1]
        sent, _, _ = self.run_loop(lambda _image: NOTHING, camera=camera)
        self.assertGreater(sent[-1]["dropped"], 0)

    def test_does_not_analyse_the_same_frame_twice(self):
        calls = []
        camera = FakeCamera()
        frame = Frame(np.zeros((48, 64, 3), np.uint8), 1, 0.0)
        camera.latest = lambda: frame
        self.run_loop(lambda image: (calls.append(1), NOTHING)[1], camera=camera)
        self.assertEqual(len(calls), 1)

    def test_pausing_stops_inference_and_keeps_the_thread(self):
        calls = []
        worker = AnalysisWorker(lambda image: (calls.append(1), NOTHING)[1], lambda: [FakeCamera()], lambda _m: None, 100.0, None, lambda _e: None)
        worker.paused.set()
        worker.start()
        time.sleep(0.1)
        self.assertEqual(calls, [])
        worker.paused.clear()
        time.sleep(0.1)
        worker.stop()
        self.assertGreater(len(calls), 0)

    def test_a_failure_in_inference_is_reported_and_stops_only_the_analysis(self):
        def boom(_image):
            raise RuntimeError("out of graphics memory")

        with self.assertLogs(level="ERROR"):
            _, errors, worker = self.run_loop(boom)
        self.assertIn("Analysis stopped", errors[0])
        self.assertFalse(worker.thread.is_alive())

    def test_a_slow_detector_never_builds_a_backlog(self):
        seen = []

        def slow(image):
            seen.append(threading.get_ident())
            time.sleep(0.03)
            return NOTHING

        sent, _, _ = self.run_loop(slow, seconds=0.3, rate=200.0)
        self.assertLessEqual(len(seen), 12)
        self.assertEqual(len(sent), len(seen))


REAL_MODEL = verified_path("yolox_tiny")
PICTURE = model_folder() / "people-sample.jpg"


@unittest.skipUnless(REAL_MODEL and PICTURE.is_file(), "The model and sample picture are not installed")
class RealModelTest(unittest.TestCase):
    def test_finds_the_people_in_a_real_photograph(self):
        from hmms_vision.detector import Detector

        detector = Detector(REAL_MODEL, 416)
        detector.warm_up()
        found = detector.detect(cv2.imread(str(PICTURE)))
        self.assertGreaterEqual(int((found.scores > 0.5).sum()), 1)
        self.assertIn(detector.backend, ("Graphics card", "Processor"))


if __name__ == "__main__":
    unittest.main()
