import type {
  Cell,
  MapData,
  PathNode,
  HeuristicType,
  AlgorithmResult,
  AlgorithmType,
} from '../types';
import {
  cellKey,
  getTile,
  isWalkable,
  getMovementCost,
  getNeighbors,
  hasLineOfSight,
  bresenhamLine,
  hasUniformCost,
} from '../utils';

export function manhattanDistance(a: Cell, b: Cell): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

export function euclideanDistance(a: Cell, b: Cell): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

export function diagonalDistance(a: Cell, b: Cell): number {
  const dx = Math.abs(a.x - b.x);
  const dy = Math.abs(a.y - b.y);
  return (dx + dy) - Math.min(dx, dy) + Math.SQRT2 * Math.min(dx, dy);
}

export function chebyshevDistance(a: Cell, b: Cell): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

export function getHeuristic(
  type: HeuristicType,
  a: Cell,
  b: Cell,
  weight: number = 1
): number {
  let h: number;
  switch (type) {
    case 'manhattan':
      h = manhattanDistance(a, b);
      break;
    case 'euclidean':
      h = euclideanDistance(a, b);
      break;
    case 'diagonal':
      h = diagonalDistance(a, b);
      break;
    case 'chebyshev':
      h = chebyshevDistance(a, b);
      break;
    default:
      h = manhattanDistance(a, b);
  }
  return h * weight;
}

class PriorityQueue<T> {
  private items: { item: T; priority: number }[] = [];

  enqueue(item: T, priority: number): void {
    this.items.push({ item, priority });
    this.items.sort((a, b) => a.priority - b.priority);
  }

  dequeue(): T | undefined {
    return this.items.shift()?.item;
  }

  size(): number {
    return this.items.length;
  }

  isEmpty(): boolean {
    return this.items.length === 0;
  }
}

function reconstructPath(node: PathNode): Cell[] {
  const path: Cell[] = [];
  let current: PathNode | null | undefined = node;
  while (current) {
    path.unshift({ x: current.x, y: current.y });
    current = current.parent;
  }
  return path;
}

export async function bfs(
  mapData: MapData,
  start: Cell,
  end: Cell,
  onStep?: (visited: Set<string>, openSet: Set<string>, current: Cell | null) => void,
  stepDelay: number = 0,
  timeoutMs: number = 5000,
  shouldStop?: () => boolean,
  isPaused?: () => boolean
): Promise<AlgorithmResult> {
  const startTime = performance.now();
  const visited = new Set<string>();
  const openSet = new Set<string>();
  const queue: PathNode[] = [];
  const parentMap = new Map<string, PathNode>();

  const startNode: PathNode = { x: start.x, y: start.y, parent: null };
  queue.push(startNode);
  openSet.add(cellKey(start.x, start.y));
  parentMap.set(cellKey(start.x, start.y), startNode);

  let exploredCount = 0;

  while (queue.length > 0) {
    if (shouldStop?.()) {
      return {
        algorithm: 'bfs',
        path: [],
        exploredCount,
        totalCost: 0,
        pathLength: 0,
        timeMs: performance.now() - startTime,
        timeout: false,
      };
    }

    while (isPaused?.()) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      if (shouldStop?.()) {
        return {
          algorithm: 'bfs',
          path: [],
          exploredCount,
          totalCost: 0,
          pathLength: 0,
          timeMs: performance.now() - startTime,
          timeout: false,
        };
      }
    }

    if (performance.now() - startTime > timeoutMs) {
      return {
        algorithm: 'bfs',
        path: [],
        exploredCount,
        totalCost: 0,
        pathLength: 0,
        timeMs: timeoutMs,
        timeout: true,
      };
    }

    const current = queue.shift()!;
    const currentKey = cellKey(current.x, current.y);
    openSet.delete(currentKey);
    visited.add(currentKey);
    exploredCount++;

    if (current.x === end.x && current.y === end.y) {
      const path = reconstructPath(current);
      const totalCost = path.reduce((sum, cell) => sum + getMovementCost(mapData, cell.x, cell.y), 0);
      return {
        algorithm: 'bfs',
        path,
        exploredCount,
        totalCost,
        pathLength: path.length,
        timeMs: performance.now() - startTime,
        timeout: false,
      };
    }

    if (onStep) {
      onStep(visited, openSet, { x: current.x, y: current.y });
      if (stepDelay > 0) {
        await new Promise((resolve) => setTimeout(resolve, stepDelay));
      } else {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }

    const neighbors = getNeighbors(current.x, current.y, false);
    for (const neighbor of neighbors) {
      const neighborKey = cellKey(neighbor.x, neighbor.y);
      if (visited.has(neighborKey) || openSet.has(neighborKey)) continue;
      if (!isWalkable(mapData, neighbor.x, neighbor.y)) continue;

      const neighborNode: PathNode = {
        x: neighbor.x,
        y: neighbor.y,
        parent: current,
      };
      queue.push(neighborNode);
      openSet.add(neighborKey);
      parentMap.set(neighborKey, neighborNode);
    }
  }

  return {
    algorithm: 'bfs',
    path: [],
    exploredCount,
    totalCost: 0,
    pathLength: 0,
    timeMs: performance.now() - startTime,
    timeout: false,
  };
}

