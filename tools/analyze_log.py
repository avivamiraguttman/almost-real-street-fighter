#!/usr/bin/env python3
"""Analyze a FightCam gameplay log (fightlog-*.json downloaded on KO or with L).
Usage: python3 tools/analyze_log.py ~/Downloads/fightlog-*.json
Frame row: [t, phase, hp, oppHp, oppState, dist, offset, outOfZone, blocking, noBody,
            ext15, vx15, ext16, vx16, lift, avx, landmarks]"""
import json, sys, statistics as st
from collections import Counter

def pct(a, b): return f"{100*a/b:.0f}%" if b else "n/a"

def analyze(path):
    d = json.load(open(path))
    F, E, cfg = d["frames"], d["events"], d["cfg"]
    if not F: print("empty log"); return
    t0, t1 = F[0][0], F[-1][0]
    dur = (t1 - t0) / 1000
    print(f"== {path}\nround: {dur:.1f}s, {len(F)} frames ({len(F)/dur:.0f} fps), lock H={d['lock'].get('H'):.0f}px facing={d['lock'].get('facing')}")
    ev = Counter(e["type"] for e in E)
    print(f"events: {dict(ev)}")
    hits = [e for e in E if e["type"] == "oppHit"]; taken = [e for e in E if e["type"] == "playerHit"]
    swings = [e for e in E if e["type"] == "swing"]
    print(f"you: {len(hits)} hits landed ({sum(e['dmg'] for e in hits)} dmg), {len(swings)} swings that did not count, {ev['block']} blocks")
    print(f"ryu: {len(taken)} hits landed on you ({sum(e['dmg'] for e in taken)} dmg)")
    if swings:
        print("  missed swings by reason:", dict(Counter(e["reason"] for e in swings)))
        rng = [e for e in swings if e["reason"] == "range"]
        if rng: print(f"  range misses: gap median {st.median(e['gap'] for e in rng):.2f}H (attackDist {cfg['attackDist']}), ext median {st.median(e['ext'] for e in rng):.2f}")
    # cadence of landed hits: spam indicator
    if len(hits) > 1:
        gaps = [(b["t"] - a["t"]) / 1000 for a, b in zip(hits, hits[1:])]
        print(f"  gap between your landed hits: median {st.median(gaps):.2f}s, min {min(gaps):.2f}s  (spam if median < ~1s)")
    # opponent state time
    states = Counter(); prev = None
    for row in F:
        if prev is not None: states[prev[4]] += row[0] - prev[0]
        prev = row
    print("ryu time in state:", {k: f"{v/1000:.1f}s" for k, v in states.most_common()})
    oz = sum(1 for r in F if r[7]); nb = sum(1 for r in F if r[9]); bl = sum(1 for r in F if r[8])
    print(f"frames out of home zone: {pct(oz, len(F))}   no body / rejected: {pct(nb, len(F))}   blocking: {pct(bl, len(F))}")
    offs = [r[6] for r in F]
    print(f"your offset from home: min {min(offs):.2f}H max {max(offs):.2f}H (zoneFwd {cfg['zoneFwd']})")
    dists = [r[5] for r in F]
    print(f"ryu dist: min {min(dists):.2f}H max {max(dists):.2f}H")
    # punch velocity peaks: what did your fastest wrist motions look like vs thresholds
    for wid, (ei, vi) in {"L wrist(15)": (10, 11), "R wrist(16)": (12, 13)}.items():
        vx = [r[vi] for r in F if r[vi] > 0.3]
        if vx:
            vx.sort()
            print(f"{wid}: frames with forward speed >0.3: {len(vx)}, p50 {vx[len(vx)//2]:.2f} p90 {vx[int(len(vx)*.9)]:.2f} max {vx[-1]:.2f} H/s (punchSpeed {cfg['punchSpeed']})")
    # wrist visibility
    vis = Counter()
    for r in F:
        lm = r[16]
        if lm: vis["L"] += lm[15][2] >= cfg["visMin"]; vis["R"] += lm[16][2] >= cfg["visMin"]; vis["n"] += 1
    if vis["n"]: print(f"wrist visible >= {cfg['visMin']}: L {pct(vis['L'], vis['n'])}  R {pct(vis['R'], vis['n'])}")
    jumps = [e for e in E if e["type"] == "poseJump"]
    if jumps: print(f"pose teleports rejected: {len(jumps)} (someone else in frame?) max jump {max(e['jump'] for e in jumps):.2f}H")
    # timeline
    print("timeline:")
    for e in E:
        if e["type"] in ("oppHit", "playerHit", "block", "ko", "stepBack"):
            print(f"  {(e['t']-t0)/1000:6.2f}s {e['type']:<10} {e.get('dmg','')}")

for p in sys.argv[1:]: analyze(p)
