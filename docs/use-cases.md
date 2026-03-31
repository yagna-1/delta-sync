# Real-world Use Cases

## 1) Operational dashboards

Problem:
- Polling large dashboard payloads every 1-5s wastes bandwidth.

Delta-Sync fit:
- Initial full payload, then mostly patch/304 responses.

Expected impact:
- 70-95% payload reduction depending on volatility.

## 2) Chat/inbox metadata streams

Problem:
- Thread list payloads are mostly stable across polls.

Delta-Sync fit:
- Patch only changed unread counters, timestamps, or message previews.

Expected impact:
- lower transfer + smoother mobile behavior on weak networks.

## 3) Config/state distribution

Problem:
- Clients repeatedly fetch large JSON config snapshots.

Delta-Sync fit:
- Update only changed sections while preserving HTTP semantics.

Expected impact:
- reduced network spend and faster incremental refreshes.

## 4) GraphQL polling workloads

Problem:
- Polling with full response payloads even for tiny changes.

Delta-Sync fit:
- Keep existing GraphQL query model and add patch transport behavior.

Expected impact:
- significant payload reduction with minimal client adaptation.