export async function dijkstra(
  mapData: MapData,
  start: Cell,
  end: Cell,
  onStep?: (visited: Set<string>, openSet: Set<string>, current: Cell | null) => void,
  stepDelay: number = 0,
  timeoutMs: number = 5000,
  shouldStop?: () => boolean,
  isPaused?: () => boolean
): Promise<AlgorithmResult> {
  const startTime = performance.now();
  const visited = new Set<string>();
  const openSet = new Set<string>();
  const pq = new PriorityQueue<PathNode>();
  const gScore = new Map<string, number>();

  const startNode: PathNode = { x: start.x, y: start.y, g: 0, parent: null };
  pq.enqueue(startNode, 0);
  openSet.add(cellKey(start.x, start.y));
  gScore.set(cellKey(start.x, start.y), 0);

  let exploredCount = 0;

  while (!pq.isEmpty()) {
    if (shouldStop?.()) {
      return {
        algorithm: 'dijkstra',
        path: [],
        exploredCount,
        totalCost: 0,
        pathLength: 0,
        timeMs: performance.now() - startTime,
        timeout: false,
      };
    }

    while (isPaused?.()) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      if (shouldStop?.()) {
        return {
          algorithm: 'dijkstra',
          path: [],
          exploredCount,
          totalCost: 0,
          pathLength: 0,
          timeMs: performance.now() - startTime,
          timeout: false,
        };
      }
    }

    if (performance.now() - startTime > timeoutMs) {
      return {
        algorithm: 'dijkstra',
        path: [],
        exploredCount,
        totalCost: 0,
        pathLength: 0,
        timeMs: timeoutMs,
        timeout: true,
      };
    }

    const current = pq.dequeue()!;
    const currentKey = cellKey(current.x, current.y);
    openSet.delete(currentKey);

    if (visited.has(currentKey)) continue;
    visited.add(currentKey);
    exploredCount++;

    if (current.x === end.x && current.y === end.y) {
      const path = reconstructPath(current);
      const totalCost = path.reduce((sum, cell) => sum + getMovementCost(mapData, cell.x, cell.y), 0);
      return {
        algorithm: 'dijkstra',
        path,
        exploredCount,
        totalCost,
        pathLength: path.length,
        timeMs: performance.now() - startTime,
        timeout: false,
      };
    }

    if (onStep) {
      onStep(visited, openSet, { x: current.x, y: current.y });
      if (stepDelay > 0) {
        await new Promise((resolve) => setTimeout(resolve, stepDelay));
      } else {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }

    const neighbors = getNeighbors(current.x, current.y, true);
    for (const neighbor of neighbors) {
      if (!isWalkable(mapData, neighbor.x, neighbor.y)) continue;
      const neighborKey = cellKey(neighbor.x, neighbor.y);
      if (visited.has(neighborKey)) continue;

      const isDiagonal =
        neighbor.x !== current.x && neighbor.y !== current.y;
      const moveCost = isDiagonal
        ? getMovementCost(mapData, neighbor.x, neighbor.y) * Math.SQRT2
        : getMovementCost(mapData, neighbor.x, neighbor.y);

      const tentativeG = (current.g || 0) + moveCost;

      if (!gScore.has(neighborKey) || tentativeG < (gScore.get(neighborKey) || Infinity)) {
        gScore.set(neighborKey, tentativeG);
        const neighborNode: PathNode = {
          x: neighbor.x,
          y: neighbor.y,
          g: tentativeG,
          parent: current,
        };
        pq.enqueue(neighborNode, tentativeG);
        openSet.add(neighborKey);
      }
    }
  }

  return {
    algorithm: 'dijkstra',
    path: [],
    exploredCount,
    totalCost: 0,
    pathLength: 0,
    timeMs: performance.now() - startTime,
    timeout: false,
  };
}

