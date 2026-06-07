package main

import (
	"encoding/json"
	"fmt"
	"math/rand"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/gofiber/contrib/websocket"
)

var userColors = []string{
	"#FF6B6B", "#4ECDC4", "#45B7D1", "#96CEB4",
	"#FFEAA7", "#DDA0DD", "#98D8C8", "#F7DC6F",
	"#BB8FCE", "#85C1E9", "#F8B500", "#00CED1",
}

const (
	SnapshotInterval = 200
	MaxRecordedOps   = 10000
	MaxBookmarks     = 30
)

type RoomManager struct {
	rooms  map[string]*Room
	store  *Store
	mu     sync.RWMutex
}

type Room struct {
	ID       string
	state    *RoomState
	clients  map[string]*websocket.Conn
	mu       sync.RWMutex
	store    *Store
}

func NewRoomManager(store *Store) *RoomManager {
	return &RoomManager{
		rooms: make(map[string]*Room),
		store: store,
	}
}

func generateRoomCode() string {
	const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
	b := make([]byte, 6)
	for i := range b {
		b[i] = chars[rand.Intn(len(chars))]
	}
	return string(b)
}

func (rm *RoomManager) CreateRoom() string {
	rm.mu.Lock()
	defer rm.mu.Unlock()

	var roomID string
	for {
		roomID = generateRoomCode()
		if _, exists := rm.rooms[roomID]; !exists {
			break
		}
	}

	room := &Room{
		ID: roomID,
		state: &RoomState{
			ID: roomID,
			MapData: MapData{
				Width:  64,
				Height: 64,
				Tiles:  make(map[string]TileData),
				Layers: map[LayerType]LayerInfo{
					LayerTerrain:    {Visible: true, Locked: false, Opacity: 1.0},
					LayerObstacle:   {Visible: true, Locked: false, Opacity: 1.0},
					LayerDecoration: {Visible: true, Locked: false, Opacity: 0.7},
					LayerEvent:      {Visible: true, Locked: false, Opacity: 0.8},
				},
			},
			Users:     make(map[string]*User),
			Bookmarks: []PathBookmark{},
			CreatedAt: time.Now(),
			Recording: RecordingState{
				IsRecording:    true,
				StartTime:      time.Now().UnixNano() / int64(time.Millisecond),
				OperationCount: 0,
				MaxOperations:  MaxRecordedOps,
				IsStopped:      false,
			},
			Playbacks: make(map[string]PlaybackState),
		},
		clients: make(map[string]*websocket.Conn),
		store:   rm.store,
	}

	rm.rooms[roomID] = room
	rm.store.SaveRoom(room.state)

	return roomID
}

func (rm *RoomManager) GetRoom(roomID string) (*Room, bool) {
	rm.mu.RLock()
	defer rm.mu.RUnlock()

	room, exists := rm.rooms[roomID]
	if !exists {
		exists, _ = rm.store.RoomExists(roomID)
		if exists {
			state, err := rm.store.LoadRoom(roomID)
			if err == nil {
				bookmarks, err := rm.store.LoadBookmarks(roomID)
				if err == nil {
					state.Bookmarks = bookmarks
				} else {
					state.Bookmarks = []PathBookmark{}
				}
				room = &Room{
					ID:      roomID,
					state:   state,
					clients: make(map[string]*websocket.Conn),
					store:   rm.store,
				}
				rm.rooms[roomID] = room
			}
		}
	}

	return room, exists
}

