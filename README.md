# Almost Real Street Fighter

A webcam fighting game. You stand side-on in front of a laptop camera and fight Ryu from
Street Fighter II with real punches, kicks and blocks. Your body is tracked with MediaPipe
Pose; Ryu is drawn from the original sprite sheet next to you at your own height.

Built in one evening with Claude Code for a hackathon. Every round is logged frame by frame
and the fight was balanced from those logs over ten rounds.

## Run

```
node server.js
# open http://127.0.0.1:8000/ in Chrome, allow the camera
```

Needs Node 18+ and internet access on first load (the pose model comes from Google's CDN).

## Play

1. Title screen: SPACE.
2. Calibration: stand side-on, 2 to 3 m from the camera, whole body in frame, hold still until
   every check is green. This locks your body scale.
3. READY: thumbs up, hand above your head, or SPACE.
4. Punch: snap a fist toward Ryu. Kick: raise a leg and swing it forward. Block: hold a fist in
   front of your face. Watch his wind-up.

Keys: SPACE fight or rematch, R back to ready, C recalibrate, D debug overlay and tuning sliders,
L save the round log to `logs/`.

## Analyze a round

```
python3 tools/analyze_log.py logs/fightlog-*.json
```

## Tests

```
npm test
```

## Stack

Vanilla JavaScript, canvas, MediaPipe Pose Landmarker (lite), a 60-line Node static server with a
POST endpoint for logs. `combat.js` is pure and fully unit tested; `render.js` is covered by a
smoke test against a fake canvas.

## Audio sets

Two sound sets, toggled with **M** in game:

- `free` (default, ships in this repo): CC0 / free-license music and effects in `assets/audio/free/`,
  credits in `assets/audio/free/LICENSES.md`.
- `original`: Ryu's theme, the SF2 announcer and hit clips (Capcom) plus Mixkit effects. **Not in the
  repo** (gitignored). If the files exist locally the game starts on this set.

## Assets and license

The Ryu sprite sheet is the property of Capcom and is used here without permission as a
non-commercial fan demo. The code is my own; do not redistribute the Capcom assets commercially.
