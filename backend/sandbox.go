package main

import (
	"context"
	"errors"
	"fmt"
	"math"
	"runtime"
	"time"

	"github.com/dop251/goja"
	"github.com/dop251/goja/parser"
)

const (
	MaxExecutionTime = 3 * time.Second
	MaxMemory        = 50 * 1024 * 1024
)

type SandboxResult struct {
	Path      []Cell
	PathLength int
	TotalCost float64
	TimeMs    int64
	Error     string
}

func terrainToCost(t TerrainType) float64 {
	switch t {
	case TerrainWalkable:
		return 1
	case TerrainWall:
		return math.Inf(1)
	case TerrainWater:
		return 3
	case TerrainSand:
		return 2
	case TerrainGrass:
		return 1.5
	case TerrainSwamp:
		return 5
	default:
		return 1
	}
}

func buildCostMap(mapData MapData) [][]float64 {
	costMap := make([][]float64, mapData.Height)
	for y := 0; y < mapData.Height; y++ {
		costMap[y] = make([]float64, mapData.Width)
		for x := 0; x < mapData.Width; x++ {
			key := fmt.Sprintf("%d,%d", x, y)
			tile, exists := mapData.Tiles[key]
			if !exists {
				costMap[y][x] = 1
				continue
			}
			if tile.Obstacle {
				costMap[y][x] = math.Inf(1)
			} else {
				costMap[y][x] = terrainToCost(tile.Terrain)
			}
		}
	}
	return costMap
}

func calculatePathCost(path []Cell, costMap [][]float64) float64 {
	if len(path) < 2 {
		return 0
	}
	total := 0.0
	for i := 1; i < len(path); i++ {
		prev := path[i-1]
		curr := path[i]
		cost := costMap[curr.Y][curr.X]
		isDiagonal := prev.X != curr.X && prev.Y != curr.Y
		if isDiagonal {
			total += cost * math.Sqrt2
		} else {
			total += cost
		}
	}
	return total
}

func ExecuteInSandbox(code string, mapData MapData, start, end Cell) SandboxResult {
	startTime := time.Now()
	result := SandboxResult{}

	vm := goja.New()
	vm.SetParserOptions(parser.WithDisableSourceMaps)

	ctx, cancel := context.WithTimeout(context.Background(), MaxExecutionTime)
	defer cancel()

	interrupted := make(chan struct{})
	go func() {
		<-ctx.Done()
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			vm.Interrupt("execution timeout")
			close(interrupted)
		}
	}()

	memMonitor := make(chan struct{})
	go func() {
		ticker := time.NewTicker(100 * time.Millisecond)
		defer ticker.Stop()
		for {
			select {
			case <-memMonitor:
				return
			case <-ticker.C:
				var m runtime.MemStats
				runtime.ReadMemStats(&m)
				if m.Alloc > uint64(MaxMemory) {
					vm.Interrupt("memory limit exceeded")
					return
				}
			}
		}
	}()
	defer close(memMonitor)

	vm.Set("console", map[string]interface{}{
		"log":   func(call goja.FunctionCall) goja.Value { return goja.Undefined() },
		"warn":  func(call goja.FunctionCall) goja.Value { return goja.Undefined() },
		"error": func(call goja.FunctionCall) goja.Value { return goja.Undefined() },
	})

	forbidden := []string{"require", "import", "fetch", "XMLHttpRequest", "WebSocket",
		"process", "fs", "os", "child_process", "net", "http", "https", "dns", "tls", "zlib",
		"Buffer", "FileReader", "File", "Blob", "FormData", "navigator", "window", "document"}
	for _, name := range forbidden {
		vm.Set(name, nil)
	}

	costMap := buildCostMap(mapData)

	vm.Set("costMap", costMap)
	vm.Set("width", mapData.Width)
	vm.Set("height", mapData.Height)
	vm.Set("startX", start.X)
	vm.Set("startY", start.Y)
	vm.Set("endX", end.X)
	vm.Set("endY", end.Y)

	fullCode := `
		(function() {
			` + code + `
			if (typeof findPath !== 'function') {
				throw new Error('必须定义 findPath 函数');
			}
			var result = findPath(costMap, startX, startY, endX, endY);
			if (!Array.isArray(result)) {
				throw new Error('返回值必须是坐标数组');
			}
			return result;
		})()
	`

	scriptResult, err := vm.RunString(fullCode)

	elapsed := time.Since(startTime).Milliseconds()
	result.TimeMs = elapsed

	if err != nil {
		select {
		case <-interrupted:
			result.Error = "执行超时（超过3秒）"
		default:
			if gojaErr, ok := err.(*goja.Exception); ok {
				result.Error = gojaErr.Error()
			} else {
				result.Error = err.Error()
			}
		}
		return result
	}

	exported := scriptResult.Export()
	pathArr, ok := exported.([]interface{})
	if !ok {
		result.Error = "返回值格式错误，必须是坐标数组"
		return result
	}

	path := make([]Cell, 0, len(pathArr))
	for _, item := range pathArr {
		cell, ok := item.(map[string]interface{})
		if !ok {
			arr, ok := item.([]interface{})
			if ok && len(arr) == 2 {
				x, ok1 := arr[0].(float64)
				y, ok2 := arr[1].(float64)
				if ok1 && ok2 {
					path = append(path, Cell{X: int(x), Y: int(y)})
				}
			}
			continue
		}
		x, okX := cell["x"].(float64)
		y, okY := cell["y"].(float64)
		if !okX || !okY {
			x, okX = cell["X"].(float64)
			y, okY = cell["Y"].(float64)
		}
		if okX && okY {
			path = append(path, Cell{X: int(x), Y: int(y)})
		}
	}

	if len(path) == 0 {
		result.Path = []Cell{}
		result.PathLength = 0
		result.TotalCost = 0
		return result
	}

	if path[0].X != start.X || path[0].Y != start.Y {
		path = append([]Cell{start}, path...)
	}

	if path[len(path)-1].X != end.X || path[len(path)-1].Y != end.Y {
		path = append(path, end)
	}

	for i, cell := range path {
		if cell.X < 0 || cell.X >= mapData.Width || cell.Y < 0 || cell.Y >= mapData.Height {
			result.Error = fmt.Sprintf("路径越界: 第%d个点(%d,%d)", i, cell.X, cell.Y)
			return result
		}
		if math.IsInf(costMap[cell.Y][cell.X], 1) && !(i == 0 || i == len(path)-1) {
			result.Error = fmt.Sprintf("路径经过障碍物: 第%d个点(%d,%d)", i, cell.X, cell.Y)
			return result
		}
	}

	result.Path = path
	result.PathLength = len(path)
	result.TotalCost = calculatePathCost(path, costMap)

	return result
}

