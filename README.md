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
- **Zero-Dependency Playback** — Works immediately with generated mock telemetry, no GPU required for the web app

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
│          calibration.jpg     │     │         demo_clip.mp4         │
└─────────────────────────────┘     └─────────────────────────────┘
```

## 🚀 Quick Start

### 1. Generate Mock Data (Instant — No GPU needed)
```bash
cd pipeline
python generate_mock_telemetry.py
```

### 2. Install & Run Web App
```bash
cd web
npm install
npm run dev
```

Open http://localhost:5173 — the app runs with synthetic visualization even without a video file.

### 3. (Optional) Process Real Broadcast Video

See [Pipeline Colab Guide](pipeline/README_COLAB.md) for detailed instructions.

```bash
cd pipeline
pip install -r requirements.txt
python extract_telemetry.py --video path/to/broadcast.mp4 --tracker bytetrack
# Copy generated files to web/public/
```

## 📁 Project Structure

```
basketball-stream-tracker/
├── pipeline/
│   ├── requirements.txt             # Python CV dependencies
│   ├── extract_telemetry.py         # Main CV pipeline (RF-DETR + tracking + homography)
│   ├── trajectory_smoother.py       # MAD outlier rejection + interpolation + smoothing
│   ├── generate_mock_telemetry.py   # Mock data generator for instant UI testing
│   └── README_COLAB.md              # Google Colab step-by-step guide
├── web/
│   ├── public/
│   │   ├── telemetry.json           # Frame-by-frame tracking data
│   │   └── roster.json              # Player metadata mapping
│   ├── src/
│   │   ├── types/telemetry.ts       # TypeScript interfaces
│   │   ├── components/
│   │   │   ├── StreamPlayer.tsx     # Video + canvas overlay
│   │   │   ├── RosterSidebar.tsx    # Interactive player selector
│   │   │   ├── CourtRadar2D.tsx     # 2D court minimap
│   │   │   └── PlayerStatsBar.tsx   # Live stats HUD
│   │   ├── hooks/useVideoSync.ts    # Frame synchronization hook
│   │   ├── utils/canvasDraw.ts      # Canvas drawing utilities
│   │   ├── App.tsx                  # Main application layout
│   │   └── main.tsx                 # Entry point
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
Frame-indexed player states with bounding boxes, polygons, court coordinates, and speed.

### roster.json  
Maps tracker IDs to player metadata (name, number, team, position).

## 📄 License

MIT
