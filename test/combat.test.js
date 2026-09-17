import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, step, CONFIG, LM } from '../combat.js';

const H = 400, FLOOR = 600, HIP = 300;
// Standing side-profile figure facing +x. Overrides are in H units relative to shoulder / floor.
function figure({ ext = 0.1, wristY = -0.75, lift = 0, footFwd = 0.05, blockHand = false } = {}) {
  const lms = Array.from({ length: 33 }, () => ({ x: HIP, y: FLOOR - 0.5 * H, visibility: 1 }));
  const shoulderX = HIP, shoulderY = FLOOR - 0.8 * H;
  lms[LM.NOSE] = { x: HIP + 0.1 * H, y: FLOOR - H, visibility: 1 };
  lms[LM.L_SHOULDER] = lms[LM.R_SHOULDER] = { x: shoulderX, y: shoulderY, visibility: 1 };
  lms[LM.L_HIP] = lms[LM.R_HIP] = { x: HIP, y: FLOOR - 0.5 * H, visibility: 1 };
  const wr = blockHand
    ? { x: HIP + 0.1 * H, y: FLOOR - H + 0.05 * H, visibility: 1 }
    : { x: shoulderX + ext * H, y: FLOOR + wristY * H, visibility: 1 };
  lms[LM.L_WRIST] = wr; lms[LM.R_WRIST] = { x: shoulderX + 0.1 * H, y: FLOOR - 0.75 * H, visibility: 0.3 };
  lms[LM.L_ANKLE] = { x: HIP - 0.05 * H, y: FLOOR, visibility: 1 };
  lms[LM.R_ANKLE] = { x: HIP + footFwd * H, y: FLOOR - lift * H, visibility: 1 };
  return lms;
}

function run(state, frames, t0) {
  const events = []; let t = t0;
  for (const lms of frames) { t += 16; events.push(...step(state, lms, t)); }
  return { events, t };
}
const rep = (lms, n) => Array.from({ length: n }, () => lms);
function ready(oppState = 'IDLE') {
  const s = createGame(CONFIG);
  let { t } = run(s, rep(figure(), 130), 0); // 2.08 s calibration
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
  assert.equal(s.opp.hp, 90);
  assert.equal(s.opp.state === 'HURT' || s.opp.state === 'IDLE', true);
});

test('slow extension registers zero hits', () => {
  const { s, t } = ready();
  const frames = Array.from({ length: 60 }, (_, i) => figure({ ext: 0.1 + (0.5 * i) / 60 })); // ~0.5 H/s
  const { events } = run(s, frames, t);
  assert.equal(count(events, 'oppHit'), 0);
  assert.equal(s.opp.hp, 100);
});

test('block during opponent strike gives zero damage and a block event', () => {
  const { s, t } = ready('STRIKE');
  const { events } = run(s, rep(figure({ blockHand: true }), 3), t);
  assert.equal(count(events, 'block'), 1);
  assert.equal(count(events, 'playerHit'), 0);
  assert.equal(s.player.hp, 100);
});

test('unblocked opponent strike does 10 damage', () => {
  const { s, t } = ready('STRIKE');
  const { events } = run(s, rep(figure(), 3), t);
  assert.equal(count(events, 'playerHit'), 1);
  assert.equal(s.player.hp, 90);
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

test('opponent hops back after a landed strike, idles after a miss', () => {
  const { s, t } = ready('STRIKE');
  run(s, rep(figure(), 40), t); // strike 150 + recover 400 -> HOPBACK
  assert.equal(s.opp.state, 'HOPBACK');
  assert.ok(s.opp.dist > CONFIG.attackDist);

  const { s: s2, t: t2 } = ready('STRIKE');
  s2.opp.dist = 1.5; // out of reach
  run(s2, rep(figure(), 40), t2);
  assert.equal(s2.player.hp, 100);
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
