// Renderer smoke test with a fake 2D context: catches ReferenceErrors and bad frame names
// on every screen (title, calibration, ready, fighting, both K.O. endings). The real canvas
// cannot run under node, so every ctx method is a no-op that records the call.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame, step, startFight, CONFIG, LM } from '../combat.js';
import * as R from '../render.js';
import fs from 'node:fs';

globalThis.performance = globalThis.performance || { now: () => Date.now() };
const frames = JSON.parse(fs.readFileSync(new URL('../assets/ryu.json', import.meta.url)));
function fakeCtx() {
  const calls = {};
  const ctx = new Proxy({}, {
    get: (t, k) => (k in t ? t[k] : (...a) => { calls[k] = (calls[k] || 0) + 1; if (k === 'createLinearGradient') return { addColorStop() {} }; return undefined; }),
    set: (t, k, v) => { t[k] = v; return true; },
  });
  return { ctx, calls };
}
const H = 400, FLOOR = 600, HIP = 300, FR = { W: 1280, Hc: 720, luma: 120, fps: 60 };
function fig(ext = 0.1) {
  const l = Array.from({ length: 33 }, () => ({ x: HIP, y: FLOOR - 200, visibility: 1 }));
  l[LM.NOSE] = { x: HIP + 40, y: FLOOR - H, visibility: 1 }; l[11] = l[12] = { x: HIP, y: FLOOR - 320, visibility: 1 };
  l[23] = l[24] = { x: HIP, y: FLOOR - 200, visibility: 1 }; l[15] = { x: HIP + ext * H, y: FLOOR - 300, visibility: 1 };
  l[16] = { x: HIP + 40, y: FLOOR - 300, visibility: 0.3 }; l[27] = { x: HIP - 20, y: FLOOR, visibility: 1 }; l[28] = { x: HIP + 20, y: FLOOR, visibility: 1 };
  return l;
}
const fakeSprites = { sheet: {}, frames };
function drawAll(s, t, lms) {
  const { ctx } = fakeCtx();
  if (s.player.geom && s.boxes && s.phase !== 'calibrate') R.drawOpponent(ctx, fakeSprites, s.opp, s.boxes, s.player.facing, s.player.H, t, s.winner, 0.88);
  R.drawEffects(ctx, 1280, 720, [{ type: 'flash', t0: t - 50 }, { type: 'spark', t0: t - 50, x: 1, y: 1 }, { type: 'popup', t0: t - 50, x: 1, y: 1, text: '-10' }], t);
  R.drawHUD(ctx, 1280, 720, s, CONFIG);
  if (s.phase === 'calibrate') R.drawCalibration(ctx, 1280, 720, s, lms);
  if (s.phase === 'ready') R.drawReady(ctx, 1280, 720, s);
  R.drawDebug(ctx, lms, s);
  R.drawTitleScreen(ctx, 1280, 720, t);
}
function frameNamesResolve(opp, winner) {
  for (let t = 0; t < 3000; t += 40) { const n = R.frameFor({ ...opp, stateT: t }, t, winner); assert.ok(frames[n], `frame ${n} missing for ${opp.state}`); }
}

test('every screen renders without throwing, including both K.O. endings', () => {
  for (const loser of ['player', 'ryu']) {
    const s = createGame(CONFIG); let t = 0;
    drawAll(s, t, null); drawAll(s, t, fig());
    for (let i = 0; i < 130; i++) { t += 16; step(s, fig(), t, undefined, FR); if (i % 40 === 0) drawAll(s, t, fig()); }
    assert.equal(s.phase, 'ready'); drawAll(s, t, fig());
    startFight(s); drawAll(s, t, fig());
    if (loser === 'player') { s.player.hp = 10; s.player.revived = true; s.opp.dist = CONFIG.attackDist; s.opp.state = 'STRIKE'; s.opp.stateT = 0; } else { s.opp.hp = 5; s.opp.dist = CONFIG.attackDist; }
    let ko = false;
    for (let i = 0; i < 200 && !ko; i++) { t += 16; const ev = step(s, fig(loser === 'ryu' ? 0.2 + 0.1 * (i % 6) : 0.1), t, undefined, FR); drawAll(s, t, fig()); ko = ev.some((e) => e.type === 'ko'); }
    assert.equal(s.phase, 'ko', `${loser} should have lost`);
    for (let k = 0; k < 30; k++) { t += 16; step(s, fig(), t, undefined, FR); drawAll(s, t, fig()); }
    assert.equal(s.opp.state, loser === 'player' ? 'WIN' : 'KO');
    frameNamesResolve(s.opp, s.winner);
  }
});

test('all opponent states map to real sprite frames', () => {
  for (const st of ['IDLE', 'APPROACH', 'WINDUP', 'STRIKE', 'RECOVER', 'HOPBACK', 'HURT', 'KO', 'WIN']) frameNamesResolve({ state: st }, 'YOU');
});
