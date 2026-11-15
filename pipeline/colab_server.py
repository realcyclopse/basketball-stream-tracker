"""
colab_server.py — 100% Free GPU API Server for CourtView Live Web App.

Runs inside Google Colab (Free T4 GPU runtime).
Provides a public HTTPS endpoint using Cloudflare Quick Tunnel (0 signup, 0 card)
or ngrok so the CourtView Live web application can upload videos and receive
live 2D tactical radar and player tracking coordinates in real time.

Usage in Google Colab:
  !pip install -q fastapi uvicorn python-multipart
  !python colab_server.py
"""

from __future__ import annotations

import base64
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path
from typing import Any, Dict, Optional

# Ensure pipeline modules can be imported
sys.path.insert(0, str(Path(__file__).resolve().parent))
import extract_telemetry as pipeline

from fastapi import FastAPI, File, Form, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
import uvicorn

# ---------------------------------------------------------------------------
# FastAPI Application & Detector Warmup
# ---------------------------------------------------------------------------

app = FastAPI(title="CourtView Colab Free GPU Analyzer")

# Allow browser cross-origin requests from localhost and Vercel
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

print("\n[1/3] Loading Roboflow detector models onto GPU...")
player_detector = pipeline.RoboflowPlayerDetector()
court_detector = pipeline.RoboflowCourtDetector()
print("      ✓ Player and Court detector models loaded into VRAM.")


# ---------------------------------------------------------------------------
# API Endpoints
# ---------------------------------------------------------------------------

@app.get("/")
def health():
    return {
        "status": "ok",
        "service": "CourtView Colab Free GPU Analyzer",
        "gpu": "Google Colab NVIDIA T4",
    }


@app.post("/analyze")
@app.post("/")
async def analyze_video(
    video: UploadFile = File(...),
    tracker: str = Form("bytetrack"),
    match_info_json: Optional[str] = Form(None),
):
    """
    Receives an uploaded video from the CourtView Live web app,
    processes it on Colab's GPU, and returns telemetry.json and roster.json.
    """
    match_info = None
    if match_info_json:
        try:
            match_info = json.loads(match_info_json)
        except Exception:
            match_info = None

    video_bytes = await video.read()
    if len(video_bytes) == 0:
        return JSONResponse(status_code=400, content={"status": "error", "message": "Uploaded file is empty."})

    t0 = time.time()
    temp_dir = tempfile.mkdtemp(prefix="courtview_colab_")
    video_path = os.path.join(temp_dir, video.filename or "upload.mp4")
    out_dir = os.path.join(temp_dir, "outputs")
    os.makedirs(out_dir, exist_ok=True)

    try:
        with open(video_path, "wb") as f:
            f.write(video_bytes)

        # Select tracker
        tracker_choice = tracker.lower()
        if tracker_choice == "bytetrack":
            tracker_factory = pipeline.ByteTrackTracker
        elif tracker_choice == "sam2":
            sam2_cfg = os.environ.get("SAM2_CONFIG", pipeline.SAM2_CONFIG)
            sam2_ckpt = os.environ.get("SAM2_CHECKPOINT", pipeline.SAM2_CHECKPOINT)
            predictor = pipeline.load_sam2_predictor(sam2_cfg, sam2_ckpt)
            tracker_factory = (lambda fps: pipeline.Sam2Tracker(predictor)) if predictor else pipeline.ByteTrackTracker
        else:
            tracker_factory = pipeline.ByteTrackTracker

        telemetry = pipeline.process_video(
            video_path=video_path,
            output_dir=out_dir,
            player_detector=player_detector,
            court_detector=court_detector,
            tracker_factory=tracker_factory,
            match_info=match_info,
            overwrite_roster=True,
            show_progress=False,
        )

        roster_path = os.path.join(out_dir, "roster.json")
        roster = {}
        if os.path.exists(roster_path):
            with open(roster_path, "r", encoding="utf-8") as f:
                roster = json.load(f)

        calibration_path = os.path.join(out_dir, "frame_0_calibration.jpg")
        calibration_b64 = None
        if os.path.exists(calibration_path):
            with open(calibration_path, "rb") as f:
                calibration_b64 = "data:image/jpeg;base64," + base64.b64encode(f.read()).decode("utf-8")

        elapsed_sec = round(time.time() - t0, 2)
        total_frames = telemetry.get("metadata", {}).get("total_frames", 0)
        fps = telemetry.get("metadata", {}).get("fps", 30.0)
        proc_fps = round(total_frames / max(elapsed_sec, 0.001), 1)

        print(f"✓ Processed {total_frames} frames in {elapsed_sec}s ({proc_fps} FPS)")

        return {
            "status": "success",
            "telemetry": telemetry,
            "roster": roster,
            "calibration_image": calibration_b64,
            "metrics": {
                "elapsed_seconds": elapsed_sec,
                "total_frames": total_frames,
                "video_fps": fps,
                "processing_fps": proc_fps,
                "tracker_used": tracker_choice,
            },
        }

    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


# ---------------------------------------------------------------------------
# Zero-Signup Cloudflare Tunnel Launcher
# ---------------------------------------------------------------------------

def start_cloudflare_tunnel(port: int = 8000) -> Optional[str]:
    """Downloads cloudflared if needed and exposes the local port with zero sign-up."""
    # Check if cloudflared is already installed
    if not shutil.which("cloudflared"):
        print("[2/3] Installing Cloudflare Tunnel (100% free, zero sign-up)...")
        deb_url = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb"
        subprocess.run(["wget", "-q", "-nc", deb_url], check=False)
        subprocess.run(["dpkg", "-i", "cloudflared-linux-amd64.deb"], check=False)

    if not shutil.which("cloudflared"):
        return None

    # Launch cloudflared tunnel in background
    cmd = ["cloudflared", "tunnel", "--url", f"http://127.0.0.1:{port}"]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)

    public_url = None
    start_time = time.time()
    # Read stderr to extract the trycloudflare.com URL
    while time.time() - start_time < 20:
        line = proc.stderr.readline()
        if not line:
            time.sleep(0.1)
            continue
        match = re.search(r"https://[a-zA-Z0-9-]+\.trycloudflare\.com", line)
        if match:
            public_url = match.group(0)
            break

    return public_url


def main():
    port = 8000
    public_url = start_cloudflare_tunnel(port=port)

    print("\n" + "=" * 65)
    if public_url:
        print("🚀 YOUR 100% FREE COLAB GPU ENDPOINT IS READY:")
        print(f"👉  {public_url}")
        print("\nCopy this URL and paste it into CourtView Live -> 'Upload Clip'")
    else:
        print(f"Local server listening on http://127.0.0.1:{port}")
    print("=" * 65 + "\n")

    uvicorn.run(app, host="0.0.0.0", port=port, log_level="warning")


if __name__ == "__main__":
    main()
