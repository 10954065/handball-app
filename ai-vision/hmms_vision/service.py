import json
import logging
import platform
import threading
from collections.abc import Callable, Iterable
from typing import Any

import psutil

from . import PROTOCOL_VERSION, __version__
from .analysis import AnalysisWorker
from .ball_worker import BallWorker
from .camera import KINDS, CameraSpec, CameraWorker, discover_usb
from .detector import Detector
from .models import MODELS, list_models, verified_path
from .preview import PreviewPublisher
from .protocol import Channel
from .shots import GoalAreas

log = logging.getLogger(__name__)

#: More than this overloads the target laptop. Raise it only after benchmarking.
MAX_CAMERAS = 3
DEFAULT_MODEL = "yolox_s"
DEFAULT_RATE = 10.0
MAX_RATE = 30.0


class CommandError(Exception):
    """A failure the operator should read. Anything else is reported as an internal error."""


def parse_zone(zone: Any) -> tuple[float, float, float, float] | None:
    if zone is None:
        return None
    if not isinstance(zone, list) or len(zone) != 4 or not all(isinstance(v, int | float) and 0 <= v <= 1 for v in zone) or zone[0] >= zone[2] or zone[1] >= zone[3]:
        raise CommandError("Those goal areas are not valid.")
    return tuple(float(v) for v in zone)


def parse_goals(goals: Any) -> dict[str, GoalAreas]:
    """Goal areas per camera. A camera with none gets no ball tracking."""
    if goals is None:
        return {}
    try:
        return {camera: GoalAreas(parse_zone(g.get("left")), parse_zone(g.get("right")), g.get("leftDefendedBy", "home")) for camera, g in goals.items()}
    except AttributeError as err:
        raise CommandError("Those goal areas are not valid.") from err


