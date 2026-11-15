"""
modal_app.py — Serverless GPU Pipeline for Basketball Stream Telemetry.

Runs player detection (RF-DETR), court keypoint detection (33 landmarks),
homography projection, ByteTrack / SAM 2 tracking, and trajectory smoothing
on an NVIDIA T4 or A10G GPU on Modal.com.

Features:
  - 100% serverless: scales to 0 when idle ($0.00/month standby cost).
  - Webhook API endpoint with CORS for direct upload from the web app.
  - CLI runner for fast local testing: `modal run pipeline/modal_app.py --video clip.mp4`

Setup & Deployment:
  See pipeline/README_MODAL.md
"""

from __future__ import annotations

import base64
import json
import os
import shutil
import tempfile
import time
from pathlib import Path
from typing import Any, Dict, Optional

import modal

# ---------------------------------------------------------------------------
# Modal Container Image & Hardware Configuration
# ---------------------------------------------------------------------------

APP_NAME = "courtview-stream-tracker"

# Define the container with GPU-accelerated PyTorch, OpenCV, Supervision, and Roboflow Inference
image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("libgl1", "ffmpeg", "git")
    .pip_install(
        "supervision>=0.25.0",
        "inference-gpu>=0.25.0",
        "opencv-python>=4.10.0",
        "numpy>=1.26.0",
        "scipy>=1.13.0",
        "tqdm>=4.66.0",
        "fastapi>=0.110.0",
        "python-multipart>=0.0.9",
        "pydantic>=2.0.0",
        "git+https://github.com/roboflow/sports.git@feat/basketball",
    )
    # Add local pipeline helper scripts into the container
    .add_local_file(Path(__file__).parent / "extract_telemetry.py", "/root/pipeline/extract_telemetry.py")
    .add_local_file(Path(__file__).parent / "track_utils.py", "/root/pipeline/track_utils.py")
    .add_local_file(Path(__file__).parent / "trajectory_smoother.py", "/root/pipeline/trajectory_smoother.py")
)

app = modal.App(APP_NAME, image=image)

# Secret containing the user's Roboflow API key
roboflow_secret = modal.Secret.from_name("roboflow-secret", required_keys=["ROBOFLOW_API_KEY"])


# ---------------------------------------------------------------------------
# Core Processing Helper (Runs inside GPU container)
# ---------------------------------------------------------------------------

