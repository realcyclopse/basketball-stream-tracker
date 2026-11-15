#!/usr/bin/env python3
"""
extract_telemetry.py — Main CV pipeline for basketball stream telemetry extraction.

Processes an input MP4 video to detect players, track them across frames,
detect court keypoints, compute homography transforms, and project player
positions onto a 2D court model. Outputs telemetry.json for the web viewer.
"""

import argparse
import cv2
import json
import logging
import os
import sys
import time

import numpy as np
from tqdm import tqdm

from inference import get_model
import supervision as sv

from trajectory_smoother import smooth_trajectories

# ---------------------------------------------------------------------------
# Court configuration / ViewTransformer imports (with fallback)
# ---------------------------------------------------------------------------
try:
    from sports.configs.basketball import BasketballCourtConfiguration as CourtConfiguration
    from sports.common.constants import League, MeasurementUnit
    from sports.common.view import ViewTransformer

    SPORTS_LIB_AVAILABLE = True
except ImportError:
    SPORTS_LIB_AVAILABLE = False

    class MeasurementUnit:
        CENTIMETERS = "centimeters"

    class League:
        NBA = "nba"

    class CourtConfiguration:
        """Minimal fallback court configuration for an NBA court (in cm)."""

        def __init__(self, league=None, measurement_unit=None):
            self.league = league
            self.measurement_unit = measurement_unit
            # NBA court: 94 ft × 50 ft  →  2865.12 cm × 1524.0 cm
            self.width = 2865.12
            self.height = 1524.0
            # 14 canonical keypoints (corners, FT corners, 3-pt arcs, centre)
            self.vertices = np.array(
                [
                    [0.0, 0.0],
                    [0.0, 1524.0],
                    [2865.12, 0.0],
                    [2865.12, 1524.0],
                    [0.0, 549.0],
                    [0.0, 975.0],
                    [579.12, 549.0],
                    [579.12, 975.0],
                    [2865.12, 549.0],
                    [2865.12, 975.0],
                    [2286.0, 549.0],
                    [2286.0, 975.0],
                    [1432.56, 0.0],
                    [1432.56, 1524.0],
                ],
                dtype=np.float32,
            )

    class ViewTransformer:
        """Fallback perspective transformer using OpenCV homography."""

        def __init__(self, source: np.ndarray, target: np.ndarray):
            if len(source) < 4 or len(target) < 4:
                raise ValueError("Need at least 4 point correspondences for homography.")
            self.source = np.asarray(source, dtype=np.float32)
            self.target = np.asarray(target, dtype=np.float32)
            self.m, _ = cv2.findHomography(self.source, self.target, cv2.RANSAC, 5.0)
            if self.m is None:
                raise ValueError("Homography computation failed.")

        def transform_points(self, points: np.ndarray) -> np.ndarray:
            pts = np.asarray(points, dtype=np.float32).reshape(-1, 1, 2)
            transformed = cv2.perspectiveTransform(pts, self.m)
            return transformed.reshape(-1, 2)


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
PLAYER_MODEL_ID = "basketball-player-detection-3-ycjdo/4"
KEYPOINT_MODEL_ID = "basketball-court-detection-2/14"
PLAYER_CLASS_IDS = [3, 4, 5, 6, 7]  # player class variants only

HOMOGRAPHY_CACHE_TTL = 10  # max frames to reuse a stale ViewTransformer

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("extract_telemetry")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _bbox_polygon(xyxy: np.ndarray) -> list[list[float]]:
    """Return a simple 4-point polygon (list of [x, y]) from a bounding box."""
    x1, y1, x2, y2 = map(float, xyxy)
    return [[x1, y1], [x2, y1], [x2, y2], [x1, y2]]


def _mask_to_polygon(mask: np.ndarray, epsilon_ratio: float = 0.015,
                     min_vertices: int = 15, max_vertices: int = 25) -> list[list[float]] | None:
    """Extract the largest contour from a binary mask and simplify it."""
    contours, _ = cv2.findContours(
        mask.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
    )
    if not contours:
        return None

    # Largest connected component by area
    contour = max(contours, key=cv2.contourArea)
    arc_len = cv2.arcLength(contour, closed=True)
    if arc_len == 0:
        return None

    epsilon = epsilon_ratio * arc_len
    approx = cv2.approxPolyDP(contour, epsilon, closed=True)

    # Iteratively adjust epsilon to land within vertex budget
    for _ in range(10):
        n = len(approx)
        if min_vertices <= n <= max_vertices:
            break
        if n > max_vertices:
            epsilon *= 1.3
        else:
            epsilon *= 0.7
        approx = cv2.approxPolyDP(contour, epsilon, closed=True)

    return approx.reshape(-1, 2).tolist()


