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
from hmms_vision.court import court_mask, on_court
from hmms_vision.roles import MAX_OFFICIALS, RoleAssigner, hex_to_lab, same_hue, torso_colour
from hmms_vision.tracker import CONFIRM_HITS, MAX_MISSES, Tracker, iou, pan_shift, small_grey

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


SHIRTS = {"a": RED_HEX, "b": BLUE_HEX, "official": "#00c800"}
GREEN = (0, 200, 0)


def votes(assigner, colour, track=1, frames=4):
    for _ in range(frames):
        assigner.observe(shirt(colour), track, FULL)


class RoleTest(unittest.TestCase):
    def test_a_box_too_small_gives_no_answer(self):
        self.assertIsNone(torso_colour(shirt(RED), np.array([0, 0, 4, 4], np.float32)))

    def test_a_box_partly_outside_the_frame_does_not_crash(self):
        self.assertIsNotNone(torso_colour(shirt(RED), np.array([-30, -30, 80, 150], np.float32)))

    def test_a_shirt_in_shadow_still_has_its_hue(self):
        self.assertGreater(same_hue(hex_to_lab("#6b5a10"), hex_to_lab("#f0dc00")), 0.9)

    def test_a_grey_shirt_has_no_hue_to_match(self):
        self.assertEqual(same_hue(hex_to_lab("#808080"), hex_to_lab("#f0dc00")), -1.0)

    def test_a_dull_gold_kit_matches_a_bright_click_on_it(self):
        assigner = RoleAssigner({"a": "#e9ca46", "b": "#010e21"})
        for _ in range(4):
            assigner.observe(shirt((30, 110, 130)), 1, FULL)
        self.assertEqual(assigner.assign([1]), {1: "a"})

    def test_a_white_shirt_is_not_taken_for_a_dark_one_of_the_same_tint(self):
        assigner = RoleAssigner({"b": "#010e21"})
        for _ in range(4):
            assigner.observe(shirt((235, 225, 220)), 1, FULL)
        self.assertEqual(assigner.assign([1]), {})

    def test_matches_each_picked_shirt(self):
        assigner = RoleAssigner(SHIRTS)
        votes(assigner, RED, 1)
        votes(assigner, BLUE, 2)
        votes(assigner, GREEN, 3)
        self.assertEqual(assigner.assign([1, 2, 3]), {1: "a", 2: "b", 3: "official"})

    def test_leaves_out_anyone_in_another_colour(self):
        assigner = RoleAssigner(SHIRTS)
        votes(assigner, (240, 240, 240), 1)
        self.assertEqual(assigner.assign([1]), {})

    def test_never_keeps_more_than_two_officials(self):
        assigner = RoleAssigner(SHIRTS)
        for track in (1, 2, 3):
            votes(assigner, GREEN, track)
        self.assertEqual(len(assigner.assign([1, 2, 3])), MAX_OFFICIALS)

    def test_a_goalkeeper_counts_for_their_team(self):
        assigner = RoleAssigner({**SHIRTS, "keeperA": "#ffff00"})
        votes(assigner, (0, 255, 255), 1)
        self.assertEqual(assigner.assign([1]), {1: "a"})

    def test_needs_several_frames_before_answering(self):
        assigner = RoleAssigner(SHIRTS)
        votes(assigner, RED, 1, frames=2)
        self.assertEqual(assigner.assign([1]), {})

    def test_a_split_vote_gives_no_answer(self):
        assigner = RoleAssigner(SHIRTS)
        for colour in (RED, BLUE, GREEN, (240, 240, 240), RED, BLUE):
            assigner.observe(shirt(colour), 1, FULL)
        self.assertEqual(assigner.assign([1]), {})

    def test_with_no_shirts_picked_it_is_inactive(self):
        self.assertFalse(RoleAssigner({}).active)

    def test_ignores_an_unknown_slot(self):
        self.assertEqual(set(RoleAssigner({"a": RED_HEX, "coach": "#123456"}).shirts), {"a"})

    def test_forgets_players_no_longer_tracked(self):
        assigner = RoleAssigner(SHIRTS)
        votes(assigner, RED, 1)
        votes(assigner, RED, 2)
        assigner.forget_except({2})
        self.assertEqual(set(assigner.votes), {2})


def sports_ground():
    """A court in two shades, a grey yard behind it, and a white line and a yellow logo on it."""
    image = np.full((720, 1280, 3), (150, 150, 150), np.uint8)
    image[:200] = (220, 200, 170)
    image[300:, :640] = (150, 130, 95)
    image[300:, 640:] = (175, 150, 110)
    cv2.line(image, (0, 340), (1279, 340), (240, 240, 240), 4)
    cv2.circle(image, (640, 560), 90, (40, 190, 220), -1)
    return image


