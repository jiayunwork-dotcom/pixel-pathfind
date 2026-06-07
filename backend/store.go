package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"sort"
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

func (s *Store) SaveRecordedOperation(roomID string, op RecordedOperation) error {
	data, err := json.Marshal(op)
	if err != nil {
		return err
	}

	key := fmt.Sprintf("room:%s:recorded_ops", roomID)
	return s.rdb.RPush(ctx, key, data).Err()
}

func (s *Store) GetRecordedOperations(roomID string, fromIdx, toIdx int) ([]RecordedOperation, error) {
	key := fmt.Sprintf("room:%s:recorded_ops", roomID)

	var start, stop int64
	if fromIdx < 0 {
		start = 0
	} else {
		start = int64(fromIdx)
	}

	if toIdx < 0 || toIdx > 10000 {
		stop = -1
	} else {
		stop = int64(toIdx) - 1
	}

	result, err := s.rdb.LRange(ctx, key, start, stop).Result()
	if err != nil {
		return nil, err
	}

	var ops []RecordedOperation
	for _, item := range result {
		var op RecordedOperation
		if err := json.Unmarshal([]byte(item), &op); err != nil {
			continue
		}
		ops = append(ops, op)
	}

	return ops, nil
}

func (s *Store) SaveSnapshot(roomID string, snapshot MapSnapshot) error {
	data, err := json.Marshal(snapshot)
	if err != nil {
		return err
	}

	key := fmt.Sprintf("room:%s:snapshots", roomID)
	return s.rdb.HSet(ctx, key, snapshot.ID, data).Err()
}

func (s *Store) GetSnapshots(roomID string) ([]MapSnapshot, error) {
	key := fmt.Sprintf("room:%s:snapshots", roomID)
	result, err := s.rdb.HGetAll(ctx, key).Result()
	if err != nil {
		return nil, err
	}

	var snapshots []MapSnapshot
	for _, item := range result {
		var snapshot MapSnapshot
		if err := json.Unmarshal([]byte(item), &snapshot); err != nil {
			continue
		}
		snapshots = append(snapshots, snapshot)
	}

	sort.Slice(snapshots, func(i, j int) bool {
		return snapshots[i].OperationIdx < snapshots[j].OperationIdx
	})

	return snapshots, nil
}

func (s *Store) AddPlaybackBookmark(roomID string, bookmark PlaybackBookmark) error {
	bookmarks, err := s.GetPlaybackBookmarks(roomID)
	if err != nil {
		return err
	}

	bookmarks = append(bookmarks, bookmark)
	return s.SavePlaybackBookmarks(roomID, bookmarks)
}

func (s *Store) SavePlaybackBookmarks(roomID string, bookmarks []PlaybackBookmark) error {
	data, err := json.Marshal(bookmarks)
	if err != nil {
		return err
	}

	key := fmt.Sprintf("room:%s:playback_bookmarks", roomID)
	return s.rdb.Set(ctx, key, data, 24*time.Hour).Err()
}

func (s *Store) GetPlaybackBookmarks(roomID string) ([]PlaybackBookmark, error) {
	key := fmt.Sprintf("room:%s:playback_bookmarks", roomID)
	data, err := s.rdb.Get(ctx, key).Result()
	if err != nil {
		if err == redis.Nil {
			return []PlaybackBookmark{}, nil
		}
		return nil, err
	}

	var bookmarks []PlaybackBookmark
	if err := json.Unmarshal([]byte(data), &bookmarks); err != nil {
		return nil, err
	}

	sort.Slice(bookmarks, func(i, j int) bool {
		return bookmarks[i].TimeOffset < bookmarks[j].TimeOffset
	})

	return bookmarks, nil
}

func (s *Store) DeletePlaybackBookmark(roomID, bookmarkID string) error {
	bookmarks, err := s.GetPlaybackBookmarks(roomID)
	if err != nil {
		return err
	}

	for i, b := range bookmarks {
		if b.ID == bookmarkID {
			bookmarks = append(bookmarks[:i], bookmarks[i+1:]...)
			break
		}
	}

	return s.SavePlaybackBookmarks(roomID, bookmarks)
}

