import { writable, derived, get } from 'svelte/store';
import { LayerType, TerrainType } from './types';
import type {
  MapData,
  Operation,
  User,
  ToolType,
  Cell,
  CellOp,
  AlgorithmType,
  HeuristicType,
  AlgorithmResult,
  SearchState,
  PathBookmark,
  HeatmapState,
} from './types';
import { cellKey } from './utils';
import { createEmptyMap } from './mapTemplates';
import { applyOperationToMap, inverseOperation } from './drawingTools';
import { wsClient } from './websocket';
import { deepClone } from './utils';

interface MapState {
  roomId: string | null;
  mapData: MapData;
  currentUserId: string | null;
  undoStack: Operation[];
  redoStack: Operation[];
  lastOperationTimestamp: number;
}

interface UIState {
  users: Record<string, User>;
  currentTool: ToolType;
  currentLayer: LayerType;
  currentTerrain: TerrainType;
  brushSize: number;
  zoom: number;
  panX: number;
  panY: number;
  isPanning: boolean;
  showGrid: boolean;
  toastMessage: string | null;
  isDrawing: boolean;
  drawStart: Cell | null;
  drawCurrent: Cell | null;
}

interface PathfindingState {
  startPoint: Cell | null;
  endPoint: Cell | null;
  selectedAlgorithm: AlgorithmType;
  heuristic: HeuristicType;
  heuristicWeight: number;
  animationSpeed: number;
  isRunning: boolean;
  isPaused: boolean;
  currentStep: number;
  searchState: SearchState | null;
  results: AlgorithmResult | null;
  competitionMode: boolean;
  competitionAlgorithms: AlgorithmType[];
  competitionResults: Map<AlgorithmType, AlgorithmResult>;
  jpsAvailable: boolean;
  dstarlitePlanner: any;
}

const initialMapState: MapState = {
  roomId: null,
  mapData: createEmptyMap(64, 64),
  currentUserId: null,
  undoStack: [],
  redoStack: [],
  lastOperationTimestamp: 0,
};

const initialUIState: UIState = {
  users: {},
  currentTool: 'brush',
  currentLayer: LayerType.Terrain,
  currentTerrain: TerrainType.Wall,
  brushSize: 1,
  zoom: 1,
  panX: 0,
  panY: 0,
  isPanning: false,
  showGrid: true,
  toastMessage: null,
  isDrawing: false,
  drawStart: null,
  drawCurrent: null,
};

const initialPathfindingState: PathfindingState = {
  startPoint: null,
  endPoint: null,
  selectedAlgorithm: 'astar',
  heuristic: 'manhattan',
  heuristicWeight: 1,
  animationSpeed: 50,
  isRunning: false,
  isPaused: false,
  currentStep: 0,
  searchState: null,
  results: null,
  competitionMode: false,
  competitionAlgorithms: [],
  competitionResults: new Map(),
  jpsAvailable: true,
  dstarlitePlanner: null,
};

function createMapStore() {
  const { subscribe, set, update } = writable<MapState>(initialMapState);

  return {
    subscribe,

    setMapData: (mapData: MapData) => update((state) => ({ ...state, mapData: deepClone(mapData) })),

    setRoomId: (roomId: string) => update((state) => ({ ...state, roomId })),

    setCurrentUserId: (userId: string) => update((state) => ({ ...state, currentUserId: userId })),

    applyLocalOperation: (op: Operation) =>
      update((state) => {
        const newMapData = deepClone(state.mapData);
        applyOperationToMap(newMapData, op.cells, op.layer);

        const undoOp: Operation = {
          ...op,
          cells: inverseOperation(op.cells, op.layer, state.mapData),
        };

        return {
          ...state,
          mapData: newMapData,
          undoStack: [...state.undoStack, undoOp].slice(-50),
          redoStack: [],
          lastOperationTimestamp: op.timestamp || Date.now(),
        };
      }),

    applyRemoteOperation: (op: Operation, skipUndo: boolean = false) =>
      update((state) => {
        const newMapData = deepClone(state.mapData);
        applyOperationToMap(newMapData, op.cells, op.layer);

        const newState = {
          ...state,
          mapData: newMapData,
          lastOperationTimestamp: op.timestamp || Date.now(),
        };

        if (!skipUndo && op.userId !== state.currentUserId) {
          const undoOp: Operation = {
            ...op,
            cells: inverseOperation(op.cells, op.layer, state.mapData),
          };
          newState.undoStack = [...state.undoStack, undoOp].slice(-50);
          newState.redoStack = [];
        }

        return newState;
      }),

    undo: () =>
      update((state) => {
        if (state.undoStack.length === 0) return state;

        const undoStack = [...state.undoStack];
        const op = undoStack.pop()!;

        const newMapData = deepClone(state.mapData);
        applyOperationToMap(newMapData, op.cells, op.layer);

        const redoOp: Operation = {
          ...op,
          cells: inverseOperation(op.cells, op.layer, state.mapData),
        };

        wsClient.sendOperation(redoOp);

        return {
          ...state,
          mapData: newMapData,
          undoStack,
          redoStack: [...state.redoStack, redoOp],
        };
      }),

    redo: () =>
      update((state) => {
        if (state.redoStack.length === 0) return state;

        const redoStack = [...state.redoStack];
        const op = redoStack.pop()!;

        const newMapData = deepClone(state.mapData);
        applyOperationToMap(newMapData, op.cells, op.layer);

        const undoOp: Operation = {
          ...op,
          cells: inverseOperation(op.cells, op.layer, state.mapData),
        };

        wsClient.sendOperation(op);

        return {
          ...state,
          mapData: newMapData,
          undoStack: [...state.undoStack, undoOp],
          redoStack,
        };
      }),

    reset: () => set(initialMapState),

    resizeMap: (width: number, height: number) =>
      update((state) => {
        const newMap = createEmptyMap(width, height);

        for (const [key, tile] of Object.entries(state.mapData.tiles)) {
          const [x, y] = key.split(',').map(Number);
          if (x < width && y < height) {
            newMap.tiles[key] = { ...tile };
          }
        }

        for (const [layer, info] of Object.entries(state.mapData.layers)) {
          newMap.layers[Number(layer) as LayerType] = { ...info };
        }

        return { ...state, mapData: newMap, undoStack: [], redoStack: [] };
      }),

    updateLayer: (layer: LayerType, updates: any) =>
      update((state) => {
        const newMapData = deepClone(state.mapData);
        newMapData.layers[layer] = { ...newMapData.layers[layer], ...updates };
        return { ...state, mapData: newMapData };
      }),
  };
}