def _filter_keypoints(result, confidence_threshold: float = 0.5):
    """
    Parse keypoint detection result and return matched (source, target) arrays.

    Returns (frame_landmarks, court_landmarks) — both np.float32 arrays of shape (N, 2).
    """
    try:
        # Roboflow keypoint model result structure
        keypoints = result[0].keypoints  # type: ignore[union-attr]
        xy = keypoints.xy.cpu().numpy() if hasattr(keypoints.xy, "cpu") else np.array(keypoints.xy)
        conf = keypoints.confidence.cpu().numpy() if hasattr(keypoints.confidence, "cpu") else np.array(keypoints.confidence)
    except (AttributeError, IndexError, TypeError):
        # Alternate: result may already expose .keypoints as a list of dicts
        try:
            preds = result.json() if hasattr(result, "json") else result
            if isinstance(preds, dict):
                preds = preds.get("predictions", [])
            frame_pts, court_pts = [], []
            for pred in preds:
                kps = pred.get("keypoints", [])
                for kp in kps:
                    if kp.get("confidence", 0) >= confidence_threshold:
                        idx = kp.get("class_id", kp.get("index", None))
                        if idx is not None:
                            frame_pts.append([kp["x"], kp["y"]])
                            # Map to court vertex by index
                            court_pts.append(idx)
            return (
                np.array(frame_pts, dtype=np.float32),
                np.array(court_pts, dtype=np.float32) if court_pts else np.empty((0, 2), dtype=np.float32),
                True,  # flag: indices mode
            )
        except Exception:
            return np.empty((0, 2), dtype=np.float32), np.empty((0, 2), dtype=np.float32), False

    # xy shape: (1, K, 2), conf shape: (1, K)
    if xy.ndim == 3:
        xy = xy[0]
    if conf.ndim == 2:
        conf = conf[0]

    valid = conf >= confidence_threshold
    frame_landmarks = xy[valid].astype(np.float32)
    valid_indices = np.where(valid)[0]

    return frame_landmarks, valid_indices, False


# ---------------------------------------------------------------------------
# Main pipeline
# ---------------------------------------------------------------------------