func (rm *RoomManager) JoinRoom(roomID, userName string, conn *websocket.Conn) (*User, error) {
	room, exists := rm.GetRoom(roomID)
	if !exists {
		return nil, fmt.Errorf("room not found")
	}

	room.mu.Lock()
	defer room.mu.Unlock()

	userID := uuid.New().String()
	colorIdx := len(room.state.Users) % len(userColors)

	user := &User{
		ID:     userID,
		Name:   userName,
		Color:  userColors[colorIdx],
		RoomID: roomID,
	}

	room.state.Users[userID] = user
	room.clients[userID] = conn
	room.store.SaveRoom(room.state)

	bookmarkIDs := make([]string, len(room.state.Bookmarks))
	for i, b := range room.state.Bookmarks {
		bookmarkIDs[i] = b.ID
	}
	bookmarkComments, _ := room.store.LoadAllBookmarkComments(roomID, bookmarkIDs)

	joinMsg := Message{
		Type: "user-join",
		Payload: map[string]interface{}{
			"user":              user,
			"users":             room.state.Users,
			"roomId":            roomID,
			"mapData":           room.state.MapData,
			"yourId":            userID,
			"bookmarks":         room.state.Bookmarks,
			"bookmarkComments":  bookmarkComments,
			"recording":         room.state.Recording,
			"playbacks":         room.state.Playbacks,
		},
	}

	joinData, err := json.Marshal(joinMsg)
	if err == nil {
		conn.WriteMessage(websocket.TextMessage, joinData)
	}

	room.broadcast(joinMsg, userID)

	return user, nil
}

func (rm *RoomManager) LeaveRoom(roomID, userID string) {
	room, exists := rm.GetRoom(roomID)
	if !exists {
		return
	}

	room.mu.Lock()
	defer room.mu.Unlock()

	delete(room.state.Users, userID)
	delete(room.clients, userID)

	if _, exists := room.state.Playbacks[userID]; exists {
		delete(room.state.Playbacks, userID)
		room.broadcast(Message{
			Type: "playback-user-stopped",
			Payload: map[string]interface{}{
				"userId": userID,
			},
		}, "")
	}

	room.store.SaveRoom(room.state)

	leaveMsg := Message{
		Type: "user-leave",
		Payload: map[string]interface{}{
			"userId": userID,
			"users":  room.state.Users,
		},
	}

	room.broadcast(leaveMsg, "")

	if len(room.state.Users) == 0 {
		room.store.DeleteRoom(roomID)
		rm.mu.Lock()
		delete(rm.rooms, roomID)
		rm.mu.Unlock()
	}
}

