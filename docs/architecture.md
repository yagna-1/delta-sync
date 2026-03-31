# Architecture

## High-level flow

```mermaid
flowchart LR
    A["Client Poller"] --> B["GET /api/resource<br/>Accept: application/json-patch+json"]
    B --> C["Delta-Sync Middleware"]
    C --> D["Normalize Payload<br/>Ignore noisy paths"]
    D --> E["Compute ETag (sha256 stable JSON)"]
    E --> F{"If-None-Match == ETag?"}
    F -- "Yes" --> G["304 Not Modified"]
    F -- "No" --> H{"Has previous snapshot for client ETag?"}
    H -- "No" --> I["Send Full JSON<br/>X-Delta-Sync: full"]
    H -- "Yes" --> J["Compute JSON Diff"]
    J --> K{"Patch smaller than full?"}
    K -- "Yes" --> L["Send RFC6902 Patch<br/>X-Delta-Sync: patch"]
    K -- "No" --> M["Send Full JSON<br/>X-Delta-Sync: full-fallback"]
    I --> N["Store snapshot by scope+etag"]
    L --> N
    M --> N
```

## Components

- `src/middleware/deltaSync.ts`
- diff, ETag, patch/full decision
- `src/middleware/snapshotStore.ts`
- in-memory LRU and Redis adapters
- `src/hooks/useDeltaSync.ts`
- client polling + patch/full/304 handling
- `src/components/DeltaSyncDevPanel.tsx`
- developer diagnostics
