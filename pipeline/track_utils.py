"""
track_utils.py — Model-free helpers for the telemetry pipeline.

Everything here works on plain numpy arrays / dicts so it can be tested
without Roboflow, SAM2 or a GPU:

  * court geometry + homography fitting
  * mask -> polygon conversion
  * track stitching, short-track removal and id renumbering
  * jersey-colour team clustering and draft roster generation
"""

from __future__ import annotations

from itertools import permutations
from typing import Any, Dict, List, Optional, Sequence, Tuple

import cv2
import numpy as np

# ---------------------------------------------------------------------------
# Court geometry
# ---------------------------------------------------------------------------

COURT_WIDTH_CM = 2865.0
COURT_HEIGHT_CM = 1524.0

# The 33 landmarks predicted by basketball-court-detection-2, in NBA court
# centimetres (x along the court length, y along its width). Mirrors
# sports.basketball.CourtConfiguration(League.NBA, CENTIMETERS).vertices and is
# used when the `sports` package is not installed.
NBA_COURT_VERTICES_CM: List[Tuple[float, float]] = [
    (0, 0), (0, 91), (0, 518), (0, 1006), (0, 1433), (0, 1524),
    (160, 762), (424, 91), (424, 1433),
    (579, 518), (579, 762), (579, 1006),
    (835, 0), (884, 762), (835, 1524),
    (1432, 0), (1432, 762), (1432, 1524),
    (2030, 0), (1981, 762), (2030, 1524),
    (2286, 518), (2286, 762), (2286, 1006),
    (2441, 91), (2441, 1433), (2705, 762),
    (2865, 0), (2865, 91), (2865, 518), (2865, 1006), (2865, 1433), (2865, 1524),
]


def load_court_vertices() -> np.ndarray:
    """(33, 2) float32 court landmarks in cm, from roboflow/sports when available."""
    try:
        from sports import MeasurementUnit
        from sports.basketball import CourtConfiguration, League

        config = CourtConfiguration(league=League.NBA, measurement_unit=MeasurementUnit.CENTIMETERS)
        vertices = np.asarray(config.vertices, dtype=np.float32)
        if vertices.shape == (len(NBA_COURT_VERTICES_CM), 2):
            return vertices
    except Exception:
        pass
    return np.asarray(NBA_COURT_VERTICES_CM, dtype=np.float32)


class CourtProjector:
    """Homography from video pixels to court centimetres."""

    def __init__(self, matrix: np.ndarray):
        self.matrix = matrix

    def transform_points(self, points: np.ndarray) -> np.ndarray:
        points = np.asarray(points, dtype=np.float32)
        if points.size == 0:
            return np.empty((0, 2), dtype=np.float32)
        return cv2.perspectiveTransform(points.reshape(-1, 1, 2), self.matrix).reshape(-1, 2)


def fit_court_projector(
    frame_points: np.ndarray,
    court_points: np.ndarray,
    max_median_error_cm: float = 120.0,
) -> Optional[CourtProjector]:
    """
    Fit a pixel -> court homography from matched landmarks.

    Returns None when there are fewer than 4 landmarks, when they are
    (nearly) collinear, or when the fit does not reproduce the landmarks.
    """
    frame_points = np.asarray(frame_points, dtype=np.float32).reshape(-1, 2)
    court_points = np.asarray(court_points, dtype=np.float32).reshape(-1, 2)
    if len(frame_points) < 4 or len(frame_points) != len(court_points):
        return None

    # Landmarks on a single line (e.g. only a sideline visible) give a
    # degenerate homography.
    if cv2.contourArea(cv2.convexHull(court_points)) < 100.0 * 100.0:
        return None
    if cv2.contourArea(cv2.convexHull(frame_points)) < 50.0 * 50.0:
        return None

    if len(frame_points) == 4:
        matrix, _ = cv2.findHomography(frame_points, court_points, 0)
    else:
        matrix, _ = cv2.findHomography(frame_points, court_points, cv2.RANSAC, 60.0)
    if matrix is None or not np.all(np.isfinite(matrix)):
        return None

    projector = CourtProjector(matrix)
    errors = np.linalg.norm(projector.transform_points(frame_points) - court_points, axis=1)
    if not np.all(np.isfinite(errors)) or float(np.median(errors)) > max_median_error_cm:
        return None
    return projector


def plausible_court_positions(court_xy: np.ndarray, margin_cm: float = 300.0) -> np.ndarray:
    """Mask of projected points that land on (or just around) the court."""
    court_xy = np.asarray(court_xy, dtype=np.float64).reshape(-1, 2)
    finite = np.all(np.isfinite(court_xy), axis=1)
    inside = (
        (court_xy[:, 0] >= -margin_cm) & (court_xy[:, 0] <= COURT_WIDTH_CM + margin_cm)
        & (court_xy[:, 1] >= -margin_cm) & (court_xy[:, 1] <= COURT_HEIGHT_CM + margin_cm)
    )
    return finite & inside


