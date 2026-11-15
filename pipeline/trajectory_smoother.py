"""
trajectory_smoother.py — Trajectory smoothing and de-jittering module
for basketball live-stream player tracking.

Implements mathematical solutions for critical CV edge cases:
  1. Edge Case 1: "Jumping Player" Homography Teleportation Bug
     - Euclidean displacement dt = ||p_t - p_{t-1}||
     - Median M and Median Absolute Deviation (MAD = median(|dt - M|))
     - Outlier threshold: dt > M + 3.5 * MAD and dt > 45 cm/frame
     - Pad outlier window by +/-2 frames and linear interpolation
     - Savitzky-Golay filter (window_length=7, polyorder=2) or EMA (alpha=0.30)
     - Clamp coordinates strictly within [0, court_width] x [0, court_height]
  2. Edge Case 2: Insufficient court keypoints / homography failure handling
  3. Edge Case 3: Temporary player occlusion (gap <= 25 frames)
     - Linear interpolation of bbox, feet_video_xy, court_xy, polygon
     - Marks is_interpolated = True for predicted frames
"""

from __future__ import annotations

import copy
import math
from typing import Any, Dict, List, Optional, Sequence, Tuple

import numpy as np

# Try importing scipy.signal for Savitzky-Golay filtering
try:
    from scipy.signal import savgol_filter
    _HAS_SCIPY = True
except ImportError:
    _HAS_SCIPY = False


def compute_speed_kmh(
    prev_xy: Sequence[float],
    curr_xy: Sequence[float],
    fps: float,
) -> float:
    """
    Compute instantaneous speed in km/h between two court positions (in cm).
    """
    if fps <= 0:
        return 0.0

    dx = curr_xy[0] - prev_xy[0]
    dy = curr_xy[1] - prev_xy[1]
    dist_cm = math.sqrt(dx * dx + dy * dy)
    dist_m = dist_cm / 100.0
    speed_ms = dist_m * fps
    return round(speed_ms * 3.6, 1)


