# Spring Boot Delta-Sync Starter

## Run

```bash
cd ports/spring-delta-sync
mvn spring-boot:run
```

Server: `http://localhost:4400`

## Test flow

```bash
curl -i http://localhost:4400/api/dashboard
curl -i -H 'If-None-Match: "<etag>"' -H 'Accept: application/json-patch+json' http://localhost:4400/api/dashboard
```

## Files

- `DeltaSyncService.java`: ETag, patch/full fallback, cache behavior
- `DashboardController.java`: starter route integration
- `pom.xml`: Spring Web + zjsonpatch dependencies