class CourtTest(unittest.TestCase):
    def test_someone_on_the_court_counts_in_either_shade(self):
        mask = court_mask(sports_ground())
        self.assertTrue(on_court(mask, 720, 1280, np.array([300, 400, 360, 600], np.float32)))
        self.assertTrue(on_court(mask, 720, 1280, np.array([900, 400, 960, 600], np.float32)))

    def test_someone_behind_the_barrier_does_not(self):
        mask = court_mask(sports_ground())
        self.assertFalse(on_court(mask, 720, 1280, np.array([300, 180, 340, 280], np.float32)))

    def test_a_logo_on_the_court_is_still_court(self):
        mask = court_mask(sports_ground())
        self.assertTrue(on_court(mask, 720, 1280, np.array([620, 400, 660, 560], np.float32)))

    def test_someone_cut_off_by_the_bottom_of_the_frame_counts(self):
        self.assertTrue(on_court(np.zeros((270, 480), np.uint8), 720, 1280, np.array([300, 500, 360, 719], np.float32)))

    def test_with_no_court_found_nobody_is_dropped(self):
        self.assertTrue(on_court(None, 720, 1280, np.array([300, 400, 360, 500], np.float32)))

    def test_people_are_kept_when_none_of_them_stands_on_what_looks_like_court(self):
        detections = Detections(np.array([[300, 180, 340, 280]], np.float32), np.array([0.9], np.float32))
        self.assertEqual(len(AnalysisWorker.on_the_court(sports_ground(), detections).boxes), 1)

    def test_people_off_the_court_are_dropped_when_others_are_on_it(self):
        boxes = np.array([[300, 180, 340, 280], [300, 400, 360, 600]], np.float32)
        kept = AnalysisWorker.on_the_court(sports_ground(), Detections(boxes, np.array([0.9, 0.9], np.float32)))
        self.assertEqual(kept.boxes.tolist(), [[300, 400, 360, 600]])


class PanTest(unittest.TestCase):
    def scene(self, offset):
        random = np.random.default_rng(3)
        image = cv2.resize(random.integers(0, 255, (45, 80, 3), np.uint8), (1280, 720), interpolation=cv2.INTER_CUBIC)
        return np.roll(image, offset, axis=1)

    def test_measures_how_far_the_picture_moved(self):
        dx, dy = pan_shift(small_grey(self.scene(0)), small_grey(self.scene(40)), 1280)
        self.assertAlmostEqual(abs(dx), 40, delta=8)
        self.assertAlmostEqual(dy, 0, delta=8)

    def test_a_still_picture_has_not_moved(self):
        dx, dy = pan_shift(small_grey(self.scene(0)), small_grey(self.scene(0)), 1280)
        self.assertAlmostEqual(dx, 0, delta=1)
        self.assertAlmostEqual(dy, 0, delta=1)

    def test_a_player_keeps_their_number_through_a_fast_pan(self):
        tracker = Tracker()
        for _ in range(4):
            feed(tracker, [box(600, 50)])
        ids = set()
        for step in range(1, 8):
            moved = np.array([box(600 - step * 90, 50)], np.float32)
            ids |= {t.id for t in tracker.update(moved, np.array([0.9], np.float32), (-90.0, 0.0))}
        self.assertEqual(ids, {tracker.tracks[0].id})


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

    def test_gives_a_role_when_shirts_are_picked(self):
        detections = Detections(np.array([[0, 0, 1280, 719]], np.float32), np.array([0.9], np.float32))
        sent, _, _ = self.run_loop(lambda _image: detections, colours={"a": RED_HEX, "b": BLUE_HEX})
        self.assertEqual([t["role"] for m in sent[-3:] for t in m["tracks"]], ["a", "a", "a"])

    def test_keeps_everyone_on_court_without_a_role_when_no_shirts_are_picked(self):
        detections = Detections(np.array([[0, 0, 1280, 719]], np.float32), np.array([0.9], np.float32))
        sent, _, _ = self.run_loop(lambda _image: detections)
        self.assertIsNone(sent[-1]["tracks"][0]["role"])

    def test_keeps_someone_on_court_whose_shirt_is_unclear(self):
        detections = Detections(np.array([[100, 100, 300, 500]], np.float32), np.array([0.9], np.float32))
        sent, _, _ = self.run_loop(lambda _image: detections, colours={"a": BLUE_HEX, "b": "#00ff00"})
        self.assertIsNone(sent[-1]["tracks"][0]["role"])

    def test_leaves_out_people_in_no_picked_shirt_with_their_feet_out_of_view(self):
        detections = Detections(np.array([[0, 0, 1280, 719]], np.float32), np.array([0.9], np.float32))
        sent, _, _ = self.run_loop(lambda _image: detections, colours={"a": BLUE_HEX, "b": "#00ff00"})
        self.assertEqual(sent[-1]["tracks"], [])

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
