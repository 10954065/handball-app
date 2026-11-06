import threading
import time
import unittest

import cv2
import numpy as np

from hmms_vision.models import verified_path
from hmms_vision.numbers import (
    MIN_READINGS,
    NumberReader,
    NumberVotes,
    NumberWorker,
    best_number,
    digit_share,
    number_probability,
    readable_people,
)


def spelled(text, frames_per_digit=3):
    """Class probabilities of a clear reading: each digit held for a few steps, with gaps."""
    steps = []
    for digit in text:
        steps += [int(digit) + 1] * frames_per_digit + [0]
    probs = np.full((len(steps), 11), 0.001)
    probs[np.arange(len(steps)), steps] = 0.99
    return probs / probs.sum(1, keepdims=True)


class NumberProbabilityTest(unittest.TestCase):
    def test_a_clear_reading_is_nearly_certain(self):
        self.assertGreater(number_probability(spelled("13"), "13"), 0.5)

    def test_a_different_number_scores_nothing(self):
        self.assertLess(number_probability(spelled("13"), "18"), 0.01)

    def test_a_repeated_digit_needs_a_gap_between_them(self):
        steps = np.full((4, 11), 0.001)
        steps[:, 2] = 0.99
        self.assertLess(number_probability(steps, "11"), 0.1)
        self.assertGreater(number_probability(steps, "1"), 0.5)
        self.assertGreater(number_probability(spelled("11"), "11"), 0.5)


class DigitShareTest(unittest.TestCase):
    CLASSES = list(range(11))

    def test_a_number_is_all_digits(self):
        output = np.zeros((4, 20))
        output[[0, 2], 2] = 1.0
        output[[1, 3], 0] = 1.0
        self.assertEqual(digit_share(output, self.CLASSES), 1.0)

    def test_a_word_is_not_a_number(self):
        output = np.zeros((4, 20))
        output[:, 15] = 0.9
        output[:, 2] = 0.1
        self.assertLess(digit_share(output, self.CLASSES), 0.2)

    def test_nothing_read_counts_as_no_digits(self):
        output = np.zeros((4, 20))
        output[:, 0] = 1.0
        self.assertEqual(digit_share(output, self.CLASSES), 0.0)


class BestNumberTest(unittest.TestCase):
    def test_picks_the_listed_number_that_fits(self):
        self.assertEqual(best_number([spelled("13")], [7, 13, 20]), 13)

    def test_a_number_not_on_the_sheet_is_not_read_as_something_else(self):
        self.assertIsNone(best_number([spelled("45")], [7, 13, 20]))

    def test_two_listed_numbers_that_fit_equally_give_no_answer(self):
        blurred = (spelled("13") + spelled("18")) / 2
        self.assertIsNone(best_number([blurred], [13, 18]))

    def test_nothing_to_read_gives_no_answer(self):
        self.assertIsNone(best_number([], [7, 13]))

    def test_the_best_of_several_regions_counts(self):
        noise = np.full((6, 11), 1 / 11)
        self.assertEqual(best_number([noise, spelled("7")], [7, 13]), 7)


class NumberVotesTest(unittest.TestCase):
    def test_names_nobody_until_enough_readings_agree(self):
        votes = NumberVotes()
        for _ in range(MIN_READINGS - 1):
            votes.add(1, "a", 13)
        self.assertEqual(votes.assign({1: "a"}), {})
        votes.add(1, "a", 13)
        self.assertEqual(votes.assign({1: "a"}), {1: 13})

    def test_a_stray_reading_does_not_beat_a_repeated_one(self):
        votes = NumberVotes()
        for number in (13, 13, 7, 13):
            votes.add(1, "a", number)
        self.assertEqual(votes.assign({1: "a"}), {1: 13})

    def test_readings_that_disagree_name_nobody(self):
        votes = NumberVotes()
        for number in (13, 7, 13, 7, 13, 7):
            votes.add(1, "a", number)
        self.assertEqual(votes.assign({1: "a"}), {})

    def test_one_number_goes_to_one_person_on_a_team(self):
        votes = NumberVotes()
        for _ in range(MIN_READINGS):
            votes.add(1, "a", 13)
        for _ in range(MIN_READINGS + 2):
            votes.add(2, "a", 13)
        self.assertEqual(votes.assign({1: "a", 2: "a"}), {2: 13})

    def test_both_teams_can_have_the_same_number(self):
        votes = NumberVotes()
        for _ in range(MIN_READINGS):
            votes.add(1, "a", 13)
            votes.add(2, "b", 13)
        self.assertEqual(votes.assign({1: "a", 2: "b"}), {1: 13, 2: 13})

    def test_readings_taken_for_the_other_team_do_not_count(self):
        votes = NumberVotes()
        for _ in range(MIN_READINGS):
            votes.add(1, "a", 13)
        self.assertEqual(votes.assign({1: "b"}), {})

    def test_forgets_a_person_who_has_gone(self):
        votes = NumberVotes()
        for _ in range(MIN_READINGS):
            votes.add(1, "a", 13)
        votes.forget_except({2})
        self.assertEqual(votes.assign({1: "a"}), {})


