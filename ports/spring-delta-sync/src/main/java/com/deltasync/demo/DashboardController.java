package com.deltasync.demo;

import jakarta.servlet.http.HttpServletRequest;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ThreadLocalRandom;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class DashboardController {
  private final DeltaSyncService deltaSyncService;
  private final List<Map<String, Object>> services;
  private int activeUsers = 1100;
  private int revenue = 250_000;

  public DashboardController(DeltaSyncService deltaSyncService) {
    this.deltaSyncService = deltaSyncService;
    this.services = buildServices();
  }

  @GetMapping("/api/dashboard")
  public ResponseEntity<String> dashboard(HttpServletRequest request) {
    activeUsers += 1;
    revenue += ThreadLocalRandom.current().nextInt(0, 120);

    Map<String, Object> payload = new HashMap<>();
    payload.put("activeUsers", activeUsers);
    payload.put("revenue", revenue);
    payload.put("services", services);

    Map<String, Object> meta = new HashMap<>();
    meta.put("timestamp", Instant.now().toString());
    meta.put("requestId", "r-" + ThreadLocalRandom.current().nextInt(10000, 99999));
    payload.put("meta", meta);

    String userScope = request.getHeader("X-User-Id") == null ? "anon" : request.getHeader("X-User-Id");
    return deltaSyncService.respond(request, payload, userScope);
  }

  @GetMapping("/health")
  public Map<String, Object> health() {
    return Map.of("ok", true);
  }

  private List<Map<String, Object>> buildServices() {
    List<Map<String, Object>> list = new ArrayList<>();
    String[] regions = new String[] {"us-east", "us-west", "eu-central", "ap-south"};

    for (int i = 0; i < 120; i++) {
      Map<String, Object> item = new HashMap<>();
      item.put("id", "svc-" + (i + 1));
      item.put("name", "Service " + (i + 1));
      item.put("region", regions[i % regions.length]);
      item.put("owner", "team-" + ((i % 12) + 1));
      item.put("status", "healthy");
      list.add(item);
    }
    return list;
  }
}
