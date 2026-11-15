#!/usr/bin/env python3
"""
generate_mock_telemetry.py
──────────────────────────
Standalone script (requires ONLY standard library + numpy) that generates
realistic mock basketball telemetry data for the Basketball Stream Tracker MVP.

Outputs:
  web/public/roster.json     - Player metadata matching Section 4.1
  web/public/telemetry.json  - 450 frames @ 30 FPS matching Section 4.2
"""

import json
import os
import pathlib
import numpy as np

# ──────────────────────────── constants ────────────────────────────
COURT_W, COURT_H = 2865, 1524          # cm (NBA court)
VIDEO_W, VIDEO_H = 1920, 1080          # px
NUM_FRAMES = 450
FPS = 30.0
NOISE_SIGMA = 15.0                      # cm
INTERPOLATED_FRAC = 0.04                # ~4% frames flagged as interpolated

PROJECT_ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT_DIR = PROJECT_ROOT / "web" / "public"

# ──────────────────────────── roster ──────────────────────────────
ROSTER_DATA = {
    "match_info": {
        "home_team": { "code": "BOS", "name": "Boston Celtics", "color": "#007A33", "accent": "#BA9653" },
        "away_team": { "code": "NYK", "name": "New York Knicks", "color": "#F58426", "accent": "#006BB6" }
    },
    "players": {
        "1": { "id": 1, "name": "Jayson Tatum", "shortName": "TATUM", "number": "0", "team": "BOS", "position": "SF" },
        "2": { "id": 2, "name": "Jaylen Brown", "shortName": "BROWN", "number": "7", "team": "BOS", "position": "SG" },
        "3": { "id": 3, "name": "Jrue Holiday", "shortName": "HOLIDAY", "number": "4", "team": "BOS", "position": "PG" },
        "4": { "id": 4, "name": "Derrick White", "shortName": "WHITE", "number": "9", "team": "BOS", "position": "SG" },
        "5": { "id": 5, "name": "Al Horford", "shortName": "HORFORD", "number": "42", "team": "BOS", "position": "C" },
        "6": { "id": 6, "name": "Jalen Brunson", "shortName": "BRUNSON", "number": "11", "team": "NYK", "position": "PG" },
        "7": { "id": 7, "name": "Karl-Anthony Towns", "shortName": "TOWNS", "number": "32", "team": "NYK", "position": "C" },
        "8": { "id": 8, "name": "Mikal Bridges", "shortName": "BRIDGES", "number": "25", "team": "NYK", "position": "SF" },
        "9": { "id": 9, "name": "OG Anunoby", "shortName": "ANUNOBY", "number": "8", "team": "NYK", "position": "PF" },
        "10": { "id": 10, "name": "Josh Hart", "shortName": "HART", "number": "3", "team": "NYK", "position": "SG" }
    }
}

# ──────────────────────── movement profiles ───────────────────────
def _get_movement_profile(pid: int, team: str, pos: str):
    """Return (base_x, base_y, orbit_rx, orbit_ry, freq) in court cm."""
    mid_x = COURT_W / 2.0  # 1432.5 cm
    freq_base = 0.5 + 0.12 * (pid - 1)

    if team == "BOS":
        # Attacking the right basket (hoop at ~2705 cm)
        if pos == "PG":
            return (mid_x + 550, COURT_H / 2.0, 320, 240, freq_base * 1.2)
        elif pos == "SG":
            return (mid_x + 700, COURT_H * 0.28 if pid == 2 else COURT_H * 0.72, 280, 190, freq_base * 1.05)
        elif pos == "SF":
            return (mid_x + 650, COURT_H * 0.40, 360, 260, freq_base)
        elif pos == "C":
            return (mid_x + 950, COURT_H / 2.0, 160, 120, freq_base * 0.7)
        else:  # PF
            return (mid_x + 780, COURT_H * 0.60, 220, 170, freq_base * 0.85)
    else:
        # NYK defending the right basket / active half
        if pos == "PG":
            return (mid_x + 480, COURT_H / 2.0, 290, 230, freq_base * 1.18)
        elif pos == "SG":
            return (mid_x + 640, COURT_H * 0.74, 270, 180, freq_base * 1.08)
        elif pos == "SF":
            return (mid_x + 580, COURT_H * 0.38, 330, 240, freq_base)
        elif pos == "PF":
            return (mid_x + 720, COURT_H * 0.58, 210, 160, freq_base * 0.88)
        else:  # C (Towns protecting paint)
            return (mid_x + 920, COURT_H / 2.0, 150, 110, freq_base * 0.72)


# ───────────────────── coordinate transforms ─────────────────────
def court_to_video(cx: float, cy: float):
    """
    Simulate camera perspective mapping court coords (cm) to video broadcast frame (px).
    Perspective effect: players further up in Y appear higher and slightly compressed.
    """
    # Perspective normalized coordinates
    norm_x = cx / COURT_W
    norm_y = cy / COURT_H

    # Camera looking at half court with high broadcast perspective angle
    vx = 200 + norm_x * (VIDEO_W - 400) + (norm_y - 0.5) * 80
    vy = 380 + norm_y * 580

    return vx, vy


