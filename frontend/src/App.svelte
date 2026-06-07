<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte';
import { mapStore, uiStore, pathfindingStore, bookmarksStore, heatmapStore, recordingStore, playbackStore } from './store';
import { wsClient } from './websocket';
import JoinRoomModal from './components/JoinRoomModal.svelte';
import MapCanvas from './components/MapCanvas.svelte';
import Toolbar from './components/Toolbar.svelte';
import LayersPanel from './components/LayersPanel.svelte';
import UsersPanel from './components/UsersPanel.svelte';
import PathfindingPanel from './components/PathfindingPanel.svelte';
import MapManager from './components/MapManager.svelte';
import BookmarksPanel from './components/BookmarksPanel.svelte';
import CompetitionView from './components/CompetitionView.svelte';
import PlaybackPanel from './components/PlaybackPanel.svelte';
import { applyOperationToMap } from './drawingTools';
import type { Operation, User, MapData, CursorUpdate, PathBookmark, RecordingState, RecordedOperation, MapSnapshot, PlaybackBookmark } from './types';
import { hasUniformCost, formatTime } from './utils';

  let showJoinModal = true;
  let userName = '';
  let roomId = '';
  let isJoining = false;
  let errorMessage = '';
  let connected = false;
  let connectionStatus = 'disconnected';

  $: competitionMode = $pathfindingStore.competitionMode;

  onMount(() => {
    const savedUserName = localStorage.getItem('pixel-pathfind-username');
    if (savedUserName) {
      userName = savedUserName;
    }

    wsClient.setCallbacks({
      onConnect: () => {
        connected = true;
        connectionStatus = 'connected';
        errorMessage = '';
      },
      onDisconnect: () => {
        connected = false;
        connectionStatus = 'disconnected';
      },
      onUserJoin: (data) => {
        mapStore.setMapData(data.mapData);
        mapStore.setCurrentUserId(data.yourId);
        uiStore.setUsers(data.users);
        if (data.bookmarks) {
          bookmarksStore.setBookmarks(data.bookmarks);
        }
        if (data.recording) {
          recordingStore.updateRecording(data.recording);
        }
        connected = true;
        showJoinModal = false;
        isJoining = false;
        checkJPSAvailability(data.mapData);
      },
      onUserLeave: (data) => {
        uiStore.setUsers(data.users);
      },
      onCursor: (cursor: CursorUpdate) => {
        uiStore.updateUserCursor(cursor.userId, cursor.x, cursor.y);
      },
      onOperation: (op: Operation) => {
        mapStore.applyRemoteOperation(op);
      },
      onSync: (data) => {
        mapStore.setMapData(data.mapData);
        for (const op of data.operations) {
          mapStore.applyRemoteOperation(op, true);
        }
      },
      onError: (error) => {
        errorMessage = error;
        isJoining = false;
      },
      onBookmarkAdded: (bookmark: PathBookmark) => {
        bookmarksStore.addBookmark(bookmark);
      },
      onBookmarkDeleted: (data: { id: string }) => {
        bookmarksStore.deleteBookmark(data.id);
      },
      onBookmarkRenamed: (data: { id: string; name: string }) => {
        bookmarksStore.renameBookmark(data.id, data.name);
      },
      onRecordingUpdate: (data: { recording: RecordingState }) => {
        recordingStore.updateRecording(data.recording);
      },
      onRecordingStopped: (data: { reason: string; message: string }) => {
        recordingStore.stopRecording(data.reason);
        uiStore.showToast(data.message, 5000);
      },
      onPlaybackStarted: (data: { recording: RecordingState }) => {
        playbackStore.setLoading(false);
      },
      onPlaybackUserStarted: (data: { userId: string; userName: string; message: string }) => {
        uiStore.showToast(data.message, 3000);
      },
      onPlaybackUserStopped: (data: { userId: string }) => {
      },
      onRecordedOps: (data: { operations: RecordedOperation[]; fromIdx: number; toIdx: number }) => {
        playbackStore.setOperations(data.operations);
        playbackStore.setLoading(false);
      },
      onSnapshots: (data: { snapshots: MapSnapshot[] }) => {
        playbackStore.setSnapshots(data.snapshots);
      },
      onPlaybackBookmarkAdded: (bookmark: PlaybackBookmark) => {
        playbackStore.addBookmark(bookmark);
      },
      onPlaybackBookmarkDeleted: (data: { id: string }) => {
        playbackStore.deleteBookmark(data.id);
      },
      onPlaybackBookmarks: (data: { bookmarks: PlaybackBookmark[] }) => {
        playbackStore.setBookmarks(data.bookmarks);
      },
    });
  });

  onDestroy(() => {
    wsClient.disconnect();
  });

  function checkJPSAvailability(mapData: MapData) {
    const uniform = hasUniformCost(mapData);
    pathfindingStore.setJPSAvailable(uniform);
  }

  async function createRoom() {
    if (!userName.trim()) {
      errorMessage = '请输入用户名';
      return;
    }

    isJoining = true;
    errorMessage = '';

    try {
      localStorage.setItem('pixel-pathfind-username', userName);
      const response = await fetch('/api/room/create');
      const data = await response.json();
      roomId = data.roomId;
      await wsClient.connect(roomId, userName);
      mapStore.setRoomId(roomId);
    } catch (e) {
      errorMessage = '创建房间失败: ' + (e as Error).message;
      isJoining = false;
    }
  }

  async function joinRoom() {
    if (!userName.trim()) {
      errorMessage = '请输入用户名';
      return;
    }
    if (!roomId.trim()) {
      errorMessage = '请输入房间码';
      return;
    }

    isJoining = true;
    errorMessage = '';

    try {
      localStorage.setItem('pixel-pathfind-username', userName);
      const response = await fetch(`/api/room/${roomId.toUpperCase()}/exists`);
      const data = await response.json();
      if (!data.exists) {
        errorMessage = '房间不存在';
        isJoining = false;
        return;
      }
      await wsClient.connect(roomId.toUpperCase(), userName);
      mapStore.setRoomId(roomId.toUpperCase());
    } catch (e) {
      errorMessage = '加入房间失败: ' + (e as Error).message;
      isJoining = false;
    }
  }

  function disconnect() {
    wsClient.disconnect();
    showJoinModal = true;
    connected = false;
    mapStore.reset();
    uiStore.reset();
    pathfindingStore.reset();
    bookmarksStore.reset();
    heatmapStore.reset();
    recordingStore.reset();
    playbackStore.exitPlayback();
  }

  function togglePlayback() {
    const state = $playbackStore;
    if (state.isActive) {
      playbackStore.exitPlayback();
    } else {
      const recording = $recordingStore;
      const mapData = $mapStore.mapData;
      playbackStore.startPlayback(recording, mapData);
    }
  }

  function copyRoomId() {
    navigator.clipboard.writeText($mapStore.roomId || '');
    uiStore.showToast('房间码已复制到剪贴板');
  }
