import React, { useState, useEffect, useCallback } from 'react';
import { Loader2, Radio } from 'lucide-react';
import { TelemetryData, RosterData, HighlightMode, ClipInfo, ClipManifest } from './types/telemetry';
import { StreamPlayer } from './components/StreamPlayer';
import { RosterSidebar } from './components/RosterSidebar';
import { CourtRadar2D } from './components/CourtRadar2D';
import { PlayerStatsBar } from './components/PlayerStatsBar';

const CLIPS_URL = `${import.meta.env.BASE_URL}clips/`;

const DEFAULT_MATCH_INFO: RosterData['match_info'] = {
  home_team: { code: 'BOS', name: 'Boston Celtics', color: '#007A33', accent: '#BA9653' },
  away_team: { code: 'NYK', name: 'New York Knicks', color: '#006BB6', accent: '#F58426' },
};

interface LoadedClip {
  clip: ClipInfo;
  telemetry: TelemetryData;
  roster: RosterData;
  /** false when the pipeline has not been run for this clip yet */
  tracked: boolean;
}

// Missing files come back as 404, or as index.html from an SPA fallback.
async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

// Lets the footage play before tracking data exists for a clip.
function emptyTelemetry(clip: ClipInfo): TelemetryData {
  return {
    metadata: {
      video_width: clip.width,
      video_height: clip.height,
      fps: clip.fps,
      total_frames: clip.frames,
      court_width: 2865,
      court_height: 1524,
      court_unit: 'cm',
    },
    frames: Array.from({ length: clip.frames }, (_, i) => ({
      frame_idx: i,
      timestamp: i / clip.fps,
      homography_valid: false,
      players: [],
    })),
  };
}

// Telemetry without a roster: list every tracked id as a placeholder player.
function placeholderRoster(telemetry: TelemetryData | null): RosterData {
  const players: RosterData['players'] = {};
  const ids = new Set<number>();
  telemetry?.frames.forEach((frame) => frame.players.forEach((p) => ids.add(p.id)));
  [...ids].sort((a, b) => a - b).forEach((id) => {
    players[String(id)] = {
      id,
      name: `Player ${id}`,
      shortName: `P${id}`,
      number: String(id),
      team: DEFAULT_MATCH_INFO.home_team.code,
      position: '-',
    };
  });
  return { draft: true, match_info: DEFAULT_MATCH_INFO, players };
}

function initialClipId(): string | null {
  return new URLSearchParams(window.location.search).get('clip');
}

