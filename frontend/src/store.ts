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
  BookmarkComment,
  CompareBookmarkState,
  ComparePathInfo,
  CustomAlgorithm,
  CustomAlgorithmState,
  AlgorithmVersion,
  AlgorithmComment,
  VersionCompareData,
  SandboxMetrics,
  ExecuteAlgorithmResult,
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
  comments: Record<string, BookmarkComment[]>;
  lastReadCommentId: Record<string, string>;
  newCommentBookmarks: Set<string>;
  compareMode: CompareBookmarkState;
  expandedBookmarkId: string | null;
}

const initialBookmarksState: BookmarksState = {
  bookmarks: [],
  selectedBookmarkId: null,
  replayingBookmark: null,
  comments: {},
  lastReadCommentId: {},
  newCommentBookmarks: new Set(),
  compareMode: {
    isActive: false,
    selectedIds: [],
    comparingPaths: [],
    hoverCell: null,
  },
  expandedBookmarkId: null,
};

const COMPARE_COLORS = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#FFEAA7'];

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

    setComments: (comments: Record<string, BookmarkComment[]>) => {
      update((state) => ({ ...state, comments }));
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
        const comments = { ...state.comments };
        delete comments[id];
        const lastReadCommentId = { ...state.lastReadCommentId };
        delete lastReadCommentId[id];
        const newCommentBookmarks = new Set(state.newCommentBookmarks);
        newCommentBookmarks.delete(id);
        const compareMode = { ...state.compareMode };
        compareMode.selectedIds = compareMode.selectedIds.filter((bid) => bid !== id);
        compareMode.comparingPaths = compareMode.comparingPaths.filter((p) => p.bookmark.id !== id);
        return {
          ...state,
          bookmarks,
          replayingBookmark,
          comments,
          lastReadCommentId,
          newCommentBookmarks,
          compareMode,
          selectedBookmarkId: state.selectedBookmarkId === id ? null : state.selectedBookmarkId,
          expandedBookmarkId: state.expandedBookmarkId === id ? null : state.expandedBookmarkId,
        };
      }),

    renameBookmark: (id: string, name: string) =>
      update((state) => {
        const bookmarks = state.bookmarks.map((b) => (b.id === id ? { ...b, name } : b));
        const replayingBookmark = state.replayingBookmark?.id === id ? { ...state.replayingBookmark, name } : state.replayingBookmark;
        return { ...state, bookmarks, replayingBookmark };
      }),

    addComment: (comment: BookmarkComment) =>
      update((state) => {
        const comments = { ...state.comments };
        const bookmarkComments = [...(comments[comment.bookmarkId] || [])];
        bookmarkComments.push(comment);
        if (bookmarkComments.length > 20) {
          bookmarkComments.splice(0, bookmarkComments.length - 20);
        }
        comments[comment.bookmarkId] = bookmarkComments;

        const newCommentBookmarks = new Set(state.newCommentBookmarks);
        if (state.expandedBookmarkId !== comment.bookmarkId) {
          newCommentBookmarks.add(comment.bookmarkId);
        }

        const lastReadCommentId = { ...state.lastReadCommentId };
        if (state.expandedBookmarkId === comment.bookmarkId) {
          lastReadCommentId[comment.bookmarkId] = comment.id;
        }

        return { ...state, comments, newCommentBookmarks, lastReadCommentId };
      }),

    deleteComment: (bookmarkId: string, commentId: string) =>
      update((state) => {
        const comments = { ...state.comments };
        const bookmarkComments = (comments[bookmarkId] || []).filter((c) => c.id !== commentId);
        comments[bookmarkId] = bookmarkComments;
        return { ...state, comments };
      }),

    markCommentsAsRead: (bookmarkId: string) =>
      update((state) => {
        const bookmarkComments = state.comments[bookmarkId] || [];
        if (bookmarkComments.length === 0) return state;

        const lastComment = bookmarkComments[bookmarkComments.length - 1];
        const lastReadCommentId = { ...state.lastReadCommentId };
        lastReadCommentId[bookmarkId] = lastComment.id;

        const newCommentBookmarks = new Set(state.newCommentBookmarks);
        newCommentBookmarks.delete(bookmarkId);

        return { ...state, lastReadCommentId, newCommentBookmarks };
      }),

    getCommentCount: (bookmarkId: string) => {
      const state = get(bookmarksStore);
      return (state.comments[bookmarkId] || []).length;
    },

    hasNewComments: (bookmarkId: string) => {
      const state = get(bookmarksStore);
      return state.newCommentBookmarks.has(bookmarkId);
    },

    expandBookmark: (bookmarkId: string | null) =>
      update((state) => {
        if (bookmarkId) {
          const newCommentBookmarks = new Set(state.newCommentBookmarks);
          newCommentBookmarks.delete(bookmarkId);
          const bookmarkComments = state.comments[bookmarkId] || [];
          const lastReadCommentId = { ...state.lastReadCommentId };
          if (bookmarkComments.length > 0) {
            lastReadCommentId[bookmarkId] = bookmarkComments[bookmarkComments.length - 1].id;
          }
          return { ...state, expandedBookmarkId: bookmarkId, newCommentBookmarks, lastReadCommentId };
        }
        return { ...state, expandedBookmarkId: null };
      }),

    toggleCompareMode: () =>
      update((state) => {
        const isActive = !state.compareMode.isActive;
        return {
          ...state,
          replayingBookmark: isActive ? null : state.replayingBookmark,
          selectedBookmarkId: isActive ? null : state.selectedBookmarkId,
          compareMode: {
            isActive,
            selectedIds: [],
            comparingPaths: [],
            hoverCell: null,
          },
        };
      }),

    toggleCompareSelection: (bookmarkId: string) =>
      update((state) => {
        if (!state.compareMode.isActive) return state;

        const selectedIds = [...state.compareMode.selectedIds];
        const idx = selectedIds.indexOf(bookmarkId);
        if (idx >= 0) {
          selectedIds.splice(idx, 1);
        } else {
          if (selectedIds.length >= 4) return state;
          selectedIds.push(bookmarkId);
        }

        return {
          ...state,
          compareMode: {
            ...state.compareMode,
            selectedIds,
          },
        };
      }),

    startComparison: () =>
      update((state) => {
        if (!state.compareMode.isActive) return state;
        if (state.compareMode.selectedIds.length < 2 || state.compareMode.selectedIds.length > 4) return state;

        const comparingPaths: ComparePathInfo[] = state.compareMode.selectedIds
          .map((id, idx) => {
            const bookmark = state.bookmarks.find((b) => b.id === id);
            if (!bookmark) return null;
            return {
              bookmark,
              color: COMPARE_COLORS[idx],
            };
          })
          .filter(Boolean) as ComparePathInfo[];

        return {
          ...state,
          compareMode: {
            ...state.compareMode,
            comparingPaths,
          },
        };
      }),

    exitComparison: () =>
      update((state) => ({
        ...state,
        compareMode: {
          isActive: false,
          selectedIds: [],
          comparingPaths: [],
          hoverCell: null,
        },
      })),

    setCompareHoverCell: (cell: Cell | null) =>
      update((state) => ({
        ...state,
        compareMode: {
          ...state.compareMode,
          hoverCell: cell,
        },
      })),

    getPathsAtCell: (x: number, y: number): ComparePathInfo[] => {
      const state = get(bookmarksStore);
      const result: ComparePathInfo[] = [];
      for (const pathInfo of state.compareMode.comparingPaths) {
        if (pathInfo.bookmark.path.some((c) => c.x === x && c.y === y)) {
          result.push(pathInfo);
        }
      }
      return result;
    },

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
    let currentTime = 0;
    if (clampedIdx > 0 && clampedIdx <= state.operations.length && state.operations.length > 0) {
      const opIndex = Math.min(clampedIdx - 1, state.operations.length - 1);
      const op = state.operations[opIndex];
      if (op) {
        currentTime = op.timeOffset;
      }
    }

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
    if (state.operations.length === 0) return;
    if (state.currentOperationIdx >= state.operations.length) {
      jumpToOperation(0);
    }

    update((s) => ({ ...s, isPlaying: true }));

    const tick = () => {
      const currentState = get(playbackStore);
      if (!currentState.isPlaying || currentState.operations.length === 0 || currentState.currentOperationIdx >= currentState.operations.length) {
        stop();
        return;
      }

      const nextIdx = currentState.currentOperationIdx + 1;
      if (nextIdx > currentState.operations.length) {
        stop();
        return;
      }

      jumpToOperation(nextIdx);

      const nextState = get(playbackStore);
      let delay = 1000 / currentState.speed;

      if (nextIdx < currentState.operations.length && nextIdx > 0) {
        const currentOp = currentState.operations[Math.max(0, nextIdx - 1)];
        const nextOp = currentState.operations[nextIdx];
        if (currentOp && nextOp) {
          delay = (nextOp.timeOffset - currentOp.timeOffset) / currentState.speed;
        }
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
    if (!state.isActive || state.operations.length === 0) return;
    if (state.currentOperationIdx >= state.operations.length) return;
    jumpToOperation(state.currentOperationIdx + 1);
  }

  function stepBackward() {
    const state = get(playbackStore);
    if (!state.isActive || state.operations.length === 0) return;
    if (state.currentOperationIdx <= 0) return;
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
    const emptyMap = createEmptyMap(originalMapData.width, originalMapData.height);
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
      originalMapData: emptyMap,
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

const algorithmTemplate = `/**
 * 自定义寻路算法模板
 * @param {number[][]} costMap - 地形代价二维数组，costMap[y][x]表示格子代价
 * @param {number} startX - 起点X坐标
 * @param {number} startY - 起点Y坐标
 * @param {number} endX - 终点X坐标
 * @param {number} endY - 终点Y坐标
 * @returns {{x: number, y: number}[]} 路径坐标数组，从起点到终点
 *
 * 可用常量: width (地图宽度), height (地图高度)
 * 代价说明: 1=普通地面, 1.5=草地, 2=沙地, 3=水域, 5=沼泽, Infinity=障碍物
 */
function findPath(costMap, startX, startY, endX, endY) {
  // 示例: 简单的BFS实现
  const visited = new Set();
  const parent = new Map();
  const queue = [{ x: startX, y: startY }];
  visited.add(startX + ',' + startY);

  const directions = [
    { dx: 1, dy: 0 }, { dx: -1, dy: 0 },
    { dx: 0, dy: 1 }, { dx: 0, dy: -1 },
    { dx: 1, dy: 1 }, { dx: 1, dy: -1 },
    { dx: -1, dy: 1 }, { dx: -1, dy: -1 }
  ];

  while (queue.length > 0) {
    const current = queue.shift();

    if (current.x === endX && current.y === endY) {
      const path = [];
      let node = current.x + ',' + current.y;
      while (node) {
        const [x, y] = node.split(',').map(Number);
        path.unshift({ x, y });
        node = parent.get(node);
      }
      return path;
    }

    for (const dir of directions) {
      const nx = current.x + dir.dx;
      const ny = current.y + dir.dy;
      const key = nx + ',' + ny;

      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      if (visited.has(key)) continue;
      if (costMap[ny][nx] === Infinity) continue;

      visited.add(key);
      parent.set(key, current.x + ',' + current.y);
      queue.push({ x: nx, y: ny });
    }
  }

  return [];
}`;

const initialCustomAlgorithmState: CustomAlgorithmState = {
  algorithms: [],
  expanded: false,
  currentAlgorithm: null,
  editorCode: algorithmTemplate,
  editorName: '',
  isRunning: false,
  compareResult: null,
  showCustomPath: true,
  showBFSPath: true,
  sandboxMetrics: {
    memoryMB: 0,
    timeMs: 0,
    isFinished: true,
  },
  currentMapHash: '',
  versionCompareData: [],
  showVersionCompare: false,
  expandedAlgorithmId: null,
  comments: {},
  loadedVersion: null,
  newCommentAlgorithms: new Set(),
};

function createCustomAlgorithmStore() {
  const { subscribe, set, update } = writable<CustomAlgorithmState>(initialCustomAlgorithmState);

  let currentUserId: string | null = null;
  let currentUserName: string | null = null;
  let currentRoomId: string | null = null;

  function calculateMapHash(mapData: MapData): string {
    return btoa(JSON.stringify(mapData)).slice(0, 16);
  }

  return {
    subscribe,

    setUserInfo: (userId: string, userName: string) => {
      currentUserId = userId;
      currentUserName = userName;
    },

    setRoomId: (roomId: string) => {
      currentRoomId = roomId;
    },

    setExpanded: (expanded: boolean) =>
      update((state) => ({ ...state, expanded })),

    setAlgorithms: (algorithms: CustomAlgorithm[]) =>
      update((state) => ({ ...state, algorithms })),

    addAlgorithm: (algorithm: CustomAlgorithm) =>
      update((state) => {
        const algorithms = [...state.algorithms];
        const idx = algorithms.findIndex((a) => a.id === algorithm.id);
        if (idx >= 0) {
          algorithms[idx] = algorithm;
        } else {
          algorithms.push(algorithm);
          if (algorithms.length > 5) {
            algorithms.shift();
          }
        }
        return { ...state, algorithms };
      }),

    deleteAlgorithm: (id: string) =>
      update((state) => {
        const comments = { ...state.comments };
        delete comments[id];
        return {
          ...state,
          algorithms: state.algorithms.filter((a) => a.id !== id),
          currentAlgorithm: state.currentAlgorithm?.id === id ? null : state.currentAlgorithm,
          expandedAlgorithmId: state.expandedAlgorithmId === id ? null : state.expandedAlgorithmId,
          comments,
        };
      }),

    loadAlgorithm: (algorithm: CustomAlgorithm) =>
      update((state) => ({
        ...state,
        currentAlgorithm: algorithm,
        editorCode: algorithm.code,
        editorName: algorithm.name,
        compareResult: null,
        loadedVersion: null,
      })),

    setEditorCode: (code: string) =>
      update((state) => ({ ...state, editorCode: code })),

    setEditorName: (name: string) =>
      update((state) => ({ ...state, editorName: name })),

    setIsRunning: (isRunning: boolean) =>
      update((state) => ({ ...state, isRunning })),

    setCompareResult: (result: ExecuteAlgorithmResult | null) =>
      update((state) => ({ ...state, compareResult: result })),

    setShowCustomPath: (show: boolean) =>
      update((state) => ({ ...state, showCustomPath: show })),

    setShowBFSPath: (show: boolean) =>
      update((state) => ({ ...state, showBFSPath: show })),

    setSandboxMetrics: (metrics: SandboxMetrics) =>
      update((state) => ({ ...state, sandboxMetrics: metrics })),

    setShowVersionCompare: (show: boolean) =>
      update((state) => ({ ...state, showVersionCompare: show })),

    setExpandedAlgorithmId: (id: string | null) =>
      update((state) => ({ ...state, expandedAlgorithmId: id })),

    setComments: (comments: Record<string, AlgorithmComment[]>) =>
      update((state) => ({ ...state, comments })),

    setLoadedVersion: (version: number | null) =>
      update((state) => ({ ...state, loadedVersion: version })),

    setVersionCompareData: (data: VersionCompareData[]) =>
      update((state) => ({ ...state, versionCompareData: data })),

    newAlgorithm: () =>
      update((state) => ({
        ...state,
        currentAlgorithm: null,
        editorCode: algorithmTemplate,
        editorName: '',
        compareResult: null,
        loadedVersion: null,
      })),

    addComment: (comment: AlgorithmComment) =>
      update((state) => {
        const comments = { ...state.comments };
        const algoComments = [...(comments[comment.algorithmId] || [])];
        algoComments.unshift(comment);
        if (algoComments.length > 20) {
          algoComments.splice(20);
        }
        comments[comment.algorithmId] = algoComments;

        const newCommentAlgorithms = new Set(state.newCommentAlgorithms);
        if (state.expandedAlgorithmId !== comment.algorithmId) {
          newCommentAlgorithms.add(comment.algorithmId);
        }

        return { ...state, comments, newCommentAlgorithms };
      }),

    deleteComment: (algorithmId: string, commentId: string) =>
      update((state) => {
        const comments = { ...state.comments };
        const algoComments = (comments[algorithmId] || []).filter((c) => c.id !== commentId);
        comments[algorithmId] = algoComments;
        return { ...state, comments };
      }),

    markCommentsAsRead: (algorithmId: string) =>
      update((state) => {
        const newCommentAlgorithms = new Set(state.newCommentAlgorithms);
        newCommentAlgorithms.delete(algorithmId);
        return { ...state, newCommentAlgorithms };
      }),

    hasNewComments: (algorithmId: string): boolean => {
      const state = get(customAlgorithmStore);
      return state.newCommentAlgorithms.has(algorithmId);
    },

    async loadAlgorithmVersion(algorithmId: string, version: number): Promise<AlgorithmVersion | null> {
      if (!currentRoomId) return null;
      try {
        const response = await fetch(`/api/room/${currentRoomId}/algorithms/${algorithmId}/versions/${version}`);
        const data = await response.json();
        if (response.ok && data.version) {
          return data.version;
        }
      } catch (e) {
        console.error('加载算法版本失败:', e);
      }
      return null;
    },

    async loadVersion(algorithmId: string, version: number) {
      const versionData = await this.loadAlgorithmVersion(algorithmId, version);
      if (versionData) {
        const algo = get(customAlgorithmStore).algorithms.find((a) => a.id === algorithmId);
        if (algo) {
          update((state) => ({
            ...state,
            currentAlgorithm: algo,
            editorCode: versionData.code,
            editorName: algo.name,
            compareResult: null,
            loadedVersion: version,
          }));
        }
      }
    },

    async loadVersionCompareData(algorithmId: string, mapHash: string) {
      if (!currentRoomId) return;
      try {
        const response = await fetch(`/api/room/${currentRoomId}/algorithms/${algorithmId}/compare?mapHash=${mapHash}`);
        const data = await response.json();
        if (response.ok) {
          update((state) => ({
            ...state,
            versionCompareData: data.compareData || [],
          }));
        }
      } catch (e) {
        console.error('加载版本对比数据失败:', e);
      }
    },

    async loadAlgorithmComments(algorithmId: string) {
      if (!currentRoomId) return;
      try {
        const response = await fetch(`/api/room/${currentRoomId}/algorithms/${algorithmId}/comments`);
        const data = await response.json();
        if (response.ok) {
          update((state) => {
            const comments = { ...state.comments };
            comments[algorithmId] = data.comments || [];
            return { ...state, comments };
          });
        }
      } catch (e) {
        console.error('加载算法评论失败:', e);
      }
    },

    async saveAlgorithm() {
      const state = get(customAlgorithmStore);
      if (!currentRoomId || !currentUserId || !currentUserName) {
        uiStore.showToast('请先加入房间');
        return;
      }

      const name = state.editorName.trim();
      if (!name) {
        uiStore.showToast('请输入算法名称');
        return;
      }
      if (name.length > 20) {
        uiStore.showToast('算法名称不能超过20字');
        return;
      }

      try {
        const response = await fetch(`/api/room/${currentRoomId}/algorithms`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-User-ID': currentUserId,
            'X-User-Name': currentUserName,
          },
          body: JSON.stringify({
            id: state.currentAlgorithm?.id,
            name,
            code: state.editorCode,
          }),
        });

        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || '保存失败');
        }

        uiStore.showToast(`保存成功，版本 v${data.algorithm.currentVersion}`);
        update((s) => ({
          ...s,
          currentAlgorithm: data.algorithm,
          loadedVersion: null,
        }));
      } catch (e) {
        uiStore.showToast('保存失败: ' + (e as Error).message);
      }
    },

    async deleteAlgorithmById(id: string) {
      if (!currentRoomId || !currentUserId) {
        uiStore.showToast('请先加入房间');
        return;
      }

      try {
        const response = await fetch(`/api/room/${currentRoomId}/algorithms/${id}`, {
          method: 'DELETE',
          headers: {
            'X-User-ID': currentUserId,
          },
        });

        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || '删除失败');
        }

        uiStore.showToast('删除成功');
      } catch (e) {
        uiStore.showToast('删除失败: ' + (e as Error).message);
      }
    },

    async executeAlgorithm() {
      const state = get(customAlgorithmStore);
      const mapState = get(mapStore);
      const pfState = get(pathfindingStore);

      if (!pfState.startPoint || !pfState.endPoint) {
        uiStore.showToast('请先设置起点和终点');
        return;
      }

      if (!state.editorCode.trim()) {
        uiStore.showToast('代码不能为空');
        return;
      }

      update((s) => ({
        ...s,
        isRunning: true,
        sandboxMetrics: { memoryMB: 0, timeMs: 0, isFinished: false },
      }));

      let metricsInterval: number | null = null;
      metricsInterval = window.setInterval(() => {
        const currentState = get(customAlgorithmStore);
        if (!currentState.isRunning) {
          if (metricsInterval) clearInterval(metricsInterval);
          return;
        }
        const elapsed = currentState.sandboxMetrics.timeMs + 50;
        const memoryEstimate = Math.min(30, elapsed / 100);
        update((s) => ({
          ...s,
          sandboxMetrics: {
            memoryMB: memoryEstimate,
            timeMs: elapsed,
            isFinished: false,
          },
        }));
      }, 50);

      try {
        const mapHash = calculateMapHash(mapState.mapData);
        const params = new URLSearchParams();
        if (state.currentAlgorithm?.id && currentRoomId) {
          params.set('algorithmId', state.currentAlgorithm.id);
          params.set('version', String(state.currentAlgorithm.currentVersion));
          params.set('roomId', currentRoomId);
        }

        const response = await fetch(`/api/algorithm/execute?${params.toString()}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            code: state.editorCode,
            mapData: mapState.mapData,
            startPoint: pfState.startPoint,
            endPoint: pfState.endPoint,
          }),
        });

        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || '执行失败');
        }

        if (metricsInterval) clearInterval(metricsInterval);

        update((s) => ({
          ...s,
          isRunning: false,
          compareResult: data,
          sandboxMetrics: data.metrics || { memoryMB: 0, timeMs: 0, isFinished: true },
          currentMapHash: data.mapHash || mapHash,
          showCustomPath: true,
          showBFSPath: true,
        }));

        if (data.betterThanBFS) {
          uiStore.showToast('🎉 恭喜！您的算法优于BFS基线！', 3000);
        }
      } catch (e) {
        if (metricsInterval) clearInterval(metricsInterval);
        update((s) => ({
          ...s,
          isRunning: false,
          sandboxMetrics: { ...s.sandboxMetrics, isFinished: true },
        }));
        uiStore.showToast('执行失败: ' + (e as Error).message);
      }
    },

    async loadAlgorithms(includeVersions: boolean = true) {
      if (!currentRoomId) return;
      try {
        const url = includeVersions
          ? `/api/room/${currentRoomId}/algorithms?includeVersions=true`
          : `/api/room/${currentRoomId}/algorithms`;
        const response = await fetch(url);
        const data = await response.json();
        if (response.ok) {
          update((state) => ({ ...state, algorithms: data.algorithms || [] }));
        }
      } catch (e) {
        console.error('加载算法列表失败:', e);
      }
    },

    reset: () => set(initialCustomAlgorithmState),
  };
}

export const customAlgorithmStore = createCustomAlgorithmStore();
