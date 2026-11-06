import io
import unittest

from hmms_vision.protocol import Channel, read_frame
from hmms_vision.service import CommandError, Service


class Harness:
    def __init__(self):
        self.out = io.BytesIO()
        self.service = Service(Channel(self.out))

    def run(self, *lines):
        self.service.run(iter(lines))
        stream = io.BytesIO(self.out.getvalue())
        found = []
        while (frame := read_frame(stream)) is not None:
            found.append(frame[0])
        return found


class ProtocolTest(unittest.TestCase):
    def test_a_frame_survives_the_trip_with_its_binary_payload(self):
        out = io.BytesIO()
        Channel(out).send({"type": "frame", "n": 1}, b"\xff\xd8\x00binary")
        self.assertEqual(read_frame(io.BytesIO(out.getvalue())), ({"type": "frame", "n": 1}, b"\xff\xd8\x00binary"))

    def test_the_end_of_the_stream_is_not_an_error(self):
        self.assertIsNone(read_frame(io.BytesIO(b"")))


class ServiceTest(unittest.TestCase):
    def test_introduces_itself_before_anything_else(self):
        first = Harness().run()[0]
        self.assertEqual(first["type"], "hello")
        self.assertEqual(first["protocol"], 1)

    def test_answers_a_command_with_its_id(self):
        reply = Harness().run('{"id": 7, "cmd": "ping"}')[1]
        self.assertEqual(reply, {"type": "reply", "id": 7, "ok": True, "data": {"pong": True}})

    def test_reports_an_unknown_command_without_stopping(self):
        frames = Harness().run('{"id": 1, "cmd": "nonsense"}', '{"id": 2, "cmd": "ping"}')
        self.assertFalse(frames[1]["ok"])
        self.assertTrue(frames[2]["ok"])

    def test_survives_a_malformed_command(self):
        h = Harness()
        with self.assertLogs(level="ERROR"):
            frames = h.run("not json", '{"no": "id"}', "[1, 2]", '{"id": 2, "cmd": "ping"}')
        self.assertEqual([f["type"] for f in frames], ["hello", "reply"])

    def test_keeps_internal_failures_out_of_the_reply(self):
        h = Harness()
        h.service.commands["boom"] = lambda _args: 1 / 0
        with self.assertLogs(level="ERROR"):
            reply = h.run('{"id": 1, "cmd": "boom"}')[1]
        self.assertEqual(reply["error"], "The vision service hit an internal error.")

    def test_passes_on_a_message_meant_for_the_operator(self):
        def refuse(_args):
            raise CommandError("Camera 2 is not connected.")

        h = Harness()
        h.service.commands["open"] = refuse
        self.assertEqual(h.run('{"id": 1, "cmd": "open"}')[1]["error"], "Camera 2 is not connected.")

    def test_stops_on_shutdown_and_ignores_the_rest(self):
        frames = Harness().run('{"id": 1, "cmd": "shutdown"}', '{"id": 2, "cmd": "ping"}')
        self.assertEqual(len(frames), 2)

    def test_reports_real_figures_for_health(self):
        data = Harness().run('{"id": 1, "cmd": "health"}')[1]["data"]
        self.assertGreater(data["memoryTotalMb"], 0)
        self.assertGreater(data["serviceMemoryMb"], 0)


if __name__ == "__main__":
    unittest.main()
