<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { customAlgorithmStore, mapStore, uiStore } from '../store';
  import type { CustomAlgorithm, AlgorithmComment, VersionCompareData } from '../types';
  import { EditorView, basicSetup } from 'codemirror';
  import { javascript } from '@codemirror/lang-javascript';
  import { oneDark } from '@codemirror/theme-one-dark';
  import { autocompletion, completeFromList } from '@codemirror/autocomplete';
  import { wsClient } from '../websocket';

  let editorContainer: HTMLDivElement;
  let editorView: EditorView | null = null;
  let currentUserId: string | null = null;
  let newCommentText = '';
  let showVersionCompareModal = false;

  $: state = $customAlgorithmStore;
  $: mapState = $mapStore;

  const completions = completeFromList([
    { label: 'costMap', type: 'variable', info: '地形代价二维数组' },
    { label: 'width', type: 'variable', info: '地图宽度' },
    { label: 'height', type: 'variable', info: '地图高度' },
    { label: 'startX', type: 'variable', info: '起点X坐标' },
    { label: 'startY', type: 'variable', info: '起点Y坐标' },
    { label: 'endX', type: 'variable', info: '终点X坐标' },
    { label: 'endY', type: 'variable', info: '终点Y坐标' },
    { label: 'findPath', type: 'function', info: '寻路算法主函数' },
    { label: 'Math.sqrt', type: 'function', info: '平方根' },
    { label: 'Math.abs', type: 'function', info: '绝对值' },
    { label: 'Math.max', type: 'function', info: '最大值' },
    { label: 'Math.min', type: 'function', info: '最小值' },
    { label: 'Array.isArray', type: 'function', info: '判断是否为数组' },
    { label: 'Infinity', type: 'variable', info: '无穷大（表示障碍物）' },
  ]);

  onMount(() => {
    if (!editorContainer) return;

    const currentMapState = $mapStore;
    currentUserId = currentMapState.currentUserId;

    editorView = new EditorView({
      doc: state.editorCode,
      extensions: [
        basicSetup,
        javascript(),
        oneDark,
        autocompletion({ override: [completions] }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            customAlgorithmStore.setEditorCode(update.state.doc.toString());
          }
        }),
        EditorView.lineWrapping,
      ],
      parent: editorContainer,
    });

    editorView.dom.style.height = '300px';
    editorView.dom.style.fontSize = '12px';
  });

  function syncEditorContent() {
    if (editorView) {
      const currentContent = editorView.state.doc.toString();
      if (currentContent !== state.editorCode) {
        editorView.dispatch({
          changes: {
            from: 0,
            to: currentContent.length,
            insert: state.editorCode,
          },
        });
      }
    }
  }

  $: if (state.editorCode && editorView) {
    syncEditorContent();
  }

  onDestroy(() => {
    if (editorView) {
      editorView.destroy();
    }
  });

  function toggleExpanded() {
    customAlgorithmStore.setExpanded(!state.expanded);
  }

  function toggleAlgorithmExpand(algoId: string) {
    if (state.expandedAlgorithmId === algoId) {
      customAlgorithmStore.setExpandedAlgorithmId(null);
    } else {
      customAlgorithmStore.setExpandedAlgorithmId(algoId);
      customAlgorithmStore.loadAlgorithmComments(algoId);
      customAlgorithmStore.markCommentsAsRead(algoId);
    }
  }

  function handleNew() {
    const name = prompt('请输入新算法名称（不超过20字）:');
    if (!name || !name.trim()) {
      uiStore.showToast('算法名称不能为空');
      return;
    }
    if (name.length > 20) {
      uiStore.showToast('算法名称不能超过20字');
      return;
    }
    customAlgorithmStore.newAlgorithm();
    customAlgorithmStore.setEditorName(name.trim());
  }

  function handleLoad(algo: CustomAlgorithm) {
    customAlgorithmStore.loadAlgorithm(algo);
  }

  function handleLoadVersion(algo: CustomAlgorithm, version: number) {
    customAlgorithmStore.loadVersion(algo.id, version);
    uiStore.showToast(`已加载版本 v${version}`);
  }

  function handleDelete(algo: CustomAlgorithm) {
    if (algo.authorId !== currentUserId) {
      uiStore.showToast('只能删除自己创建的算法');
      return;
    }
    if (confirm(`确定要删除算法"${algo.name}"吗？`)) {
      customAlgorithmStore.deleteAlgorithmById(algo.id);
    }
  }

  function formatTime(timestamp: number): string {
    const date = new Date(timestamp);
    return date.toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function canDelete(algo: CustomAlgorithm): boolean {
    return algo.authorId === currentUserId;
  }

  function canDeleteComment(comment: AlgorithmComment): boolean {
    return comment.userId === currentUserId;
  }

  function isCurrentAlgorithm(algoId: string): boolean {
    return state.currentAlgorithm && state.currentAlgorithm.id === algoId;
  }

  function handleNameInput(e: Event) {
    const target = e.target as HTMLInputElement;
    customAlgorithmStore.setEditorName(target.value);
  }

  function handleShowCustomPathChange(e: Event) {
    const target = e.target as HTMLInputElement;
    customAlgorithmStore.setShowCustomPath(target.checked);
  }

  function handleShowBFSPathChange(e: Event) {
    const target = e.target as HTMLInputElement;
    customAlgorithmStore.setShowBFSPath(target.checked);
  }

  function getMemoryProgressClass(): string {
    const mem = state.sandboxMetrics.memoryMB;
    if (mem >= 50) return 'progress-red';
    if (mem >= 40) return 'progress-orange';
    return 'progress-green';
  }

  function getTimeProgressClass(): string {
    const time = state.sandboxMetrics.timeMs;
    if (time >= 3000) return 'progress-red';
    if (time >= 2500) return 'progress-orange';
    return 'progress-green';
  }

  function handleShowVersionCompare() {
    if (!state.currentAlgorithm || !state.currentMapHash) {
      uiStore.showToast('请先运行算法以获取对比数据');
      return;
    }
    customAlgorithmStore.loadVersionCompareData(state.currentAlgorithm.id, state.currentMapHash);
    showVersionCompareModal = true;
  }

  function handleCloseVersionCompare() {
    showVersionCompareModal = false;
  }

  function handleAddComment(algoId: string) {
    const content = newCommentText.trim();
    if (!content) {
      uiStore.showToast('评论内容不能为空');
      return;
    }
    if (content.length > 200) {
      uiStore.showToast('评论内容不能超过200字');
      return;
    }
    wsClient.addAlgorithmComment(algoId, content);
    newCommentText = '';
    requestAnimationFrame(() => {
      const input = document.getElementById(`comment-input-${algoId}`) as HTMLInputElement;
      input?.focus();
    });
  }

  function handleDeleteComment(algoId: string, commentId: string) {
    if (confirm('确定要删除这条评论吗？')) {
      wsClient.deleteAlgorithmComment(algoId, commentId);
    }
  }

  function getAlgoComments(algoId: string): AlgorithmComment[] {
    return state.comments[algoId] || [];
  }

  function getMaxCost(data: VersionCompareData[]): number {
    const costs = data.filter(d => d.hasResult).map(d => d.totalCost);
    return costs.length > 0 ? Math.max(...costs) * 1.1 : 100;
  }
</script>

<div class="panel p-4 mb-4">
  <div class="panel-header flex items-center justify-between mb-3 cursor-pointer" on:click={toggleExpanded}>
    <h3 class="font-bold text-[#9b59b6]">自定义算法</h3>
    <span class="text-xs text-muted">
      {state.expanded ? '▼ 收起' : '▶ 展开'}
    </span>
  </div>

  {#if state.expanded}
    <div class="mb-4">
      <div class="flex items-center justify-between mb-2">
        <label class="block text-xs font-semibold text-muted">算法列表 ({state.algorithms.length}/5)</label>
        <button
          on:click={handleNew}
          class="text-xs px-2 py-1 rounded bg-[#9b59b6] hover:bg-[#8e44ad] text-white"
          disabled={state.algorithms.length >= 5}
        >
          + 新建
        </button>
      </div>

      {#if state.algorithms.length === 0}
        <div class="text-xs text-muted text-center py-3 bg-[#0d0d1a] rounded">
          暂无保存的算法，点击"新建"开始创建
        </div>
      {:else}
        <div class="space-y-2 max-h-60 overflow-y-auto">
          {#each state.algorithms as algo (algo.id)}
            <div
              class="p-2 bg-[#0d0d1a] rounded text-xs"
              class:border-[#9b59b6]={isCurrentAlgorithm(algo.id)}
              class:border-2={isCurrentAlgorithm(algo.id)}
            >
              <div class="flex items-center justify-between">
                <div class="flex-1 min-w-0 cursor-pointer" on:click={() => toggleAlgorithmExpand(algo.id)}>
                  <div class="flex items-center gap-2">
                    <span class="text-[10px] text-muted">
                      {state.expandedAlgorithmId === algo.id ? '▼' : '▶'}
                    </span>
                    <span class="font-semibold truncate" title={algo.name}>{algo.name}</span>
                    {#if customAlgorithmStore.hasNewComments(algo.id)}
                      <span class="px-1.5 py-0.5 rounded-full bg-[#e74c3c] text-white text-[9px]">新</span>
                    {/if}
                  </div>
                  <div class="text-[10px] text-muted ml-4">
                    作者: {algo.authorName} · {formatTime(algo.updatedAt)}
                    <span class="ml-2 text-[#9b59b6]">
                      v{algo.currentVersion || 1} · {algo.versionCount || 1}个版本
                    </span>
                  </div>
                </div>
                <div class="flex gap-1 ml-2">
                  <button
                    on:click={() => handleLoad(algo)}
                    class="px-2 py-1 rounded bg-[#2d2d44] hover:bg-[#3d3d54] text-[10px]"
                    title="加载最新版本"
                  >
                    加载
                  </button>
                  <button
                    on:click={() => handleDelete(algo)}
                    class="px-2 py-1 rounded bg-[#2d2d44] hover:bg-[#c0392b] text-[10px]"
                    class:opacity-50={!canDelete(algo)}
                    class:cursor-not-allowed={!canDelete(algo)}
                    disabled={!canDelete(algo)}
                    title={canDelete(algo) ? '删除' : '只能删除自己的算法'}
                  >
                    删除
                  </button>
                </div>
              </div>

              {#if state.expandedAlgorithmId === algo.id}
                <div class="mt-2 ml-4 border-l-2 border-[#2d2d44] pl-3">
                  {#if algo.versions && algo.versions.length > 0}
                    <div class="mb-2">
                      <div class="text-[10px] font-semibold text-muted mb-1">版本历史：</div>
                      <div class="flex flex-wrap gap-1">
                        {#each algo.versions as ver (ver.version)}
                          <button
                            on:click={() => handleLoadVersion(algo, ver.version)}
                            class="px-2 py-0.5 rounded text-[10px] bg-[#2d2d44] hover:bg-[#3d3d54] transition-colors"
                            class:bg-[#9b59b6]={state.loadedVersion === ver.version || (ver.version === algo.currentVersion && !state.loadedVersion)}
                            title={`${formatTime(ver.createdAt)}`}
                          >
                            v{ver.version}
                          </button>
                        {/each}
                      </div>
                    </div>
                  {/if}

                  <div class="mb-2">
                    <div class="flex items-center gap-2 mb-1">
                      <div class="text-[10px] font-semibold text-muted">评论 ({getAlgoComments(algo.id).length}/20)：</div>
                    </div>
                    <div class="flex gap-1 mb-2">
                      <input
                        id={`comment-input-${algo.id}`}
                        type="text"
                        bind:value={newCommentText}
                        placeholder="输入评论（最多200字）"
                        maxlength="200"
                        class="flex-1 bg-[#0d0d1a] border border-[#2d2d44] rounded px-2 py-1 text-xs"
                        on:keydown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            handleAddComment(algo.id);
                          }
                        }}
                      />
                      <button
                        on:click={() => handleAddComment(algo.id)}
                        class="px-2 py-1 rounded bg-[#9b59b6] hover:bg-[#8e44ad] text-white text-xs"
                        disabled={!newCommentText.trim()}
                      >
                        发送
                      </button>
                    </div>
                    <div class="space-y-1 max-h-32 overflow-y-auto">
                      {#each getAlgoComments(algo.id) as comment (comment.id)}
                        <div class="p-2 bg-[#0d0d1a] rounded text-[10px] group">
                          <div class="flex items-center justify-between mb-1">
                            <span class="font-semibold text-[#9b59b6]">{comment.userName}</span>
                            <span class="text-[#666]">{formatTime(comment.createdAt)}</span>
                          </div>
                          <div class="text-muted break-words">{comment.content}</div>
                          {#if canDeleteComment(comment)}
                            <button
                              on:click={() => handleDeleteComment(algo.id, comment.id)}
                              class="mt-1 text-[#e74c3c] text-[9px] opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                              删除
                            </button>
                          {/if}
                        </div>
                      {:else}
                        <div class="text-center text-[10px] text-muted py-2">
                          暂无评论，来说点什么吧
                        </div>
                      {/each}
                    </div>
                  </div>
                </div>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    </div>

    <div class="mb-3">
      <label class="block text-xs font-semibold mb-1 text-muted">算法名称</label>
      <input
        type="text"
        value={state.editorName}
        on:input={handleNameInput}
        placeholder="请输入算法名称（不超过20字）"
        maxlength="20"
        class="w-full bg-[#0d0d1a] border border-[#2d2d44] rounded px-3 py-2 text-sm"
      />
      {#if state.currentAlgorithm}
        <div class="text-[10px] text-muted mt-1 flex items-center gap-2">
          <span>作者: {state.currentAlgorithm.authorName} · 创建于 {formatTime(state.currentAlgorithm.createdAt)}</span>
          <span class="text-[#9b59b6]">
            当前版本: v{state.currentAlgorithm.currentVersion || 1}
            {#if state.loadedVersion}
              <span class="text-[#f39c12] ml-1">(已加载 v{state.loadedVersion})</span>
            {/if}
          </span>
        </div>
      {/if}
    </div>

    <div class="mb-3">
      <label class="block text-xs font-semibold mb-1 text-muted">代码编辑器</label>
      <div bind:this={editorContainer} class="rounded overflow-hidden border border-[#2d2d44]"></div>
      <div class="text-[10px] text-muted mt-2 leading-relaxed">
        <p>• 必须定义 <code class="text-[#f39c12]">findPath(costMap, startX, startY, endX, endY)</code> 函数</p>
        <p>• 返回值格式: <code class="text-[#f39c12]">[{'{x, y}'}, {'{x, y}'}]</code> 或 <code class="text-[#f39c12]">[[x, y], [x, y]]</code></p>
        <p>• 沙盒限制: 3秒超时 · 50MB内存 · 禁止网络/文件访问</p>
      </div>
    </div>

    <div class="mb-3 p-2 bg-[#0d0d1a] rounded border border-[#2d2d44]">
      <div class="text-[10px] font-semibold text-muted mb-2">沙盒资源监控</div>
      <div class="space-y-2">
        <div>
          <div class="flex justify-between text-[10px] mb-1">
            <span class="text-muted">内存占用</span>
            <span class={getMemoryProgressClass()}>{state.sandboxMetrics.memoryMB.toFixed(1)} MB / 50 MB</span>
          </div>
          <div class="h-2 bg-[#1a1a2e] rounded-full overflow-hidden">
            <div
              class={`h-full transition-all duration-300 ${getMemoryProgressClass()}`}
              style={`width: ${Math.min(100, (state.sandboxMetrics.memoryMB / 50) * 100)}%`}
            ></div>
          </div>
        </div>
        <div>
          <div class="flex justify-between text-[10px] mb-1">
            <span class="text-muted">执行时间</span>
            <span class={getTimeProgressClass()}>{state.sandboxMetrics.timeMs} ms / 3000 ms</span>
          </div>
          <div class="h-2 bg-[#1a1a2e] rounded-full overflow-hidden">
            <div
              class={`h-full transition-all duration-300 ${getTimeProgressClass()}`}
              style={`width: ${Math.min(100, (state.sandboxMetrics.timeMs / 3000) * 100)}%`}
            ></div>
          </div>
        </div>
      </div>
      <div class="text-[9px] text-muted mt-2">
        <span class="inline-block w-2 h-2 rounded-full bg-[#27ae60] mr-1"></span>正常
        <span class="inline-block w-2 h-2 rounded-full bg-[#f39c12] ml-3 mr-1"></span>警告
        <span class="inline-block w-2 h-2 rounded-full bg-[#e74c3c] ml-3 mr-1"></span>超限
      </div>
    </div>

    <div class="flex gap-2 mb-4">
      <button
        on:click={() => customAlgorithmStore.saveAlgorithm()}
        class="flex-1 py-2 rounded bg-[#9b59b6] hover:bg-[#8e44ad] text-white font-semibold text-sm disabled:opacity-50"
        disabled={state.isRunning || !state.editorName.trim()}
      >
        💾 保存
      </button>
      <button
        on:click={() => customAlgorithmStore.executeAlgorithm()}
        class="flex-1 py-2 rounded bg-[#4a9eff] hover:bg-[#3a8eef] text-white font-semibold text-sm disabled:opacity-50"
        disabled={state.isRunning || !state.editorCode.trim()}
      >
        {state.isRunning ? '⏳ 运行中...' : '▶ 运行'}
      </button>
    </div>

    {#if state.compareResult}
      <div class="bg-[#0d0d1a] rounded-lg p-3">
        <div class="flex items-center justify-between mb-3">
          <h4 class="text-sm font-semibold text-[#4a9eff]">运行结果对比</h4>
          <div class="flex items-center gap-2">
            {#if state.compareResult.betterThanBFS}
              <span class="px-2 py-1 rounded bg-[#27ae60] text-white text-xs font-bold">
                ✓ 优于基线
              </span>
            {/if}
            <button
              on:click={handleShowVersionCompare}
              class="px-2 py-1 rounded bg-[#f39c12] hover:bg-[#e67e22] text-white text-xs font-semibold"
              title="对比各版本性能"
            >
              📊 版本对比
            </button>
          </div>
        </div>

        <div class="flex gap-2 mb-3">
          <label class="flex items-center gap-1 text-xs cursor-pointer">
            <input
              type="checkbox"
              checked={state.showCustomPath}
              on:change={handleShowCustomPathChange}
            />
            <span class="text-[#9b59b6]">自定义 (紫色)</span>
          </label>
          <label class="flex items-center gap-1 text-xs cursor-pointer">
            <input
              type="checkbox"
              checked={state.showBFSPath}
              on:change={handleShowBFSPathChange}
            />
            <span class="text-[#3498db]">BFS基线 (蓝色)</span>
          </label>
        </div>

        {#if state.compareResult.customResult.error}
          <div class="mb-3 p-2 bg-[#2d1a1a] rounded border border-[#e74c3c] text-xs text-[#e74c3c]">
            <div class="font-semibold mb-1">❌ 自定义算法错误:</div>
            <div class="font-mono break-all">{state.compareResult.customResult.error}</div>
          </div>
        {/if}

        <table class="w-full text-xs">
          <thead>
            <tr class="text-muted border-b border-[#2d2d44]">
              <th class="text-left py-1">指标</th>
              <th class="text-center py-1 text-[#9b59b6]">自定义</th>
              <th class="text-center py-1 text-[#3498db]">BFS基线</th>
            </tr>
          </thead>
          <tbody>
            <tr class="border-b border-[#1a1a2e]">
              <td class="py-1 text-muted">找到路径</td>
              <td class="text-center py-1">
                {#if state.compareResult.customResult.pathLength > 0 && !state.compareResult.customResult.error}
                  <span class="text-[#27ae60]">✓</span>
                {:else}
                  <span class="text-[#e74c3c]">✗</span>
                {/if}
              </td>
              <td class="text-center py-1">
                {#if state.compareResult.bfsResult.pathLength > 0}
                  <span class="text-[#27ae60]">✓</span>
                {:else}
                  <span class="text-[#e74c3c]">✗</span>
                {/if}
              </td>
            </tr>
            <tr class="border-b border-[#1a1a2e]">
              <td class="py-1 text-muted">路径长度</td>
              <td class="text-center py-1 font-mono">
                {state.compareResult.customResult.error ? '-' : state.compareResult.customResult.pathLength + ' 格'}
              </td>
              <td class="text-center py-1 font-mono">{state.compareResult.bfsResult.pathLength} 格</td>
            </tr>
            <tr class="border-b border-[#1a1a2e]">
              <td class="py-1 text-muted">总代价</td>
              <td class="text-center py-1 font-mono" class:text-[#27ae60]={state.compareResult.betterThanBFS}>
                {state.compareResult.customResult.error ? '-' : state.compareResult.customResult.totalCost.toFixed(2)}
              </td>
              <td class="text-center py-1 font-mono">{state.compareResult.bfsResult.totalCost.toFixed(2)}</td>
            </tr>
            <tr>
              <td class="py-1 text-muted">执行耗时</td>
              <td class="text-center py-1 font-mono">
                {state.compareResult.customResult.error ? '-' : state.compareResult.customResult.timeMs + ' ms'}
              </td>
              <td class="text-center py-1 font-mono">{state.compareResult.bfsResult.timeMs} ms</td>
            </tr>
          </tbody>
        </table>

        {#if !state.compareResult.betterThanBFS && state.compareResult.customResult.pathLength > 0 && state.compareResult.bfsResult.pathLength > 0}
          <div class="mt-2 text-xs text-[#f39c12]">
            💡 提示: 尝试优化算法以获得更低的总代价！
          </div>
        {/if}
      </div>
    {/if}
  {/if}
</div>

{#if showVersionCompareModal}
  <div class="fixed inset-0 bg-black/70 flex items-center justify-center z-50" on:click={handleCloseVersionCompare}>
    <div class="bg-[#16162a] rounded-lg p-6 max-w-2xl w-full mx-4 max-h-[80vh] overflow-y-auto" on:click|stopPropagation>
      <div class="flex items-center justify-between mb-4">
        <h3 class="text-lg font-bold text-[#9b59b6]">版本性能对比</h3>
        <button on:click={handleCloseVersionCompare} class="text-muted hover:text-white text-xl">&times;</button>
      </div>

      {#if state.currentAlgorithm}
        <div class="mb-4 text-sm text-muted">
          算法: <span class="text-white font-semibold">{state.currentAlgorithm.name}</span>
          <span class="mx-2">·</span>
          地图哈希: <span class="font-mono text-[#f39c12]">{state.currentMapHash}</span>
        </div>
      {/if}

      {#if state.versionCompareData.length === 0}
        <div class="text-center py-8 text-muted">
          暂无对比数据，请先在相同地图上运行不同版本的算法
        </div>
      {:else}
        <div class="mb-6">
          <h4 class="text-sm font-semibold mb-3 text-muted">性能趋势图</h4>
          <div class="h-48 bg-[#0d0d1a] rounded p-4 relative">
            {#if state.versionCompareData.filter(d => d.hasResult).length < 2}
              <div class="absolute inset-0 flex items-center justify-center text-muted text-xs">
                需要至少2个版本的运行数据才能绘制趋势图
              </div>
            {/if}
            <svg width="100%" height="100%" viewBox="0 0 600 160" preserveAspectRatio="none">
              <line x1="40" y1="10" x2="40" y2="140" stroke="#2d2d44" stroke-width="1"/>
              <line x1="40" y1="140" x2="580" y2="140" stroke="#2d2d44" stroke-width="1"/>
              
              {#each state.versionCompareData.filter(d => d.hasResult) as data, idx}
                {@const maxCost = getMaxCost(state.versionCompareData)}
                {@const totalPoints = Math.max(1, state.versionCompareData.filter(d => d.hasResult).length)}
                {@const x = totalPoints === 1 ? 300 : 40 + (idx / (totalPoints - 1)) * 540}
                {@const y = 140 - (data.totalCost / maxCost) * 120}
                <circle cx={x} cy={y} r="5" fill="#9b59b6"/>
                <text x={x} y={y - 8} text-anchor="middle" fill="#f39c12" font-size="10">{data.totalCost.toFixed(1)}</text>
              {/each}
              
              {#if state.versionCompareData.filter(d => d.hasResult).length >= 2}
                <polyline
                  points={state.versionCompareData.filter(d => d.hasResult).map((data, idx) => {
                    const maxCost = getMaxCost(state.versionCompareData);
                    const totalPoints = state.versionCompareData.filter(d => d.hasResult).length;
                    const x = 40 + (idx / (totalPoints - 1)) * 540;
                    const y = 140 - (data.totalCost / maxCost) * 120;
                    return `${x},${y}`;
                  }).join(' ')}
                  fill="none"
                  stroke="#9b59b6"
                  stroke-width="2"
                />
              {/if}
              
              {#each state.versionCompareData.filter(d => d.hasResult) as data, idx}
                {@const totalPoints = Math.max(1, state.versionCompareData.filter(d => d.hasResult).length)}
                {@const x = totalPoints === 1 ? 300 : 40 + (idx / (totalPoints - 1)) * 540}
                <text x={x} y="155" text-anchor="middle" fill="#888" font-size="10">v{data.version}</text>
              {/each}
              
              <text x="5" y="20" fill="#888" font-size="10" transform="rotate(-90, 5, 20)">总代价</text>
              <text x="300" y="155" fill="#888" font-size="10" text-anchor="middle">版本</text>
            </svg>
          </div>
        </div>

        <h4 class="text-sm font-semibold mb-3 text-muted">详细数据</h4>
        <div class="overflow-x-auto">
          <table class="w-full text-xs">
            <thead>
              <tr class="text-muted border-b border-[#2d2d44]">
                <th class="text-left py-2 px-2">版本</th>
                <th class="text-center py-2 px-2">路径长度</th>
                <th class="text-center py-2 px-2">总代价</th>
                <th class="text-center py-2 px-2">执行耗时</th>
                <th class="text-center py-2 px-2">状态</th>
              </tr>
            </thead>
            <tbody>
              {#each state.versionCompareData as data (data.version)}
                <tr class="border-b border-[#1a1a2e] hover:bg-[#1a1a2e]">
                  <td class="py-2 px-2 font-semibold text-[#9b59b6]">v{data.version}</td>
                  <td class="text-center py-2 px-2 font-mono">
                    {data.hasResult ? data.pathLength + ' 格' : '-'}
                  </td>
                  <td class="text-center py-2 px-2 font-mono">
                    {data.hasResult ? data.totalCost.toFixed(2) : '-'}
                  </td>
                  <td class="text-center py-2 px-2 font-mono">
                    {data.hasResult ? data.timeMs + ' ms' : '-'}
                  </td>
                  <td class="text-center py-2 px-2">
                    {#if data.hasResult}
                      <span class="px-2 py-0.5 rounded bg-[#27ae60]/20 text-[#27ae60] text-[10px]">有数据</span>
                    {:else}
                      <span class="px-2 py-0.5 rounded bg-[#f39c12]/20 text-[#f39c12] text-[10px]">未运行</span>
                    {/if}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .panel {
    background: #16162a;
  }

  input[type="checkbox"] {
    accent-color: #9b59b6;
  }

  :global(.cm-editor) {
    height: 100%;
  }

  :global(.cm-scroller) {
    overflow: auto;
  }

  .progress-green {
    color: #27ae60;
    background-color: #27ae60;
  }

  .progress-orange {
    color: #f39c12;
    background-color: #f39c12;
  }

  .progress-red {
    color: #e74c3c;
    background-color: #e74c3c;
  }
</style>
