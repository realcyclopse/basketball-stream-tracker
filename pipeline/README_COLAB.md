# Basketball Player Tracking Pipeline - Google Colab Guide

Run the full CV pipeline in Google Colab — no local GPU required.

---

## Prerequisites

| Requirement | Details |
|---|---|
| **Google Colab** | Free tier works with ByteTrack; T4 or A100 runtime recommended for SAM2 |
| **Video** | A basketball broadcast `.mp4` clip (ideally showing a full-court or half-court view) |

> [!TIP]
> To switch to a GPU runtime: **Runtime → Change runtime type → T4 GPU** (or A100 if available on Colab Pro).

---

## Step 1: Setup Environment

Install all required packages in a single cell:

```python
# Core dependencies
!pip install inference-gpu supervision opencv-python numpy scipy tqdm

# Roboflow Sports utilities (basketball branch)
!pip install git+https://github.com/roboflow/sports.git@feat/basketball
```

> [!NOTE]
> `inference-gpu` will automatically fall back to CPU if no CUDA device is detected, so this works on the free tier too.

---

## Step 2: Upload Your Video

```python
from google.colab import files

uploaded = files.upload()  # Upload your .mp4 file

# Grab the filename for later use
import list
VIDEO_FILE = list(uploaded.keys())[0]
print(f"Uploaded: {VIDEO_FILE}")
```

Alternatively, if your video is already hosted somewhere:

```python
# Download from a direct URL
!wget -O clip.mp4 "https://example.com/your_clip.mp4"
VIDEO_FILE = "clip.mp4"
```

---

## Step 3: Clone the Repository

```python
!git clone https://github.com/<your-org>/basketball-stream-tracker.git
%cd basketball-stream-tracker/pipeline
```

> [!IMPORTANT]
> Replace `<your-org>` with the actual GitHub org/user that hosts the repository.

---

## Step 4: Run the Pipeline

### Option A: ByteTrack (CPU-friendly — works on free Colab)

```python
!python extract_telemetry.py \
    --video /content/{VIDEO_FILE} \
    --tracker bytetrack
```

ByteTrack is lightweight and runs well even without a GPU. Use this option if you're on the free Colab tier or want faster iteration.

### Option B: SAM2 (requires GPU runtime)

```python
!python extract_telemetry.py \
    --video /content/{VIDEO_FILE} \
    --tracker sam2
```

SAM2 produces more accurate masks and handles occlusions better, but needs a CUDA-capable GPU. Make sure you've switched to a **T4** or **A100** runtime before running this.

### Common Flags

| Flag | Default | Description |
|---|---|---|
| `--video` | *(required)* | Path to the input `.mp4` file |
| `--tracker` | `bytetrack` | Tracking backend: `bytetrack` or `sam2` |
| `--confidence` | `0.3` | Detection confidence threshold (lower = more detections) |
| `--output` | `telemetry.json` | Output telemetry file path |

---

## Step 5: Examine the Calibration Frame

After the pipeline runs, it saves a calibration frame showing detected players with their tracker IDs overlaid:

```python
from IPython.display import Image, display

display(Image('frame_0_calibration.jpg'))
```

Study the image and note which `tracker_id` corresponds to which player on screen. You'll use these mappings in the next step.

---

## Step 6: Edit the Roster

The pipeline generates a `roster.json` file with placeholder names. You need to map each `tracker_id` to the correct player name.

### Quick inline edit (recommended in Colab)

```python
import json

# Load the generated roster
with open('roster.json', 'r') as f:
    roster = json.load(f)

print("Current roster:")
print(json.dumps(roster, indent=2))
```

```python
# Update player names based on the calibration frame
# Replace the placeholder values with real player names

roster["players"]["1"] = {"name": "LeBron James",   "team": "home", "jersey": "23"}
roster["players"]["2"] = {"name": "Stephen Curry",  "team": "away", "jersey": "30"}
# ... repeat for all tracked players

# Save the updated roster
with open('roster.json', 'w') as f:
    json.dump(roster, f, indent=2)

print("Roster updated ✓")
```

### Or edit manually

Double-click `roster.json` in the Colab file browser (left sidebar) and edit the JSON directly.

---

## Step 7: Download Results

```python
from google.colab import files

files.download('telemetry.json')
files.download('roster.json')
```

Copy both files into your local project's `web/public/` directory so the front-end can consume them:

```
basketball-stream-tracker/
└── web/
    └── public/
        ├── telemetry.json   ← paste here
        └── roster.json      ← paste here
```

---

## Troubleshooting

| Problem | Solution |
|---|---|
| **CUDA out of memory** | Switch to `--tracker bytetrack`, or restart the runtime and try a shorter clip. |
| **Few keypoints detected** | Make sure the broadcast view shows the full (or nearly full) court. Close-up camera angles won't have enough reference points for homography. |
| **Player IDs keep changing** | Lower the `--confidence` threshold (e.g., `--confidence 0.2`) so the detector doesn't lose players between frames. |
| **`inference-gpu` install fails** | Run `!pip install inference` instead (CPU-only fallback). |
| **Video upload times out** | Use `wget` to pull the video from a URL instead of the upload widget (see Step 2). |
| **Import errors after install** | Restart the runtime (**Runtime → Restart runtime**) and re-run the import cells. |

---

## Full Copy-Paste Notebook

For convenience, here's every step in a single block you can paste into a fresh Colab notebook:

```python
# ── 1. Install ──────────────────────────────────────────
!pip install -q inference-gpu supervision opencv-python numpy scipy tqdm
!pip install -q git+https://github.com/roboflow/sports.git@feat/basketball

# ── 2. Upload video ────────────────────────────────────
from google.colab import files
uploaded = files.upload()
VIDEO = list(uploaded.keys())[0]

# ── 3. Clone repo ──────────────────────────────────────
!git clone https://github.com/<your-org>/basketball-stream-tracker.git
%cd basketball-stream-tracker/pipeline

# ── 4. Run pipeline ────────────────────────────────────
!python extract_telemetry.py --video /content/{VIDEO} --tracker bytetrack

# ── 5. Check calibration ───────────────────────────────
from IPython.display import Image, display
display(Image('frame_0_calibration.jpg'))

# ── 6. (Edit roster.json with correct player names) ───

# ── 7. Download results ────────────────────────────────
files.download('telemetry.json')
files.download('roster.json')
```

> [!NOTE]
> Remember to replace `<your-org>` with your actual repository path before running.