export async function astar(
  mapData: MapData,
  start: Cell,
  end: Cell,
  heuristic: HeuristicType = 'manhattan',
  heuristicWeight: number = 1,
  onStep?: (visited: Set<string>, openSet: Set<string>, current: Cell | null) => void,
  stepDelay: number = 0,
  timeoutMs: number = 5000,
  shouldStop?: () => boolean,
  isPaused?: () => boolean
): Promise<AlgorithmResult> {
  const startTime = performance.now();
  const visited = new Set<string>();
  const openSet = new Set<string>();
  const pq = new PriorityQueue<PathNode>();
  const gScore = new Map<string, number>();

  const startH = getHeuristic(heuristic, start, end, heuristicWeight);
  const startNode: PathNode = {
    x: start.x,
    y: start.y,
    g: 0,
    h: startH,
    f: startH,
    parent: null,
  };
  pq.enqueue(startNode, startH);
  openSet.add(cellKey(start.x, start.y));
  gScore.set(cellKey(start.x, start.y), 0);

  let exploredCount = 0;

  while (!pq.isEmpty()) {
    if (shouldStop?.()) {
      return {
        algorithm: 'astar',
        path: [],
        exploredCount,
        totalCost: 0,
        pathLength: 0,
        timeMs: performance.now() - startTime,
        timeout: false,
      };
    }

    while (isPaused?.()) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      if (shouldStop?.()) {
        return {
          algorithm: 'astar',
          path: [],
          exploredCount,
          totalCost: 0,
          pathLength: 0,
          timeMs: performance.now() - startTime,
          timeout: false,
        };
      }
    }

    if (performance.now() - startTime > timeoutMs) {
      return {
        algorithm: 'astar',
        path: [],
        exploredCount,
        totalCost: 0,
        pathLength: 0,
        timeMs: timeoutMs,
        timeout: true,
      };
    }

    const current = pq.dequeue()!;
    const currentKey = cellKey(current.x, current.y);
    openSet.delete(currentKey);

    if (visited.has(currentKey)) continue;
    visited.add(currentKey);
    exploredCount++;

    if (current.x === end.x && current.y === end.y) {
      const path = reconstructPath(current);
      const totalCost = path.reduce((sum, cell) => sum + getMovementCost(mapData, cell.x, cell.y), 0);
      return {
        algorithm: 'astar',
        path,
        exploredCount,
        totalCost,
        pathLength: path.length,
        timeMs: performance.now() - startTime,
        timeout: false,
      };
    }

    if (onStep) {
      onStep(visited, openSet, { x: current.x, y: current.y });
      if (stepDelay > 0) {
        await new Promise((resolve) => setTimeout(resolve, stepDelay));
      } else {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }

    const neighbors = getNeighbors(current.x, current.y, true);
    for (const neighbor of neighbors) {
      if (!isWalkable(mapData, neighbor.x, neighbor.y)) continue;
      const neighborKey = cellKey(neighbor.x, neighbor.y);
      if (visited.has(neighborKey)) continue;

      const isDiagonal =
        neighbor.x !== current.x && neighbor.y !== current.y;
      const moveCost = isDiagonal
        ? getMovementCost(mapData, neighbor.x, neighbor.y) * Math.SQRT2
        : getMovementCost(mapData, neighbor.x, neighbor.y);

      const tentativeG = (current.g || 0) + moveCost;

      if (!gScore.has(neighborKey) || tentativeG < (gScore.get(neighborKey) || Infinity)) {
        gScore.set(neighborKey, tentativeG);
        const h = getHeuristic(heuristic, neighbor, end, heuristicWeight);
        const f = tentativeG + h;
        const neighborNode: PathNode = {
          x: neighbor.x,
          y: neighbor.y,
          g: tentativeG,
          h,
          f,
          parent: current,
        };
        pq.enqueue(neighborNode, f);
        openSet.add(neighborKey);
      }
    }
  }

  return {
    algorithm: 'astar',
    path: [],
    exploredCount,
    totalCost: 0,
    pathLength: 0,
    timeMs: performance.now() - startTime,
    timeout: false,
  };
}

function jump(
  mapData: MapData,
  x: number,
  y: number,
  dx: number,
  dy: number,
  end: Cell,
  visited: Set<string>
): PathNode | null {
  const nx = x + dx;
  const ny = y + dy;

  if (!isWalkable(mapData, nx, ny)) return null;
  if (nx === end.x && ny === end.y) return { x: nx, y: ny };

  const key = cellKey(nx, ny);
  if (visited.has(key)) return null;

  if (dx !== 0 && dy !== 0) {
    if (
      (isWalkable(mapData, nx - dx, ny) && !isWalkable(mapData, nx - dx, ny - dy)) ||
      (isWalkable(mapData, nx, ny - dy) && !isWalkable(mapData, nx - dx, ny - dy))
    ) {
      return { x: nx, y: ny };
    }
  } else if (dx !== 0) {
    if (
      (isWalkable(mapData, nx, ny + 1) && !isWalkable(mapData, nx - dx, ny + 1)) ||
      (isWalkable(mapData, nx, ny - 1) && !isWalkable(mapData, nx - dx, ny - 1))
    ) {
      return { x: nx, y: ny };
    }
  } else if (dy !== 0) {
    if (
      (isWalkable(mapData, nx + 1, ny) && !isWalkable(mapData, nx + 1, ny - dy)) ||
      (isWalkable(mapData, nx - 1, ny) && !isWalkable(mapData, nx - 1, ny - dy))
    ) {
      return { x: nx, y: ny };
    }
  }

  if (dx !== 0 && dy !== 0) {
    const hx = jump(mapData, nx, ny, dx, 0, end, visited);
    const hy = jump(mapData, nx, ny, 0, dy, end, visited);
    if (hx !== null || hy !== null) {
      return { x: nx, y: ny };
    }
  }

  return jump(mapData, nx, ny, dx, dy, end, visited);
}

