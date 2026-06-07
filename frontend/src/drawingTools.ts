import type { Cell, CellOp, MapData, ToolType, TileData } from './types';
import { TerrainType, LayerType } from './types';
import { cellKey, getTile, setTile, bresenhamLine } from './utils';

export function getBrushCells(
  centerX: number,
  centerY: number,
  brushSize: number,
  mapWidth: number,
  mapHeight: number
): Cell[] {
  const cells: Cell[] = [];
  const radius = brushSize - 1;

  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy <= radius * radius) {
        const x = centerX + dx;
        const y = centerY + dy;
        if (x >= 0 && x < mapWidth && y >= 0 && y < mapHeight) {
          cells.push({ x, y });
        }
      }
    }
  }

  return cells;
}

export function getRectCells(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  mapWidth: number,
  mapHeight: number,
  filled: boolean = true
): Cell[] {
  const cells: Cell[] = [];
  const minX = Math.max(0, Math.min(x1, x2));
  const maxX = Math.min(mapWidth - 1, Math.max(x1, x2));
  const minY = Math.max(0, Math.min(y1, y2));
  const maxY = Math.min(mapHeight - 1, Math.max(y1, y2));

  if (filled) {
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        cells.push({ x, y });
      }
    }
  } else {
    for (let x = minX; x <= maxX; x++) {
      cells.push({ x, y: minY });
      cells.push({ x, y: maxY });
    }
    for (let y = minY + 1; y < maxY; y++) {
      cells.push({ x: minX, y });
      cells.push({ x: maxX, y });
    }
  }

  return cells;
}

export function getCircleCells(
  centerX: number,
  centerY: number,
  endX: number,
  endY: number,
  mapWidth: number,
  mapHeight: number,
  filled: boolean = true
): Cell[] {
  const cells: Cell[] = [];
  const radius = Math.sqrt((endX - centerX) ** 2 + (endY - centerY) ** 2);
  const radiusSq = radius * radius;
  const minX = Math.max(0, Math.floor(centerX - radius));
  const maxX = Math.min(mapWidth - 1, Math.ceil(centerX + radius));
  const minY = Math.max(0, Math.floor(centerY - radius));
  const maxY = Math.min(mapHeight - 1, Math.ceil(centerY + radius));

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const distSq = (x - centerX) ** 2 + (y - centerY) ** 2;
      if (filled) {
        if (distSq <= radiusSq) {
          cells.push({ x, y });
        }
      } else {
        if (Math.abs(distSq - radiusSq) <= radius * 1.5) {
          cells.push({ x, y });
        }
      }
    }
  }

  return cells;
}

export function getLineCells(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  mapWidth: number,
  mapHeight: number,
  brushSize: number = 1
): Cell[] {
  const line = bresenhamLine(x1, y1, x2, y2);
  if (brushSize <= 1) {
    return line.filter(c => c.x >= 0 && c.x < mapWidth && c.y >= 0 && c.y < mapHeight);
  }

  const cells: Cell[] = [];
  const seen = new Set<string>();
  const radius = brushSize - 1;

  for (const point of line) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dy * dy <= radius * radius) {
          const x = point.x + dx;
          const y = point.y + dy;
          const key = cellKey(x, y);
          if (
            x >= 0 && x < mapWidth &&
            y >= 0 && y < mapHeight &&
            !seen.has(key)
          ) {
            seen.add(key);
            cells.push({ x, y });
          }
        }
      }
    }
  }

  return cells;
}

