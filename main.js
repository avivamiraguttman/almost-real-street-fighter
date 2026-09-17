import { PoseLandmarker, FilesetResolver } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
import { createGame, step, CONFIG } from './combat.js';
import { loadSprites, drawOpponent, drawHUD, drawEffects, pruneEffects, drawDebug } from './render.js';

const video = document.getElementById('cam');
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const status = document.getElementById('status');
const say = (m) => { status.textContent = m; status.style.display = m ? 'block' : 'none'; };

let state = createGame(CONFIG);
let debug = false, effects = [], jolt = { t0: -1e9, dir: 0 }, sprites = null, landmarker = null, lastVideoT = -1, lmsPx = null;

document.addEventListener('keydown', (e) => {
  if (e.key === 'r' || e.key === 'R') { state = createGame(CONFIG); effects = []; }
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
  }
  const events = step(state, lmsPx, now);
  for (const e of events) {
    if (e.type === 'oppHit') { effects.push({ type: 'spark', t0: now, x: e.x, y: e.y }, { type: 'popup', t0: now, x: e.x, y: e.y - 30, text: `-${e.dmg}`, color: '#ffd400' }); }
    if (e.type === 'playerHit') { effects.push({ type: 'spark', t0: now, x: e.x, y: e.y }, { type: 'popup', t0: now, x: e.x, y: e.y - 30, text: `-${e.dmg}`, color: '#ff5a5a' }, { type: 'flash', t0: now }); jolt = { t0: now, dir: e.dir }; }
    if (e.type === 'block') effects.push({ type: 'popup', t0: now, x: e.x, y: e.y - 30, text: 'BLOCK', color: '#7cf' });
  }
  effects = pruneEffects(effects, now);

  // video layer with knockback jolt
  const ja = Math.max(0, 1 - (now - jolt.t0) / 300);
  const jx = jolt.dir * 30 * ja * ja;
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, Hc);
  ctx.drawImage(video, jx, 0, W, Hc);

  if (state.player.geom && state.boxes && state.phase !== 'calibrating') drawOpponent(ctx, sprites, state.opp, state.boxes, state.player.facing, state.player.H, now);
  drawEffects(ctx, W, Hc, effects, now);
  drawHUD(ctx, W, state, CONFIG);
  if (debug && lmsPx) drawDebug(ctx, lmsPx, state);
  requestAnimationFrame(loop);
}

init();