func BFSAlgorithm(mapData MapData, start, end Cell) SandboxResult {
	startTime := time.Now()
	result := SandboxResult{}

	costMap := buildCostMap(mapData)

	visited := make(map[string]bool)
	parent := make(map[string]*Cell)
	queue := []Cell{start}
	visited[fmt.Sprintf("%d,%d", start.X, start.Y)] = true

	directions := []Cell{
		{X: 1, Y: 0}, {X: -1, Y: 0}, {X: 0, Y: 1}, {X: 0, Y: -1},
		{X: 1, Y: 1}, {X: 1, Y: -1}, {X: -1, Y: 1}, {X: -1, Y: -1},
	}

	found := false
	for len(queue) > 0 {
		current := queue[0]
		queue = queue[1:]

		if current.X == end.X && current.Y == end.Y {
			found = true
			break
		}

		for _, dir := range directions {
			nx := current.X + dir.X
			ny := current.Y + dir.Y

			if nx < 0 || nx >= mapData.Width || ny < 0 || ny >= mapData.Height {
				continue
			}

			key := fmt.Sprintf("%d,%d", nx, ny)
			if visited[key] {
				continue
			}

			if math.IsInf(costMap[ny][nx], 1) {
				continue
			}

			visited[key] = true
			parent[key] = &Cell{X: current.X, Y: current.Y}
			queue = append(queue, Cell{X: nx, Y: ny})
		}
	}

	if !found {
		result.Path = []Cell{}
		result.PathLength = 0
		result.TotalCost = 0
		result.TimeMs = time.Since(startTime).Milliseconds()
		return result
	}

	path := []Cell{}
	current := &end
	for current != nil {
		path = append([]Cell{*current}, path...)
		key := fmt.Sprintf("%d,%d", current.X, current.Y)
		current = parent[key]
	}

	result.Path = path
	result.PathLength = len(path)
	result.TotalCost = calculatePathCost(path, costMap)
	result.TimeMs = time.Since(startTime).Milliseconds()

	return result
}
