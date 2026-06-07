import type { Message, Operation, CursorUpdate, User, MapData, PathBookmark } from './types';

interface WebSocketCallbacks {
  onConnect?: () => void;
  onDisconnect?: () => void;
  onUserJoin?: (data: { user: User; users: Record<string, User>; mapData: MapData; yourId: string; bookmarks: PathBookmark[] }) => void;
  onUserLeave?: (data: { userId: string; users: Record<string, User> }) => void;
  onCursor?: (cursor: CursorUpdate) => void;
  onOperation?: (op: Operation) => void;
  onSync?: (data: { operations: Operation[]; mapData: MapData }) => void;
  onError?: (error: string) => void;
  onBookmarkAdded?: (bookmark: PathBookmark) => void;
  onBookmarkDeleted?: (data: { id: string }) => void;
  onBookmarkRenamed?: (data: { id: string; name: string }) => void;
}

export class WebSocketClient {
  private ws: WebSocket | null = null;
  private roomId: string | null = null;
  private userName: string | null = null;
  private callbacks: WebSocketCallbacks = {};
  private reconnectTimer: number | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private pendingOperations: Operation[] = [];
  private lastOperationTimestamp: number = 0;
  private isConnected = false;
  private shouldReconnect = true;

  setCallbacks(callbacks: WebSocketCallbacks) {
    this.callbacks = callbacks;
  }

  connect(roomId: string, userName: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.roomId = roomId;
      this.userName = userName;
      this.shouldReconnect = true;

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = window.location.host;
      const wsUrl = `${protocol}//${host}/ws/${roomId}/${encodeURIComponent(userName)}`;

      try {
        this.ws = new WebSocket(wsUrl);
      } catch (e) {
        reject(e);
        return;
      }

      this.ws.onopen = () => {
        this.isConnected = true;
        this.reconnectAttempts = 0;
        this.callbacks.onConnect?.();

        while (this.pendingOperations.length > 0) {
          const op = this.pendingOperations.shift()!;
          this.sendOperation(op);
        }

        resolve();
      };

      this.ws.onclose = () => {
        this.isConnected = false;
        this.callbacks.onDisconnect?.();

        if (this.shouldReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
          this.reconnectAttempts++;
          const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts - 1), 30000);
          this.reconnectTimer = window.setTimeout(() => {
            if (this.roomId && this.userName) {
              this.connect(this.roomId, this.userName).catch(() => {});
            }
          }, delay);
        }
      };

      this.ws.onerror = (error) => {
        this.callbacks.onError?.(error?.toString() || 'WebSocket error');
        reject(error);
      };

      this.ws.onmessage = (event) => {
        try {
          const message: Message = JSON.parse(event.data);
          this.handleMessage(message);
        } catch (e) {
          console.error('Failed to parse message:', e);
        }
      };
    });
  }

  private handleMessage(message: Message) {
    switch (message.type) {
      case 'user-join':
        this.callbacks.onUserJoin?.(message.payload);
        break;
      case 'user-leave':
        this.callbacks.onUserLeave?.(message.payload);
        break;
      case 'cursor':
        this.callbacks.onCursor?.(message.payload);
        break;
      case 'operation':
        this.callbacks.onOperation?.(message.payload);
        break;
      case 'sync':
        this.callbacks.onSync?.(message.payload);
        break;
      case 'error':
        this.callbacks.onError?.(message.payload);
        break;
      case 'bookmark-added':
        this.callbacks.onBookmarkAdded?.(message.payload);
        break;
      case 'bookmark-deleted':
        this.callbacks.onBookmarkDeleted?.(message.payload);
        break;
      case 'bookmark-renamed':
        this.callbacks.onBookmarkRenamed?.(message.payload);
        break;
    }
  }

  sendCursor(x: number, y: number) {
    if (!this.isConnected || !this.ws) return;

    const message = {
      type: 'cursor',
      payload: { x, y },
    };

    try {
      this.ws.send(JSON.stringify(message));
    } catch (e) {
      console.error('Failed to send cursor:', e);
    }
  }

  sendOperation(op: Operation) {
    if (!this.isConnected || !this.ws) {
      this.pendingOperations.push(op);
      return;
    }

    op.timestamp = Date.now();
    this.lastOperationTimestamp = op.timestamp;

    const message = {
      type: 'operation',
      payload: op,
    };

    try {
      this.ws.send(JSON.stringify(message));
    } catch (e) {
      console.error('Failed to send operation:', e);
      this.pendingOperations.push(op);
    }
  }

  requestSync(since: number) {
    if (!this.isConnected || !this.ws) return;

    const message = {
      type: 'request-sync',
      payload: { since },
    };

    try {
      this.ws.send(JSON.stringify(message));
    } catch (e) {
      console.error('Failed to request sync:', e);
    }
  }

  addBookmark(bookmark: Omit<PathBookmark, 'id' | 'createdBy' | 'createdByName' | 'createdAt'>) {
    if (!this.isConnected || !this.ws) return;

    const message = {
      type: 'bookmark-add',
      payload: bookmark,
    };

    try {
      this.ws.send(JSON.stringify(message));
    } catch (e) {
      console.error('Failed to add bookmark:', e);
    }
  }

  deleteBookmark(id: string) {
    if (!this.isConnected || !this.ws) return;

    const message = {
      type: 'bookmark-delete',
      payload: { id },
    };

    try {
      this.ws.send(JSON.stringify(message));
    } catch (e) {
      console.error('Failed to delete bookmark:', e);
    }
  }

  renameBookmark(id: string, name: string) {
    if (!this.isConnected || !this.ws) return;

    const message = {
      type: 'bookmark-rename',
      payload: { id, name },
    };

    try {
      this.ws.send(JSON.stringify(message));
    } catch (e) {
      console.error('Failed to rename bookmark:', e);
    }
  }

  disconnect() {
    this.shouldReconnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
  }

  getConnectionState(): boolean {
    return this.isConnected;
  }

  getLastOperationTimestamp(): number {
    return this.lastOperationTimestamp;
  }
}

export const wsClient = new WebSocketClient();