# ---------------------------------------------------------------------------
# Silhouette polygons
# ---------------------------------------------------------------------------

def mask_to_polygon(
    mask: np.ndarray,
    min_vertices: int = 12,
    max_vertices: int = 28,
) -> Optional[List[List[float]]]:
    """Largest connected component of a binary mask as a simplified polygon."""
    contours, _ = cv2.findContours(mask.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None
    contour = max(contours, key=cv2.contourArea)
    if cv2.contourArea(contour) < 30.0:
        return None

    arc = cv2.arcLength(contour, True)
    epsilon = 0.012 * arc
    approx = cv2.approxPolyDP(contour, epsilon, True)
    for _ in range(12):
        if min_vertices <= len(approx) <= max_vertices:
            break
        epsilon *= 1.3 if len(approx) > max_vertices else 0.7
        approx = cv2.approxPolyDP(contour, epsilon, True)
    if len(approx) < 3:
        return None
    return [[round(float(x), 1), round(float(y), 1)] for x, y in approx.reshape(-1, 2)]


def bbox_to_body_polygon(xyxy: Sequence[float], points: int = 16) -> List[List[float]]:
    """Rounded body-shaped outline for trackers that produce no masks."""
    x1, y1, x2, y2 = map(float, xyxy)
    cx, cy = (x1 + x2) / 2.0, (y1 + y2) / 2.0
    rx, ry = (x2 - x1) / 2.0, (y2 - y1) / 2.0
    polygon = []
    for k in range(points):
        angle = 2.0 * np.pi * k / points
        c, s = np.cos(angle), np.sin(angle)
        # superellipse: fuller than an ellipse, softer than a box
        px = cx + rx * np.sign(c) * abs(c) ** 0.6
        py = cy + ry * np.sign(s) * abs(s) ** 0.6
        polygon.append([round(px, 1), round(py, 1)])
    return polygon


# ---------------------------------------------------------------------------
# Track consolidation
# ---------------------------------------------------------------------------

def _collect_tracks(frames: List[Dict[str, Any]]) -> Dict[int, List[int]]:
    tracks: Dict[int, List[int]] = {}
    for fi, frame in enumerate(frames):
        for player in frame["players"]:
            tracks.setdefault(int(player["id"]), []).append(fi)
    return tracks


def _player_at(frames: List[Dict[str, Any]], fi: int, pid: int) -> Dict[str, Any]:
    return next(p for p in frames[fi]["players"] if int(p["id"]) == pid)


def stitch_tracks(frames: List[Dict[str, Any]], max_gap: int = 25) -> Dict[int, int]:
    """
    Merge track fragments: a track that starts shortly after another one ended,
    close to where it ended, is the same player with a new tracker id.

    Rewrites ids in place and returns {old_id: merged_id}.
    """
    tracks = _collect_tracks(frames)
    order = sorted(tracks, key=lambda pid: tracks[pid][0])
    mapping = {pid: pid for pid in tracks}
    # merged id -> (last frame, feet xy, bbox width)
    tails: Dict[int, Tuple[int, np.ndarray, float]] = {}

    for pid in order:
        first_fi = tracks[pid][0]
        first = _player_at(frames, first_fi, pid)
        feet = np.asarray(first["feet_video_xy"], dtype=np.float64)

        best, best_dist = None, np.inf
        for root, (last_fi, last_feet, last_width) in tails.items():
            gap = first_fi - last_fi - 1
            if gap < 0 or gap > max_gap:
                continue
            dist = float(np.linalg.norm(feet - last_feet))
            if dist <= max(1.5 * last_width, 60.0) + 8.0 * gap and dist < best_dist:
                best, best_dist = root, dist

        root = best if best is not None else pid
        mapping[pid] = root
        last_fi = tracks[pid][-1]
        last = _player_at(frames, last_fi, pid)
        width = float(last["bbox"][2] - last["bbox"][0])
        tails[root] = (last_fi, np.asarray(last["feet_video_xy"], dtype=np.float64), width)

    for frame in frames:
        for player in frame["players"]:
            player["id"] = mapping[int(player["id"])]
    return mapping


def consolidate_tracks(
    frames: List[Dict[str, Any]],
    min_track_frames: int = 15,
    stitch: bool = True,
    max_gap: int = 25,
) -> Dict[int, int]:
    """
    Stitch fragments, drop tracks seen in fewer than `min_track_frames` frames
    and renumber the survivors 1..N (by first appearance, then left to right).

    Rewrites `frames` in place. Returns {raw_tracker_id: final_id} for the
    tracker ids that survived.
    """
    merged = stitch_tracks(frames, max_gap=max_gap) if stitch else {
        pid: pid for pid in _collect_tracks(frames)
    }

    tracks = _collect_tracks(frames)
    min_len = min(min_track_frames, max(1, len(frames) // 4))
    kept = [pid for pid, fis in tracks.items() if len(fis) >= min_len]

    def sort_key(pid: int) -> Tuple[int, float]:
        first_fi = tracks[pid][0]
        return first_fi, float(_player_at(frames, first_fi, pid)["feet_video_xy"][0])

    final = {pid: new_id for new_id, pid in enumerate(sorted(kept, key=sort_key), start=1)}

    for frame in frames:
        players = []
        for player in frame["players"]:
            if int(player["id"]) in final:
                player["id"] = final[int(player["id"])]
                players.append(player)
        frame["players"] = sorted(players, key=lambda p: p["id"])

    return {raw: final[root] for raw, root in merged.items() if root in final}


# ---------------------------------------------------------------------------
# Team assignment + roster
# ---------------------------------------------------------------------------

DEFAULT_MATCH_INFO: Dict[str, Any] = {
    "home_team": {"code": "BOS", "name": "Boston Celtics", "color": "#007A33", "accent": "#BA9653"},
    "away_team": {"code": "NYK", "name": "New York Knicks", "color": "#006BB6", "accent": "#F58426"},
}


def jersey_color_sample(
    frame: np.ndarray,
    xyxy: Sequence[float],
    mask: Optional[np.ndarray] = None,
) -> Optional[np.ndarray]:
    """Mean Lab colour of the torso region of a player box (None if too small)."""
    h, w = frame.shape[:2]
    x1, y1, x2, y2 = map(float, xyxy)
    bw, bh = x2 - x1, y2 - y1
    tx1, tx2 = int(max(0, x1 + 0.25 * bw)), int(min(w, x2 - 0.25 * bw))
    ty1, ty2 = int(max(0, y1 + 0.15 * bh)), int(min(h, y1 + 0.50 * bh))
    if tx2 - tx1 < 3 or ty2 - ty1 < 3:
        return None
    lab = cv2.cvtColor(frame[ty1:ty2, tx1:tx2], cv2.COLOR_BGR2LAB).reshape(-1, 3)
    if mask is not None:
        inside = mask[ty1:ty2, tx1:tx2].reshape(-1).astype(bool)
        if inside.sum() >= 9:
            lab = lab[inside]
    return lab.mean(axis=0).astype(np.float32)


def _hex_to_lab(color: str) -> np.ndarray:
    color = color.lstrip("#")
    bgr = np.uint8([[[int(color[4:6], 16), int(color[2:4], 16), int(color[0:2], 16)]]])
    return cv2.cvtColor(bgr, cv2.COLOR_BGR2LAB).reshape(3).astype(np.float32)


def assign_teams(
    colors: Dict[int, np.ndarray],
    match_info: Dict[str, Any],
) -> Dict[int, str]:
    """
    Split players into two teams by jersey colour (2-means in Lab) and map the
    clusters to home/away by closeness to the team colours.

    A guess: white jerseys are not close to any team colour, so check the
    result against frame_0_calibration.jpg and fix roster.json if needed.
    """
    codes = [match_info["home_team"]["code"], match_info["away_team"]["code"]]
    ids = sorted(colors)
    if len(ids) < 2:
        return {pid: codes[0] for pid in ids}

    samples = np.stack([colors[pid] for pid in ids]).astype(np.float32)
    criteria = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 50, 0.1)
    cv2.setRNGSeed(0)
    _, labels, centers = cv2.kmeans(samples, 2, None, criteria, 10, cv2.KMEANS_PP_CENTERS)
    labels = labels.reshape(-1)

    team_lab = [_hex_to_lab(match_info["home_team"]["color"]), _hex_to_lab(match_info["away_team"]["color"])]
    best = min(
        permutations(range(2)),
        key=lambda perm: sum(float(np.linalg.norm(centers[c] - team_lab[perm[c]])) for c in range(2)),
    )
    return {pid: codes[best[int(label)]] for pid, label in zip(ids, labels)}


def build_draft_roster(
    player_ids: Sequence[int],
    teams: Dict[int, str],
    match_info: Dict[str, Any],
) -> Dict[str, Any]:
    """
    Placeholder roster keyed by tracker id. Names and jersey numbers are not
    recognised by the pipeline — edit them by hand using the calibration frame.
    """
    home = match_info["home_team"]["code"]
    players = {}
    for pid in sorted(player_ids):
        players[str(pid)] = {
            "id": int(pid),
            "name": f"Player {pid}",
            "shortName": f"P{pid}",
            "number": str(pid),
            "team": teams.get(pid, home),
            "position": "-",
        }
    return {"draft": True, "match_info": match_info, "players": players}
