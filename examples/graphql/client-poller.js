import fastJsonPatch from 'fast-json-patch';

const { applyOperation } = fastJsonPatch;

const mode = process.argv[2] ?? 'delta';
const baseUrl = process.argv[3] ?? 'http://localhost:4100';
const polls = Number.parseInt(process.argv[4] ?? '20', 10);
const interval = Number.parseInt(process.argv[5] ?? '1000', 10);

const queryBody = {
  operationName: 'DashboardQuery',
  query: `query DashboardQuery {\n  dashboard {\n    activeUsers\n    mrr\n    incidents { id severity summary }\n    widgets { id title region owner status note }\n  }\n}`,
  variables: {},
};

const endpoint = mode === 'full' ? '/graphql/full' : '/graphql/delta';

let etag = null;
let snapshot = null;
let actual = 0;
let equivalent = 0;
let lastKnownFull = 0;
let fullCount = 0;
let patchCount = 0;
let notModifiedCount = 0;

for (let i = 0; i < polls; i += 1) {
  const headers = { 'Content-Type': 'application/json' };
  if (mode === 'delta') {
    headers.Accept = 'application/json-patch+json';
    if (etag) headers['If-None-Match'] = etag;
  } else {
    headers.Accept = 'application/json';
  }

  const res = await fetch(`${baseUrl}${endpoint}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(queryBody),
  });

  if (res.status === 304) {
    notModifiedCount += 1;
    equivalent += lastKnownFull;
    console.log(`[${i + 1}] 304`);
  } else {
    const contentType = res.headers.get('content-type') ?? '';
    const bodyText = await res.text();
    const bytes = Buffer.byteLength(bodyText);

    if (contentType.includes('json-patch+json') && snapshot) {
      const ops = JSON.parse(bodyText);
      let nextDoc = JSON.parse(JSON.stringify(snapshot));
      for (const op of ops) {
        nextDoc = applyOperation(nextDoc, op, true).newDocument;
      }
      snapshot = nextDoc;

      const xFull = Number.parseInt(res.headers.get('x-delta-full-size') ?? '0', 10);
      patchCount += 1;
      actual += bytes;
      equivalent += xFull;
      lastKnownFull = xFull || lastKnownFull;
      console.log(`[${i + 1}] PATCH ${bytes} B (full ${xFull} B)`);
    } else {
      snapshot = JSON.parse(bodyText);
      fullCount += 1;
      actual += bytes;
      equivalent += bytes;
      lastKnownFull = bytes;
      console.log(`[${i + 1}] FULL ${bytes} B`);
    }

    etag = res.headers.get('etag');
  }

  if (i < polls - 1) {
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}

const saved = equivalent - actual;
const savedPct = equivalent > 0 ? ((saved / equivalent) * 100).toFixed(1) : '0.0';

console.log('\nGraphQL Polling Summary');
console.log(`Mode: ${mode}`);
console.log(`Full: ${fullCount}, Patch: ${patchCount}, 304: ${notModifiedCount}`);
console.log(`Would-have-sent: ${equivalent} B`);
console.log(`Actually sent: ${actual} B`);
console.log(`Saved: ${saved} B (${savedPct}%)`);
