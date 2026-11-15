import React, { useMemo } from 'react';
import { Zap, MapPin, Activity, Radio, AlertTriangle } from 'lucide-react';
import { TelemetryData, RosterData, PlayerFrame } from '../types/telemetry';
import { getCourtZone } from '../utils/canvasDraw';

interface PlayerStatsBarProps {
  telemetry: TelemetryData;
  roster: RosterData;
  selectedPlayerId: number | null;
  currentFrame: number;
}

export function PlayerStatsBar({ telemetry, roster, selectedPlayerId, currentFrame }: PlayerStatsBarProps) {
  const { metadata } = telemetry;

  const frameData = telemetry.frames[currentFrame];
  const playerFrame = frameData?.players.find((p: PlayerFrame) => p.id === selectedPlayerId);
  const playerInfo = selectedPlayerId !== null ? roster.players[String(selectedPlayerId)] : null;

  const teamColor = useMemo(() => {
    if (!playerInfo) return '#888';
    return playerInfo.team === roster.match_info.home_team.code
      ? roster.match_info.home_team.color
      : roster.match_info.away_team.color;
  }, [playerInfo, roster]);

  // Cumulative distance (m) per frame for the selected player, built once per
  // selection so playback only does a lookup.
  const cumulativeDistance = useMemo(() => {
    const cumulative = new Float32Array(telemetry.frames.length);
    if (selectedPlayerId === null) return cumulative;
    let total = 0;
    let prev: [number, number] | null = null;
    telemetry.frames.forEach((frame, i) => {
      const curr = frame.players.find((p: PlayerFrame) => p.id === selectedPlayerId)?.court_xy ?? null;
      if (prev && curr) total += Math.hypot(curr[0] - prev[0], curr[1] - prev[1]) / 100;
      prev = curr;
      cumulative[i] = total;
    });
    return cumulative;
  }, [telemetry, selectedPlayerId]);
  const distanceCovered = cumulativeDistance[Math.min(currentFrame, cumulativeDistance.length - 1)] ?? 0;

  const courtZone = playerFrame?.court_xy
    ? getCourtZone(playerFrame.court_xy, metadata.court_width, metadata.court_height)
    : '—';

  const speed = playerFrame?.speed_kmh ?? 0;
  const speedColor = speed < 15 ? '#22c55e' : speed < 25 ? '#eab308' : '#ef4444';
  const speedPct = Math.min((speed / 35) * 100, 100);

  if (selectedPlayerId === null || !playerInfo) {
    return (
      <div className="flex items-center justify-center px-6 py-3 bg-[#111827]/80 backdrop-blur-xl border-t border-gray-800">
        <span className="text-sm text-gray-600">Select a player to view live stats</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-6 px-6 py-3 bg-[#111827]/80 backdrop-blur-xl border-t border-gray-800">
      {/* Player Identity */}
      <div className="flex items-center gap-3">
        <div
          className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-white"
          style={{ backgroundColor: teamColor + '30', border: `2px solid ${teamColor}` }}
        >
          {playerInfo.number}
        </div>
        <div>
          <div className="text-sm font-bold text-white">{playerInfo.name}</div>
          <div className="text-xs text-gray-500">{playerInfo.position} · {playerInfo.team}</div>
        </div>
      </div>

      <div className="w-px h-8 bg-gray-700" />

      {/* Speed */}
      <div className="flex items-center gap-2 min-w-[160px]">
        <Zap size={14} style={{ color: speedColor }} />
        <div className="flex-1">
          <div className="flex items-center justify-between mb-0.5">
            <span className="text-xs text-gray-400">Speed</span>
            <span className="text-xs font-bold font-mono" style={{ color: speedColor }}>
              {speed.toFixed(1)} km/h
            </span>
          </div>
          <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{ width: `${speedPct}%`, backgroundColor: speedColor }}
            />
          </div>
        </div>
      </div>

      <div className="w-px h-8 bg-gray-700" />

      {/* Distance */}
      <div className="flex items-center gap-2">
        <Activity size={14} className="text-blue-400" />
        <div>
          <div className="text-xs text-gray-400">Distance</div>
          <div className="text-sm font-bold text-white font-mono">{distanceCovered.toFixed(1)} m</div>
        </div>
      </div>

      <div className="w-px h-8 bg-gray-700" />

      {/* Court Zone */}
      <div className="flex items-center gap-2">
        <MapPin size={14} className="text-purple-400" />
        <div>
          <div className="text-xs text-gray-400">Zone</div>
          <div className="text-sm font-semibold text-white">{courtZone}</div>
        </div>
      </div>

      <div className="w-px h-8 bg-gray-700" />

      {/* Tracking Status */}
      <div className="flex items-center gap-2">
        {!playerFrame ? (
          <>
            <Radio size={14} className="text-gray-500" />
            <div>
              <div className="text-xs text-gray-400">Status</div>
              <div className="text-sm font-semibold text-gray-500">OFF SCREEN</div>
            </div>
          </>
        ) : playerFrame.is_interpolated ? (
          <>
            <AlertTriangle size={14} className="text-amber-400" />
            <div>
              <div className="text-xs text-gray-400">Status</div>
              <div className="text-sm font-semibold text-amber-400">PREDICTED</div>
            </div>
          </>
        ) : (
          <>
            <Radio size={14} className="text-green-400" />
            <div>
              <div className="text-xs text-gray-400">Status</div>
              <div className="text-sm font-semibold text-green-400">LIVE</div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
