import { performance } from 'node:perf_hooks';

async function benchmark(url: string, polls: number, intervalMs: number): Promise<void> {
  let etag: string | null = null;
  let fullBytes = 0;
  let actualBytes = 0;
  let patchCount = 0;
  let notModifiedCount = 0;
  let fullCount = 0;

  console.log(`\n  Delta-Sync Benchmark: ${url} x${polls}\n`);

  for (let i = 0; i < polls; i += 1) {
    const headers: Record<string, string> = {
      Accept: 'application/json-patch+json',
    };

    if (etag) {
      headers['If-None-Match'] = etag;
    }

    const start = performance.now();
    const response = await fetch(url, { headers });
    const ms = (performance.now() - start).toFixed(1);

    const body = response.status !== 304 ? await response.text() : '';
    const bodyBytes = Buffer.byteLength(body);
    const contentType = response.headers.get('content-type') ?? '';
    const newEtag = response.headers.get('etag');
    const xFull = Number.parseInt(response.headers.get('x-delta-full-size') ?? '0', 10);

    if (response.status === 200 && !contentType.includes('patch')) {
      fullBytes += bodyBytes;
      actualBytes += bodyBytes;
      fullCount += 1;
      etag = newEtag;
      console.log(`  [${i + 1}] FULL   ${bodyBytes} B  ${ms}ms`);
    } else if (response.status === 200 && contentType.includes('patch')) {
      fullBytes += xFull || bodyBytes * 20;
      actualBytes += bodyBytes;
      patchCount += 1;
      etag = newEtag;
      console.log(`  [${i + 1}] PATCH  ${bodyBytes} B  ${ms}ms  (full: ${xFull}B)`);
    } else if (response.status === 304) {
      notModifiedCount += 1;
      console.log(`  [${i + 1}] 304    0 B        ${ms}ms`);
    } else {
      console.log(`  [${i + 1}] ${response.status}    ${bodyBytes} B  ${ms}ms`);
    }

    if (i < polls - 1) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  const saved = fullBytes - actualBytes;
  const savedPct = fullBytes > 0 ? ((saved / fullBytes) * 100).toFixed(1) : '0.0';

  console.log(`\n  Full: ${fullCount}  Patch: ${patchCount}  304: ${notModifiedCount}`);
  console.log(`  Would have sent: ${(fullBytes / 1024).toFixed(1)} KB`);
  console.log(`  Actually sent:   ${(actualBytes / 1024).toFixed(1)} KB`);
  console.log(`  Saved:           ${(saved / 1024).toFixed(1)} KB (${savedPct}%)\n`);
}

function getFlagValue(flags: string[], flag: string, fallback: string): string {
  const index = flags.indexOf(flag);
  if (index === -1) return fallback;
  const value = flags[index + 1];
  return value ?? fallback;
}

const [, , url, ...flags] = process.argv;

if (!url) {
  console.error('Usage: npx tsx scripts/delta-benchmark.ts <url> --polls 20 --interval 1000');
  process.exit(1);
}

const polls = Number.parseInt(getFlagValue(flags, '--polls', '10'), 10);
const interval = Number.parseInt(getFlagValue(flags, '--interval', '1000'), 10);

void benchmark(url, polls, interval);
