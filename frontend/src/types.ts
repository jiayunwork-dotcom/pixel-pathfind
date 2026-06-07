export enum TerrainType {
  Walkable = 0,
  Wall = 1,
  Water = 2,
  Sand = 3,
  Grass = 4,
  Swamp = 5,
}

export enum LayerType {
  Terrain = 0,
  Obstacle = 1,
  Decoration = 2,
  Event = 3,
}

export const TerrainCost: Record<TerrainType, number> = {
  [TerrainType.Walkable]: 1,
  [TerrainType.Wall]: Infinity,
  [TerrainType.Water]: 3,
  [TerrainType.Sand]: 2,
  [TerrainType.Grass]: 1.5,
  [TerrainType.Swamp]: 5,
};

export const TerrainColors: Record<TerrainType, string> = {
  [TerrainType.Walkable]: '#ffffff',
  [TerrainType.Wall]: '#1a1a2e',
  [TerrainType.Water]: '#3498db',
  [TerrainType.Sand]: '#f1c40f',
  [TerrainType.Grass]: '#2ecc71',
  [TerrainType.Swamp]: '#1e8449',
};

export interface Cell {
  x: number;
  y: number;
}

export interface TileData {
  terrain: TerrainType;
  obstacle: boolean;
  decoration: number;
  event: number;
}

export interface LayerInfo {
  visible: boolean;
  locked: boolean;
  opacity: number;
}

export interface MapData {
  width: number;
  height: number;
  tiles: Record<string, TileData>;
  layers: Record<LayerType, LayerInfo>;
}

export interface CellOp {
  x: number;
  y: number;
  value: any;
}

export interface Operation {
  id?: string;
  userId?: string;
  timestamp?: number;
  type: string;
  layer: LayerType;
  cells: CellOp[];
}

export interface User {
  id: string;
  name: string;
  color: string;
  roomId: string;
  position?: Cell;
}

export interface CursorUpdate {
  userId: string;
  x: number;
  y: number;
}

export type ToolType = 'brush' | 'rect' | 'circle' | 'line' | 'fill' | 'eraser' | 'set-start' | 'set-end';

export type AlgorithmType = 'bfs' | 'dijkstra' | 'astar' | 'jps' | 'thetastar' | 'dstarlite';
export type HeuristicType = 'manhattan' | 'euclidean' | 'diagonal' | 'chebyshev';

export interface PathNode {
  x: number;
  y: number;
  g?: number;
  h?: number;
  f?: number;
  parent?: PathNode | null;
}

export interface SearchState {
  visited: Set<string>;
  openSet: Set<string>;
  current: Cell | null;
  path: Cell[];
  exploredCount: number;
  totalCost: number;
  pathLength: number;
  timeMs: number;
  completed: boolean;
  timeout?: boolean;
}

export interface AlgorithmResult {
  algorithm: AlgorithmType;
  path: Cell[];
  exploredCount: number;
  totalCost: number;
  pathLength: number;
  timeMs: number;
  timeout: boolean;
}

export interface RoomState {
  id: string;
  mapData: MapData;
  users: Record<string, User>;
}

export interface BookmarkComment {
  id: string;
  bookmarkId: string;
  userId: string;
  userName: string;
  content: string;
  createdAt: number;
}

export interface PathBookmark {
  id: string;
  name: string;
  algorithm: AlgorithmType;
  startPoint: Cell;
  endPoint: Cell;
  path: Cell[];
  exploredCount: number;
  totalCost: number;
  pathLength: number;
  timeMs: number;
  createdBy: string;
  createdByName: string;
  createdAt: number;
  comments?: BookmarkComment[];
}

export interface HeatmapState {
  visible: boolean;
  opacity: number;
  heatData: Map<string, number>;
  maxHeat: number;
}

export interface Message {
  type: string;
  payload: any;
}

export type TemplateType = 'blank' | 'maze' | 'open' | 'city' | 'natural';

export interface RecordedOperation {
  id: string;
  userId: string;
  userName: string;
  timestamp: number;
  timeOffset: number;
  type: string;
  layer: LayerType;
  cells: CellOp[];
  beforeValues: any[];
  afterValues: any[];
}

export interface MapSnapshot {
  id: string;
  roomId: string;
  operationIdx: number;
  timeOffset: number;
  mapData: MapData;
  createdAt: number;
}

export interface PlaybackBookmark {
  id: string;
  roomId: string;
  timeOffset: number;
  operationIdx: number;
  note: string;
  createdBy: string;
  createdAt: number;
}

export interface RecordingState {
  isRecording: boolean;
  startTime: number;
  operationCount: number;
  maxOperations: number;
  isStopped: boolean;
}

export interface PlaybackState {
  userId: string;
  userName: string;
  isActive: boolean;
}

export type PlaybackSpeed = 0.5 | 1 | 2 | 4;

export interface PlaybackControlState {
  isActive: boolean;
  isPlaying: boolean;
  currentTime: number;
  totalDuration: number;
  currentOperationIdx: number;
  totalOperations: number;
  speed: PlaybackSpeed;
  operations: RecordedOperation[];
  snapshots: MapSnapshot[];
  bookmarks: PlaybackBookmark[];
  isLoading: boolean;
  originalMapData: MapData | null;
}

export interface ComparePathInfo {
  bookmark: PathBookmark;
  color: string;
}

export interface CompareBookmarkState {
  isActive: boolean;
  selectedIds: string[];
  comparingPaths: ComparePathInfo[];
  hoverCell: Cell | null;
}

export interface TooltipData {
  x: number;
  y: number;
  paths: ComparePathInfo[];
}
