# Serverless GPU Pipeline with Modal.com (Phase 2)

This directory contains the **Modal.com serverless GPU implementation** (`modal_app.py`).

It allows you to run the complete computer vision pipeline (RF-DETR + Keypoint Homography + ByteTrack / SAM 2) on high-speed **NVIDIA A10G GPUs** in the cloud on-demand, with:
- **Instant cold starts (~2–3 seconds)**.
- **Pay-per-second billing** (billed only while processing; costs ~$0.005 per clip).
- **Zero standby cost** ($0.00/month when idle).
- **Public REST API endpoint** connected directly to the CourtView Live web application.

---

## 🚀 Quick Setup (5 Minutes)

### 1. Create a Free Modal Account
1. Go to [modal.com](https://modal.com) and sign up with GitHub.
2. Modal provides **$30 in free credits every month**, which covers ~3,000 video analyses for free.

### 2. Install Modal CLI
In your local terminal:
```bash
pip install modal
```

Authenticate your local machine:
```bash
modal setup
```
*(This opens a browser window to link your local terminal to your Modal account).*

### 3. Add your Roboflow API Key as a Modal Secret
Never hardcode your API key. Create a secret named `roboflow-secret` in Modal:
```bash
modal secret create roboflow-secret ROBOFLOW_API_KEY=your_roboflow_key_here
```

---

## 🧪 Testing Locally via Modal CLI

You can test processing a video on a remote A10G GPU right from your terminal without deploying a persistent web server:

```bash
modal run pipeline/modal_app.py --video web/public/clips/bos-nyk-q1-0428/video.mp4 --tracker bytetrack
```

### Expected Output:
```text
Uploading video.mp4 (9.4 MB) to Modal A10G GPU...

=== Success! ===
Total turnaround time: 14.8s
GPU processing time:   8.2s (29.0 FPS)
Frames analyzed:       238
Tracker:               bytetrack
Saved results to:      .../modal_output.json
```

---

## 🌐 Deploying the Public API Endpoint for Web App Uploads

To enable users to upload `.mp4` videos directly from the deployed CourtView Live website:

```bash
modal deploy pipeline/modal_app.py
```

### Output:
Modal will print your live public HTTPS endpoint:
```text
✓ Created App: courtview-stream-tracker
✓ Deployed analyze_video => https://your-username--courtview-stream-tracker-analyze-video.modal.run
```

Copy that URL and paste it into the **Modal Endpoint URL** setting in the CourtView Live web application (or set `VITE_MODAL_API_URL` in `web/.env`).

---

## 📊 Performance Comparison

| Infrastructure | Video Length | Processing Time | Cost |
|---|---|---|---|
| **Google Colab Free (T4 CPU/GPU)** | 3 videos (8s each) | ~30 – 35 mins | Free (Heavily throttled) |
| **Modal A10G GPU (ByteTrack)** | 3 videos (8s each) | **~15 – 20 seconds total** | ~$0.01 (Covered by $30 free tier) |
| **Modal A10G GPU (SAM 2 Large)** | 3 videos (8s each) | **~1.5 – 2 minutes total** | ~$0.03 (Covered by $30 free tier) |
