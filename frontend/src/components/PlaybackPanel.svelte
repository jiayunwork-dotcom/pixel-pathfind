<script lang="ts">
  import { get } from 'svelte/store';
  import { playbackStore } from '../store';
  import { wsClient } from '../websocket';
  import { formatTime } from '../utils';
  import type { PlaybackSpeed, PlaybackBookmark } from '../types';

  let progressRef: HTMLDivElement;
  let isDragging = false;
  let showBookmarkModal = false;
  let bookmarkNote = '';
  let showExportModal = false;
  let exportFps = 10;
  let exportScale = 1;
  let exportProgress = 0;
  let isExporting = false;

  const speeds: PlaybackSpeed[] = [0.5, 1, 2, 4];

  $: state = $playbackStore;
  $: progressPercent = state.totalDuration > 0 ? (state.currentTime / state.totalDuration) * 100 : 0;

  function togglePlay() {
    if (state.isPlaying) {
      playbackStore.pause();
    } else {
      playbackStore.play();
    }
  }

  function stepBackward() {
    playbackStore.pause();
    playbackStore.stepBackward();
  }

  function stepForward() {
    playbackStore.pause();
    playbackStore.stepForward();
  }

  function setSpeed(speed: PlaybackSpeed) {
    playbackStore.setSpeed(speed);
  }

  function handleProgressClick(e: MouseEvent) {
    if (!progressRef || state.totalDuration === 0) return;
    const rect = progressRef.getBoundingClientRect();
    const percent = (e.clientX - rect.left) / rect.width;
    const targetTime = percent * state.totalDuration;
    playbackStore.pause();
    playbackStore.jumpToTime(targetTime);
  }

  function handleProgressMouseDown(e: MouseEvent) {
    isDragging = true;
    handleProgressClick(e);
    window.addEventListener('mousemove', handleProgressMouseMove);
    window.addEventListener('mouseup', handleProgressMouseUp);
  }

  function handleProgressMouseMove(e: MouseEvent) {
    if (!isDragging) return;
    handleProgressClick(e);
  }

  function handleProgressMouseUp() {
    isDragging = false;
    window.removeEventListener('mousemove', handleProgressMouseMove);
    window.removeEventListener('mouseup', handleProgressMouseUp);
  }

  function handleBookmarkClick(bookmark: PlaybackBookmark) {
    playbackStore.pause();
    playbackStore.jumpToTime(bookmark.timeOffset);
  }

  function openAddBookmarkModal() {
    bookmarkNote = '';
    showBookmarkModal = true;
  }

  function addBookmark() {
    if (bookmarkNote.trim().length === 0) {
      bookmarkNote = '标记 ' + (state.bookmarks.length + 1);
    }
    wsClient.addPlaybackBookmark(state.currentTime, state.currentOperationIdx, bookmarkNote.trim());
    showBookmarkModal = false;
  }

  function deleteBookmark(id: string) {
    wsClient.deletePlaybackBookmark(id);
  }

  function openExportModal() {
    showExportModal = true;
    exportProgress = 0;
    isExporting = false;
  }

  async function exportGIF() {
    if (state.operations.length === 0 || !state.originalMapData) return;

    isExporting = true;
    exportProgress = 0;

    try {
      const canvas = document.createElement('canvas');
      const mapData = state.originalMapData;
      const cellSize = 8 * exportScale;
      canvas.width = mapData.width * cellSize;
      canvas.height = mapData.height * cellSize;
      const ctx = canvas.getContext('2d')!;

      const frames: ImageData[] = [];
      const frameInterval = 1000 / exportFps;
      const totalFrames = Math.ceil(state.totalDuration / frameInterval);

      let currentFrameTime = 0;
      let currentOpIdx = 0;
      let currentMapData = JSON.parse(JSON.stringify(state.originalMapData));

      const sortedSnapshots = [...state.snapshots].sort((a, b) => a.operationIdx - b.operationIdx);

      for (let frame = 0; frame <= totalFrames; frame++) {
        while (currentOpIdx < state.operations.length && state.operations[currentOpIdx].timeOffset <= currentFrameTime) {
          let nearestSnapshot: typeof state.snapshots[0] | null = null;
          for (const snapshot of sortedSnapshots) {
            if (snapshot.operationIdx <= currentOpIdx + 1) {
              nearestSnapshot = snapshot;
            } else {
              break;
            }
          }

          if (nearestSnapshot && nearestSnapshot.operationIdx > currentOpIdx - 100) {
            currentMapData = JSON.parse(JSON.stringify(nearestSnapshot.mapData));
            currentOpIdx = nearestSnapshot.operationIdx;
          }

          while (currentOpIdx < state.operations.length && state.operations[currentOpIdx].timeOffset <= currentFrameTime) {
            const op = state.operations[currentOpIdx];
            for (const cell of op.cells) {
              const key = `${cell.x},${cell.y}`;
              let tile = currentMapData.tiles[key];
              if (!tile) {
                tile = { terrain: 0, obstacle: false, decoration: 0, event: 0 };
              }
              switch (op.layer) {
                case 0: tile.terrain = cell.value; break;
                case 1: tile.obstacle = cell.value; break;
                case 2: tile.decoration = cell.value; break;
                case 3: tile.event = cell.value; break;
              }
              currentMapData.tiles[key] = tile;
            }
            currentOpIdx++;
          }
        }

        ctx.fillStyle = '#0d0d1a';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const colors = ['#ffffff', '#1a1a2e', '#3498db', '#f1c40f', '#2ecc71', '#1e8449'];

        for (let y = 0; y < mapData.height; y++) {
          for (let x = 0; x < mapData.width; x++) {
            const key = `${x},${y}`;
            const tile = currentMapData.tiles[key] || { terrain: 0, obstacle: false, decoration: 0, event: 0 };
            let color = colors[tile.terrain] || '#ffffff';
            if (tile.obstacle) color = '#8B4513';

            ctx.fillStyle = color;
            ctx.fillRect(x * cellSize, y * cellSize, cellSize + 1, cellSize + 1);

            if (tile.decoration > 0) {
              ctx.fillStyle = '#e74c3c';
              ctx.beginPath();
              ctx.arc(x * cellSize + cellSize / 2, y * cellSize + cellSize / 2, cellSize * 0.3, 0, Math.PI * 2);
              ctx.fill();
            }

            if (tile.event > 0) {
              ctx.fillStyle = '#f39c12';
              ctx.fillRect(x * cellSize + cellSize * 0.25, y * cellSize + cellSize * 0.25, cellSize * 0.5, cellSize * 0.5);
            }
          }
        }

        frames.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
        currentFrameTime += frameInterval;
        exportProgress = Math.round((frame / totalFrames) * 80);
        await new Promise(resolve => setTimeout(resolve, 0));
      }

      const gifData = encodeGIF(frames, canvas.width, canvas.height, exportFps);
      exportProgress = 100;

      const blob = new Blob([gifData], { type: 'image/gif' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `playback_${Date.now()}.gif`;
      a.click();
      URL.revokeObjectURL(url);

      setTimeout(() => {
        isExporting = false;
        showExportModal = false;
      }, 1000);
    } catch (e) {
      console.error('Export failed:', e);
      isExporting = false;
    }
  }

  function encodeGIF(frames: ImageData[], width: number, height: number, fps: number): Uint8Array {
    const delay = Math.round(100 / fps);
    const pixels = width * height;

    const stream: number[] = [];

    stream.push(0x47, 0x49, 0x46, 0x38, 0x39, 0x61);

    stream.push(width & 0xff, (width >> 8) & 0xff);
    stream.push(height & 0xff, (height >> 8) & 0xff);

    stream.push(0xf0);
    stream.push(0);
    stream.push(0);

    const colorTable = [
      0x0d, 0x0d, 0x1a,
      0xff, 0xff, 0xff,
      0x1a, 0x1a, 0x2e,
      0x34, 0x98, 0xdb,
      0xf1, 0xc4, 0x0f,
      0x2e, 0xcc, 0x71,
      0x1e, 0x84, 0x49,
      0x8b, 0x45, 0x13,
      0xe7, 0x4c, 0x3c,
      0xf3, 0x9c, 0x12,
    ];
    for (let i = 0; i < 32; i++) {
      const idx = i * 3;
      if (idx < colorTable.length) {
        stream.push(colorTable[idx], colorTable[idx + 1], colorTable[idx + 2]);
      } else {
        stream.push(0, 0, 0);
      }
    }

    for (let frameIdx = 0; frameIdx < frames.length; frameIdx++) {
      stream.push(0x21, 0xf9, 0x04);
      stream.push(0x04);
      stream.push(delay & 0xff, (delay >> 8) & 0xff);
      stream.push(0);
      stream.push(0);

      stream.push(0x2c);
      stream.push(0, 0);
      stream.push(0, 0);
      stream.push(width & 0xff, (width >> 8) & 0xff);
      stream.push(height & 0xff, (height >> 8) & 0xff);
      stream.push(0);

      const frame = frames[frameIdx];
      const indexedPixels: number[] = [];

      for (let i = 0; i < pixels; i++) {
        const r = frame.data[i * 4];
        const g = frame.data[i * 4 + 1];
        const b = frame.data[i * 4 + 2];

        let bestIdx = 0;
        let bestDist = Infinity;
        for (let ci = 0; ci < colorTable.length / 3; ci++) {
          const cr = colorTable[ci * 3] - r;
          const cg = colorTable[ci * 3 + 1] - g;
          const cb = colorTable[ci * 3 + 2] - b;
          const dist = cr * cr + cg * cg + cb * cb;
          if (dist < bestDist) {
            bestDist = dist;
            bestIdx = ci;
          }
        }
        indexedPixels.push(bestIdx);
      }

      const minCodeSize = 4;
      stream.push(minCodeSize);

      const lzwData = lzwEncode(indexedPixels, minCodeSize);
      for (let i = 0; i < lzwData.length; i += 255) {
        const chunkSize = Math.min(255, lzwData.length - i);
        stream.push(chunkSize);
        for (let j = 0; j < chunkSize; j++) {
          stream.push(lzwData[i + j]);
        }
      }
      stream.push(0);
    }

    stream.push(0x3b);

    return new Uint8Array(stream);
  }

  function lzwEncode(pixels: number[], minCodeSize: number): number[] {
    const clearCode = 1 << minCodeSize;
    const eoiCode = clearCode + 1;
    let codeSize = minCodeSize + 1;
    let nextCode = eoiCode + 1;

    const dict = new Map<string, number>();
    for (let i = 0; i < clearCode; i++) {
      dict.set(String(i), i);
    }

    const result: number[] = [];
    let bitBuffer = 0;
    let bitCount = 0;

    function writeCode(code: number) {
      bitBuffer |= code << bitCount;
      bitCount += codeSize;
      while (bitCount >= 8) {
        result.push(bitBuffer & 0xff);
        bitBuffer >>= 8;
        bitCount -= 8;
      }
    }

    writeCode(clearCode);

    let current = String(pixels[0]);
    for (let i = 1; i < pixels.length; i++) {
      const pixel = pixels[i];
      const combined = current + ',' + pixel;

      if (dict.has(combined)) {
        current = combined;
      } else {
        writeCode(dict.get(current)!);
        if (nextCode < 4096) {
          dict.set(combined, nextCode++);
          if (nextCode === (1 << codeSize) && codeSize < 12) {
            codeSize++;
          }
        } else {
          writeCode(clearCode);
          dict.clear();
          for (let j = 0; j < clearCode; j++) {
            dict.set(String(j), j);
          }
          nextCode = eoiCode + 1;
          codeSize = minCodeSize + 1;
        }
        current = String(pixel);
      }
    }

    writeCode(dict.get(current)!);
    writeCode(eoiCode);

    if (bitCount > 0) {
      result.push(bitBuffer & 0xff);
    }

    return result;
  }

  function exitPlayback() {
    playbackStore.exitPlayback();
  }
</script>

<div class="playback-panel">
  {#if state.isLoading}
    <div class="loading-text">
      加载回放数据中...
    </div>
  {:else}
    <div class="top-bar">
      <div class="status-text">
        <span class="muted-text">回放模式</span>
        <span class="time-text">
          {formatTime(state.currentTime)} / {formatTime(state.totalDuration)}
        </span>
        <span class="muted-text">|</span>
        <span class="op-count-text">
          {state.currentOperationIdx}/{state.totalOperations} 操作
        </span>
      </div>
      <div class="top-buttons">
        <button on:click={openAddBookmarkModal} class="btn-small" title="添加标记">
          🔖 添加标记
        </button>
        <button on:click={openExportModal} class="btn-small" title="导出GIF">
          🎬 导出GIF
        </button>
        <button on:click={exitPlayback} class="btn-danger-small">
          退出回放
        </button>
      </div>
    </div>

    <div class="progress-container"
         bind:this={progressRef}
         on:mousedown={handleProgressMouseDown}>
      <div class="progress-bar"
           style="width: {progressPercent}%">
      </div>

      {#each state.bookmarks as bookmark}
        {@const bookmarkPercent = state.totalDuration > 0 ? (bookmark.timeOffset / state.totalDuration) * 100 : 0}
        <div class="bookmark-marker"
             style="left: {bookmarkPercent}%"
             on:click={(e) => { e.stopPropagation(); handleBookmarkClick(bookmark); }}
             title={bookmark.note}>
          <div class="triangle"></div>
        </div>
      {/each}

      <div class="progress-handle"
           style="left: calc({progressPercent}% - 8px)">
      </div>
    </div>

    <div class="controls">
      <button on:click={stepBackward} class="control-btn" title="上一帧"
              disabled={state.currentOperationIdx === 0}>
        ⏮️
      </button>
      <button on:click={togglePlay} class="control-btn play-btn" title={state.isPlaying ? '暂停' : '播放'}>
        {state.isPlaying ? '⏸️' : '▶️'}
      </button>
      <button on:click={stepForward} class="control-btn" title="下一帧"
              disabled={state.currentOperationIdx >= state.totalOperations}>
        ⏭️
      </button>

      <div class="speed-controls">
        {#each speeds as speed}
          <button on:click={() => setSpeed(speed)}
                  class="speed-btn {state.speed === speed ? 'active' : ''}">
            {speed}x
          </button>
        {/each}
      </div>
    </div>

    {#if state.bookmarks.length > 0}
      <div class="bookmarks-section">
        <div class="bookmarks-title">标记点 ({state.bookmarks.length}/30)</div>
        <div class="bookmarks-list">
          {#each state.bookmarks as bookmark}
            <div class="bookmark-item">
              <span class="bookmark-icon">🔖</span>
              <span class="bookmark-text" on:click={() => handleBookmarkClick(bookmark)}>
                {formatTime(bookmark.timeOffset)}: {bookmark.note}
              </span>
              <button on:click={() => deleteBookmark(bookmark.id)} class="delete-btn" title="删除">
                ×
              </button>
            </div>
          {/each}
        </div>
      </div>
    {/if}
  {/if}
</div>

{#if showBookmarkModal}
  <div class="modal-overlay" on:click={() => showBookmarkModal = false}>
    <div class="modal-content" on:click|stopPropagation>
      <h3 class="modal-title">添加回放标记</h3>
      <div class="modal-info">
        时间: {formatTime(state.currentTime)} | 操作: {state.currentOperationIdx}
      </div>
      <input type="text"
             bind:value={bookmarkNote}
             placeholder="输入备注（最多50字）"
             maxlength="50"
             class="modal-input"
             on:keydown={(e) => e.key === 'Enter' && addBookmark()}
             autofocus />
      <div class="modal-footer">
        <button on:click={() => showBookmarkModal = false} class="btn-small">取消</button>
        <button on:click={addBookmark} class="btn-primary-small">添加</button>
      </div>
    </div>
  </div>
{/if}

{#if showExportModal}
  <div class="modal-overlay" on:click={() => !isExporting && (showExportModal = false)}>
    <div class="modal-content" on:click|stopPropagation>
      <h3 class="modal-title">导出GIF动画</h3>

      {#if isExporting}
        <div class="export-progress">
          <div class="progress-text">导出中... {exportProgress}%</div>
          <div class="progress-bar-container">
            <div class="progress-bar-fill" style="width: {exportProgress}%"></div>
          </div>
        </div>
      {:else}
        <div class="export-options">
          <div class="option-group">
            <label class="option-label">帧率</label>
            <div class="option-buttons">
              {#each [5, 10, 15] as fps}
                <button on:click={() => exportFps = fps}
                        class="option-btn {exportFps === fps ? 'active' : ''}">
                  {fps}fps
                </button>
              {/each}
            </div>
          </div>
          <div class="option-group">
            <label class="option-label">画面尺寸</label>
            <div class="option-buttons">
              <button on:click={() => exportScale = 1}
                      class="option-btn {exportScale === 1 ? 'active' : ''}">
                原始
              </button>
              <button on:click={() => exportScale = 0.5}
                      class="option-btn {exportScale === 0.5 ? 'active' : ''}">
                50%
              </button>
              <button on:click={() => exportScale = 0.25}
                      class="option-btn {exportScale === 0.25 ? 'active' : ''}">
                25%
              </button>
            </div>
          </div>
          <div class="export-info">
            预计帧数: {Math.ceil(state.totalDuration / (1000 / exportFps))} 帧
          </div>
        </div>
        <div class="modal-footer">
          <button on:click={() => showExportModal = false} class="btn-small">取消</button>
          <button on:click={exportGIF} class="btn-primary-small">导出</button>
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .playback-panel {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    background: rgba(22, 22, 42, 0.95);
    backdrop-filter: blur(8px);
    border-top: 1px solid #2d2d44;
    padding: 16px;
    z-index: 40;
  }

  .loading-text {
    text-align: center;
    color: #8892b0;
    padding: 16px 0;
  }

  .top-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 12px;
  }

  .status-text {
    font-size: 12px;
  }

  .muted-text {
    color: #8892b0;
    margin: 0 8px;
  }

  .time-text {
    margin: 0 8px;
    color: #f39c12;
    font-family: monospace;
    font-weight: bold;
  }

  .op-count-text {
    color: #3498db;
    margin: 0 8px;
  }

  .top-buttons {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .btn-small {
    font-size: 10px;
    padding: 4px 8px;
    background: #2d2d44;
    color: #e0e0e0;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    transition: background 0.2s;
  }

  .btn-small:hover {
    background: #3d3d5c;
  }

  .btn-primary-small {
    font-size: 12px;
    padding: 6px 12px;
    background: linear-gradient(135deg, #4a9eff 0%, #357abd 100%);
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    transition: background 0.2s;
  }

  .btn-primary-small:hover {
    background: linear-gradient(135deg, #5aafff 0%, #458acd 100%);
  }

  .btn-danger-small {
    font-size: 10px;
    padding: 4px 8px;
    background: linear-gradient(135deg, #ff6b6b 0%, #ee5a5a 100%);
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    transition: background 0.2s;
  }

  .btn-danger-small:hover {
    background: linear-gradient(135deg, #ff7b7b 0%, #ff6a6a 100%);
  }

  .progress-container {
    position: relative;
    height: 24px;
    background: #0d0d1a;
    border-radius: 8px;
    cursor: pointer;
    margin-bottom: 12px;
  }

  .progress-bar {
    position: absolute;
    left: 0;
    top: 0;
    height: 100%;
    background: #4a9eff;
    border-radius: 8px;
    transition: width 0.1s ease;
  }

  .bookmark-marker {
    position: absolute;
    top: -4px;
    width: 0;
    height: 0;
    cursor: pointer;
  }

  .triangle {
    width: 0;
    height: 0;
    border-left: 6px solid transparent;
    border-right: 6px solid transparent;
    border-top: 8px solid #f39c12;
    transform: translateX(-50%);
  }

  .bookmark-marker:hover .triangle {
    border-top-color: #e67e22;
  }

  .progress-handle {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    width: 16px;
    height: 16px;
    background: white;
    border-radius: 50%;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
    cursor: grab;
    transition: transform 0.2s;
  }

  .progress-container:hover .progress-handle {
    transform: translateY(-50%) scale(1.1);
  }

  .controls {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
  }

  .control-btn {
    width: 40px;
    height: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 8px;
    background: #0d0d1a;
    border: none;
    color: #e0e0e0;
    font-size: 20px;
    cursor: pointer;
    transition: background 0.2s;
  }

  .control-btn:hover:not(:disabled) {
    background: #2d2d44;
  }

  .control-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .play-btn {
    width: 48px;
    height: 48px;
    font-size: 24px;
    background: linear-gradient(135deg, #4a9eff 0%, #357abd 100%);
  }

  .play-btn:hover:not(:disabled) {
    background: linear-gradient(135deg, #5aafff 0%, #458acd 100%);
  }

  .speed-controls {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-left: 24px;
    background: #0d0d1a;
    border-radius: 8px;
    padding: 4px 8px;
  }

  .speed-btn {
    font-size: 10px;
    padding: 4px 8px;
    background: transparent;
    color: #8892b0;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.2s;
  }

  .speed-btn.active {
    background: #4a9eff;
    color: white;
  }

  .bookmarks-section {
    margin-top: 12px;
    padding-top: 12px;
    border-top: 1px solid #2d2d44;
  }

  .bookmarks-title {
    font-size: 10px;
    color: #8892b0;
    margin-bottom: 8px;
  }

  .bookmarks-list {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .bookmark-item {
    display: flex;
    align-items: center;
    gap: 4px;
    background: #0d0d1a;
    padding: 4px 8px;
    border-radius: 4px;
    font-size: 10px;
    transition: background 0.2s;
  }

  .bookmark-item:hover {
    background: #2d2d44;
  }

  .bookmark-icon {
    color: #f39c12;
  }

  .bookmark-text {
    color: #e0e0e0;
    cursor: pointer;
  }

  .delete-btn {
    background: transparent;
    border: none;
    color: #e74c3c;
    cursor: pointer;
    font-size: 14px;
    margin-left: 4px;
    padding: 0 4px;
  }

  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 50;
  }

  .modal-content {
    background: #16162a;
    border: 1px solid #2d2d44;
    border-radius: 8px;
    padding: 24px;
    width: 384px;
  }

  .modal-title {
    font-size: 18px;
    font-weight: bold;
    margin-bottom: 16px;
    color: #e0e0e0;
  }

  .modal-info {
    font-size: 12px;
    color: #8892b0;
    margin-bottom: 8px;
  }

  .modal-input {
    width: 100%;
    padding: 8px 12px;
    margin-bottom: 16px;
    border: 1px solid #3d3d5c;
    background: #16162a;
    color: #e0e0e0;
    border-radius: 4px;
    outline: none;
    font-size: 14px;
  }

  .modal-input:focus {
    border-color: #4a9eff;
  }

  .modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 24px;
  }

  .export-progress {
    text-align: center;
    padding: 16px 0;
  }

  .progress-text {
    font-size: 12px;
    color: #8892b0;
    margin-bottom: 12px;
  }

  .progress-bar-container {
    width: 100%;
    height: 8px;
    background: #0d0d1a;
    border-radius: 4px;
    overflow: hidden;
  }

  .progress-bar-fill {
    height: 100%;
    background: #4a9eff;
    transition: width 0.3s ease;
  }

  .export-options {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .option-group {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .option-label {
    font-size: 12px;
    color: #8892b0;
  }

  .option-buttons {
    display: flex;
    gap: 8px;
  }

  .option-btn {
    flex: 1;
    padding: 8px;
    background: #0d0d1a;
    color: #e0e0e0;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
    transition: background 0.2s;
  }

  .option-btn.active {
    background: #4a9eff;
    color: white;
  }

  .export-info {
    font-size: 10px;
    color: #8892b0;
  }
</style>
