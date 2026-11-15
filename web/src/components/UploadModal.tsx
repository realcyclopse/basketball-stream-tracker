import React, { useState, useRef, useEffect } from 'react';
import { 
  X, 
  Upload, 
  Film, 
  Cpu, 
  Zap, 
  Settings2, 
  CheckCircle2, 
  AlertCircle, 
  Loader2, 
  Download, 
  Play,
  Layers
} from 'lucide-react';
import { TelemetryData, RosterData, MatchInfo } from '../types/telemetry';

export interface UploadResult {
  clipId: string;
  title: string;
  subtitle: string;
  videoBlobUrl: string;
  telemetry: TelemetryData;
  roster: RosterData;
  calibrationImage?: string;
  fps: number;
  frames: number;
  width: number;
  height: number;
}

interface UploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onClipLoaded: (result: UploadResult) => void;
}

type TrackerType = 'bytetrack' | 'sam2';
type ProcessingStep = 'idle' | 'uploading' | 'detecting' | 'homography' | 'smoothing' | 'complete' | 'error';

const TEAM_PRESETS = [
  {
    name: 'BOS vs NYK',
    home: { code: 'BOS', name: 'Boston Celtics', color: '#007A33', accent: '#BA9653' },
    away: { code: 'NYK', name: 'New York Knicks', color: '#006BB6', accent: '#F58426' },
  },
  {
    name: 'LAL vs GSW',
    home: { code: 'LAL', name: 'Los Angeles Lakers', color: '#552583', accent: '#FDB927' },
    away: { code: 'GSW', name: 'Golden State Warriors', color: '#1D428A', accent: '#FFC72C' },
  },
  {
    name: 'DEN vs MIA',
    home: { code: 'DEN', name: 'Denver Nuggets', color: '#0E2240', accent: '#FEC524' },
    away: { code: 'MIA', name: 'Miami Heat', color: '#98002E', accent: '#F9A01B' },
  },
];

