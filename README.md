# Almost Real Street Fighter

### Playing street fighting games is COOL. Being in a street fight is, objectively, COOLER. It is
also a great way to lose teeth. So here is the next best thing.


Every fighting game ever made puts a wall between you and the fight: a controller, a keyboard,
a headset. ***LET'S STEP INTO THE GAME!*** You walk up to a laptop, turn side-on, and you are
standing in the game, at your own height, next to Ryu. Your real punches land. His real punches
land. Nobody files a police report.

Built in one hour with Claude Code at the Anthropic hackathon for the Claude Fable 5.1 launch, on $25 of tokens, and it won. Every round is logged frame by
frame and the fight was balanced from those logs over ten rounds, from unplayable to close and fun.

## What it is

A webcam fighting game. You stand side-on in front of a laptop camera and fight Ryu from
Street Fighter II with real punches, kicks and blocks. Your body is tracked with MediaPipe
Pose; Ryu is drawn from the original sprite sheet next to you, scaled to your body.

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