function createUIStore() {
  const { subscribe, set, update } = writable<UIState>(initialUIState);

  let toastTimeout: number | null = null;

  return {
    subscribe,

    setUsers: (users: Record<string, User>) =>
      update((state) => ({ ...state, users })),

    updateUserCursor: (userId: string, x: number, y: number) =>
      update((state) => {
        const users = { ...state.users };
        if (users[userId]) {
          users[userId] = { ...users[userId], position: { x, y } };
        }
        return { ...state, users };
      }),

    setCurrentTool: (tool: ToolType) =>
      update((state) => ({ ...state, currentTool: tool })),

    setCurrentLayer: (layer: LayerType) =>
      update((state) => ({ ...state, currentLayer: layer })),

    setCurrentTerrain: (terrain: TerrainType) =>
      update((state) => ({ ...state, currentTerrain: terrain })),

    setBrushSize: (size: number) =>
      update((state) => ({ ...state, brushSize: size })),

    setZoom: (zoom: number) =>
      update((state) => ({ ...state, zoom })),

    setPan: (x: number, y: number) =>
      update((state) => ({ ...state, panX: x, panY: y })),

    setIsPanning: (panning: boolean) =>
      update((state) => ({ ...state, isPanning: panning })),

    setShowGrid: (show: boolean) =>
      update((state) => ({ ...state, showGrid: show })),

    setIsDrawing: (drawing: boolean) =>
      update((state) => ({ ...state, isDrawing: drawing })),

    setDrawStart: (cell: Cell | null) =>
      update((state) => ({ ...state, drawStart: cell })),

    setDrawCurrent: (cell: Cell | null) =>
      update((state) => ({ ...state, drawCurrent: cell })),

    showToast: (message: string, duration: number = 2000) => {
      if (toastTimeout) clearTimeout(toastTimeout);
      update((state) => ({ ...state, toastMessage: message }));
      toastTimeout = window.setTimeout(() => {
        update((state) => ({ ...state, toastMessage: null }));
      }, duration);
    },

    reset: () => set(initialUIState),
  };
}

function createPathfindingStore() {
  const { subscribe, set, update } = writable<PathfindingState>(initialPathfindingState);

  return {
    subscribe,

    setStartPoint: (point: Cell | null) =>
      update((state) => ({ ...state, startPoint: point })),

    setEndPoint: (point: Cell | null) =>
      update((state) => ({ ...state, endPoint: point })),

    setSelectedAlgorithm: (algo: AlgorithmType) =>
      update((state) => ({ ...state, selectedAlgorithm: algo })),

    setHeuristic: (heuristic: HeuristicType) =>
      update((state) => ({ ...state, heuristic })),

    setHeuristicWeight: (weight: number) =>
      update((state) => ({ ...state, heuristicWeight: weight })),

    setAnimationSpeed: (speed: number) =>
      update((state) => ({ ...state, animationSpeed: speed })),

    setIsRunning: (running: boolean) =>
      update((state) => ({ ...state, isRunning: running })),

    setIsPaused: (paused: boolean) =>
      update((state) => ({ ...state, isPaused: paused })),

    setCurrentStep: (step: number) =>
      update((state) => ({ ...state, currentStep: step })),

    setSearchState: (state: SearchState | null) =>
      update((s) => ({ ...s, searchState: state })),

    setResults: (results: AlgorithmResult | null) =>
      update((state) => ({ ...state, results })),

    setCompetitionMode: (enabled: boolean) =>
      update((state) => ({ ...state, competitionMode: enabled })),

    setCompetitionAlgorithms: (algos: AlgorithmType[]) =>
      update((state) => ({ ...state, competitionAlgorithms: algos })),

    setCompetitionResult: (algo: AlgorithmType, result: AlgorithmResult) =>
      update((state) => {
        const results = new Map(state.competitionResults);
        results.set(algo, result);
        return { ...state, competitionResults: results };
      }),

    clearCompetitionResults: () =>
      update((state) => ({ ...state, competitionResults: new Map() })),

    setJPSAvailable: (available: boolean) =>
      update((state) => ({ ...state, jpsAvailable: available })),

    setDStarLitePlanner: (planner: any) =>
      update((state) => ({ ...state, dstarlitePlanner: planner })),

    reset: () => set(initialPathfindingState),

    clearPath: () =>
      update((state) => ({
        ...state,
        searchState: null,
        results: null,
        isRunning: false,
        isPaused: false,
        currentStep: 0,
      })),
  };
}