function App() {
  const [clips, setClips] = useState<ClipInfo[] | null>(null);
  const [clipId, setClipId] = useState<string | null>(initialClipId);
  const [loaded, setLoaded] = useState<LoadedClip | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [selectedPlayerId, setSelectedPlayerId] = useState<number | null>(null);
  const [highlightMode, setHighlightMode] = useState<HighlightMode>('ring');
  const [showUnselected, setShowUnselected] = useState(true);
  const [showTrail, setShowTrail] = useState(true);
  const [currentFrame, setCurrentFrame] = useState(0);

  useEffect(() => {
    fetchJson<ClipManifest>(`${CLIPS_URL}clips.json`).then((manifest) => {
      if (!manifest || manifest.clips.length === 0) {
        setError('Failed to load clips/clips.json');
        return;
      }
      setClips(manifest.clips);
      setClipId((current) =>
        manifest.clips.some((c) => c.id === current) ? current : manifest.clips[0].id
      );
    });
  }, []);

  useEffect(() => {
    const clip = clips?.find((c) => c.id === clipId);
    if (!clip) return;

    let cancelled = false;
    setLoaded(null);
    setSelectedPlayerId(null);
    setCurrentFrame(0);

    Promise.all([
      fetchJson<TelemetryData>(`${CLIPS_URL}${clip.id}/telemetry.json`),
      fetchJson<RosterData>(`${CLIPS_URL}${clip.id}/roster.json`),
    ]).then(([telemetry, roster]) => {
      if (cancelled) return;
      setLoaded({
        clip,
        telemetry: telemetry ?? emptyTelemetry(clip),
        roster: roster ?? placeholderRoster(telemetry),
        tracked: telemetry !== null,
      });
    });

    const url = new URL(window.location.href);
    url.searchParams.set('clip', clip.id);
    window.history.replaceState(null, '', url);

    return () => {
      cancelled = true;
    };
  }, [clips, clipId]);

  const handleFrameUpdate = useCallback((frame: number) => {
    setCurrentFrame(frame);
  }, []);

  if (error) {
    return (
      <div className="flex items-center justify-center h-screen bg-[#0A0E17]">
        <div className="text-center">
          <p className="text-red-400 text-lg mb-2">Failed to load data</p>
          <p className="text-gray-500 text-sm">{error}</p>
        </div>
      </div>
    );
  }

  if (!clips || !loaded) {
    return (
      <div className="flex items-center justify-center h-screen bg-[#0A0E17]">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
          <span className="text-gray-400 text-sm">Loading telemetry data...</span>
        </div>
      </div>
    );
  }

  const { clip, telemetry, roster, tracked } = loaded;
  // Clamp while a clip switch is settling so children never index past the end.
  const frame = Math.min(currentFrame, telemetry.frames.length - 1);

  return (
    <div className="flex flex-col h-screen bg-[#0A0E17] overflow-hidden">
      {/* Header */}
      <header className="flex items-center justify-between gap-4 px-6 py-2.5 bg-[#111827]/90 backdrop-blur border-b border-gray-800 shrink-0">
        <div className="flex items-center gap-3 shrink-0">
          <div className="flex items-center gap-2">
            <Radio className="w-5 h-5 text-red-500" />
            <h1 className="text-lg font-extrabold tracking-tight text-white">
              COURTVIEW<span className="text-blue-500"> LIVE</span>
            </h1>
          </div>
          <div className="h-4 w-px bg-gray-700" />
          <span className="text-xs text-gray-500">
            {roster.match_info.home_team.code} vs {roster.match_info.away_team.code}
          </span>
        </div>

        {/* Clip Picker */}
        <nav id="clip-picker" className="flex items-center gap-1 overflow-x-auto">
          {clips.map((c) => (
            <button
              key={c.id}
              data-clip={c.id}
              onClick={() => setClipId(c.id)}
              title={c.subtitle}
              className={`px-3 py-1 rounded-lg text-xs font-semibold whitespace-nowrap border transition-colors ${
                c.id === clip.id
                  ? 'bg-blue-600/20 text-blue-300 border-blue-500/40'
                  : 'bg-gray-800/60 text-gray-400 border-transparent hover:text-gray-200'
              }`}
            >
              {c.title}
            </button>
          ))}
        </nav>

        <div className="flex items-center gap-2 shrink-0">
          <div className={`w-2 h-2 rounded-full ${tracked ? 'bg-red-500 animate-pulse' : 'bg-gray-600'}`} />
          <span className={`text-xs font-medium uppercase ${tracked ? 'text-red-400' : 'text-gray-500'}`}>
            {tracked ? 'Live Tracking' : 'Tracking Pending'}
          </span>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Roster Sidebar */}
        <div className="w-72 shrink-0 overflow-y-auto">
          <RosterSidebar
            roster={roster}
            selectedPlayerId={selectedPlayerId}
            onSelectPlayer={setSelectedPlayerId}
            currentFrame={frame}
            telemetry={telemetry}
            highlightMode={highlightMode}
            onHighlightModeChange={setHighlightMode}
            showUnselected={showUnselected}
            onShowUnselectedChange={setShowUnselected}
            showTrail={showTrail}
            onShowTrailChange={setShowTrail}
          />
        </div>

        {/* Stream Player (Center) */}
        <div className="flex-1 p-3 overflow-hidden">
          <StreamPlayer
            key={clip.id}
            telemetry={telemetry}
            roster={roster}
            videoSrc={clip.video ? `${CLIPS_URL}${clip.id}/${clip.video}` : null}
            notice={
              tracked
                ? null
                : 'No tracking data for this clip yet. Run the pipeline (pipeline/README_COLAB.md) and add its telemetry.json to this clip folder.'
            }
            selectedPlayerId={selectedPlayerId}
            onSelectPlayer={setSelectedPlayerId}
            highlightMode={highlightMode}
            showUnselected={showUnselected}
            onFrameUpdate={handleFrameUpdate}
          />
        </div>

        {/* Court Radar (Right) */}
        <div className="w-80 shrink-0 border-l border-gray-800 bg-[#111827]/50">
          <CourtRadar2D
            telemetry={telemetry}
            roster={roster}
            selectedPlayerId={selectedPlayerId}
            onSelectPlayer={setSelectedPlayerId}
            currentFrame={frame}
            showTrail={showTrail}
          />
        </div>
      </div>

      {/* Stats Bar (Bottom) */}
      <div id="player-stats-bar" className="shrink-0">
        <PlayerStatsBar
          telemetry={telemetry}
          roster={roster}
          selectedPlayerId={selectedPlayerId}
          currentFrame={frame}
        />
      </div>
    </div>
  );
}

export default App;
