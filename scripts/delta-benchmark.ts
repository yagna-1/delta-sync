import { performance } from 'node:perf_hooks';

async function benchmark(url: string, polls: number, intervalMs: number): Promise<void> {
  let etag: string | null = null;
  let fullBytes = 0;
  let actualBytes = 0;
  let patchCount = 0;
  let notModifiedCount = 0;
  let fullCount = 0;
  const allLatencies: number[] = [];
  const fullLatencies: number[] = [];
  const patchLatencies: number[] = [];
  const notModifiedLatencies: number[] = [];
  const cpuStart = process.cpuUsage();
  const wallStart = performance.now();

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
    const latencyMs = performance.now() - start;
    allLatencies.push(latencyMs);
    const ms = latencyMs.toFixed(1);

    const body = response.status !== 304 ? await response.text() : '';
    const bodyBytes = Buffer.byteLength(body);
    const contentType = response.headers.get('content-type') ?? '';
    const newEtag = response.headers.get('etag');
    const xFull = Number.parseInt(response.headers.get('x-delta-full-size') ?? '0', 10);

    if (response.status === 200 && !contentType.includes('patch')) {
      fullBytes += bodyBytes;
      actualBytes += bodyBytes;
      fullCount += 1;
      fullLatencies.push(latencyMs);
      etag = newEtag;
      console.log(`  [${i + 1}] FULL   ${bodyBytes} B  ${ms}ms`);
    } else if (response.status === 200 && contentType.includes('patch')) {
      fullBytes += xFull || bodyBytes * 20;
      actualBytes += bodyBytes;
      patchCount += 1;
      patchLatencies.push(latencyMs);
      etag = newEtag;
      console.log(`  [${i + 1}] PATCH  ${bodyBytes} B  ${ms}ms  (full: ${xFull}B)`);
    } else if (response.status === 304) {
      notModifiedCount += 1;
      notModifiedLatencies.push(latencyMs);
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
  const cpuUsage = process.cpuUsage(cpuStart);
  const wallMs = performance.now() - wallStart;
  const cpuMs = (cpuUsage.user + cpuUsage.system) / 1000;
  const cpuPct = wallMs > 0 ? ((cpuMs / wallMs) * 100).toFixed(1) : '0.0';

  console.log(`\n  Full: ${fullCount}  Patch: ${patchCount}  304: ${notModifiedCount}`);
  console.log(`  Would have sent: ${(fullBytes / 1024).toFixed(1)} KB`);
  console.log(`  Actually sent:   ${(actualBytes / 1024).toFixed(1)} KB`);
  console.log(`  Saved:           ${(saved / 1024).toFixed(1)} KB (${savedPct}%)\n`);
  console.log(`  Latency avg/p95 (all):  ${formatAvg(allLatencies)}ms / ${formatP95(allLatencies)}ms`);
  console.log(`  Latency avg/p95 (full): ${formatAvg(fullLatencies)}ms / ${formatP95(fullLatencies)}ms`);
  console.log(`  Latency avg/p95 (patch): ${formatAvg(patchLatencies)}ms / ${formatP95(patchLatencies)}ms`);
  console.log(`  Latency avg/p95 (304):  ${formatAvg(notModifiedLatencies)}ms / ${formatP95(notModifiedLatencies)}ms`);
  console.log(`  Client CPU time: ${cpuMs.toFixed(1)}ms over ${wallMs.toFixed(1)}ms wall (${cpuPct}%)\n`);
}

function formatAvg(values: number[]): string {
  if (!values.length) return 'n/a';
  const sum = values.reduce((acc, value) => acc + value, 0);
  return (sum / values.length).toFixed(1);
}

function formatP95(values: number[]): string {
  if (!values.length) return 'n/a';
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);
  return sorted[index].toFixed(1);
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