export async function jps(
  mapData: MapData,
  start: Cell,
  end: Cell,
  onStep?: (visited: Set<string>, openSet: Set<string>, current: Cell | null) => void,
  stepDelay: number = 0,
  timeoutMs: number = 5000,
  shouldStop?: () => boolean,
  isPaused?: () => boolean
): Promise<AlgorithmResult> {
  if (!hasUniformCost(mapData)) {
    return astar(mapData, start, end, 'manhattan', 1, onStep, stepDelay, timeoutMs, shouldStop, isPaused).then(
      (result) => ({ ...result, algorithm: 'jps' as AlgorithmType })
    );
  }

  const startTime = performance.now();
  const visited = new Set<string>();
  const openSet = new Set<string>();
  const pq = new PriorityQueue<PathNode>();
  const gScore = new Map<string, number>();

  const startH = manhattanDistance(start, end);
  const startNode: PathNode = {
    x: start.x,
    y: start.y,
    g: 0,
    h: startH,
    f: startH,
    parent: null,
  };
  pq.enqueue(startNode, startH);
  openSet.add(cellKey(start.x, start.y));
  gScore.set(cellKey(start.x, start.y), 0);

  let exploredCount = 0;

  while (!pq.isEmpty()) {
    if (shouldStop?.()) {
      return {
        algorithm: 'jps',
        path: [],
        exploredCount,
        totalCost: 0,
        pathLength: 0,
        timeMs: performance.now() - startTime,
        timeout: false,
      };
    }

    while (isPaused?.()) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      if (shouldStop?.()) {
        return {
          algorithm: 'jps',
          path: [],
          exploredCount,
          totalCost: 0,
          pathLength: 0,
          timeMs: performance.now() - startTime,
          timeout: false,
        };
      }
    }

    if (performance.now() - startTime > timeoutMs) {
      return {
        algorithm: 'jps',
        path: [],
        exploredCount,
        totalCost: 0,
        pathLength: 0,
        timeMs: timeoutMs,
        timeout: true,
      };
    }

    const current = pq.dequeue()!;
    const currentKey = cellKey(current.x, current.y);
    openSet.delete(currentKey);

    if (visited.has(currentKey)) continue;
    visited.add(currentKey);
    exploredCount++;

    if (current.x === end.x && current.y === end.y) {
      const path = reconstructPath(current);
      const totalCost = path.reduce((sum, cell) => sum + getMovementCost(mapData, cell.x, cell.y), 0);
      return {
        algorithm: 'jps',
        path,
        exploredCount,
        totalCost,
        pathLength: path.length,
        timeMs: performance.now() - startTime,
        timeout: false,
      };
    }

    if (onStep) {
      onStep(visited, openSet, { x: current.x, y: current.y });
      if (stepDelay > 0) {
        await new Promise((resolve) => setTimeout(resolve, stepDelay));
      } else {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }

    const directions = [
      { dx: 1, dy: 0 },
      { dx: -1, dy: 0 },
      { dx: 0, dy: 1 },
      { dx: 0, dy: -1 },
      { dx: 1, dy: 1 },
      { dx: 1, dy: -1 },
      { dx: -1, dy: 1 },
      { dx: -1, dy: -1 },
    ];

    for (const dir of directions) {
      const jumpPoint = jump(mapData, current.x, current.y, dir.dx, dir.dy, end, visited);
      if (!jumpPoint) continue;

      const jumpKey = cellKey(jumpPoint.x, jumpPoint.y);
      if (visited.has(jumpKey)) continue;

      const tentativeG = (current.g || 0) + manhattanDistance(
        { x: current.x, y: current.y },
        { x: jumpPoint.x, y: jumpPoint.y }
      );

      if (!gScore.has(jumpKey) || tentativeG < (gScore.get(jumpKey) || Infinity)) {
        gScore.set(jumpKey, tentativeG);
        const h = manhattanDistance(jumpPoint, end);
        const f = tentativeG + h;
        jumpPoint.g = tentativeG;
        jumpPoint.h = h;
        jumpPoint.f = f;
        jumpPoint.parent = current;
        pq.enqueue(jumpPoint, f);
        openSet.add(jumpKey);
      }
    }
  }

  return {
    algorithm: 'jps',
    path: [],
    exploredCount,
    totalCost: 0,
    pathLength: 0,
    timeMs: performance.now() - startTime,
    timeout: false,
  };
}