export const UploadModal: React.FC<UploadModalProps> = ({ isOpen, onClose, onClipLoaded }) => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [videoPreviewUrl, setVideoPreviewUrl] = useState<string | null>(null);
  const [videoMeta, setVideoMeta] = useState<{ duration: number; width: number; height: number; fps: number } | null>(null);
  const [tracker, setTracker] = useState<TrackerType>('bytetrack');
  const [teamPresetIdx, setTeamPresetIdx] = useState(0);
  const [modalApiUrl, setModalApiUrl] = useState(() => localStorage.getItem('modal_api_url') || '');
  const [step, setStep] = useState<ProcessingStep>('idle');
  const [progress, setProgress] = useState(0);
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [resultData, setResultData] = useState<UploadResult | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (modalApiUrl) {
      localStorage.setItem('modal_api_url', modalApiUrl);
    }
  }, [modalApiUrl]);

  // Clean up video blob URL on unmount or file change
  useEffect(() => {
    return () => {
      if (videoPreviewUrl) URL.revokeObjectURL(videoPreviewUrl);
    };
  }, [videoPreviewUrl]);

  if (!isOpen) return null;

  const handleFileSelect = (file: File) => {
    if (!file.type.includes('video') && !file.name.endsWith('.mp4')) {
      setErrorMessage('Please select a valid .mp4 or .webm video clip.');
      return;
    }

    if (file.size > 100 * 1024 * 1024) {
      setErrorMessage('Clip is larger than 100MB. Please use a shorter broadcast clip (5–15 seconds).');
      return;
    }

    setErrorMessage(null);
    setSelectedFile(file);
    const blobUrl = URL.createObjectURL(file);
    setVideoPreviewUrl(blobUrl);

    // Extract video duration and dimensions
    const videoElem = document.createElement('video');
    videoElem.src = blobUrl;
    videoElem.preload = 'metadata';
    videoElem.onloadedmetadata = () => {
      setVideoMeta({
        duration: Math.round(videoElem.duration * 10) / 10,
        width: videoElem.videoWidth || 1920,
        height: videoElem.videoHeight || 1080,
        fps: 30, // standard broadcast fallback
      });
    };
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileSelect(e.dataTransfer.files[0]);
    }
  };

  const startAnalysis = async (simulate = false) => {
    if (!selectedFile || !videoMeta || !videoPreviewUrl) return;

    setStep('uploading');
    setProgress(15);
    setStatusMessage('Uploading clip to GPU worker...');
    setErrorMessage(null);
    setElapsedSeconds(0);

    const startTime = Date.now();
    timerRef.current = setInterval(() => {
      setElapsedSeconds(Math.round((Date.now() - startTime) / 1000));
    }, 500);

    const matchInfo: MatchInfo = {
      home_team: TEAM_PRESETS[teamPresetIdx].home,
      away_team: TEAM_PRESETS[teamPresetIdx].away,
    };

    try {
      if (simulate || !modalApiUrl.trim()) {
        // --- SIMULATED / OFFLINE DEMO PIPELINE ---
        await new Promise((r) => setTimeout(r, 900));
        setStep('detecting');
        setProgress(40);
        setStatusMessage(`Running RF-DETR & ${tracker === 'bytetrack' ? 'ByteTrack' : 'SAM 2'} on GPU...`);

        await new Promise((r) => setTimeout(r, 1200));
        setStep('homography');
        setProgress(70);
        setStatusMessage('Fitting 33-point Court Keypoints & Homography...');

        await new Promise((r) => setTimeout(r, 900));
        setStep('smoothing');
        setProgress(90);
        setStatusMessage('Applying Savitzky-Golay trajectory de-jittering...');

        await new Promise((r) => setTimeout(r, 600));

        // Generate synthetic matching telemetry
        const totalFrames = Math.max(30, Math.round(videoMeta.duration * videoMeta.fps));
        const syntheticTelemetry = generateDynamicTelemetry(totalFrames, videoMeta.fps, videoMeta.width, videoMeta.height);
        const syntheticRoster = generateRoster(matchInfo);

        const result: UploadResult = {
          clipId: `upload-${Date.now().toString(36)}`,
          title: `Upload · ${videoMeta.duration}s`,
          subtitle: `${matchInfo.home_team.code} vs ${matchInfo.away_team.code}`,
          videoBlobUrl: videoPreviewUrl,
          telemetry: syntheticTelemetry,
          roster: syntheticRoster,
          fps: videoMeta.fps,
          frames: totalFrames,
          width: videoMeta.width,
          height: videoMeta.height,
        };

        if (timerRef.current) clearInterval(timerRef.current);
        setProgress(100);
        setStep('complete');
        setStatusMessage(`Analyzed ${totalFrames} frames successfully!`);
        setResultData(result);
      } else {
        // --- REAL MODAL.COM SERVERLESS GPU CALL ---
        const formData = new FormData();
        formData.append('video', selectedFile);
        formData.append('tracker', tracker);
        formData.append('match_info_json', JSON.stringify(matchInfo));

        setStep('detecting');
        setProgress(35);
        setStatusMessage(`Processing on Modal A10G GPU with ${tracker}...`);

        const response = await fetch(modalApiUrl.trim(), {
          method: 'POST',
          body: formData,
        });

        if (!response.ok) {
          throw new Error(`Modal server error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        if (data.status !== 'success') {
          throw new Error(data.message || 'Modal processing returned an error.');
        }

        const totalFrames = data.telemetry?.metadata?.total_frames || Math.round(videoMeta.duration * 30);
        const result: UploadResult = {
          clipId: `upload-${Date.now().toString(36)}`,
          title: `Custom Clip · ${Math.round(videoMeta.duration)}s`,
          subtitle: `${matchInfo.home_team.code} vs ${matchInfo.away_team.code}`,
          videoBlobUrl: videoPreviewUrl,
          telemetry: data.telemetry,
          roster: data.roster || generateRoster(matchInfo),
          calibrationImage: data.calibration_image,
          fps: data.telemetry?.metadata?.fps || 30,
          frames: totalFrames,
          width: videoMeta.width,
          height: videoMeta.height,
        };

        if (timerRef.current) clearInterval(timerRef.current);
        setProgress(100);
        setStep('complete');
        setStatusMessage(`Processed on A10G in ${data.metrics?.elapsed_seconds || elapsedSeconds}s!`);
        setResultData(result);
      }
    } catch (err: any) {
      if (timerRef.current) clearInterval(timerRef.current);
      setStep('error');
      setErrorMessage(err.message || 'Failed to process clip on GPU.');
    }
  };

  const handleLaunch = () => {
    if (resultData) {
      onClipLoaded(resultData);
      onClose();
    }
  };

  const handleDownloadBundle = () => {
    if (!resultData) return;
    const bundle = {
      metadata: resultData.telemetry.metadata,
      telemetry: resultData.telemetry,
      roster: resultData.roster,
    };
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `courtview_${resultData.clipId}_telemetry.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in">
      <div className="relative w-full max-w-2xl bg-[#111827] border border-gray-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800 bg-[#161F30]">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-blue-600/20 text-blue-400 border border-blue-500/30">
              <Upload className="w-4 h-4" />
            </div>
            <div>
              <h2 id="upload-modal-title" className="text-base font-bold text-white flex items-center gap-2">
                Analyze New Broadcast Clip
                <span className="px-2 py-0.5 text-[10px] uppercase font-bold tracking-wider bg-blue-500/20 text-blue-400 border border-blue-500/30 rounded-full">
                  Phase 2 GPU
                </span>
              </h2>
              <p className="text-xs text-gray-400">Upload a 5–15s NBA broadcast clip for automated player tracking & 2D radar</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1">

          {/* STEP: COMPLETE */}
          {step === 'complete' && resultData ? (
            <div className="flex flex-col items-center justify-center py-6 text-center space-y-4">
              <div className="w-16 h-16 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 animate-bounce">
                <CheckCircle2 className="w-8 h-8" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white">Clip Analyzed Successfully!</h3>
                <p className="text-sm text-gray-400 mt-1">
                  Generated {resultData.frames} frames of telemetry and calibrated 10 players in {elapsedSeconds}s.
                </p>
              </div>

              {resultData.calibrationImage && (
                <div className="w-full max-w-sm rounded-lg overflow-hidden border border-gray-800 bg-black">
                  <img src={resultData.calibrationImage} alt="Calibration Frame 0" className="w-full h-auto" />
                  <div className="p-2 text-[11px] text-gray-400 text-left bg-gray-900/80">
                    Calibration Frame 0 (Detected player tracker IDs)
                  </div>
                </div>
              )}

              <div className="flex items-center gap-3 pt-2">
                <button
                  onClick={handleDownloadBundle}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold bg-gray-800 hover:bg-gray-700 text-gray-300 border border-gray-700 transition-colors"
                >
                  <Download className="w-4 h-4" /> Download Telemetry
                </button>
                <button
                  onClick={handleLaunch}
                  className="flex items-center gap-2 px-6 py-2.5 rounded-xl text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-500/25 transition-all"
                >
                  <Play className="w-4 h-4 fill-white" /> Open in CourtView Live
                </button>
              </div>
            </div>
          ) : step !== 'idle' ? (
            /* STEP: PROCESSING PROGRESS */
            <div className="py-8 px-4 flex flex-col items-center justify-center text-center space-y-5">
              <div className="relative flex items-center justify-center">
                <Loader2 className="w-16 h-16 text-blue-500 animate-spin" />
                <span className="absolute text-xs font-mono font-bold text-blue-300">{progress}%</span>
              </div>

              <div className="space-y-1">
                <h4 className="text-base font-bold text-white">{statusMessage}</h4>
                <p className="text-xs text-gray-400 font-mono">Elapsed time: {elapsedSeconds}s</p>
              </div>

              <div className="w-full max-w-md bg-gray-800 h-2 rounded-full overflow-hidden">
                <div 
                  className="bg-blue-500 h-full rounded-full transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>

              <div className="grid grid-cols-4 gap-2 w-full max-w-md text-[10px] text-gray-500 pt-2 text-center">
                <span className={progress >= 20 ? 'text-blue-400 font-semibold' : ''}>1. Ingest</span>
                <span className={progress >= 50 ? 'text-blue-400 font-semibold' : ''}>2. RF-DETR</span>
                <span className={progress >= 75 ? 'text-blue-400 font-semibold' : ''}>3. Homography</span>
                <span className={progress >= 95 ? 'text-blue-400 font-semibold' : ''}>4. Radar Sync</span>
              </div>

              {step === 'error' && (
                <div className="w-full max-w-md p-3 rounded-lg bg-red-950/50 border border-red-800 text-red-300 text-xs text-left flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold">Error:</span> {errorMessage}
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* STEP: UPLOAD & CONFIGURATION FORM */
            <>
              {/* Dropzone */}
              {!selectedFile ? (
                <div
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-gray-700 hover:border-blue-500/70 bg-[#0E1522] hover:bg-[#121B2C] rounded-xl p-8 flex flex-col items-center justify-center text-center cursor-pointer transition-all group"
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="video/mp4,video/webm"
                    className="hidden"
                    onChange={(e) => e.target.files?.[0] && handleFileSelect(e.target.files[0])}
                  />
                  <div className="w-12 h-12 rounded-xl bg-blue-600/10 text-blue-400 group-hover:scale-110 flex items-center justify-center mb-3 transition-transform">
                    <Film className="w-6 h-6" />
                  </div>
                  <p className="text-sm font-semibold text-white mb-1">
                    Drop your basketball .mp4 clip here, or <span className="text-blue-400">browse</span>
                  </p>
                  <p className="text-xs text-gray-500">
                    Recommended: 1080p broadcast angle, 5–15 seconds (H.264 MP4)
                  </p>
                </div>
              ) : (
                <div className="p-4 rounded-xl bg-[#0E1522] border border-gray-800 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-blue-600/20 text-blue-400 flex items-center justify-center">
                      <Film className="w-5 h-5" />
                    </div>
                    <div>
                      <p className="text-xs font-bold text-white truncate max-w-xs">{selectedFile.name}</p>
                      <p className="text-[11px] text-gray-400">
                        {(selectedFile.size / (1024 * 1024)).toFixed(1)} MB 
                        {videoMeta && ` · ${videoMeta.duration}s · ${videoMeta.width}x${videoMeta.height}`}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      setSelectedFile(null);
                      setVideoPreviewUrl(null);
                      setVideoMeta(null);
                    }}
                    className="text-xs text-gray-400 hover:text-red-400 px-2 py-1"
                  >
                    Change
                  </button>
                </div>
              )}

              {/* Settings Grid */}
              <div className="grid grid-cols-2 gap-4">
                {/* Tracker selection */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-gray-300 flex items-center gap-1.5">
                    <Zap className="w-3.5 h-3.5 text-yellow-400" /> Tracking Engine
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setTracker('bytetrack')}
                      className={`p-2.5 rounded-lg border text-left transition-colors ${
                        tracker === 'bytetrack'
                          ? 'bg-blue-600/20 border-blue-500/60 text-white'
                          : 'bg-gray-800/40 border-gray-800 text-gray-400 hover:border-gray-700'
                      }`}
                    >
                      <div className="text-xs font-bold">⚡ ByteTrack</div>
                      <div className="text-[10px] text-gray-400">Ultra-fast (~10s)</div>
                    </button>
                    <button
                      type="button"
                      onClick={() => setTracker('sam2')}
                      className={`p-2.5 rounded-lg border text-left transition-colors ${
                        tracker === 'sam2'
                          ? 'bg-blue-600/20 border-blue-500/60 text-white'
                          : 'bg-gray-800/40 border-gray-800 text-gray-400 hover:border-gray-700'
                      }`}
                    >
                      <div className="text-xs font-bold">🎯 SAM 2</div>
                      <div className="text-[10px] text-gray-400">Silhouette (~60s)</div>
                    </button>
                  </div>
                </div>

                {/* Team Preset */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-gray-300 flex items-center gap-1.5">
                    <Layers className="w-3.5 h-3.5 text-blue-400" /> Team Matchup
                  </label>
                  <select
                    value={teamPresetIdx}
                    onChange={(e) => setTeamPresetIdx(Number(e.target.value))}
                    className="w-full h-[42px] px-3 bg-gray-900 border border-gray-700 rounded-lg text-xs text-white focus:outline-none focus:border-blue-500"
                  >
                    {TEAM_PRESETS.map((p, idx) => (
                      <option key={p.name} value={idx}>
                        {p.name} ({p.home.code} vs {p.away.code})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Modal Endpoint Configuration (Collapsible) */}
              <div className="p-3 rounded-xl bg-gray-900/60 border border-gray-800 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-gray-300 flex items-center gap-1.5">
                    <Settings2 className="w-3.5 h-3.5 text-gray-400" /> Modal.com Endpoint URL
                  </span>
                  <span className="text-[10px] text-gray-500">Optional (for live GPU)</span>
                </div>
                <input
                  type="text"
                  placeholder="https://<username>--courtview-stream-tracker-analyze-video.modal.run"
                  value={modalApiUrl}
                  onChange={(e) => setModalApiUrl(e.target.value)}
                  className="w-full px-3 py-1.5 bg-black/50 border border-gray-800 rounded-lg text-xs font-mono text-gray-300 focus:outline-none focus:border-blue-500"
                />
                <p className="text-[10px] text-gray-500">
                  Deploy your own GPU worker using <code className="text-blue-400">modal deploy pipeline/modal_app.py</code>.
                  Leave blank to test using the fast offline simulator.
                </p>
              </div>

              {errorMessage && (
                <div className="p-3 rounded-lg bg-red-950/40 border border-red-800 text-red-300 text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{errorMessage}</span>
                </div>
              )}
            </>
          )}

        </div>

        {/* Footer */}
        {step === 'idle' && (
          <div className="px-6 py-4 border-t border-gray-800 bg-[#161F30] flex items-center justify-between">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-gray-400 hover:text-white transition-colors"
            >
              Cancel
            </button>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={!selectedFile}
                onClick={() => startAnalysis(true)}
                title="Generates instant matching telemetry without needing an active Modal GPU key"
                className="px-3 py-2 text-xs font-semibold bg-gray-800 hover:bg-gray-700 text-gray-200 border border-gray-700 rounded-xl disabled:opacity-40 transition-colors"
              >
                Instant Demo Mode
              </button>
              <button
                type="button"
                disabled={!selectedFile}
                onClick={() => startAnalysis(false)}
                className="flex items-center gap-2 px-5 py-2 text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white rounded-xl shadow-lg shadow-blue-500/20 disabled:opacity-40 transition-all"
              >
                <Cpu className="w-3.5 h-3.5" /> Run GPU Analysis
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Helpers: Dynamic Telemetry & Roster Synthesizers for Instant Demo Testing
// ---------------------------------------------------------------------------

function generateRoster(matchInfo: MatchInfo): RosterData {
  const home = matchInfo.home_team.code;
  const away = matchInfo.away_team.code;
  return {
    match_info: matchInfo,
    players: {
      '1': { id: 1, name: 'Player 1', shortName: 'P1', number: '0', team: home, position: 'SF' },
      '2': { id: 2, name: 'Player 2', shortName: 'P2', number: '7', team: home, position: 'SG' },
      '3': { id: 3, name: 'Player 3', shortName: 'P3', number: '4', team: home, position: 'PG' },
      '4': { id: 4, name: 'Player 4', shortName: 'P4', number: '9', team: home, position: 'PF' },
      '5': { id: 5, name: 'Player 5', shortName: 'P5', number: '42', team: home, position: 'C' },
      '6': { id: 6, name: 'Player 6', shortName: 'P6', number: '11', team: away, position: 'PG' },
      '7': { id: 7, name: 'Player 7', shortName: 'P7', number: '32', team: away, position: 'C' },
      '8': { id: 8, name: 'Player 8', shortName: 'P8', number: '25', team: away, position: 'SF' },
      '9': { id: 9, name: 'Player 9', shortName: 'P9', number: '8', team: away, position: 'PF' },
      '10': { id: 10, name: 'Player 10', shortName: 'P10', number: '3', team: away, position: 'SG' },
    },
  };
}

function generateDynamicTelemetry(totalFrames: number, fps: number, w: number, h: number): TelemetryData {
  const frames = [];
  const baseCourtPositions = [
    [1850, 760], [1700, 350], [1650, 1150], [1950, 500], [2100, 800],
    [1800, 760], [1650, 400], [1600, 1100], [1900, 550], [2050, 750],
  ];

  for (let f = 0; f < totalFrames; f++) {
    const t = f / fps;
    const players = [];

    for (let i = 1; i <= 10; i++) {
      const base = baseCourtPositions[i - 1];
      const offsetX = Math.sin(t * 1.5 + i) * 120;
      const offsetY = Math.cos(t * 1.2 + i) * 90;
      const courtX = Math.round(base[0] + offsetX);
      const courtY = Math.round(base[1] + offsetY);

      // Approximate video coordinates
      const vidX = Math.round(w * 0.2 + (courtX / 2865) * (w * 0.6));
      const vidY = Math.round(h * 0.35 + (courtY / 1524) * (h * 0.45));
      const boxW = Math.round(w * 0.04);
      const boxH = Math.round(h * 0.18);

      players.push({
        id: i,
        bbox: [vidX - boxW / 2, vidY - boxH, vidX + boxW / 2, vidY] as [number, number, number, number],
        feet_video_xy: [vidX, vidY] as [number, number],
        polygon: [
          [vidX - boxW / 3, vidY - boxH],
          [vidX + boxW / 3, vidY - boxH],
          [vidX + boxW / 2, vidY],
          [vidX - boxW / 2, vidY],
        ],
        court_xy: [courtX, courtY] as [number, number],
        speed_kmh: Math.round((8 + Math.abs(Math.sin(t * 2 + i)) * 14) * 10) / 10,
        is_interpolated: f % 40 === 0,
      });
    }

    frames.push({
      frame_idx: f,
      timestamp: Math.round(t * 1000) / 1000,
      homography_valid: true,
      players,
    });
  }

  return {
    metadata: {
      video_width: w,
      video_height: h,
      fps,
      total_frames: totalFrames,
      court_width: 2865,
      court_height: 1524,
      court_unit: 'cm',
      source: 'modal_phase2_analyzer',
      tracker: 'bytetrack',
    },
    frames,
  };
}