def _get_player_list(frame: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Helper to get player list from frame using either 'players' or 'detections'."""
    if "players" in frame:
        return frame["players"]
    elif "detections" in frame:
        return frame["detections"]
    return []


def _get_player_id(player_dict: Dict[str, Any]) -> Optional[int]:
    """Helper to extract player id regardless of key naming."""
    for key in ("id", "player_id", "tracker_id"):
        if key in player_dict and player_dict[key] is not None:
            try:
                return int(player_dict[key])
            except (ValueError, TypeError):
                pass
    return None


def _get_court_xy(player_dict: Dict[str, Any]) -> Optional[List[float]]:
    """Helper to extract [court_x, court_y] from player dict."""
    for key in ("court_xy", "feet_court"):
        val = player_dict.get(key)
        if val is not None and len(val) >= 2 and val[0] is not None and val[1] is not None:
            return [float(val[0]), float(val[1])]
    return None


def _set_court_xy(player_dict: Dict[str, Any], xy: List[float]) -> None:
    """Set court coordinates back onto player dict."""
    if "court_xy" in player_dict:
        player_dict["court_xy"] = [round(xy[0], 1), round(xy[1], 1)]
    elif "feet_court" in player_dict:
        player_dict["feet_court"] = [round(xy[0], 1), round(xy[1], 1)]
    else:
        player_dict["court_xy"] = [round(xy[0], 1), round(xy[1], 1)]


def _ema_smooth(values: np.ndarray, alpha: float = 0.30) -> np.ndarray:
    """Causal Exponential Moving Average (EMA) smoothing."""
    smoothed = np.empty_like(values, dtype=np.float64)
    smoothed[0] = values[0]
    for i in range(1, len(values)):
        smoothed[i] = alpha * values[i] + (1.0 - alpha) * smoothed[i - 1]
    return smoothed


def _smooth_series(values: np.ndarray) -> np.ndarray:
    """Apply Savitzky-Golay (or EMA fallback) over 1-D coordinate values."""
    n = len(values)
    if _HAS_SCIPY and n >= 7:
        try:
            return savgol_filter(values, window_length=7, polyorder=2)
        except Exception:
            pass
    return _ema_smooth(values, alpha=0.30)


def _lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def _lerp_list(a: Sequence[float], b: Sequence[float], t: float) -> List[float]:
    return [_lerp(ai, bi, t) for ai, bi in zip(a, b)]


def _lerp_polygon(
    poly_a: List[List[float]],
    poly_b: List[List[float]],
    t: float,
) -> List[List[float]]:
    """Interpolate two polygon vertex lists."""
    if not poly_a and not poly_b:
        return []
    if not poly_a:
        return poly_b
    if not poly_b:
        return poly_a

    max_len = max(len(poly_a), len(poly_b))
    pa = poly_a + [poly_a[-1]] * (max_len - len(poly_a))
    pb = poly_b + [poly_b[-1]] * (max_len - len(poly_b))
    return [_lerp_list(va, vb, t) for va, vb in zip(pa, pb)]


def smooth_trajectories(
    frames_data: List[Dict[str, Any]],
    metadata: Optional[Dict[str, Any]] = None,
) -> List[Dict[str, Any]]:
    """
    Run trajectory de-jittering, jump outlier rejection, and occlusion interpolation.

    Parameters
    ----------
    frames_data : list[dict]
        Frame-indexed player tracking data.
    metadata : dict, optional
        Contains court_width (cm), court_height (cm), and fps.

    Returns
    -------
    list[dict]
        Cleaned, smoothed frames data conforming to Section 4.2 data contract.
    """
    frames = copy.deepcopy(frames_data)
    if not frames:
        return frames

    # Extract metadata bounds with defaults
    court_w = float((metadata or {}).get("court_width", 2865.0))
    court_h = float((metadata or {}).get("court_height", 1524.0))
    fps = float((metadata or {}).get("fps", 30.0))

    # Identify all unique player IDs present across frames
    all_player_ids = set()
    for frame in frames:
        for p in _get_player_list(frame):
            pid = _get_player_id(p)
            if pid is not None:
                all_player_ids.add(pid)

    # Process each player trajectory individually
    for pid in sorted(all_player_ids):
        # Collect occurrences: (frame_idx, player_idx_in_frame)
        occurrences: List[Tuple[int, int]] = []
        for fi, frame in enumerate(frames):
            plist = _get_player_list(frame)
            for pi, p in enumerate(plist):
                if _get_player_id(p) == pid:
                    occurrences.append((fi, pi))
                    break

        if len(occurrences) < 2:
            continue

        frame_indices = np.array([fi for fi, _ in occurrences], dtype=int)
        raw_coords = []
        for fi, pi in occurrences:
            p = _get_player_list(frames[fi])[pi]
            cxy = _get_court_xy(p) or [court_w / 2.0, court_h / 2.0]
            raw_coords.append(cxy)

        coords_arr = np.array(raw_coords, dtype=np.float64)  # (N, 2)
        n_points = len(coords_arr)

        # ── Step A: Outlier Jump Rejection (Edge Case 1) ───────────
        diffs = np.diff(coords_arr, axis=0)
        displacements = np.sqrt(diffs[:, 0] ** 2 + diffs[:, 1] ** 2)

        if len(displacements) > 0:
            median_d = float(np.median(displacements))
            mad_d = float(np.median(np.abs(displacements - median_d)))
            threshold = median_d + 3.5 * mad_d

            outlier_indices = set()
            for k, d in enumerate(displacements):
                if d > threshold and d > 45.0:  # > 45 cm/frame jump
                    outlier_indices.add(k + 1)

            # Pad each outlier window by +/- 2 frames
            corrupted = set()
            for idx in outlier_indices:
                for offset in range(-2, 3):
                    cur = idx + offset
                    if 0 <= cur < n_points:
                        corrupted.add(cur)

            # Reconstruct corrupted coordinates via linear interpolation
            valid_mask = np.ones(n_points, dtype=bool)
            for c in corrupted:
                valid_mask[c] = False

            if np.any(valid_mask):
                valid_idx = np.where(valid_mask)[0]
                coords_arr[:, 0] = np.interp(np.arange(n_points), valid_idx, coords_arr[valid_idx, 0])
                coords_arr[:, 1] = np.interp(np.arange(n_points), valid_idx, coords_arr[valid_idx, 1])

        # ── Step B: Smoothing filter (Savitzky-Golay / EMA) ────────
        smooth_x = _smooth_series(coords_arr[:, 0])
        smooth_y = _smooth_series(coords_arr[:, 1])

        # ── Step C: Clamping strictly within court boundaries ──────
        smooth_x = np.clip(smooth_x, 10.0, court_w - 10.0)
        smooth_y = np.clip(smooth_y, 10.0, court_h - 10.0)

        # Write smoothed coordinates back
        for arr_idx, (fi, pi) in enumerate(occurrences):
            p = _get_player_list(frames[fi])[pi]
            _set_court_xy(p, [smooth_x[arr_idx], smooth_y[arr_idx]])

        # ── Step D: Handle Occlusion Gaps (Edge Case 3) ────────────
        # If player disappears for <= 25 frames and reappears with same ID,
        # linearly interpolate their state and mark is_interpolated = True
        for i in range(len(occurrences) - 1):
            fi_start, pi_start = occurrences[i]
            fi_end, pi_end = occurrences[i + 1]
            gap = fi_end - fi_start - 1

            if 0 < gap <= 25:
                p_start = _get_player_list(frames[fi_start])[pi_start]
                p_end = _get_player_list(frames[fi_end])[pi_end]

                bbox_start = p_start.get("bbox", [0, 0, 50, 150])
                bbox_end = p_end.get("bbox", [0, 0, 50, 150])
                feet_start = p_start.get("feet_video_xy", [0, 0])
                feet_end = p_end.get("feet_video_xy", [0, 0])
                court_start = _get_court_xy(p_start) or [0, 0]
                court_end = _get_court_xy(p_end) or [0, 0]
                poly_start = p_start.get("polygon", [])
                poly_end = p_end.get("polygon", [])

                for step in range(1, gap + 1):
                    target_fi = fi_start + step
                    fraction = step / float(gap + 1)

                    interp_bbox = _lerp_list(bbox_start, bbox_end, fraction)
                    interp_feet = _lerp_list(feet_start, feet_end, fraction)
                    interp_court = _lerp_list(court_start, court_end, fraction)
                    interp_poly = _lerp_polygon(poly_start, poly_end, fraction)

                    # Compute interpolated speed
                    interp_speed = compute_speed_kmh(court_start, interp_court, fps / step)

                    synthesized_player = {
                        "id": pid,
                        "bbox": [round(v, 1) for v in interp_bbox],
                        "feet_video_xy": [round(v, 1) for v in interp_feet],
                        "polygon": interp_poly,
                        "court_xy": [round(interp_court[0], 1), round(interp_court[1], 1)],
                        "speed_kmh": interp_speed,
                        "is_interpolated": True,
                    }

                    target_plist = _get_player_list(frames[target_fi])
                    target_plist.append(synthesized_player)

        # ── Step E: Recompute Speeds for All Frames ────────────────
        # Update speed_kmh based on smoothed trajectories
        player_frames_sorted = sorted(
            [(fi, p) for fi, frame in enumerate(frames) for p in _get_player_list(frame) if _get_player_id(p) == pid],
            key=lambda item: item[0],
        )

        for idx, (fi, p) in enumerate(player_frames_sorted):
            if idx == 0:
                p["speed_kmh"] = 10.0
            else:
                prev_fi, prev_p = player_frames_sorted[idx - 1]
                frame_delta = fi - prev_fi
                if frame_delta > 0:
                    c_prev = _get_court_xy(prev_p) or [0, 0]
                    c_curr = _get_court_xy(p) or [0, 0]
                    effective_fps = fps / float(frame_delta)
                    p["speed_kmh"] = compute_speed_kmh(c_prev, c_curr, effective_fps)

    return frames