export async function thetastar(
  mapData: MapData,
  start: Cell,
  end: Cell,
  heuristic: HeuristicType = 'manhattan',
  heuristicWeight: number = 1,
  onStep?: (visited: Set<string>, openSet: Set<string>, current: Cell | null) => void,
  stepDelay: number = 0,
  timeoutMs: number = 5000,
  shouldStop?: () => boolean,
  isPaused?: () => boolean
): Promise<AlgorithmResult> {
  const startTime = performance.now();
  const visited = new Set<string>();
  const openSet = new Set<string>();
  const pq = new PriorityQueue<PathNode>();
  const gScore = new Map<string, number>();
  const parentMap = new Map<string, PathNode>();

  const startH = getHeuristic(heuristic, start, end, heuristicWeight);
  const startNode: PathNode = {
    x: start.x,
    y: start.y,
    g: 0,
    h: startH,
    f: startH,
    parent: null,
  };
  pq.enqueue(startNode, startH);
  openSet.add(cellKey(start.x, start.y));
  gScore.set(cellKey(start.x, start.y), 0);
  parentMap.set(cellKey(start.x, start.y), startNode);

  let exploredCount = 0;

  while (!pq.isEmpty()) {
    if (shouldStop?.()) {
      return {
        algorithm: 'thetastar',
        path: [],
        exploredCount,
        totalCost: 0,
        pathLength: 0,
        timeMs: performance.now() - startTime,
        timeout: false,
      };
    }

    while (isPaused?.()) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      if (shouldStop?.()) {
        return {
          algorithm: 'thetastar',
          path: [],
          exploredCount,
          totalCost: 0,
          pathLength: 0,
          timeMs: performance.now() - startTime,
          timeout: false,
        };
      }
    }

    if (performance.now() - startTime > timeoutMs) {
      return {
        algorithm: 'thetastar',
        path: [],
        exploredCount,
        totalCost: 0,
        pathLength: 0,
        timeMs: timeoutMs,
        timeout: true,
      };
    }

    const current = pq.dequeue()!;
    const currentKey = cellKey(current.x, current.y);
    openSet.delete(currentKey);

    if (visited.has(currentKey)) continue;
    visited.add(currentKey);
    exploredCount++;

    if (current.x === end.x && current.y === end.y) {
      const path = reconstructPath(current);
      const smoothPath: Cell[] = [path[0]];
      for (let i = 1; i < path.length - 1; i++) {
        const prev = smoothPath[smoothPath.length - 1];
        const next = path[i + 1];
        if (!hasLineOfSight(mapData, prev.x, prev.y, next.x, next.y)) {
          smoothPath.push(path[i]);
        }
      }
      smoothPath.push(path[path.length - 1]);

      let totalCost = 0;
      for (let i = 0; i < smoothPath.length - 1; i++) {
        totalCost += euclideanDistance(smoothPath[i], smoothPath[i + 1]);
      }

      return {
        algorithm: 'thetastar',
        path: smoothPath,
        exploredCount,
        totalCost,
        pathLength: smoothPath.length,
        timeMs: performance.now() - startTime,
        timeout: false,
      };
    }

    if (onStep) {
      onStep(visited, openSet, { x: current.x, y: current.y });
      if (stepDelay > 0) {
        await new Promise((resolve) => setTimeout(resolve, stepDelay));
      } else {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }

    const neighbors = getNeighbors(current.x, current.y, true);
    for (const neighbor of neighbors) {
      if (!isWalkable(mapData, neighbor.x, neighbor.y)) continue;
      const neighborKey = cellKey(neighbor.x, neighbor.y);
      if (visited.has(neighborKey)) continue;

      const isDiagonal =
        neighbor.x !== current.x && neighbor.y !== current.y;
      const moveCost = isDiagonal
        ? getMovementCost(mapData, neighbor.x, neighbor.y) * Math.SQRT2
        : getMovementCost(mapData, neighbor.x, neighbor.y);

      let tentativeG = (current.g || 0) + moveCost;
      let parent: PathNode = current;

      if (current.parent) {
        const grandparent = current.parent as PathNode;
        if (hasLineOfSight(mapData, grandparent.x, grandparent.y, neighbor.x, neighbor.y)) {
          const gpCost = euclideanDistance(
            { x: grandparent.x, y: grandparent.y },
            { x: neighbor.x, y: neighbor.y }
          ) * getMovementCost(mapData, neighbor.x, neighbor.y);
          const gpG = (grandparent.g || 0) + gpCost;
          if (gpG < tentativeG) {
            tentativeG = gpG;
            parent = grandparent;
          }
        }
      }

      if (!gScore.has(neighborKey) || tentativeG < (gScore.get(neighborKey) || Infinity)) {
        gScore.set(neighborKey, tentativeG);
        const h = getHeuristic(heuristic, neighbor, end, heuristicWeight);
        const f = tentativeG + h;
        const neighborNode: PathNode = {
          x: neighbor.x,
          y: neighbor.y,
          g: tentativeG,
          h,
          f,
          parent,
        };
        pq.enqueue(neighborNode, f);
        openSet.add(neighborKey);
        parentMap.set(neighborKey, neighborNode);
      }
    }
  }

  return {
    algorithm: 'thetastar',
    path: [],
    exploredCount,
    totalCost: 0,
    pathLength: 0,
    timeMs: performance.now() - startTime,
    timeout: false,
  };
}