def make_polygon(vx: float, vy: float, bw: float, bh: float, rng):
    """
    Generate an 8-12 vertex simplified player contour around feet / center.
    Simulates SAM 2 approxPolyDP contour output.
    """
    n_verts = rng.integers(8, 13)
    angles = np.sort(rng.uniform(0, 2 * np.pi, n_verts))
    top_y = vy - bh
    center_y = top_y + bh * 0.5
    poly = []
    for a in angles:
        rx = (bw * 0.5) * rng.uniform(0.70, 1.0)
        ry = (bh * 0.5) * rng.uniform(0.75, 1.0)
        px = vx + rx * np.cos(a)
        py = center_y + ry * np.sin(a)
        poly.append([round(float(px), 1), round(float(py), 1)])
    return poly


# ──────────────────────────── main ────────────────────────────────
def generate():
    rng = np.random.default_rng(2026)
    players_list = list(ROSTER_DATA["players"].values())

    # Precompute smooth trajectories
    t = np.arange(NUM_FRAMES) / FPS  # seconds
    trajectories = {}

    for p in players_list:
        pid = p["id"]
        bx, by, orx, ory, freq = _get_movement_profile(pid, p["team"], p["position"])
        phase = rng.uniform(0, 2 * np.pi)

        # Sinusoidal motion + cut actions
        xs = bx + orx * np.sin(freq * t + phase) + rng.normal(0, NOISE_SIGMA, NUM_FRAMES)
        ys = by + ory * np.cos(freq * t * 0.75 + phase) + rng.normal(0, NOISE_SIGMA, NUM_FRAMES)

        # Smooth raw curves slightly to simulate realistic player movement
        kernel = np.ones(5) / 5.0
        xs = np.convolve(xs, kernel, mode="same")
        ys = np.convolve(ys, kernel, mode="same")

        # Clamp strictly to court bounds
        xs = np.clip(xs, 60.0, COURT_W - 60.0)
        ys = np.clip(ys, 60.0, COURT_H - 60.0)
        trajectories[pid] = (xs, ys)

    # Randomly select a few short occlusion segments for is_interpolated demonstration
    interpolated_flags = np.zeros((NUM_FRAMES, len(players_list)), dtype=bool)
    for pi in range(len(players_list)):
        # 1 or 2 small gaps of 6-12 frames per player
        num_gaps = rng.integers(1, 3)
        for _ in range(num_gaps):
            start = rng.integers(30, NUM_FRAMES - 30)
            gap_len = rng.integers(6, 14)
            interpolated_flags[start:start + gap_len, pi] = True

    # Build frame-by-frame telemetry
    frames = []
    for fi in range(NUM_FRAMES):
        timestamp = round(fi / FPS, 4)
        frame_players = []

        for pi, p in enumerate(players_list):
            pid = p["id"]
            cx = float(trajectories[pid][0][fi])
            cy = float(trajectories[pid][1][fi])

            # Calculate instantaneous speed in km/h
            if fi == 0:
                speed_kmh = 12.5
            else:
                prev_cx = float(trajectories[pid][0][fi - 1])
                prev_cy = float(trajectories[pid][1][fi - 1])
                dist_cm = np.sqrt((cx - prev_cx)**2 + (cy - prev_cy)**2)
                speed_ms = (dist_cm / 100.0) * FPS
                speed_kmh = round(speed_ms * 3.6, 1)

            # Map to video coordinate space
            vx, vy = court_to_video(cx, cy)
            bw = float(rng.integers(60, 85))
            bh = float(rng.integers(155, 210))

            # Bounding box [x1, y1, x2, y2]
            bbox = [
                round(vx - bw * 0.5, 1),
                round(vy - bh, 1),
                round(vx + bw * 0.5, 1),
                round(vy, 1)
            ]
            feet_video_xy = [round(vx, 1), round(vy, 1)]
            polygon = make_polygon(vx, vy, bw, bh, rng)

            player_frame = {
                "id": pid,
                "bbox": bbox,
                "feet_video_xy": feet_video_xy,
                "polygon": polygon,
                "court_xy": [round(cx, 1), round(cy, 1)],
                "speed_kmh": speed_kmh,
                "is_interpolated": bool(interpolated_flags[fi, pi])
            }
            frame_players.append(player_frame)

        frames.append({
            "frame_idx": fi,
            "timestamp": timestamp,
            "homography_valid": True,
            "players": frame_players
        })

    telemetry = {
        "metadata": {
            "video_width": VIDEO_W,
            "video_height": VIDEO_H,
            "fps": FPS,
            "total_frames": NUM_FRAMES,
            "court_width": COURT_W,
            "court_height": COURT_H,
            "court_unit": "cm"
        },
        "frames": frames
    }

    # Write output files
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    roster_path = OUT_DIR / "roster.json"
    telemetry_path = OUT_DIR / "telemetry.json"

    with open(roster_path, "w", encoding="utf-8") as f:
        json.dump(ROSTER_DATA, f, indent=2)

    with open(telemetry_path, "w", encoding="utf-8") as f:
        json.dump(telemetry, f, separators=(",", ":"))

    print(f"Generated roster.json with {len(ROSTER_DATA['players'])} players")
    print(f"Generated telemetry.json with {NUM_FRAMES} frames, 10 players each")


if __name__ == "__main__":
    generate()
