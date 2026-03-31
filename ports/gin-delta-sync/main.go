package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	canonicaljson "github.com/gibson042/canonicaljson-go"
	"github.com/gin-gonic/gin"
	jsondiff "github.com/wI2L/jsondiff"
)

type cacheEntry struct {
	value     []byte
	expiresAt time.Time
}

type snapshotCache struct {
	mu         sync.Mutex
	maxEntries int
	ttl        time.Duration
	items      map[string]cacheEntry
}

func newSnapshotCache(maxEntries int, ttl time.Duration) *snapshotCache {
	return &snapshotCache{
		maxEntries: maxEntries,
		ttl:        ttl,
		items:      map[string]cacheEntry{},
	}
}

func (c *snapshotCache) Get(key string) ([]byte, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()

	entry, ok := c.items[key]
	if !ok {
		return nil, false
	}
	if time.Now().After(entry.expiresAt) {
		delete(c.items, key)
		return nil, false
	}
	return entry.value, true
}

func (c *snapshotCache) Set(key string, value []byte) {
	c.mu.Lock()
	defer c.mu.Unlock()

	c.items[key] = cacheEntry{value: value, expiresAt: time.Now().Add(c.ttl)}
	if len(c.items) <= c.maxEntries {
		return
	}

	for k := range c.items {
		delete(c.items, k)
		break
	}
}

func computeETag(payload []byte) string {
	sum := sha256.Sum256(payload)
	return fmt.Sprintf("\"%s\"", hex.EncodeToString(sum[:])[:16])
}

func stripPaths(payload map[string]any, ignorePaths []string) map[string]any {
	cloneRaw, _ := json.Marshal(payload)
	clone := map[string]any{}
	_ = json.Unmarshal(cloneRaw, &clone)

	for _, pointer := range ignorePaths {
		tokens := strings.Split(strings.Trim(pointer, "/"), "/")
		if len(tokens) == 0 || tokens[0] == "" {
			continue
		}

		var current any = clone
		for i := 0; i < len(tokens)-1; i++ {
			m, ok := current.(map[string]any)
			if !ok {
				current = nil
				break
			}
			current = m[tokens[i]]
			if current == nil {
				break
			}
		}

		m, ok := current.(map[string]any)
		if !ok {
			continue
		}
		delete(m, tokens[len(tokens)-1])
	}

	return clone
}

func makeDashboard() map[string]any {
	now := time.Now().UTC().Format(time.RFC3339Nano)
	widgets := make([]map[string]any, 120)
	for i := 0; i < 120; i++ {
		widgets[i] = map[string]any{
			"id":     fmt.Sprintf("widget-%d", i+1),
			"owner":  fmt.Sprintf("team-%d", (i%12)+1),
			"status": "ok",
		}
	}

	return map[string]any{
		"activeUsers": 1100 + (time.Now().Second() % 50),
		"revenue":     250000 + (time.Now().Second() * 30),
		"widgets":     widgets,
		"meta": map[string]any{
			"timestamp": now,
			"requestId": fmt.Sprintf("r-%d", time.Now().UnixNano()),
		},
	}
}

func main() {
	r := gin.Default()
	cache := newSnapshotCache(500, 10*time.Minute)
	ignorePaths := []string{"/meta/timestamp", "/meta/requestId"}

	r.GET("/api/dashboard", func(c *gin.Context) {
		payload := makeDashboard()
		diffPayload := stripPaths(payload, ignorePaths)

		fullRaw, _ := json.Marshal(payload)
		stableRaw, _ := canonicaljson.Marshal(diffPayload)

		etag := computeETag(stableRaw)
		clientEtag := c.GetHeader("If-None-Match")
		accept := c.GetHeader("Accept")
		wantsPatch := strings.Contains(accept, "application/json-patch+json")

		c.Header("Cache-Control", "private, no-store")
		c.Header("Vary", "If-None-Match, Accept")

		if clientEtag == etag {
			c.Status(http.StatusNotModified)
			return
		}

		userScope := c.GetHeader("X-User-Id")
		if userScope == "" {
			userScope = "anon"
		}
		cacheKey := func(tag string) string { return userScope + ":" + tag }

		if wantsPatch && clientEtag != "" {
			if prev, ok := cache.Get(cacheKey(clientEtag)); ok {
				patchOps, err := jsondiff.CompareJSON(prev, stableRaw)
				if err == nil {
					patchRaw, err := json.Marshal(patchOps)
					if err != nil {
						c.Header("X-Delta-Sync", "full-fallback")
						goto fullResponse
					}
					if len(patchRaw) < len(fullRaw) {
						cache.Set(cacheKey(etag), stableRaw)
						c.Header("ETag", etag)
						c.Header("Content-Type", "application/json-patch+json")
						c.Header("X-Delta-Sync", "patch")
						c.Header("X-Delta-Full-Size", fmt.Sprintf("%d", len(fullRaw)))
						c.Header("X-Delta-Patch-Size", fmt.Sprintf("%d", len(patchRaw)))
						c.Data(http.StatusOK, "application/json-patch+json", patchRaw)
						return
					}
					c.Header("X-Delta-Sync", "full-fallback")
				}
			}
		}

	fullResponse:
		cache.Set(cacheKey(etag), stableRaw)
		c.Header("ETag", etag)
		c.Header("Content-Type", "application/json")
		if c.Writer.Header().Get("X-Delta-Sync") == "" {
			c.Header("X-Delta-Sync", "full")
		}
		c.Data(http.StatusOK, "application/json", fullRaw)
	})

	_ = r.Run(":4300")
}
