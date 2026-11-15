"""
trajectory_smoother.py — Trajectory cleaning for basketball player tracking.

Takes the raw per-frame output of extract_telemetry.py and makes it fit for
the web viewer:

  1. Occlusion gaps (Edge Case 3): a player missing for <= 25 frames who
     reappears with the same id gets linearly interpolated bbox / feet /
     court position, flagged "is_interpolated": true.
  2. Jump rejection (Edge Case 1): frame-to-frame court displacements d_t are
     tested against d_t > M + 3.5 * MAD and d_t > 45 cm/frame. Outliers are
     padded by +/-2 frames, removed, and rebuilt by linear interpolation.
  3. Missing homography (Edge Case 2): frames with court_xy = None are
     interpolated from their neighbours.
  4. Savitzky-Golay smoothing (window 7, polyorder 2), EMA (alpha 0.30) when
     scipy is unavailable or the track is too short.
  5. Clamp to [0, court_width] x [0, court_height].
  6. speed_kmh recomputed from the cleaned positions.

Input player dicts use "court_xy": [x, y] or None (no homography).
A player whose track has no valid court position at all keeps court_xy None.
"""

from __future__ import annotations

import copy
from typing import Any, Dict, List, Optional, Sequence

import numpy as np

try:
    from scipy.signal import savgol_filter
    _HAS_SCIPY = True
except ImportError:
    _HAS_SCIPY = False

MAX_OCCLUSION_GAP = 25      # frames
MAD_FACTOR = 3.5
MIN_JUMP_CM = 45.0          # cm per frame
JUMP_PAD = 2                # frames either side of an outlier
MAX_JUMP_RUN = 20           # two outliers this close bracket one airborne run
SAVGOL_WINDOW = 7
SAVGOL_POLY = 2
EMA_ALPHA = 0.30
SPEED_WINDOW = 3            # frames used for the speed estimate
MAX_SPEED_KMH = 40.0


def compute_speed_kmh(prev_xy: Sequence[float], curr_xy: Sequence[float], fps: float) -> float:
    """Speed in km/h between two court positions (cm) one frame apart at `fps`."""
    if fps <= 0:
        return 0.0
    dist_cm = float(np.hypot(curr_xy[0] - prev_xy[0], curr_xy[1] - prev_xy[1]))
    return round(dist_cm / 100.0 * fps * 3.6, 1)


def _ema_smooth(values: np.ndarray, alpha: float = EMA_ALPHA) -> np.ndarray:
    smoothed = np.empty_like(values, dtype=np.float64)
    smoothed[0] = values[0]
    for i in range(1, len(values)):
        smoothed[i] = alpha * values[i] + (1.0 - alpha) * smoothed[i - 1]
    return smoothed


def _smooth_series(values: np.ndarray) -> np.ndarray:
    if _HAS_SCIPY and len(values) >= SAVGOL_WINDOW:
        return savgol_filter(values, window_length=SAVGOL_WINDOW, polyorder=SAVGOL_POLY, mode="interp")
    return _ema_smooth(values)


def _interp_nan(values: np.ndarray) -> np.ndarray:
    """Linear interpolation over NaNs; edges hold the nearest valid value."""
    out = values.copy()
    nan = np.isnan(out)
    if nan.all() or not nan.any():
        return out
    x = np.arange(len(out))
    out[nan] = np.interp(x[nan], x[~nan], out[~nan])
    return out


def find_jump_outliers(xy: np.ndarray) -> np.ndarray:
    """
    Boolean mask of samples corrupted by homography "teleports".

    xy is (n, 2) with NaN rows where the position is unknown.
    """
    n = len(xy)
    bad = np.zeros(n, dtype=bool)
    idx = np.flatnonzero(~np.isnan(xy[:, 0]))
    if len(idx) < 4:
        return bad

    steps = np.diff(idx)
    d = np.hypot(*np.diff(xy[idx], axis=0).T) / steps   # cm per frame
    median = float(np.median(d))
    mad = float(np.median(np.abs(d - median)))
    spikes = idx[1:][(d > median + MAD_FACTOR * mad) & (d > MIN_JUMP_CM)]
    if len(spikes) == 0:
        return bad

    bad[spikes] = True
    # A jump shows as a spike on take-off and another on landing; everything
    # in between is displaced too.
    for a, b in zip(spikes[:-1], spikes[1:]):
        if b - a <= MAX_JUMP_RUN:
            bad[a:b + 1] = True
    for i in np.flatnonzero(bad):
        bad[max(0, i - JUMP_PAD):min(n, i + JUMP_PAD + 1)] = True

    # If most of the track is flagged the statistics are meaningless — keep it.
    if bad[idx].mean() > 0.6:
        return np.zeros(n, dtype=bool)
    return bad