interface DStarLiteState {
  gScore: Map<string, number>;
  rhsScore: Map<string, number>;
  openSet: Map<string, { k1: number; k2: number }>;
  km: number;
  lastStart: Cell;
  path: Cell[];
}

export class DStarLitePlanner {
  private mapData: MapData;
  private state: DStarLiteState | null = null;
  private heuristic: HeuristicType;

  constructor(mapData: MapData, heuristic: HeuristicType = 'manhattan') {
    this.mapData = mapData;
    this.heuristic = heuristic;
  }

  private calculateKey(s: Cell, start: Cell): { k1: number; k2: number } {
    const g = this.state!.gScore.get(cellKey(s.x, s.y)) ?? Infinity;
    const rhs = this.state!.rhsScore.get(cellKey(s.x, s.y)) ?? Infinity;
    const h = getHeuristic(this.heuristic, s, start, 1);
    const k2 = Math.min(g, rhs);
    const k1 = k2 + h + this.state!.km;
    return { k1, k2 };
  }

  private topKey(): { k1: number; k2: number } | null {
    let minKey: { k1: number; k2: number } | null = null;
    for (const [, key] of this.state!.openSet) {
      if (!minKey || key.k1 < minKey.k1 || (key.k1 === minKey.k1 && key.k2 < minKey.k2)) {
        minKey = key;
      }
    }
    return minKey;
  }

  private topKeyCell(): string | null {
    let minCell: string | null = null;
    let minKey: { k1: number; k2: number } | null = null;
    for (const [cell, key] of this.state!.openSet) {
      if (!minKey || key.k1 < minKey.k1 || (key.k1 === minKey.k1 && key.k2 < minKey.k2)) {
        minKey = key;
        minCell = cell;
      }
    }
    return minCell;
  }

  private compareKeys(
    a: { k1: number; k2: number },
    b: { k1: number; k2: number }
  ): number {
    if (a.k1 < b.k1) return -1;
    if (a.k1 > b.k1) return 1;
    if (a.k2 < b.k2) return -1;
    if (a.k2 > b.k2) return 1;
    return 0;
  }

  private updateVertex(u: Cell, start: Cell): void {
    const uKey = cellKey(u.x, u.y);
    const g = this.state!.gScore.get(uKey) ?? Infinity;
    const rhs = this.state!.rhsScore.get(uKey) ?? Infinity;

    if (g !== rhs) {
      this.state!.openSet.set(uKey, this.calculateKey(u, start));
    } else {
      this.state!.openSet.delete(uKey);
    }
  }

  private computeShortestPath(start: Cell, end: Cell, onStep?: (visited: Set<string>, openSet: Set<string>, current: Cell | null) => void, stepDelay: number = 0): void {
    const visited = new Set<string>();
    const openSetCells = new Set(this.state!.openSet.keys());

    while (true) {
      const topK = this.topKey();
      if (!topK) break;

      const startKey = this.calculateKey(start, start);
      const startG = this.state!.gScore.get(cellKey(start.x, start.y)) ?? Infinity;
      const startRhs = this.state!.rhsScore.get(cellKey(start.x, start.y)) ?? Infinity;

      if (this.compareKeys(topK, startKey) >= 0 && startG === startRhs) {
        break;
      }

      const uKey = this.topKeyCell();
      if (!uKey) break;

      const [ux, uy] = uKey.split(',').map(Number);
      const u: Cell = { x: ux, y: uy };
      const uKeyData = this.state!.openSet.get(uKey)!;
      const uCalcKey = this.calculateKey(u, start);

      visited.add(uKey);

      if (onStep) {
        openSetCells.clear();
        for (const k of this.state!.openSet.keys()) openSetCells.add(k);
        onStep(visited, openSetCells, u);
        if (stepDelay > 0) {
          // Synchronous delay for visualization
        }
      }

      if (this.compareKeys(uKeyData, uCalcKey) < 0) {
        this.state!.openSet.set(uKey, uCalcKey);
      } else {
        const gU = this.state!.gScore.get(uKey) ?? Infinity;
        const rhsU = this.state!.rhsScore.get(uKey) ?? Infinity;

        if (gU > rhsU) {
          this.state!.gScore.set(uKey, rhsU);
          this.state!.openSet.delete(uKey);

          const neighbors = getNeighbors(u.x, u.y, true);
          for (const s of neighbors) {
            if (!isWalkable(this.mapData, s.x, s.y) && !(s.x === end.x && s.y === end.y)) continue;
            const sKey = cellKey(s.x, s.y);
            if (s.x === end.x && s.y === end.y) continue;

            const isDiagonal = s.x !== u.x && s.y !== u.y;
            const cost = isDiagonal
              ? getMovementCost(this.mapData, s.x, s.y) * Math.SQRT2
              : getMovementCost(this.mapData, s.x, s.y);
            const newRhs = (this.state!.gScore.get(uKey) ?? Infinity) + cost;
            const currentRhs = this.state!.rhsScore.get(sKey) ?? Infinity;

            if (newRhs < currentRhs) {
              this.state!.rhsScore.set(sKey, newRhs);
            }
            this.updateVertex(s, start);
          }
        } else {
          this.state!.gScore.set(uKey, Infinity);

          const neighbors = getNeighbors(u.x, u.y, true);
          neighbors.push(u);
          for (const s of neighbors) {
            if (!isWalkable(this.mapData, s.x, s.y) && !(s.x === end.x && s.y === end.y)) continue;
            const sKey = cellKey(s.x, s.y);

            let minRhs = Infinity;
            const sNeighbors = getNeighbors(s.x, s.y, true);
            for (const sp of sNeighbors) {
              if (!isWalkable(this.mapData, sp.x, sp.y) && !(sp.x === end.x && sp.y === end.y)) continue;
              const spKey = cellKey(sp.x, sp.y);
              const isDiagonal = sp.x !== s.x && sp.y !== s.y;
              const cost = isDiagonal
                ? getMovementCost(this.mapData, sp.x, sp.y) * Math.SQRT2
                : getMovementCost(this.mapData, sp.x, sp.y);
              const val = (this.state!.gScore.get(spKey) ?? Infinity) + cost;
              if (val < minRhs) minRhs = val;
            }
            this.state!.rhsScore.set(sKey, minRhs);
            this.updateVertex(s, start);
          }
        }
      }
    }
  }

