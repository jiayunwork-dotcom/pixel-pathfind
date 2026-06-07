import type { Cell, TileData, MapData, LayerType, TerrainType } from './types';

export function cellKey(x: number, y: number): string {
  return `${x},${y}`;
}

export function parseKey(key: string): Cell {
  const [x, y] = key.split(',').map(Number);
  return { x, y };
}

export function getTile(mapData: MapData, x: number, y: number): TileData {
  const key = cellKey(x, y);
  return mapData.tiles[key] || {
    terrain: 0,
    obstacle: false,
    decoration: 0,
    event: 0,
  };
}

export function setTile(mapData: MapData, x: number, y: number, tile: TileData): void {
  const key = cellKey(x, y);
  mapData.tiles[key] = tile;
}

export function isWalkable(mapData: MapData, x: number, y: number): boolean {
  if (x < 0 || x >= mapData.width || y < 0 || y >= mapData.height) {
    return false;
  }
  const tile = getTile(mapData, x, y);
  return tile.terrain !== 1 && !tile.obstacle;
}

export function getMovementCost(mapData: MapData, x: number, y: number): number {
  const tile = getTile(mapData, x, y);
  const costs: Record<TerrainType, number> = {
    0: 1,
    1: Infinity,
    2: 3,
    3: 2,
    4: 1.5,
    5: 5,
  };
  return costs[tile.terrain] || 1;
}

export function hasUniformCost(mapData: MapData): boolean {
  let baseCost: number | null = null;
  for (let y = 0; y < mapData.height; y++) {
    for (let x = 0; x < mapData.width; x++) {
      if (!isWalkable(mapData, x, y)) continue;
      const cost = getMovementCost(mapData, x, y);
      if (baseCost === null) {
        baseCost = cost;
      } else if (cost !== baseCost) {
        return false;
      }
    }
  }
  return true;
}

export function getNeighbors(x: number, y: number, includeDiagonal: boolean = false): Cell[] {
  const neighbors: Cell[] = [
    { x: x + 1, y },
    { x: x - 1, y },
    { x, y: y + 1 },
    { x, y: y - 1 },
  ];
  if (includeDiagonal) {
    neighbors.push(
      { x: x + 1, y: y + 1 },
      { x: x + 1, y: y - 1 },
      { x: x - 1, y: y + 1 },
      { x: x - 1, y: y - 1 }
    );
  }
  return neighbors;
}

export function bresenhamLine(x0: number, y0: number, x1: number, y1: number): Cell[] {
  const cells: Cell[] = [];
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;

  while (true) {
    cells.push({ x: x0, y: y0 });
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x0 += sx;
    }
    if (e2 < dx) {
      err += dx;
      y0 += sy;
    }
  }
  return cells;
}

export function hasLineOfSight(
  mapData: MapData,
  x0: number,
  y0: number,
  x1: number,
  y1: number
): boolean {
  const line = bresenhamLine(x0, y0, x1, y1);
  for (const cell of line) {
    if (!isWalkable(mapData, cell.x, cell.y)) {
      return false;
    }
  }
  return true;
}

export function generateId(): string {
  return Math.random().toString(36).substring(2, 11);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function getLayerName(layer: LayerType): string {
  const names = ['地形层', '障碍物层', '装饰层', '事件层'];
  return names[layer] || '未知';
}

export function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}
