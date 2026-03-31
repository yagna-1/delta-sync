import { performance } from 'node:perf_hooks';

function getArg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : process.argv[i + 1] ?? fallback;
}

async function runFull(url, polls, intervalMs) {
  let bytes = 0;
  const latencies = [];
  const cpuStart = process.cpuUsage();
  const wallStart = performance.now();

  for (let i = 0; i < polls; i += 1) {
    const start = performance.now();
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    const elapsed = performance.now() - start;
    latencies.push(elapsed);
    const body = await res.text();
    bytes += Buffer.byteLength(body);

    if (i < polls - 1) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  const cpu = process.cpuUsage(cpuStart);
  const wallMs = performance.now() - wallStart;
  const cpuMs = (cpu.user + cpu.system) / 1000;
  return { bytes, latencies, wallMs, cpuMs };
}

async function runDelta(url, polls, intervalMs) {
  let etag = null;
  let actual = 0;
  let equivalent = 0;
  let lastKnownFull = 0;
  let patch = 0;
  let full = 0;
  let notModified = 0;
  const allLatencies = [];
  const fullLatencies = [];
  const patchLatencies = [];
  const notModifiedLatencies = [];
  const cpuStart = process.cpuUsage();
  const wallStart = performance.now();

  for (let i = 0; i < polls; i += 1) {
    const headers = { Accept: 'application/json-patch+json' };
    if (etag) headers['If-None-Match'] = etag;

    const start = performance.now();
    const res = await fetch(url, { headers });
    const elapsedMs = performance.now() - start;
    allLatencies.push(elapsedMs);
    const elapsed = elapsedMs.toFixed(1);
    const contentType = res.headers.get('content-type') ?? '';
    const mode = res.headers.get('x-delta-sync') ?? 'unknown';
    const body = res.status === 304 ? '' : await res.text();
    const bodyBytes = Buffer.byteLength(body);

    if (res.status === 304) {
      notModified += 1;
      notModifiedLatencies.push(elapsedMs);
      equivalent += lastKnownFull;
      console.log(`[${i + 1}] 304    0 B     ${elapsed}ms`);
    } else if (contentType.includes('json-patch+json')) {
      patch += 1;
      patchLatencies.push(elapsedMs);
      actual += bodyBytes;
      const xFull = Number.parseInt(res.headers.get('x-delta-full-size') ?? '0', 10);
      equivalent += xFull;
      lastKnownFull = xFull || lastKnownFull;
      etag = res.headers.get('etag');
      console.log(`[${i + 1}] PATCH  ${bodyBytes} B  ${elapsed}ms (${mode})`);
    } else {
      full += 1;
      fullLatencies.push(elapsedMs);
      actual += bodyBytes;
      equivalent += bodyBytes;
      lastKnownFull = bodyBytes;
      etag = res.headers.get('etag');
      console.log(`[${i + 1}] FULL   ${bodyBytes} B  ${elapsed}ms (${mode})`);
    }

    if (i < polls - 1) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  const cpu = process.cpuUsage(cpuStart);
  const wallMs = performance.now() - wallStart;
  const cpuMs = (cpu.user + cpu.system) / 1000;

  return {
    actual,
    equivalent,
    patch,
    full,
    notModified,
    allLatencies,
    fullLatencies,
    patchLatencies,
    notModifiedLatencies,
    wallMs,
    cpuMs,
  };
}

function avg(values) {
  if (!values.length) return 'n/a';
  return (values.reduce((sum, x) => sum + x, 0) / values.length).toFixed(1);
}

function p95(values) {
  if (!values.length) return 'n/a';
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);
  return sorted[idx].toFixed(1);
}

const baseUrl = process.argv[2] ?? 'http://localhost:3000';
const polls = Number.parseInt(getArg('--polls', '20'), 10);
const interval = Number.parseInt(getArg('--interval', '1000'), 10);

const fullUrl = `${baseUrl}/api/dashboard-full`;
const deltaUrl = `${baseUrl}/api/dashboard`;

console.log(`\nDelta-Sync Demo Benchmark`);
console.log(`Base URL: ${baseUrl}`);
console.log(`Polls: ${polls}, Interval: ${interval}ms\n`);

const fullStats = await runFull(fullUrl, polls, interval);
console.log(`\nBaseline full polling bytes: ${fullStats.bytes} B`);
console.log(`Baseline latency avg/p95: ${avg(fullStats.latencies)}ms / ${p95(fullStats.latencies)}ms`);
console.log(`Baseline client CPU: ${fullStats.cpuMs.toFixed(1)}ms over ${fullStats.wallMs.toFixed(1)}ms wall\n`);

const deltaStats = await runDelta(deltaUrl, polls, interval);
const saved = deltaStats.equivalent - deltaStats.actual;
const savedPct = deltaStats.equivalent > 0
  ? ((saved / deltaStats.equivalent) * 100).toFixed(1)
  : '0.0';

console.log('\nSummary');
console.log(`Full responses: ${deltaStats.full}`);
console.log(`Patch responses: ${deltaStats.patch}`);
console.log(`304 responses: ${deltaStats.notModified}`);
console.log(`Would-have-sent (full): ${deltaStats.equivalent} B`);
console.log(`Actually sent (delta): ${deltaStats.actual} B`);
console.log(`Saved: ${saved} B (${savedPct}%)`);
console.log(`Delta latency avg/p95 (all): ${avg(deltaStats.allLatencies)}ms / ${p95(deltaStats.allLatencies)}ms`);
console.log(`Delta latency avg/p95 (full): ${avg(deltaStats.fullLatencies)}ms / ${p95(deltaStats.fullLatencies)}ms`);
console.log(`Delta latency avg/p95 (patch): ${avg(deltaStats.patchLatencies)}ms / ${p95(deltaStats.patchLatencies)}ms`);
console.log(`Delta latency avg/p95 (304): ${avg(deltaStats.notModifiedLatencies)}ms / ${p95(deltaStats.notModifiedLatencies)}ms`);
console.log(`Delta client CPU: ${deltaStats.cpuMs.toFixed(1)}ms over ${deltaStats.wallMs.toFixed(1)}ms wall`);
