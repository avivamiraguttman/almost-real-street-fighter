import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, step, startFight, recalibrate, calibrationChecks, selectPose, detectThumbsUp, detectHandUp, CONFIG, LM } from '../combat.js';

const H = 400, FLOOR = 600, HIP = 300;
// Standing side-profile figure facing +x. Overrides are in H units relative to shoulder / floor.
function figure({ ext = 0.1, wristY = -0.75, lift = 0, footFwd = 0.05, blockHand = false } = {}) {
  const lms = Array.from({ length: 33 }, () => ({ x: HIP, y: FLOOR - 0.5 * H, visibility: 1 }));
  const shoulderX = HIP, shoulderY = FLOOR - 0.8 * H;
  lms[LM.NOSE] = { x: HIP + 0.1 * H, y: FLOOR - H, visibility: 1 };
  lms[LM.L_SHOULDER] = lms[LM.R_SHOULDER] = { x: shoulderX, y: shoulderY, visibility: 1 };
  lms[LM.L_HIP] = lms[LM.R_HIP] = { x: HIP, y: FLOOR - 0.5 * H, visibility: 1 };
  const wr = blockHand
    ? { x: HIP + 0.18 * H, y: FLOOR - H + 0.05 * H, visibility: 1 } // 0.08 H in front of the nose, at face height
    : { x: shoulderX + ext * H, y: FLOOR + wristY * H, visibility: 1 };
  lms[LM.L_WRIST] = wr; lms[LM.R_WRIST] = { x: shoulderX + 0.1 * H, y: FLOOR - 0.75 * H, visibility: 0.3 };
  lms[LM.L_ANKLE] = { x: HIP - 0.05 * H, y: FLOOR, visibility: 1 };
  lms[LM.R_ANKLE] = { x: HIP + footFwd * H, y: FLOOR - lift * H, visibility: 1 };
  return lms;
}

const FRAME = { W: 1280, Hc: 720, luma: 120, fps: 30 };
function run(state, frames, t0) {
  const events = []; let t = t0;
  for (const lms of frames) { t += 16; events.push(...step(state, lms, t, undefined, FRAME)); }
  return { events, t };
}
const rep = (lms, n) => Array.from({ length: n }, () => lms);
function ready(oppState = 'IDLE') {
  const s = createGame(CONFIG);
  let { t } = run(s, rep(figure(), 130), 0); // 2.08 s standing still
  assert.equal(s.phase, 'ready');
  assert.equal(s.lock.H, H);
  assert.ok(startFight(s));
  assert.equal(s.phase, 'fighting');
  s.opp.dist = CONFIG.attackDist; s.opp.state = oppState; s.opp.stateT = 0;
  return { s, t };
}
// fast punch: 0.1 -> 0.6 H in 6 frames (~5 H/s), hold, retract
const punchFrames = () => [0.2, 0.3, 0.4, 0.5, 0.55, 0.6, 0.6, 0.6, 0.5, 0.3, 0.1, 0.1].map((e) => figure({ ext: e }));
const count = (ev, type) => ev.filter((e) => e.type === type).length;

test('fast punch into opponent registers exactly one hit', () => {
  const { s, t } = ready();
  const { events } = run(s, punchFrames(), t);
  assert.equal(count(events, 'oppHit'), 1);
  assert.equal(s.opp.hp, CONFIG.maxHp - 10);
  assert.equal(s.opp.state === 'HURT' || s.opp.state === 'IDLE', true);
});

test('slow extension registers zero hits', () => {
  const { s, t } = ready();
  const frames = Array.from({ length: 60 }, (_, i) => figure({ ext: 0.1 + (0.5 * i) / 60 })); // ~0.5 H/s
  const { events } = run(s, frames, t);
  assert.equal(count(events, 'oppHit'), 0);
  assert.equal(s.opp.hp, CONFIG.maxHp);
});

