<script lang="ts">
  import { mapStore, uiStore, pathfindingStore } from '../store';
  import {
    createEmptyMap,
    generateMaze,
    generateOpenTerrain,
    generateCityStreets,
    generateNaturalTerrain,
    exportMapToJSON,
    importMapFromJSON,
    exportMapToPNG,
    exportToTMX,
    importFromTMX,
  } from '../mapTemplates';
  import type { TemplateType, MapData } from '../types';
  import { hasUniformCost } from '../utils';

  let mapWidth = 64;
  let mapHeight = 64;
  let showResizeConfirm = false;
  let pendingResize = { width: 64, height: 64 };

  const templates: { value: TemplateType; label: string; description: string }[] = [
    { value: 'blank', label: '空白地图', description: '所有格子默认可通行' },
    { value: 'maze', label: '随机迷宫', description: '递归分割法生成迷宫' },
    { value: 'open', label: '开放地形', description: '随机散布障碍物' },
    { value: 'city', label: '城市街道', description: '网格状道路系统' },
    { value: 'natural', label: '自然地形', description: '柏林噪声生成山水' },
  ];

  $: mapData = $mapStore.mapData;

  async function saveMap() {
    try {
      const json = exportMapToJSON(mapData);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `map_${mapData.width}x${mapData.height}_${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      uiStore.showToast('地图已保存');
    } catch (e) {
      uiStore.showToast('保存失败: ' + (e as Error).message);
    }
  }

  async function loadMap(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const loadedMap = importMapFromJSON(text);

      if (loadedMap.width < 32 || loadedMap.width > 512 || loadedMap.height < 32 || loadedMap.height > 512) {
        uiStore.showToast('地图尺寸不支持，必须在 32x32 到 512x512 之间');
        return;
      }

      mapStore.setMapData(loadedMap);
      pathfindingStore.clearPath();
      pathfindingStore.setStartPoint(null);
      pathfindingStore.setEndPoint(null);
      checkJPSAvailability(loadedMap);
      uiStore.showToast('地图已加载');
    } catch (e) {
      uiStore.showToast('加载失败: ' + (e as Error).message);
    } finally {
      input.value = '';
    }
  }

  async function exportPNG() {
    try {
      const blob = await exportMapToPNG(mapData);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `map_${mapData.width}x${mapData.height}_${Date.now()}.png`;
      a.click();
      URL.revokeObjectURL(url);
      uiStore.showToast('PNG 已导出');
    } catch (e) {
      uiStore.showToast('导出失败: ' + (e as Error).message);
    }
  }

  async function exportTMX() {
    try {
      const tmx = exportToTMX(mapData);
      const blob = new Blob([tmx], { type: 'application/xml' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `map_${mapData.width}x${mapData.height}_${Date.now()}.tmx`;
      a.click();
      URL.revokeObjectURL(url);
      uiStore.showToast('TMX 已导出');
    } catch (e) {
      uiStore.showToast('导出失败: ' + (e as Error).message);
    }
  }

  async function importTMX(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const loadedMap = importFromTMX(text);

      if (loadedMap.width < 32 || loadedMap.width > 512 || loadedMap.height < 32 || loadedMap.height > 512) {
        uiStore.showToast('地图尺寸不支持，必须在 32x32 到 512x512 之间');
        return;
      }

      mapStore.setMapData(loadedMap);
      pathfindingStore.clearPath();
      pathfindingStore.setStartPoint(null);
      pathfindingStore.setEndPoint(null);
      checkJPSAvailability(loadedMap);
      uiStore.showToast('TMX 已导入');
    } catch (e) {
      uiStore.showToast('导入失败: ' + (e as Error).message);
    } finally {
      input.value = '';
    }
  }

  function generateTemplate(template: TemplateType) {
    let newMap: MapData;
    const width = mapData.width;
    const height = mapData.height;

    switch (template) {
      case 'blank':
        newMap = createEmptyMap(width, height);
        break;
      case 'maze':
        newMap = generateMaze(width, height);
        break;
      case 'open':
        newMap = generateOpenTerrain(width, height);
        break;
      case 'city':
        newMap = generateCityStreets(width, height);
        break;
      case 'natural':
        newMap = generateNaturalTerrain(width, height);
        break;
      default:
        newMap = createEmptyMap(width, height);
    }

    mapStore.setMapData(newMap);
    pathfindingStore.clearPath();
    pathfindingStore.setStartPoint(null);
    pathfindingStore.setEndPoint(null);
    checkJPSAvailability(newMap);
    uiStore.showToast(`已生成 ${templates.find((t) => t.value === template)?.label}`);
  }

  function checkJPSAvailability(map: MapData) {
    const uniform = hasUniformCost(map);
    pathfindingStore.setJPSAvailable(uniform);
  }

  function confirmResize() {
    if (mapWidth < 32 || mapWidth > 512 || mapHeight < 32 || mapHeight > 512) {
      uiStore.showToast('地图尺寸必须在 32x32 到 512x512 之间');
      return;
    }

    if (mapWidth < mapData.width || mapHeight < mapData.height) {
      pendingResize = { width: mapWidth, height: mapHeight };
      showResizeConfirm = true;
    } else {
      doResize();
    }
  }

  function doResize() {
    mapStore.resizeMap(pendingResize.width, pendingResize.height);
    pathfindingStore.clearPath();
    pathfindingStore.setStartPoint(null);
    pathfindingStore.setEndPoint(null);
    showResizeConfirm = false;
    uiStore.showToast('地图已调整大小');
  }

  function cancelResize() {
    showResizeConfirm = false;
    mapWidth = mapData.width;
    mapHeight = mapData.height;
  }

  function undo() {
    mapStore.undo();
  }

  function redo() {
    mapStore.redo();
  }

  $: canUndo = $mapStore.undoStack.length > 0;
  $: canRedo = $mapStore.redoStack.length > 0;
  $: undoCount = $mapStore.undoStack.length;
</script>

<div class="panel p-4">
  <div class="panel-header flex items-center justify-between mb-3">
    <h3 class="font-bold text-[#4a9eff]">地图管理</h3>
  </div>

  <div class="flex gap-2 mb-4">
    <button
      on:click={undo}
      class="flex-1 py-2 rounded bg-[#2d2d44] hover:bg-[#3d3d54] text-sm disabled:opacity-50"
      disabled={!canUndo}
    >
      ↶ 撤销 ({undoCount})
    </button>
    <button
      on:click={redo}
      class="flex-1 py-2 rounded bg-[#2d2d44] hover:bg-[#3d3d54] text-sm disabled:opacity-50"
      disabled={!canRedo}
    >
      ↷ 重做
    </button>
  </div>

  <div class="mb-4">
    <label class="block text-xs font-semibold mb-2 text-muted">地图尺寸</label>
    <div class="flex gap-2 items-end">
      <div class="flex-1">
        <label class="text-[10px] text-muted">宽度</label>
        <input
          type="number"
          bind:value={mapWidth}
          min="32"
          max="512"
          class="w-full bg-[#2d2d44] border border-[#3d3d54] rounded px-2 py-1 text-sm"
        />
      </div>
      <div class="flex-1">
        <label class="text-[10px] text-muted">高度</label>
        <input
          type="number"
          bind:value={mapHeight}
          min="32"
          max="512"
          class="w-full bg-[#2d2d44] border border-[#3d3d54] rounded px-2 py-1 text-sm"
        />
      </div>
      <button
        on:click={confirmResize}
        class="px-3 py-1 rounded bg-[#4a9eff] hover:bg-[#3a8eef] text-white text-sm"
      >
        应用
      </button>
    </div>
    <p class="text-[10px] text-muted mt-1">
      尺寸范围: 32x32 ~ 512x512
    </p>
  </div>

  <div class="mb-4">
    <label class="block text-xs font-semibold mb-2 text-muted">地图模板</label>
    <div class="grid grid-cols-1 gap-2">
      {#each templates as template}
        <button
          on:click={() => generateTemplate(template.value)}
          class="text-left p-2 rounded bg-[#2d2d44] hover:bg-[#3d3d54] text-xs transition-colors"
        >
          <div class="font-semibold">{template.label}</div>
          <div class="opacity-70 text-[10px]">{template.description}</div>
        </button>
      {/each}
    </div>
  </div>

  <div class="mb-4">
    <label class="block text-xs font-semibold mb-2 text-muted">保存/加载</label>
    <div class="grid grid-cols-2 gap-2">
      <button
        on:click={saveMap}
        class="py-2 rounded bg-[#27ae60] hover:bg-[#2ecc71] text-white text-xs"
      >
        保存 JSON
      </button>
      <label class="py-2 rounded bg-[#3498db] hover:bg-[#5dade2] text-white text-xs text-center cursor-pointer">
        加载 JSON
        <input
          type="file"
          accept=".json"
          on:change={loadMap}
          class="hidden"
        />
      </label>
    </div>
  </div>

  <div class="mb-4">
    <label class="block text-xs font-semibold mb-2 text-muted">导出</label>
    <div class="grid grid-cols-2 gap-2">
      <button
        on:click={exportPNG}
        class="py-2 rounded bg-[#9b59b6] hover:bg-[#af7ac5] text-white text-xs"
      >
        导出 PNG
      </button>
      <button
        on:click={exportTMX}
        class="py-2 rounded bg-[#e67e22] hover:bg-[#eb984e] text-white text-xs"
      >
        导出 TMX
      </button>
    </div>
  </div>

  <div>
    <label class="block text-xs font-semibold mb-2 text-muted">导入</label>
    <label class="w-full py-2 rounded bg-[#1abc9c] hover:bg-[#48c9b0] text-white text-xs text-center cursor-pointer block">
      导入 TMX
      <input
        type="file"
        accept=".tmx,.xml"
        on:change={importTMX}
        class="hidden"
      />
    </label>
  </div>

  {#if showResizeConfirm}
    <div class="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
      <div class="panel p-6 max-w-sm">
        <h3 class="font-bold text-lg mb-3 text-[#e74c3c]">⚠️ 确认调整大小</h3>
        <p class="text-sm mb-4 leading-relaxed">
          新尺寸 ({pendingResize.width}x{pendingResize.height}) 小于当前地图
          ({mapData.width}x{mapData.height})，超出部分将被<b>永久删除</b>且<b>不可撤销</b>。
        </p>
        <p class="text-xs text-muted mb-4">
          是否继续？
        </p>
        <div class="flex gap-2">
          <button
            on:click={cancelResize}
            class="flex-1 py-2 rounded bg-[#2d2d44] hover:bg-[#3d3d54] text-sm"
          >
            取消
          </button>
          <button
            on:click={doResize}
            class="flex-1 py-2 rounded bg-[#e74c3c] hover:bg-[#c0392b] text-white text-sm"
          >
            确认删除
          </button>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  input[type="number"] {
    -moz-appearance: textfield;
  }

  input[type="number"]::-webkit-outer-spin-button,
  input[type="number"]::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }
</style>
