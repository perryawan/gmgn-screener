'use client';
import { useState, useCallback } from 'react';

// ── Score color helper ────────────────────────────────────────────────────────
function scoreClass(score, max) {
  const pct = score / max;
  if (pct >= 0.7) return 'score-high';
  if (pct >= 0.4) return 'score-mid';
  return 'score-low';
}
function barColor(score, max) {
  const pct = score / max;
  if (pct >= 0.7) return 'var(--green)';
  if (pct >= 0.4) return 'var(--yellow)';
  return 'var(--red)';
}
function totalBarColor(score) {
  if (score >= 85) return 'var(--green)';
  if (score >= 70) return 'var(--blue)';
  if (score >= 50) return 'var(--yellow)';
  return 'var(--red)';
}
function verdictClass(verdict) {
  if (verdict === 'HIGH CONVICTION') return 'verdict-pill verdict-high';
  if (verdict === 'ENTRY LAYAK')     return 'verdict-pill verdict-entry';
  if (verdict === 'WATCHLIST')       return 'verdict-pill verdict-watch';
  return 'verdict-pill verdict-skip';
}

// ── ScoreCard ─────────────────────────────────────────────────────────────────
function ScoreCard({ title, score, max, children }) {
  const pct = (score / max) * 100;
  return (
    <div className="score-card">
      <div className="score-card-header">
        <span className="score-card-title">{title}</span>
        <span className={`score-badge ${scoreClass(score, max)}`}>{score}/{max}</span>
      </div>
      <div className="score-card-bar">
        <div className="score-card-fill" style={{ width: pct + '%', background: barColor(score, max) }} />
      </div>
      <div className="score-card-detail">{children}</div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function Home() {
  const [ca, setCa]         = useState('');
  const [loading, setLoad]  = useState(false);
  const [data, setData]     = useState(null);
  const [error, setError]   = useState('');

  const scan = useCallback(async () => {
    const addr = ca.trim();
    if (!addr) return;
    setLoad(true); setData(null); setError('');
    try {
      const r = await fetch(`/api/scan?ca=${encodeURIComponent(addr)}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Gagal fetch data');
      setData(j);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoad(false);
    }
  }, [ca]);

  const onKey = (e) => { if (e.key === 'Enter') scan(); };

  return (
    <div className="shell">

      {/* ── Header ── */}
      <div className="header">
        <div className="header-badge">
          <span>◆</span> SOLANA TRENCHES
        </div>
        <h1>GMGN <span>Scanner</span></h1>
        <p>Paste contract address — report otomatis dalam detik</p>
      </div>

      {/* ── Search ── */}
      <div className="search-box">
        <span className="search-label">CONTRACT ADDRESS (CA)</span>
        <div className="search-row">
          <input
            className="search-input"
            placeholder="Contoh: DJfxEAEc8JU1Jf4yajYwi4Qma5Jb2qgYmxkoUctEpump"
            value={ca}
            onChange={e => setCa(e.target.value)}
            onKeyDown={onKey}
            spellCheck={false}
          />
          <button className="scan-btn" onClick={scan} disabled={loading || !ca.trim()}>
            {loading ? '...' : '⚡ SCAN'}
          </button>
        </div>
      </div>

      {/* ── Loading ── */}
      {loading && (
        <div className="loading-wrap">
          <div className="loading-spinner" />
          <p>Mengambil data on-chain...</p>
        </div>
      )}

      {/* ── Error ── */}
      {error && <div className="error-box">⚠️ {error}</div>}

      {/* ── Report ── */}
      {data && !loading && (
        <div className="report">

          {/* Token Header */}
          <div className="token-header">
            <div>
              <div className="token-name">
                {data.token.name}&nbsp;
                <span style={{ color: 'var(--muted)', fontWeight: 400, fontSize: 16 }}>${data.token.symbol}</span>
              </div>
              <div className="token-meta">
                <div className="token-meta-item">Chain: <span>Solana</span></div>
                {data.raw?.dex?.priceUsd && (
                  <div className="token-meta-item">Price: <span>${parseFloat(data.raw.dex.priceUsd).toFixed(8)}</span></div>
                )}
                {data.raw?.dex?.mc && (
                  <div className="token-meta-item">MC: <span>${fmtShort(data.raw.dex.mc)}</span></div>
                )}
                {data.raw?.dex?.liqUsd && (
                  <div className="token-meta-item">Liq: <span>${fmtShort(data.raw.dex.liqUsd)}</span></div>
                )}
              </div>
            </div>
            <div className={verdictClass(data.verdict)}>{data.verdict}</div>
          </div>

          {/* External Links */}
          <div className="links-row">
            {Object.entries(data.links).map(([k, url]) => (
              <a key={k} href={url} target="_blank" rel="noreferrer" className="ext-link">
                ↗ {k.charAt(0).toUpperCase() + k.slice(1)}
              </a>
            ))}
          </div>

          {/* Total Score */}
          <div className="score-total">
            <div className="score-total-left">
              <div className="score-total-label">TOTAL SCORE</div>
              <div className="score-bar-track">
                <div className="score-bar-fill" style={{
                  width: data.total + '%',
                  background: totalBarColor(data.total),
                }} />
              </div>
            </div>
            <div className="score-number" style={{ color: totalBarColor(data.total) }}>
              {data.total}<span style={{ fontSize: 18, color: 'var(--muted)' }}>/100</span>
            </div>
          </div>

          {/* Score Cards Grid */}
          <div className="scores-grid">
            <ScoreCard title="SMART MONEY" score={data.scores.smartMoney.score} max={25}>
              <strong>Estimasi</strong>: {data.scores.smartMoney.buySellRatio}<br />
              {data.scores.smartMoney.detail}<br />
              <span style={{ fontSize: 11, color: 'var(--red)', opacity: 0.8 }}>
                ⚠ {data.scores.smartMoney.note}
              </span>
            </ScoreCard>

            <ScoreCard title="MARKET CAP" score={data.scores.marketCap.score} max={15}>
              <strong>Market Cap</strong>: {data.scores.marketCap.detail}
            </ScoreCard>

            <ScoreCard title="LIQUIDITY" score={data.scores.liquidity.score} max={15}>
              <strong>Likuiditas</strong>: {data.scores.liquidity.detail}<br />
              {data.scores.liquidity.ratio && <>
                <strong>Liq/MC Ratio</strong>: {data.scores.liquidity.ratio}
              </>}
            </ScoreCard>

            <ScoreCard title="HOLDER DISTRIBUTION" score={data.scores.holders.score} max={15}>
              {data.scores.holders.detail}
            </ScoreCard>

            <ScoreCard title="VOLUME & MOMENTUM" score={data.scores.volume.score} max={10}>
              <strong>24h</strong>: {data.scores.volume.vol24h}&nbsp;
              <strong>6h</strong>: {data.scores.volume.vol6h}&nbsp;
              <strong>1h</strong>: {data.scores.volume.vol1h}<br />
              Buys: {data.scores.volume.buys} | Sells: {data.scores.volume.sells}
            </ScoreCard>

            <ScoreCard title="DEV WALLET" score={data.scores.dev.score} max={10}>
              {data.scores.dev.detail}<br />
              {data.scores.dev.risks?.length > 0 && data.scores.dev.risks.map((r, i) => (
                <span key={i} style={{ display: 'block', marginTop: 2 }}>
                  {r.level === 'danger' ? '🚨' : '⚠️'} {r.name}
                </span>
              ))}
            </ScoreCard>

            <ScoreCard title="NARRATIVE" score={data.scores.narrative.score} max={10}>
              {data.scores.narrative.matched?.join(' · ')}
            </ScoreCard>
          </div>

          {/* Red Flags */}
          <div className="flags-card">
            <div className="flags-title">🚩 RED FLAGS</div>
            <div className="flags-list">
              {data.redFlags.length === 0
                ? <div className="no-flags">✅ Tidak ada red flag signifikan terdeteksi</div>
                : data.redFlags.map((f, i) => (
                  <div key={i} className="flag-item">
                    <span className="flag-icon">{f.icon}</span>
                    <span>{f.text}</span>
                  </div>
                ))
              }
            </div>
          </div>

          {/* Risk / Reward */}
          <div className="rr-grid">
            <div className="rr-card rr-bull">
              <div className="rr-label">▲ BULL CASE</div>
              <div className="rr-list">
                {data.bullCase.map((b, i) => (
                  <div key={i} className="rr-item">
                    <strong>{b.label}:</strong> {b.val}
                  </div>
                ))}
              </div>
            </div>
            <div className="rr-card rr-bear">
              <div className="rr-label">▼ BEAR CASE</div>
              <div className="rr-list">
                {data.bearCase.map((b, i) => (
                  <div key={i} className="rr-item">
                    <strong>{b.label}:</strong> {b.val}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Trading Plan */}
          <div className="plan-card">
            <div className="plan-title">📋 TRADING PLAN</div>
            <div className="plan-grid">
              <div className="plan-item">
                <div className="plan-item-label">ENTRY ZONE</div>
                <div className="plan-item-val val-entry">{data.plan.entry}</div>
              </div>
              <div className="plan-item">
                <div className="plan-item-label">STOP LOSS</div>
                <div className="plan-item-val val-stop">{data.plan.stop}</div>
              </div>
              <div className="plan-item">
                <div className="plan-item-label">TP1</div>
                <div className="plan-item-val val-tp">{data.plan.tp1}</div>
              </div>
              <div className="plan-item">
                <div className="plan-item-label">TP2</div>
                <div className="plan-item-val val-tp">{data.plan.tp2}</div>
              </div>
              <div className="plan-item">
                <div className="plan-item-label">TP3</div>
                <div className="plan-item-val val-tp">{data.plan.tp3}</div>
              </div>
            </div>
            <div className="plan-conclusion"
              dangerouslySetInnerHTML={{ __html: '💡 ' + data.plan.conclusion }} />
          </div>

          <div className="disclaimer">
            ⚠ Tool ini bersifat informatif dan bukan financial advice.<br />
            Smart money score adalah estimasi — verifikasi selalu di GMGN untuk data akurat.<br />
            Selalu lakukan riset sendiri (DYOR) sebelum trading.
          </div>
        </div>
      )}

      {/* empty state */}
      {!loading && !data && !error && (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--muted)' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🔍</div>
          <p style={{ fontFamily: 'var(--mono)', fontSize: 13 }}>
            Masukkan CA Solana di atas untuk memulai screening
          </p>
        </div>
      )}
    </div>
  );
}

function fmtShort(n) {
  if (!n || isNaN(n)) return 'N/A';
  if (n >= 1e9) return (n/1e9).toFixed(2)+'B';
  if (n >= 1e6) return (n/1e6).toFixed(2)+'M';
  if (n >= 1e3) return (n/1e3).toFixed(1)+'K';
  return n.toFixed(0);
}