test('block held through the wind-up gives zero damage and a block event', () => {
  const { s, t } = ready('WINDUP');
  const { events } = run(s, rep(figure({ blockHand: true }), 25), t); // guard up 400 ms, strike arrives at 300 ms
  assert.equal(count(events, 'block'), 1);
  assert.equal(count(events, 'playerHit'), 0);
  assert.equal(s.player.hp, CONFIG.maxHp);
});

test('unblocked opponent strike does oppDmg damage', () => {
  const { s, t } = ready('STRIKE');
  const { events } = run(s, rep(figure(), 3), t);
  assert.equal(count(events, 'playerHit'), 1);
  assert.equal(s.player.hp, CONFIG.maxHp - CONFIG.oppDmg);
});

test('two punches inside the cooldown register one hit', () => {
  const { s, t } = ready();
  const { events } = run(s, [...punchFrames(), ...punchFrames()], t); // second punch starts ~190 ms later
  assert.equal(count(events, 'oppHit'), 1);
});

test('punching during hitstun registers zero hits', () => {
  const { s, t } = ready('STRIKE');
  const r1 = run(s, rep(figure(), 2), t);
  assert.equal(count(r1.events, 'playerHit'), 1);
  const r2 = run(s, punchFrames(), r1.t); // punch lands ~100 ms after being struck
  assert.equal(count(r2.events, 'oppHit'), 0);
});

test('opponent hops back after its combo lands, re-approaches after a miss', () => {
  const { s, t } = ready('STRIKE');
  let t1 = t; const seen = new Set();
  for (let i = 0; i < 80 && s.opp.state !== 'HOPBACK'; i++) { t1 += 16; step(s, figure(), t1, undefined, FRAME); seen.add(s.opp.state); }
  assert.equal(s.opp.state, 'HOPBACK');
  assert.ok(seen.has('WINDUP'), 'combo wind-up expected before hopback');
  run(s, rep(figure(), 25), t1);
  assert.ok(s.opp.dist > CONFIG.attackDist);

  const { s: s2, t: t2 } = ready('STRIKE');
  s2.opp.dist = 1.5; // out of reach
  run(s2, rep(figure(), 40), t2);
  assert.equal(s2.player.hp, CONFIG.maxHp);
  assert.notEqual(s2.opp.state, 'HOPBACK');
});

test('opponent reaching 0 hp enters KO and stays there', () => {
  const { s, t } = ready();
  s.opp.hp = 10;
  const { events, t: t1 } = run(s, punchFrames(), t);
  assert.equal(count(events, 'ko'), 1);
  assert.equal(s.winner, 'YOU');
  run(s, rep(figure(), 200), t1);
  assert.equal(s.opp.state, 'KO');
  assert.equal(s.phase, 'ko');
});

test('no body: step returns no events and flags noBody', () => {
  const s = createGame(CONFIG);
  const ev = step(s, null, 16);
  assert.deepEqual(ev, []);
  assert.equal(s.noBody, true);
});

test('calibration flags a body that is too small and one with no room for Ryu', () => {
  const s = createGame(CONFIG);
  const small = figure().map((p) => ({ x: 300 + (p.x - 300) * 0.4, y: 600 - (600 - p.y) * 0.4, visibility: p.visibility })); // H = 160 px = 22% of 720
  run(s, rep(small, 40), 0);
  assert.equal(s.phase, 'calibrate');
  const dist = s.calib.checks.find((c) => c.name === 'distance');
  assert.equal(dist.ok, false); assert.match(dist.msg, /Come closer/);

  const s2 = createGame(CONFIG);
  const cramped = figure().map((p) => ({ ...p, x: p.x + 800 })); // hips at x=1100, facing right, 180 px of room
  run(s2, rep(cramped, 40), 0);
  const room = s2.calib.checks.find((c) => c.name === 'room');
  assert.equal(room.ok, false); assert.match(room.msg, /Move left/);
  assert.equal(s2.phase, 'calibrate');
});

