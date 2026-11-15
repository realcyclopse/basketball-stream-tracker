import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Play, Pause, Repeat, ChevronLeft, ChevronRight, Info } from 'lucide-react';
import { TelemetryData, RosterData, HighlightMode, PlayerFrame } from '../types/telemetry';
import { useVideoSync } from '../hooks/useVideoSync';
import {
  drawFloorRing,
  drawNeonContour,
  drawCornerBrackets,
  drawPlayerBadge,
  drawSubtleDot,
  hexToRgba
} from '../utils/canvasDraw';

interface StreamPlayerProps {
  telemetry: TelemetryData;
  roster: RosterData;
  /** URL of the clip footage; null renders the synthetic court instead */
  videoSrc: string | null;
  /** shown over the picture, e.g. when a clip has no tracking data yet */
  notice?: string | null;
  selectedPlayerId: number | null;
  onSelectPlayer: (id: number | null) => void;
  highlightMode: HighlightMode;
  showUnselected: boolean;
  onFrameUpdate: (frame: number) => void;
}

// Camera model of pipeline/generate_mock_telemetry.py (court cm -> 1920x1080 px),
// so the synthetic court lines sit under the mock players.
function mockCourtToVideo(x: number, y: number, courtW: number, courtH: number): [number, number] {
  const nx = x / courtW;
  const ny = y / courtH;
  return [200 + nx * (1920 - 400) + (ny - 0.5) * 80, 380 + ny * 580];
}

