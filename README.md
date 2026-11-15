# 🏀 Basketball Live-Stream Player Tracker & 2D Tactical Radar

An interactive, broadcast-grade web application for real-time basketball player tracking with live video overlays and a synchronized 2D tactical court radar minimap.

![CourtView Live](https://img.shields.io/badge/status-Production--Grade%20MVP-brightgreen) ![React](https://img.shields.io/badge/React-18-blue) ![TypeScript](https://img.shields.io/badge/TypeScript-5-blue) ![Python](https://img.shields.io/badge/Python-3.10+-yellow) ![License](https://img.shields.io/badge/license-MIT-green)

---

## ✨ Overview & Core Features

CourtView Live delivers an interactive NBA broadcast experience directly in the browser at a silky smooth **60 FPS with zero latency, zero cloud API fees, and zero LLM dependencies at runtime**.

- **NBA 2K-Style Tracking Overlay** — High-contrast perspective glowing floor rings with vertical spotlight beams, dynamic neon segmentation polygon contours, and futuristic HUD corner targeting brackets.
- **Broadcast Pill Badges** — Floating player name, jersey number, and real-time speed pill badges anchored above player bounding boxes.
- **2D Tactical Court Radar (Homography Minimap)** — Scaled top-down NBA court diagram (2865 × 1524 cm) displaying all 10 players in real time:
  - 9 off-ball players rendered at subtle opacity for spatial awareness.
  - Selected player rendered with expanding sonar rings, a directional velocity vector, and a **60-frame (2-second) fading movement ribbon** showing their exact run path.
- **Interactive Three-Way Selection** — Select and track any player by:
  1. Clicking their row in the **On-Court Roster Menu**.
  2. Clicking directly on their bounding box on the **live video canvas** (with responsive letterbox-aware hit-testing).
  3. Clicking their dot directly on the **2D Court Radar minimap**.
- **Live Telemetry HUD Bar** — Instant readout of current speed (km/h) with visual gauge, cumulative distance covered (m), automated court zone classification (`Paint`, `Left/Right Corner 3`, `Left/Right Wing`, `Top of Key`, `Midrange`, `Backcourt`), and tracking state (`LIVE` vs. `PREDICTED`).
- **Occlusion Handling & Predictive Tracking** — Short visual occlusions ($\le 25$ frames) are linearly interpolated, rendering dashed floor rings and marking status as `PREDICTED` to prevent flickering.
- **High-Contrast Multi-Layer Rendering** — All floor rings, contours, brackets, and badges feature dark outer casings + crisp white inner bands + team color cores, ensuring maximum readability on any court wood grain, painted paint, or jersey color.
- **Multi-Clip Switcher** — Header dropdown with real broadcast clips from Celtics vs. Knicks and an offline synthetic 5v5 simulator.

---

## 🏗️ Architecture: Decoupled Two-Stage Stream

Running computer vision models (RF-DETR + SAM 2 + Keypoint Homography) concurrently at live 60 FPS over WebSockets would require dedicated cloud A100 GPUs and introduce stream latency.

To make the application **100% free to host (Vercel, Render, GitHub Pages) with zero lag**, we decoupled tracking into a two-stage pipeline:

```
┌────────────────────────────────────────────────────────┐
│  STAGE 1: Offline Computer Vision Engine (Python)      │
│  (Google Colab GPU or Local Workstation)               │
│                                                        │
│  • RF-DETR Player Detection (Roboflow Sports)          │
│  • ByteTrack / SAM 2 Tracking                          │
│  • Torso Color Sampling (CIE Lab) & Opponent Swap Fix  │
│  • 33-Point Court Keypoint Homography Mapping          │
│  • Trajectory De-jittering (MAD Outlier Rejection)     │
│  • Savitzky-Golay / EMA Coordinate Smoothing           │
│                                                        │
│  Outputs:                                              │
│    ├── video.mp4 (Broadcast clip)                      │
│    ├── telemetry.json (Frame-indexed player coords)    │
│    ├── roster.json (Tracker ID -> Player metadata)     │
│    └── frame_0_calibration.jpg (Tracker ID labels)    │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│  STAGE 2: Real-Time Web Dashboard (React + Vite)       │
│  (100% Client-Side · 60 FPS · Zero API Costs)          │
│                                                        │
│  • HTML5 <video> + requestVideoFrameCallback Sync      │
│  • Hardware-Accelerated HTML5 <canvas> Overlay         │
│  • Scaled Top-Down SVG 2D Court Radar                  │
│  • Responsive Letterbox-Aware Click Hit-Testing        │
│  • Dark Theme Sports HUD UI (Tailwind CSS)             │
└────────────────────────────────────────────────────────┘
```

---

## 🧠 Algorithmic Solutions for CV Edge Cases

### 1. Opponent ID-Swap Repair (`repair_id_swaps`)
During aggressive drives, screens, and pick-and-rolls, player bounding boxes heavily overlap ($\text{IoU} > 0.15$). Classical tracking algorithms (like ByteTrack) frequently swap tracker IDs when players cross.
- **Solution**: The pipeline samples player torso patches in the **CIE $L^*a^*b^*$ color space** across a temporal window before and after crossings. If exchanging IDs after a collision yields a significant color consistency improvement matching opposing team jersey colors, the ID swap is automatically undone.

### 2. Referee & Bench Player Filter (`--max-players 10`)
Broadcast cameras frequently catch referees, coaches, and bench players near sidelines for a few frames.
- **Solution**: The track consolidation engine ranks all trajectories by active duration and retains only the 10 longest active on-court tracks. Short blips are purged, and surviving tracks are renumbered cleanly from 1 to 10.

### 3. "Jumping Player" Homography Spike Fix (`trajectory_smoother.py`)
Homography assumes all points lie on the flat $Z = 0$ floor. When a player jumps for a shot, layup, or rebound, the bottom-center of their box rises vertically in pixel space, causing planar homography to teleport several meters upcourt.
- **Solution**:
  1. Computes frame-to-frame Euclidean displacements $d_t = \|\mathbf{p}_t - \mathbf{p}_{t-1}\|_2$.
  2. Evaluates the Median Absolute Deviation $\text{MAD} = \text{median}(|d - M|)$.
  3. Flags jumps where $d_t > M + 3.5 \cdot \text{MAD}$ and $d_t > 45\text{ cm/frame}$.
  4. Pads outlier windows by $\pm 2$ frames and reconstructs positions via linear interpolation.
  5. Smooths trajectories using a **Savitzky-Golay polynomial filter** (`window_length=7, polyorder=2`) or causal EMA ($\alpha = 0.30$).
  6. Clamps all coordinates strictly within the NBA court boundary ($[0, 2865] \times [0, 1524]\text{ cm}$).

### 4. Insufficient Court Keypoints (Homography Caching)
When cameras pan rapidly or players crowd the paint, fewer than 4 court landmarks may pass the 0.5 confidence threshold.
- **Solution**: Caches the last valid homography matrix ($H_{t-1}$) and reuses it for up to 10 consecutive frames (`homography_valid: false`), letting trajectory interpolation smooth across temporary visual gaps.

---

## 🎬 Included Demo Clips

The project comes pre-configured with four demo clips accessible via the header picker (`web/public/clips/clips.json`):

| Clip ID | Title | Matchup | Frames | Footage & Telemetry |
|---|---|---|---|---|
| `bos-nyk-q1-0428` | **Q1 · 4:28** | Celtics vs. Knicks · Game 1 | 238 frames (30 FPS) | Real broadcast clip + tracking |
| `bos-nyk-q1-0741` | **Q1 · 7:41** | Celtics vs. Knicks · Game 1 | 209 frames (30 FPS) | Real broadcast clip + tracking |
| `bos-nyk-q2-0843` | **Q2 · 8:43** | Celtics vs. Knicks · Game 1 | 201 frames (30 FPS) | Real broadcast clip + tracking |
| `synthetic` | **Synthetic** | 5v5 Simulated Possession | 450 frames (30 FPS) | Mock data with hardwood court generator |

---

## 🚀 Quick Start Guide

### 1. Run the Web Application Locally

```bash
cd web
npm install
npm run dev
```

Open **`http://localhost:5173`** in your browser.
- Switch clips using the dropdown in the top header.
- Click any player in the left sidebar, on the court radar, or directly on the video stream.
- Toggle between **Floor Ring**, **Neon Outline**, and **HUD Brackets** highlight modes.
- Use playback transport controls (Play/Pause, Frame Step $\pm 1$, Scrubber, Playback Speed 0.5x/1x/2x).

### 2. Build for Production

```bash
cd web
npm run build
npm run preview
```
Produces an optimized static bundle in `web/dist` suitable for zero-cost deployment on Vercel, Netlify, or GitHub Pages.

### 3. Run Automated Quality Assurance Suites

```bash
# 1. Pipeline test suite (offline test with scripted id swaps, fragments, referee blips)
cd pipeline
python test_pipeline.py

# 2. End-to-end browser clip playback and sync validation
cd web
node verify_clips.js

# 3. Comprehensive 40-assertion DOM & UI interaction test suite
cd web
node verify_dom.js
```

---

## 📁 Repository Directory Structure

```text
basketball-stream-tracker/
├── pipeline/
│   ├── extract_telemetry.py       # Main CV pipeline (RF-DETR + SAM2/ByteTrack + Homography)
│   ├── track_utils.py             # ID-swap repair, track stitching, 10-player cap, Lab clustering
│   ├── trajectory_smoother.py     # MAD outlier rejection + Savitzky-Golay / EMA smoothing
│   ├── generate_mock_telemetry.py # Standalone 450-frame 5v5 NBA possession data generator
│   ├── test_pipeline.py           # Offline unit and integration test suite (with stub detectors)
│   ├── colab_pipeline.ipynb       # Ready-to-run Google Colab GPU notebook
│   ├── README_COLAB.md            # Step-by-step Colab execution instructions
│   └── requirements.txt           # Python CV dependencies
├── web/
│   ├── public/
│   │   └── clips/
│   │       ├── clips.json         # Clip manifest
│   │       ├── bos-nyk-q1-0428/   # video.mp4, telemetry.json, roster.json, calibration.jpg
│   │       ├── bos-nyk-q1-0741/   # video.mp4, telemetry.json, roster.json, calibration.jpg
│   │       ├── bos-nyk-q2-0843/   # video.mp4, telemetry.json, roster.json, calibration.jpg
│   │       └── synthetic/         # telemetry.json, roster.json
│   ├── src/
│   │   ├── types/
│   │   │   └── telemetry.ts       # TypeScript interfaces for telemetry and roster schemas
│   │   ├── components/
│   │   │   ├── StreamPlayer.tsx   # HTML5 <video> + canvas overlay + transport bar
│   │   │   ├── RosterSidebar.tsx  # Active roster menu + tracking & visual mode toggles
│   │   │   ├── CourtRadar2D.tsx   # Scaled 2D NBA court SVG minimap + 60-frame trails
│   │   │   └── PlayerStatsBar.tsx # Real-time speed, distance, court zone, and status HUD
│   │   ├── hooks/
│   │   │   └── useVideoSync.ts    # Frame synchronization hook (rVFC + timer fallback)
│   │   ├── utils/
│   │   │   └── canvasDraw.ts      # High-contrast 2K floor rings, neon contours, HUD brackets
│   │   ├── App.tsx                # Main dashboard layout and clip manager
│   │   └── main.tsx               # Entry point
│   ├── verify_clips.js            # Automated clip playback & sync test runner
│   ├── verify_dom.js              # 40-assertion browser DOM & interaction test runner
│   ├── package.json
│   ├── tailwind.config.js
│   └── vite.config.ts
├── test_screenshots/             # Visual QA captures demonstrating all modes and states
└── README.md
```

---

## 🛠️ Technology Stack

| Layer | Tools & Libraries |
|---|---|
| **Computer Vision** | `inference-gpu` (RF-DETR), `supervision` (ByteTrack), Meta `SAM 2`, `opencv-python` |
| **Signal Processing** | `scipy.signal` (Savitzky-Golay), `numpy` (MAD outlier rejection, linear interpolation) |
| **Frontend Framework** | React 18, TypeScript, Vite 6 |
| **Styling & Icons** | Tailwind CSS 3 (Dark HUD Theme), `lucide-react` |
| **Rendering** | HTML5 `<canvas>` (2D Context), Scaled Scalable Vector Graphics (SVG) |
| **Testing** | `puppeteer-core` (Automated headless Chrome E2E testing) |

---

## 📐 Data Contracts

### `telemetry.json` Schema
```json
{
  "metadata": {
    "video_width": 1920,
    "video_height": 1080,
    "fps": 30.0,
    "total_frames": 238,
    "court_width": 2865,
    "court_height": 1524,
    "court_unit": "cm"
  },
  "frames": [
    {
      "frame_idx": 0,
      "timestamp": 0.0,
      "homography_valid": true,
      "players": [
        {
          "id": 1,
          "bbox": [892.4, 412.1, 960.8, 590.3],
          "feet_video_xy": [926.6, 590.3],
          "polygon": [[915.2, 420.0], [955.0, 422.1], [960.0, 580.0], [905.0, 582.0]],
          "court_xy": [1845.2, 760.4],
          "speed_kmh": 14.2,
          "is_interpolated": false
        }
      ]
    }
  ]
}
```

### `roster.json` Schema
```json
{
  "match_info": {
    "home_team": { "code": "BOS", "name": "Boston Celtics", "color": "#007A33", "accent": "#BA9653" },
    "away_team": { "code": "NYK", "name": "New York Knicks", "color": "#F58426", "accent": "#006BB6" }
  },
  "players": {
    "1": { "id": 1, "name": "Jayson Tatum", "shortName": "TATUM", "number": "0", "team": "BOS", "position": "SF" },
    "2": { "id": 2, "name": "Jaylen Brown", "shortName": "BROWN", "number": "7", "team": "BOS", "position": "SG" }
  }
}
```

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