test('calibration flags bad lighting and never locks while a check fails', () => {
  const s = createGame(CONFIG);
  let t = 0;
  for (let i = 0; i < 200; i++) { t += 16; step(s, figure(), t, undefined, { ...FRAME, luma: 20 }); }
  assert.equal(s.phase, 'calibrate');
  assert.equal(s.calib.checks.find((c) => c.name === 'light').ok, false);
});

test('locked scale: Ryu height does not follow a jittering nose', () => {
  const { s, t } = ready();
  const before = s.player.H;
  const wobble = figure(); wobble[LM.NOSE] = { ...wobble[LM.NOSE], y: wobble[LM.NOSE].y + 60 };
  run(s, rep(wobble, 10), t);
  assert.equal(s.player.H, before);
});

test('a landed hit knocks Ryu out of punching range', () => {
  const { s, t } = ready();
  let { t: t1 } = run(s, punchFrames(), t);
  assert.equal(s.opp.state, 'HURT');
  for (let i = 0; i < 60 && s.opp.state === 'HURT'; i++) { t1 += 16; step(s, figure(), t1, undefined, FRAME); }
  assert.equal(s.opp.state, 'APPROACH'); // re-engages instead of idling
  assert.ok(s.opp.dist >= CONFIG.attackDist + CONFIG.knockback * 0.9, `dist ${s.opp.dist}`);
});

test('recalibrate drops the lock and returns to the calibrate phase', () => {
  const { s } = ready();
  recalibrate(s);
  assert.equal(s.phase, 'calibrate'); assert.equal(s.lock, null);
});

test('advancing past the home zone warns and halves damage but never blocks hits', () => {
  const { s, t } = ready();
  s.opp.dist = CONFIG.attackDist + 0.9; // Ryu knocked away; player chases 0.9 H forward
  s.player.lastHip = null; // the walk itself is not under test, skip the teleport guard
  const forward = punchFrames().map((f) => f.map((p) => ({ ...p, x: p.x + 0.9 * H })));
  const { events } = run(s, forward, t);
  assert.equal(count(events, 'stepBack'), 1);
  assert.equal(s.player.outOfZone, true);
  assert.equal(count(events, 'oppHit'), 1);
  assert.equal(s.opp.hp, CONFIG.maxHp - 5); // half of 10
});

test('a missed swing is logged with reason range; a swing during cooldown says cooldown', () => {
  const { s, t } = ready();
  s.opp.dist = 1.5; // out of reach
  const { events, t: t1 } = run(s, punchFrames(), t);
  const swings = events.filter((e) => e.type === 'swing');
  assert.equal(swings.length, 1); assert.equal(swings[0].reason, 'range');
  s.opp.dist = CONFIG.attackDist; s.opp.state = 'IDLE'; s.opp.stateT = 0;
  const { events: ev2 } = run(s, [...punchFrames(), ...punchFrames()], t1);
  assert.equal(count(ev2, 'oppHit'), 1);
  assert.deepEqual(ev2.filter((e) => e.type === 'swing').map((e) => e.reason), ['cooldown']);
});

test('a second person: nearest-hips pose is selected and a hip teleport is rejected briefly', () => {
  const me = figure(), other = figure().map((p) => ({ ...p, x: p.x + 600 }));
  assert.equal(selectPose([other, me], { x: 300, y: 400 }, null, CONFIG), me);
  assert.equal(selectPose([me, other], null, 900, CONFIG), other);
  const { s, t } = ready();
  const ev = step(s, other, t + 16, undefined, FRAME); // tracker jumps to the other person
  assert.equal(count(ev, 'poseJump'), 1);
  assert.equal(s.noBody, true);
  // if the jump persists past the hold window it is accepted (the player really moved)
  let t2 = t + 16; for (let i = 0; i < 60; i++) { t2 += 16; step(s, other, t2, undefined, FRAME); }
  assert.equal(s.noBody, false);
});

