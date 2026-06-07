<script lang="ts">
  import { bookmarksStore, pathfindingStore, uiStore } from '../store';
  import { wsClient } from '../websocket';
  import type { PathBookmark, AlgorithmType } from '../types';

  let editingId: string | null = null;
  let editingName: string = '';

  const algorithmLabels: Record<AlgorithmType, string> = {
    bfs: 'BFS',
    dijkstra: 'Dijkstra',
    astar: 'A*',
    jps: 'JPS',
    thetastar: 'Theta*',
    dstarlite: 'D*Lite',
  };

  $: bookmarks = $bookmarksStore.bookmarks;
  $: selectedBookmarkId = $bookmarksStore.selectedBookmarkId;
  $: replayingBookmark = $bookmarksStore.replayingBookmark;

  function formatTime(ms: number): string {
    if (ms < 1000) {
      return `${ms}ms`;
    }
    return `${(ms / 1000).toFixed(2)}s`;
  }

  function formatDate(timestamp: number): string {
    const date = new Date(timestamp);
    return date.toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function replayBookmark(bookmark: PathBookmark) {
    if (replayingBookmark?.id === bookmark.id) {
      bookmarksStore.replayBookmark(null);
      bookmarksStore.selectBookmark(null);
      pathfindingStore.setStartPoint(null);
      pathfindingStore.setEndPoint(null);
      pathfindingStore.clearPath();
    } else {
      bookmarksStore.replayBookmark(bookmark);
      bookmarksStore.selectBookmark(bookmark.id);
      pathfindingStore.setStartPoint(bookmark.startPoint);
      pathfindingStore.setEndPoint(bookmark.endPoint);
      pathfindingStore.setResults({
        algorithm: bookmark.algorithm,
        path: bookmark.path,
        exploredCount: bookmark.exploredCount,
        totalCost: bookmark.totalCost,
        pathLength: bookmark.pathLength,
        timeMs: bookmark.timeMs,
        timeout: false,
      });
      uiStore.showToast(`已加载路径: ${bookmark.name}`);
    }
  }

  function deleteBookmark(bookmark: PathBookmark, e: Event) {
    e.stopPropagation();
    if (confirm(`确定要删除书签"${bookmark.name}"吗?`)) {
      wsClient.deleteBookmark(bookmark.id);
      uiStore.showToast('书签已删除');
    }
  }

  function startRename(bookmark: PathBookmark, e: Event) {
    e.stopPropagation();
    editingId = bookmark.id;
    editingName = bookmark.name;
  }

  function saveRename(bookmark: PathBookmark) {
    if (editingName.trim() && editingName.trim() !== bookmark.name) {
      wsClient.renameBookmark(bookmark.id, editingName.trim());
      uiStore.showToast('书签已重命名');
    }
    editingId = null;
    editingName = '';
  }

  function cancelRename() {
    editingId = null;
    editingName = '';
  }

  function handleKeydown(e: KeyboardEvent, bookmark: PathBookmark) {
    if (e.key === 'Enter') {
      saveRename(bookmark);
    } else if (e.key === 'Escape') {
      cancelRename();
    }
  }
</script>

<div class="panel p-4 mb-4">
  <div class="panel-header flex items-center justify-between mb-3">
    <h3 class="font-bold text-[#4a9eff]">路径书签</h3>
    <span class="text-xs text-muted">{bookmarks.length}/20</span>
  </div>

  {#if bookmarks.length === 0}
    <div class="text-center py-8 text-muted text-sm">
      <div class="text-3xl mb-2">📑</div>
      <p>暂无书签</p>
      <p class="text-xs mt-1">运行寻路算法后可保存路径</p>
    </div>
  {:else}
    <div class="space-y-2 max-h-80 overflow-y-auto">
      {#each bookmarks as bookmark (bookmark.id)}
        <div
          class="bookmark-item p-3 rounded-lg cursor-pointer transition-all border {selectedBookmarkId === bookmark.id
            ? 'bg-[#4a9eff]/20 border-[#4a9eff]'
            : 'bg-[#2d2d44] hover:bg-[#3d3d54] border-transparent'}"
          on:click={() => replayBookmark(bookmark)}
        >
          {#if editingId === bookmark.id}
            <div class="flex items-center gap-2 mb-2">
              <input
                type="text"
                bind:value={editingName}
                class="flex-1 bg-[#1a1a2e] border border-[#4a9eff] rounded px-2 py-1 text-sm focus:outline-none"
                on:keydown={(e) => handleKeydown(e, bookmark)}
                on:blur={() => saveRename(bookmark)}
                autofocus
              />
              <button
                on:click={(e) => { e.stopPropagation(); saveRename(bookmark); }}
                class="px-2 py-1 rounded bg-[#27ae60] hover:bg-[#2ecc71] text-xs text-white"
              >
                ✓
              </button>
              <button
                on:click={(e) => { e.stopPropagation(); cancelRename(); }}
                class="px-2 py-1 rounded bg-[#7f8c8d] hover:bg-[#95a5a6] text-xs text-white"
              >
                ✕
              </button>
            </div>
          {:else}
            <div class="flex items-start justify-between mb-2">
              <div class="flex-1 min-w-0">
                <div class="font-semibold text-sm truncate pr-2">{bookmark.name}</div>
              </div>
              <div class="flex items-center gap-1 flex-shrink-0">
                <button
                  on:click={(e) => startRename(bookmark, e)}
                  class="p-1 rounded hover:bg-[#4a9eff]/30 text-xs"
                  title="重命名"
                >
                  ✏️
                </button>
                <button
                  on:click={(e) => deleteBookmark(bookmark, e)}
                  class="p-1 rounded hover:bg-[#e74c3c]/30 text-xs"
                  title="删除"
                >
                  🗑️
                </button>
              </div>
            </div>
          {/if}

          <div class="flex items-center gap-2 text-xs mb-2">
            <span class="px-2 py-0.5 rounded bg-[#4a9eff]/30 text-[#4a9eff] font-semibold">
              {algorithmLabels[bookmark.algorithm]}
            </span>
            <span class="text-[#f39c12] font-semibold">
              代价: {bookmark.totalCost.toFixed(2)}
            </span>
          </div>

          <div class="grid grid-cols-3 gap-2 text-[10px] text-muted">
            <div class="stat-item">
              <span>长度</span>
              <span class="font-semibold text-[#2ecc71]">{bookmark.pathLength}格</span>
            </div>
            <div class="stat-item">
              <span>探索</span>
              <span class="font-semibold text-[#3498db]">{bookmark.exploredCount}</span>
            </div>
            <div class="stat-item">
              <span>耗时</span>
              <span class="font-semibold text-[#9b59b6]">{formatTime(bookmark.timeMs)}</span>
            </div>
          </div>

          <div class="flex items-center justify-between mt-2 text-[10px] text-muted">
            <span>起: ({bookmark.startPoint.x}, {bookmark.startPoint.y})</span>
            <span>终: ({bookmark.endPoint.x}, {bookmark.endPoint.y})</span>
          </div>

          <div class="flex items-center justify-between mt-1 text-[10px] text-muted">
            <span>{bookmark.createdByName}</span>
            <span>{formatDate(bookmark.createdAt)}</span>
          </div>

          {#if bookmark.id === selectedBookmarkId}
            <div class="mt-2 text-xs text-[#4a9eff] text-center">
              点击地图任意位置取消回放
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}

  <div class="mt-3 p-2 bg-[#2d2d44]/50 rounded-lg">
    <div class="text-xs text-muted space-y-1">
      <div>• 点击书签可回放路径</div>
      <div>• 同一房间内所有用户共享书签</div>
      <div>• 最多保存20条书签，超出自动删除最早</div>
    </div>
  </div>
</div>

<style>
  .stat-item {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .bookmark-item {
    transition: all 0.2s ease;
  }
</style>
