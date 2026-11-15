import React from 'react';
import { Users, Eye, EyeOff, Crosshair, Circle, Hexagon, Target } from 'lucide-react';
import { RosterData, TelemetryData, HighlightMode, PlayerFrame } from '../types/telemetry';

interface RosterSidebarProps {
  roster: RosterData;
  selectedPlayerId: number | null;
  onSelectPlayer: (id: number | null) => void;
  currentFrame: number;
  telemetry: TelemetryData;
  highlightMode: HighlightMode;
  onHighlightModeChange: (mode: HighlightMode) => void;
  showUnselected: boolean;
  onShowUnselectedChange: (show: boolean) => void;
  showTrail: boolean;
  onShowTrailChange: (show: boolean) => void;
}

export function RosterSidebar({
  roster, selectedPlayerId, onSelectPlayer, currentFrame, telemetry,
  highlightMode, onHighlightModeChange, showUnselected, onShowUnselectedChange,
  showTrail, onShowTrailChange
}: RosterSidebarProps) {
  const frameData = telemetry.frames[currentFrame];

  const getPlayerSpeed = (playerId: number): number => {
    if (!frameData) return 0;
    const p = frameData.players.find((p: PlayerFrame) => p.id === playerId);
    return p ? p.speed_kmh : 0;
  };

  const teams = [
    { info: roster.match_info.home_team, playerIds: Object.values(roster.players).filter(p => p.team === roster.match_info.home_team.code).map(p => p.id) },
    { info: roster.match_info.away_team, playerIds: Object.values(roster.players).filter(p => p.team === roster.match_info.away_team.code).map(p => p.id) },
  ];

  return (
    <div className="flex flex-col h-full bg-[#111827]/80 backdrop-blur-xl border-r border-gray-800 overflow-y-auto">
      {/* Header */}
      <div className="p-4 border-b border-gray-800">
        <div className="flex items-center gap-2 mb-3">
          <Users size={18} className="text-blue-400" />
          <h2 className="text-sm font-bold text-white uppercase tracking-wider">On-Court Roster</h2>
        </div>
        {selectedPlayerId !== null && (
          <button
            onClick={() => onSelectPlayer(null)}
            className="w-full px-3 py-1.5 text-xs text-gray-400 bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors"
          >
            Clear Selection
          </button>
        )}
      </div>

      {/* Team Sections */}
      {teams.map((team) => (
        <div key={team.info.code} className="border-b border-gray-800">
          {/* Team Header */}
          <div className="flex items-center gap-2 px-4 py-2.5" style={{ borderLeft: `3px solid ${team.info.color}` }}>
            <span className="text-xs font-bold uppercase tracking-wider" style={{ color: team.info.color }}>
              {team.info.name}
            </span>
          </div>

          {/* Player Rows */}
          {team.playerIds.map((pid) => {
            const player = roster.players[String(pid)];
            const isSelected = selectedPlayerId === pid;
            const speed = getPlayerSpeed(pid);

            return (
              <button
                key={pid}
                onClick={() => onSelectPlayer(isSelected ? null : pid)}
                className={`w-full flex items-center gap-3 px-4 py-2.5 transition-all hover:bg-gray-800/50 ${
                  isSelected ? 'bg-gray-800/80' : ''
                }`}
                style={isSelected ? { boxShadow: `inset 3px 0 0 ${team.info.color}, 0 0 15px ${team.info.color}20` } : {}}
              >
                {/* Jersey Number Badge */}
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0"
                  style={{ backgroundColor: team.info.color + '30', border: `2px solid ${team.info.color}` }}
                >
                  {player.number}
                </div>

                {/* Player Info */}
                <div className="flex-1 text-left min-w-0">
                  <div className="text-sm font-semibold text-white truncate">{player.name}</div>
                  <div className="text-xs text-gray-500">{player.position}</div>
                </div>

                {/* Live Status */}
                <div className="flex flex-col items-end gap-0.5 shrink-0">
                  <div className="flex items-center gap-1">
                    <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                    <span className="text-[10px] text-green-400 uppercase font-medium">Live</span>
                  </div>
                  <span className="text-[11px] text-gray-400 font-mono">
                    {speed.toFixed(1)} km/h
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      ))}

      {/* Controls Section */}
      <div className="p-4 space-y-4">
        {/* Highlight Style */}
        <div>
          <label className="text-xs text-gray-500 uppercase tracking-wider font-medium mb-2 block">
            Highlight Style
          </label>
          <div className="grid grid-cols-3 gap-1">
            {([
              { mode: 'ring' as HighlightMode, label: 'Ring', icon: Circle },
              { mode: 'contour' as HighlightMode, label: 'Outline', icon: Hexagon },
              { mode: 'brackets' as HighlightMode, label: 'HUD', icon: Target },
            ]).map(({ mode, label, icon: Icon }) => (
              <button
                key={mode}
                onClick={() => onHighlightModeChange(mode)}
                className={`flex flex-col items-center gap-1 px-2 py-2 rounded-lg text-xs transition-colors ${
                  highlightMode === mode
                    ? 'bg-blue-600/20 text-blue-400 border border-blue-500/30'
                    : 'bg-gray-800 text-gray-500 hover:text-gray-300 border border-transparent'
                }`}
              >
                <Icon size={14} />
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Toggle: Show Unselected */}
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-400">Show All Players</span>
          <button
            onClick={() => onShowUnselectedChange(!showUnselected)}
            className={`p-1.5 rounded-lg transition-colors ${
              showUnselected ? 'bg-blue-600/20 text-blue-400' : 'bg-gray-800 text-gray-600'
            }`}
          >
            {showUnselected ? <Eye size={14} /> : <EyeOff size={14} />}
          </button>
        </div>

        {/* Toggle: Show Trail */}
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-400">Movement Trail</span>
          <button
            onClick={() => onShowTrailChange(!showTrail)}
            className={`relative w-10 h-5 rounded-full transition-colors ${
              showTrail ? 'bg-blue-600' : 'bg-gray-700'
            }`}
          >
            <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
              showTrail ? 'left-5' : 'left-0.5'
            }`} />
          </button>
        </div>
      </div>
    </div>
  );
}
