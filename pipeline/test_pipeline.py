#!/usr/bin/env python3
"""
test_pipeline.py — Offline end-to-end check of the telemetry pipeline.

Renders a synthetic clip (panning camera, six coloured "players" on a known
court) and runs process_video with stub detectors in place of the Roboflow
models, so no API key or GPU is needed. Tracking (ByteTrack), homography,
track consolidation, smoothing, team clustering and file output are all real.

    python test_pipeline.py
"""

from __future__ import annotations

import json
import math
import sys
import tempfile
from pathlib import Path

import cv2
import numpy as np
import supervision as sv

from extract_telemetry import ByteTrackTracker, process_video
from track_utils import DEFAULT_MATCH_INFO, NBA_COURT_VERTICES_CM

W, H, FPS, N_FRAMES = 1280, 720, 30, 90
VERTICES = np.asarray(NBA_COURT_VERTICES_CM, dtype=np.float32)
KEYPOINT_DROPOUT = range(40, 46)      # frames with no court landmarks
OCCLUDED_PLAYER, OCCLUSION = 2, range(30, 42)
TEAM_BGR = {"BOS": (60, 140, 20), "NYK": (190, 100, 10)}   # green-ish / blue-ish
TEAMS = ["BOS", "NYK", "BOS", "NYK", "BOS", "NYK"]


def court_to_pixel_matrix(frame_idx: int) -> np.ndarray:
    """Broadcast-like view of the left half court that pans right over time."""
    pan = 6.0 * frame_idx
    court = np.float32([[0, 0], [1600, 0], [1600, 1524], [0, 1524]])
    pixel = np.float32([[260 - pan, 230], [1180 - pan, 230], [1500 - pan, 690], [-60 - pan, 690]])
    return cv2.getPerspectiveTransform(court, pixel)


def project(matrix: np.ndarray, points: np.ndarray) -> np.ndarray:
    return cv2.perspectiveTransform(np.float32(points).reshape(-1, 1, 2), matrix).reshape(-1, 2)


def true_court_xy(player: int, frame_idx: int) -> np.ndarray:
    t = frame_idx / FPS
    cx, cy = 450 + 170 * player, 300 + 180 * player
    return np.array([cx + 120 * math.sin(0.9 * t + player), cy + 90 * math.cos(0.7 * t + 2 * player)])


def player_boxes(frame_idx: int) -> dict[int, np.ndarray]:
    matrix = court_to_pixel_matrix(frame_idx)
    boxes = {}
    for player in range(6):
        if player == OCCLUDED_PLAYER and frame_idx in OCCLUSION:
            continue
        fx, fy = project(matrix, [true_court_xy(player, frame_idx)])[0]
        height = 60 + 0.12 * fy
        boxes[player] = np.array([fx - height * 0.2, fy - height, fx + height * 0.2, fy])
    return boxes


class StubPlayerDetector:
    def __init__(self):
        self.frame_idx = 0

    def detect(self, frame: np.ndarray) -> sv.Detections:
        boxes = list(player_boxes(self.frame_idx).values())
        self.frame_idx += 1
        return sv.Detections(
            xyxy=np.asarray(boxes, dtype=np.float32),
            confidence=np.full(len(boxes), 0.9, dtype=np.float32),
            class_id=np.full(len(boxes), 3, dtype=int),
        )


class StubCourtDetector:
    def __init__(self):
        self.frame_idx = 0

    def detect(self, frame: np.ndarray):
        idx = self.frame_idx
        self.frame_idx += 1
        xy = project(court_to_pixel_matrix(idx), VERTICES)
        visible = (xy[:, 0] >= 0) & (xy[:, 0] < W) & (xy[:, 1] >= 0) & (xy[:, 1] < H)
        confidence = np.where(visible, 0.9, 0.1).astype(np.float32)
        if idx in KEYPOINT_DROPOUT:
            confidence[:] = 0.1
        return xy.astype(np.float32), confidence