test('Ryu is anchored to the room: player stepping forward closes the gap, Ryu does not slide', () => {
  const { s, t } = ready();
  const cxBefore = s.boxes ? s.boxes.cx : null;
  run(s, rep(figure(), 1), t);
  const cx0 = s.boxes.cx;
  const fwd = figure().map((p) => ({ ...p, x: p.x + 0.2 * H }));
  run(s, rep(fwd, 1), t + 16);
  assert.equal(Math.round(s.boxes.cx), Math.round(cx0));
  assert.ok(Math.abs(s.player.offset - 0.2) < 0.01);
});

test('knockback is clamped at the screen edge', () => {
  const { s, t } = ready();
  s.opp.dist = 2.2; // hips at 300, W 1280: max dist = 980/400 - 0.2 = 2.25
  s.opp.state = 'HURT'; s.opp.stateT = 0;
  run(s, rep(figure(), 30), t);
  assert.ok(s.opp.dist <= 2.25 + 1e-9, `dist ${s.opp.dist}`);
});

test('thumbs up held for 800 ms in READY fires thumbsUp; a normal stance does not', () => {
  const s = createGame(CONFIG);
  let { t } = run(s, rep(figure(), 130), 0);
  assert.equal(s.phase, 'ready');
  const thumbs = figure();
  const w = { x: 300, y: 600 - 0.85 * H, visibility: 1 }; // hand at shoulder height
  thumbs[LM.L_WRIST] = w; thumbs[21] = { x: w.x, y: w.y - 0.1 * H, visibility: 1 }; thumbs[19] = { x: w.x + 0.03 * H, y: w.y + 0.02 * H, visibility: 1 };
  assert.equal(detectThumbsUp(thumbs, s.player.geom, CONFIG), true);
  assert.equal(detectThumbsUp(figure(), s.player.geom, CONFIG), false);
  const { events } = run(s, rep(thumbs, 60), t); // ~1 s
  assert.equal(count(events, 'thumbsUp'), 1);
  const { events: ev2 } = run(s, rep(figure(), 60), t + 1000);
  assert.equal(count(ev2, 'thumbsUp'), 0);
});

test('both fists inside Ryu in the same frame count as one hit', () => {
  const { s, t } = ready();
  const both = punchFrames().map((f) => { const g = f.map((p) => ({ ...p })); g[LM.R_WRIST] = { ...g[LM.L_WRIST] }; return g; });
  const { events } = run(s, both, t);
  assert.equal(count(events, 'oppHit'), 1);
  assert.equal(s.opp.hp, CONFIG.maxHp - 10);
});

test('a hit late in WINDUP damages Ryu but does not cancel his punch', () => {
  const { s, t } = ready('WINDUP');
  s.opp.stateT = CONFIG.windupMs - CONFIG.armorTailMs + 10; // inside the armored tail
  const { events, t: t1 } = run(s, punchFrames(), t);
  assert.equal(count(events, 'oppHit'), 1);
  assert.equal(events.find((e) => e.type === 'oppHit').armored, true);
  assert.equal(s.opp.hp, CONFIG.maxHp - 10);
  assert.notEqual(s.opp.state, 'HURT');
  let t2 = t1; for (let i = 0; i < 40 && s.opp.state !== 'STRIKE'; i++) { t2 += 16; step(s, figure(), t2, undefined, FRAME); }
  assert.equal(s.opp.state, 'STRIKE');
});

test('a single-frame ankle teleport does not register as a kick', () => {
  const { s, t } = ready();
  const frames = [figure(), figure(), figure({ lift: 0.4, footFwd: 0.6 }), figure(), figure()]; // ankle jumps 0.55 H in one frame then returns
  const { events } = run(s, frames, t);
  assert.equal(count(events, 'oppHit'), 0);
});

