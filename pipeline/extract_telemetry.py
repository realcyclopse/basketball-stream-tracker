#!/usr/bin/env python3
"""
extract_telemetry.py — CV pipeline for basketball stream telemetry extraction.

For every clip it detects players (Roboflow basketball-player-detection-3),
tracks them (SAM2 real-time when installed, ByteTrack otherwise), detects the
33 court landmarks (basketball-court-detection-2), fits a per-frame homography
and projects each player's feet onto the 2D court. Results are cleaned by
trajectory_smoother and written next to the clip for the web viewer:

    <clip dir>/telemetry.json
    <clip dir>/roster.json               (draft, only if none exists yet)
    <clip dir>/frame_0_calibration.jpg   (boxes labelled "ID: <id>")

Usage:
    # every clip under web/public/clips/<clip_id>/video.mp4
    python extract_telemetry.py

    # a single video
    python extract_telemetry.py --video clip.mp4 --output-dir out/

Requires ROBOFLOW_API_KEY in the environment.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import time
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

import cv2
import numpy as np
import supervision as sv
from tqdm import tqdm

from track_utils import (
    COLOR_KEY,
    COURT_HEIGHT_CM,
    COURT_WIDTH_CM,
    DEFAULT_MATCH_INFO,
    MAX_ON_COURT_PLAYERS,
    CourtProjector,
    assign_teams,
    bbox_to_body_polygon,
    build_draft_roster,
    consolidate_tracks,
    fit_court_projector,
    jersey_color_sample,
    load_court_vertices,
    mask_to_polygon,
    plausible_court_positions,
    pop_track_colors,
)
from trajectory_smoother import smooth_trajectories

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
PLAYER_MODEL_ID = "basketball-player-detection-3-ycjdo/4"
KEYPOINT_MODEL_ID = "basketball-court-detection-2/14"
# player, player-in-possession, player-jump-shot, player-layup-dunk, player-shot-block
PLAYER_CLASS_IDS = [3, 4, 5, 6, 7]

PLAYER_CONFIDENCE = 0.4
PLAYER_IOU = 0.9
KEYPOINT_CONFIDENCE = 0.3        # model threshold
KEYPOINT_ANCHOR_CONFIDENCE = 0.5 # landmarks trusted for the homography
HOMOGRAPHY_CACHE_TTL = 10        # frames a stale homography may be reused

SAM2_CONFIG = "configs/sam2.1/sam2.1_hiera_l.yaml"
SAM2_CHECKPOINT = "checkpoints/sam2.1_hiera_large.pt"

DEFAULT_CLIPS_DIR = Path(__file__).resolve().parent.parent / "web" / "public" / "clips"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("extract_telemetry")


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class RoboflowPlayerDetector:
    """Player boxes from basketball-player-detection-3 (referees, ball, rim dropped)."""

    def __init__(self, confidence: float = PLAYER_CONFIDENCE, iou: float = PLAYER_IOU):
        from inference import get_model

        self.model = get_model(model_id=PLAYER_MODEL_ID)
        self.confidence = confidence
        self.iou = iou

    def detect(self, frame: np.ndarray) -> sv.Detections:
        result = self.model.infer(frame, confidence=self.confidence, iou_threshold=self.iou)[0]
        detections = sv.Detections.from_inference(result)
        detections = detections[np.isin(detections.class_id, PLAYER_CLASS_IDS)]
        # one player can be reported under two action classes
        return detections.with_nms(threshold=0.6, class_agnostic=True)


class RoboflowCourtDetector:
    """The 33 court landmarks from basketball-court-detection-2."""

    def __init__(self, confidence: float = KEYPOINT_CONFIDENCE):
        from inference import get_model

        self.model = get_model(model_id=KEYPOINT_MODEL_ID)
        self.confidence = confidence

    def detect(self, frame: np.ndarray) -> Tuple[np.ndarray, np.ndarray]:
        """Returns (xy (K, 2), confidence (K,)); both empty when no court is found."""
        result = self.model.infer(frame, confidence=self.confidence)[0]
        key_points = sv.KeyPoints.from_inference(result)
        if key_points.xy is None or len(key_points.xy) == 0 or key_points.confidence is None:
            return np.empty((0, 2), dtype=np.float32), np.empty((0,), dtype=np.float32)
        best = int(np.argmax(key_points.confidence.mean(axis=1)))
        return key_points.xy[best], key_points.confidence[best]


# ---------------------------------------------------------------------------
# Trackers
# ---------------------------------------------------------------------------

class ByteTrackTracker:
    """Box tracker. Ids fragment and swap on occlusion; consolidate_tracks repairs them."""

    name = "bytetrack"
    has_masks = False

    def __init__(self, fps: float):
        self.tracker = sv.ByteTrack(
            track_activation_threshold=0.3,
            lost_track_buffer=int(round(fps)) or 30,
            minimum_matching_threshold=0.8,
            frame_rate=int(round(fps)) or 30,
            minimum_consecutive_frames=1,
        )

    def update(self, frame: np.ndarray, detections: sv.Detections) -> sv.Detections:
        return self.tracker.update_with_detections(detections)


class Sam2Tracker:
    """
    SAM2 real-time (github.com/Gy920/segment-anything-2-real-time) mask tracker.

    Players are prompted with their detection boxes on the first frame that has
    detections and then propagated; players entering later are not tracked.
    """

    name = "sam2"
    has_masks = True

    def __init__(self, predictor: Any):
        self.predictor = predictor
        self.prompted = False

    def _autocast(self):
        import torch

        return torch.autocast("cuda", dtype=torch.bfloat16)

    def update(self, frame: np.ndarray, detections: sv.Detections) -> sv.Detections:
        import torch

        if not self.prompted:
            if len(detections) == 0:
                return sv.Detections.empty()
            order = np.argsort(detections.xyxy[:, 0])
            with torch.inference_mode(), self._autocast():
                self.predictor.load_first_frame(frame)
                for obj_id, xyxy in enumerate(detections.xyxy[order], start=1):
                    self.predictor.add_new_prompt(
                        frame_idx=0,
                        obj_id=obj_id,
                        bbox=np.asarray([xyxy], dtype=np.float32),
                    )
            self.prompted = True

        with torch.inference_mode(), self._autocast():
            tracker_ids, mask_logits = self.predictor.track(frame)

        tracker_ids = np.asarray(tracker_ids, dtype=int)
        masks = (mask_logits > 0.0).cpu().numpy()
        masks = np.squeeze(masks, axis=1).astype(bool) if masks.ndim == 4 else masks.astype(bool)
        # drop stray blobs far from the main body
        masks = np.array([
            sv.filter_segments_by_distance(mask, relative_distance=0.03, mode="edge")
            for mask in masks
        ]).reshape(-1, frame.shape[0], frame.shape[1])

        visible = masks.reshape(len(masks), -1).any(axis=1)
        if not visible.any():
            return sv.Detections.empty()
        masks, tracker_ids = masks[visible], tracker_ids[visible]
        return sv.Detections(xyxy=sv.mask_to_xyxy(masks=masks), mask=masks, tracker_id=tracker_ids)


def load_sam2_predictor(config: str, checkpoint: str) -> Optional[Any]:
    """SAM2 camera predictor, or None when SAM2 / CUDA / the checkpoint is missing."""
    try:
        import torch
        from sam2.build_sam import build_sam2_camera_predictor
    except ImportError as exc:
        log.info("SAM2 not importable (%s)", exc)
        return None
    if not torch.cuda.is_available():
        log.info("SAM2 needs a CUDA GPU")
        return None
    if not os.path.isfile(checkpoint):
        log.info("SAM2 checkpoint not found: %s", checkpoint)
        return None
    return build_sam2_camera_predictor(config, checkpoint)


# ---------------------------------------------------------------------------
# Per-clip processing
# ---------------------------------------------------------------------------

def _draw_calibration_frame(frame: np.ndarray, players: List[Dict[str, Any]]) -> np.ndarray:
    image = frame.copy()
    for player in players:
        x1, y1, x2, y2 = (int(round(v)) for v in player["bbox"])
        label = f"ID: {player['id']}"
        cv2.rectangle(image, (x1, y1), (x2, y2), (0, 255, 255), 2)
        (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.7, 2)
        cv2.rectangle(image, (x1, y1 - th - 10), (x1 + tw + 8, y1), (0, 255, 255), -1)
        cv2.putText(image, label, (x1 + 4, y1 - 6), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 0), 2, cv2.LINE_AA)
    return image


def process_video(
    video_path: str,
    output_dir: str,
    player_detector: Any,
    court_detector: Any,
    tracker_factory: Callable[[float], Any],
    match_info: Optional[Dict[str, Any]] = None,
    overwrite_roster: bool = False,
    min_track_frames: int = 15,
    max_players: int = MAX_ON_COURT_PLAYERS,
    show_progress: bool = True,
) -> Dict[str, Any]:
    """Run the pipeline on one video and write its telemetry. Returns the telemetry dict."""
    match_info = match_info or DEFAULT_MATCH_INFO

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise RuntimeError(f"Failed to open video: {video_path}")

    fps = float(cap.get(cv2.CAP_PROP_FPS)) or 30.0
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    expected_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    log.info("%s — %dx%d @ %.2f fps, %d frames", video_path, width, height, fps, expected_frames)

    tracker = tracker_factory(fps)
    court_vertices = load_court_vertices()

    cached_projector: Optional[CourtProjector] = None
    cache_age = 0
    valid_homographies = 0

    frames_data: List[Dict[str, Any]] = []
    first_frame: Optional[np.ndarray] = None
    t_start = time.time()

    progress = tqdm(total=expected_frames, desc=Path(video_path).parent.name or "clip",
                    unit="frame", disable=not show_progress)
    frame_idx = 0
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        if first_frame is None:
            first_frame = frame.copy()

        # Players + tracking
        try:
            detections = tracker.update(frame, player_detector.detect(frame))
        except Exception as exc:
            log.warning("Detection/tracking failed on frame %d: %s", frame_idx, exc)
            detections = sv.Detections.empty()
        if detections.tracker_id is None:
            detections = sv.Detections.empty()

        # Court landmarks -> homography
        projector: Optional[CourtProjector] = None
        try:
            landmarks_xy, landmarks_conf = court_detector.detect(frame)
            anchors = np.asarray(landmarks_conf) > KEYPOINT_ANCHOR_CONFIDENCE
            if len(anchors) == len(court_vertices) and np.count_nonzero(anchors) >= 4:
                projector = fit_court_projector(
                    np.asarray(landmarks_xy)[anchors], court_vertices[anchors]
                )
        except Exception as exc:
            log.warning("Court detection failed on frame %d: %s", frame_idx, exc)

        feet_xy = (
            detections.get_anchors_coordinates(anchor=sv.Position.BOTTOM_CENTER)
            if len(detections) > 0 else np.empty((0, 2), dtype=np.float32)
        )

        # A homography that throws most players off the court is a bad fit.
        if projector is not None and len(feet_xy) > 0:
            if plausible_court_positions(projector.transform_points(feet_xy)).mean() < 0.5:
                projector = None

        homography_valid = projector is not None
        if homography_valid:
            cached_projector, cache_age = projector, 0
            valid_homographies += 1
        else:
            cache_age += 1
            projector = cached_projector if cache_age <= HOMOGRAPHY_CACHE_TTL else None

        court_xy = projector.transform_points(feet_xy) if projector is not None else None
        on_court = plausible_court_positions(court_xy) if court_xy is not None else None

        players = []
        for i in range(len(detections)):
            tracker_id = int(detections.tracker_id[i])
            xyxy = detections.xyxy[i]
            mask = detections.mask[i] if detections.mask is not None else None

            polygon = mask_to_polygon(mask) if mask is not None else None
            if polygon is None:
                polygon = bbox_to_body_polygon(xyxy)

            color = jersey_color_sample(frame, xyxy, mask)

            position = None
            if court_xy is not None and on_court[i]:
                position = [round(float(court_xy[i][0]), 1), round(float(court_xy[i][1]), 1)]

            players.append({
                "id": tracker_id,
                "bbox": [round(float(v), 1) for v in xyxy],
                "feet_video_xy": [round(float(feet_xy[i][0]), 1), round(float(feet_xy[i][1]), 1)],
                "polygon": polygon,
                "court_xy": position,
                "speed_kmh": 0.0,
                "is_interpolated": False,
                COLOR_KEY: None if color is None else [float(v) for v in color],
            })

        frames_data.append({
            "frame_idx": frame_idx,
            "timestamp": round(frame_idx / fps, 4),
            "homography_valid": homography_valid,
            "players": players,
        })
        frame_idx += 1
        progress.update(1)

    progress.close()
    cap.release()
    if frame_idx == 0:
        raise RuntimeError(f"No frames decoded from {video_path}")

    elapsed = time.time() - t_start
    log.info("Processed %d frames in %.1f s (%.1f fps); homography valid on %d",
             frame_idx, elapsed, frame_idx / max(elapsed, 1e-6), valid_homographies)
    if valid_homographies == 0:
        log.warning("No valid homography in this clip — court positions will be empty")

    # Track clean-up: undo id swaps and stitch fragments (box trackers only),
    # drop blips, keep the players on the floor, renumber 1..N
    player_ids = consolidate_tracks(
        frames_data,
        min_track_frames=min_track_frames,
        stitch=not getattr(tracker, "has_masks", False),
        max_players=max_players,
    )
    colors = pop_track_colors(frames_data)
    log.info("%d player tracks kept", len(player_ids))

    metadata = {
        "video_width": width,
        "video_height": height,
        "fps": round(fps, 3),
        "total_frames": frame_idx,
        "court_width": int(COURT_WIDTH_CM),
        "court_height": int(COURT_HEIGHT_CM),
        "court_unit": "cm",
        "source": "pipeline",
        "tracker": getattr(tracker, "name", "unknown"),
    }
    frames_data = smooth_trajectories(frames_data, metadata=metadata)
    telemetry = {"metadata": metadata, "frames": frames_data}

    os.makedirs(output_dir, exist_ok=True)
    telemetry_path = os.path.join(output_dir, "telemetry.json")
    with open(telemetry_path, "w", encoding="utf-8") as fp:
        json.dump(telemetry, fp, separators=(",", ":"))
    log.info("Wrote %s (%.2f MB)", telemetry_path, os.path.getsize(telemetry_path) / 1e6)

    if first_frame is not None:
        calibration_path = os.path.join(output_dir, "frame_0_calibration.jpg")
        cv2.imwrite(calibration_path, _draw_calibration_frame(first_frame, frames_data[0]["players"]))
        log.info("Wrote %s", calibration_path)

    roster_path = os.path.join(output_dir, "roster.json")
    if overwrite_roster or not os.path.isfile(roster_path):
        roster = build_draft_roster(player_ids, assign_teams(colors, match_info), match_info)
        with open(roster_path, "w", encoding="utf-8") as fp:
            json.dump(roster, fp, indent=2)
        log.info("Wrote draft %s — edit names / numbers / teams by hand", roster_path)
    else:
        log.info("Kept existing %s (use --overwrite-roster to regenerate)", roster_path)

    return telemetry


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Extract basketball telemetry from broadcast clips.")
    parser.add_argument("--video", action="append", default=[],
                        help="Input video. Repeatable. Omit to process every clip in --clips-dir.")
    parser.add_argument("--clips-dir", type=Path, default=DEFAULT_CLIPS_DIR,
                        help="Directory of <clip_id>/video.mp4 folders (default: web/public/clips).")
    parser.add_argument("--output-dir", type=Path, default=None,
                        help="Where to write outputs for --video (default: next to the video).")
    parser.add_argument("--tracker", choices=["auto", "sam2", "bytetrack"], default="auto",
                        help="auto = SAM2 when installed, otherwise ByteTrack.")
    parser.add_argument("--confidence", type=float, default=PLAYER_CONFIDENCE,
                        help="Player detection confidence threshold.")
    parser.add_argument("--sam2-config", default=os.environ.get("SAM2_CONFIG", SAM2_CONFIG))
    parser.add_argument("--sam2-checkpoint", default=os.environ.get("SAM2_CHECKPOINT", SAM2_CHECKPOINT))
    parser.add_argument("--match-info", type=Path, default=None,
                        help="JSON file with home_team / away_team for the draft roster.")
    parser.add_argument("--overwrite-roster", action="store_true",
                        help="Regenerate roster.json even if one exists.")
    parser.add_argument("--min-track-frames", type=int, default=15,
                        help="Tracks seen in fewer frames are discarded.")
    parser.add_argument("--max-players", type=int, default=MAX_ON_COURT_PLAYERS,
                        help="Keep only this many longest tracks (0 = keep all).")
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    if args.video:
        jobs = []
        for video in args.video:
            video_path = Path(video)
            if args.output_dir is None:
                out = video_path.parent
            elif len(args.video) > 1:
                out = args.output_dir / video_path.stem
            else:
                out = args.output_dir
            jobs.append((video_path, out))
    else:
        jobs = [(p, p.parent) for p in sorted(args.clips_dir.glob("*/video.mp4"))]
        if not jobs:
            log.error("No clips found under %s", args.clips_dir)
            return 1

    missing = [str(v) for v, _ in jobs if not v.is_file()]
    if missing:
        log.error("Video not found: %s", ", ".join(missing))
        return 1
    if not os.environ.get("ROBOFLOW_API_KEY"):
        log.error("ROBOFLOW_API_KEY is not set")
        return 1

    match_info = DEFAULT_MATCH_INFO
    if args.match_info is not None:
        match_info = json.loads(args.match_info.read_text(encoding="utf-8"))

    log.info("Loading Roboflow models")
    player_detector = RoboflowPlayerDetector(confidence=args.confidence)
    court_detector = RoboflowCourtDetector()

    predictor = None
    if args.tracker in ("auto", "sam2"):
        predictor = load_sam2_predictor(args.sam2_config, args.sam2_checkpoint)
        if predictor is None and args.tracker == "sam2":
            log.error("--tracker sam2 requested but SAM2 is unavailable")
            return 1
    log.info("Tracker: %s", "SAM2" if predictor is not None else "ByteTrack")

    def tracker_factory(fps: float) -> Any:
        return Sam2Tracker(predictor) if predictor is not None else ByteTrackTracker(fps)

    failures = 0
    for video_path, out in jobs:
        try:
            process_video(
                str(video_path), str(out), player_detector, court_detector, tracker_factory,
                match_info=match_info,
                overwrite_roster=args.overwrite_roster,
                min_track_frames=args.min_track_frames,
                max_players=args.max_players,
            )
        except Exception:
            log.exception("Failed on %s", video_path)
            failures += 1
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
