<script lang="ts">
  import { onMount, onDestroy, tick, afterUpdate } from 'svelte';
  import { mapStore, uiStore, pathfindingStore, bookmarksStore, heatmapStore, playbackStore } from '../store';
  import { wsClient } from '../websocket';
  import {
    getBrushCells,
    getRectCells,
    getCircleCells,
    getLineCells,
    getFloodFillCells,
    createCellOperations,
  } from '../drawingTools';
  import { cellKey, getTile, setTile, clamp, hasLineOfSight } from '../utils';
  import { TerrainType, LayerType } from '../types';
  import type { Cell, Operation, CellOp, SearchState, TileData, ComparePathInfo } from '../types';
  import { TerrainColors } from '../types';

  let canvas: HTMLCanvasElement;
  let container: HTMLDivElement;
  let ctx: CanvasRenderingContext2D;
  let animationFrame: number;
  let lastCursorX = -1;
  let lastCursorY = -1;
  let cursorThrottleTimer: number | null = null;
  let affectedCells = new Set<string>();
  let dstarAffectedCells = new Set<string>();

  $: mapData = $mapStore.mapData;
  $: currentTool = $uiStore.currentTool;
  $: currentLayer = $uiStore.currentLayer;
  $: currentTerrain = $uiStore.currentTerrain;
  $: brushSize = $uiStore.brushSize;
  $: zoom = $uiStore.zoom;
  $: panX = $uiStore.panX;
  $: panY = $uiStore.panY;
  $: showGrid = $uiStore.showGrid;
  $: isDrawing = $uiStore.isDrawing;
  $: drawStart = $uiStore.drawStart;
  $: drawCurrent = $uiStore.drawCurrent;
  $: users = $uiStore.users;
  $: currentUserId = $mapStore.currentUserId;
  $: startPoint = $pathfindingStore.startPoint;
  $: endPoint = $pathfindingStore.endPoint;
  $: searchState = $pathfindingStore.searchState;
  $: results = $pathfindingStore.results;
  $: layers = $mapStore.mapData.layers;
  $: isPanning = $uiStore.isPanning;
  $: heatmapState = $heatmapStore;
  $: replayingBookmark = $bookmarksStore.replayingBookmark;
  $: isPlaybackMode = $playbackStore.isActive;
  $: compareMode = $bookmarksStore.compareMode;
  $: comparingPaths = compareMode.comparingPaths;
  $: isCompareMode = compareMode.isActive;

  let cellSize = 16;
  let tooltipPaths: ComparePathInfo[] = [];
  let tooltipX = 0;
  let tooltipY = 0;
  let showTooltip = false;
  let isRightMouseDown = false;
  let lastMouseX = 0;
  let lastMouseY = 0;
  let isDragging = false;
  let previewCells: Cell[] = [];

  function getHeatColor(value: number): string {
    value = Math.max(0, Math.min(1, value));
    const r: number[] = [0, 0, 255, 255];
    const g: number[] = [0, 255, 255, 0];
    const b: number[] = [255, 255, 0, 0];
    const idx = Math.floor(value * 3);
    const t = (value * 3) - idx;
    const ri = Math.round(r[idx] + (r[idx + 1] - r[idx]) * t);
    const gi = Math.round(g[idx] + (g[idx + 1] - g[idx]) * t);
    const bi = Math.round(b[idx] + (b[idx + 1] - b[idx]) * t);
    return `rgb(${ri}, ${gi}, ${bi})`;
  }

  function resizeCanvas() {
    if (!container || !canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = container.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    canvas.style.width = rect.width + 'px';
    canvas.style.height = rect.height + 'px';
    ctx = canvas.getContext('2d')!;
    ctx.scale(dpr, dpr);
    render();
  }

  function screenToWorld(screenX: number, screenY: number): Cell {
    const rect = canvas.getBoundingClientRect();
    const x = (screenX - rect.left - panX) / (cellSize * zoom);
    const y = (screenY - rect.top - panY) / (cellSize * zoom);
    return {
      x: Math.floor(x),
      y: Math.floor(y),
    };
  }

  function worldToScreen(worldX: number, worldY: number): { x: number; y: number } {
    return {
      x: worldX * cellSize * zoom + panX,
      y: worldY * cellSize * zoom + panY,
    };
  }

  function render() {
    if (!ctx || !canvas) return;

    const rect = canvas.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;

    ctx.fillStyle = '#0d0d1a';
    ctx.fillRect(0, 0, width, height);

    const startCell = screenToWorld(0, 0);
    const endCell = screenToWorld(width, height);

    const viewStartX = Math.max(0, startCell.x);
    const viewStartY = Math.max(0, startCell.y);
    const viewEndX = Math.min(mapData.width, endCell.x + 1);
    const viewEndY = Math.min(mapData.height, endCell.y + 1);

    const scaledCellSize = cellSize * zoom;

    for (let layer = LayerType.Terrain; layer <= LayerType.Event; layer++) {
      const layerInfo = layers[layer as LayerType];
      if (!layerInfo.visible) continue;

      ctx.globalAlpha = layerInfo.opacity;

      for (let y = viewStartY; y < viewEndY; y++) {
        for (let x = viewStartX; x < viewEndX; x++) {
          const tile = getTile(mapData, x, y);
          const screen = worldToScreen(x, y);

          let color = TerrainColors[tile.terrain];

          if (layer === LayerType.Obstacle && tile.obstacle) {
            color = '#8B4513';
          }

          if (layer === LayerType.Terrain ||
              (layer === LayerType.Obstacle && tile.obstacle) ||
              (layer === LayerType.Decoration && tile.decoration > 0) ||
              (layer === LayerType.Event && tile.event > 0)) {

            ctx.fillStyle = color;
            ctx.fillRect(screen.x, screen.y, scaledCellSize + 1, scaledCellSize + 1);

            if (layer === LayerType.Decoration && tile.decoration > 0) {
              ctx.fillStyle = '#e74c3c';
              ctx.beginPath();
              ctx.arc(
                screen.x + scaledCellSize / 2,
                screen.y + scaledCellSize / 2,
                scaledCellSize * 0.3,
                0,
                Math.PI * 2
              );
              ctx.fill();
            }

            if (layer === LayerType.Event && tile.event > 0) {
              ctx.fillStyle = '#f39c12';
              ctx.fillRect(
                screen.x + scaledCellSize * 0.25,
                screen.y + scaledCellSize * 0.25,
                scaledCellSize * 0.5,
                scaledCellSize * 0.5
              );
            }
          }
        }
      }
    }

    ctx.globalAlpha = 1;

    if (heatmapState.visible && heatmapState.heatData.size > 0 && heatmapState.maxHeat > 0) {
      for (let y = viewStartY; y < viewEndY; y++) {
        for (let x = viewStartX; x < viewEndX; x++) {
          const key = cellKey(x, y);
          const heat = heatmapState.heatData.get(key) || 0;
          if (heat > 0) {
            const normalizedHeat = heat / heatmapState.maxHeat;
            const color = getHeatColor(normalizedHeat);
            const screen = worldToScreen(x, y);
            ctx.globalAlpha = heatmapState.opacity;
            ctx.fillStyle = color;
            ctx.fillRect(screen.x, screen.y, scaledCellSize + 1, scaledCellSize + 1);
          }
        }
      }
      ctx.globalAlpha = 1;
    }

    if (replayingBookmark) {
      const bookmarkPath = replayingBookmark.path;
      if (bookmarkPath.length > 0) {
        ctx.strokeStyle = '#9b59b6';
        ctx.lineWidth = Math.max(3, scaledCellSize * 0.4);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.setLineDash([8, 4]);
        ctx.beginPath();

        for (let i = 0; i < bookmarkPath.length; i++) {
          const p = bookmarkPath[i];
          const screen = worldToScreen(p.x + 0.5, p.y + 0.5);
          if (i === 0) {
            ctx.moveTo(screen.x, screen.y);
          } else {
            ctx.lineTo(screen.x, screen.y);
          }
        }
        ctx.stroke();
        ctx.setLineDash([]);

        if (bookmarkPath.length > 1) {
          ctx.strokeStyle = 'rgba(155, 89, 182, 0.3)';
          ctx.lineWidth = Math.max(5, scaledCellSize * 0.6);
          ctx.stroke();
        }
      }

      const startP = replayingBookmark.startPoint;
      const endP = replayingBookmark.endPoint;
      
      const startScreen = worldToScreen(startP.x + 0.5, startP.y + 0.5);
      const startRadius = scaledCellSize * 0.7;
      ctx.fillStyle = '#27ae60';
      ctx.beginPath();
      ctx.moveTo(startScreen.x - startRadius * 0.3, startScreen.y + startRadius * 0.6);
      ctx.lineTo(startScreen.x - startRadius * 0.3, startScreen.y - startRadius * 0.6);
      ctx.lineTo(startScreen.x + startRadius * 0.5, startScreen.y - startRadius * 0.2);
      ctx.lineTo(startScreen.x - startRadius * 0.3, startScreen.y + startRadius * 0.6);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#27ae60';
      ctx.lineWidth = 3;
      ctx.stroke();

      const endScreen = worldToScreen(endP.x + 0.5, endP.y + 0.5);
      const endRadius = scaledCellSize * 0.7;
      ctx.fillStyle = '#e74c3c';
      ctx.beginPath();
      ctx.moveTo(endScreen.x - endRadius * 0.3, endScreen.y + endRadius * 0.6);
      ctx.lineTo(endScreen.x - endRadius * 0.3, endScreen.y - endRadius * 0.6);
      ctx.lineTo(endScreen.x + endRadius * 0.5, endScreen.y - endRadius * 0.2);
      ctx.lineTo(endScreen.x - endRadius * 0.3, endScreen.y + endRadius * 0.6);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#e74c3c';
      ctx.lineWidth = 3;
      ctx.stroke();
    }

    if (comparingPaths.length > 0) {
      for (const pathInfo of comparingPaths) {
        const path = pathInfo.bookmark.path;
        if (path.length === 0) continue;

        ctx.strokeStyle = pathInfo.color;
        ctx.lineWidth = Math.max(4, scaledCellSize * 0.5);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.globalAlpha = 0.8;
        ctx.beginPath();

        for (let i = 0; i < path.length; i++) {
          const p = path[i];
          const screen = worldToScreen(p.x + 0.5, p.y + 0.5);
          if (i === 0) {
            ctx.moveTo(screen.x, screen.y);
          } else {
            ctx.lineTo(screen.x, screen.y);
          }
        }
        ctx.stroke();

        if (path.length > 1) {
          ctx.strokeStyle = pathInfo.color + '40';
          ctx.lineWidth = Math.max(6, scaledCellSize * 0.7);
          ctx.stroke();
        }

        for (const p of path) {
          const screen = worldToScreen(p.x + 0.5, p.y + 0.5);
          const radius = scaledCellSize * 0.2;
          ctx.fillStyle = pathInfo.color;
          ctx.beginPath();
          ctx.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
          ctx.fill();
        }

        const startP = pathInfo.bookmark.startPoint;
        const endP = pathInfo.bookmark.endPoint;

        const startScreen = worldToScreen(startP.x + 0.5, startP.y + 0.5);
        const startRadius = scaledCellSize * 0.5;
        ctx.fillStyle = pathInfo.color;
        ctx.beginPath();
        ctx.arc(startScreen.x, startScreen.y, startRadius, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.stroke();

        const endScreen = worldToScreen(endP.x + 0.5, endP.y + 0.5);
        const endRadius = scaledCellSize * 0.5;
        ctx.fillStyle = pathInfo.color;
        ctx.beginPath();
        ctx.arc(endScreen.x, endScreen.y, endRadius, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    if (searchState) {
      searchState.visited.forEach((key) => {
        const [x, y] = key.split(',').map(Number);
        const screen = worldToScreen(x, y);
        ctx.fillStyle = 'rgba(74, 158, 255, 0.4)';
        ctx.fillRect(screen.x, screen.y, scaledCellSize + 1, scaledCellSize + 1);
      });

      searchState.openSet.forEach((key) => {
        const [x, y] = key.split(',').map(Number);
        const screen = worldToScreen(x, y);
        ctx.fillStyle = 'rgba(46, 204, 113, 0.5)';
        ctx.fillRect(screen.x, screen.y, scaledCellSize + 1, scaledCellSize + 1);
      });

      if (searchState.current) {
        const screen = worldToScreen(searchState.current.x, searchState.current.y);
        ctx.fillStyle = 'rgba(243, 156, 18, 0.8)';
        ctx.fillRect(screen.x, screen.y, scaledCellSize + 1, scaledCellSize + 1);
      }
    }

    if (dstarAffectedCells.size > 0) {
      const time = Date.now() / 200;
      const flashAlpha = 0.3 + 0.3 * Math.sin(time);
      dstarAffectedCells.forEach((key) => {
        const [x, y] = key.split(',').map(Number);
        const screen = worldToScreen(x, y);
        ctx.fillStyle = `rgba(255, 107, 107, ${flashAlpha})`;
        ctx.fillRect(screen.x, screen.y, scaledCellSize + 1, scaledCellSize + 1);
      });
    }

    if (results?.path && results.path.length > 0) {
      ctx.strokeStyle = '#e74c3c';
      ctx.lineWidth = Math.max(2, scaledCellSize * 0.3);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();

      for (let i = 0; i < results.path.length; i++) {
        const p = results.path[i];
        const screen = worldToScreen(p.x + 0.5, p.y + 0.5);
        if (i === 0) {
          ctx.moveTo(screen.x, screen.y);
        } else {
          ctx.lineTo(screen.x, screen.y);
        }
      }
      ctx.stroke();

      if (results.path.length > 1) {
        ctx.strokeStyle = 'rgba(231, 76, 60, 0.3)';
        ctx.lineWidth = Math.max(4, scaledCellSize * 0.5);
        ctx.stroke();
      }
    }

    if (previewCells.length > 0) {
      ctx.globalAlpha = 0.5;
      const previewColor = currentLayer === LayerType.Obstacle
        ? '#8B4513'
        : TerrainColors[currentTerrain as TerrainType];
      ctx.fillStyle = previewColor;
      previewCells.forEach((cell) => {
        const screen = worldToScreen(cell.x, cell.y);
        ctx.fillRect(screen.x, screen.y, scaledCellSize + 1, scaledCellSize + 1);
      });
      ctx.globalAlpha = 1;
    }

    if (showGrid && zoom >= 0.5) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
      ctx.lineWidth = 1;

      for (let x = viewStartX; x <= viewEndX; x++) {
        const screen = worldToScreen(x, 0);
        ctx.beginPath();
        ctx.moveTo(screen.x, 0);
        ctx.lineTo(screen.x, height);
        ctx.stroke();
      }

      for (let y = viewStartY; y <= viewEndY; y++) {
        const screen = worldToScreen(0, y);
        ctx.beginPath();
        ctx.moveTo(0, screen.y);
        ctx.lineTo(width, screen.y);
        ctx.stroke();
      }
    }

    if (startPoint) {
      const screen = worldToScreen(startPoint.x + 0.5, startPoint.y + 0.5);
      const radius = scaledCellSize * 0.6;

      ctx.fillStyle = '#2ecc71';
      ctx.beginPath();
      ctx.moveTo(screen.x - radius * 0.3, screen.y + radius * 0.6);
      ctx.lineTo(screen.x - radius * 0.3, screen.y - radius * 0.6);
      ctx.lineTo(screen.x + radius * 0.5, screen.y - radius * 0.2);
      ctx.lineTo(screen.x - radius * 0.3, screen.y + radius * 0.6);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#27ae60';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    if (endPoint) {
      const screen = worldToScreen(endPoint.x + 0.5, endPoint.y + 0.5);
      const radius = scaledCellSize * 0.6;

      ctx.fillStyle = '#e74c3c';
      ctx.beginPath();
      ctx.moveTo(screen.x - radius * 0.3, screen.y + radius * 0.6);
      ctx.lineTo(screen.x - radius * 0.3, screen.y - radius * 0.6);
      ctx.lineTo(screen.x + radius * 0.5, screen.y - radius * 0.2);
      ctx.lineTo(screen.x - radius * 0.3, screen.y + radius * 0.6);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#c0392b';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    for (const [userId, user] of Object.entries(users)) {
      if (userId === currentUserId || !user.position) continue;

      const screen = worldToScreen(user.position.x + 0.5, user.position.y + 0.5);
      const size = scaledCellSize * 0.8;

      ctx.fillStyle = user.color + '40';
      ctx.fillRect(
        screen.x - size / 2,
        screen.y - size / 2,
        size,
        size
      );

      ctx.strokeStyle = user.color;
      ctx.lineWidth = 2;
      ctx.strokeRect(
        screen.x - size / 2,
        screen.y - size / 2,
        size,
        size
      );

      ctx.fillStyle = user.color;
      ctx.fillRect(
        screen.x - size / 2,
        screen.y - size / 2 - 18,
        Math.max(60, ctx.measureText(user.name).width + 12),
        16
      );

      ctx.fillStyle = '#ffffff';
      ctx.font = '11px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(
        user.name,
        screen.x,
        screen.y - size / 2 - 6
      );
      ctx.textAlign = 'left';
    }

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.lineWidth = 2;
    ctx.strokeRect(panX, panY, mapData.width * scaledCellSize, mapData.height * scaledCellSize);
  }

  function handleMouseMove(e: MouseEvent) {
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const cell = screenToWorld(e.clientX, e.clientY);

    if (isRightMouseDown || e.buttons === 2) {
      const dx = e.clientX - lastMouseX;
      const dy = e.clientY - lastMouseY;
      uiStore.setPan(panX + dx, panY + dy);
      lastMouseX = e.clientX;
      lastMouseY = e.clientY;
      render();
      return;
    }

    if (cell.x !== lastCursorX || cell.y !== lastCursorY) {
      lastCursorX = cell.x;
      lastCursorY = cell.y;

      if (!cursorThrottleTimer) {
        cursorThrottleTimer = window.setTimeout(() => {
          wsClient.sendCursor(cell.x, cell.y);
          cursorThrottleTimer = null;
        }, 30);
      }
    }

    if (comparingPaths.length > 0 && cell.x >= 0 && cell.y >= 0 && cell.x < mapData.width && cell.y < mapData.height) {
      const paths = bookmarksStore.getPathsAtCell(cell.x, cell.y);
      if (paths.length >= 2) {
        showTooltip = true;
        tooltipPaths = paths;
        tooltipX = e.clientX;
        tooltipY = e.clientY;
        bookmarksStore.setCompareHoverCell(cell);
      } else {
        showTooltip = false;
        tooltipPaths = [];
        bookmarksStore.setCompareHoverCell(null);
      }
    } else {
      showTooltip = false;
      tooltipPaths = [];
      bookmarksStore.setCompareHoverCell(null);
    }

    if (isDrawing && drawStart) {
      uiStore.setDrawCurrent(cell);
      updatePreview(cell);
    } else if (!isDrawing) {
      updateHoverPreview(cell);
    }

    render();
  }

  function updateHoverPreview(cell: Cell) {
    if (layers[currentLayer].locked) {
      previewCells = [];
      return;
    }

    if (currentTool === 'brush' || currentTool === 'eraser') {
      previewCells = getBrushCells(cell.x, cell.y, brushSize, mapData.width, mapData.height);
    } else {
      previewCells = [];
    }
  }

  function updatePreview(cell: Cell) {
    if (!drawStart || layers[currentLayer].locked) {
      previewCells = [];
      return;
    }

    switch (currentTool) {
      case 'brush':
      case 'eraser':
        previewCells = getBrushCells(cell.x, cell.y, brushSize, mapData.width, mapData.height);
        break;
      case 'rect':
        previewCells = getRectCells(drawStart.x, drawStart.y, cell.x, cell.y, mapData.width, mapData.height);
        break;
      case 'circle':
        previewCells = getCircleCells(drawStart.x, drawStart.y, cell.x, cell.y, mapData.width, mapData.height);
        break;
      case 'line':
        previewCells = getLineCells(drawStart.x, drawStart.y, cell.x, cell.y, mapData.width, mapData.height, brushSize);
        break;
      default:
        previewCells = [];
    }
  }

  function handleMouseDown(e: MouseEvent) {
    if (e.button === 2) {
      isRightMouseDown = true;
      lastMouseX = e.clientX;
      lastMouseY = e.clientY;
      uiStore.setIsPanning(true);
      return;
    }

    if (e.button !== 0) return;

    const cell = screenToWorld(e.clientX, e.clientY);

    if (isPlaybackMode) {
      return;
    }

    if (isCompareMode && comparingPaths.length === 0) {
      return;
    }

    if (replayingBookmark) {
      bookmarksStore.replayBookmark(null);
      bookmarksStore.selectBookmark(null);
      pathfindingStore.setStartPoint(null);
      pathfindingStore.setEndPoint(null);
      pathfindingStore.clearPath();
      render();
      return;
    }

    if (isCompareMode) {
      return;
    }

    if (layers[currentLayer].locked) return;

    if (cell.x < 0 || cell.x >= mapData.width || cell.y < 0 || cell.y >= mapData.height) return;

    if ($pathfindingStore.isRunning) return;

    if (e.shiftKey) {
      if (!startPoint || (startPoint && endPoint)) {
        pathfindingStore.setStartPoint(cell);
        pathfindingStore.setEndPoint(null);
        pathfindingStore.clearPath();
      } else {
        pathfindingStore.setEndPoint(cell);
      }
      render();
      return;
    }

    isDragging = true;
    uiStore.setIsDrawing(true);
    uiStore.setDrawStart(cell);
    uiStore.setDrawCurrent(cell);

    if (currentTool === 'fill') {
      applyFill(cell);
    } else if (currentTool === 'brush' || currentTool === 'eraser') {
      applyDraw(cell);
    }

    updatePreview(cell);
    render();
  }

  function applyFill(cell: Cell) {
    if (layers[currentLayer].locked) return;

    const cells = getFloodFillCells(mapData, cell.x, cell.y, currentLayer);
    if (cells.length === 0) return;

    const value = currentTool === 'eraser'
      ? (currentLayer === LayerType.Terrain ? TerrainType.Walkable : false)
      : (currentLayer === LayerType.Obstacle ? true : currentTerrain);

    const cellOps = createCellOperations(cells, value, currentLayer, mapData);
    if (cellOps.length === 0) return;

    const op: Operation = {
      type: 'fill',
      layer: currentLayer,
      cells: cellOps,
    };

    mapStore.applyLocalOperation(op);
    wsClient.sendOperation(op);

    checkDStarReplanning(cellOps);
  }

  function applyDraw(cell: Cell) {
    if (layers[currentLayer].locked) return;

    const cells = getBrushCells(cell.x, cell.y, brushSize, mapData.width, mapData.height);
    if (cells.length === 0) return;

    const value = currentTool === 'eraser'
      ? (currentLayer === LayerType.Terrain ? TerrainType.Walkable : false)
      : (currentLayer === LayerType.Obstacle ? true : currentTerrain);

    const cellOps = createCellOperations(cells, value, currentLayer, mapData);
    if (cellOps.length === 0) return;

    const op: Operation = {
      type: 'draw',
      layer: currentLayer,
      cells: cellOps,
    };

    mapStore.applyLocalOperation(op);
    wsClient.sendOperation(op);

    checkDStarReplanning(cellOps);
  }

  function applyShape(endCell: Cell) {
    if (!drawStart || layers[currentLayer].locked) return;

    let cells: Cell[] = [];
    let opType = '';

    switch (currentTool) {
      case 'rect':
        cells = getRectCells(drawStart.x, drawStart.y, endCell.x, endCell.y, mapData.width, mapData.height);
        opType = 'rect';
        break;
      case 'circle':
        cells = getCircleCells(drawStart.x, drawStart.y, endCell.x, endCell.y, mapData.width, mapData.height);
        opType = 'circle';
        break;
      case 'line':
        cells = getLineCells(drawStart.x, drawStart.y, endCell.x, endCell.y, mapData.width, mapData.height, brushSize);
        opType = 'line';
        break;
      default:
        return;
    }

    if (cells.length === 0) return;

    const value = currentTool === 'eraser'
      ? (currentLayer === LayerType.Terrain ? TerrainType.Walkable : false)
      : (currentLayer === LayerType.Obstacle ? true : currentTerrain);

    const cellOps = createCellOperations(cells, value, currentLayer, mapData);
    if (cellOps.length === 0) return;

    const op: Operation = {
      type: opType,
      layer: currentLayer,
      cells: cellOps,
    };

    mapStore.applyLocalOperation(op);
    wsClient.sendOperation(op);

    checkDStarReplanning(cellOps);
  }

  async function checkDStarReplanning(cellOps: CellOp[]) {
    const planner = $pathfindingStore.dstarlitePlanner;
    const start = $pathfindingStore.startPoint;
    const end = $pathfindingStore.endPoint;

    if (!planner || !start || !end) return;
    if ($pathfindingStore.selectedAlgorithm !== 'dstarlite') return;

    const changedCells: Cell[] = cellOps.map(op => ({ x: op.x, y: op.y }));

    dstarAffectedCells = new Set(changedCells.map(c => cellKey(c.x, c.y)));
    for (const c of changedCells) {
      const neighbors = [
        { x: c.x + 1, y: c.y },
        { x: c.x - 1, y: c.y },
        { x: c.x, y: c.y + 1 },
        { x: c.x, y: c.y - 1 },
      ];
      neighbors.forEach(n => dstarAffectedCells.add(cellKey(n.x, n.y)));
    }

    const flashInterval = setInterval(render, 50);

    try {
      planner.updateMap(mapData);
      const result = await planner.replan(
        changedCells,
        start,
        end,
        (visited, openSet, current, affected) => {
          pathfindingStore.setSearchState({
            visited,
            openSet,
            current,
            path: [],
            exploredCount: 0,
            totalCost: 0,
            pathLength: 0,
            timeMs: 0,
            completed: false,
          });
          render();
        },
        0
      );

      pathfindingStore.setResults(result);
      pathfindingStore.setSearchState(null);
    } finally {
      clearInterval(flashInterval);
      setTimeout(() => {
        dstarAffectedCells = new Set();
        render();
      }, 1000);
    }
  }

  function handleMouseUp(e: MouseEvent) {
    if (e.button === 2) {
      isRightMouseDown = false;
      uiStore.setIsPanning(false);
      return;
    }

    if (e.button !== 0) return;

    if (isDragging && drawStart && drawCurrent) {
      if (currentTool !== 'brush' && currentTool !== 'eraser' && currentTool !== 'fill') {
        applyShape(drawCurrent);
      }
    }

    isDragging = false;
    uiStore.setIsDrawing(false);
    uiStore.setDrawStart(null);
    uiStore.setDrawCurrent(null);
    previewCells = [];
    render();
  }

  function handleWheel(e: WheelEvent) {
    e.preventDefault();
    e.stopPropagation();

    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const newZoom = clamp(zoom * delta, 0.25, 4);

    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const worldX = (mouseX - panX) / (cellSize * zoom);
    const worldY = (mouseY - panY) / (cellSize * zoom);

    const newPanX = mouseX - worldX * cellSize * newZoom;
    const newPanY = mouseY - worldY * cellSize * newZoom;

    uiStore.setZoom(newZoom);
    uiStore.setPan(newPanX, newPanY);
    render();
  }

  function handleContextMenu(e: MouseEvent) {
    e.preventDefault();
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

    if (e.key === 'z' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      if (e.shiftKey) {
        mapStore.redo();
      } else {
        mapStore.undo();
      }
    }

    if (e.key === 'y' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      mapStore.redo();
    }

    if (e.key === 'Escape') {
      pathfindingStore.clearPath();
    }

    if (e.key === '1') uiStore.setCurrentTool('brush');
    if (e.key === '2') uiStore.setCurrentTool('eraser');
    if (e.key === '3') uiStore.setCurrentTool('rect');
    if (e.key === '4') uiStore.setCurrentTool('circle');
    if (e.key === '5') uiStore.setCurrentTool('line');
    if (e.key === '6') uiStore.setCurrentTool('fill');

    if (e.key === 'g') uiStore.setShowGrid(!showGrid);
  }

  function animate() {
    render();
    animationFrame = requestAnimationFrame(animate);
  }

  onMount(() => {
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    window.addEventListener('keydown', handleKeyDown);
    animate();

    const rect = container.getBoundingClientRect();
    uiStore.setPan(
      (rect.width - mapData.width * cellSize * zoom) / 2,
      (rect.height - mapData.height * cellSize * zoom) / 2
    );
  });

  onDestroy(() => {
    window.removeEventListener('resize', resizeCanvas);
    window.removeEventListener('keydown', handleKeyDown);
    cancelAnimationFrame(animationFrame);
    if (cursorThrottleTimer) clearTimeout(cursorThrottleTimer);
  });

  afterUpdate(() => {
    render();
  });
</script>

<div bind:this={container} class="canvas-wrapper w-full h-full relative">
  <canvas
    bind:this={canvas}
    on:mousedown={handleMouseDown}
    on:mousemove={handleMouseMove}
    on:mouseup={handleMouseUp}
    on:mouseleave={() => { showTooltip = false; handleMouseUp(new MouseEvent('mouseup')); }}
    on:wheel={handleWheel}
    on:contextmenu={handleContextMenu}
    class={isPanning ? 'cursor-grabbing' : 'cursor-crosshair'}
  />

  {#if showTooltip && tooltipPaths.length > 0}
    <div
      class="fixed z-50 bg-[#16162a] border border-[#3d3d54] rounded-lg shadow-xl p-3 pointer-events-none"
      style="left: {tooltipX + 15}px; top: {tooltipY + 15}px; max-width: 250px;"
    >
      <div class="text-xs font-semibold text-[#f39c12] mb-2">该格子被 {tooltipPaths.length} 条路径经过:</div>
      <div class="space-y-1">
        {#each tooltipPaths as pathInfo (pathInfo.bookmark.id)}
          <div class="flex items-center gap-2 text-xs">
            <span class="w-3 h-3 rounded-full flex-shrink-0" style="background: {pathInfo.color}"></span>
            <span class="truncate text-[#e0e0e0]">{pathInfo.bookmark.name}</span>
            <span class="text-[#3498db] ml-auto">{pathInfo.bookmark.algorithm.toUpperCase()}</span>
          </div>
        {/each}
      </div>
    </div>
  {/if}

  <div class="canvas-hud absolute bottom-4 left-4 flex gap-2 text-xs text-muted">
    <span class="badge badge-info">缩放: {Math.round(zoom * 100)}%</span>
    <span class="badge badge-success">按住Shift点击设置起点/终点</span>
    <span class="badge badge-warning">右键拖拽平移</span>
    <span class="badge badge-danger">滚轮缩放</span>
  </div>

  {#if lastCursorX >= 0 && lastCursorY >= 0}
    <div class="absolute top-4 right-4 bg-[#16162a]/90 px-3 py-2 rounded-lg text-xs font-mono">
      X: {lastCursorX}, Y: {lastCursorY}
    </div>
  {/if}
</div>

<style>
  .canvas-wrapper {
    cursor: crosshair;
    user-select: none;
  }

  .canvas-wrapper canvas {
    display: block;
    image-rendering: pixelated;
    image-rendering: crisp-edges;
  }

  .cursor-grabbing {
    cursor: grabbing !important;
  }

  .cursor-crosshair {
    cursor: crosshair;
  }
</style>
