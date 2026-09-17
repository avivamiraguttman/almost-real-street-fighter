import { PoseLandmarker, FilesetResolver } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
import { createGame, step, startFight, recalibrate, CONFIG } from './combat.js';
import { loadSprites, drawOpponent, drawHUD, drawEffects, pruneEffects, drawDebug, drawCalibration, drawReady } from './render.js';

const video = document.getElementById('cam');
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const status = document.getElementById('status');
const say = (m) => { status.textContent = m; status.style.display = m ? 'block' : 'none'; };

let state = createGame(CONFIG);
let debug = false, effects = [], jolt = { t0: -1e9, dir: 0 }, sprites = null, landmarker = null, lastVideoT = -1, lmsPx = null;
const frame = { W: 1280, Hc: 720, luma: null, fps: null };
const lumaCanvas = document.createElement('canvas'); lumaCanvas.width = 32; lumaCanvas.height = 18;
const lumaCtx = lumaCanvas.getContext('2d', { willReadFrequently: true });
let fpsT = performance.now(), fpsN = 0;

// --- audio: files are optional, missing ones are silently skipped ---
const SFX = {};
for (const n of ['punch', 'kick', 'hit', 'block', 'ko', 'fight']) { const a = new Audio(`assets/audio/${n}.mp3`); a.preload = 'auto'; a.onerror = () => { SFX[n] = null; }; SFX[n] = a; }
const music = new Audio('assets/audio/music.mp3'); music.loop = true; music.volume = 0.35; music.onerror = () => {};
const play = (n) => { const a = SFX[n]; if (!a) return; try { const c = a.cloneNode(); c.volume = 0.9; c.play().catch(() => {}); } catch (e) {} };

// browsers block audio until the page has had a click or key press; unlock on the first one
let audioUnlocked = false;
function unlockAudio() { if (audioUnlocked) return; audioUnlocked = true; music.play().then(() => { if (state.phase !== 'fighting') music.pause(); }).catch(() => {}); }
document.addEventListener('keydown', unlockAudio, { once: true }); document.addEventListener('pointerdown', unlockAudio, { once: true });

