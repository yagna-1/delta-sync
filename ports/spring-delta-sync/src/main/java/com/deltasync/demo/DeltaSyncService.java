package com.deltasync.demo;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.MapperFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.flipkart.zjsonpatch.JsonDiff;
import jakarta.servlet.http.HttpServletRequest;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;

@Service
public class DeltaSyncService {
  private final ObjectMapper canonicalMapper;
  private final Map<String, CacheEntry> cache = new ConcurrentHashMap<>();
  private final int maxEntries = 500;
  private final Duration ttl = Duration.ofMinutes(10);

  public DeltaSyncService() {
    this.canonicalMapper = new ObjectMapper();
    this.canonicalMapper.configure(MapperFeature.SORT_PROPERTIES_ALPHABETICALLY, true);
    this.canonicalMapper.configure(SerializationFeature.ORDER_MAP_ENTRIES_BY_KEYS, true);
  }

  public ResponseEntity<String> respond(HttpServletRequest request, Object payload, String userScope) {
    try {
      JsonNode fullNode = canonicalMapper.valueToTree(payload);
      JsonNode diffNode = fullNode.deepCopy();
      if (diffNode.has("meta") && diffNode.get("meta").isObject()) {
        ((com.fasterxml.jackson.databind.node.ObjectNode) diffNode.get("meta")).remove("timestamp");
        ((com.fasterxml.jackson.databind.node.ObjectNode) diffNode.get("meta")).remove("requestId");
      }

      String fullBody = canonicalMapper.writeValueAsString(fullNode);
      int fullSize = fullBody.getBytes(StandardCharsets.UTF_8).length;

      String etag = computeEtag(canonicalMapper.writeValueAsString(diffNode));
      String clientEtag = request.getHeader("If-None-Match");
      boolean wantsPatch = Optional.ofNullable(request.getHeader("Accept"))
          .orElse("")
          .contains("application/json-patch+json");

      HttpHeaders base = new HttpHeaders();
      base.set("Cache-Control", "private, no-store");
      base.set("Vary", "If-None-Match, Accept");

      if (etag.equals(clientEtag)) {
        return new ResponseEntity<>(null, base, HttpStatus.NOT_MODIFIED);
      }

      String key = userScope + ":";
      if (wantsPatch && clientEtag != null && !clientEtag.isBlank()) {
        JsonNode prev = getCached(key + clientEtag);
        if (prev != null) {
          JsonNode patchNode = JsonDiff.asJson(prev, diffNode);
          String patchBody = canonicalMapper.writeValueAsString(patchNode);
          int patchSize = patchBody.getBytes(StandardCharsets.UTF_8).length;

          if (patchSize < fullSize) {
            setCached(key + etag, diffNode);
            HttpHeaders headers = new HttpHeaders();
            headers.putAll(base);
            headers.setETag(etag);
            headers.setContentType(MediaType.valueOf("application/json-patch+json"));
            headers.set("X-Delta-Sync", "patch");
            headers.set("X-Delta-Full-Size", String.valueOf(fullSize));
            headers.set("X-Delta-Patch-Size", String.valueOf(patchSize));
            return new ResponseEntity<>(patchBody, headers, HttpStatus.OK);
          }

          base.set("X-Delta-Sync", "full-fallback");
        }
      }

      setCached(key + etag, diffNode);
      HttpHeaders headers = new HttpHeaders();
      headers.putAll(base);
      headers.setETag(etag);
      headers.setContentType(MediaType.APPLICATION_JSON);
      if (!headers.containsKey("X-Delta-Sync")) {
        headers.set("X-Delta-Sync", "full");
      }
      return new ResponseEntity<>(fullBody, headers, HttpStatus.OK);

    } catch (Exception ex) {
      return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
          .contentType(MediaType.APPLICATION_JSON)
          .body("{\"error\":\"delta-sync failure\"}");
    }
  }

  private String computeEtag(String stableJson) throws Exception {
    MessageDigest digest = MessageDigest.getInstance("SHA-256");
    byte[] hash = digest.digest(stableJson.getBytes(StandardCharsets.UTF_8));
    StringBuilder sb = new StringBuilder();
    for (int i = 0; i < 8; i++) {
      sb.append(String.format("%02x", hash[i]));
    }
    return "\"" + sb + "\"";
  }

  private JsonNode getCached(String key) {
    CacheEntry entry = cache.get(key);
    if (entry == null) return null;
    if (Instant.now().isAfter(entry.expiresAt)) {
      cache.remove(key);
      return null;
    }
    return entry.value;
  }

  private void setCached(String key, JsonNode value) {
    cache.put(key, new CacheEntry(value, Instant.now().plus(ttl)));
    if (cache.size() <= maxEntries) return;
    String victim = cache.keySet().iterator().next();
    cache.remove(victim);
  }

  private record CacheEntry(JsonNode value, Instant expiresAt) {}
}
