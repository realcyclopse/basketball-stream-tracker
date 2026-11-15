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
  /** true while names / numbers are pipeline placeholders */
  draft?: boolean;
  match_info: MatchInfo;
  players: Record<string, PlayerInfo>;
}

export interface PlayerFrame {
  id: number;
  bbox: [number, number, number, number];
  feet_video_xy: [number, number];
  polygon: number[][];
  /** court position in cm; null when no homography was available */
  court_xy: [number, number] | null;
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
  source?: string;
  tracker?: string;
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

export interface ClipInfo {
  id: string;
  title: string;
  subtitle: string;
  /** file name inside the clip folder; null = no footage (synthetic view) */
  video: string | null;
  fps: number;
  frames: number;
  width: number;
  height: number;
}

export interface ClipManifest {
  clips: ClipInfo[];
}
