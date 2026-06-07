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
  RecordingState,
  PlaybackState,
  RecordedOperation,
  MapSnapshot,
  PlaybackBookmark,
  PlaybackSpeed,
  PlaybackControlState,
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

const initialRecordingState: RecordingState = {
  isRecording: false,
  startTime: 0,
  operationCount: 0,
  maxOperations: 10000,
  isStopped: false,
};

function createRecordingStore() {
  const { subscribe, set, update } = writable<RecordingState>(initialRecordingState);

  return {
    subscribe,
    set,
    updateRecording: (recording: RecordingState) => set(recording),
    updateOperationCount: (count: number) =>
      update((state) => ({ ...state, operationCount: count })),
    stopRecording: (reason: string) =>
      update((state) => ({ ...state, isRecording: false, isStopped: true })),
    reset: () => set(initialRecordingState),
  };
}

const initialPlaybackState: PlaybackControlState = {
  isActive: false,
  isPlaying: false,
  currentTime: 0,
  totalDuration: 0,
  currentOperationIdx: 0,
  totalOperations: 0,
  speed: 1,
  operations: [],
  snapshots: [],
  bookmarks: [],
  isLoading: false,
  originalMapData: null,
};

function createPlaybackStore() {
  const { subscribe, set, update } = writable<PlaybackControlState>(initialPlaybackState);
  let playTimer: number | null = null;

  function getMapDataAtOperation(targetIdx: number, operations: RecordedOperation[], snapshots: MapSnapshot[], originalMap: MapData): MapData {
    let baseMap: MapData;
    let startIdx = 0;

    const sortedSnapshots = [...snapshots].sort((a, b) => a.operationIdx - b.operationIdx);
    let nearestSnapshot: MapSnapshot | null = null;
    for (const snapshot of sortedSnapshots) {
      if (snapshot.operationIdx <= targetIdx) {
        nearestSnapshot = snapshot;
      } else {
        break;
      }
    }

    if (nearestSnapshot) {
      baseMap = deepClone(nearestSnapshot.mapData);
      startIdx = nearestSnapshot.operationIdx;
    } else {
      baseMap = deepClone(originalMap);
    }

    for (let i = startIdx; i < targetIdx && i < operations.length; i++) {
      const op = operations[i];
      applyOperationToMap(baseMap, op.cells, op.layer);
    }

    return baseMap;
  }

  function jumpToOperation(targetIdx: number) {
    const state = get(playbackStore);
    if (!state.isActive || !state.originalMapData) return;

    const clampedIdx = Math.max(0, Math.min(targetIdx, state.operations.length));

    const newMapData = getMapDataAtOperation(clampedIdx, state.operations, state.snapshots, state.originalMapData);
    const currentTime = clampedIdx > 0 && clampedIdx <= state.operations.length
      ? state.operations[Math.min(clampedIdx - 1, state.operations.length - 1)].timeOffset
      : 0;

    mapStore.setMapData(newMapData);

    update((s) => ({
      ...s,
      currentOperationIdx: clampedIdx,
      currentTime,
    }));
  }

  function play() {
    const state = get(playbackStore);
    if (!state.isActive || state.isPlaying) return;
    if (state.currentOperationIdx >= state.operations.length) {
      jumpToOperation(0);
    }

    update((s) => ({ ...s, isPlaying: true }));

    const tick = () => {
      const currentState = get(playbackStore);
      if (!currentState.isPlaying || currentState.currentOperationIdx >= currentState.operations.length) {
        stop();
        return;
      }

      const nextIdx = currentState.currentOperationIdx + 1;
      jumpToOperation(nextIdx);

      const nextState = get(playbackStore);
      let delay = 1000 / currentState.speed;

      if (nextIdx < currentState.operations.length) {
        const currentOp = currentState.operations[Math.max(0, nextIdx - 1)];
        const nextOp = currentState.operations[nextIdx];
        delay = (nextOp.timeOffset - currentOp.timeOffset) / currentState.speed;
      }

      playTimer = window.setTimeout(tick, Math.max(10, delay));
    };

    tick();
  }

  function pause() {
    if (playTimer) {
      clearTimeout(playTimer);
      playTimer = null;
    }
    update((s) => ({ ...s, isPlaying: false }));
  }

  function stop() {
    if (playTimer) {
      clearTimeout(playTimer);
      playTimer = null;
    }
    update((s) => ({ ...s, isPlaying: false }));
  }

  function stepForward() {
    const state = get(playbackStore);
    if (!state.isActive) return;
    jumpToOperation(state.currentOperationIdx + 1);
  }

  function stepBackward() {
    const state = get(playbackStore);
    if (!state.isActive) return;
    jumpToOperation(state.currentOperationIdx - 1);
  }

  function setSpeed(speed: PlaybackSpeed) {
    update((s) => ({ ...s, speed }));
  }

  function setOperations(operations: RecordedOperation[]) {
    update((s) => {
      const totalDuration = operations.length > 0 ? operations[operations.length - 1].timeOffset : 0;
      return {
        ...s,
        operations,
        totalOperations: operations.length,
        totalDuration,
      };
    });
  }

  function setSnapshots(snapshots: MapSnapshot[]) {
    update((s) => ({ ...s, snapshots }));
  }

  function setBookmarks(bookmarks: PlaybackBookmark[]) {
    update((s) => ({ ...s, bookmarks }));
  }

  function addBookmark(bookmark: PlaybackBookmark) {
    update((s) => {
      const bookmarks = [...s.bookmarks, bookmark].sort((a, b) => a.timeOffset - b.timeOffset);
      return { ...s, bookmarks };
    });
  }

  function deleteBookmark(id: string) {
    update((s) => ({
      ...s,
      bookmarks: s.bookmarks.filter((b) => b.id !== id),
    }));
  }

  function jumpToTime(timeMs: number) {
    const state = get(playbackStore);
    if (!state.isActive) return;

    let targetIdx = 0;
    for (let i = 0; i < state.operations.length; i++) {
      if (state.operations[i].timeOffset <= timeMs) {
        targetIdx = i + 1;
      } else {
        break;
      }
    }

    jumpToOperation(targetIdx);
  }

  function startPlayback(recording: RecordingState, originalMapData: MapData) {
    stop();
    set({
      isActive: true,
      isPlaying: false,
      currentTime: 0,
      totalDuration: recording.operationCount > 0 ? recording.operationCount * 100 : 0,
      currentOperationIdx: 0,
      totalOperations: recording.operationCount,
      speed: 1,
      operations: [],
      snapshots: [],
      bookmarks: [],
      isLoading: true,
      originalMapData: deepClone(originalMapData),
    });
    wsClient.startPlayback();
    wsClient.requestRecordedOps(0, -1);
    wsClient.requestSnapshots();
    wsClient.requestPlaybackBookmarks();
  }

  function exitPlayback() {
    stop();
    const state = get(playbackStore);
    if (state.originalMapData) {
      mapStore.setMapData(state.originalMapData);
    }
    wsClient.stopPlayback();
    set(initialPlaybackState);
  }

  function setLoading(loading: boolean) {
    update((s) => ({ ...s, isLoading: loading }));
  }

  return {
    subscribe,
    play,
    pause,
    stop,
    stepForward,
    stepBackward,
    setSpeed,
    jumpToOperation,
    jumpToTime,
    setOperations,
    setSnapshots,
    setBookmarks,
    addBookmark,
    deleteBookmark,
    startPlayback,
    exitPlayback,
    setLoading,
    getMapDataAtOperation,
  };
}

export const mapStore = createMapStore();
export const uiStore = createUIStore();
export const pathfindingStore = createPathfindingStore();
export const heatmapStore = createHeatmapStore();
export const bookmarksStore = createBookmarksStore();
export const recordingStore = createRecordingStore();
export const playbackStore = createPlaybackStore();
