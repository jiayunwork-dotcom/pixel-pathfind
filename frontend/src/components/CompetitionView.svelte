<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte';
  import { pathfindingStore, mapStore, uiStore } from '../store';
  import {
    bfs,
    dijkstra,
    astar,
    jps,
    thetastar,
  } from '../pathfinding/algorithms';
  import type {
    AlgorithmType,
    Cell,
    AlgorithmResult,
    SearchState,
    MapData,
  } from '../types';
  import { cellKey, getTile, hasUniformCost } from '../utils';
  import { TerrainType, LayerType, TerrainColors } from '../types';
  import { TerrainCost } from '../types';

  interface AlgorithmState {
    algorithm: AlgorithmType;
    label: string;
    color: string;
    searchState: SearchState | null;
    result: AlgorithmResult | null;
    isRunning: boolean;
    isPaused: boolean;
    shouldStop: boolean;
    stepCount: number;
  }

  let states: AlgorithmState[] = [];
  let isRunning = false;
  let isPaused = false;
  let shouldStop = false;
  let animationSpeed = 50;
  let unifiedStep = 0;
  let maxSteps = 0;
  let canvasRefs: Record<string, HTMLCanvasElement | null> = {};
  let allCompleted = false;

  const algorithmColors: Record<AlgorithmType, string> = {
    bfs: '#3498db',
    dijkstra: '#2ecc71',
    astar: '#9b59b6',
    jps: '#f39c12',
    thetastar: '#e74c3c',
    dstarlite: '#1abc9c',
  };

  const algorithmLabels: Record<AlgorithmType, string> = {
    bfs: 'BFS',
    dijkstra: 'Dijkstra',
    astar: 'A*',
    jps: 'JPS',
    thetastar: 'Theta*',
    dstarlite: 'D*Lite',
  };

  $: competitionAlgorithms = $pathfindingStore.competitionAlgorithms;
  $: startPoint = $pathfindingStore.startPoint;
  $: endPoint = $pathfindingStore.endPoint;
  $: mapData = $mapStore.mapData;
  $: zoom = $uiStore.zoom;
  $: panX = $uiStore.panX;
  $: panY = $uiStore.panY;
  $: showGrid = $uiStore.showGrid;

  $: {
    states = competitionAlgorithms.map((algo) => ({
      algorithm: algo,
      label: algorithmLabels[algo],
      color: algorithmColors[algo],
      searchState: null,
      result: null,
      isRunning: false,
      isPaused: false,
      shouldStop: false,
      stepCount: 0,
    }));
    allCompleted = false;
    unifiedStep = 0;
  }

  $: results = states
    .filter((s) => s.result)
    .map((s) => ({
      algorithm: s.algorithm,
      label: s.label,
      color: s.color,
      ...s.result!,
    }));

  $: winners = getWinners(results);

  function getWinners(results: any[]) {
    if (results.length === 0) return { path: null, explored: null };

    const valid = results.filter((r) => r.path.length > 0 && !r.timeout);
    if (valid.length === 0) return { path: null, explored: null };

    const minPathLength = Math.min(...valid.map((r) => r.pathLength));
    const minExplored = Math.min(...valid.map((r) => r.exploredCount));

    return {
      path: valid.filter((r) => r.pathLength === minPathLength),
      explored: valid.filter((r) => r.exploredCount === minExplored),
    };
  }

  function isWinner(algo: AlgorithmType, category: 'path' | 'explored') {
    return winners[category]?.some((w: any) => w.algorithm === algo);
  }

  function getRowClass(algo: AlgorithmType) {
    const base = 'border-b border-[#2d2d44]/50 hover:bg-[#2d2d44]/50';
    if (isWinner(algo, 'path') || isWinner(algo, 'explored')) {
      return `${base} winner-row`;
    }
    return base;
  }

  async function startCompetition() {
    if (!startPoint || !endPoint) {
      uiStore.showToast('请先设置起点和终点');
      return;
    }

    if (competitionAlgorithms.length < 2) {
      uiStore.showToast('请至少选择2种算法');
      return;
    }

    shouldStop = false;
    isPaused = false;
    isRunning = true;
    allCompleted = false;
    unifiedStep = 0;
    maxSteps = 0;

    states = states.map((s) => ({
      ...s,
      searchState: null,
      result: null,
      isRunning: true,
      isPaused: false,
      shouldStop: false,
      stepCount: 0,
    }));

    const promises = states.map((state, index) =>
      runAlgorithmWithSync(state, index)
    );

    try {
      await Promise.all(promises);
    } finally {
      isRunning = false;
      allCompleted = true;
      states = states.map((s) => ({ ...s, isRunning: false }));
    }
  }

  async function runAlgorithmWithSync(state: AlgorithmState, index: number) {
    const algo = state.algorithm;
    const map = mapData;
    const start = startPoint!;
    const end = endPoint!;

    const onStep = (visited: Set<string>, openSet: Set<string>, current: Cell | null) => {
      const searchState: SearchState = {
        visited: new Set(visited),
        openSet: new Set(openSet),
        current,
        path: [],
        exploredCount: visited.size,
        totalCost: 0,
        pathLength: 0,
        timeMs: performance.now(),
        completed: false,
      };

      states[index].searchState = searchState;
      states[index].stepCount++;

      if (states[index].stepCount > maxSteps) {
        maxSteps = states[index].stepCount;
      }

      while (isPaused && !state.shouldStop) {
        return new Promise((resolve) => setTimeout(resolve, 50));
      }
    };

    const shouldStopFn = () => state.shouldStop || shouldStop;
    const isPausedFn = () => isPaused;

    try {
      let result: AlgorithmResult;
      const startTime = performance.now();

      switch (algo) {
        case 'bfs':
          result = await bfs(map, start, end, onStep, animationSpeed, 5000, shouldStopFn, isPausedFn);
          break;
        case 'dijkstra':
          result = await dijkstra(map, start, end, onStep, animationSpeed, 5000, shouldStopFn, isPausedFn);
          break;
        case 'astar':
          result = await astar(map, start, end, 'manhattan', 1, onStep, animationSpeed, 5000, shouldStopFn, isPausedFn);
          break;
        case 'jps':
          if (!hasUniformCost(map)) {
            result = await astar(map, start, end, 'manhattan', 1, onStep, animationSpeed, 5000, shouldStopFn, isPausedFn);
          } else {
            result = await jps(map, start, end, onStep, animationSpeed, 5000, shouldStopFn, isPausedFn);
          }
          break;
        case 'thetastar':
          result = await thetastar(map, start, end, onStep, animationSpeed, 5000, shouldStopFn, isPausedFn);
          break;
        default:
          throw new Error('不支持的算法');
      }

      const endTime = performance.now();
      result.timeMs = Math.round(endTime - startTime);
      result.algorithm = algo;

      states[index].result = result;
      states[index].searchState = {
        visited: states[index].searchState?.visited || new Set(),
        openSet: new Set(),
        current: null,
        path: result.path,
        exploredCount: result.exploredCount,
        totalCost: result.totalCost,
        pathLength: result.pathLength,
        timeMs: result.timeMs,
        completed: true,
        timeout: result.timeout,
      };

      pathfindingStore.setCompetitionResult(algo, result);
    } catch (e) {
      console.error('算法运行错误:', e);
      uiStore.showToast(`${algorithmLabels[algo]} 运行错误: ${(e as Error).message}`);
    } finally {
      states[index].isRunning = false;
    }
  }

  function renderCanvas(canvas: HTMLCanvasElement | null, state: AlgorithmState) {
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const cellSize = Math.min(rect.width / mapData.width, rect.height / mapData.height);
    const offsetX = (rect.width - mapData.width * cellSize) / 2;
    const offsetY = (rect.height - mapData.height * cellSize) / 2;

    ctx.fillStyle = '#0d0d1a';
    ctx.fillRect(0, 0, rect.width, rect.height);

    for (let y = 0; y < mapData.height; y++) {
      for (let x = 0; x < mapData.width; x++) {
        const tile = getTile(mapData, x, y);
        const key = cellKey(x, y);

        let color = TerrainColors[tile.terrain];
        if (tile.obstacle) color = '#2c3e50';

        if (state.searchState?.visited.has(key)) {
          color = '#3498db';
        }
        if (state.searchState?.openSet.has(key)) {
          color = '#2ecc71';
        }

        ctx.fillStyle = color;
        ctx.fillRect(
          offsetX + x * cellSize,
          offsetY + y * cellSize,
          cellSize,
          cellSize
        );

        if (showGrid && cellSize > 4) {
          ctx.strokeStyle = 'rgba(255,255,255,0.1)';
          ctx.lineWidth = 0.5;
          ctx.strokeRect(
            offsetX + x * cellSize,
            offsetY + y * cellSize,
            cellSize,
            cellSize
          );
        }
      }
    }

    if (state.searchState?.path && state.searchState.path.length > 1) {
      ctx.strokeStyle = state.color;
      ctx.lineWidth = Math.max(2, cellSize * 0.3);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(
        offsetX + state.searchState.path[0].x * cellSize + cellSize / 2,
        offsetY + state.searchState.path[0].y * cellSize + cellSize / 2
      );
      for (let i = 1; i < state.searchState.path.length; i++) {
        ctx.lineTo(
          offsetX + state.searchState.path[i].x * cellSize + cellSize / 2,
          offsetY + state.searchState.path[i].y * cellSize + cellSize / 2
        );
      }
      ctx.stroke();
    }

    if (startPoint) {
      ctx.fillStyle = '#27ae60';
      ctx.beginPath();
      ctx.arc(
        offsetX + startPoint.x * cellSize + cellSize / 2,
        offsetY + startPoint.y * cellSize + cellSize / 2,
        cellSize * 0.4,
        0,
        Math.PI * 2
      );
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = `${cellSize * 0.5}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('S', offsetX + startPoint.x * cellSize + cellSize / 2, offsetY + startPoint.y * cellSize + cellSize / 2);
    }

    if (endPoint) {
      ctx.fillStyle = '#e74c3c';
      ctx.beginPath();
      ctx.arc(
        offsetX + endPoint.x * cellSize + cellSize / 2,
        offsetY + endPoint.y * cellSize + cellSize / 2,
        cellSize * 0.4,
        0,
        Math.PI * 2
      );
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = `${cellSize * 0.5}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('E', offsetX + endPoint.x * cellSize + cellSize / 2, offsetY + endPoint.y * cellSize + cellSize / 2);
    }
  }

  function renderAllCanvases() {
    states.forEach((state) => {
      const canvas = canvasRefs[state.algorithm];
      renderCanvas(canvas, state);
    });
  }

  $: {
    states;
    tick().then(() => {
      renderAllCanvases();
    });
  }

  function togglePause() {
    isPaused = !isPaused;
  }

  function stopCompetition() {
    shouldStop = true;
    states.forEach((state) => {
      state.shouldStop = true;
    });
  }

  function exitCompetition() {
    stopCompetition();
    pathfindingStore.setCompetitionMode(false);
    pathfindingStore.clearCompetitionResults();
  }

  function setCanvasRef(algo: string, element: any) {
    canvasRefs[algo] = element as HTMLCanvasElement;
    if (element) {
      const state = states.find((s) => s.algorithm === algo);
      if (state) {
        renderCanvas(element as HTMLCanvasElement, state);
      }
    }
  }

  function getGridClass() {
    const count = states.length;
    if (count <= 2) return 'grid-cols-2';
    if (count <= 4) return 'grid-cols-2 grid-rows-2';
    return 'grid-cols-2';
  }

  $: {
    if (states.length > 0) {
      tick().then(() => renderAllCanvases());
    }
  }

  let resizeObserver: ResizeObserver | null = null;

  onMount(() => {
    resizeObserver = new ResizeObserver(() => {
      renderAllCanvases();
    });

    Object.values(canvasRefs).forEach((canvas) => {
      if (canvas) {
        resizeObserver?.observe(canvas);
      }
    });

    const animationLoop = () => {
      renderAllCanvases();
      requestAnimationFrame(animationLoop);
    };
    animationLoop();
  });

  onDestroy(() => {
    stopCompetition();
    resizeObserver?.disconnect();
  });