  public async plan(
    start: Cell,
    end: Cell,
    onStep?: (visited: Set<string>, openSet: Set<string>, current: Cell | null) => void,
    stepDelay: number = 0,
    timeoutMs: number = 5000,
    shouldStop?: () => boolean,
    isPaused?: () => boolean
  ): Promise<AlgorithmResult> {
    const startTime = performance.now();

    if (!this.state) {
      this.state = {
        gScore: new Map(),
        rhsScore: new Map(),
        openSet: new Map(),
        km: 0,
        lastStart: start,
        path: [],
      };

      const endKey = cellKey(end.x, end.y);
      this.state.rhsScore.set(endKey, 0);
      this.state.openSet.set(endKey, this.calculateKey(end, start));
    } else {
      this.state.km += getHeuristic(this.heuristic, this.state.lastStart, start, 1);
      this.state.lastStart = start;
    }

    this.computeShortestPath(start, end, onStep, stepDelay);

    let path: Cell[] = [];
    let current: Cell = { ...start };
    path.push({ ...current });

    let totalCost = 0;
    let exploredCount = this.state.gScore.size;

    while (!(current.x === end.x && current.y === end.y)) {
      if (shouldStop?.()) {
        return {
          algorithm: 'dstarlite',
          path: [],
          exploredCount,
          totalCost: 0,
          pathLength: 0,
          timeMs: performance.now() - startTime,
          timeout: false,
        };
      }

      while (isPaused?.()) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        if (shouldStop?.()) {
          return {
            algorithm: 'dstarlite',
            path: [],
            exploredCount,
            totalCost: 0,
            pathLength: 0,
            timeMs: performance.now() - startTime,
            timeout: false,
          };
        }
      }

      if (performance.now() - startTime > timeoutMs) {
        return {
          algorithm: 'dstarlite',
          path: [],
          exploredCount,
          totalCost: 0,
          pathLength: 0,
          timeMs: timeoutMs,
          timeout: true,
        };
      }

      let minCost = Infinity;
      let nextCell: Cell | null = null;
      const neighbors = getNeighbors(current.x, current.y, true);

      for (const n of neighbors) {
        if (!isWalkable(this.mapData, n.x, n.y) && !(n.x === end.x && n.y === end.y)) continue;
        const nKey = cellKey(n.x, n.y);
        const isDiagonal = n.x !== current.x && n.y !== current.y;
        const cost = isDiagonal
          ? getMovementCost(this.mapData, n.x, n.y) * Math.SQRT2
          : getMovementCost(this.mapData, n.x, n.y);
        const total = (this.state.gScore.get(nKey) ?? Infinity) + cost;
        if (total < minCost) {
          minCost = total;
          nextCell = n;
        }
      }

      if (!nextCell || minCost === Infinity) {
        return {
          algorithm: 'dstarlite',
          path: [],
          exploredCount,
          totalCost: 0,
          pathLength: 0,
          timeMs: performance.now() - startTime,
          timeout: false,
        };
      }

      const isDiagonal = nextCell.x !== current.x && nextCell.y !== current.y;
      totalCost += isDiagonal
        ? getMovementCost(this.mapData, nextCell.x, nextCell.y) * Math.SQRT2
        : getMovementCost(this.mapData, nextCell.x, nextCell.y);

      current = nextCell;
      path.push({ ...current });
    }

    this.state.path = path;

