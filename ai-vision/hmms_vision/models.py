"""The models HMMS may use. Each is pinned by hash, with where it came from and its licence.

Add a model here only after checking its licence. AGPL models, which includes Ultralytics YOLO, must
not be added: HMMS ships them to other people. A file that fails its hash is treated as absent.
"""

import hashlib
import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class ModelInfo:
    key: str
    name: str
    version: str
    file: str
    sha256: str
    size_mb: int
    input_size: int
    license: str
    source: str
    purpose: str


YOLOX_SOURCE = "https://github.com/Megvii-BaseDetection/YOLOX/releases/tag/0.1.1rc0"

MODELS: dict[str, ModelInfo] = {
    m.key: m
    for m in (
        ModelInfo(
            "yolox_s", "YOLOX-S", "0.1.1rc0", "yolox_s.onnx", "c5c2d13e59ae883e6af3b45daea64af4833a4951c92d116ec270d9ddbe998063",
            34, 640, "Apache-2.0", YOLOX_SOURCE, "Player detection. The default on a dedicated graphics card.",
        ),
        ModelInfo(
            "yolox_tiny", "YOLOX-Tiny", "0.1.1rc0", "yolox_tiny.onnx", "427cc366d34e27ff7a03e2899b5e3671425c262ea2291f88bb942bc1cc70b0f7",
            19, 416, "Apache-2.0", YOLOX_SOURCE, "Player detection when running without a graphics card.",
        ),
    )
}


def model_folder() -> Path:
    configured = os.environ.get("HMMS_VISION_MODELS")
    return Path(configured) if configured else Path(__file__).resolve().parent.parent / "models"


def file_hash(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(1048576):
            digest.update(chunk)
    return digest.hexdigest()


def verified_path(key: str, folder: Path | None = None) -> Path | None:
    """The model's file if it is present and intact."""
    info = MODELS.get(key)
    if info is None:
        return None
    path = (folder or model_folder()) / info.file
    return path if path.is_file() and file_hash(path) == info.sha256 else None


def list_models(folder: Path | None = None) -> list[dict]:
    return [
        {
            "key": m.key, "name": m.name, "version": m.version, "sizeMb": m.size_mb, "license": m.license, "source": m.source,
            "purpose": m.purpose, "installed": verified_path(m.key, folder) is not None,
        }
        for m in MODELS.values()
    ]
