import React from 'react';

import { useDeltaSync } from '../hooks/useDeltaSync.js';

type DeltaSyncDevPanelProps = {
  url: string;
  interval?: number;
};

export function DeltaSyncDevPanel({
  url,
  interval = 5000,
}: DeltaSyncDevPanelProps): JSX.Element | null {
  if (process.env.NODE_ENV !== 'development') {
    return null;
  }

  const { mode, lastFullBytes, lastPatchBytes, totalSavedBytes } = useDeltaSync(url, {
    interval,
  });

  const savePct =
    lastFullBytes > 0
      ? Math.round((1 - lastPatchBytes / lastFullBytes) * 100)
      : 0;

  const modeColor: Record<string, string> = {
    full: '#3498db',
    patch: '#27ae60',
    'not-modified': '#95a5a6',
    'full-fallback': '#e67e22',
    resync: '#e74c3c',
    error: '#c0392b',
    idle: '#bdc3c7',
  };

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 16,
        right: 16,
        zIndex: 9999,
        background: '#1a1a2e',
        color: '#eee',
        borderRadius: 8,
        padding: '12px 16px',
        fontFamily: 'monospace',
        fontSize: 12,
        boxShadow: '0 4px 20px rgba(0, 0, 0, 0.4)',
        minWidth: 240,
      }}
    >
      <div style={{ fontWeight: 'bold', color: '#7ec8e3', marginBottom: 6 }}>Delta-Sync Dev</div>
      <div>
        Mode: <span style={{ color: modeColor[mode] ?? '#ccc', fontWeight: 'bold' }}>{mode}</span>
      </div>
      {mode === 'patch' && (
        <>
          <div>Full: {(lastFullBytes / 1024).toFixed(1)} KB</div>
          <div>Patch: {(lastPatchBytes / 1024).toFixed(2)} KB</div>
          <div style={{ color: '#2ecc71' }}>Saved: {savePct}% this req</div>
        </>
      )}
      <div style={{ marginTop: 6, borderTop: '1px solid #333', paddingTop: 6 }}>
        Session total: {(totalSavedBytes / 1024).toFixed(1)} KB saved
      </div>
    </div>
  );
}