    return {
      algorithm: 'dstarlite',
      path,
      exploredCount,
      totalCost,
      pathLength: path.length,
      timeMs: performance.now() - startTime,
      timeout: false,
    };
  }

  public async replan(
    changedCells: Cell[],
    start: Cell,
    end: Cell,
    onStep?: (visited: Set<string>, openSet: Set<string>, current: Cell | null, affected: Set<string>) => void,
    stepDelay: number = 0
  ): Promise<AlgorithmResult> {
    if (!this.state) {
      return this.plan(start, end, onStep, stepDelay);
    }

    const startTime = performance.now();
    const affected = new Set<string>();

    for (const cell of changedCells) {
      const cellKeyStr = cellKey(cell.x, cell.y);
      affected.add(cellKeyStr);

      const neighbors = getNeighbors(cell.x, cell.y, true);
      for (const n of neighbors) {
        affected.add(cellKey(n.x, n.y));
      }

      const tile = getTile(this.mapData, cell.x, cell.y);
      if (!isWalkable(this.mapData, cell.x, cell.y) && !(cell.x === end.x && cell.y === end.y)) {
        this.state.gScore.set(cellKeyStr, Infinity);
        this.state.rhsScore.set(cellKeyStr, Infinity);
      }

      const allAffected = [...neighbors, cell];
      for (const s of allAffected) {
        if (!isWalkable(this.mapData, s.x, s.y) && !(s.x === end.x && s.y === end.y)) continue;
        const sKey = cellKey(s.x, s.y);

        let minRhs = Infinity;
        if (s.x === end.x && s.y === end.y) {
          minRhs = 0;
        } else {
          const sNeighbors = getNeighbors(s.x, s.y, true);
          for (const sp of sNeighbors) {
            if (!isWalkable(this.mapData, sp.x, sp.y) && !(sp.x === end.x && sp.y === end.y)) continue;
            const spKey = cellKey(sp.x, sp.y);
            const isDiagonal = sp.x !== s.x && sp.y !== s.y;
            const cost = isDiagonal
              ? getMovementCost(this.mapData, sp.x, sp.y) * Math.SQRT2
              : getMovementCost(this.mapData, sp.x, sp.y);
            const val = (this.state.gScore.get(spKey) ?? Infinity) + cost;
            if (val < minRhs) minRhs = val;
          }
        }
        this.state.rhsScore.set(sKey, minRhs);
        this.updateVertex(s, start);
      }
    }

    this.computeShortestPath(start, end, (v, o, c) => {
      if (onStep) onStep(v, o, c, affected);
    }, stepDelay);

    let path: Cell[] = [];
    let current: Cell = { ...start };
    path.push({ ...current });
    let totalCost = 0;

    while (!(current.x === end.x && current.y === end.y)) {
      let minCost = Infinity;
      let nextCell: Cell | null = null;
      const neighbors = getNeighbors(current.x, current.y, true);

      for (const n of neighbors) {
        if (!isWalkable(this.mapData, n.x, n.y) && !(n.x === end.x && n.y === end.y)) continue;
        const nKey = cellKey(n.x, n.y);
        const isDiagonal = n.x !== current.x && n.y !== current.y;
        const cost = isDiagonal
          ? getMovementCost(this.mapData, n.x, n.y) * Math.SQRT2
          : getMovementCost(this.mapData, n.x, n.y);
        const total = (this.state.gScore.get(nKey) ?? Infinity) + cost;
        if (total < minCost) {
          minCost = total;
          nextCell = n;
        }
      }

      if (!nextCell || minCost === Infinity) {
        return {
          algorithm: 'dstarlite',
          path: [],
          exploredCount: this.state.gScore.size,
          totalCost: 0,
          pathLength: 0,
          timeMs: performance.now() - startTime,
          timeout: false,
        };
      }

      const isDiagonal = nextCell.x !== current.x && nextCell.y !== current.y;
      totalCost += isDiagonal
        ? getMovementCost(this.mapData, nextCell.x, nextCell.y) * Math.SQRT2
        : getMovementCost(this.mapData, nextCell.x, nextCell.y);

      current = nextCell;
      path.push({ ...current });
    }

    this.state.path = path;

    return {
      algorithm: 'dstarlite',
      path,
      exploredCount: this.state.gScore.size,
      totalCost,
      pathLength: path.length,
      timeMs: performance.now() - startTime,
      timeout: false,
    };
  }

  public updateMap(mapData: MapData): void {
    this.mapData = mapData;
  }
}

export async function dstarlite(
  mapData: MapData,
  start: Cell,
  end: Cell,
  heuristic: HeuristicType = 'manhattan',
  onStep?: (visited: Set<string>, openSet: Set<string>, current: Cell | null) => void,
  stepDelay: number = 0,
  timeoutMs: number = 5000,
  shouldStop?: () => boolean,
  isPaused?: () => boolean
): Promise<AlgorithmResult> {
  const planner = new DStarLitePlanner(mapData, heuristic);
  return planner.plan(start, end, onStep, stepDelay, timeoutMs, shouldStop, isPaused);
}
