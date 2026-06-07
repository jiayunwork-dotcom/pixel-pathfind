package main

import (
	"encoding/json"
	"log"
	"os"
	"strings"
	"time"

	"github.com/gofiber/contrib/websocket"
	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/google/uuid"
)

var roomManager *RoomManager

type wsMessage struct {
	Type    string          `json:"type"`
	Payload json.RawMessage `json:"payload"`
}

func main() {
	store := NewStore()
	roomManager = NewRoomManager(store)

	app := fiber.New()

	app.Use(cors.New(cors.Config{
		AllowOrigins: "*",
		AllowMethods: "GET,POST,PUT,DELETE,OPTIONS",
		AllowHeaders: "Origin,Content-Type,Accept",
	}))

	app.Get("/api/room/create", func(c *fiber.Ctx) error {
		roomID := roomManager.CreateRoom()
		return c.JSON(fiber.Map{
			"roomId": roomID,
		})
	})

	app.Get("/api/room/:id/exists", func(c *fiber.Ctx) error {
		roomID := c.Params("id")
		_, exists := roomManager.GetRoom(roomID)
		return c.JSON(fiber.Map{
			"exists": exists,
		})
	})

	app.Get("/api/room/:id/algorithms", func(c *fiber.Ctx) error {
		roomID := c.Params("id")
		algorithms, err := roomManager.store.LoadAlgorithms(roomID)
		if err != nil {
			return c.JSON(fiber.Map{"algorithms": []CustomAlgorithm{}})
		}
		return c.JSON(fiber.Map{"algorithms": algorithms})
	})

	app.Post("/api/room/:id/algorithms", func(c *fiber.Ctx) error {
		roomID := c.Params("id")
		userID := c.Get("X-User-ID")
		userName := c.Get("X-User-Name")

		if userID == "" || userName == "" {
			return c.Status(400).JSON(fiber.Map{"error": "用户信息缺失"})
		}

		var req SaveAlgorithmRequest
		if err := c.BodyParser(&req); err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "请求格式错误"})
		}

		name := strings.TrimSpace(req.Name)
		if name == "" {
			return c.Status(400).JSON(fiber.Map{"error": "算法名称不能为空"})
		}
		if len(name) > 20 {
			return c.Status(400).JSON(fiber.Map{"error": "算法名称不能超过20字"})
		}

		now := time.Now().UnixNano() / int64(time.Millisecond)
		algorithm := CustomAlgorithm{
			ID:         req.ID,
			Name:       name,
			Code:       req.Code,
			AuthorID:   userID,
			AuthorName: userName,
			CreatedAt:  now,
			UpdatedAt:  now,
		}

		if algorithm.ID == "" {
			algorithm.ID = uuid.New().String()
			algorithm.CreatedAt = now
		} else {
			existing, err := roomManager.store.LoadAlgorithm(roomID, algorithm.ID)
			if err == nil {
				algorithm.CreatedAt = existing.CreatedAt
			}
		}

		if err := roomManager.store.SaveAlgorithm(roomID, algorithm); err != nil {
			return c.Status(500).JSON(fiber.Map{"error": "保存失败"})
		}

		room, exists := roomManager.GetRoom(roomID)
		if exists {
			room.broadcast(Message{
				Type: "algorithm-updated",
				Payload: algorithm,
			}, "")
		}

		return c.JSON(fiber.Map{"algorithm": algorithm})
	})

	app.Delete("/api/room/:id/algorithms/:algoId", func(c *fiber.Ctx) error {
		roomID := c.Params("id")
		algoID := c.Params("algoId")
		userID := c.Get("X-User-ID")

		if userID == "" {
			return c.Status(400).JSON(fiber.Map{"error": "用户信息缺失"})
		}

		deleted, err := roomManager.store.DeleteAlgorithm(roomID, algoID, userID)
		if err != nil {
			return c.Status(400).JSON(fiber.Map{"error": err.Error()})
		}

		if deleted {
			room, exists := roomManager.GetRoom(roomID)
			if exists {
				room.broadcast(Message{
					Type: "algorithm-deleted",
					Payload: map[string]string{"id": algoID},
				}, "")
			}
		}

		return c.JSON(fiber.Map{"success": true})
	})

	app.Post("/api/algorithm/execute", func(c *fiber.Ctx) error {
		var req ExecuteAlgorithmRequest
		if err := c.BodyParser(&req); err != nil {
			return c.Status(400).JSON(fiber.Map{"error": "请求格式错误"})
		}

		if strings.TrimSpace(req.Code) == "" {
			return c.Status(400).JSON(fiber.Map{"error": "代码不能为空"})
		}

		customResult := ExecuteInSandbox(req.Code, req.MapData, req.StartPoint, req.EndPoint)
		bfsResult := BFSAlgorithm(req.MapData, req.StartPoint, req.EndPoint)

		customResp := ExecuteAlgorithmResponse{
			Path:       customResult.Path,
			PathLength: customResult.PathLength,
			TotalCost:  customResult.TotalCost,
			TimeMs:     customResult.TimeMs,
			Error:      customResult.Error,
		}

		bfsResp := ExecuteAlgorithmResponse{
			Path:       bfsResult.Path,
			PathLength: bfsResult.PathLength,
			TotalCost:  bfsResult.TotalCost,
			TimeMs:     bfsResult.TimeMs,
		}

		betterThanBFS := false
		if customResult.Error == "" && customResult.PathLength > 0 && bfsResult.PathLength > 0 {
			betterThanBFS = customResult.TotalCost < bfsResult.TotalCost
		}

		return c.JSON(CompareAlgorithmResponse{
			CustomResult:  customResp,
			BFSResult:     bfsResp,
			BetterThanBFS: betterThanBFS,
		})
	})

	app.Get("/ws/:roomId/:userName", websocket.New(func(c *websocket.Conn) {
		roomID := c.Params("roomId")
		userName := c.Params("userName")

		user, err := roomManager.JoinRoom(roomID, userName, c)
		if err != nil {
			c.WriteJSON(fiber.Map{"error": err.Error()})
			c.Close()
			return
		}

		defer roomManager.LeaveRoom(roomID, user.ID)

		for {
			_, msg, err := c.ReadMessage()
			if err != nil {
				log.Printf("Read error: %v", err)
				break
			}

			var wsMsg wsMessage
			if err := json.Unmarshal(msg, &wsMsg); err != nil {
				log.Printf("Unmarshal error: %v", err)
				continue
			}

			room, exists := roomManager.GetRoom(roomID)
			if !exists {
				break
			}

			room.HandleMessage(user.ID, wsMsg.Type, wsMsg.Payload)
		}
	}))

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	log.Printf("Server starting on port %s", port)
	log.Fatal(app.Listen(":" + port))
}
