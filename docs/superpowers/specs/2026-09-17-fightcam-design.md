# FightCam: webcam Street Fighter, design

Date: 2026-09-17. Status: approved in brainstorm, pending written review.

## Goal

A browser 2D fighting game. A human, filmed from the side, fights a Street Fighter
character (Ryu) drawn on screen beside them. The human's real punches, kicks and
blocks are read from a webcam via pose tracking and resolved against the opponent
with fighting-game rules. Target: a playable round within a 60 minute build, tuned
live in the demo room afterwards.

## Decisions taken in brainstorm

| Decision | Choice | Why |
|---|---|---|
| Stack | Single-page browser app, no build step, served by `python3 -m http.server` | Zero install risk on Python 3.14 machine; camera permission is one click; `getUserMedia` and ES module imports need a real origin |
| Pose tracking | MediaPipe Pose Landmarker (lite) from Google CDN, VIDEO running mode | 33 landmarks with visibility scores at ~30 fps on Apple Silicon |
| Camera angle | Pure side profile | Silhouette matches a fighting sprite; extended arms are visible from the side; hidden far arm handled by visibility gating |
| Opponent art | Real Street Fighter sprite sheet, cut into pose frames | Stage impact; candidates gathered by subagent in `assets/candidates/` |
| Room | Screen in front of player, camera 90 degrees off at chest height, 2 to 3 m away | Player faces the screen; facing direction auto-detected |
| Scope | Player: punch, kick, block. Opponent: walk, punch. One round, 100 HP each | Fits the hour; Hadouken is first stretch goal |

## Files

- `index.html`: video element, canvas overlay, HUD, key handling, MediaPipe setup, main loop.
- `combat.js`: pure functions, no DOM. Player model from landmarks, strike detection,
  opponent state machine, damage, hitstun. Unit tested.
- `render.js`: opponent sprite, health bars, hit sparks, damage popups, debug skeleton.
- `assets/ryu.png`, `assets/ryu.json`: sheet plus `{pose: [{x,y,w,h}, ...]}` frame map.
- `test/combat.test.js`: Node built-in test runner, synthetic landmark sequences.

## Units

Every length is expressed in H, the player's body height in pixels (nose y to lowest
ankle y), so thresholds hold at any camera distance. Times are milliseconds.

## Player model (per frame, from landmarks)

- `facing`: sign(nose.x - hipMid.x). +1 means the player faces screen-right.
- `floorY`: lowest visible ankle y.
- Head hurtbox: circle at nose, r = 0.09 H. Torso hurtbox: box shoulders to hips.
- Fists: circle per wrist, r = 0.06 H, ignored when landmark visibility < 0.6.
- Foot: circle at near ankle (the ankle with higher visibility), r = 0.07 H.
- Calibration: first 2 s after start, player stands in stance; H, floorY, facing are
  averaged and frozen. R restarts and recalibrates.

## Player moves

| Move | Detection | Damage |
|---|---|---|
| Punch | wrist velocity toward opponent > 1.2 H/s AND wrist extended past shoulder by > 0.35 H toward opponent AND fist circle overlaps opponent hurtbox. One hit per punch: wrist must retract to < 0.25 H past shoulder before re-arming | 10 |
| Kick | near ankle above floor by > 0.25 H AND ankle velocity toward opponent > 1.2 H/s AND foot circle overlaps opponent hurtbox. Re-arm when ankle returns below 0.1 H | 15 |
| Block | near wrist within 0.2 H of nose (Euclidean) and no punch in progress | incoming damage 0, "BLOCK" popup |

- After landing a hit: 400 ms cooldown, player strikes ignored.
- After taking a hit: 500 ms hitstun, player strikes ignored.
- All thresholds live in one `CONFIG` object with a debug slider panel.

## Opponent

State: `{dist, hp, state, stateT, facingPlayer}`. `dist` is distance from the player
edge in H, always on the player's facing side. Sprite is flipped to face the player
and scaled so sprite height = H. Feet on `floorY`.

Hurtbox: box of the current sprite frame, shrunk 15 percent on each side.

State machine:

| State | Duration | Behaviour |
|---|---|---|
| IDLE | 400 | stand |
| APPROACH | until dist <= 0.55 | dist -= 0.6 H/s |
| WINDUP | 500 | wind-up frame; player's cue to block |
| STRIKE | 150 | fist box at reach 0.5 H, head height, size 0.12 H square. Overlap with player head or torso and player not blocking: player takes 10 and enters hitstun. Fires at most once per STRIKE |
| RECOVER | 400 | recover frame |
| HOPBACK | 300 | only if STRIKE landed: dist += 0.3 H eased |
| HURT | 300 | entered when hit by player: hurt frame, dist += 0.25 H eased, own strikes cancelled |
| KO | terminal | KO frame |

Transitions: IDLE -> APPROACH -> WINDUP -> STRIKE -> RECOVER -> (HOPBACK if landed) -> IDLE.
HURT interrupts any non-KO state and returns to IDLE. hp <= 0 -> KO.

## Feedback

- Player hit: video layer offset 30 px away from opponent, eased back over 300 ms;
  red tint alpha 0.35 for 150 ms; hit spark at contact point 200 ms; floating "-10".
- Opponent hit: knockback (above), hurt frame, spark, floating damage number.
- HUD: two health bars (YOU left, RYU right, swapped if facing is -1), names,
  "K.O." banner on KO, "R to restart" hint.
- Key D: debug overlay with skeleton, hurtboxes, fist circles, opponent state name,
  live velocities and thresholds.

## Main loop

1. `requestAnimationFrame` -> `poseLandmarker.detectForVideo(video, now)`.
2. `combat.updatePlayer(landmarks, prev, CONFIG)` -> player model plus detected strikes.
3. `combat.updateOpponent(opp, player, dt, CONFIG)` -> new opponent state plus events.
4. `combat.resolve(events)` -> damage, hitstun, effects list.
5. `render.draw(ctx, player, opp, effects, debug)`.
Landmark history: keep last 5 frames per landmark for velocity (finite difference over
the last 2 frames, in H/s).

## Error handling

- Camera denied or absent: full-screen message, no crash.
- No person detected: HUD shows "step into frame", opponent freezes in IDLE.
- Landmarks below visibility threshold: excluded from detection that frame.
- Sprite sheet missing: draw a labelled coloured box in its place so combat is testable.

## Testing

`test/combat.test.js` with synthetic landmark sequences (helper that generates a
standing figure of height H and moves a named landmark along a path):
1. A scripted fast punch that reaches the opponent registers exactly one hit.
2. Slow arm extension into the opponent registers zero hits.
3. Punch during block stance is not a block; block stance during opponent STRIKE
   yields zero damage and a BLOCK event.
4. Two punches inside 400 ms register one hit.
5. Player struck then punching within 500 ms registers zero hits.
6. Opponent that lands a STRIKE enters HOPBACK; one that misses goes IDLE.
7. Opponent hp reaching 0 enters KO and never leaves.
Camera and rendering are verified by hand in the room.

## Out of scope for the hour

Hadouken (crouch then rise, first stretch goal), rounds, sound, two humans,
background segmentation, opponent kicks.