test('a guard hand beside the cheek or a fist raised for one frame is not a block', () => {
  const { s, t } = ready('WINDUP');
  const cheek = figure(); cheek[LM.L_WRIST] = { x: HIP + 0.08 * H, y: FLOOR - H + 0.05 * H, visibility: 1 }; // near the nose but behind it
  const { events } = run(s, rep(cheek, 25), t);
  assert.equal(count(events, 'block'), 0); assert.equal(count(events, 'playerHit'), 1);
  const { s: s2, t: t2 } = ready('STRIKE');
  const { events: ev2 } = run(s2, rep(figure({ blockHand: true }), 3), t2); // guard appears only as the strike lands
  assert.equal(count(ev2, 'block'), 0); assert.equal(count(ev2, 'playerHit'), 1);
});

test('a hit early in WINDUP interrupts him (no armor yet)', () => {
  const { s, t } = ready('WINDUP');
  const { events } = run(s, punchFrames(), t);
  assert.equal(count(events, 'oppHit'), 1);
  assert.equal(events.find((e) => e.type === 'oppHit').armored, false);
  assert.equal(s.opp.state, 'HURT');
});

test('every 4th attack is thrown from too far and whiffs', () => {
  const { s, t } = ready();
  s.opp.attackNo = 3; s.opp.dist = 1.4; s.opp.state = 'APPROACH'; s.opp.stateT = 0;
  let t1 = t; for (let i = 0; i < 120 && s.opp.state !== 'WINDUP'; i++) { t1 += 16; step(s, figure(), t1, undefined, FRAME); }
  assert.equal(s.opp.state, 'WINDUP');
  assert.ok(s.opp.dist > CONFIG.attackDist + CONFIG.whiffExtra - 0.05, `wound up at ${s.opp.dist}`);
  const { events } = run(s, rep(figure(), 40), t1);
  assert.equal(count(events, 'playerHit'), 0);
});

test('after landing a punch Ryu chains a second one before hopping back', () => {
  const { s, t } = ready('STRIKE');
  let t1 = t; const seen = [];
  for (let i = 0; i < 80; i++) { t1 += 16; step(s, figure(), t1, undefined, FRAME); if (seen[seen.length - 1] !== s.opp.state) seen.push(s.opp.state); }
  assert.deepEqual(seen.slice(0, 5), ['STRIKE', 'RECOVER', 'WINDUP', 'STRIKE', 'RECOVER']);
  assert.ok(seen.includes('HOPBACK'), seen.join(','));
  assert.equal(s.player.hp, CONFIG.maxHp - 2 * CONFIG.oppDmg);
});

test('body lost for a second: Ryu stands down and a paused event fires', () => {
  const { s, t } = ready('HURT');
  const { events } = run(s, rep(null, 70), t);
  assert.equal(count(events, 'paused'), 1);
  assert.equal(s.opp.state, 'IDLE');
});

test('hand raised above the head is an alternative start gesture', () => {
  const s = createGame(CONFIG);
  const { t } = run(s, rep(figure(), 130), 0);
  const up = figure(); up[LM.L_WRIST] = { x: 300, y: 600 - H - 0.2 * H, visibility: 1 };
  assert.equal(detectHandUp(up, s.player.geom, CONFIG), true);
  assert.equal(detectHandUp(figure(), s.player.geom, CONFIG), false);
  const { events } = run(s, rep(up, 40), t);
  assert.equal(count(events, 'thumbsUp'), 1);
});

test('Ryu at point-blank range still hits: the arm box spans body to fist', () => {
  const { s, t } = ready('WINDUP');
  s.opp.dist = 0.35; // player is inside his old fist-tip position
  const { events } = run(s, rep(figure(), 30), t);
  assert.equal(count(events, 'playerHit'), 1);
});

test('the strike lunges forward so a small lean back does not escape', () => {
  const { s, t } = ready('WINDUP');
  const before = s.opp.dist;
  let t1 = t; for (let i = 0; i < 40 && s.opp.state !== 'STRIKE'; i++) { t1 += 16; step(s, figure(), t1, undefined, FRAME); }
  assert.equal(s.opp.state, 'STRIKE');
  assert.ok(Math.abs(before - CONFIG.oppLunge - s.opp.dist) < 1e-9, `dist ${s.opp.dist}`);
});

