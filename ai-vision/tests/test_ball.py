import time
import unittest
from types import SimpleNamespace

import cv2
import numpy as np

from hmms_vision.ball import END_GAP_S, BallTracker, Flight, MotionFinder, Point
from hmms_vision.ball_worker import BallWorker
from hmms_vision.camera import Frame
from hmms_vision.shots import GoalAreas, inside, judge

W, H = 1280, 720
RIGHT_GOAL = (0.92, 0.35, 1.0, 0.6)
LEFT_GOAL = (0.0, 0.35, 0.08, 0.6)
GOALS = GoalAreas(LEFT_GOAL, RIGHT_GOAL, "home")


def court():
    image = np.full((H, W, 3), (60, 120, 70), np.uint8)
    cv2.line(image, (W // 2, 0), (W // 2, H), (230, 230, 230), 3)
    return image


def with_ball(x, y):
    image = court()
    cv2.circle(image, (int(x * W), int(y * H)), 7, (0, 200, 255), -1)
    return image


def throw(start, end, frames=10, t0=0.0, fps=25.0):
    return [Point(t0 + i / fps, start[0] + (end[0] - start[0]) * i / (frames - 1), start[1] + (end[1] - start[1]) * i / (frames - 1)) for i in range(frames)]


def flight(points):
    return Flight(1, list(points))


class MotionFinderTest(unittest.TestCase):
    def test_sees_nothing_on_the_first_frame(self):
        self.assertEqual(MotionFinder().find(court()), [])

    def test_sees_nothing_in_a_still_picture(self):
        finder = MotionFinder()
        finder.find(court())
        self.assertEqual(finder.find(court()), [])

    def test_finds_a_small_moving_ball_in_frame_fractions(self):
        finder = MotionFinder()
        finder.find(with_ball(0.2, 0.5))
        finder.find(with_ball(0.3, 0.5))
        found = finder.find(with_ball(0.4, 0.5))
        self.assertTrue(any(abs(x - 0.3) < 0.02 and abs(y - 0.5) < 0.02 for x, y in found), found)

    def test_one_ball_gives_one_sighting(self):
        finder = MotionFinder()
        finder.find(with_ball(0.2, 0.5))
        finder.find(with_ball(0.3, 0.5))
        self.assertEqual(len(finder.find(with_ball(0.4, 0.5))), 1)

    def test_ignores_something_the_size_of_a_person(self):
        def person(x):
            image = court()
            cv2.rectangle(image, (x, 200), (x + 60, 500), (20, 20, 200), -1)
            return image

        finder = MotionFinder()
        finder.find(person(300))
        finder.find(person(420))
        self.assertEqual(finder.find(person(540)), [])

    def test_ignores_motion_inside_a_player_box(self):
        finder = MotionFinder()
        finder.find(with_ball(0.2, 0.5))
        finder.find(with_ball(0.3, 0.5))
        self.assertEqual(finder.find(with_ball(0.4, 0.5), [(0.0, 0.0, 1.0, 1.0)]), [])

    def test_handles_a_change_of_resolution(self):
        finder = MotionFinder()
        finder.find(court())
        self.assertEqual(finder.find(cv2.resize(court(), (640, 360))), [])


class FlightTest(unittest.TestCase):
    def test_a_fast_straight_path_is_a_throw(self):
        self.assertTrue(flight(throw((0.5, 0.5), (0.9, 0.5))).is_throw())

    def test_a_short_sighting_is_not(self):
        self.assertFalse(flight(throw((0.5, 0.5), (0.9, 0.5), frames=3)).is_throw())

    def test_something_slow_is_not(self):
        self.assertFalse(flight(throw((0.5, 0.5), (0.52, 0.5), frames=10)).is_throw())

    def test_a_wandering_path_is_not(self):
        zigzag = [Point(i / 25, 0.3 + i * 0.03, 0.5 + (0.05 if i % 2 else -0.05)) for i in range(10)]
        self.assertFalse(flight(zigzag).is_throw())


class BallTrackerTest(unittest.TestCase):
    def feed(self, tracker, points):
        ended = []
        for p in points:
            ended += tracker.update(p.t, [(p.x, p.y)])
        return ended + tracker.update(points[-1].t + END_GAP_S + 0.05, [])

    def test_joins_sightings_into_one_flight(self):
        ended = self.feed(BallTracker(), throw((0.2, 0.5), (0.8, 0.5)))
        self.assertEqual(len(ended), 1)
        self.assertEqual(len(ended[0].points), 10)

    def test_a_flight_ends_only_after_a_gap(self):
        tracker = BallTracker()
        points = throw((0.2, 0.5), (0.8, 0.5))
        for p in points:
            self.assertEqual(tracker.update(p.t, [(p.x, p.y)]), [])

    def test_follows_the_ball_past_scattered_noise(self):
        tracker = BallTracker()
        ended = []
        noise = np.random.default_rng(1).random((10, 2))
        for p, n in zip(throw((0.2, 0.5), (0.8, 0.5)), noise):
            ended += tracker.update(p.t, [(p.x, p.y), (float(n[0]), float(n[1]))])
        ended += tracker.update(1.0, [])
        self.assertEqual(len(ended), 1)
        self.assertGreaterEqual(len(ended[0].points), 9)

    def test_scattered_noise_alone_is_never_a_throw(self):
        tracker = BallTracker()
        ended = []
        random = np.random.default_rng(2)
        for i in range(100):
            ended += tracker.update(i / 25, [(float(x), float(y)) for x, y in random.random((3, 2))])
        self.assertEqual(ended, [])

    def test_reports_the_current_flight_for_the_marker(self):
        tracker = BallTracker()
        self.assertIsNone(tracker.current())
        for p in throw((0.2, 0.5), (0.8, 0.5), frames=6):
            tracker.update(p.t, [(p.x, p.y)])
        self.assertIsNotNone(tracker.current())


class JudgingTest(unittest.TestCase):
    def test_a_flight_ending_in_a_goal_is_a_possible_goal(self):
        call = judge(flight(throw((0.5, 0.5), (0.96, 0.5))), GOALS)
        self.assertEqual(call.category, "goal")

    def test_the_team_shooting_is_the_one_not_defending_that_goal(self):
        self.assertEqual(judge(flight(throw((0.5, 0.5), (0.96, 0.5))), GOALS).side, "home")
        self.assertEqual(judge(flight(throw((0.5, 0.5), (0.04, 0.5))), GOALS).side, "away")

    def test_changing_ends_swaps_the_team(self):
        swapped = GoalAreas(LEFT_GOAL, RIGHT_GOAL, "away")
        self.assertEqual(judge(flight(throw((0.5, 0.5), (0.96, 0.5))), swapped).side, "away")

    def test_a_flight_ending_close_to_a_goal_is_only_a_possible_shot(self):
        call = judge(flight(throw((0.5, 0.5), (0.88, 0.5))), GOALS)
        self.assertEqual(call.category, "shot")

    def test_a_pass_across_the_court_says_nothing(self):
        self.assertIsNone(judge(flight(throw((0.2, 0.1), (0.7, 0.2))), GOALS))

    def test_a_ball_leaving_a_goal_is_not_a_shot_at_it(self):
        self.assertIsNone(judge(flight(throw((0.96, 0.5), (0.97, 0.5), frames=6)), GOALS))

    def test_a_camera_with_one_goal_marked_ignores_the_other_end(self):
        goals = GoalAreas(None, RIGHT_GOAL, "home")
        self.assertIsNone(judge(flight(throw((0.5, 0.5), (0.04, 0.5))), goals))
        self.assertIsNotNone(judge(flight(throw((0.5, 0.5), (0.96, 0.5))), goals))

    def test_confidence_stays_modest_because_this_is_unproven(self):
        long_flight = flight(throw((0.3, 0.5), (0.96, 0.5), frames=40))
        self.assertLessEqual(judge(long_flight, GOALS).confidence, 0.85)

    def test_a_longer_sighting_earns_more_confidence(self):
        short = judge(flight(throw((0.5, 0.5), (0.96, 0.5), frames=5)), GOALS).confidence
        long = judge(flight(throw((0.5, 0.5), (0.96, 0.5), frames=20)), GOALS).confidence
        self.assertGreater(long, short)

    def test_zone_edges(self):
        self.assertTrue(inside(Point(0, 0.92, 0.35), RIGHT_GOAL))
        self.assertFalse(inside(Point(0, 0.91, 0.5), RIGHT_GOAL))
        self.assertTrue(inside(Point(0, 0.91, 0.5), RIGHT_GOAL, 0.02))


class RealPictures(unittest.TestCase):
    """The whole chain, on drawn frames: motion, flight, judgement, message."""

    def run_clip(self, frames, goals=GOALS, fps=25.0):
        sent = []
        camera = SimpleNamespace(spec=SimpleNamespace(id="cam"), latest=lambda: None)
        worker = BallWorker(camera, goals, sent.append, lambda: [])
        base = time.monotonic()
        for i, image in enumerate(frames, 1):
            frame = Frame(image, i, base + i / fps)
            camera.latest = lambda f=frame: f
            worker.step()
        last = base + (len(frames) + 1) / fps
        camera.latest = lambda: Frame(court(), len(frames) + 1, last + END_GAP_S + 0.1)
        worker.step()
        return [m for m in sent if m["type"] == "suggestion"]

    def path(self, start, end, frames):
        return [with_ball(start[0] + (end[0] - start[0]) * i / (frames - 1), start[1] + (end[1] - start[1]) * i / (frames - 1)) for i in range(frames)]

    def test_a_drawn_shot_into_the_goal_becomes_one_goal_suggestion(self):
        found = self.run_clip([court()] * 3 + self.path((0.5, 0.5), (0.96, 0.48), 10) + [court()] * 8)
        self.assertEqual([m["category"] for m in found], ["goal"])
        self.assertEqual(found[0]["side"], "home")
        self.assertIsNone(found[0]["jersey"])
        self.assertGreaterEqual(found[0]["ageMs"], 0)

    def test_a_drawn_pass_produces_nothing(self):
        self.assertEqual(self.run_clip(self.path((0.2, 0.15), (0.7, 0.2), 10) + [court()] * 8), [])

    def test_a_still_picture_produces_nothing(self):
        self.assertEqual(self.run_clip([court()] * 30), [])

    def test_moving_limbs_produce_nothing(self):
        def limbs(i):
            image = court()
            for x in (300, 500, 900):
                cv2.rectangle(image, (x + (i * 7) % 20, 300 + (i * 11) % 15), (x + 12 + (i * 7) % 20, 330 + (i * 11) % 15), (10, 10, 200), -1)
            return image

        self.assertEqual(self.run_clip([limbs(i) for i in range(40)]), [])


if __name__ == "__main__":
    unittest.main()