func (r *Room) HandleMessage(userID string, msgType string, payload json.RawMessage) {
	r.mu.Lock()
	defer r.mu.Unlock()

	switch msgType {
	case "cursor":
		var cursor CursorUpdate
		if err := json.Unmarshal(payload, &cursor); err != nil {
			return
		}
		cursor.UserID = userID

		if user, exists := r.state.Users[userID]; exists {
			user.Position = &Cell{X: cursor.X, Y: cursor.Y}
		}

		if playback, exists := r.state.Playbacks[userID]; exists && playback.IsActive {
			return
		}

		r.broadcast(Message{
			Type:    "cursor",
			Payload: cursor,
		}, userID)

	case "operation":
		var op Operation
		if err := json.Unmarshal(payload, &op); err != nil {
			return
		}

		op.ID = uuid.New().String()
		op.UserID = userID
		op.Timestamp = time.Now().UnixNano() / int64(time.Millisecond)

		if r.state.Recording.IsRecording && !r.state.Recording.IsStopped {
			if r.state.Recording.OperationCount >= r.state.Recording.MaxOperations {
				r.state.Recording.IsStopped = true
				r.state.Recording.IsRecording = false
				r.broadcast(Message{
					Type: "recording-stopped",
					Payload: map[string]interface{}{
						"reason": "max_operations",
						"message": "录制已达到最大操作数限制",
					},
				}, "")
				return
			}

			userName := ""
			if user, exists := r.state.Users[userID]; exists {
				userName = user.Name
			}

			timeOffset := op.Timestamp - r.state.Recording.StartTime
			beforeValues := make([]interface{}, len(op.Cells))
			afterValues := make([]interface{}, len(op.Cells))

			for i, cell := range op.Cells {
				key := fmt.Sprintf("%d,%d", cell.X, cell.Y)
				tile, exists := r.state.MapData.Tiles[key]
				if !exists {
					tile = TileData{}
				}

				switch op.Layer {
				case LayerTerrain:
					beforeValues[i] = tile.Terrain
				case LayerObstacle:
					beforeValues[i] = tile.Obstacle
				case LayerDecoration:
					beforeValues[i] = tile.Decoration
				case LayerEvent:
					beforeValues[i] = tile.Event
				}
				afterValues[i] = cell.Value
			}

			recordedOp := RecordedOperation{
				ID:           op.ID,
				UserID:       userID,
				UserName:     userName,
				Timestamp:    op.Timestamp,
				TimeOffset:   timeOffset,
				Type:         op.Type,
				Layer:        op.Layer,
				Cells:        op.Cells,
				BeforeValues: beforeValues,
				AfterValues:  afterValues,
			}

			r.applyOperation(op)
			r.store.SaveOperation(r.ID, op)
			r.store.SaveRecordedOperation(r.ID, recordedOp)

			r.state.Recording.OperationCount++

			if r.state.Recording.OperationCount%SnapshotInterval == 0 {
				snapshot := MapSnapshot{
					ID:           uuid.New().String(),
					RoomID:       r.ID,
					OperationIdx: r.state.Recording.OperationCount,
					TimeOffset:   timeOffset,
					MapData:      deepCopyMapData(r.state.MapData),
					CreatedAt:    time.Now().UnixNano() / int64(time.Millisecond),
				}
				r.store.SaveSnapshot(r.ID, snapshot)
			}

			r.store.SaveRoom(r.state)

			r.broadcast(Message{
				Type:    "operation",
				Payload: op,
			}, "")

			r.broadcast(Message{
				Type: "recording-update",
				Payload: map[string]interface{}{
					"recording": r.state.Recording,
				},
			}, "")
		} else {
			r.applyOperation(op)
			r.store.SaveOperation(r.ID, op)
			r.store.SaveRoom(r.state)

			r.broadcast(Message{
				Type:    "operation",
				Payload: op,
			}, "")
		}

	case "request-sync":
		var req struct {
			Since int64 `json:"since"`
		}
		if err := json.Unmarshal(payload, &req); err != nil {
			return
		}

		ops, err := r.store.GetOperations(r.ID, req.Since)
		if err != nil {
			return
		}

		if conn, exists := r.clients[userID]; exists {
			syncMsg := Message{
				Type: "sync",
				Payload: map[string]interface{}{
					"operations": ops,
					"mapData":    r.state.MapData,
				},
			}
			data, _ := json.Marshal(syncMsg)
			conn.WriteMessage(websocket.TextMessage, data)
		}

	case "bookmark-add":
		var bookmark PathBookmark
		if err := json.Unmarshal(payload, &bookmark); err != nil {
			return
		}

		bookmark.ID = uuid.New().String()
		bookmark.CreatedBy = userID
		if user, exists := r.state.Users[userID]; exists {
			bookmark.CreatedByName = user.Name
		}
		bookmark.CreatedAt = time.Now().UnixNano() / int64(time.Millisecond)

		r.state.Bookmarks = append(r.state.Bookmarks, bookmark)
		if len(r.state.Bookmarks) > 20 {
			r.state.Bookmarks = r.state.Bookmarks[len(r.state.Bookmarks)-20:]
		}

		r.store.SaveBookmarks(r.ID, r.state.Bookmarks)

		r.broadcast(Message{
			Type:    "bookmark-added",
			Payload: bookmark,
		}, "")

	case "bookmark-delete":
		var req struct {
			ID string `json:"id"`
		}
		if err := json.Unmarshal(payload, &req); err != nil {
			return
		}

		for i, b := range r.state.Bookmarks {
			if b.ID == req.ID {
				r.state.Bookmarks = append(r.state.Bookmarks[:i], r.state.Bookmarks[i+1:]...)
				break
			}
		}

		r.store.SaveBookmarks(r.ID, r.state.Bookmarks)

		r.broadcast(Message{
			Type:    "bookmark-deleted",
			Payload: map[string]string{"id": req.ID},
		}, "")

	case "bookmark-rename":
		var req struct {
			ID   string `json:"id"`
			Name string `json:"name"`
		}
		if err := json.Unmarshal(payload, &req); err != nil {
			return
		}

		for i := range r.state.Bookmarks {
			if r.state.Bookmarks[i].ID == req.ID {
				r.state.Bookmarks[i].Name = req.Name
				break
			}
		}

		r.store.SaveBookmarks(r.ID, r.state.Bookmarks)

		r.broadcast(Message{
			Type:    "bookmark-renamed",
			Payload: req,
		}, "")

	case "playback-start":
		userName := ""
		if user, exists := r.state.Users[userID]; exists {
			userName = user.Name
		}

		r.state.Playbacks[userID] = PlaybackState{
			UserID:   userID,
			UserName: userName,
			IsActive: true,
		}

		r.broadcast(Message{
			Type: "playback-user-started",
			Payload: map[string]interface{}{
				"userId":   userID,
				"userName": userName,
				"message":  userName + " 正在回放录制",
			},
		}, userID)

		if conn, exists := r.clients[userID]; exists {
			respMsg := Message{
				Type: "playback-started",
				Payload: map[string]interface{}{
					"recording": r.state.Recording,
				},
			}
			data, _ := json.Marshal(respMsg)
			conn.WriteMessage(websocket.TextMessage, data)
		}

	case "playback-stop":
		delete(r.state.Playbacks, userID)

		r.broadcast(Message{
			Type: "playback-user-stopped",
			Payload: map[string]interface{}{
				"userId": userID,
			},
		}, "")

	case "request-recorded-ops":
		var req struct {
			FromIdx int `json:"fromIdx"`
			ToIdx   int `json:"toIdx"`
		}
		if err := json.Unmarshal(payload, &req); err != nil {
			return
		}

		ops, err := r.store.GetRecordedOperations(r.ID, req.FromIdx, req.ToIdx)
		if err != nil {
			return
		}

		if conn, exists := r.clients[userID]; exists {
			respMsg := Message{
				Type: "recorded-ops",
				Payload: map[string]interface{}{
					"operations": ops,
					"fromIdx":    req.FromIdx,
					"toIdx":      req.ToIdx,
				},
			}
			data, _ := json.Marshal(respMsg)
			conn.WriteMessage(websocket.TextMessage, data)
		}

	case "request-snapshots":
		snapshots, err := r.store.GetSnapshots(r.ID)
		if err != nil {
			return
		}

		if conn, exists := r.clients[userID]; exists {
			respMsg := Message{
				Type: "snapshots",
				Payload: map[string]interface{}{
					"snapshots": snapshots,
				},
			}
			data, _ := json.Marshal(respMsg)
			conn.WriteMessage(websocket.TextMessage, data)
		}

	case "playback-bookmark-add":
		var req struct {
			TimeOffset   int64  `json:"timeOffset"`
			OperationIdx int    `json:"operationIdx"`
			Note         string `json:"note"`
		}
		if err := json.Unmarshal(payload, &req); err != nil {
			return
		}

		if len(req.Note) > 50 {
			req.Note = req.Note[:50]
		}

		bookmark := PlaybackBookmark{
			ID:           uuid.New().String(),
			RoomID:       r.ID,
			TimeOffset:   req.TimeOffset,
			OperationIdx: req.OperationIdx,
			Note:         req.Note,
			CreatedBy:    userID,
			CreatedAt:    time.Now().UnixNano() / int64(time.Millisecond),
		}

		if err := r.store.AddPlaybackBookmark(r.ID, bookmark); err != nil {
			return
		}

		bookmarks, _ := r.store.GetPlaybackBookmarks(r.ID)
		if len(bookmarks) > MaxBookmarks {
			bookmarks = bookmarks[len(bookmarks)-MaxBookmarks:]
			r.store.SavePlaybackBookmarks(r.ID, bookmarks)
		}

		r.broadcast(Message{
			Type: "playback-bookmark-added",
			Payload: bookmark,
		}, "")

	case "playback-bookmark-delete":
		var req struct {
			ID string `json:"id"`
		}
		if err := json.Unmarshal(payload, &req); err != nil {
			return
		}

		if err := r.store.DeletePlaybackBookmark(r.ID, req.ID); err != nil {
			return
		}

		r.broadcast(Message{
			Type: "playback-bookmark-deleted",
			Payload: map[string]string{"id": req.ID},
		}, "")

	case "request-playback-bookmarks":
		bookmarks, err := r.store.GetPlaybackBookmarks(r.ID)
		if err != nil {
			return
		}

		if conn, exists := r.clients[userID]; exists {
			respMsg := Message{
				Type: "playback-bookmarks",
				Payload: map[string]interface{}{
					"bookmarks": bookmarks,
				},
			}
			data, _ := json.Marshal(respMsg)
			conn.WriteMessage(websocket.TextMessage, data)
		}

	case "bookmark-comment-add":
		var req struct {
			BookmarkID string `json:"bookmarkId"`
			Content    string `json:"content"`
		}
		if err := json.Unmarshal(payload, &req); err != nil {
			return
		}

		if len(req.Content) == 0 || len(req.Content) > 200 {
			return
		}

		bookmarkExists := false
		for _, b := range r.state.Bookmarks {
			if b.ID == req.BookmarkID {
				bookmarkExists = true
				break
			}
		}
		if !bookmarkExists {
			return
		}

		userName := ""
		if user, exists := r.state.Users[userID]; exists {
			userName = user.Name
		}

		comment := BookmarkComment{
			ID:         uuid.New().String(),
			BookmarkID: req.BookmarkID,
			UserID:     userID,
			UserName:   userName,
			Content:    req.Content,
			CreatedAt:  time.Now().UnixNano() / int64(time.Millisecond),
		}

		if err := r.store.SaveBookmarkComment(r.ID, comment); err != nil {
			return
		}

		r.broadcast(Message{
			Type:    "bookmark-comment-added",
			Payload: comment,
		}, "")

	case "bookmark-comment-delete":
		var req struct {
			BookmarkID string `json:"bookmarkId"`
			CommentID  string `json:"commentId"`
		}
		if err := json.Unmarshal(payload, &req); err != nil {
			return
		}

		deleted, err := r.store.DeleteBookmarkComment(r.ID, req.BookmarkID, req.CommentID, userID)
		if err != nil || !deleted {
			return
		}

		r.broadcast(Message{
			Type: "bookmark-comment-deleted",
			Payload: map[string]string{
				"bookmarkId": req.BookmarkID,
				"commentId":  req.CommentID,
			},
		}, "")
	}
}

