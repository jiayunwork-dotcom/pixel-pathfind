<script lang="ts">
  import { mapStore } from '../store';
  import { LayerType } from '../types';

  const layers = [
    { type: LayerType.Terrain, name: '地形层', icon: '🏔️', affectsPathfinding: true },
    { type: LayerType.Obstacle, name: '障碍物层', icon: '🧱', affectsPathfinding: true },
    { type: LayerType.Decoration, name: '装饰层', icon: '🎨', affectsPathfinding: false },
    { type: LayerType.Event, name: '事件层', icon: '⚡', affectsPathfinding: false },
  ];

  $: mapLayers = $mapStore.mapData.layers;

  function toggleVisibility(layer: LayerType) {
    const info = mapLayers[layer];
    mapStore.updateLayer(layer, { visible: !info.visible });
  }

  function toggleLock(layer: LayerType) {
    const info = mapLayers[layer];
    mapStore.updateLayer(layer, { locked: !info.locked });
  }

  function setOpacity(layer: LayerType, opacity: number) {
    mapStore.updateLayer(layer, { opacity });
  }

  function handleOpacityInput(e: Event, layer: LayerType) {
    const target = e.target as HTMLInputElement;
    setOpacity(layer, Number(target.value) / 100);
  }
</script>

<div class="layers-panel panel m-2">
  <div class="panel-header">图层系统</div>
  <div class="panel-content">
    {#each layers as layer}
      <div class="layer-item flex items-center gap-2 py-2 border-b border-[#2d2d44] last:border-b-0">
        <button
          class="visibility-btn p-1 rounded hover:bg-[#3d3d5c] text-lg"
          on:click={() => toggleVisibility(layer.type)}
          title={mapLayers[layer.type].visible ? '隐藏' : '显示'}
        >
          {mapLayers[layer.type].visible ? '👁️' : '👁️‍🗨️'}
        </button>

        <button
          class="lock-btn p-1 rounded hover:bg-[#3d3d5c] text-lg"
          on:click={() => toggleLock(layer.type)}
          title={mapLayers[layer.type].locked ? '解锁' : '锁定'}
        >
          {mapLayers[layer.type].locked ? '🔒' : '🔓'}
        </button>

        <span class="text-lg">{layer.icon}</span>

        <div class="flex-1">
          <div class="text-sm font-medium">{layer.name}</div>
          {#if layer.affectsPathfinding}
            <div class="text-xs text-[#8892b0]">影响寻路</div>
          {:else}
            <div class="text-xs text-[#8892b0]">纯视觉</div>
          {/if}
        </div>

        <div class="flex flex-col items-center gap-1">
          <input
            type="range"
            min="0"
            max="100"
            value={mapLayers[layer.type].opacity * 100}
            on:input={(e) => handleOpacityInput(e, layer.type)}
            class="w-20"
          />
          <span class="text-xs text-[#8892b0]">
            {Math.round(mapLayers[layer.type].opacity * 100)}%
          </span>
        </div>
      </div>
    {/each}

    <div class="mt-4 p-3 bg-[#2d2d44]/50 rounded-lg">
      <div class="text-xs text-[#8892b0] mb-2">说明</div>
      <div class="text-xs text-muted space-y-1">
        <div>• 地形层和障碍物层影响寻路计算</div>
        <div>• 装饰层和事件层仅用于视觉效果</div>
        <div>• 锁定图层后无法进行编辑</div>
        <div>• 调节透明度可叠加查看多层</div>
      </div>
    </div>
  </div>
</div>