def clean_court_path(xy: np.ndarray, court_w: float, court_h: float) -> Optional[np.ndarray]:
    """Reject jumps, fill gaps, smooth and clamp one contiguous (n, 2) court path."""
    xy = np.asarray(xy, dtype=np.float64).copy()
    if np.isnan(xy[:, 0]).all():
        return None

    xy[find_jump_outliers(xy)] = np.nan
    x = _smooth_series(_interp_nan(xy[:, 0]))
    y = _smooth_series(_interp_nan(xy[:, 1]))
    return np.stack([np.clip(x, 0.0, court_w), np.clip(y, 0.0, court_h)], axis=1)


def _lerp(a: Sequence[float], b: Sequence[float], t: float) -> List[float]:
    return [float(ai + (bi - ai) * t) for ai, bi in zip(a, b)]


def _shift_polygon(polygon: List[List[float]], dx: float, dy: float) -> List[List[float]]:
    return [[round(px + dx, 1), round(py + dy, 1)] for px, py in polygon]


def _fill_gap(start: Dict[str, Any], end: Dict[str, Any], gap: int) -> List[Dict[str, Any]]:
    """Synthesize `gap` interpolated player entries between two observations."""
    filled = []
    for step in range(1, gap + 1):
        t = step / (gap + 1)
        feet = _lerp(start["feet_video_xy"], end["feet_video_xy"], t)
        # Polygons have different vertex counts, so carry the nearer one along.
        src = start if t < 0.5 else end
        polygon = _shift_polygon(
            src.get("polygon") or [],
            feet[0] - src["feet_video_xy"][0],
            feet[1] - src["feet_video_xy"][1],
        )
        court = None
        if start.get("court_xy") is not None and end.get("court_xy") is not None:
            court = _lerp(start["court_xy"], end["court_xy"], t)
        filled.append({
            "id": start["id"],
            "bbox": [round(v, 1) for v in _lerp(start["bbox"], end["bbox"], t)],
            "feet_video_xy": [round(v, 1) for v in feet],
            "polygon": polygon,
            "court_xy": court,
            "speed_kmh": 0.0,
            "is_interpolated": True,
        })
    return filled


def _speeds(xy: np.ndarray, fps: float) -> np.ndarray:
    n = len(xy)
    speeds = np.zeros(n)
    for i in range(n):
        lo = max(0, i - SPEED_WINDOW)
        hi = i
        if lo == hi:                     # first frame: look forward instead
            hi = min(n - 1, i + SPEED_WINDOW)
        if hi == lo:
            continue
        dist_cm = float(np.hypot(*(xy[hi] - xy[lo])))
        speeds[i] = dist_cm / 100.0 * fps / (hi - lo) * 3.6
    return np.clip(speeds, 0.0, MAX_SPEED_KMH)


def smooth_trajectories(
    frames_data: List[Dict[str, Any]],
    metadata: Optional[Dict[str, Any]] = None,
) -> List[Dict[str, Any]]:
    """Clean every player's trajectory. Returns a new frames list."""
    frames = copy.deepcopy(frames_data)
    if not frames:
        return frames

    meta = metadata or {}
    court_w = float(meta.get("court_width", 2865.0))
    court_h = float(meta.get("court_height", 1524.0))
    fps = float(meta.get("fps", 30.0)) or 30.0

    tracks: Dict[int, Dict[int, Dict[str, Any]]] = {}
    for fi, frame in enumerate(frames):
        for player in frame["players"]:
            tracks.setdefault(int(player["id"]), {})[fi] = player

    for pid, track in tracks.items():
        present = sorted(track)

        # Occlusion gaps
        for a, b in zip(present[:-1], present[1:]):
            gap = b - a - 1
            if 0 < gap <= MAX_OCCLUSION_GAP:
                for offset, player in enumerate(_fill_gap(track[a], track[b], gap), start=1):
                    track[a + offset] = player
                    frames[a + offset]["players"].append(player)

        # Split into contiguous segments (gaps longer than the limit stay gaps)
        present = sorted(track)
        segments: List[List[int]] = [[present[0]]]
        for fi in present[1:]:
            if fi == segments[-1][-1] + 1:
                segments[-1].append(fi)
            else:
                segments.append([fi])

        for segment in segments:
            raw = np.array(
                [track[fi]["court_xy"] if track[fi].get("court_xy") is not None else (np.nan, np.nan)
                 for fi in segment],
                dtype=np.float64,
            )
            cleaned = clean_court_path(raw, court_w, court_h)
            if cleaned is None:
                for fi in segment:
                    track[fi]["court_xy"] = None
                    track[fi]["speed_kmh"] = 0.0
                continue
            speeds = _speeds(cleaned, fps)
            for k, fi in enumerate(segment):
                track[fi]["court_xy"] = [round(float(cleaned[k, 0]), 1), round(float(cleaned[k, 1]), 1)]
                track[fi]["speed_kmh"] = round(float(speeds[k]), 1)

    for frame in frames:
        frame["players"].sort(key=lambda p: p["id"])
    return frames