</script>

<div class="competition-view h-full flex flex-col">
  <div class="flex items-center justify-between p-4 bg-[#16162a] border-b border-[#2d2d44]">
    <div class="flex items-center gap-4">
      <h2 class="text-lg font-bold text-[#f39c12]">🏆 算法竞赛模式</h2>
      <span class="text-sm text-muted">
        {states.length} 种算法对比
      </span>
      {#if isRunning}
        <span class="text-xs bg-[#27ae60] text-white px-2 py-1 rounded-full animate-pulse">
          运行中... 步数: {maxSteps}
        </span>
      {/if}
      {#if allCompleted}
        <span class="text-xs bg-[#f39c12] text-white px-2 py-1 rounded-full">
          已完成
        </span>
      {/if}
    </div>

    <div class="flex items-center gap-2">
      {#if !isRunning && !allCompleted}
        <button
          on:click={startCompetition}
          class="px-4 py-2 rounded bg-[#f39c12] hover:bg-[#e08e0b] text-white font-semibold text-sm disabled:opacity-50"
          disabled={!startPoint || !endPoint || states.length < 2}
        >
          开始竞赛
        </button>
      {:else if isRunning}
        <button
          on:click={togglePause}
          class="px-4 py-2 rounded bg-[#3498db] hover:bg-[#2980b9] text-white font-semibold text-sm"
        >
          {isPaused ? '继续' : '暂停'}
        </button>
        <button
          on:click={stopCompetition}
          class="px-4 py-2 rounded bg-[#e74c3c] hover:bg-[#c0392b] text-white font-semibold text-sm"
        >
          停止
        </button>
      {/if}
      {#if allCompleted}
        <button
          on:click={startCompetition}
          class="px-4 py-2 rounded bg-[#27ae60] hover:bg-[#2ecc71] text-white font-semibold text-sm"
        >
          重新运行
        </button>
      {/if}
      <button
        on:click={exitCompetition}
        class="px-4 py-2 rounded bg-[#2d2d44] hover:bg-[#3d3d54] text-sm"
      >
        退出竞赛
      </button>
    </div>
  </div>

  <div class="flex-1 flex overflow-hidden">
    <div class="flex-1 p-4 overflow-hidden">
      <div class="h-full grid {getGridClass()} gap-4">
        {#each states as state (state.algorithm)}
          <div class="competition-canvas-container flex flex-col bg-[#0d0d1a] rounded-lg overflow-hidden border border-[#2d2d44]">
            <div
              class="flex items-center justify-between px-3 py-2 text-sm"
              style="background-color: {state.color}20; border-bottom: 2px solid {state.color};"
            >
              <div class="flex items-center gap-2">
                <div
                  class="w-3 h-3 rounded-full"
                  style="background-color: {state.color};"
                ></div>
                <span class="font-bold" style="color: {state.color};">
                  {state.label}
                </span>
                {#if isWinner(state.algorithm, 'path')}
                  <span class="text-xs bg-[#f39c12] text-white px-1.5 py-0.5 rounded">
                    路径最短
                  </span>
                {/if}
                {#if isWinner(state.algorithm, 'explored')}
                  <span class="text-xs bg-[#9b59b6] text-white px-1.5 py-0.5 rounded">
                    探索最少
                  </span>
                {/if}
              </div>
              {#if state.isRunning}
                <span class="text-xs text-muted animate-pulse">
                  步数: {state.stepCount}
                </span>
              {:else if state.result}
                <span class="text-xs text-muted">
                  {state.result.timeout ? '⚠️ 超时' : state.result.path.length === 0 ? '❌ 无路径' : '✅ 完成'}
                </span>
              {/if}
            </div>
            <div class="flex-1 relative">
              <canvas
                use:setCanvasRef={state.algorithm}
                class="w-full h-full"
              ></canvas>
            </div>
            {#if state.result}
              <div class="px-3 py-2 bg-[#16162a] grid grid-cols-4 gap-2 text-xs">
                <div class="text-center">
                  <div class="text-muted">探索</div>
                  <div class="font-bold text-[#f39c12]">{state.result.exploredCount}</div>
                </div>
                <div class="text-center">
                  <div class="text-muted">长度</div>
                  <div class="font-bold text-[#2ecc71]">{state.result.pathLength}</div>
                </div>
                <div class="text-center">
                  <div class="text-muted">代价</div>
                  <div class="font-bold text-[#3498db]">{state.result.totalCost.toFixed(1)}</div>
                </div>
                <div class="text-center">
                  <div class="text-muted">耗时</div>
                  <div class="font-bold text-[#9b59b6]">{state.result.timeMs}ms</div>
                </div>
              </div>
            {/if}
          </div>
        {/each}
      </div>
    </div>

    {#if results.length > 0}
      <div class="w-80 p-4 bg-[#16162a] border-l border-[#2d2d44] overflow-y-auto">
        <h3 class="font-bold text-[#4a9eff] mb-3">性能对比</h3>

        <div class="overflow-x-auto">
          <table class="w-full text-xs">
            <thead>
              <tr class="border-b border-[#2d2d44]">
                <th class="text-left py-2 text-muted">算法</th>
                <th class="text-right py-2 text-muted">探索节点</th>
                <th class="text-right py-2 text-muted">路径长度</th>
                <th class="text-right py-2 text-muted">总代价</th>
                <th class="text-right py-2 text-muted">耗时</th>
              </tr>
            </thead>
            <tbody>
              {#each results as result (result.algorithm)}
                <tr class={getRowClass(result.algorithm)}>
                  <td class="py-2">
                    <div class="flex items-center gap-2">
                      <div
                        class="w-3 h-3 rounded-full"
                        style="background-color: {result.color};"
                      ></div>
                      <span style="color: {result.color};" class="font-semibold">
                        {result.label}
                      </span>
                    </div>
                  </td>
                  <td class="text-right py-2 font-mono">
                    <span class:font-bold={isWinner(result.algorithm, 'explored')}>
                      {result.exploredCount.toLocaleString()}
                    </span>
                    {#if isWinner(result.algorithm, 'explored')}
                      <span class="ml-1 text-[#9b59b6]">👑</span>
                    {/if}
                  </td>
                  <td class="text-right py-2 font-mono">
                    <span class:font-bold={isWinner(result.algorithm, 'path')}>
                      {result.pathLength}
                    </span>
                    {#if isWinner(result.algorithm, 'path')}
                      <span class="ml-1 text-[#f39c12]">👑</span>
                    {/if}
                  </td>
                  <td class="text-right py-2 font-mono">
                    {result.totalCost.toFixed(2)}
                  </td>
                  <td class="text-right py-2 font-mono">
                    {result.timeMs}ms
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>

        <div class="mt-4 p-3 bg-[#0d0d1a] rounded-lg">
          <h4 class="text-sm font-semibold mb-2 text-[#f39c12]">🏆 获胜者</h4>
          {#if winners.path && winners.path.length > 0}
            <div class="text-xs mb-2">
              <span class="text-muted">最短路径: </span>
              {#each winners.path as winner (winner.algorithm)}
                <span style="color: {winner.color};" class="font-semibold">
                  {winner.label}
                </span>
                {#if winners.path.indexOf(winner) < winners.path.length - 1}
                  <span class="text-muted">, </span>
                {/if}
              {/each}
              <span class="text-muted"> ({winners.path[0].pathLength} 格)</span>
            </div>
          {/if}
          {#if winners.explored && winners.explored.length > 0}
            <div class="text-xs">
              <span class="text-muted">最少探索: </span>
              {#each winners.explored as winner (winner.algorithm)}
                <span style="color: {winner.color};" class="font-semibold">
                  {winner.label}
                </span>
                {#if winners.explored.indexOf(winner) < winners.explored.length - 1}
                  <span class="text-muted">, </span>
                {/if}
              {/each}
              <span class="text-muted"> ({winners.explored[0].exploredCount.toLocaleString()} 节点)</span>
            </div>
          {/if}
          {#if !winners.path && !winners.explored}
            <div class="text-xs text-muted">
              暂无有效结果
            </div>
          {/if}
        </div>

        <div class="mt-4 p-3 bg-[#1a1a2e] rounded-lg border border-[#2d2d44]">
          <h4 class="text-sm font-semibold mb-2 text-[#4a9eff]">图例说明</h4>
          <div class="space-y-1 text-xs">
            <div class="flex items-center gap-2">
              <div class="w-4 h-4 rounded" style="background-color: #3498db;"></div>
              <span class="text-muted">已探索节点</span>
            </div>
            <div class="flex items-center gap-2">
              <div class="w-4 h-4 rounded" style="background-color: #2ecc71;"></div>
              <span class="text-muted">待探索节点 (Open List)</span>
            </div>
            <div class="flex items-center gap-2">
              <div class="w-4 h-1 rounded" style="background-color: #f39c12;"></div>
              <span class="text-muted">最终路径</span>
            </div>
          </div>
        </div>
      </div>
    {/if}
  </div>
</div>

<style>
  .competition-canvas-container {
    min-height: 0;
  }

  canvas {
    image-rendering: pixelated;
    image-rendering: crisp-edges;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }

  .animate-pulse {
    animation: pulse 2s ease-in-out infinite;
  }

  .winner-row {
    background-color: rgba(243, 156, 18, 0.1);
  }
</style>
