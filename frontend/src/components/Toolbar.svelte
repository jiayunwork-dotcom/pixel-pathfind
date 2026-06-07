<script lang="ts">
  import { uiStore, mapStore } from '../store';
  import { TerrainType, LayerType } from '../types';
  import type { ToolType } from '../types';
  import { TerrainColors } from '../types';

  const tools: { id: ToolType; label: string; icon: string; shortcut: string }[] = [
    { id: 'brush', label: '画笔', icon: '✏️', shortcut: '1' },
    { id: 'eraser', label: '橡皮擦', icon: '🧹', shortcut: '2' },
    { id: 'rect', label: '矩形', icon: '⬜', shortcut: '3' },
    { id: 'circle', label: '圆形', icon: '⭕', shortcut: '4' },
    { id: 'line', label: '直线', icon: '📏', shortcut: '5' },
    { id: 'fill', label: '油漆桶', icon: '🪣', shortcut: '6' },
  ];

  const terrainTypes = [
    { type: TerrainType.Walkable, name: '可通行', cost: 1 },
    { type: TerrainType.Wall, name: '墙壁', cost: Infinity },
    { type: TerrainType.Water, name: '水域', cost: 3 },
    { type: TerrainType.Sand, name: '沙地', cost: 2 },
    { type: TerrainType.Grass, name: '草地', cost: 1.5 },
    { type: TerrainType.Swamp, name: '沼泽', cost: 5 },
  ];

  $: currentTool = $uiStore.currentTool;
  $: currentLayer = $uiStore.currentLayer;
  $: currentTerrain = $uiStore.currentTerrain;
  $: brushSize = $uiStore.brushSize;
  $: showGrid = $uiStore.showGrid;
  $: undoStack = $mapStore.undoStack;
  $: redoStack = $mapStore.redoStack;
  $: layers = $mapStore.mapData.layers;

  function selectTool(tool: ToolType) {
    uiStore.setCurrentTool(tool);
  }

  function selectTerrain(terrain: TerrainType) {
    uiStore.setCurrentTerrain(terrain);
  }

  function selectLayer(layer: LayerType) {
    uiStore.setCurrentLayer(layer);
  }

  function setBrushSize(size: number) {
    uiStore.setBrushSize(size);
  }

  function toggleGrid() {
    uiStore.setShowGrid(!showGrid);
  }

  function undo() {
    mapStore.undo();
  }

  function redo() {
    mapStore.redo();
  }

  function handleBrushSizeInput(e: Event) {
    const target = e.target as HTMLInputElement;
    setBrushSize(Number(target.value));
  }

  function handleLayerChange(e: Event) {
    const target = e.target as HTMLSelectElement;
    selectLayer(Number(target.value) as LayerType);
  }

  $: currentLayerLocked = layers[currentLayer as LayerType]?.locked ?? false;
</script>

<div class="toolbar panel m-2">
  <div class="panel-header">编辑工具</div>
  <div class="panel-content">
    <div class="tools-grid grid grid-cols-3 gap-1 mb-4">
      {#each tools as tool}
        <button
          class="tool-btn {currentTool === tool.id ? 'active' : ''}"
          on:click={() => selectTool(tool.id)}
          title={`${tool.label} (${tool.shortcut})`}
        >
          <span class="text-lg">{tool.icon}</span>
          <span>{tool.label}</span>
        </button>
      {/each}
    </div>

    <div class="flex gap-2 mb-4">
      <button
        class="flex-1 text-xs"
        on:click={undo}
        disabled={undoStack.length === 0}
        title="撤销 (Ctrl+Z)"
      >
        ↩️ 撤销
      </button>
      <button
        class="flex-1 text-xs"
        on:click={redo}
        disabled={redoStack.length === 0}
        title="重做 (Ctrl+Y)"
      >
        ↪️ 重做
      </button>
    </div>

    <div class="form-group mb-4">
      <label class="flex items-center justify-between">
        <span>画笔大小: {brushSize}</span>
        <input
          type="range"
          min="1"
          max="10"
          bind:value={brushSize}
          on:input={handleBrushSizeInput}
        />
      </label>
    </div>

    <div class="form-group mb-4">
      <label class="flex items-center justify-between">
        <span>显示网格</span>
        <input type="checkbox" bind:checked={showGrid} on:change={toggleGrid} />
      </label>
    </div>

    <div class="panel-header mb-2 mt-4">地形类型</div>
    <div class="terrain-grid grid grid-cols-3 gap-2 mb-4">
      {#each terrainTypes as terrain}
        <div
          class="terrain-swatch {currentTerrain === terrain.type ? 'active' : ''}"
          style="background-color: {TerrainColors[terrain.type]}"
          on:click={() => selectTerrain(terrain.type)}
          title={`${terrain.name} (代价: ${terrain.cost})`}
        >
        </div>
      {/each}
    </div>

    <div class="text-xs text-muted mb-2">
      {#each terrainTypes as terrain}
        {#if currentTerrain === terrain.type}
          当前: {terrain.name} | 代价: {terrain.cost === Infinity ? '不可通行' : terrain.cost}
        {/if}
      {/each}
    </div>

    <div class="panel-header mb-2 mt-4">当前图层</div>
    <select
      class="w-full mb-2"
      value={currentLayer}
      on:change={handleLayerChange}
      disabled={currentLayerLocked}
    >
      <option value={LayerType.Terrain}>地形层</option>
      <option value={LayerType.Obstacle}>障碍物层</option>
      <option value={LayerType.Decoration}>装饰层</option>
      <option value={LayerType.Event}>事件层</option>
    </select>

    {#if currentLayer === LayerType.Obstacle}
      <div class="text-xs text-muted">
        障碍物层: 点击放置/移除障碍物
      </div>
    {/if}
  </div>
</div>

<style>
  .grid-cols-3 {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
</style>
