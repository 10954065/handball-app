# AI Vision architecture

AI Vision adds camera analysis to HMMS. The camera follows the **players and the two officials**, and the aim is statistics for each player, such as shots and misses. It can name players from the match sheet. It cannot count shots or misses yet, because that needs the ball, and it writes nothing to the match record: the official match engine is unchanged from release 0.8.0.

Ball tracking, goal suggestions and the review queue were built and then removed at the owner's request, before the aim became player statistics. Shots and misses will need the ball tracking back. The work is kept under the local git tag `ai-vision-goals-archive`.

## Status

| Phase | Scope | State |
| --- | --- | --- |
| 1 Audit | Architecture, licences, measurements on the target laptop | Done |
| 2 Foundation | Python service, supervision, AI Vision screen | Done |
| 3 Cameras | USB, network, phone and video file, live preview | Done. No physical webcam or network camera tested yet |
| 4 Player detection | Detection, tracking, court filter, shirt roles, overlay | Done. Tried on three frames of a real match, not yet on a full live run |
| 5 Player identification | Shirt numbers checked against the match sheet, player names on the picture | Done. Tried on three frames of a real match, not on live video. Accuracy unmeasured |
| 6 to 8 Ball, events, fusion | Goal and shot suggestions | **Removed** at the owner's request |
| 9 Analytics | Statistics for each player: shots, misses and more | **Not started.** Needs the ball |
| 10 Recording | Segmented recording, evidence clips | **Not started** |
| 11 Testing | Benchmark module, offline test | **Not started** |
| 12 Release | Python service in the installer | **Not started.** Installed copies report AI Vision as not installed |

## Design

```text
Renderer (React)        no access to cameras, Python or Node
   | typed, validated, permission-checked IPC
Main process            VisionSupervisor, CameraFeeds
   | stdin: JSON commands    stdout: framed JSON + JPEG
Python service          cameras, detector, court filter, tracker, shirt roles, shirt numbers
```

**No network port.** The service talks over stdin and stdout, so no other program or computer can reach it, there is nothing to authenticate, and it exits when HMMS closes.

**Nothing queues.** Each camera has one slot for its newest frame. Analysis and preview take the newest frame, so falling behind skips frames and never uses more memory. The screen asks for its next picture only after drawing the last.

**The match never depends on this.** The service is a separate process, supervised with health checks, restart limits and a hard limit on shutdown. It never sees the match clock or the match record. Tested by force-killing the service during a running match.

**A tracking number is not a player.** Tracking number, role and player identity are separate things. A role comes only from a shirt match, and someone uncertain stays an unlabelled player.

**Who is followed.** Each frame, the court is found from its surface colour, ignoring brightness, because it has two shades and the camera may pan. Someone counts if their feet are on it. If nobody appears to be on it, there is no court in view and everyone stays.

**Who is who.** An operator clicks a shirt for Team A, Team B, the officials and optionally each goalkeeper, on a paused picture. Automatic grouping was tried on real footage and failed: the smallest shirt group was not the officials. Exact colours failed too, because sun and shadow move them and kits are patterned. Matching is by hue direction with a brightness limit, voted over frames, with at most two officials. An unmatched shirt hides someone only if their feet are out of view. Hiding a real player is the worse mistake.

**Who a player is.** An operator chooses the match, which gives the camera the numbers on each team's match sheet. The service is told numbers only: names stay in the main process, and the screen looks them up. The text models can read anything, so they are not asked what a shirt says. They are asked how well each number on that team's list fits, and a number not on the list gets no answer. One reading names nobody: three readings must agree, at twice the count of any other number. A number goes to one person on a team, officials are never read, and people who are too small or overlapping are skipped, so a number cannot land on the wrong person. Reading runs on its own thread on the processor, about 200 ms a person, and takes the newest picture only, so it cannot slow tracking. If the models are missing, tracking carries on and says so.

**Panning.** The whole picture's movement is measured between frames and applied to every track, so a moving camera does not lose everyone's number.

## Files

| Where | What |
| --- | --- |
| `ai-vision/hmms_vision/` | The Python service |
| `src/main/vision/` | Supervisor, frame parser, camera feeds |
| `src/main/services/cameras.ts` | Saved cameras and encrypted passwords |
| `src/main/services/vision-sheet.ts` | The match sheet as a camera sees it |
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

The two shirt number models come out of the `rapidocr-onnxruntime` 1.4.4 wheel. Download it with `pip download rapidocr-onnxruntime==1.4.4 --no-deps`, and copy `ch_PP-OCRv4_det_infer.onnx` and `ch_PP-OCRv4_rec_infer.onnx` from its `rapidocr_onnxruntime/models` folder into `ai-vision/models`. Do not install the package: it needs a different OpenCV and a different ONNX Runtime from HMMS.

| Component | Licence |
| --- | --- |
| YOLOX models | Apache-2.0 |
| PP-OCRv4 text models | Apache-2.0 |
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

- **Shirt numbers are unproven.** On three frames of a real match, against a made-up 14-player list that held the true numbers, 3 of the 8 numbers readable by eye were read and none was misread. Two shirts with no visible number gave a one-off false reading. Agreement across frames is meant to remove those, which has not been measured on video, and the thresholds were set on those same frames. A number facing away cannot be read, so some players will stay unnamed.
- **A name is lost with its tracking number.** If tracking loses someone, their new tracking number starts with no readings.
- A match sheet changed during analysis takes effect the next time analysis starts.
- **Shirt roles are not yet reliable.** On three frames of a real match, in strong sun with a yellow, a dark teal and a green shirt, about two thirds of labels were right. Dark kits have little colour to go on. Votes over many frames should help, which has not been measured on live video.
- A goalkeeper in green and yellow can be taken for an official unless they have their own colour.
- People in the picture's bottom edge are kept only if their shirt matches, so a player cut off there with an unclear shirt can disappear for a moment.
- Pan compensation has been tested on made-up pictures, not on the real feed that lost 65 tracking numbers in 20 seconds.
- The court filter relies on the court being a single colour family, so it needs checking at other venues.
- One intermittent end-to-end failure was seen once in the AI service start and stop flow and has not recurred. A real shutdown hang was fixed afterwards, but it was not confirmed as the cause.