def _run_pipeline(
    video_bytes: bytes,
    filename: str = "input_clip.mp4",
    tracker: str = "bytetrack",
    match_info: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    import sys
    sys.path.append("/root/pipeline")
    import extract_telemetry as pipeline

    t0 = time.time()
    temp_dir = tempfile.mkdtemp(prefix="courtview_")
    input_path = os.path.join(temp_dir, filename)
    output_dir = os.path.join(temp_dir, "outputs")
    os.makedirs(output_dir, exist_ok=True)

    try:
        # Write incoming video bytes to disk
        with open(input_path, "wb") as f:
            f.write(video_bytes)

        # Initialize detector models on GPU
        player_detector = pipeline.RoboflowPlayerDetector()
        court_detector = pipeline.RoboflowCourtDetector()

        # Select tracker: ByteTrack (fast, default) or SAM 2
        tracker_choice = tracker.lower()
        if tracker_choice == "bytetrack":
            tracker_factory = pipeline.ByteTrackTracker
        elif tracker_choice == "sam2":
            sam2_cfg = os.environ.get("SAM2_CONFIG", pipeline.SAM2_CONFIG)
            sam2_ckpt = os.environ.get("SAM2_CHECKPOINT", pipeline.SAM2_CHECKPOINT)
            predictor = pipeline.load_sam2_predictor(sam2_cfg, sam2_ckpt)
            if predictor is not None:
                tracker_factory = lambda fps: pipeline.Sam2Tracker(predictor)
            else:
                tracker_factory = pipeline.ByteTrackTracker
        else:
            tracker_factory = pipeline.ByteTrackTracker

        # Run detection, tracking, homography projection, and trajectory smoothing
        telemetry = pipeline.process_video(
            video_path=input_path,
            output_dir=output_dir,
            player_detector=player_detector,
            court_detector=court_detector,
            tracker_factory=tracker_factory,
            match_info=match_info,
            overwrite_roster=True,
            show_progress=False,
        )

        # Read generated roster.json
        roster_path = os.path.join(output_dir, "roster.json")
        roster = {}
        if os.path.exists(roster_path):
            with open(roster_path, "r", encoding="utf-8") as f:
                roster = json.load(f)

        # Read calibration frame as base64 thumbnail if generated
        calibration_path = os.path.join(output_dir, "frame_0_calibration.jpg")
        calibration_b64 = None
        if os.path.exists(calibration_path):
            with open(calibration_path, "rb") as f:
                calibration_b64 = "data:image/jpeg;base64," + base64.b64encode(f.read()).decode("utf-8")

        elapsed_sec = round(time.time() - t0, 2)
        total_frames = telemetry.get("metadata", {}).get("total_frames", 0)
        fps = telemetry.get("metadata", {}).get("fps", 30.0)
        proc_fps = round(total_frames / max(elapsed_sec, 0.001), 1)

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
# Modal GPU Function (Callable via Python SDK / CLI)
# ---------------------------------------------------------------------------

@app.function(
    gpu="A10G",               # High-speed NVIDIA A10G GPU (24GB VRAM) for maximum throughput
    timeout=300,
    scaledown_window=300,     # Keeps the container warm for 5 minutes for instant subsequent runs
    secrets=[roboflow_secret],
)
def process_video_task(
    video_bytes: bytes,
    filename: str = "input_clip.mp4",
    tracker: str = "bytetrack",
    match_info: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    return _run_pipeline(video_bytes, filename, tracker, match_info)


# ---------------------------------------------------------------------------
# Public Webhook / REST API Endpoint (FastAPI with CORS via asgi_app)
# ---------------------------------------------------------------------------

@app.function(
    gpu="A10G",               # High-speed NVIDIA A10G GPU (24GB VRAM)
    timeout=300,
    scaledown_window=300,     # Keeps warm for 5 minutes for zero-latency web requests
    secrets=[roboflow_secret],
)
@modal.asgi_app()
def api():
    from fastapi import FastAPI, File, Form, UploadFile
    from fastapi.middleware.cors import CORSMiddleware
    from fastapi.responses import JSONResponse

    web_app = FastAPI(title="CourtView Video Analyzer API")

    # Enable CORS for browser access from Vercel & localhost
    web_app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @web_app.post("/analyze")
    @web_app.post("/")
    async def analyze(
        video: UploadFile = File(...),
        tracker: str = Form("bytetrack"),
        match_info_json: Optional[str] = Form(None),
    ):
        match_info = None
        if match_info_json:
            try:
                match_info = json.loads(match_info_json)
            except Exception:
                match_info = None

        video_bytes = await video.read()
        if len(video_bytes) == 0:
            return JSONResponse(status_code=400, content={"status": "error", "message": "Video is empty."})

        result = _run_pipeline(
            video_bytes=video_bytes,
            filename=video.filename or "upload.mp4",
            tracker=tracker,
            match_info=match_info,
        )
        return result

    @web_app.get("/")
    def health():
        return {"status": "ok", "service": "CourtView Video Analyzer API", "gpu": "NVIDIA T4"}

    return web_app


# ---------------------------------------------------------------------------
# CLI Entrypoint for Local Testing via `modal run`
# ---------------------------------------------------------------------------

@app.local_entrypoint()
def main(
    video: str = "web/public/clips/bos-nyk-q1-0428/video.mp4",
    tracker: str = "bytetrack",
    output: str = "modal_output.json",
):
    """
    Run pipeline on a clip using Modal GPU workers from your local command line:
      modal run pipeline/modal_app.py --video web/public/clips/bos-nyk-q1-0428/video.mp4
    """
    video_path = Path(video)
    if not video_path.exists():
        print(f"Error: Video file not found: {video}")
        return

    print(f"Uploading {video_path.name} ({video_path.stat().st_size / 1e6:.1f} MB) to Modal GPU...")
    video_bytes = video_path.read_bytes()

    t_start = time.time()
    result = process_video_task.remote(
        video_bytes=video_bytes,
        filename=video_path.name,
        tracker=tracker,
    )
    total_time = round(time.time() - t_start, 2)

    if result.get("status") == "success":
        metrics = result.get("metrics", {})
        print("\n=== Success! ===")
        print(f"Total turnaround time: {total_time}s")
        print(f"GPU processing time:   {metrics.get('elapsed_seconds')}s ({metrics.get('processing_fps')} FPS)")
        print(f"Frames analyzed:       {metrics.get('total_frames')}")
        print(f"Tracker:               {metrics.get('tracker_used')}")

        output_path = Path(output)
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump({
                "telemetry": result["telemetry"],
                "roster": result["roster"],
                "metrics": metrics,
            }, f, indent=2)
        print(f"Saved results to:      {output_path.resolve()}\n")
    else:
        print("Processing failed:", result)