test('a short fast punch at close range counts (extension gate is 0.12)', () => {
  const { s, t } = ready();
  s.opp.dist = 0.40; // his near edge is 0.25 H from your hips
  const short = [0.14, 0.18, 0.22, 0.22, 0.22, 0.12, 0.05].map((e) => figure({ ext: e })); // 0.08 H in ~50 ms
  const { events } = run(s, short, t);
  assert.equal(count(events, 'oppHit'), 1);
});

test('a punch that reaches Ryu after the arm has slowed still lands (in-flight window)', () => {
  const { s, t } = ready();
  s.opp.dist = 0.75; // just at the edge of reach
  const frames = [0.2, 0.35, 0.5, 0.58, 0.62, 0.64, 0.65, 0.65, 0.5, 0.2].map((e) => figure({ ext: e })); // fast, then decelerates into contact
  const { events } = run(s, frames, t);
  assert.equal(count(events, 'oppHit'), 1);
});

test('Ryu stops at the ring line when the player retreats; STEP FORWARD fires', () => {
  const { s, t } = ready();
  s.opp.dist = 1.0; s.player.lastHip = null;
  const back = figure().map((p) => ({ ...p, x: p.x - 0.8 * H })); // retreat 0.8 H
  const { events } = run(s, rep(back, 120), t); // 2 s
  assert.equal(count(events, 'stepForward'), 1);
  assert.ok(s.opp.dist >= CONFIG.oppMinDist - 1e-9, `dist ${s.opp.dist}`);
  assert.equal(count(events, 'playerHit'), 0);
  assert.equal(s.opp.state, 'IDLE');
});

test('a blocked punch staggers Ryu: long recover, no combo, then hop back', () => {
  const { s, t } = ready('WINDUP');
  let t1 = t; const seen = [];
  for (let i = 0; i < 90; i++) { t1 += 16; step(s, figure({ blockHand: true }), t1, undefined, FRAME); if (seen[seen.length - 1] !== s.opp.state) seen.push(s.opp.state); }
  assert.deepEqual(seen.slice(0, 4), ['WINDUP', 'STRIKE', 'RECOVER', 'HOPBACK'], seen.join(','));
  assert.equal(s.player.hp, CONFIG.maxHp);
});

test('a kick with the far leg counts even when the near ankle is the more visible one', () => {
  const { s, t } = ready();
  s.opp.dist = 0.6;
  // right ankle (less visible: 0.8 vs left 1.0) rises and swings forward
  const frames = [0.05, 0.15, 0.28, 0.36, 0.40, 0.40, 0.30, 0.10, 0.0].map((lift, i) => {
    const f = figure({ lift, footFwd: 0.05 + Math.min(0.5, i * 0.12) });
    f[LM.R_ANKLE] = { ...f[LM.R_ANKLE], visibility: 0.8 };
    return f;
  });
  const { events } = run(s, frames, t);
  const hits = events.filter((e) => e.type === 'oppHit');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].dmg, CONFIG.kickDmg);
});

test('second wind: the first KO blow revives you at 30% once, the second one ends the round', () => {
  const { s, t } = ready('STRIKE');
  s.player.hp = 5;
  const { events, t: t1 } = run(s, rep(figure(), 3), t);
  assert.equal(count(events, 'revive'), 1);
  assert.equal(count(events, 'ko'), 0);
  assert.equal(s.player.hp, Math.round(CONFIG.maxHp * CONFIG.reviveFrac));
  assert.equal(s.opp.state, 'HOPBACK');
  s.player.hp = 5; s.opp.dist = CONFIG.attackDist; s.opp.state = 'STRIKE'; s.opp.stateT = 0; s.opp.struck = false; s.player.hitstunUntil = 0;
  const { events: ev2 } = run(s, rep(figure(), 3), t1 + 2000);
  assert.equal(count(ev2, 'revive'), 0);
  assert.equal(count(ev2, 'ko'), 1);
  assert.equal(s.winner, 'RYU');
});