export function StreamPlayer({
  telemetry,
  roster,
  videoSrc,
  notice,
  selectedPlayerId,
  onSelectPlayer,
  highlightMode,
  showUnselected,
  onFrameUpdate
}: StreamPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [videoFailed, setVideoFailed] = useState(false);
  const [loop, setLoop] = useState(true);
  const videoError = videoSrc === null || videoFailed;

  const { metadata } = telemetry;
  const {
    currentFrame,
    isPlaying,
    togglePlay,
    stepForward,
    stepBackward,
    setPlaybackRate,
    seekToFrame,
    playbackRate
  } = useVideoSync(videoRef, metadata.fps, metadata.total_frames, videoError);

  // Notify parent of frame updates
  useEffect(() => {
    onFrameUpdate(currentFrame);
  }, [currentFrame, onFrameUpdate]);

  // Color lookup helpers
  const getPlayerColor = useCallback(
    (playerId: number): string => {
      const player = roster.players[String(playerId)];
      if (!player) return '#ffffff';
      return player.team === roster.match_info.home_team.code
        ? roster.match_info.home_team.color
        : roster.match_info.away_team.color;
    },
    [roster]
  );

  const getPlayerAccent = useCallback(
    (playerId: number): string => {
      const player = roster.players[String(playerId)];
      if (!player) return '#ffffff';
      return player.team === roster.match_info.home_team.code
        ? roster.match_info.home_team.accent
        : roster.match_info.away_team.accent;
    },
    [roster]
  );

  // Synthetic broadcast background renderer
  const drawSyntheticBackground = useCallback(
    (ctx: CanvasRenderingContext2D, width: number, height: number) => {
      // Dark hardwood floor gradient
      const floorGrad = ctx.createLinearGradient(0, 0, 0, height);
      floorGrad.addColorStop(0, '#111726');
      floorGrad.addColorStop(0.4, '#151d30');
      floorGrad.addColorStop(1, '#0e1320');
      ctx.fillStyle = floorGrad;
      ctx.fillRect(0, 0, width, height);

      // Subtle hardwood parquet lines
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
      ctx.lineWidth = 1;
      for (let y = 150; y < height; y += 45) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }

      // Court lines projected through the mock camera
      const courtW = metadata.court_width;
      const courtH = metadata.court_height;
      const midY = courtH / 2;
      const path = (points: [number, number][], close = false) => {
        ctx.beginPath();
        points.forEach(([x, y], i) => {
          const [vx, vy] = mockCourtToVideo(x, y, courtW, courtH);
          if (i === 0) ctx.moveTo(vx, vy);
          else ctx.lineTo(vx, vy);
        });
        if (close) ctx.closePath();
      };
      const arc = (cx: number, cy: number, r: number, from: number, to: number): [number, number][] =>
        Array.from({ length: 41 }, (_, i) => {
          const a = from + ((to - from) * i) / 40;
          return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as [number, number];
        });

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
      ctx.lineWidth = 2.5;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.02)';
      path([[0, 0], [courtW, 0], [courtW, courtH], [0, courtH]], true);
      ctx.fill();
      ctx.stroke();
      path([[courtW / 2, 0], [courtW / 2, courtH]]);
      ctx.stroke();
      path(arc(courtW / 2, midY, 183, 0, Math.PI * 2), true);
      ctx.stroke();

      const cornerAngle = Math.asin((midY - 91) / 724);
      [0, 1].forEach((side) => {
        const fx = (d: number) => (side === 0 ? d : courtW - d);
        ctx.fillStyle = 'rgba(59, 130, 246, 0.06)';
        path([[fx(0), midY - 244], [fx(579), midY - 244], [fx(579), midY + 244], [fx(0), midY + 244]], true);
        ctx.fill();
        ctx.stroke();
        const threeArc = arc(160, midY, 724, -cornerAngle, cornerAngle)
          .map(([x, y]) => [fx(x), y] as [number, number]);
        path([[fx(0), 91], ...threeArc, [fx(0), courtH - 91]]);
        ctx.stroke();
        path(arc(fx(160), midY, 23, 0, Math.PI * 2), true);
        ctx.stroke();
      });

      // Broadcast watermark HUD header
      ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.font = '600 13px Inter, sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText('SYNTHETIC COURT · MOCK TELEMETRY', 40, 45);

      ctx.fillStyle = 'rgba(239, 68, 68, 0.85)';
      ctx.beginPath();
      ctx.arc(28, 41, 5, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    },
    [metadata.court_width, metadata.court_height]
  );

  // Main canvas render pass
  const renderFrame = useCallback(
    (frameIdx: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const { width, height } = canvas;
      ctx.clearRect(0, 0, width, height);

      // If video failed or is not available, render synthetic broadcast background
      if (videoError) {
        drawSyntheticBackground(ctx, width, height);
      }

      const frameData = telemetry.frames[frameIdx];
      if (!frameData) return;

      // 1. Draw synthetic player bodies if in video fallback mode
      if (videoError) {
        frameData.players.forEach((p: PlayerFrame) => {
          const [x1, y1, x2, y2] = p.bbox;
          const bw = x2 - x1;
          const bh = y2 - y1;
          const pInfo = roster.players[String(p.id)];
          const pColor = getPlayerColor(p.id);

          ctx.save();
          // Soft body silhouette
          ctx.fillStyle = hexToRgba(pColor, 0.4);
          ctx.beginPath();
          if (typeof ctx.roundRect === 'function') {
            ctx.roundRect(x1, y1, bw, bh, 12);
          } else {
            ctx.rect(x1, y1, bw, bh);
          }
          ctx.fill();

          // Jersey number on body
          if (pInfo) {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
            ctx.font = 'bold 15px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(pInfo.number, (x1 + x2) / 2, y1 + bh * 0.4);
          }
          ctx.restore();
        });
      }

      // 2. Draw subtle floor dots for unselected players
      if (showUnselected) {
        frameData.players.forEach((p: PlayerFrame) => {
          if (p.id !== selectedPlayerId) {
            drawSubtleDot(ctx, p.feet_video_xy, getPlayerColor(p.id));
          }
        });
      }

      // 3. Draw broadcast tracking overlay for the selected player
      if (selectedPlayerId !== null) {
        const selectedPlayer = frameData.players.find((p: PlayerFrame) => p.id === selectedPlayerId);
        if (selectedPlayer) {
          const color = getPlayerColor(selectedPlayerId);
          const accent = getPlayerAccent(selectedPlayerId);
          const bboxWidth = selectedPlayer.bbox[2] - selectedPlayer.bbox[0];
          const playerInfo = roster.players[String(selectedPlayerId)];

          switch (highlightMode) {
            case 'ring':
              drawFloorRing(
                ctx,
                selectedPlayer.feet_video_xy,
                bboxWidth,
                color,
                accent,
                selectedPlayer.is_interpolated
              );
              break;
            case 'contour':
              drawNeonContour(ctx, selectedPlayer.polygon, color, selectedPlayer.is_interpolated);
              break;
            case 'brackets':
              drawCornerBrackets(ctx, selectedPlayer.bbox, color);
              break;
          }

          if (playerInfo) {
            drawPlayerBadge(
              ctx,
              selectedPlayer.bbox,
              playerInfo.number,
              playerInfo.shortName,
              selectedPlayer.speed_kmh,
              color
            );
          }
        }
      }
    },
    [
      telemetry,
      selectedPlayerId,
      highlightMode,
      showUnselected,
      getPlayerColor,
      getPlayerAccent,
      roster,
      videoError,
      drawSyntheticBackground
    ]
  );

  // Redraw canvas whenever frame, selection, or highlight mode changes
  useEffect(() => {
    renderFrame(currentFrame);
  }, [currentFrame, renderFrame]);

  // Handle direct click on canvas to select player
  const handleCanvasClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      // The canvas is letterboxed (object-contain): map through the drawn area.
      const rect = canvas.getBoundingClientRect();
      const scale = Math.min(rect.width / canvas.width, rect.height / canvas.height);
      if (scale <= 0) return;
      const offsetX = (rect.width - canvas.width * scale) / 2;
      const offsetY = (rect.height - canvas.height * scale) / 2;
      const clickX = (e.clientX - rect.left - offsetX) / scale;
      const clickY = (e.clientY - rect.top - offsetY) / scale;

      const frameData = telemetry.frames[currentFrame];
      if (!frameData) return;

      // Hit test with a small margin; overlapping boxes resolve to the player
      // nearest the camera (lowest feet).
      let hit: PlayerFrame | null = null;
      for (const player of frameData.players) {
        const [x1, y1, x2, y2] = player.bbox;
        if (clickX >= x1 - 12 && clickX <= x2 + 12 && clickY >= y1 - 12 && clickY <= y2 + 12) {
          if (!hit || y2 > hit.bbox[3]) hit = player;
        }
      }
      if (hit) onSelectPlayer(hit.id === selectedPlayerId ? null : hit.id);
    },
    [currentFrame, telemetry, selectedPlayerId, onSelectPlayer]
  );

  return (
    <div className="flex flex-col h-full bg-[#0d121d] rounded-xl border border-gray-800/80 overflow-hidden shadow-2xl">
      {/* Video / Canvas Broadcast Viewport */}
      <div
        ref={containerRef}
        className="relative flex-1 bg-black overflow-hidden flex items-center justify-center select-none"
        style={{ aspectRatio: '16/9' }}
      >
        {!videoError ? (
          <video
            ref={videoRef}
            className="absolute inset-0 w-full h-full object-contain pointer-events-none"
            src={videoSrc ?? undefined}
            loop={loop}
            muted
            autoPlay
            playsInline
            preload="auto"
            onError={() => setVideoFailed(true)}
          />
        ) : null}

        <canvas
          ref={canvasRef}
          width={metadata.video_width}
          height={metadata.video_height}
          className="absolute inset-0 w-full h-full object-contain cursor-crosshair z-10"
          onClick={handleCanvasClick}
        />

        {notice && (
          <div
            id="stream-notice"
            className="absolute top-4 left-4 z-20 flex items-start gap-2 max-w-md px-3 py-2 bg-black/70 backdrop-blur-md rounded-lg border border-amber-500/30 text-xs text-amber-200"
          >
            <Info size={14} className="mt-0.5 shrink-0" />
            <span>{notice}</span>
          </div>
        )}

        {/* Live Broadcast Badge Overlay */}
        <div className="absolute top-4 right-4 z-20 flex items-center gap-2 px-3 py-1 bg-black/60 backdrop-blur-md rounded-full border border-white/10 text-xs font-mono text-gray-300">
          <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
          <span>{videoError ? 'SYNTHETIC' : 'LIVE'} {Math.round(metadata.fps)} FPS</span>
        </div>
      </div>

      {/* Broadcast Playback Control Bar */}
      <div className="flex items-center gap-3 px-5 py-3 bg-[#111827]/95 backdrop-blur border-t border-gray-800 shrink-0">
        {/* Play/Pause */}
        <button
          onClick={togglePlay}
          className="p-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-all shadow-lg shadow-blue-600/30 active:scale-95"
          title={isPlaying ? 'Pause' : 'Play'}
        >
          {isPlaying ? <Pause size={18} /> : <Play size={18} fill="currentColor" />}
        </button>

        {/* Step Backward / Forward */}
        <button
          onClick={stepBackward}
          className="p-2 bg-gray-800/80 hover:bg-gray-700 text-gray-300 hover:text-white rounded-lg transition-colors"
          title="Previous Frame"
        >
          <ChevronLeft size={18} />
        </button>
        <button
          onClick={stepForward}
          className="p-2 bg-gray-800/80 hover:bg-gray-700 text-gray-300 hover:text-white rounded-lg transition-colors"
          title="Next Frame"
        >
          <ChevronRight size={18} />
        </button>

        {/* Timeline Scrubber */}
        <div className="flex-1 flex items-center gap-3 px-2">
          <input
            type="range"
            min={0}
            max={metadata.total_frames - 1}
            value={currentFrame}
            onChange={(e) => seekToFrame(Number(e.target.value))}
            className="flex-1 h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500 hover:accent-blue-400 transition-all"
          />
        </div>

        {/* Frame / Time Counter */}
        <div className="flex items-center gap-1.5 px-3 py-1 bg-gray-900/80 rounded-md border border-gray-800 text-xs font-mono text-gray-300 min-w-[130px] justify-center">
          <span className="text-blue-400 font-bold">F{currentFrame}</span>
          <span className="text-gray-600">/</span>
          <span className="text-gray-400">{metadata.total_frames - 1}</span>
          <span className="text-gray-600">·</span>
          <span>{((currentFrame / metadata.fps) || 0).toFixed(1)}s</span>
        </div>

        {/* Playback Rate Selector */}
        <div className="flex items-center bg-gray-900 rounded-lg p-0.5 border border-gray-800">
          {[0.5, 1, 2].map((rate) => (
            <button
              key={rate}
              onClick={() => setPlaybackRate(rate)}
              className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-colors ${
                playbackRate === rate
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              {rate}x
            </button>
          ))}
        </div>

        {/* Loop Toggle */}
        <button
          onClick={() => {
            setLoop(!loop);
            if (videoRef.current) videoRef.current.loop = !loop;
          }}
          className={`p-2 rounded-lg border transition-all ${
            loop
              ? 'bg-blue-600/20 text-blue-400 border-blue-500/40'
              : 'bg-gray-800/60 text-gray-500 border-transparent hover:text-gray-300'
          }`}
          title={loop ? 'Loop Enabled' : 'Loop Disabled'}
        >
          <Repeat size={16} />
        </button>
      </div>
    </div>
  );
}