func (s *Store) DeleteRoom(roomID string) error {
	pipe := s.rdb.TxPipeline()
	pipe.Del(ctx, fmt.Sprintf("room:%s", roomID))
	pipe.Del(ctx, fmt.Sprintf("room:%s:ops", roomID))
	pipe.Del(ctx, fmt.Sprintf("room:%s:bookmarks", roomID))
	pipe.Del(ctx, fmt.Sprintf("room:%s:recorded_ops", roomID))
	pipe.Del(ctx, fmt.Sprintf("room:%s:snapshots", roomID))
	pipe.Del(ctx, fmt.Sprintf("room:%s:playback_bookmarks", roomID))
	pipe.Del(ctx, fmt.Sprintf("room:%s:algorithms", roomID))

	bookmarks, err := s.LoadBookmarks(roomID)
	if err == nil {
		for _, b := range bookmarks {
			pipe.Del(ctx, fmt.Sprintf("room:%s:bookmark:%s:comments", roomID, b.ID))
		}
	}

	iter := s.rdb.Scan(ctx, 0, fmt.Sprintf("room:%s:bookmark:*:comments", roomID), 0).Iterator()
	for iter.Next(ctx) {
		pipe.Del(ctx, iter.Val())
	}

	_, err = pipe.Exec(ctx)
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

func (s *Store) SaveBookmarks(roomID string, bookmarks []PathBookmark) error {
	data, err := json.Marshal(bookmarks)
	if err != nil {
		return err
	}

	key := fmt.Sprintf("room:%s:bookmarks", roomID)
	return s.rdb.Set(ctx, key, data, 24*time.Hour).Err()
}

func (s *Store) LoadBookmarks(roomID string) ([]PathBookmark, error) {
	key := fmt.Sprintf("room:%s:bookmarks", roomID)
	data, err := s.rdb.Get(ctx, key).Result()
	if err != nil {
		if err == redis.Nil {
			return []PathBookmark{}, nil
		}
		return nil, err
	}

	var bookmarks []PathBookmark
	if err := json.Unmarshal([]byte(data), &bookmarks); err != nil {
		return nil, err
	}

	return bookmarks, nil
}

func (s *Store) SaveBookmarkComment(roomID string, comment BookmarkComment) error {
	comments, err := s.LoadBookmarkComments(roomID, comment.BookmarkID)
	if err != nil {
		return err
	}

	comments = append(comments, comment)
	if len(comments) > 20 {
		comments = comments[len(comments)-20:]
	}

	data, err := json.Marshal(comments)
	if err != nil {
		return err
	}

	key := fmt.Sprintf("room:%s:bookmark:%s:comments", roomID, comment.BookmarkID)
	return s.rdb.Set(ctx, key, data, 24*time.Hour).Err()
}

func (s *Store) LoadBookmarkComments(roomID, bookmarkID string) ([]BookmarkComment, error) {
	key := fmt.Sprintf("room:%s:bookmark:%s:comments", roomID, bookmarkID)
	data, err := s.rdb.Get(ctx, key).Result()
	if err != nil {
		if err == redis.Nil {
			return []BookmarkComment{}, nil
		}
		return nil, err
	}

	var comments []BookmarkComment
	if err := json.Unmarshal([]byte(data), &comments); err != nil {
		return nil, err
	}

	return comments, nil
}

func (s *Store) DeleteBookmarkComment(roomID, bookmarkID, commentID, userID string) (bool, error) {
	comments, err := s.LoadBookmarkComments(roomID, bookmarkID)
	if err != nil {
		return false, err
	}

	found := false
	deleted := false
	for i, c := range comments {
		if c.ID == commentID {
			found = true
			if c.UserID == userID {
				comments = append(comments[:i], comments[i+1:]...)
				deleted = true
			}
			break
		}
	}

	if !found {
		return false, fmt.Errorf("comment not found")
	}

	if !deleted {
		return false, fmt.Errorf("permission denied")
	}

	data, err := json.Marshal(comments)
	if err != nil {
		return false, err
	}

	key := fmt.Sprintf("room:%s:bookmark:%s:comments", roomID, bookmarkID)
	return true, s.rdb.Set(ctx, key, data, 24*time.Hour).Err()
}

func (s *Store) LoadAllBookmarkComments(roomID string, bookmarkIDs []string) (map[string][]BookmarkComment, error) {
	result := make(map[string][]BookmarkComment)
	for _, bookmarkID := range bookmarkIDs {
		comments, err := s.LoadBookmarkComments(roomID, bookmarkID)
		if err != nil {
			continue
		}
		result[bookmarkID] = comments
	}
	return result, nil
}

func (s *Store) SaveAlgorithm(roomID string, algorithm CustomAlgorithm) error {
	key := fmt.Sprintf("room:%s:algorithms", roomID)
	algorithms, err := s.LoadAlgorithms(roomID)
	if err != nil {
		algorithms = []CustomAlgorithm{}
	}

	exists := false
	for i, a := range algorithms {
		if a.ID == algorithm.ID {
			algorithms[i] = algorithm
			exists = true
			break
		}
	}

	if !exists {
		if len(algorithms) >= 5 {
			algorithms = algorithms[1:]
		}
		algorithms = append(algorithms, algorithm)
	}

	data, err := json.Marshal(algorithms)
	if err != nil {
		return err
	}
	return s.rdb.Set(ctx, key, data, 24*time.Hour).Err()
}

func (s *Store) LoadAlgorithms(roomID string) ([]CustomAlgorithm, error) {
	key := fmt.Sprintf("room:%s:algorithms", roomID)
	data, err := s.rdb.Get(ctx, key).Result()
	if err != nil {
		if err == redis.Nil {
			return []CustomAlgorithm{}, nil
		}
		return nil, err
	}

	var algorithms []CustomAlgorithm
	if err := json.Unmarshal([]byte(data), &algorithms); err != nil {
		return nil, err
	}
	return algorithms, nil
}

func (s *Store) DeleteAlgorithm(roomID, algorithmID, userID string) (bool, error) {
	key := fmt.Sprintf("room:%s:algorithms", roomID)
	algorithms, err := s.LoadAlgorithms(roomID)
	if err != nil {
		return false, err
	}

	found := false
	allowed := false
	for i, a := range algorithms {
		if a.ID == algorithmID {
			found = true
			if a.AuthorID == userID {
				allowed = true
				algorithms = append(algorithms[:i], algorithms[i+1:]...)
			}
			break
		}
	}

	if !found {
		return false, fmt.Errorf("algorithm not found")
	}

	if !allowed {
		return false, fmt.Errorf("permission denied")
	}

	data, err := json.Marshal(algorithms)
	if err != nil {
		return false, err
	}
	return true, s.rdb.Set(ctx, key, data, 24*time.Hour).Err()
}

func (s *Store) LoadAlgorithm(roomID, algorithmID string) (*CustomAlgorithm, error) {
	algorithms, err := s.LoadAlgorithms(roomID)
	if err != nil {
		return nil, err
	}

	for _, a := range algorithms {
		if a.ID == algorithmID {
			return &a, nil
		}
	}
	return nil, fmt.Errorf("algorithm not found")
}
