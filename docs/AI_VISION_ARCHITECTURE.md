# AI Vision architecture

AI Vision adds camera analysis to HMMS. The camera follows the **players and the two officials**, and the aim is statistics for each player, such as shots and misses. It can name players from the match sheet. It cannot count shots or misses yet, because that needs the ball, and it writes nothing to the match record: the official match engine is unchanged from release 0.8.0.

Ball tracking, goal suggestions and the review queue were built and then removed at the owner's request, before the aim became player statistics. Shots and misses will need the ball tracking back. The work is kept under the local git tag `ai-vision-goals-archive`.

## Status

| Phase | Scope | State |
| --- | --- | --- |
| 1 Audit | Architecture, licences, measurements on the target laptop | Done |
| 2 Foundation | Python service, supervision, AI Vision screen | Done |
| 3 Cameras | USB, network, phone and video file, live preview | Done. No physical webcam or network camera tested yet |
| 4 Player detection | Detection, tracking, court filter, shirt and shorts roles, reconnecting lost players, overlay | Done. Measured on 8 minutes of a real league match |
| 5 Player identification | Shirt numbers checked against the match sheet, player names on the picture | Done. Measured on 8 minutes of a real league match. Few players are named yet |
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

**Who is who.** An operator clicks a shirt for Team A, Team B, the officials and optionally each goalkeeper, on a paused picture. When both teams wear the same shirts, the operator clicks each team's shorts too, and the shorts then decide the team. An official or a goalkeeper still goes by their own shirt. Automatic grouping was tried on real footage and failed: the smallest shirt group was not the officials. Exact colours failed too, because sun and shadow move them and kits are patterned. Shirts are matched by hue direction with a brightness limit. Shorts are matched by how much of the shorts area shows the picked colour, because legs and shadow turn the middle colour of red shorts dark. Black, grey and white have no hue and are matched by brightness alone. Labels are voted over frames, with at most two officials. An unmatched shirt hides someone only if their feet are out of view. Hiding a real player is the worse mistake.

**Who a player is.** An operator chooses the match, which gives the camera the numbers on each team's match sheet. The service is told numbers only: names stay in the main process, and the screen looks them up. The text models can read anything, so they are not asked what a shirt says. They are asked how well each number on that team's list fits, and a number not on the list gets no answer. Text the model reads mostly as letters is ignored, because a chest badge or a sponsor's name squeezed into digits reads as 1 or 2. One reading names nobody: three readings must agree, at twice the count of any other number. A number goes to one person on a team, officials are never read, and people who are too small or overlapping are skipped, so a number cannot land on the wrong person. Reading runs on its own thread on the processor, about 200 ms a person, and takes the newest picture only, so it cannot slow tracking. If the models are missing, tracking carries on and says so.

**Panning.** The whole picture's movement is measured between frames and applied to every track, so a moving camera does not lose everyone.

**Reconnecting.** Most tracks on a real match ended within two seconds, for many reasons: players crossing, going undetected for a moment, the bottom banner, fast camera moves, distance, the picture's edge. A new tracking number loses everything learnt about the player. So someone who appears close to where a player was lost, within about 3.5 seconds, at a similar size and in the same kit (shirt colour and how coloured the shorts are), takes that player's number back. Remembering longer joined the wrong people.

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

- **Measured on real footage.** 8 minutes of Fire v Air Force (Ghana Handball Association league, broadcast at 720p), analysed at 10 frames a second as the application does. Both teams wore black shirts, one with red shorts and one with black.

  | | Before these fixes | After |
  | --- | --- | --- |
  | Tracking numbers in 8 minutes | 915 | 670 |
  | Median time a tracking number lasts | 2.1 s | 3.2 s |
  | People given no team | 57% | 15% |
  | Number readings that were right, judged by eye | about 24 of 64 | about 56 of 64 |
  | Badges read as 1 or 2 | 52 of 140 readings | 5 of 67 |
  | Players named | 8, of which 3 were right | 4, all right |

  Any number from 1 to 99 was allowed, because the real squads were not available. A match sheet should do better. The thresholds were tuned on this same clip, so another match may do worse.
- **Few players are named.** Only 4 of the 14 or so players were named in 8 minutes, all from the red-shorts team. Tracks still last about 3 seconds, and a number must be read three times by one track. Numbers on the black-shorts team were rarely legible at 720p.
- **Reconnecting sometimes joins two people.** In a sample of 36 reconnections, 3 to 5 joined different people, and a few were too blurred to judge. Two teammates in the same kit can be joined, which no colour check can catch.
- People at the side of the court in dark trousers can be taken for the team in black shorts.
- A match sheet changed during analysis takes effect the next time analysis starts.
- **Shirt roles are not yet reliable.** On three frames of a real match, in strong sun with a yellow, a dark teal and a green shirt, about two thirds of labels were right. Dark kits have little colour to go on. Votes over many frames should help, which has not been measured on live video.
- A goalkeeper in green and yellow can be taken for an official unless they have their own colour.
- People in the picture's bottom edge are kept only if their shirt matches, so a player cut off there with an unclear shirt can disappear for a moment.
- Pan compensation made little difference on the real match, where the camera moved slowly.
- The court filter relies on the court being a single colour family, so it needs checking at other venues.
- One intermittent end-to-end failure was seen once in the AI service start and stop flow and has not recurred. A real shutdown hang was fixed afterwards, but it was not confirmed as the cause.