class Service:
    def __init__(self, channel: Channel) -> None:
        self.channel = channel
        self.running = True
        self.cameras: dict[str, CameraWorker] = {}
        self.preview: PreviewPublisher | None = None
        self.analysis: AnalysisWorker | None = None
        self.detector: tuple[str, int, Detector] | None = None
        self.ball: dict[str, BallWorker] = {}
        self.commands: dict[str, Callable[[dict], Any]] = {
            "ping": lambda _args: {"pong": True},
            "health": lambda _args: self.health(),
            "shutdown": lambda _args: self.shutdown(),
            "cameras.discover": lambda _args: self.discover(),
            "camera.open": self.open_camera,
            "camera.close": self.close_camera,
            "models.list": lambda _args: list_models(),
            "analysis.start": self.start_analysis,
            "analysis.stop": lambda _args: self.stop_analysis(),
            "analysis.pause": self.pause_analysis,
            "analysis.goals": self.update_goals,
        }

    def health(self) -> dict:
        memory = psutil.virtual_memory()
        return {
            "cpuPercent": psutil.cpu_percent(interval=None),
            "memoryUsedMb": round(memory.used / 1048576),
            "memoryTotalMb": round(memory.total / 1048576),
            "serviceMemoryMb": round(psutil.Process().memory_info().rss / 1048576),
            "cameras": {camera_id: {"inputFps": worker.input_fps()} for camera_id, worker in self.cameras.items()},
        }

    def shutdown(self) -> dict:
        self.running = False
        return {}

    def discover(self) -> list[dict]:
        try:
            return discover_usb()
        except OSError as err:
            log.exception("Camera discovery failed")
            raise CommandError("Windows could not list the cameras on this computer.") from err

    def on_camera_state(self, camera: str, state: str, details: dict, message: str | None) -> None:
        self.channel.send({"type": "camera", "camera": camera, "state": state, "message": message, **details})

    def open_camera(self, args: dict) -> dict:
        camera_id, kind, source = args.get("id"), args.get("kind"), args.get("source")
        if not isinstance(camera_id, str) or kind not in KINDS or not isinstance(source, str | int) or isinstance(source, bool):
            raise CommandError("That camera could not be opened.")
        if camera_id not in self.cameras and len(self.cameras) >= MAX_CAMERAS:
            raise CommandError(f"Up to {MAX_CAMERAS} cameras can run at once. Close one first.")
        self.close_camera({"id": camera_id})
        worker = CameraWorker(CameraSpec(camera_id, kind, source, args.get("width"), args.get("height"), args.get("fps")), self.on_camera_state)
        self.cameras[camera_id] = worker
        worker.start()
        if self.preview is None:
            self.preview = PreviewPublisher(self.channel, lambda: list(self.cameras.values()))
            self.preview.start()
        return {}

    def close_camera(self, args: dict) -> dict:
        ball = self.ball.pop(args.get("id"), None)
        if ball is not None:
            ball.stop()
        worker = self.cameras.pop(args.get("id"), None)
        if worker is not None:
            worker.stop()
        return {}

    def close_all(self) -> None:
        self.stop_analysis()
        for camera_id in list(self.cameras):
            self.close_camera({"id": camera_id})

    def on_analysis_state(self, state: str, message: str | None = None, backend: str | None = None) -> None:
        self.channel.send({"type": "analysis", "state": state, "message": message, "backend": backend})

    def start_analysis(self, args: dict) -> dict:
        key = args.get("model") or DEFAULT_MODEL
        rate = args.get("rate") or DEFAULT_RATE
        device = args.get("device") or 0
        colours = args.get("colours")
        goals = parse_goals(args.get("goals"))
        if key not in MODELS or not isinstance(rate, int | float) or not 0 < rate <= MAX_RATE or not isinstance(device, int):
            raise CommandError("Those analysis settings are not valid.")
        path = verified_path(key)
        if path is None:
            raise CommandError(f"The {MODELS[key].name} model is not installed.")
        self.stop_analysis()
        # Loading takes seconds. On this thread it would stop the service answering health checks.
        threading.Thread(target=self.load_and_run, args=(key, device, path, rate, colours, goals), name="model-load", daemon=True).start()
        self.on_analysis_state("loading")
        return {}

    def load_and_run(self, key: str, device: int, path: Any, rate: float, colours: dict | None, goals: dict[str, GoalAreas]) -> None:
        try:
            if self.detector is None or self.detector[:2] != (key, device):
                detector = Detector(path, MODELS[key].input_size, device)
                detector.warm_up()
                self.detector = (key, device, detector)
            detector = self.detector[2]
        except Exception:
            log.exception("Could not load the model")
            self.on_analysis_state("failed", "The model could not be loaded. Details are in the log folder.")
            return
        self.analysis = AnalysisWorker(detector.detect, lambda: list(self.cameras.values()), self.channel.send, rate, colours, lambda message: self.on_analysis_state("failed", message))
        self.analysis.start()
        for camera_id, areas in goals.items():
            self.start_ball_tracking(camera_id, areas)
        self.on_analysis_state("running", backend=detector.backend)

    def start_ball_tracking(self, camera_id: str, areas: GoalAreas) -> None:
        camera = self.cameras.get(camera_id)
        analysis = self.analysis
        if camera is None or analysis is None:
            return
        worker = BallWorker(camera, areas, self.channel.send, lambda: analysis.boxes.get(camera_id, []))
        self.ball[camera_id] = worker
        worker.start()

    def update_goals(self, args: dict) -> dict:
        """Takes effect at once, for changing ends at half time."""
        for camera_id, areas in parse_goals(args.get("goals")).items():
            if camera_id in self.ball:
                self.ball[camera_id].goals = areas
        return {}

    def stop_analysis(self) -> dict:
        for camera_id in list(self.ball):
            self.ball.pop(camera_id).stop()
        if self.analysis is not None:
            self.analysis.stop()
            self.analysis = None
            self.on_analysis_state("stopped")
        return {}

    def pause_analysis(self, args: dict) -> dict:
        if self.analysis is None:
            raise CommandError("Analysis is not running.")
        for flag in [self.analysis.paused, *(ball.paused for ball in self.ball.values())]:
            if args.get("paused"):
                flag.set()
            else:
                flag.clear()
        self.on_analysis_state("paused" if args.get("paused") else "running", backend=self.detector[2].backend if self.detector else None)
        return {}

    def handle(self, line: str) -> None:
        try:
            message = json.loads(line)
            request_id, name, args = message["id"], message["cmd"], message.get("args") or {}
        except (ValueError, KeyError, TypeError):
            log.error("Ignored a malformed command")
            return
        try:
            command = self.commands.get(name)
            if command is None:
                raise CommandError(f"Unknown command: {name}")
            self.channel.send({"type": "reply", "id": request_id, "ok": True, "data": command(args)})
        except CommandError as err:
            self.channel.send({"type": "reply", "id": request_id, "ok": False, "error": str(err)})
        except Exception:
            log.exception("Command %s failed", name)
            self.channel.send({"type": "reply", "id": request_id, "ok": False, "error": "The vision service hit an internal error."})

    def run(self, commands: Iterable[str]) -> None:
        self.channel.send({"type": "hello", "protocol": PROTOCOL_VERSION, "version": __version__, "python": platform.python_version()})
        for line in commands:
            if line.strip():
                self.handle(line)
            if not self.running:
                break
        self.close_all()
