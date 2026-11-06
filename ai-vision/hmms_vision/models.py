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
OCR_SOURCE = "https://pypi.org/project/rapidocr-onnxruntime/1.4.4/"

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
        ModelInfo(
            "number_det", "PP-OCRv4 text detection", "4.0", "ch_PP-OCRv4_det_infer.onnx", "d2a7720d45a54257208b1e13e36a8479894cb74155a5efe29462512d42f49da9",
            5, 736, "Apache-2.0", OCR_SOURCE, "Finds the number on a shirt.",
        ),
        ModelInfo(
            "number_rec", "PP-OCRv4 text recognition", "4.0", "ch_PP-OCRv4_rec_infer.onnx", "48fc40f24f6d2a207a2b1091d3437eb3cc3eb6b676dc3ef9c37384005483683b",
            11, 48, "Apache-2.0", OCR_SOURCE, "Reads the number on a shirt.",
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
