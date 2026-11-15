import React, { useMemo } from 'react';
import { TelemetryData, RosterData, PlayerFrame } from '../types/telemetry';

interface CourtRadar2DProps {
  telemetry: TelemetryData;
  roster: RosterData;
  selectedPlayerId: number | null;
  onSelectPlayer: (id: number | null) => void;
  currentFrame: number;
  showTrail: boolean;
}

export function CourtRadar2D({
  telemetry,
  roster,
  selectedPlayerId,
  onSelectPlayer,
  currentFrame,
  showTrail
}: CourtRadar2DProps) {
  const { metadata } = telemetry;
  const courtW = metadata.court_width;  // 2865 cm (NBA standard)
  const courtH = metadata.court_height; // 1524 cm

  // SVG viewBox with outer padding
  const pad = 60;
  const vbW = courtW + pad * 2;
  const vbH = courtH + pad * 2;

  const getTeamColor = (playerId: number): string => {
    const player = roster.players[String(playerId)];
    if (!player) return '#888';
    return player.team === roster.match_info.home_team.code
      ? roster.match_info.home_team.color
      : roster.match_info.away_team.color;
  };

  const frameData = telemetry.frames[currentFrame];

  // Build 60-frame (2-second at 30fps) movement trail for selected player
  const trail = useMemo(() => {
    if (!showTrail || selectedPlayerId === null) return [];
    const startFrame = Math.max(0, currentFrame - 60);
    const points: [number, number][] = [];
    for (let i = startFrame; i <= currentFrame; i++) {
      const f = telemetry.frames[i];
      if (!f) continue;
      const p = f.players.find((pl: PlayerFrame) => pl.id === selectedPlayerId);
      if (p) points.push(p.court_xy);
    }
    return points;
  }, [telemetry, selectedPlayerId, currentFrame, showTrail]);

  // Accurate NBA Court Geometry in cm (NBA 94x50 ft = 2865x1524 cm)
  const hoopX1 = 160;          // 5ft3in from baseline
  const hoopX2 = courtW - 160;
  const centerY = courtH / 2;
  const keyWidth = 579;        // 19ft to free throw line = 579cm
  const keyHalfH = 244;        // 16ft lane width = 488cm, half is 244cm
  const threeRadius = 724;     // 23ft 9in arc radius
  const cornerThreeDist = 670; // 22ft in corners from hoop
  const cornerStraightX = 427; // 14ft straight line from baseline
  const ftCircleR = 183;       // 6ft radius
  const centerCircleR = 183;   // 6ft radius
  const rimR = 23;             // 18in rim diameter, ~23cm radius

  return (
    <div className="flex flex-col h-full bg-[#0d121d] rounded-xl border border-gray-800/80 overflow-hidden shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-[#111827]/90 border-b border-gray-800">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-blue-500" />
          <h3 className="text-xs font-bold text-gray-200 uppercase tracking-wider">
            2D Tactical Court Radar
          </h3>
        </div>
        <span className="text-[11px] font-mono text-gray-400">NBA 94'×50'</span>
      </div>

      {/* SVG Court Viewport */}
      <div className="flex-1 p-3 flex items-center justify-center bg-[#090d16]">
        <svg
          viewBox={`0 0 ${vbW} ${vbH}`}
          className="w-full h-full max-h-full select-none"
        >
          <defs>
            <filter id="radar-glow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="8" result="coloredBlur" />
              <feMerge>
                <feMergeNode in="coloredBlur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <marker
              id="vel-arrow"
              viewBox="0 0 10 10"
              refX="6"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 1 L 10 5 L 0 9 z" fill="white" />
            </marker>
          </defs>

          {/* Hardwood Court floor */}
          <rect
            x={pad}
            y={pad}
            width={courtW}
            height={courtH}
            fill="#121824"
            stroke="#334155"
            strokeWidth={4}
            rx={8}
          />

          {/* Half-court division line */}
          <line
            x1={pad + courtW / 2}
            y1={pad}
            x2={pad + courtW / 2}
            y2={pad + courtH}
            stroke="#334155"
            strokeWidth={3}
          />

          {/* Center circle */}
          <circle
            cx={pad + courtW / 2}
            cy={pad + centerY}
            r={centerCircleR}
            fill="none"
            stroke="#334155"
            strokeWidth={3}
          />

          {/* ───────── Left Half Court (Home / BOS defending / NYK attacking) ───────── */}
          {/* Key / Paint */}
          <rect
            x={pad}
            y={pad + centerY - keyHalfH}
            width={keyWidth}
            height={keyHalfH * 2}
            fill="rgba(51, 65, 85, 0.25)"
            stroke="#334155"
            strokeWidth={3}
          />
          {/* Free throw circle */}
          <circle
            cx={pad + keyWidth}
            cy={pad + centerY}
            r={ftCircleR}
            fill="none"
            stroke="#334155"
            strokeWidth={3}
            strokeDasharray="12 12"
          />
          {/* Left hoop & backboard */}
          <line
            x1={pad + 120}
            y1={pad + centerY - 91}
            x2={pad + 120}
            y2={pad + centerY + 91}
            stroke="#475569"
            strokeWidth={4}
          />
          <circle
            cx={pad + hoopX1}
            cy={pad + centerY}
            r={rimR}
            fill="none"
            stroke="#ef4444"
            strokeWidth={3.5}
          />
          {/* Left 3-point line */}
          <path
            d={`M ${pad} ${pad + centerY - cornerThreeDist}
                L ${pad + cornerStraightX} ${pad + centerY - cornerThreeDist}
                A ${threeRadius} ${threeRadius} 0 0 1 ${pad + cornerStraightX} ${pad + centerY + cornerThreeDist}
                L ${pad} ${pad + centerY + cornerThreeDist}`}
            fill="none"
            stroke="#334155"
            strokeWidth={3}
          />

          {/* ───────── Right Half Court (NYK defending / BOS attacking) ───────── */}
          {/* Key / Paint */}
          <rect
            x={pad + courtW - keyWidth}
            y={pad + centerY - keyHalfH}
            width={keyWidth}
            height={keyHalfH * 2}
            fill="rgba(51, 65, 85, 0.25)"
            stroke="#334155"
            strokeWidth={3}
          />
          {/* Free throw circle */}
          <circle
            cx={pad + courtW - keyWidth}
            cy={pad + centerY}
            r={ftCircleR}
            fill="none"
            stroke="#334155"
            strokeWidth={3}
            strokeDasharray="12 12"
          />
          {/* Right hoop & backboard */}
          <line
            x1={pad + courtW - 120}
            y1={pad + centerY - 91}
            x2={pad + courtW - 120}
            y2={pad + centerY + 91}
            stroke="#475569"
            strokeWidth={4}
          />
          <circle
            cx={pad + hoopX2}
            cy={pad + centerY}
            r={rimR}
            fill="none"
            stroke="#ef4444"
            strokeWidth={3.5}
          />
          {/* Right 3-point line */}
          <path
            d={`M ${pad + courtW} ${pad + centerY - cornerThreeDist}
                L ${pad + courtW - cornerStraightX} ${pad + centerY - cornerThreeDist}
                A ${threeRadius} ${threeRadius} 0 0 0 ${pad + courtW - cornerStraightX} ${pad + centerY + cornerThreeDist}
                L ${pad + courtW} ${pad + centerY + cornerThreeDist}`}
            fill="none"
            stroke="#334155"
            strokeWidth={3}
          />

          {/* 60-Frame Fading Movement Trail */}
          {trail.length > 1 && (
            <g filter="url(#radar-glow)">
              {trail.slice(0, -1).map((pt, idx) => {
                const nextPt = trail[idx + 1];
                const progress = (idx + 1) / trail.length;
                const alpha = Math.max(0.06, progress * 0.85);
                const strokeW = 2.0 + progress * 2.5;
                const trailColor = selectedPlayerId !== null ? getTeamColor(selectedPlayerId) : '#3b82f6';

                return (
                  <line
                    key={idx}
                    x1={pad + pt[0]}
                    y1={pad + pt[1]}
                    x2={pad + nextPt[0]}
                    y2={pad + nextPt[1]}
                    stroke={trailColor}
                    strokeWidth={strokeW}
                    strokeLinecap="round"
                    opacity={alpha}
                  />
                );
              })}
            </g>
          )}

          {/* ───────── 10 On-Court Players ───────── */}
          {frameData &&
            frameData.players.map((p: PlayerFrame) => {
              const isSelected = p.id === selectedPlayerId;
              const color = getTeamColor(p.id);
              const player = roster.players[String(p.id)];
              const cx = pad + p.court_xy[0];
              const cy = pad + p.court_xy[1];

              if (isSelected) {
                // Directional velocity vector calculation (looking 4 frames ahead)
                const lookaheadFrame = telemetry.frames[Math.min(currentFrame + 4, metadata.total_frames - 1)];
                const lookaheadPlayer = lookaheadFrame?.players.find((np) => np.id === p.id);
                let vecDx = 0;
                let vecDy = 0;
                if (lookaheadPlayer) {
                  vecDx = (lookaheadPlayer.court_xy[0] - p.court_xy[0]) * 3.5;
                  vecDy = (lookaheadPlayer.court_xy[1] - p.court_xy[1]) * 3.5;
                }

                return (
                  <g
                    key={p.id}
                    onClick={() => onSelectPlayer(null)}
                    className="cursor-pointer"
                  >
                    {/* Outer Pulsing Sonar Ring */}
                    <circle
                      cx={cx}
                      cy={cy}
                      r={32}
                      fill="none"
                      stroke={color}
                      strokeWidth={2}
                      opacity={0.3}
                      className="animate-pulse-ring"
                    />
                    <circle
                      cx={cx}
                      cy={cy}
                      r={24}
                      fill="none"
                      stroke={color}
                      strokeWidth={1.5}
                      opacity={0.5}
                      className="animate-pulse-ring"
                      style={{ animationDelay: '0.4s' }}
                    />

                    {/* Velocity Vector Arrow */}
                    {(Math.abs(vecDx) > 2 || Math.abs(vecDy) > 2) && (
                      <line
                        x1={cx}
                        y1={cy}
                        x2={cx + vecDx}
                        y2={cy + vecDy}
                        stroke="white"
                        strokeWidth={2.5}
                        markerEnd="url(#vel-arrow)"
                        opacity={0.85}
                      />
                    )}

                    {/* Main Selected Player Marker */}
                    <circle
                      cx={cx}
                      cy={cy}
                      r={18}
                      fill={color}
                      stroke="white"
                      strokeWidth={3}
                      filter="url(#radar-glow)"
                    />
                    <text
                      x={cx}
                      y={cy + 5}
                      textAnchor="middle"
                      fill="white"
                      fontSize="12"
                      fontWeight="800"
                      fontFamily="Inter, sans-serif"
                    >
                      {player?.number}
                    </text>
                  </g>
                );
              }

              // Unselected Players (rendered at 35-40% opacity for spatial context)
              return (
                <g
                  key={p.id}
                  onClick={() => onSelectPlayer(p.id)}
                  className="cursor-pointer hover:opacity-90 transition-opacity"
                  opacity={0.38}
                >
                  <circle
                    cx={cx}
                    cy={cy}
                    r={11}
                    fill={color}
                    stroke="rgba(255, 255, 255, 0.4)"
                    strokeWidth={1.5}
                  />
                  <text
                    x={cx}
                    y={cy + 4}
                    textAnchor="middle"
                    fill="white"
                    fontSize="9"
                    fontWeight="700"
                    fontFamily="Inter, sans-serif"
                  >
                    {player?.number}
                  </text>
                </g>
              );
            })}
        </svg>
      </div>
    </div>
  );
}
