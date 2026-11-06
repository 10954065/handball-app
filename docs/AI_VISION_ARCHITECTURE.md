# AI Vision architecture

AI Vision adds camera analysis to HMMS. The camera follows the **players and the two officials**, for looking at positions and team shape. It does not look for goals or other match events, and it writes nothing to the match record: the official match engine is unchanged from release 0.8.0.

Ball tracking, goal suggestions and the review queue were built and then removed at the owner's request. They are kept under the local git tag `ai-vision-goals-archive`.

## Status

| Phase | Scope | State |
| --- | --- | --- |
| 1 Audit | Architecture, licences, measurements on the target laptop | Done |
| 2 Foundation | Python service, supervision, AI Vision screen | Done |
| 3 Cameras | USB, network, phone and video file, live preview | Done. No physical webcam or network camera tested yet |
| 4 Player detection | Detection, tracking, court filter, shirt roles, overlay | Done. Tried on three frames of a real match, not yet on a full live run |
| 5 Player identification | Jersey numbers | **Not started** |
| 6 to 8 Ball, events, fusion | Goal and shot suggestions | **Removed** at the owner's request |
| 9 Analytics | Heatmaps, distance, possession | **Not started** |
| 10 Recording | Segmented recording, evidence clips | **Not started** |
| 11 Testing | Benchmark module, offline test | **Not started** |
| 12 Release | Python service in the installer | **Not started.** Installed copies report AI Vision as not installed |

## Design

```text
Renderer (React)        no access to cameras, Python or Node
   | typed, validated, permission-checked IPC
Main process            VisionSupervisor, CameraFeeds
   | stdin: JSON commands    stdout: framed JSON + JPEG
Python service          cameras, detector, court filter, tracker, shirt roles
```

**No network port.** The service talks over stdin and stdout, so no other program or computer can reach it, there is nothing to authenticate, and it exits when HMMS closes.

**Nothing queues.** Each camera has one slot for its newest frame. Analysis and preview take the newest frame, so falling behind skips frames and never uses more memory. The screen asks for its next picture only after drawing the last.

**The match never depends on this.** The service is a separate process, supervised with health checks, restart limits and a hard limit on shutdown. It never sees the match clock or the match record. Tested by force-killing the service during a running match.

**A tracking number is not a player.** Tracking number, role and player identity are separate things. A role comes only from a shirt match, and someone uncertain stays an unlabelled player.

**Who is followed.** Each frame, the court is found from its surface colour, ignoring brightness, because it has two shades and the camera may pan. Someone counts if their feet are on it. If nobody appears to be on it, there is no court in view and everyone stays.

**Who is who.** An operator clicks a shirt for Team A, Team B, the officials and optionally each goalkeeper, on a paused picture. Automatic grouping was tried on real footage and failed: the smallest shirt group was not the officials. Exact colours failed too, because sun and shadow move them and kits are patterned. Matching is by hue direction with a brightness limit, voted over frames, with at most two officials. An unmatched shirt hides someone only if their feet are out of view. Hiding a real player is the worse mistake.

**Panning.** The whole picture's movement is measured between frames and applied to every track, so a moving camera does not lose everyone's number.

## Files

| Where | What |
| --- | --- |
| `ai-vision/hmms_vision/` | The Python service |
| `src/main/vision/` | Supervisor, frame parser, camera feeds |
| `src/main/services/cameras.ts` | Saved cameras and encrypted passwords |
| `src/renderer/src/pages/vision/` | AI Vision screen |

Migration `0006` adds `camera_devices` and changes no existing table.

## Models and licences

Models are pinned by SHA-256 in `hmms_vision/models.py`. A damaged file counts as absent. They are not stored in git. To set up a development copy:

```bash
python -m venv ai-vision/.venv
ai-vision/.venv/Scripts/python -m pip install -r ai-vision/requirements.txt
gh release download 0.1.1rc0 -R Megvii-BaseDetection/YOLOX -p "yolox_s.onnx" -D ai-vision/models
gh release download 0.1.1rc0 -R Megvii-BaseDetection/YOLOX -p "yolox_tiny.onnx" -D ai-vision/models
```

| Component | Licence |
| --- | --- |
| YOLOX models | Apache-2.0 |
| ONNX Runtime | MIT |
| OpenCV | MIT for the Python package, Apache-2.0 for the library |
| NumPy | BSD |
| pygrabber, comtypes | MIT |

**Ultralytics YOLO must not be used.** It is AGPL-3.0, and HMMS is distributed to other people.

## Measured on the target laptop

Ryzen 7 6800HS, 24 GB RAM, RTX 3050 4 GB, with one camera. DirectML works with no CUDA install. On this laptop device 0 is the RTX 3050 and device 1 is the integrated Radeon.

| Measurement | Result |
| --- | --- |
| YOLOX-S inference, RTX 3050 | About 23 to 27 ms a frame |
| Whole 1080p frame including JPEG | About 41 ms |
| YOLOX-Tiny on the processor | About 33 ms a frame |
| YOLOX-S on the processor | About 118 ms a frame |
| Extra graphics memory | About 150 MB |

These come from a test script and a still picture. The benchmark module in phase 11 will replace them.

## Known limits

- **Shirt roles are not yet reliable.** On three frames of a real match, in strong sun with a yellow, a dark teal and a green shirt, about two thirds of labels were right. Dark kits have little colour to go on. Votes over many frames should help, which has not been measured on live video.
- A goalkeeper in green and yellow can be taken for an official unless they have their own colour.
- People in the picture's bottom edge are kept only if their shirt matches, so a player cut off there with an unclear shirt can disappear for a moment.
- Pan compensation has been tested on made-up pictures, not on the real feed that lost 65 tracking numbers in 20 seconds.
- The court filter relies on the court being a single colour family, so it needs checking at other venues.
- One intermittent end-to-end failure was seen once in the AI service start and stop flow and has not recurred. A real shutdown hang was fixed afterwards, but it was not confirmed as the cause.
