<script lang="ts">
  import { createEventDispatcher } from 'svelte';

  export let userName: string;
  export let roomId: string;
  export let errorMessage: string;
  export let isJoining: boolean;

  const dispatch = createEventDispatcher();

  function handleCreate() {
    dispatch('create');
  }

  function handleJoin() {
    dispatch('join');
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      if (roomId.trim()) {
        handleJoin();
      } else {
        handleCreate();
      }
    }
  }
</script>

<div class="modal-overlay">
  <div class="modal w-[480px]">
    <div class="text-center mb-6">
      <h1 class="text-3xl font-bold mb-2 bg-gradient-to-r from-[#4a9eff] to-[#357abd] bg-clip-text text-transparent">
        Pixel Pathfind
      </h1>
      <p class="text-muted text-sm">多人协作像素地图编辑器与寻路算法测试工具</p>
    </div>

    <div class="form-group">
      <label>用户名</label>
      <input
        type="text"
        bind:value={userName}
        placeholder="输入你的用户名"
        maxlength="20"
        on:keydown={handleKeydown}
        disabled={isJoining}
      />
    </div>

    <div class="form-group">
      <label>房间码 (可选，加入现有房间)</label>
      <input
        type="text"
        bind:value={roomId}
        placeholder="输入6位房间码"
        maxlength="6"
        on:keydown={handleKeydown}
        disabled={isJoining}
        class="font-mono uppercase"
      />
    </div>

    {#if errorMessage}
      <div class="error-message text-[#ff6b6b] text-sm mb-4 p-3 bg-[#ff6b6b]/10 rounded-lg">
        {errorMessage}
      </div>
    {/if}

    <div class="flex gap-3">
      <button
        class="btn-primary flex-1 py-3 font-semibold"
        on:click={handleCreate}
        disabled={isJoining || !userName.trim()}
      >
        {#if isJoining}
          <span class="flex items-center justify-center gap-2">
            <span class="loading-spinner"></span>
            处理中...
          </span>
        {:else}
          创建新房间
        {/if}
      </button>
      <button
        class="btn-success flex-1 py-3 font-semibold"
        on:click={handleJoin}
        disabled={isJoining || !userName.trim() || !roomId.trim()}
      >
        加入房间
      </button>
    </div>

    <div class="mt-6 pt-4 border-t border-[#2d2d44]">
      <h3 class="text-sm font-semibold mb-3 text-[#8892b0]">功能特性</h3>
      <div class="grid grid-cols-2 gap-2 text-xs text-muted">
        <div class="flex items-center gap-2">
          <span class="w-2 h-2 rounded-full bg-[#4a9eff]"></span>
          多人实时协作编辑
        </div>
        <div class="flex items-center gap-2">
          <span class="w-2 h-2 rounded-full bg-[#2ecc71]"></span>
          6种寻路算法
        </div>
        <div class="flex items-center gap-2">
          <span class="w-2 h-2 rounded-full bg-[#f39c12]"></span>
          可视化搜索过程
        </div>
        <div class="flex items-center gap-2">
          <span class="w-2 h-2 rounded-full bg-[#e74c3c]"></span>
          算法竞赛对比
        </div>
        <div class="flex items-center gap-2">
          <span class="w-2 h-2 rounded-full bg-[#9b59b6]"></span>
          D*Lite动态重规划
        </div>
        <div class="flex items-center gap-2">
          <span class="w-2 h-2 rounded-full bg-[#1abc9c]"></span>
          地图导入导出
        </div>
      </div>
    </div>
  </div>
</div>

<style>
  .uppercase {
    text-transform: uppercase;
  }
  .bg-gradient-to-r {
    background: linear-gradient(to right, var(--tw-gradient-stops));
  }
  .from-\[\#4a9eff\] {
    --tw-gradient-from: #4a9eff;
  }
  .to-\[\#357abd\] {
    --tw-gradient-to: #357abd;
  }
  .bg-clip-text {
    -webkit-background-clip: text;
    background-clip: text;
  }
  .text-transparent {
    color: transparent;
  }
  .text-3xl {
    font-size: 1.875rem;
  }
  .w-\[480px\] {
    width: 480px;
  }
  .grid-cols-2 {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
</style>