def render_clip(path: Path) -> None:
    writer = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"mp4v"), FPS, (W, H))
    for frame_idx in range(N_FRAMES):
        frame = np.full((H, W, 3), (70, 110, 150), dtype=np.uint8)
        for player, box in player_boxes(frame_idx).items():
            x1, y1, x2, y2 = (int(round(v)) for v in box)
            cv2.rectangle(frame, (x1, y1), (x2, y2), TEAM_BGR[TEAMS[player]], -1)
        writer.write(frame)
    writer.release()


def check(name: str, condition: bool, detail: str = "") -> bool:
    print(f"  {'PASS' if condition else 'FAIL'}  {name}{' — ' + detail if detail else ''}")
    return condition


def main() -> int:
    with tempfile.TemporaryDirectory() as tmp:
        clip_dir = Path(tmp) / "synthetic-clip"
        clip_dir.mkdir()
        video = clip_dir / "video.mp4"
        render_clip(video)

        process_video(
            str(video), str(clip_dir), StubPlayerDetector(), StubCourtDetector(),
            tracker_factory=lambda fps: ByteTrackTracker(fps),
            match_info=DEFAULT_MATCH_INFO, show_progress=False,
        )

        raw = (clip_dir / "telemetry.json").read_text(encoding="utf-8")
        telemetry = json.loads(raw)
        roster = json.loads((clip_dir / "roster.json").read_text(encoding="utf-8"))
        calibration_exists = (clip_dir / "frame_0_calibration.jpg").is_file()

    frames, meta = telemetry["frames"], telemetry["metadata"]
    ok = True
    ok &= check("frame count", meta["total_frames"] == N_FRAMES == len(frames), str(meta["total_frames"]))
    ok &= check("valid JSON numbers", "NaN" not in raw and "Infinity" not in raw)
    ok &= check("calibration frame written", calibration_exists)

    ids = sorted({p["id"] for f in frames for p in f["players"]})
    ok &= check("ids renumbered 1..6", ids == [1, 2, 3, 4, 5, 6], str(ids))
    ok &= check("every player in every frame (gap filled)",
                all(len(f["players"]) == 6 for f in frames),
                str(sorted({len(f["players"]) for f in frames})))

    # Match telemetry ids to ground-truth players via frame 0 feet positions.
    truth_feet = {p: (b[0] + b[2]) / 2 for p, b in player_boxes(0).items()}
    id_to_truth = {}
    for player in frames[0]["players"]:
        id_to_truth[player["id"]] = min(truth_feet, key=lambda t: abs(truth_feet[t] - player["feet_video_xy"][0]))
    ok &= check("ids map 1:1 to players", sorted(id_to_truth.values()) == list(range(6)))

    errors, interpolated, nulls = [], 0, 0
    for frame in frames:
        for player in frame["players"]:
            truth = id_to_truth[player["id"]]
            if player["is_interpolated"]:
                interpolated += 1
                ok &= truth == OCCLUDED_PLAYER and frame["frame_idx"] in OCCLUSION
            if player["court_xy"] is None:
                nulls += 1
                continue
            errors.append(float(np.linalg.norm(np.array(player["court_xy"]) - true_court_xy(truth, frame["frame_idx"]))))
    ok &= check("court positions present", nulls == 0, f"{nulls} null")
    ok &= check("court error < 40 cm (max)", max(errors) < 40.0,
                f"median {np.median(errors):.1f} cm, max {max(errors):.1f} cm")
    ok &= check("occlusion gap interpolated", interpolated == len(OCCLUSION), str(interpolated))

    invalid = [f["frame_idx"] for f in frames if not f["homography_valid"]]
    ok &= check("homography_valid false on landmark dropout", invalid == list(KEYPOINT_DROPOUT), str(invalid))

    speeds = [p["speed_kmh"] for f in frames for p in f["players"]]
    ok &= check("speeds plausible", 0 < max(speeds) < 15, f"max {max(speeds)} km/h")

    teams_ok = all(roster["players"][str(pid)]["team"] == TEAMS[truth] for pid, truth in id_to_truth.items())
    ok &= check("teams clustered from jersey colour", teams_ok,
                str({pid: roster["players"][str(pid)]["team"] for pid in id_to_truth}))

    print("\nALL PASSED" if ok else "\nFAILURES")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
