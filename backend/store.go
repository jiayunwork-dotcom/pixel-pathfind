package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"time"

	"github.com/redis/go-redis/v9"
)

var ctx = context.Background()

type Store struct {
	rdb *redis.Client
}

func NewStore() *Store {
	redisAddr := os.Getenv("REDIS_ADDR")
	if redisAddr == "" {
		redisAddr = "localhost:6379"
	}

	rdb := redis.NewClient(&redis.Options{
		Addr: redisAddr,
	})

	return &Store{rdb: rdb}
}

func (s *Store) SaveRoom(room *RoomState) error {
	data, err := json.Marshal(room)
	if err != nil {
		return err
	}

	key := fmt.Sprintf("room:%s", room.ID)
	return s.rdb.Set(ctx, key, data, 24*time.Hour).Err()
}

func (s *Store) LoadRoom(roomID string) (*RoomState, error) {
	key := fmt.Sprintf("room:%s", roomID)
	data, err := s.rdb.Get(ctx, key).Result()
	if err != nil {
		return nil, err
	}

	var room RoomState
	if err := json.Unmarshal([]byte(data), &room); err != nil {
		return nil, err
	}

	return &room, nil
}

func (s *Store) SaveOperation(roomID string, op Operation) error {
	data, err := json.Marshal(op)
	if err != nil {
		return err
	}

	key := fmt.Sprintf("room:%s:ops", roomID)
	score := float64(op.Timestamp)
	return s.rdb.ZAdd(ctx, key, redis.Z{Score: score, Member: data}).Err()
}

func (s *Store) GetOperations(roomID string, since int64) ([]Operation, error) {
	key := fmt.Sprintf("room:%s:ops", roomID)
	result, err := s.rdb.ZRangeByScore(ctx, key, &redis.ZRangeBy{
		Min: fmt.Sprintf("%d", since+1),
		Max: "+inf",
	}).Result()
	if err != nil {
		return nil, err
	}

	var ops []Operation
	for _, item := range result {
		var op Operation
		if err := json.Unmarshal([]byte(item), &op); err != nil {
			continue
		}
		ops = append(ops, op)
	}

	return ops, nil
}

func (s *Store) DeleteRoom(roomID string) error {
	pipe := s.rdb.TxPipeline()
	pipe.Del(ctx, fmt.Sprintf("room:%s", roomID))
	pipe.Del(ctx, fmt.Sprintf("room:%s:ops", roomID))
	_, err := pipe.Exec(ctx)
	return err
}

func (s *Store) RoomExists(roomID string) (bool, error) {
	key := fmt.Sprintf("room:%s", roomID)
	exists, err := s.rdb.Exists(ctx, key).Result()
	if err != nil {
		return false, err
	}
	return exists > 0, nil
}
