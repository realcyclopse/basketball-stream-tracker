export interface TeamInfo {
  code: string;
  name: string;
  color: string;
  accent: string;
}

export interface MatchInfo {
  home_team: TeamInfo;
  away_team: TeamInfo;
}

export interface PlayerInfo {
  id: number;
  name: string;
  shortName: string;
  number: string;
  team: string;
  position: string;
}

export interface RosterData {
  match_info: MatchInfo;
  players: Record<string, PlayerInfo>;
}

export interface PlayerFrame {
  id: number;
  bbox: [number, number, number, number];
  feet_video_xy: [number, number];
  polygon: number[][];
  court_xy: [number, number];
  speed_kmh: number;
  is_interpolated: boolean;
}

export interface FrameData {
  frame_idx: number;
  timestamp: number;
  homography_valid: boolean;
  players: PlayerFrame[];
}

export interface TelemetryMetadata {
  video_width: number;
  video_height: number;
  fps: number;
  total_frames: number;
  court_width: number;
  court_height: number;
  court_unit: string;
}

export interface TelemetryData {
  metadata: TelemetryMetadata;
  frames: FrameData[];
}

export type HighlightMode = 'ring' | 'contour' | 'brackets';

export type CourtZone = 
  | 'Paint'
  | 'Left Corner 3'
  | 'Right Corner 3'
  | 'Left Wing'
  | 'Right Wing'
  | 'Top of Key'
  | 'Backcourt'
  | 'Midrange';

export interface AppState {
  selectedPlayerId: number | null;
  highlightMode: HighlightMode;
  showUnselected: boolean;
  showTrail: boolean;
  currentFrame: number;
}
