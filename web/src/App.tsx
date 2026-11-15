import React, { useState, useEffect, useCallback } from 'react';
import { Loader2, Radio } from 'lucide-react';
import { TelemetryData, RosterData, HighlightMode } from './types/telemetry';
import { StreamPlayer } from './components/StreamPlayer';
import { RosterSidebar } from './components/RosterSidebar';
import { CourtRadar2D } from './components/CourtRadar2D';
import { PlayerStatsBar } from './components/PlayerStatsBar';

function App() {
  const [telemetry, setTelemetry] = useState<TelemetryData | null>(null);
  const [roster, setRoster] = useState<RosterData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedPlayerId, setSelectedPlayerId] = useState<number | null>(null);
  const [highlightMode, setHighlightMode] = useState<HighlightMode>('ring');
  const [showUnselected, setShowUnselected] = useState(true);
  const [showTrail, setShowTrail] = useState(true);
  const [currentFrame, setCurrentFrame] = useState(0);

  useEffect(() => {
    Promise.all([
      fetch('/telemetry.json').then(r => {
        if (!r.ok) throw new Error('Failed to load telemetry.json');
        return r.json();
      }),
      fetch('/roster.json').then(r => {
        if (!r.ok) throw new Error('Failed to load roster.json');
        return r.json();
      })
    ])
    .then(([t, r]) => {
      setTelemetry(t);
      setRoster(r);
      setLoading(false);
    })
    .catch(e => {
      setError(e.message);
      setLoading(false);
    });
  }, []);

  const handleFrameUpdate = useCallback((frame: number) => {
    setCurrentFrame(frame);
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-[#0A0E17]">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
          <span className="text-gray-400 text-sm">Loading telemetry data...</span>
        </div>
      </div>
    );
  }

  if (error || !telemetry || !roster) {
    return (
      <div className="flex items-center justify-center h-screen bg-[#0A0E17]">
        <div className="text-center">
          <p className="text-red-400 text-lg mb-2">Failed to load data</p>
          <p className="text-gray-500 text-sm">{error}</p>
          <p className="text-gray-600 text-xs mt-4">
            Run `python pipeline/generate_mock_telemetry.py` to generate test data
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-[#0A0E17] overflow-hidden">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-2.5 bg-[#111827]/90 backdrop-blur border-b border-gray-800 shrink-0">
        <div className="flex items-center gap-3">
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
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
          <span className="text-xs text-red-400 font-medium uppercase">Live Tracking</span>
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
            currentFrame={currentFrame}
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
            telemetry={telemetry}
            roster={roster}
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
            currentFrame={currentFrame}
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
          currentFrame={currentFrame}
        />
      </div>
    </div>
  );
}

export default App;
