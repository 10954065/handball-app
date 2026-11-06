# AI Vision architecture

AI Vision adds camera analysis to HMMS. Its rule is that **AI proposes, the official confirms, and HMMS records.** Nothing the AI produces reaches a score or a statistic unless an official confirms it, and a confirmed event goes through the same match engine as any other.

## Status

| Phase | Scope | State |
| --- | --- | --- |
| 1 Audit | Architecture, licences, measurements on the target laptop | Done |
| 2 Foundation | Python service, supervision, AI Vision screen | Done |
| 3 Cameras | USB, network, phone and video file, live preview | Done. No physical webcam or network camera tested yet |
| 4 Player detection | Detection, tracking, team estimate, overlay | Done. Not yet tested on handball footage |
| 5 Player identification | Jersey numbers | **Not started.** The matching rule is built and tested: a number names a player only if it is on that team's roster |
| 6 Ball tracking | Motion tracking, goal areas | Done, unproven on real footage |
| 7 Event intelligence | Goal and shot suggestions, deduplication, review queue | Goal and shot done, unproven on real footage. Saves not suggested |
| 8 Fusion | Confirmed suggestions through the match engine | Done and fully tested |
| 9 Analytics | Heatmaps, distance, possession | **Not started** |
| 10 Recording | Segmented recording, evidence clips | **Not started** |
| 11 Testing | Benchmark module, offline test | **Not started** |
| 12 Release | Python service in the installer | **Not started.** Installed copies report AI Vision as not installed |

## Design

```text
Renderer (React)        no access to cameras, Python or Node
   | typed, validated, permission-checked IPC
Main process            VisionSupervisor, CameraFeeds, suggestions service, match engine
   | stdin: JSON commands    stdout: framed JSON + JPEG
Python service          cameras, detector, tracker, ball tracker, shot judgement
```

**No network port.** The service talks over stdin and stdout, so no other program or computer can reach it, there is nothing to authenticate, and it exits when HMMS closes.

**Nothing queues.** Each camera has one slot for its newest frame. Analysis, preview and ball tracking all take the newest frame, so falling behind skips frames and never uses more memory. The screen asks for its next picture only after drawing the last.

**The match never depends on this.** The service is a separate process, supervised with health checks, restart limits and a hard limit on shutdown. It never sees the match clock: it says how long ago a frame was taken, and the main process works out the match time. Tested by force-killing the service during a running match.

**One way in.** `recordEventAt` applies the rules of a correction: the time must be inside its period, and players are judged as they stood then. The suggestion's id is the event's request id, so one suggestion can never score twice.

**A tracking number is not a player.** Tracking number, team estimate, jersey number and player identity are separate things. An unclear team stays unknown, and a player is named only when a number matches that team's roster.

## Files

| Where | What |
| --- | --- |
| `ai-vision/hmms_vision/` | The Python service |
| `src/main/vision/` | Supervisor, frame parser, camera feeds |
| `src/main/services/cameras.ts` | Saved cameras, encrypted passwords, goal areas |
| `src/main/services/suggestions.ts` | Proposing, confirming and rejecting |
| `src/main/services/live/events.ts` | `recordEventAt`, the only route to the record |
| `src/renderer/src/pages/vision/` | AI Vision screen |
| `src/renderer/src/pages/live/review-queue.tsx` | Review queue in the Match Centre |

Migrations `0006` to `0008` add `camera_devices`, `ai_event_suggestions` and `camera_calibrations`. They change no existing table.

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

- **Ball and goal detection are unproven.** They have only been tested on drawn clips. No accuracy can be stated until they are measured on real handball footage. A trained ball model can replace `ball.py` without touching the rest.
- A pass that ends near a goal can look like a shot, and a shot blocked by a defender may not register. A goal area must be marked again if the camera moves.
- Saves are not suggested, because telling a save from a miss needs footage to tune against.
- An official event needs a named player, so a goal with an unknown scorer waits for the official to choose one.
- Cameras opened after analysis starts get player tracking but no ball tracking until analysis restarts.
- One intermittent end-to-end failure was seen once in the AI service start and stop flow and has not recurred. A real shutdown hang was fixed afterwards, but it was not confirmed as the cause.
