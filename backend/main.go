package main

import (
	"encoding/json"
	"log"
	"os"

	"github.com/gofiber/contrib/websocket"
	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
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
