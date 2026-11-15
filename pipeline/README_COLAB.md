# Tracking pipeline on Google Colab

The web app plays three demo clips from `web/public/clips/`. Each clip needs a
`telemetry.json` produced by this pipeline before player tracking shows up.
The pipeline needs a GPU and a Roboflow API key, so it runs in Colab; the
website itself stays fully static.

## What you need

| | |
|---|---|
| Google Colab | T4 GPU runtime (free tier is enough) |
| Roboflow API key | Free account → Settings → API Keys |
| This repository | Pushed to GitHub with the clips in `web/public/clips/` |

Keep the API key out of notebooks and commits: store it as a Colab secret named
`ROBOFLOW_API_KEY` (key icon in the left bar, enable notebook access).

## Steps

1. Open [`colab_pipeline.ipynb`](colab_pipeline.ipynb) in Colab
   (File → Open notebook → GitHub, or upload the file).
2. `Runtime → Change runtime type → T4 GPU`.
3. Add the `ROBOFLOW_API_KEY` secret.
4. Run the cells top to bottom. The SAM2 cell is optional (see below).
5. The last cell downloads `tracking_outputs.zip`. Unzip it into
   `web/public/clips/` so each clip folder ends up with:

   ```
   web/public/clips/<clip_id>/
   ├── video.mp4
   ├── telemetry.json            # per-frame tracking data
   ├── roster.json               # draft: tracker id -> player
   └── frame_0_calibration.jpg   # first frame, boxes labelled "ID: <n>"
   ```
6. Edit each `roster.json`: the pipeline does not read jersey numbers, so
   players are named `Player <id>` and the team is a guess from jersey colour.
   Match ids to players using `frame_0_calibration.jpg`, then remove the
   `"draft": true` line.
7. `cd web && npm run dev`, pick a clip and check the overlay.

## Trackers

| `--tracker` | Needs | Outlines | Ids |
|---|---|---|---|
| `bytetrack` | nothing extra | approximated from the box | fragments on occlusion are stitched afterwards |
| `sam2` | SAM2 real-time install + CUDA | real silhouettes | stable, but only players visible in the first frame are tracked |
| `auto` (default) | — | SAM2 if installed, else ByteTrack | |

## Running it yourself

```bash
cd pipeline
pip install -r requirements.txt
export ROBOFLOW_API_KEY=...                 # never commit this

python test_pipeline.py                     # offline self-test, no key needed
python extract_telemetry.py                 # every clip in web/public/clips
python extract_telemetry.py --video my.mp4 --output-dir out/
```

Useful flags: `--overwrite-roster` (regenerate an existing `roster.json`),
`--match-info teams.json` (other teams: `{"home_team": {...}, "away_team": {...}}`
with `code`, `name`, `color`, `accent`), `--min-track-frames N`,
`--max-players N` (default 10; only the N longest tracks are kept, so ids run
1..10 and referees / bench players picked up for a moment are dropped; 0 = keep all).

Re-running a clip can change tracker ids, so redo its `roster.json` afterwards.

## Adding a clip

1. Create `web/public/clips/<clip_id>/video.mp4` (H.264, constant frame rate).
2. Add an entry to `web/public/clips/clips.json` with its `fps`, `frames`,
   `width` and `height`.
3. Run the pipeline.

## Troubleshooting

- **`ROBOFLOW_API_KEY is not set`** — the secret is missing or notebook access is off.
- **"No valid homography in this clip"** — fewer than four court landmarks were
  found; the radar stays empty. Use a wide broadcast angle with court lines visible.
- **Players on the wrong team** — fix `team` in `roster.json`.
- **Too many / duplicate players** — raise `--min-track-frames` or `--confidence`,
  or use the SAM2 tracker.
- **A label jumps to another player** — ByteTrack swapped two ids. Swaps between
  opponents are undone from jersey colour; swaps between team-mates are not
  detected. Use the SAM2 tracker for those clips.
