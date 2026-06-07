<script lang="ts">
  import { bookmarksStore, pathfindingStore, uiStore, mapStore } from '../store';
  import { wsClient } from '../websocket';
  import type { PathBookmark, AlgorithmType, BookmarkComment, ComparePathInfo } from '../types';

  let editingId: string | null = null;
  let editingName: string = '';
  let newCommentText: Record<string, string> = {};

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
  $: compareMode = $bookmarksStore.compareMode;
  $: expandedBookmarkId = $bookmarksStore.expandedBookmarkId;
  $: comments = $bookmarksStore.comments;
  $: newCommentBookmarks = $bookmarksStore.newCommentBookmarks;

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

  function getCommentCount(bookmarkId: string): number {
    return (comments[bookmarkId] || []).length;
  }

  function hasNewComments(bookmarkId: string): boolean {
    return newCommentBookmarks.has(bookmarkId);
  }

  function toggleExpand(bookmarkId: string) {
    if (compareMode.isActive) return;
    if (expandedBookmarkId === bookmarkId) {
      bookmarksStore.expandBookmark(null);
    } else {
      bookmarksStore.expandBookmark(bookmarkId);
    }
  }

  function handleBookmarkClick(bookmark: PathBookmark) {
    if (compareMode.isActive) {
      bookmarksStore.toggleCompareSelection(bookmark.id);
      return;
    }
    replayBookmark(bookmark);
    if (expandedBookmarkId === bookmark.id) {
      bookmarksStore.expandBookmark(null);
    } else {
      bookmarksStore.expandBookmark(bookmark.id);
    }
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

  function deleteBookmark(bookmark: PathBookmark) {
    if (confirm(`确定要删除书签"${bookmark.name}"吗?`)) {
      wsClient.deleteBookmark(bookmark.id);
      uiStore.showToast('书签已删除');
    }
  }

  function startRename(bookmark: PathBookmark) {
    if (compareMode.isActive) return;
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

  function toggleCompareMode() {
    bookmarksStore.toggleCompareMode();
  }

  function startComparison() {
    if (compareMode.selectedIds.length < 2) {
      uiStore.showToast('请至少选择2条书签进行对比');
      return;
    }
    bookmarksStore.startComparison();
    uiStore.showToast(`已对比 ${compareMode.selectedIds.length} 条路径`);
  }

  function exitComparison() {
    bookmarksStore.exitComparison();
  }

  function addComment(bookmarkId: string) {
    const text = newCommentText[bookmarkId]?.trim();
    if (!text || text.length === 0) return;
    if (text.length > 200) {
      uiStore.showToast('批注不能超过200字');
      return;
    }
    wsClient.addBookmarkComment(bookmarkId, text);
    newCommentText[bookmarkId] = '';
  }

  function deleteComment(bookmarkId: string, commentId: string) {
    if (confirm('确定要删除这条批注吗?')) {
      wsClient.deleteBookmarkComment(bookmarkId, commentId);
    }
  }

  $: isComparing = compareMode.comparingPaths.length > 0;
  $: canStartCompare = compareMode.selectedIds.length >= 2 && compareMode.selectedIds.length <= 4;
</script>

<div class="panel p-4 mb-4">
  <div class="panel-header flex items-center justify-between mb-3">
    <h3 class="font-bold text-[#4a9eff]">路径书签</h3>
    <div class="flex items-center gap-2">
      <span class="text-xs text-muted">{bookmarks.length}/20</span>
      <button
        on:click={isComparing ? exitComparison : toggleCompareMode}
        class="px-3 py-1 text-xs rounded font-semibold transition-all {compareMode.isActive || isComparing
          ? 'bg-[#f39c12] hover:bg-[#e08e0b] text-white shadow-lg shadow-[#f39c12]/30'
          : 'bg-[#4a9eff] hover:bg-[#3a8eef] text-white shadow-lg shadow-[#4a9eff]/30'}"
        title="对比模式"
      >
        {isComparing ? '✕ 退出对比' : compareMode.isActive ? '✕ 取消选择' : '📊 对比模式'}
      </button>
    </div>
  </div>

  {#if compareMode.isActive && !isComparing}
    <div class="mb-3 p-3 bg-[#f39c12]/20 border border-[#f39c12]/50 rounded-lg">
      <div class="text-xs text-[#f39c12] mb-2">
        请选择 2~4 条书签进行对比 (已选 {compareMode.selectedIds.length} 条)
      </div>
      <div class="flex gap-2">
        <button
          on:click={startComparison}
          disabled={!canStartCompare}
          class="flex-1 px-3 py-1.5 text-xs rounded bg-[#27ae60] hover:bg-[#2ecc71] text-white disabled:opacity-50 disabled:cursor-not-allowed transition-all"
        >
          开始对比
        </button>
        <button
          on:click={toggleCompareMode}
          class="px-3 py-1.5 text-xs rounded bg-[#7f8c8d] hover:bg-[#95a5a6] text-white transition-all"
        >
          取消
        </button>
      </div>
    </div>
  {/if}

  {#if isComparing}
    <div class="mb-4">
      <div class="flex items-center justify-between mb-3">
        <h4 class="text-sm font-semibold text-[#f39c12]">📊 路径对比</h4>
        <button
          on:click={exitComparison}
          class="px-2 py-1 text-xs rounded bg-[#e74c3c] hover:bg-[#c0392b] text-white transition-all"
        >
          退出对比
        </button>
      </div>

      <div class="mb-3 p-2 bg-[#2d2d44] rounded-lg">
        <div class="flex flex-wrap gap-2 mb-2">
          {#each compareMode.comparingPaths as pathInfo (pathInfo.bookmark.id)}
            <div class="flex items-center gap-1 text-xs px-2 py-1 rounded bg-[#1a1a2e]">
              <span class="w-3 h-3 rounded-full" style="background: {pathInfo.color}"></span>
              <span class="truncate max-w-24">{pathInfo.bookmark.name}</span>
            </div>
          {/each}
        </div>
        <div class="text-[10px] text-muted">
          鼠标悬停在格子上可查看哪些路径经过该格子
        </div>
      </div>

      <div class="overflow-x-auto">
        <table class="w-full text-xs border-collapse">
          <thead>
            <tr class="bg-[#2d2d44]">
              <th class="px-2 py-2 text-left text-[#4a9eff]">路径</th>
              <th class="px-2 py-2 text-center text-[#4a9eff]">算法</th>
              <th class="px-2 py-2 text-center text-[#4a9eff]">长度</th>
              <th class="px-2 py-2 text-center text-[#4a9eff]">代价</th>
              <th class="px-2 py-2 text-center text-[#4a9eff]">探索</th>
              <th class="px-2 py-2 text-center text-[#4a9eff]">耗时</th>
            </tr>
          </thead>
          <tbody>
            {#each compareMode.comparingPaths as pathInfo (pathInfo.bookmark.id)}
              <tr class="border-b border-[#2d2d44] hover:bg-[#2d2d44]/50">
                <td class="px-2 py-2">
                  <div class="flex items-center gap-1">
                    <span class="w-3 h-3 rounded-full flex-shrink-0" style="background: {pathInfo.color}"></span>
                    <span class="truncate max-w-20">{pathInfo.bookmark.name}</span>
                  </div>
                </td>
                <td class="px-2 py-2 text-center text-[#3498db]">
                  {algorithmLabels[pathInfo.bookmark.algorithm]}
                </td>
                <td class="px-2 py-2 text-center text-[#2ecc71] font-mono">
                  {pathInfo.bookmark.pathLength}
                </td>
                <td class="px-2 py-2 text-center text-[#f39c12] font-mono">
                  {pathInfo.bookmark.totalCost.toFixed(1)}
                </td>
                <td class="px-2 py-2 text-center text-[#9b59b6] font-mono">
                  {pathInfo.bookmark.exploredCount}
                </td>
                <td class="px-2 py-2 text-center text-[#e74c3c] font-mono">
                  {formatTime(pathInfo.bookmark.timeMs)}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </div>
  {/if}

  {#if bookmarks.length === 0}
    <div class="text-center py-8 text-muted text-sm">
      <div class="text-3xl mb-2">📑</div>
      <p>暂无书签</p>
      <p class="text-xs mt-1">运行寻路算法后可保存路径</p>
      {#if compareMode.isActive}
        <div class="mt-4 p-3 bg-[#f39c12]/20 border border-[#f39c12]/50 rounded-lg">
          <p class="text-xs text-[#f39c12]">⚠️ 请先保存至少 2 条书签后再使用对比功能</p>
          <button
            on:click={toggleCompareMode}
            class="mt-2 px-3 py-1.5 text-xs rounded bg-[#7f8c8d] hover:bg-[#95a5a6] text-white transition-all"
          >
            退出对比模式
          </button>
        </div>
      {/if}
    </div>
  {:else}
    <div class="space-y-2 max-h-80 overflow-y-auto">
      {#each bookmarks as bookmark (bookmark.id)}
        <div
          class="bookmark-item p-3 rounded-lg cursor-pointer transition-all border {compareMode.isActive && compareMode.selectedIds.includes(bookmark.id)
            ? 'bg-[#f39c12]/20 border-[#f39c12]'
            : selectedBookmarkId === bookmark.id
            ? 'bg-[#4a9eff]/20 border-[#4a9eff]'
            : 'bg-[#2d2d44] hover:bg-[#3d3d54] border-transparent'}"
          on:click={() => handleBookmarkClick(bookmark)}
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
                on:click|stopPropagation={() => saveRename(bookmark)}
                class="px-2 py-1 rounded bg-[#27ae60] hover:bg-[#2ecc71] text-xs text-white"
              >
                ✓
              </button>
              <button
                on:click|stopPropagation={() => cancelRename()}
                class="px-2 py-1 rounded bg-[#7f8c8d] hover:bg-[#95a5a6] text-xs text-white"
              >
                ✕
              </button>
            </div>
          {:else}
            <div class="flex items-start justify-between mb-2">
              <div class="flex-1 min-w-0 flex items-center gap-2">
                <div class="font-semibold text-sm truncate pr-2">{bookmark.name}</div>
                {#if getCommentCount(bookmark.id) > 0}
                  <span
                    class="relative flex-shrink-0 px-1.5 py-0.5 text-[9px] rounded-full bg-[#4a9eff]/30 text-[#4a9eff] font-semibold {hasNewComments(bookmark.id) ? 'animate-pulse' : ''}"
                    title="{hasNewComments(bookmark.id) ? '有新批注' : `${getCommentCount(bookmark.id)} 条批注`}"
                  >
                    {getCommentCount(bookmark.id)}
                    {#if hasNewComments(bookmark.id)}
                      <span class="absolute -top-1 -right-1 w-2 h-2 bg-[#e74c3c] rounded-full"></span>
                    {/if}
                  </span>
                {/if}
              </div>
              <div class="flex items-center gap-1 flex-shrink-0">
                <button
                  on:click|stopPropagation={() => toggleExpand(bookmark.id)}
                  class="p-1 rounded hover:bg-[#4a9eff]/30 text-xs transition-transform {expandedBookmarkId === bookmark.id ? 'rotate-180' : ''}"
                  title="展开详情"
                >
                  ▼
                </button>
                {#if !compareMode.isActive}
                  <button
                    on:click|stopPropagation={() => startRename(bookmark)}
                    class="p-1 rounded hover:bg-[#4a9eff]/30 text-xs"
                    title="重命名"
                  >
                    ✏️
                  </button>
                {/if}
                <button
                  on:click|stopPropagation={() => deleteBookmark(bookmark)}
                  class="p-1 rounded hover:bg-[#e74c3c]/30 text-xs"
                  title="删除"
                >
                  🗑️
                </button>
              </div>
            </div>
          {/if}

          {#if compareMode.isActive && compareMode.selectedIds.includes(bookmark.id)}
            <div class="mb-2 px-2 py-1 bg-[#f39c12]/20 rounded text-[10px] text-[#f39c12]">
              ✓ 已选择用于对比
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

          {#if !compareMode.isActive}
            <div class="mt-2 text-[10px] text-center">
              <span class="text-[#4a9eff]">
                {expandedBookmarkId === bookmark.id ? '▲ 点击收起详情' : '▼ 点击展开查看批注'}
              </span>
            </div>
          {/if}

          {#if bookmark.id === selectedBookmarkId && !compareMode.isActive}
            <div class="mt-1 text-xs text-[#4a9eff] text-center">
              点击地图任意位置取消回放
            </div>
          {/if}

          {#if expandedBookmarkId === bookmark.id && !compareMode.isActive}
            <div class="mt-3 pt-3 border-t border-[#3d3d54]">
              <div class="mb-3">
                <div class="flex items-center gap-2 mb-2">
                  <input
                    type="text"
                    bind:value={newCommentText[bookmark.id]}
                    placeholder="添加批注 (最多200字)..."
                    maxlength="200"
                    class="flex-1 bg-[#1a1a2e] border border-[#3d3d54] rounded px-2 py-1.5 text-xs focus:outline-none focus:border-[#4a9eff]"
                    on:keydown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        addComment(bookmark.id);
                      }
                    }}
                  />
                  <button
                    on:click|stopPropagation={() => addComment(bookmark.id)}
                    disabled={!newCommentText[bookmark.id]?.trim()}
                    class="px-3 py-1.5 rounded bg-[#4a9eff] hover:bg-[#3a8eef] text-xs text-white disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                  >
                    发送
                  </button>
                </div>
                <div class="text-[9px] text-muted text-right">
                  {(newCommentText[bookmark.id] || '').length}/200
                </div>
              </div>

              <div class="space-y-2 max-h-48 overflow-y-auto">
                {#if (comments[bookmark.id] || []).length === 0}
                  <div class="text-center py-4 text-[10px] text-muted">
                    暂无批注，来说点什么吧~
                  </div>
                {:else}
                  {#each comments[bookmark.id] as comment (comment.id)}
                    <div class="p-2 bg-[#1a1a2e] rounded-lg">
                      <div class="flex items-center justify-between mb-1">
                        <div class="flex items-center gap-2">
                          <span class="text-xs font-semibold text-[#4a9eff]">{comment.userName}</span>
                          <span class="text-[9px] text-muted">{formatDate(comment.createdAt)}</span>
                        </div>
                        {#if $mapStore.currentUserId === comment.userId}
                          <button
                            on:click|stopPropagation={() => deleteComment(bookmark.id, comment.id)}
                            class="text-[9px] text-[#e74c3c] hover:text-[#c0392b] px-1"
                            title="删除批注"
                          >
                            删除
                          </button>
                        {/if}
                      </div>
                      <div class="text-xs text-[#e0e0e0] break-words">
                        {comment.content}
                      </div>
                    </div>
                  {/each}
                {/if}
              </div>
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}

  <div class="mt-3 p-2 bg-[#2d2d44]/50 rounded-lg">
    <div class="text-xs text-muted space-y-1">
      <div>• 点击书签可回放路径并展开详情</div>
      <div>• 在详情中可添加和查看批注</div>
      <div>• 点击「📊 对比模式」可选择多条书签对比</div>
      <div>• 同一房间内所有用户共享书签和批注</div>
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

  .animate-pulse {
    animation: pulse 1.5s ease-in-out infinite;
  }

  @keyframes pulse {
    0%, 100% {
      opacity: 1;
    }
    50% {
      opacity: 0.6;
    }
  }

  .rotate-180 {
    transform: rotate(180deg);
  }
</style>
