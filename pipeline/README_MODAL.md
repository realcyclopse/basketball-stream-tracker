# Serverless GPU Pipeline with Modal.com (Phase 2)

This directory contains the **Modal.com serverless GPU implementation** (`modal_app.py`).

It allows you to run the complete computer vision pipeline (RF-DETR + Court Homography + ByteTrack / SAM 2) on high-speed cloud GPUs on-demand with:
- **Instant cold starts (~2–3 seconds)**.
- **Pay-per-second billing** (billed only while actively processing; costs ~$0.0016 per clip on T4).
- **Zero standby cost** ($0.00/month when idle, scales to 0).
- **Public REST API endpoint** connected directly to the CourtView Live web application.

---

## 🚀 Step-by-Step Setup Guide

### Step 1: Install Modal CLI
In your local command prompt or PowerShell:
```bash
pip install modal
```

### Step 2: Authenticate with Modal
Run:
```bash
modal setup
```
This automatically opens your browser to authenticate and link your machine to your Modal account.

### Step 3: Add your Roboflow API Key as a Modal Secret
Never hardcode your API key into code or Git. Store it securely in Modal:
```bash
modal secret create roboflow-secret ROBOFLOW_API_KEY=your_roboflow_key_here
```
*(Replace `your_roboflow_key_here` with your actual Roboflow API key from your Roboflow dashboard).*

---

## 🧪 Step 4: Test via Modal CLI (Optional but Recommended)

You can test running the pipeline on a remote GPU right from your command line:
```bash
modal run pipeline/modal_app.py --video web/public/clips/bos-nyk-q1-0428/video.mp4 --tracker bytetrack
```

### Expected Output:
```text
Uploading video.mp4 (9.4 MB) to Modal GPU...

=== Success! ===
Total turnaround time: 13.4s
GPU processing time:   7.8s (30.5 FPS)
Frames analyzed:       238
Tracker:               bytetrack
Saved results to:      .../modal_output.json
```

---

## 🌐 Step 5: Deploy the Live Endpoint for Web App Uploads

To enable the web application to send uploaded clips to your Modal GPU:

```bash
modal deploy pipeline/modal_app.py
```

### Output:
Modal will print your live HTTPS endpoint URL:
```text
✓ Created App: courtview-stream-tracker
✓ Deployed api => https://<your-username>--courtview-stream-tracker-api.modal.run
```

---

## 🏀 Step 6: Connect to CourtView Live

1. Open your web app (e.g. `http://localhost:5173` or your live Vercel URL).
2. Click the blue **"Upload Clip"** button in the header.
3. In the modal, paste your Modal URL into the **Modal.com Endpoint URL** field:
   `https://<your-username>--courtview-stream-tracker-api.modal.run`
   *(It saves automatically in your browser's local storage).*
4. Drag and drop any 5–15 second `.mp4` clip and click **"Run GPU Analysis"**!
5. In ~10–15 seconds, your clip will be fully tracked with 2K glowing floor rings, player badges, and 2D radar!

---

## 📊 Cost & Performance on Modal

| Hardware | Video Length | Processing Time | Cost per Video | Videos per $1 Credit |
|---|---|---|---|---|
| **NVIDIA T4** *(Default)* | 8s (240 frames) | **~8 – 12 seconds** | **~$0.0016** | **~600 videos** |
| **NVIDIA A10G** | 8s (240 frames) | **~6 – 8 seconds** | **~$0.0030** | **~330 videos** |
| **Google Colab Free** | 8s (240 frames) | ~10 – 12 minutes | Free | Unlimited (Shared CPU) |
