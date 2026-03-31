# Contributing

Thanks for helping improve Delta-Sync.

## Development Setup

```bash
npm install
npm run build
npm test
```

## Branch and PR Workflow

1. Create a focused branch.
2. Keep changes small and atomic.
3. Add or update tests when behavior changes.
4. Open a PR with:
- problem statement
- implementation summary
- test evidence

## Commit Style

Use clear, imperative commit messages, for example:

- `fix: patch fallback when diff is larger than full`
- `docs: add CDN passthrough guidance`

## Quality Bar

- `npm test` passes
- `npm run typecheck` passes
- API contract behavior remains intact (`full`, `patch`, `304`)

## Reporting Bugs

Please include:

- environment
- expected behavior
- actual behavior
- reproduction steps
- logs/headers if relevant (`ETag`, `If-None-Match`, `X-Delta-Sync`)

## Security Issues

Do not file public issues for vulnerabilities.
See `SECURITY.md`.