def run_pipeline(
    video_path: str,
    output_dir: str,
    tracker_type: str = "bytetrack",
    confidence: float = 0.35,
) -> None:
    """Run the full telemetry extraction pipeline."""

    # ---- Video capture ----
    if not os.path.isfile(video_path):
        log.error("Video file not found: %s", video_path)
        sys.exit(1)

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        log.error("Failed to open video: %s", video_path)
        sys.exit(1)

    fps = cap.get(cv2.CAP_PROP_FPS)
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

    log.info(
        "Video opened — %d×%d @ %.2f fps, %d frames (%.1f s)",
        width, height, fps, total_frames, total_frames / fps if fps else 0,
    )

    # ---- Models ----
    log.info("Loading player detection model: %s", PLAYER_MODEL_ID)
    player_model = get_model(PLAYER_MODEL_ID)

    log.info("Loading keypoint detection model: %s", KEYPOINT_MODEL_ID)
    keypoint_model = get_model(KEYPOINT_MODEL_ID)

    # ---- Tracker ----
    sam2_tracker = None
    byte_tracker = None

    if tracker_type == "sam2":
        log.info("Initializing SAM2 tracker")
        try:
            from sam2.tracker import SAM2Tracker  # type: ignore[import-untyped]
            sam2_tracker = SAM2Tracker()
        except ImportError:
            log.warning("SAM2 not available — falling back to ByteTrack")
            tracker_type = "bytetrack"

    if tracker_type == "bytetrack":
        log.info("Initializing ByteTrack tracker")
        byte_tracker = sv.ByteTrack(
            track_activation_threshold=confidence,
            minimum_matching_threshold=0.8,
            frame_rate=int(fps) if fps else 30,
        )

    # ---- Court configuration ----
    court_config = CourtConfiguration(
        league=League.NBA,
        measurement_unit=MeasurementUnit.CENTIMETERS,
    )
    court_vertices = (
        court_config.vertices
        if hasattr(court_config, "vertices")
        else np.zeros((14, 2), dtype=np.float32)
    )

    # ---- Annotators for calibration frame ----
    box_annotator = sv.BoxAnnotator(thickness=2)
    label_annotator = sv.LabelAnnotator(text_position=sv.Position.TOP_LEFT)

    # ---- Homography cache ----
    cached_transformer: ViewTransformer | None = None
    cache_age: int = 0  # how many frames since last valid homography

    # ---- Output accumulators ----
    frames_data: list[dict] = []
    os.makedirs(output_dir, exist_ok=True)

    t_start = time.time()

    # ---- Per-frame loop ----
    with tqdm(total=total_frames, desc="Extracting telemetry", unit="frame") as pbar:
        frame_idx = 0
        while True:
            ret, frame = cap.read()
            if not ret:
                break

            # ------ (b) Player detection ------
            try:
                det_result = player_model.infer(frame, confidence=confidence)
                detections = sv.Detections.from_inference(det_result)
            except Exception as exc:
                log.warning("Player detection failed on frame %d: %s", frame_idx, exc)
                detections = sv.Detections.empty()

            # Filter to player class IDs only
            if len(detections) > 0:
                mask = np.isin(detections.class_id, PLAYER_CLASS_IDS)
                detections = detections[mask]

            # ------ (c) Tracking ------
            if tracker_type == "bytetrack" and byte_tracker is not None:
                detections = byte_tracker.update_with_detections(detections)
            elif tracker_type == "sam2" and sam2_tracker is not None:
                try:
                    detections = sam2_tracker.update(frame, detections)
                except Exception as exc:
                    log.warning("SAM2 tracking failed on frame %d: %s", frame_idx, exc)

            # ------ (d) Calibration snapshot on frame 0 ------
            if frame_idx == 0:
                try:
                    labels = [
                        f"#{int(tid)}"
                        for tid in (detections.tracker_id if detections.tracker_id is not None else [])
                    ]
                    calib_frame = frame.copy()
                    calib_frame = box_annotator.annotate(scene=calib_frame, detections=detections)
                    if labels:
                        calib_frame = label_annotator.annotate(
                            scene=calib_frame, detections=detections, labels=labels
                        )
                    calib_path = os.path.join(output_dir, "frame_0_calibration.jpg")
                    cv2.imwrite(calib_path, calib_frame)
                    log.info("Saved calibration frame → %s", calib_path)
                except Exception as exc:
                    log.warning("Could not save calibration frame: %s", exc)

            # ------ (e) Keypoint detection ------
            homography_valid = False
            transformer = cached_transformer

            try:
                kp_result = keypoint_model.infer(frame)
                frame_landmarks, indices_or_court, is_index_mode = _filter_keypoints(
                    kp_result, confidence_threshold=0.5
                )
            except Exception as exc:
                log.warning("Keypoint detection failed on frame %d: %s", frame_idx, exc)
                frame_landmarks = np.empty((0, 2), dtype=np.float32)
                indices_or_court = np.empty((0, 2), dtype=np.float32)
                is_index_mode = False

            # ------ (f) Homography / ViewTransformer ------
            num_kp = len(frame_landmarks)
            if num_kp >= 4:
                try:
                    if is_index_mode:
                        court_pts = court_vertices[indices_or_court.astype(int)]
                    else:
                        court_pts = indices_or_court

                    if len(court_pts) >= 4 and len(frame_landmarks) >= 4:
                        transformer = ViewTransformer(
                            source=frame_landmarks[:len(court_pts)],
                            target=court_pts[:len(frame_landmarks)],
                        )
                        cached_transformer = transformer
                        cache_age = 0
                        homography_valid = True
                except Exception as exc:
                    log.debug("ViewTransformer construction failed on frame %d: %s", frame_idx, exc)

            if not homography_valid:
                cache_age += 1
                if cache_age > HOMOGRAPHY_CACHE_TTL:
                    transformer = None
                elif cached_transformer is not None:
                    transformer = cached_transformer

            # ------ (g) Feet positions (video coords) ------
            if len(detections) > 0:
                feet_video_xy = detections.get_anchors_coordinates(
                    anchor=sv.Position.BOTTOM_CENTER
                )
            else:
                feet_video_xy = np.empty((0, 2), dtype=np.float32)

            # ------ (h) Project to court coordinates ------
            if transformer is not None and len(feet_video_xy) > 0:
                try:
                    feet_court_xy = transformer.transform_points(feet_video_xy)
                except Exception:
                    feet_court_xy = np.full_like(feet_video_xy, np.nan)
            else:
                feet_court_xy = np.full_like(feet_video_xy, np.nan)

            # ------ (i) Silhouettes / polygons ------
            polygons: list[list[list[float]] | None] = []
            if tracker_type == "sam2" and detections.mask is not None:
                for mask_single in detections.mask:
                    poly = _mask_to_polygon(mask_single)
                    polygons.append(poly)
            else:
                # ByteTrack — generate 4-point bbox polygons
                for xyxy in detections.xyxy:
                    polygons.append(_bbox_polygon(xyxy))

            # ------ (j) Build frame data dict ------
            players: list[dict] = []
            tracker_ids = (
                detections.tracker_id.tolist()
                if detections.tracker_id is not None
                else list(range(len(detections)))
            )

            for i in range(len(detections)):
                tid = int(tracker_ids[i]) if i < len(tracker_ids) else i
                bbox = detections.xyxy[i].tolist()

                court_x = float(feet_court_xy[i][0]) if i < len(feet_court_xy) and not np.isnan(feet_court_xy[i][0]) else None
                court_y = float(feet_court_xy[i][1]) if i < len(feet_court_xy) and not np.isnan(feet_court_xy[i][1]) else None

                player_dict: dict = {
                    "id": tid,
                    "bbox": [round(float(v), 1) for v in bbox],
                    "feet_video_xy": [round(float(feet_video_xy[i][0]), 1), round(float(feet_video_xy[i][1]), 1)] if i < len(feet_video_xy) else [0.0, 0.0],
                    "polygon": polygons[i] if i < len(polygons) else [],
                    "court_xy": [round(court_x, 1), round(court_y, 1)] if court_x is not None and court_y is not None else [0.0, 0.0],
                    "speed_kmh": 0.0,
                    "is_interpolated": False,
                }
                players.append(player_dict)

            frame_data = {
                "frame_idx": frame_idx,
                "timestamp": round(frame_idx / fps, 4) if fps else 0.0,
                "homography_valid": homography_valid or (cached_transformer is not None and cache_age <= HOMOGRAPHY_CACHE_TTL),
                "players": players,
            }
            frames_data.append(frame_data)

            frame_idx += 1
            pbar.update(1)

    cap.release()
    elapsed = time.time() - t_start
    log.info(
        "Frame extraction complete — %d frames in %.1f s (%.1f fps)",
        frame_idx, elapsed, frame_idx / elapsed if elapsed else 0,
    )

    court_w = float(court_vertices[:, 0].max()) if len(court_vertices) else 2865.0
    court_h = float(court_vertices[:, 1].max()) if len(court_vertices) else 1524.0

    metadata_dict = {
        "video_width": width,
        "video_height": height,
        "fps": round(fps, 2),
        "total_frames": frame_idx,
        "court_width": int(round(court_w)),
        "court_height": int(round(court_h)),
        "court_unit": "cm",
    }

    # ---- Post-processing: smooth trajectories ----
    log.info("Smoothing trajectories …")
    try:
        frames_data = smooth_trajectories(frames_data, metadata=metadata_dict)
    except Exception as exc:
        log.warning("Trajectory smoothing failed: %s — writing raw data", exc)

    # ---- Write output ----
    telemetry = {
        "metadata": metadata_dict,
        "frames": frames_data,
    }

    out_path = os.path.join(output_dir, "telemetry.json")
    with open(out_path, "w", encoding="utf-8") as fp:
        json.dump(telemetry, fp, separators=(",", ":"))

    size_mb = os.path.getsize(out_path) / (1024 * 1024)
    log.info("Wrote %s (%.2f MB, %d frames)", out_path, size_mb, frame_idx)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Extract basketball telemetry from broadcast video.",
    )
    parser.add_argument(
        "--video",
        type=str,
        required=True,
        help="Path to input MP4 file.",
    )
    parser.add_argument(
        "--output-dir",
        type=str,
        default=os.path.join(os.path.dirname(__file__), "..", "web", "public"),
        help="Output directory for telemetry.json (default: ../web/public).",
    )
    parser.add_argument(
        "--tracker",
        type=str,
        choices=["sam2", "bytetrack"],
        default="bytetrack",
        help="Tracking algorithm (default: bytetrack).",
    )
    parser.add_argument(
        "--confidence",
        type=float,
        default=0.35,
        help="Detection confidence threshold (default: 0.35).",
    )
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    run_pipeline(
        video_path=args.video,
        output_dir=args.output_dir,
        tracker_type=args.tracker,
        confidence=args.confidence,
    )