export function getFloodFillCells(
  mapData: MapData,
  startX: number,
  startY: number,
  layer: LayerType
): Cell[] {
  const cells: Cell[] = [];
  const startKey = cellKey(startX, startY);
  const startTile = getTile(mapData, startX, startY);

  let targetValue: any;
  switch (layer) {
    case LayerType.Terrain:
      targetValue = startTile.terrain;
      break;
    case LayerType.Obstacle:
      targetValue = startTile.obstacle;
      break;
    case LayerType.Decoration:
      targetValue = startTile.decoration;
      break;
    case LayerType.Event:
      targetValue = startTile.event;
      break;
  }

  const queue: Cell[] = [{ x: startX, y: startY }];
  const visited = new Set<string>();
  visited.add(startKey);

  while (queue.length > 0) {
    const current = queue.shift()!;
    cells.push(current);

    const neighbors = [
      { x: current.x + 1, y: current.y },
      { x: current.x - 1, y: current.y },
      { x: current.x, y: current.y + 1 },
      { x: current.x, y: current.y - 1 },
    ];

    for (const neighbor of neighbors) {
      const key = cellKey(neighbor.x, neighbor.y);
      if (visited.has(key)) continue;
      if (
        neighbor.x < 0 || neighbor.x >= mapData.width ||
        neighbor.y < 0 || neighbor.y >= mapData.height
      ) continue;

      const tile = getTile(mapData, neighbor.x, neighbor.y);
      let currentValue: any;
      switch (layer) {
        case LayerType.Terrain:
          currentValue = tile.terrain;
          break;
        case LayerType.Obstacle:
          currentValue = tile.obstacle;
          break;
        case LayerType.Decoration:
          currentValue = tile.decoration;
          break;
        case LayerType.Event:
          currentValue = tile.event;
          break;
      }

      if (currentValue === targetValue) {
        visited.add(key);
        queue.push(neighbor);
      }
    }
  }

  return cells;
}

export function createCellOperations(
  cells: Cell[],
  value: any,
  layer: LayerType,
  mapData: MapData
): CellOp[] {
  const ops: CellOp[] = [];

  for (const cell of cells) {
    const tile = getTile(mapData, cell.x, cell.y);
    let currentValue: any;
    switch (layer) {
      case LayerType.Terrain:
        currentValue = tile.terrain;
        break;
      case LayerType.Obstacle:
        currentValue = tile.obstacle;
        break;
      case LayerType.Decoration:
        currentValue = tile.decoration;
        break;
      case LayerType.Event:
        currentValue = tile.event;
        break;
    }

    if (currentValue !== value) {
      ops.push({ x: cell.x, y: cell.y, value });
    }
  }

  return ops;
}

export function applyOperationToMap(
  mapData: MapData,
  cells: CellOp[],
  layer: LayerType
): void {
  for (const cellOp of cells) {
    const key = cellKey(cellOp.x, cellOp.y);
    let tile = mapData.tiles[key];
    if (!tile) {
      tile = {
        terrain: TerrainType.Walkable,
        obstacle: false,
        decoration: 0,
        event: 0,
      };
    }

    switch (layer) {
      case LayerType.Terrain:
        tile.terrain = cellOp.value as TerrainType;
        break;
      case LayerType.Obstacle:
        tile.obstacle = cellOp.value as boolean;
        break;
      case LayerType.Decoration:
        tile.decoration = cellOp.value as number;
        break;
      case LayerType.Event:
        tile.event = cellOp.value as number;
        break;
    }

    mapData.tiles[key] = tile;
  }
}

export function inverseOperation(
  cells: CellOp[],
  layer: LayerType,
  mapData: MapData
): CellOp[] {
  const inverse: CellOp[] = [];
  for (const cellOp of cells) {
    const tile = getTile(mapData, cellOp.x, cellOp.y);
    let currentValue: any;
    switch (layer) {
      case LayerType.Terrain:
        currentValue = tile.terrain;
        break;
      case LayerType.Obstacle:
        currentValue = tile.obstacle;
        break;
      case LayerType.Decoration:
        currentValue = tile.decoration;
        break;
      case LayerType.Event:
        currentValue = tile.event;
        break;
    }
    inverse.push({ x: cellOp.x, y: cellOp.y, value: currentValue });
  }
  return inverse.reverse();
}