</script>

<div class="app-container h-full flex flex-col">
  {#if !showJoinModal && connected}
    <header class="app-header flex items-center justify-between px-4 py-2 bg-[#16162a] border-b border-[#2d2d44]">
      <div class="flex items-center gap-4">
        <h1 class="text-lg font-bold text-[#4a9eff]">Pixel Pathfind</h1>
        {#if $mapStore.roomId}
          <div class="flex items-center gap-2 text-sm">
            <span class="text-muted">房间:</span>
            <span class="font-mono font-bold text-[#f39c12]">{$mapStore.roomId}</span>
            <button on:click={copyRoomId} class="text-xs px-2 py-1">
              复制
            </button>
          </div>
        {/if}
      </div>

      <div class="flex items-center gap-4">
        {#if $recordingStore.isRecording || $recordingStore.isStopped}
          <div class="flex items-center gap-3 text-sm px-3 py-1 bg-[#2d2d44] rounded-lg">
            <span class="flex items-center gap-1">
              <span class="w-2 h-2 rounded-full {$recordingStore.isStopped ? 'bg-[#95a5a6]' : 'bg-[#e74c3c] pulse-rec'}"></span>
              <span class="text-muted">录制</span>
            </span>
            <span class="font-mono text-[#f39c12]">
              {formatTime(Date.now() - $recordingStore.startTime)}
            </span>
            <span class="text-muted">|</span>
            <span class="text-[#3498db]">
              {$recordingStore.operationCount}/{$recordingStore.maxOperations} 操作
            </span>
            {#if $recordingStore.isStopped}
              <span class="text-[#e74c3c] text-xs">已停止</span>
            {/if}
          </div>
        {/if}

        <button
          on:click={togglePlayback}
          class="btn text-sm {$playbackStore.isActive ? 'btn-warning' : 'btn-primary'}"
          disabled={$recordingStore.operationCount === 0}
          title="回放录制"
        >
          {$playbackStore.isActive ? '⏹️ 退出回放' : '▶️ 回放'}
        </button>

        <div class="flex items-center gap-2 text-sm">
          <span class="w-2 h-2 rounded-full {connected ? 'bg-[#2ecc71]' : 'bg-[#e74c3c]'} pulse"></span>
          <span class="text-muted">{connectionStatus === 'connected' ? '已连接' : '已断开'}</span>
        </div>
        <span class="text-sm text-muted">
          地图: {$mapStore.mapData.width}x{$mapStore.mapData.height}
        </span>
        <button on:click={disconnect} class="btn-danger text-sm">
          离开房间
        </button>
      </div>
    </header>

    <div class="main-content flex flex-1 overflow-hidden">
      {#if competitionMode}
        <CompetitionView />
      {:else}
        <aside class="left-panel w-64 border-r border-[#2d2d44] overflow-y-auto {$playbackStore.isActive ? 'opacity-50 pointer-events-none' : ''}">
          <Toolbar />
          <LayersPanel />
        </aside>

        <main class="canvas-container flex-1 relative overflow-hidden bg-[#0d0d1a]">
          <MapCanvas />
          {#if $playbackStore.isActive}
            <PlaybackPanel />
          {/if}
        </main>

        <aside class="right-panel w-80 border-l border-[#2d2d44] overflow-y-auto">
          <UsersPanel />
          <PathfindingPanel />
          <BookmarksPanel />
          <MapManager />
        </aside>
      {/if}
    </div>
  {/if}

  {#if showJoinModal}
    <JoinRoomModal
      bind:userName
      bind:roomId
      bind:errorMessage
      {isJoining}
      on:create={createRoom}
      on:join={joinRoom}
    />
  {/if}

  {#if $uiStore.toastMessage}
    <div class="toast fixed bottom-4 left-1/2 -translate-x-1/2 bg-[#2d2d44] text-white px-4 py-2 rounded-lg shadow-lg z-50">
      {$uiStore.toastMessage}
    </div>
  {/if}
</div>

<style>
  .app-container {
    background: #1a1a2e;
  }

  .left-panel, .right-panel {
    background: #16162a;
  }

  .toast {
    animation: slideUp 0.3s ease;
  }

  @keyframes slideUp {
    from {
      opacity: 0;
      transform: translate(-50%, 20px);
    }
    to {
      opacity: 1;
      transform: translate(-50%, 0);
    }
  }

  .pulse-rec {
    animation: pulseRec 1.5s ease-in-out infinite;
  }

  @keyframes pulseRec {
    0%, 100% {
      opacity: 1;
    }
    50% {
      opacity: 0.4;
    }
  }
</style>