class ReadablePeopleTest(unittest.TestCase):
    def test_leaves_out_someone_too_far_away(self):
        small = (1, "a", np.array([0, 0, 30, 60.0]))
        self.assertEqual(readable_people([small]), [])

    def test_leaves_out_people_overlapping_so_a_number_is_not_given_to_the_wrong_one(self):
        first = (1, "a", np.array([100, 100, 200, 400.0]))
        second = (2, "b", np.array([130, 120, 230, 420.0]))
        apart = (3, "a", np.array([600, 100, 700, 400.0]))
        self.assertEqual([p[0] for p in readable_people([first, second, apart])], [3])


class NumberWorkerTest(unittest.TestCase):
    PERSON = (1, "a", np.array([100, 100, 200, 400.0]))

    def worker(self, read, errors=None):
        worker = NumberWorker(read, {"a": [13], "b": []}, (errors if errors is not None else []).append, retry_s=0.0)
        worker.start()
        self.addCleanup(worker.stop)
        return worker

    def offer_until(self, worker, votes, done):
        deadline = time.monotonic() + 3
        while time.monotonic() < deadline and not done():
            worker.offer(votes, np.zeros((480, 640, 3), np.uint8), [self.PERSON])
            time.sleep(0.005)
        return done()

    def test_reads_in_the_background_and_collects_votes(self):
        votes = NumberVotes()
        worker = self.worker(lambda _image, _box, _allowed: 13)
        self.assertTrue(self.offer_until(worker, votes, lambda: votes.assign({1: "a"}) == {1: 13}))

    def test_checks_only_that_teams_list(self):
        seen = []
        worker = self.worker(lambda _image, _box, allowed: seen.append(allowed))
        self.assertTrue(self.offer_until(worker, NumberVotes(), lambda: bool(seen)))
        self.assertEqual(seen[0], [13])

    def test_a_slow_reader_never_holds_up_the_caller(self):
        release = threading.Event()
        self.addCleanup(release.set)
        worker = self.worker(lambda *_args: release.wait(2))
        started = time.monotonic()
        for _ in range(50):
            worker.offer(NumberVotes(), np.zeros((48, 64, 3), np.uint8), [self.PERSON])
        self.assertLess(time.monotonic() - started, 0.2)

    def test_a_failure_stops_reading_and_says_so_once(self):
        errors = []

        def broken(*_args):
            raise RuntimeError("private detail at C:/somewhere")

        worker = self.worker(broken, errors)
        self.assertTrue(self.offer_until(worker, NumberVotes(), lambda: bool(errors)))
        worker.offer(NumberVotes(), np.zeros((48, 64, 3), np.uint8), [self.PERSON])
        time.sleep(0.05)
        self.assertEqual(len(errors), 1)
        self.assertNotIn("private", errors[0])


DETECTOR, RECOGNISER = verified_path("number_det"), verified_path("number_rec")


@unittest.skipUnless(DETECTOR and RECOGNISER, "the shirt number models are not installed")
class RealModelTest(unittest.TestCase):
    BOX = np.array([220, 60, 420, 420.0])

    @classmethod
    def setUpClass(cls):
        cls.reader = NumberReader(DETECTOR, RECOGNISER)

    @staticmethod
    def picture(text):
        image = np.full((480, 640, 3), (110, 120, 90), np.uint8)
        cv2.rectangle(image, (220, 60), (420, 420), (0, 200, 240), -1)
        if text:
            cv2.putText(image, text, (255, 240), cv2.FONT_HERSHEY_SIMPLEX, 2.6, (10, 10, 10), 9, cv2.LINE_AA)
        return image

    def test_reads_a_printed_number_from_the_list(self):
        self.assertEqual(self.reader.read(self.picture("13"), self.BOX, [7, 13, 20]), 13)

    def test_a_number_not_on_the_list_is_not_given_to_anyone(self):
        self.assertIsNone(self.reader.read(self.picture("46"), self.BOX, [7, 13, 20]))

    def test_a_plain_shirt_gives_no_number(self):
        self.assertIsNone(self.reader.read(self.picture(""), self.BOX, [7, 13, 20]))


if __name__ == "__main__":
    unittest.main()