// --- gameplay recorder: one compact row per frame + all events; downloaded on KO or with L ---
let rec = null;
function startRec() { rec = { startedAt: new Date().toISOString(), cfg: { ...CONFIG }, lock: { ...state.lock }, W: frame.W, Hc: frame.Hc, frames: [], events: [] }; }
function record(now, events) {
  if (!rec || state.phase !== 'fighting' && state.phase !== 'ko') return;
  const p = state.player, o = state.opp, d = p.debug || { ext: {}, vx: {} };
  rec.frames.push([Math.round(now), state.phase[0], p.hp, o.hp, o.state, +o.dist.toFixed(3), +(p.offset ?? 0).toFixed(3), p.outOfZone ? 1 : 0, p.blocking ? 1 : 0, state.noBody ? 1 : 0,
    +(d.ext[15] ?? 0).toFixed(2), +(d.vx[15] ?? 0).toFixed(2), +(d.ext[16] ?? 0).toFixed(2), +(d.vx[16] ?? 0).toFixed(2), +(d.lift ?? 0).toFixed(2), +(d.avx ?? 0).toFixed(2),
    lmsPx ? lmsPx.map((q) => [Math.round(q.x), Math.round(q.y), +q.visibility.toFixed(2)]) : null]);
  for (const e of events) rec.events.push({ t: Math.round(now), ...e });
}
function downloadRec() {
  if (!rec || !rec.frames.length) return;
  const blob = new Blob([JSON.stringify(rec)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `fightlog-${rec.startedAt.replace(/[:.]/g, '-')}.json`; a.click();
}
document.addEventListener('keydown', (e) => { if (e.key === 'l' || e.key === 'L') downloadRec(); });

function beginFight() {
  if (!startFight(state)) return;
  startRec();
  effects = []; play('fight');
  music.currentTime = 0; music.play().catch(() => {});
}
document.addEventListener('keydown', (e) => {
  if (e.code === 'Space') { e.preventDefault(); if (state.phase === 'ready' || state.phase === 'ko') beginFight(); }
  if (e.key === 'r' || e.key === 'R') { if (state.lock) { state.phase = 'ready'; effects = []; music.pause(); } else { state = createGame(CONFIG); } }
  if (e.key === 'c' || e.key === 'C') { recalibrate(state); effects = []; music.pause(); }
  if (e.key === 'd' || e.key === 'D') { debug = !debug; document.getElementById('panel').style.display = debug ? 'block' : 'none'; }
});

// tuning sliders bound straight into CONFIG (state.cfg is the same object)
const sliders = [['punchSpeed', 0.3, 4, 0.1], ['punchExt', 0.1, 0.6, 0.01], ['kickSpeed', 0.3, 4, 0.1], ['attackDist', 0.3, 1.2, 0.01], ['windupMs', 150, 1200, 10], ['approachSpeed', 0.2, 2, 0.05], ['visMin', 0.1, 0.95, 0.05]];
const panel = document.getElementById('panel');
for (const [k, min, max, st] of sliders) {
  const row = document.createElement('label'); row.innerHTML = `<span>${k}</span><input type=range min=${min} max=${max} step=${st} value=${CONFIG[k]}><b>${CONFIG[k]}</b>`;
  row.querySelector('input').oninput = (e) => { CONFIG[k] = +e.target.value; row.querySelector('b').textContent = CONFIG[k]; };
  panel.appendChild(row);
}

async function init() {
  try {
    say('Loading pose model...');
    const [vision, spr] = await Promise.all([FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'), loadSprites().catch((e) => { console.warn('sprites failed', e); return null; })]);
    sprites = spr;
    landmarker = await PoseLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task', delegate: 'GPU' },
      runningMode: 'VIDEO', numPoses: 1,
    });
    say('Requesting camera...');
    const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' }, audio: false });
    video.srcObject = stream;
    await new Promise((r) => (video.onloadedmetadata = r));
    await video.play();
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    frame.W = canvas.width; frame.Hc = canvas.height;
    say('');
    requestAnimationFrame(loop);
  } catch (e) {
    say('Could not start: ' + (e && e.message ? e.message : e) + '. Allow the camera and reload.');
    console.error(e);
  }
}

function loop() {
  const now = performance.now();
  const W = canvas.width, Hc = canvas.height;
  if (video.currentTime !== lastVideoT) {
    lastVideoT = video.currentTime;
    const res = landmarker.detectForVideo(video, now);
    const lm = res.landmarks && res.landmarks[0];
    lmsPx = lm ? lm.map((p) => ({ x: p.x * W, y: p.y * Hc, visibility: p.visibility })) : null;
    fpsN++; if (now - fpsT >= 1000) { frame.fps = (fpsN * 1000) / (now - fpsT); fpsN = 0; fpsT = now; }
    if (state.phase === 'calibrate' && (fpsN % 5) === 0) { // mean luma of a 32x18 downscale
      lumaCtx.drawImage(video, 0, 0, 32, 18); const d = lumaCtx.getImageData(0, 0, 32, 18).data; let s = 0;
      for (let i = 0; i < d.length; i += 4) s += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      frame.luma = s / (d.length / 4);
    }
  }
  const events = step(state, lmsPx, now, undefined, frame);
  for (const e of events) {
    if (e.type === 'oppHit') { play(e.dmg >= CONFIG.kickDmg ? 'kick' : 'punch'); effects.push({ type: 'spark', t0: now, x: e.x, y: e.y }, { type: 'popup', t0: now, x: e.x, y: e.y - 30, text: `-${e.dmg}`, color: '#ffd400' }); }
    if (e.type === 'playerHit') { play('hit'); effects.push({ type: 'spark', t0: now, x: e.x, y: e.y }, { type: 'popup', t0: now, x: e.x, y: e.y - 30, text: `-${e.dmg}`, color: '#ff5a5a' }, { type: 'flash', t0: now }); jolt = { t0: now, dir: e.dir }; }
    if (e.type === 'ko') { play('ko'); music.pause(); setTimeout(downloadRec, 300); }
    if (e.type === 'thumbsUp') beginFight();
    if (e.type === 'stepBack') play('block');
    if (e.type === 'block') { play('block'); } if (e.type === 'block') effects.push({ type: 'popup', t0: now, x: e.x, y: e.y - 30, text: 'BLOCK', color: '#7cf' });
  }
  effects = pruneEffects(effects, now);
  record(now, events);

  // video layer with knockback jolt
  const ja = Math.max(0, 1 - (now - jolt.t0) / 300);
  const jx = jolt.dir * 30 * ja * ja;
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, Hc);
  ctx.drawImage(video, jx, 0, W, Hc);

  if (state.player.geom && state.boxes && state.phase !== 'calibrate') drawOpponent(ctx, sprites, state.opp, state.boxes, state.player.facing, state.player.H, now);
  drawEffects(ctx, W, Hc, effects, now);
  drawHUD(ctx, W, state, CONFIG);
  if (state.phase === 'calibrate') drawCalibration(ctx, W, Hc, state, lmsPx);
  if (state.phase === 'ready') drawReady(ctx, W, Hc, state);
  if (debug && lmsPx) drawDebug(ctx, lmsPx, state);
  requestAnimationFrame(loop);
}

init();