func deepCopyMapData(m MapData) MapData {
	tiles := make(map[string]TileData, len(m.Tiles))
	for k, v := range m.Tiles {
		tiles[k] = v
	}

	layers := make(map[LayerType]LayerInfo, len(m.Layers))
	for k, v := range m.Layers {
		layers[k] = v
	}

	return MapData{
		Width:  m.Width,
		Height: m.Height,
		Tiles:  tiles,
		Layers: layers,
	}
}

func (r *Room) applyOperation(op Operation) {
	for _, cell := range op.Cells {
		key := fmt.Sprintf("%d,%d", cell.X, cell.Y)
		tile, exists := r.state.MapData.Tiles[key]
		if !exists {
			tile = TileData{}
		}

		switch op.Layer {
		case LayerTerrain:
			if v, ok := cell.Value.(float64); ok {
				tile.Terrain = TerrainType(int(v))
			}
		case LayerObstacle:
			if v, ok := cell.Value.(bool); ok {
				tile.Obstacle = v
			}
		case LayerDecoration:
			if v, ok := cell.Value.(float64); ok {
				tile.Decoration = int(v)
			}
		case LayerEvent:
			if v, ok := cell.Value.(float64); ok {
				tile.Event = int(v)
			}
		}

		r.state.MapData.Tiles[key] = tile
	}

	r.state.Operations = append(r.state.Operations, op)
	if len(r.state.Operations) > 1000 {
		r.state.Operations = r.state.Operations[len(r.state.Operations)-1000:]
	}
}

func (r *Room) broadcast(msg Message, excludeUser string) {
	data, err := json.Marshal(msg)
	if err != nil {
		return
	}

	for userID, conn := range r.clients {
		if userID == excludeUser {
			continue
		}
		conn.WriteMessage(websocket.TextMessage, data)
	}
}

func (r *Room) GetUsers() map[string]*User {
	r.mu.RLock()
	defer r.mu.RUnlock()

	users := make(map[string]*User)
	for k, v := range r.state.Users {
		users[k] = v
	}
	return users
}
