<script lang="ts">
  import { uiStore, mapStore } from '../store';

  $: users = Object.values($uiStore.users);
  $: currentUserId = $mapStore.currentUserId;
  $: onlineCount = users.length;
</script>

<div class="panel p-4 mb-4">
  <div class="panel-header flex items-center justify-between mb-3">
    <h3 class="font-bold text-[#4a9eff]">在线用户</h3>
    <span class="text-xs bg-[#2d2d44] px-2 py-1 rounded-full">
      {onlineCount} 人在线
    </span>
  </div>

  <div class="space-y-2">
    {#each users as user (user.id)}
      <div class="user-item flex items-center gap-3 p-2 rounded-lg hover:bg-[#2d2d44] transition-colors">
        <div
          class="w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-sm"
          style="background-color: {user.color};"
        >
          {user.name.charAt(0).toUpperCase()}
        </div>
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2">
            <span class="font-medium truncate">
              {user.name}
              {#if user.id === currentUserId}
                <span class="text-xs text-[#f39c12]">(你)</span>
              {/if}
            </span>
          </div>
          {#if user.position}
            <div class="text-xs text-muted">
              位置: ({user.position.x}, {user.position.y})
            </div>
          {/if}
        </div>
        <div
          class="w-3 h-3 rounded-full"
          style="background-color: {user.color};"
          title="光标颜色"
        ></div>
      </div>
    {/each}
  </div>

  {#if users.length === 0}
    <div class="text-center text-muted py-4 text-sm">
      暂无其他用户在线
    </div>
  {/if}

  <div class="mt-4 pt-3 border-t border-[#2d2d44]">
    <h4 class="text-sm font-semibold mb-2 text-[#4a9eff]">用户颜色说明</h4>
    <p class="text-xs text-muted leading-relaxed">
      每个用户的光标使用不同颜色显示，便于区分多人同时编辑时的操作位置。
    </p>
  </div>
</div>

<style>
  .user-item {
    transition: all 0.2s ease;
  }

  .user-item:hover {
    transform: translateX(2px);
  }
</style>
