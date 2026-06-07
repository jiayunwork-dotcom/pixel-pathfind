<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { customAlgorithmStore, mapStore, uiStore } from '../store';
  import type { CustomAlgorithm } from '../types';
  import { EditorView, basicSetup } from 'codemirror';
  import { javascript } from '@codemirror/lang-javascript';
  import { oneDark } from '@codemirror/theme-one-dark';
  import { autocompletion, completeFromList } from '@codemirror/autocomplete';

  let editorContainer: HTMLDivElement;
  let editorView: EditorView | null = null;
  let currentUserId: string | null = null;

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
        <div class="space-y-2 max-h-40 overflow-y-auto">
          {#each state.algorithms as algo (algo.id)}
            <div
              class="p-2 bg-[#0d0d1a] rounded text-xs flex items-center justify-between group"
              class:border-[#9b59b6]={state.currentAlgorithm?.id === algo.id}
              class:border-2={state.currentAlgorithm?.id === algo.id}
            >
              <div class="flex-1 min-w-0">
                <div class="font-semibold truncate" title={algo.name}>{algo.name}</div>
                <div class="text-[10px] text-muted">
                  作者: {algo.authorName} · {formatTime(algo.updatedAt)}
                </div>
              </div>
              <div class="flex gap-1 ml-2">
                <button
                  on:click={() => handleLoad(algo)}
                  class="px-2 py-1 rounded bg-[#2d2d44] hover:bg-[#3d3d54] text-[10px]"
                  title="加载"
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
        <div class="text-[10px] text-muted mt-1">
          作者: {state.currentAlgorithm.authorName} · 创建于 {formatTime(state.currentAlgorithm.createdAt)}
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
          {#if state.compareResult.betterThanBFS}
            <span class="px-2 py-1 rounded bg-[#27ae60] text-white text-xs font-bold">
              ✓ 优于基线
            </span>
          {/if}
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
</style>