interface BookmarksState {
  bookmarks: PathBookmark[];
  selectedBookmarkId: string | null;
  replayingBookmark: PathBookmark | null;
}

const initialBookmarksState: BookmarksState = {
  bookmarks: [],
  selectedBookmarkId: null,
  replayingBookmark: null,
};

function createBookmarksStore() {
  const { subscribe, set, update } = writable<BookmarksState>(initialBookmarksState);

  function calculateHeatmap(bookmarks: PathBookmark[]): { heatData: Map<string, number>; maxHeat: number } {
    const heatData = new Map<string, number>();
    let maxHeat = 0;

    for (const bookmark of bookmarks) {
      for (const cell of bookmark.path) {
        const key = cellKey(cell.x, cell.y);
        const count = (heatData.get(key) || 0) + 1;
        heatData.set(key, count);
        if (count > maxHeat) maxHeat = count;
      }
    }

    return { heatData, maxHeat };
  }

  return {
    subscribe,

    setBookmarks: (bookmarks: PathBookmark[]) => {
      update((state) => {
        const { heatData, maxHeat } = calculateHeatmap(bookmarks);
        heatmapStore.setHeatData(heatData, maxHeat);
        return { ...state, bookmarks };
      });
    },

    addBookmark: (bookmark: PathBookmark) =>
      update((state) => {
        const bookmarks = [...state.bookmarks, bookmark];
        if (bookmarks.length > 20) {
          bookmarks.splice(0, bookmarks.length - 20);
        }
        const { heatData, maxHeat } = calculateHeatmap(bookmarks);
        heatmapStore.setHeatData(heatData, maxHeat);
        return { ...state, bookmarks };
      }),

    deleteBookmark: (id: string) =>
      update((state) => {
        const bookmarks = state.bookmarks.filter((b) => b.id !== id);
        const { heatData, maxHeat } = calculateHeatmap(bookmarks);
        heatmapStore.setHeatData(heatData, maxHeat);
        const replayingBookmark = state.replayingBookmark?.id === id ? null : state.replayingBookmark;
        return { ...state, bookmarks, replayingBookmark, selectedBookmarkId: state.selectedBookmarkId === id ? null : state.selectedBookmarkId };
      }),

    renameBookmark: (id: string, name: string) =>
      update((state) => {
        const bookmarks = state.bookmarks.map((b) => (b.id === id ? { ...b, name } : b));
        const replayingBookmark = state.replayingBookmark?.id === id ? { ...state.replayingBookmark, name } : state.replayingBookmark;
        return { ...state, bookmarks, replayingBookmark };
      }),

    selectBookmark: (id: string | null) =>
      update((state) => ({ ...state, selectedBookmarkId: id })),

    replayBookmark: (bookmark: PathBookmark | null) =>
      update((state) => ({ ...state, replayingBookmark: bookmark })),

    reset: () => {
      heatmapStore.setHeatData(new Map(), 0);
      set(initialBookmarksState);
    },
  };
}

function createHeatmapStore() {
  const { subscribe, set, update } = writable<HeatmapState>({
    visible: false,
    opacity: 0.5,
    heatData: new Map(),
    maxHeat: 0,
  });

  return {
    subscribe,

    setVisible: (visible: boolean) => update((state) => ({ ...state, visible })),

    setOpacity: (opacity: number) => update((state) => ({ ...state, opacity: Math.max(0, Math.min(0.8, opacity)) })),

    setHeatData: (heatData: Map<string, number>, maxHeat: number) =>
      update((state) => ({ ...state, heatData, maxHeat })),

    reset: () =>
      set({
        visible: false,
        opacity: 0.5,
        heatData: new Map(),
        maxHeat: 0,
      }),
  };
}

export const mapStore = createMapStore();
export const uiStore = createUIStore();
export const pathfindingStore = createPathfindingStore();
export const heatmapStore = createHeatmapStore();
export const bookmarksStore = createBookmarksStore();
