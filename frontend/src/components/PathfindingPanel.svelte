<script lang="ts">
  import { pathfindingStore, mapStore, uiStore, bookmarksStore } from '../store';
  import { wsClient } from '../websocket';
  import { hasUniformCost } from '../utils';
  import {
    bfs,
    dijkstra,
    astar,
    jps,
    thetastar,
    DStarLitePlanner,
  } from '../pathfinding/algorithms';
  import type {
    AlgorithmType,
    HeuristicType,
    Cell,
    AlgorithmResult,
    SearchState,
    PathBookmark,
  } from '../types';

  let animationFrameId: number | null = null;
  let isPaused = false;
  let shouldStop = false;

  const algorithms: { value: AlgorithmType; label: string; description: string }[] = [
    { value: 'bfs', label: 'BFS', description: '广度优先，不考虑代价' },
    { value: 'dijkstra', label: 'Dijkstra', description: '考虑地形代价最短路径' },
    { value: 'astar', label: 'A*', description: '启发式搜索，支持多种启发函数' },
    { value: 'jps', label: 'JPS', description: '跳点搜索，无代价差异时高效' },
    { value: 'thetastar', label: 'Theta*', description: '任意角度路径，视线检测' },
    { value: 'dstarlite', label: 'D*Lite', description: '动态重规划，增量更新' },
  ];

  const heuristics: { value: HeuristicType; label: string }[] = [
    { value: 'manhattan', label: '曼哈顿距离' },
    { value: 'euclidean', label: '欧几里得距离' },
    { value: 'diagonal', label: '对角线距离' },
    { value: 'chebyshev', label: '切比雪夫距离' },
  ];

  $: selectedAlgorithm = $pathfindingStore.selectedAlgorithm;
  $: heuristic = $pathfindingStore.heuristic;
  $: heuristicWeight = $pathfindingStore.heuristicWeight;
  $: animationSpeed = $pathfindingStore.animationSpeed;
  $: startPoint = $pathfindingStore.startPoint;
  $: endPoint = $pathfindingStore.endPoint;
  $: isRunning = $pathfindingStore.isRunning;
  $: searchState = $pathfindingStore.searchState;
  $: results = $pathfindingStore.results;
  $: jpsAvailable = $pathfindingStore.jpsAvailable;
  $: competitionMode = $pathfindingStore.competitionMode;
  $: competitionAlgorithms = $pathfindingStore.competitionAlgorithms;

  function selectAlgorithm(algo: AlgorithmType) {
    if (algo === 'jps' && !jpsAvailable) {
      uiStore.showToast('当前地图含多种地形代价，JPS不适用，已自动切换为A*');
      pathfindingStore.setSelectedAlgorithm('astar');
      return;
    }
    pathfindingStore.setSelectedAlgorithm(algo);
  }

  function setHeuristic(h: HeuristicType) {
    pathfindingStore.setHeuristic(h);
  }

  function setHeuristicWeight(w: number) {
    pathfindingStore.setHeuristicWeight(w);
  }

  function setAnimationSpeed(speed: number) {
    pathfindingStore.setAnimationSpeed(speed);
  }

  function handleHeuristicChange(e: Event) {
    const target = e.target as HTMLSelectElement;
    setHeuristic(target.value as HeuristicType);
  }

  function handleHeuristicWeightInput(e: Event) {
    const target = e.target as HTMLInputElement;
    setHeuristicWeight(Number(target.value));
  }

  function handleAnimationSpeedInput(e: Event) {
    const target = e.target as HTMLInputElement;
    setAnimationSpeed(Number(target.value));
  }

  function clearPath() {
    shouldStop = true;
    if (animationFrameId) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
    pathfindingStore.clearPath();
    pathfindingStore.setDStarLitePlanner(null);
  }

  function setPointMode(mode: 'start' | 'end') {
    if (mode === 'start') {
      uiStore.setCurrentTool('set-start');
    } else {
      uiStore.setCurrentTool('set-end');
    }
  }

  function clearPoints() {
    pathfindingStore.setStartPoint(null);
    pathfindingStore.setEndPoint(null);
    clearPath();
  }

  async function runAlgorithm() {
    if (!startPoint || !endPoint) {
      uiStore.showToast('请先设置起点和终点');
      return;
    }

    if (selectedAlgorithm === 'jps' && !hasUniformCost($mapStore.mapData)) {
      uiStore.showToast('当前地图含多种地形代价，JPS不适用，已自动切换为A*');
      pathfindingStore.setSelectedAlgorithm('astar');
    }

    clearPath();
    shouldStop = false;
    isPaused = false;
    pathfindingStore.setIsRunning(true);

    const mapData = $mapStore.mapData;
    const stepDelay = animationSpeed;

    const onStep = (visited: Set<string>, openSet: Set<string>, current: Cell | null) => {
      const state: SearchState = {
        visited,
        openSet,
        current,
        path: [],
        exploredCount: visited.size,
        totalCost: 0,
        pathLength: 0,
        timeMs: performance.now(),
        completed: false,
      };
      pathfindingStore.setSearchState(state);
    };

    try {
      let result: AlgorithmResult;
      const startTime = performance.now();

      switch (selectedAlgorithm) {
        case 'bfs':
          result = await bfs(mapData, startPoint, endPoint, onStep, stepDelay, 5000, () => shouldStop, () => isPaused);
          break;
        case 'dijkstra':
          result = await dijkstra(mapData, startPoint, endPoint, onStep, stepDelay, 5000, () => shouldStop, () => isPaused);
          break;
        case 'astar':
          result = await astar(mapData, startPoint, endPoint, heuristic, heuristicWeight, onStep, stepDelay, 5000, () => shouldStop, () => isPaused);
          break;
        case 'jps':
          result = await jps(mapData, startPoint, endPoint, onStep, stepDelay, 5000, () => shouldStop, () => isPaused);
          break;
        case 'thetastar':
          result = await thetastar(mapData, startPoint, endPoint, onStep, stepDelay, 5000, () => shouldStop, () => isPaused);
          break;
        case 'dstarlite':
          const planner = new DStarLitePlanner(mapData, heuristic);
          pathfindingStore.setDStarLitePlanner(planner);
          result = await planner.plan(startPoint, endPoint, onStep, stepDelay, 5000, () => shouldStop, () => isPaused);
          break;
        default:
          throw new Error('未知算法');
      }

      const endTime = performance.now();
      result.timeMs = Math.round(endTime - startTime);

      if (result.timeout) {
        uiStore.showToast('计算超时');
      }

      pathfindingStore.setResults(result);

      const finalState: SearchState = {
        visited: searchState?.visited || new Set(),
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
      pathfindingStore.setSearchState(finalState);
    } catch (e) {
      console.error('算法运行错误:', e);
      uiStore.showToast('算法运行错误: ' + (e as Error).message);
    } finally {
      pathfindingStore.setIsRunning(false);
    }
  }

  function togglePause() {
    isPaused = !isPaused;
    pathfindingStore.setIsPaused(isPaused);
  }

  function stepOnce() {
    if (isPaused) {
      isPaused = false;
      setTimeout(() => {
        isPaused = true;
        pathfindingStore.setIsPaused(true);
      }, 16);
    }
  }

  function skipToEnd() {
    pathfindingStore.setAnimationSpeed(1);
  }

  function toggleCompetitionMode() {
    pathfindingStore.setCompetitionMode(!competitionMode);
    clearPath();
  }

  function toggleCompetitionAlgorithm(algo: AlgorithmType) {
    const current = [...competitionAlgorithms];
    const index = current.indexOf(algo);
    if (index > -1) {
      current.splice(index, 1);
    } else if (current.length < 4) {
      current.push(algo);
    } else {
      uiStore.showToast('最多选择4种算法');
      return;
    }
    pathfindingStore.setCompetitionAlgorithms(current);
  }

  function startCompetition() {
    if (competitionAlgorithms.length < 2) {
      uiStore.showToast('请至少选择2种算法');
      return;
    }
    if (!startPoint || !endPoint) {
      uiStore.showToast('请先设置起点和终点');
      return;
    }
    pathfindingStore.clearCompetitionResults();
  }

  function saveBookmark() {
    if (!results || !startPoint || !endPoint) {
      uiStore.showToast('请先运行寻路算法');
      return;
    }

    if (results.path.length === 0) {
      uiStore.showToast('未找到路径，无法保存');
      return;
    }

    const bookmarkName = prompt('请输入书签名称:', `路径 ${new Date().toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}`);
    if (!bookmarkName || !bookmarkName.trim()) {
      return;
    }

    const bookmark: Omit<PathBookmark, 'id' | 'createdBy' | 'createdByName' | 'createdAt'> = {
      name: bookmarkName.trim(),
      algorithm: selectedAlgorithm,
      startPoint,
      endPoint,
      path: results.path,
      exploredCount: results.exploredCount,
      totalCost: results.totalCost,
      pathLength: results.pathLength,
      timeMs: results.timeMs,
    };

    wsClient.addBookmark(bookmark);
    uiStore.showToast('书签已保存');
  }
</script>

<div class="panel p-4 mb-4">
  <div class="panel-header flex items-center justify-between mb-3">
    <h3 class="font-bold text-[#4a9eff]">寻路算法</h3>
    <button
      on:click={toggleCompetitionMode}
      class="text-xs px-2 py-1 rounded {competitionMode ? 'bg-[#f39c12] text-white' : 'bg-[#2d2d44] hover:bg-[#3d3d54]'}"
    >
      {competitionMode ? '退出竞赛' : '竞赛模式'}
    </button>
  </div>

  {#if !competitionMode}
    <div class="mb-4">
      <div class="flex gap-2 mb-3">
        <button
          on:click={() => setPointMode('start')}
          class="flex-1 text-xs py-2 rounded bg-[#27ae60] hover:bg-[#2ecc71] text-white"
          disabled={isRunning}
        >
          设置起点
        </button>
        <button
          on:click={() => setPointMode('end')}
          class="flex-1 text-xs py-2 rounded bg-[#e74c3c] hover:bg-[#c0392b] text-white"
          disabled={isRunning}
        >
          设置终点
        </button>
        <button
          on:click={clearPoints}
          class="text-xs px-3 py-2 rounded bg-[#2d2d44] hover:bg-[#3d3d54]"
          disabled={isRunning}
        >
          清除
        </button>
      </div>

      {#if startPoint}
        <div class="text-xs mb-1">
          起点: <span class="text-[#27ae60]">({startPoint.x}, {startPoint.y})</span>
        </div>
      {/if}
      {#if endPoint}
        <div class="text-xs mb-2">
          终点: <span class="text-[#e74c3c]">({endPoint.x}, {endPoint.y})</span>
        </div>
      {/if}
    </div>

    <div class="mb-4">
      <label class="block text-xs font-semibold mb-2 text-muted">选择算法</label>
      <div class="grid grid-cols-2 gap-2">
        {#each algorithms as algo}
          <button
            on:click={() => selectAlgorithm(algo.value)}
            class="algorithm-btn text-left p-2 rounded text-xs {selectedAlgorithm === algo.value ? 'bg-[#4a9eff] text-white' : 'bg-[#2d2d44] hover:bg-[#3d3d54]'}"
            disabled={isRunning || (algo.value === 'jps' && !jpsAvailable)}
            title={algo.description}
          >
            <div class="font-semibold">{algo.label}</div>
            <div class="opacity-70 text-[10px]">{algo.description}</div>
          </button>
        {/each}
      </div>
    </div>

    {#if selectedAlgorithm === 'astar' || selectedAlgorithm === 'jps' || selectedAlgorithm === 'dstarlite'}
      <div class="mb-4">
        <label class="block text-xs font-semibold mb-2 text-muted">启发函数</label>
        <select
          bind:value={heuristic}
          on:change={handleHeuristicChange}
          class="w-full bg-[#2d2d44] border border-[#3d3d54] rounded px-3 py-2 text-sm"
          disabled={isRunning}
        >
          {#each heuristics as h}
            <option value={h.value}>{h.label}</option>
          {/each}
        </select>
      </div>
    {/if}

    {#if selectedAlgorithm === 'astar'}
      <div class="mb-4">
        <label class="block text-xs font-semibold mb-2 text-muted">
          启发权重 (w = {heuristicWeight.toFixed(1)})
        </label>
        <input
          type="range"
          min="0.5"
          max="5"
          step="0.1"
          bind:value={heuristicWeight}
          on:input={handleHeuristicWeightInput}
          class="w-full"
          disabled={isRunning}
        />
        <div class="flex justify-between text-[10px] text-muted mt-1">
          <span>0.5 (最优)</span>
          <span>1.0 (平衡)</span>
          <span>5.0 (最快)</span>
        </div>
        <p class="text-[10px] text-muted mt-2 leading-relaxed">
          w = 1 时保证最优路径，w 越大搜索越快但可能偏离最优。
        </p>
      </div>
    {/if}

    <div class="mb-4">
      <label class="block text-xs font-semibold mb-2 text-muted">
        动画速度 ({animationSpeed}ms/步)
      </label>
      <input
        type="range"
        min="1"
        max="500"
        step="1"
        bind:value={animationSpeed}
        on:input={handleAnimationSpeedInput}
        class="w-full"
        disabled={isRunning && !isPaused}
      />
      <div class="flex justify-between text-[10px] text-muted mt-1">
        <span>快</span>
        <span>慢</span>
      </div>
    </div>

    <div class="flex gap-2 mb-4">
      {#if !isRunning}
        <button
          on:click={runAlgorithm}
          class="flex-1 py-2 rounded bg-[#4a9eff] hover:bg-[#3a8eef] text-white font-semibold text-sm disabled:opacity-50"
          disabled={!startPoint || !endPoint}
        >
          运行
        </button>
      {:else}
        <button
          on:click={togglePause}
          class="flex-1 py-2 rounded bg-[#f39c12] hover:bg-[#e08e0b] text-white font-semibold text-sm"
        >
          {isPaused ? '继续' : '暂停'}
        </button>
        <button
          on:click={stepOnce}
          class="px-3 py-2 rounded bg-[#2d2d44] hover:bg-[#3d3d54] text-sm"
          disabled={!isPaused}
        >
          单步
        </button>
        <button
          on:click={skipToEnd}
          class="px-3 py-2 rounded bg-[#2d2d44] hover:bg-[#3d3d54] text-sm"
        >
          跳过
        </button>
      {/if}
      <button
        on:click={clearPath}
        class="px-3 py-2 rounded bg-[#2d2d44] hover:bg-[#3d3d54] text-sm"
      >
        重置
      </button>
    </div>

    {#if results}
      <div class="bg-[#0d0d1a] rounded-lg p-3">
        <div class="flex items-center justify-between mb-2">
          <h4 class="text-sm font-semibold text-[#4a9eff]">运行结果</h4>
          <button
            on:click={saveBookmark}
            class="text-xs px-2 py-1 rounded bg-[#9b59b6] hover:bg-[#8e44ad] text-white disabled:opacity-50"
            disabled={results.path.length === 0 || isRunning}
            title="保存路径书签"
          >
            💾 保存书签
          </button>
        </div>
        <div class="grid grid-cols-2 gap-2 text-xs">
          <div class="stat-item">
            <span class="text-muted">探索节点</span>
            <span class="font-bold text-[#f39c12]">{results.exploredCount}</span>
          </div>
          <div class="stat-item">
            <span class="text-muted">路径长度</span>
            <span class="font-bold text-[#2ecc71]">{results.pathLength} 格</span>
          </div>
          <div class="stat-item">
            <span class="text-muted">总代价</span>
            <span class="font-bold text-[#3498db]">{results.totalCost.toFixed(2)}</span>
          </div>
          <div class="stat-item">
            <span class="text-muted">耗时</span>
            <span class="font-bold text-[#9b59b6]">{results.timeMs} ms</span>
          </div>
        </div>
        {#if results.timeout}
          <div class="mt-2 text-xs text-[#e74c3c] font-semibold">
            ⚠️ 计算超时
          </div>
        {/if}
        {#if results.path.length === 0 && !results.timeout}
          <div class="mt-2 text-xs text-[#e74c3c] font-semibold">
            ❌ 未找到路径
          </div>
        {/if}
      </div>
    {/if}

    {#if selectedAlgorithm === 'dstarlite' && searchState?.completed && !results?.timeout}
      <div class="mt-3 p-3 bg-[#1a1a2e] rounded-lg border border-[#4a9eff]">
        <h4 class="text-sm font-semibold mb-2 text-[#4a9eff]">💡 D*Lite 模式</h4>
        <p class="text-xs text-muted leading-relaxed">
          路径已生成。现在编辑地图（添加/删除障碍物），D*Lite 将自动增量更新路径！
        </p>
      </div>
    {/if}

    {#if selectedAlgorithm === 'jps' && !jpsAvailable}
      <div class="mt-3 p-3 bg-[#2d1a1a] rounded-lg border border-[#e74c3c]">
        <p class="text-xs text-[#e74c3c]">
          ⚠️ JPS 仅适用于所有可通行格子代价相同的地图。当前地图存在多种代价，已自动切换为 A*。
        </p>
      </div>
    {/if}
  {:else}
    <div class="mb-4">
      <label class="block text-xs font-semibold mb-2 text-muted">
        选择对比算法 ({competitionAlgorithms.length}/4)
      </label>
      <div class="grid grid-cols-2 gap-2">
        {#each algorithms as algo}
          <button
            on:click={() => toggleCompetitionAlgorithm(algo.value)}
            class="algorithm-btn text-left p-2 rounded text-xs {competitionAlgorithms.includes(algo.value) ? 'bg-[#4a9eff] text-white' : 'bg-[#2d2d44] hover:bg-[#3d3d54]'}"
            disabled={(algo.value === 'jps' && !jpsAvailable) || (!competitionAlgorithms.includes(algo.value) && competitionAlgorithms.length >= 4)}
          >
            <div class="font-semibold">{algo.label}</div>
            <div class="opacity-70 text-[10px]">{algo.description}</div>
          </button>
        {/each}
      </div>
    </div>

    <div class="mb-4">
      <div class="flex gap-2 mb-3">
        <button
          on:click={() => setPointMode('start')}
          class="flex-1 text-xs py-2 rounded bg-[#27ae60] hover:bg-[#2ecc71] text-white"
        >
          设置起点
        </button>
        <button
          on:click={() => setPointMode('end')}
          class="flex-1 text-xs py-2 rounded bg-[#e74c3c] hover:bg-[#c0392b] text-white"
        >
          设置终点
        </button>
        <button
          on:click={clearPoints}
          class="text-xs px-3 py-2 rounded bg-[#2d2d44] hover:bg-[#3d3d54]"
        >
          清除
        </button>
      </div>

      {#if startPoint}
        <div class="text-xs mb-1">
          起点: <span class="text-[#27ae60]">({startPoint.x}, {startPoint.y})</span>
        </div>
      {/if}
      {#if endPoint}
        <div class="text-xs mb-2">
          终点: <span class="text-[#e74c3c]">({endPoint.x}, {endPoint.y})</span>
        </div>
      {/if}
    </div>

    <button
      on:click={startCompetition}
      class="w-full py-2 rounded bg-[#f39c12] hover:bg-[#e08e0b] text-white font-semibold text-sm disabled:opacity-50"
      disabled={competitionAlgorithms.length < 2 || !startPoint || !endPoint}
    >
      开始竞赛
    </button>

    <p class="text-xs text-muted mt-3 leading-relaxed">
      竞赛模式将在分屏视图中同时运行选中的算法，使用统一时间轴同步推进，最后对比各算法性能。
    </p>
  {/if}
</div>

<style>
  .algorithm-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .stat-item {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  input[type="range"] {
    accent-color: #4a9eff;
  }
</style>
