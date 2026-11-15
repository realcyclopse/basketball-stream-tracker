# 🏀 Basketball Live-Stream Player Tracker & 2D Tactical Radar

An interactive web application for real-time basketball player tracking with broadcast-quality overlays and a synchronized 2D tactical court minimap.

![CourtView Live](https://img.shields.io/badge/status-MVP-brightgreen) ![React](https://img.shields.io/badge/React-18-blue) ![TypeScript](https://img.shields.io/badge/TypeScript-5-blue) ![Python](https://img.shields.io/badge/Python-3.10+-yellow)

## ✨ Features

- **NBA 2K-Style Tracking Overlay** — Perspective floor rings, neon contour outlines, and HUD corner brackets on the live video stream
- **Broadcast Pill Badges** — Floating player name/number/speed badges above tracked players
- **2D Tactical Court Radar** — Synchronized top-down SVG minimap with all 10 player positions, movement trails, and velocity vectors
- **Interactive Roster Menu** — Click any player in the sidebar, on the video, or on the court radar to track them
- **Live Stats HUD** — Real-time speed, cumulative distance, court zone classification, and tracking status
- **Three Highlight Modes** — Toggle between Floor Ring, Neon Outline, and HUD Brackets visualization styles
- **Occlusion Handling** — Dashed indicators for predicted/interpolated player positions during occlusions
- **Three Demo Clips** — Clip picker with per-clip footage, telemetry and roster; tracking is precomputed, so the site is fully static
- **Synthetic Demo** — A mock-telemetry clip works with no video and no GPU

## 🏗️ Architecture

```
┌─────────────────────────────┐     ┌─────────────────────────────┐
│   Stage 1: CV Pipeline      │     │   Stage 2: Web Frontend     │
│   (Python / Google Colab)    │────▶│   (React + Vite + Tailwind) │
│                              │     │                              │
│  RF-DETR Detection           │     │  HTML5 <video> + <canvas>   │
│  ByteTrack / SAM2 Tracking   │     │  requestVideoFrameCallback  │
│  Court Keypoint Homography   │     │  SVG Court Minimap           │
│  Trajectory Smoothing        │     │  60 FPS Synchronized Overlay │
│                              │     │                              │
│  Output: telemetry.json      │     │  Input: telemetry.json       │
│          roster.json         │     │         roster.json           │
│          calibration.jpg     │     │         video.mp4             │
└─────────────────────────────┘     └─────────────────────────────┘
```

## 🚀 Quick Start

### 1. Run the web app
```bash
cd web
npm install
npm run dev
```

Open http://localhost:5173 and pick a clip in the header. The three broadcast clips play
immediately; their tracking overlay appears once the pipeline has produced a
`telemetry.json` for them. The `Synthetic` clip always works (mock data).

### 2. Generate tracking data for the clips

The pipeline needs a GPU and a Roboflow API key. Follow the
[Colab guide](pipeline/README_COLAB.md) (notebook: `pipeline/colab_pipeline.ipynb`),
then unzip its output into `web/public/clips/`.

### 3. Deploy

```bash
cd web
npm run build      # static site in web/dist, hostable at any path
```

Check you have the rights to publish the footage in `web/public/clips/` before deploying publicly.

### Checks

```bash
python pipeline/test_pipeline.py                     # pipeline, offline (stub detectors)
cd web && npm run build && npx vite preview --port 5173
node verify_dom.js                                   # UI suite on the synthetic clip
node verify_clips.js                                 # every demo clip loads, plays, syncs
```

## 📁 Project Structure

```
basketball-stream-tracker/
├── pipeline/
│   ├── requirements.txt             # Python CV dependencies
│   ├── extract_telemetry.py         # Detection + tracking + homography, per clip
│   ├── track_utils.py               # Court geometry, track clean-up, team clustering
│   ├── trajectory_smoother.py       # Jump rejection + interpolation + smoothing
│   ├── test_pipeline.py             # Offline end-to-end test with stub detectors
│   ├── generate_mock_telemetry.py   # Mock data for the synthetic clip
│   ├── colab_pipeline.ipynb         # Colab notebook
│   └── README_COLAB.md              # Pipeline guide
├── web/
│   ├── public/clips/
│   │   ├── clips.json               # Clip manifest
│   │   └── <clip_id>/               # video.mp4, telemetry.json, roster.json
│   ├── src/
│   │   ├── types/telemetry.ts       # TypeScript interfaces
│   │   ├── components/
│   │   │   ├── StreamPlayer.tsx     # Video + canvas overlay
│   │   │   ├── RosterSidebar.tsx    # Interactive player selector
│   │   │   ├── CourtRadar2D.tsx     # 2D court minimap
│   │   │   └── PlayerStatsBar.tsx   # Live stats HUD
│   │   ├── hooks/useVideoSync.ts    # Frame synchronization hook
│   │   ├── utils/canvasDraw.ts      # Canvas drawing utilities
│   │   ├── App.tsx                  # Clip loading + layout
│   │   └── main.tsx                 # Entry point
│   ├── verify_dom.js / verify_clips.js
│   ├── package.json
│   ├── vite.config.ts
│   └── tailwind.config.js
└── README.md
```

## 🔧 Tech Stack

| Layer | Technology |
|-------|-----------|
| Detection | RF-DETR (Roboflow Basketball model) |
| Tracking | ByteTrack (CPU) / SAM 2 (GPU) |
| Homography | 33-point court keypoint model |
| Smoothing | Savitzky-Golay / EMA filters |
| Frontend | React 18 + TypeScript + Vite |
| Styling | Tailwind CSS (Dark Theme) |
| Icons | Lucide React |
| Rendering | HTML5 Canvas + SVG |

## 📐 Data Contracts

### telemetry.json
Frame-indexed player states with bounding boxes, polygons, court coordinates (cm, `null` when no court mapping exists for that frame), and speed.

### roster.json  
Maps tracker IDs to player metadata (name, number, team, position). The pipeline writes a draft (`"draft": true`) to be edited by hand.

## 📄 License

MIT
