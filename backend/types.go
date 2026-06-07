package main

import "time"

type TerrainType int

const (
	TerrainWalkable TerrainType = iota
	TerrainWall
	TerrainWater
	TerrainSand
	TerrainGrass
	TerrainSwamp
)

type LayerType int

const (
	LayerTerrain LayerType = iota
	LayerObstacle
	LayerDecoration
	LayerEvent
)

type Cell struct {
	X int `json:"x"`
	Y int `json:"y"`
}

type TileData struct {
	Terrain    TerrainType `json:"terrain"`
	Obstacle   bool        `json:"obstacle"`
	Decoration int         `json:"decoration"`
	Event      int         `json:"event"`
}

type MapData struct {
	Width  int                    `json:"width"`
	Height int                    `json:"height"`
	Tiles  map[string]TileData    `json:"tiles"`
	Layers map[LayerType]LayerInfo `json:"layers"`
}

type LayerInfo struct {
	Visible   bool    `json:"visible"`
	Locked    bool    `json:"locked"`
	Opacity   float64 `json:"opacity"`
}

type Operation struct {
	ID        string      `json:"id"`
	UserID    string      `json:"userId"`
	Timestamp int64       `json:"timestamp"`
	Type      string      `json:"type"`
	Layer     LayerType   `json:"layer"`
	Cells     []CellOp    `json:"cells"`
}

type CellOp struct {
	X     int         `json:"x"`
	Y     int         `json:"y"`
	Value interface{} `json:"value"`
}

type User struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Color    string `json:"color"`
	RoomID   string `json:"roomId"`
	Position *Cell  `json:"position,omitempty"`
}

type Message struct {
	Type    string      `json:"type"`
	Payload interface{} `json:"payload"`
}

type CursorUpdate struct {
	UserID string `json:"userId"`
	X      int    `json:"x"`
	Y      int    `json:"y"`
}

type PathBookmark struct {
	ID             string    `json:"id"`
	Name           string    `json:"name"`
	Algorithm      string    `json:"algorithm"`
	StartPoint     Cell      `json:"startPoint"`
	EndPoint       Cell      `json:"endPoint"`
	Path           []Cell    `json:"path"`
	ExploredCount  int       `json:"exploredCount"`
	TotalCost      float64   `json:"totalCost"`
	PathLength     int       `json:"pathLength"`
	TimeMs         int64     `json:"timeMs"`
	CreatedBy      string    `json:"createdBy"`
	CreatedByName  string    `json:"createdByName"`
	CreatedAt      int64     `json:"createdAt"`
}

type RecordedOperation struct {
	ID           string      `json:"id"`
	UserID       string      `json:"userId"`
	UserName     string      `json:"userName"`
	Timestamp    int64       `json:"timestamp"`
	TimeOffset   int64       `json:"timeOffset"`
	Type         string      `json:"type"`
	Layer        LayerType   `json:"layer"`
	Cells        []CellOp    `json:"cells"`
	BeforeValues []interface{} `json:"beforeValues"`
	AfterValues  []interface{} `json:"afterValues"`
}

type MapSnapshot struct {
	ID            string    `json:"id"`
	RoomID        string    `json:"roomId"`
	OperationIdx  int       `json:"operationIdx"`
	TimeOffset    int64     `json:"timeOffset"`
	MapData       MapData   `json:"mapData"`
	CreatedAt     int64     `json:"createdAt"`
}

type PlaybackBookmark struct {
	ID         string `json:"id"`
	RoomID     string `json:"roomId"`
	TimeOffset int64  `json:"timeOffset"`
	OperationIdx int  `json:"operationIdx"`
	Note       string `json:"note"`
	CreatedBy  string `json:"createdBy"`
	CreatedAt  int64  `json:"createdAt"`
}

type RecordingState struct {
	IsRecording    bool    `json:"isRecording"`
	StartTime      int64   `json:"startTime"`
	OperationCount int     `json:"operationCount"`
	MaxOperations  int     `json:"maxOperations"`
	IsStopped      bool    `json:"isStopped"`
}

type PlaybackState struct {
	UserID   string `json:"userId"`
	UserName string `json:"userName"`
	IsActive bool   `json:"isActive"`
}

type RoomState struct {
	ID         string                `json:"id"`
	MapData    MapData               `json:"mapData"`
	Users      map[string]*User      `json:"users"`
	Operations []Operation           `json:"operations"`
	Bookmarks  []PathBookmark        `json:"bookmarks"`
	CreatedAt  time.Time             `json:"createdAt"`
	Recording  RecordingState        `json:"recording"`
	Playbacks  map[string]PlaybackState `json:"playbacks"`
}
