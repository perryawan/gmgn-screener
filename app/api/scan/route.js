// app/api/scan/route.js
// Backend: fetches on-chain data and computes GMGN Trenches scores

export const runtime = 'edge';

const HELIUS_KEY = process.env.HELIUS_API_KEY || '';

// ── helpers ──────────────────────────────────────────────────────────────────
function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }

function fmtNum(n) {
  if (n == null || isNaN(n)) return 'N/A';
  if (n >= 1e9)  return (n / 1e9).toFixed(2)  + 'B';
  if (n >= 1e6)  return (n / 1e6).toFixed(2)  + 'M';
  if (n >= 1e3)  return (n / 1e3).toFixed(1)  + 'K';
  return n.toFixed(2);
}

function fmtUsd(n) { return n == null ? 'N/A' : '$' + fmtNum(n); }

// ── fetch DexScreener ─────────────────────────────────────────────────────────
async function fetchDex(ca) {
  const r = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${ca}`, {
    headers: { 'Accept': 'application/json' },
  });
  if (!r.ok) throw new Error('DexScreener fetch failed');
  const data = await r.json();
  // pick the pair with highest liquidity
  const pairs = (data.pairs || []).filter(p => p.chainId === 'solana');
  if (!pairs.length) return null;
  pairs.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0));
  return pairs[0];
}

// ── fetch Rugcheck ────────────────────────────────────────────────────────────
async function fetchRugcheck(ca) {
  try {
    const r = await fetch(`https://api.rugcheck.xyz/v1/tokens/${ca}/report/summary`, {
      headers: { 'Accept': 'application/json' },
    });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

// ── fetch Helius token metadata ───────────────────────────────────────────────
async function fetchHelius(ca) {
  if (!HELIUS_KEY) return null;
  try {
    const r = await fetch(`https://mainnet.helius-rpc.com/?api-key=${HELIUS_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1,
        method: 'getAsset',
        params: { id: ca },
      }),
    });
    if (!r.ok) return null;
    const j = await r.json();
    return j.result || null;
  } catch { return null; }
}

// ── fetch Helius top holders ──────────────────────────────────────────────────
async function fetchHolders(ca) {
  if (!HELIUS_KEY) return null;
  try {
    const r = await fetch(`https://mainnet.helius-rpc.com/?api-key=${HELIUS_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 2,
        method: 'getTokenLargestAccounts',
        params: [ca],
      }),
    });
    if (!r.ok) return null;
    const j = await r.json();
    return j.result?.value || null;
  } catch { return null; }
}

// ── SCORING ENGINE ────────────────────────────────────────────────────────────

function scoreMarketCap(mc) {
  // max 15 pts — smaller = higher score
  if (!mc) return { score: 5, detail: 'Data tidak tersedia', raw: null };
  let s;
  if      (mc < 10_000)   s = 15;
  else if (mc < 50_000)   s = 13;
  else if (mc < 100_000)  s = 11;
  else if (mc < 300_000)  s = 9;
  else if (mc < 1_000_000) s = 7;
  else if (mc < 5_000_000) s = 5;
  else                     s = 2;
  return { score: s, detail: fmtUsd(mc), raw: mc };
}

function scoreLiquidity(liq, mc) {
  // max 15 pts
  if (!liq) return { score: 4, detail: 'Data tidak tersedia', raw: null };
  const ratio = mc ? liq / mc : 0;
  let s;
  if      (liq > 100_000)  s = 15;
  else if (liq > 50_000)   s = 13;
  else if (liq > 20_000)   s = 11;
  else if (liq > 10_000)   s = 8;
  else if (liq > 5_000)    s = 6;
  else if (liq > 1_000)    s = 3;
  else                     s = 1;

  // liquidity/mc ratio bonus
  if (ratio > 0.3) s = Math.min(15, s + 1);
  return {
    score: s,
    detail: fmtUsd(liq),
    ratio: ratio ? (ratio * 100).toFixed(1) + '%' : 'N/A',
    raw: liq,
  };
}

function scoreVolume(vol24h, vol6h, vol1h, txns) {
  // max 10 pts
  if (!vol24h) return { score: 3, detail: 'Data tidak tersedia' };
  let s = 0;
  // volume size
  if      (vol24h > 1_000_000) s += 4;
  else if (vol24h > 500_000)   s += 3;
  else if (vol24h > 100_000)   s += 2;
  else if (vol24h > 10_000)    s += 1;

  // organic check: buy/sell balance
  if (txns) {
    const buys  = txns.h24?.buys  || 0;
    const sells = txns.h24?.sells || 0;
    const total = buys + sells;
    if (total > 0) {
      const buyRatio = buys / total;
      if (buyRatio > 0.45 && buyRatio < 0.75) s += 3; // balanced
      else if (buyRatio > 0.3 && buyRatio < 0.85)  s += 1;
    }
  }

  // recency momentum (1h vol / 24h vol)
  if (vol1h && vol24h) {
    const momentum = (vol1h / vol24h) * 24;
    if (momentum > 1.5) s += 3;
    else if (momentum > 0.8) s += 1;
  }

  return {
    score: clamp(s, 0, 10),
    vol24h: fmtUsd(vol24h),
    vol6h:  fmtUsd(vol6h),
    vol1h:  fmtUsd(vol1h),
    buys:   txns?.h24?.buys  || 'N/A',
    sells:  txns?.h24?.sells || 'N/A',
  };
}

function scoreHolders(rugData, largestAccounts, supply) {
  // max 15 pts
  const risks = rugData?.risks || [];

  // try to get top10 concentration from rugcheck
  let top10pct = null;
  const concRisk = risks.find(r => r.name?.toLowerCase().includes('concentration') || r.name?.toLowerCase().includes('top 10'));
  if (concRisk?.score) top10pct = concRisk.score; // rough approximation

  // try from helius largestAccounts
  if (!top10pct && largestAccounts && supply) {
    const top10supply = largestAccounts.slice(0, 10).reduce((acc, a) => acc + Number(a.amount), 0);
    top10pct = (top10supply / supply) * 100;
  }

  let s;
  if (top10pct == null)  s = 6;
  else if (top10pct < 15) s = 14;
  else if (top10pct < 25) s = 12;
  else if (top10pct < 35) s = 9;
  else if (top10pct < 50) s = 6;
  else if (top10pct < 70) s = 3;
  else                    s = 1;

  return {
    score: s,
    top10pct: top10pct ? top10pct.toFixed(1) + '%' : 'N/A',
    detail: top10pct ? `Top 10 pegang ${top10pct.toFixed(1)}% supply` : 'Data tidak lengkap',
  };
}

function scoreDevWallet(rugData) {
  // max 10 pts
  const risks = rugData?.risks || [];
  const score_raw = rugData?.score || 0; // rugcheck score 0-1000, higher = riskier

  // look for specific dev-related risks
  const devSell  = risks.find(r => r.name?.toLowerCase().includes('dev') || r.name?.toLowerCase().includes('creator'));
  const rugRisk  = risks.find(r => r.level === 'danger');
  const warnRisk = risks.filter(r => r.level === 'warn').length;

  let s = 10;
  if (rugRisk)          s -= 5;
  if (devSell)          s -= 3;
  s -= Math.min(3, warnRisk);
  if (score_raw > 500)  s -= 2;

  return {
    score: clamp(s, 0, 10),
    rugScore: score_raw,
    risks: risks.slice(0, 4).map(r => ({ name: r.name, level: r.level, description: r.description })),
    detail: rugData ? `Rugcheck score: ${score_raw}/1000` : 'Rugcheck tidak tersedia',
  };
}

function scoreNarrative(name, symbol, desc) {
  // max 10 pts — keyword matching
  const text = `${name} ${symbol} ${desc}`.toLowerCase();
  const keywords = {
    ai: ['ai', 'artificial', 'intelligence', 'gpt', 'llm', 'neural', 'agent', 'claude', 'openai'],
    agent: ['agent', 'autonomous', 'bot', 'automate'],
    meme: ['meme', 'doge', 'pepe', 'frog', 'cat', 'dog', 'shib', 'wojak', 'chad', 'based', 'sigma'],
    trending: ['trump', 'elon', 'spacex', 'tesla', 'btc', 'bitcoin', 'solana', 'sol'],
    gaming: ['game', 'gaming', 'play', 'earn', 'nft', 'metaverse'],
    rwa: ['rwa', 'real world', 'asset', 'gold', 'property', 'estate'],
  };

  let score = 3; // base
  let matched = [];

  for (const [cat, kws] of Object.entries(keywords)) {
    if (kws.some(k => text.includes(k))) {
      score += 2;
      matched.push(cat.toUpperCase());
    }
  }

  // pump.fun tokens get slight narrative penalty (anonymous launch)
  const isPump = symbol?.toLowerCase().includes('pump') || name?.toLowerCase().includes('pump.fun');

  return {
    score: clamp(score, 0, 10),
    matched: matched.length ? matched : ['MEME (pump.fun default)'],
    detail: matched.length ? matched.join(', ') : 'Narrative tidak jelas',
  };
}

function scoreSmartMoney(vol24h, txBuys, txSells, age) {
  // max 25 pts — approximated (true smart money needs GMGN proprietary data)
  // we use buy/sell ratio, volume vs age, and activity patterns
  let s = 5; // base

  if (!vol24h) return { score: s, detail: 'Tidak bisa dideteksi tanpa GMGN', note: 'approximated' };

  // buy pressure
  if (txBuys && txSells) {
    const ratio = txBuys / (txBuys + txSells);
    if (ratio > 0.6)      s += 8;
    else if (ratio > 0.5) s += 5;
    else if (ratio > 0.4) s += 2;
    else                  s -= 2;
  }

  // volume/age momentum
  const ageHours = age ? (Date.now() - age) / 3_600_000 : null;
  if (ageHours) {
    const volPerHour = vol24h / Math.min(ageHours, 24);
    if      (volPerHour > 50_000) s += 8;
    else if (volPerHour > 20_000) s += 6;
    else if (volPerHour > 5_000)  s += 4;
    else if (volPerHour > 1_000)  s += 2;
  }

  // high volume on new token = interest signal
  if (vol24h > 500_000) s += 4;
  else if (vol24h > 100_000) s += 2;

  return {
    score: clamp(s, 0, 25),
    detail: 'Estimasi dari buy pressure & volume momentum',
    note: 'approximated — verifikasi di GMGN untuk data smart money akurat',
    buySellRatio: txBuys && txSells ? ((txBuys / (txBuys + txSells)) * 100).toFixed(0) + '% buy' : 'N/A',
  };
}

function buildRedFlags(dex, rugData, holderScore, liqScore, volData) {
  const flags = [];
  const risks = rugData?.risks || [];

  risks.filter(r => r.level === 'danger').forEach(r => {
    flags.push({ icon: '🚨', text: r.name + (r.description ? ' — ' + r.description : '') });
  });
  risks.filter(r => r.level === 'warn').forEach(r => {
    flags.push({ icon: '⚠️', text: r.name + (r.description ? ' — ' + r.description : '') });
  });

  if (liqScore.raw != null && liqScore.raw < 5_000) {
    flags.push({ icon: '🚨', text: 'Likuiditas sangat rendah (' + fmtUsd(liqScore.raw) + ') — risiko rug tinggi' });
  }
  if (holderScore.top10pct && parseFloat(holderScore.top10pct) > 50) {
    flags.push({ icon: '🚨', text: 'Konsentrasi holder sangat tinggi (' + holderScore.top10pct + ') — risiko whale dump' });
  }
  if (volData.buys !== 'N/A' && volData.sells !== 'N/A') {
    const total = volData.buys + volData.sells;
    const buyR = volData.buys / total;
    if (buyR > 0.85) flags.push({ icon: '⚠️', text: 'Buy/sell ratio tidak wajar (' + (buyR*100).toFixed(0) + '% buy) — kemungkinan wash trading' });
    if (buyR < 0.2)  flags.push({ icon: '🚨', text: 'Tekanan jual dominan (' + ((1-buyR)*100).toFixed(0) + '% sell) — smart money kemungkinan exit' });
  }

  // pump.fun specific
  if (!dex?.info?.websites?.length && !dex?.info?.socials?.length) {
    flags.push({ icon: '⚠️', text: 'Tidak ada website atau sosial media terdaftar — anonymous launch' });
  }

  return flags;
}

function buildTradingPlan(mc, liq, vol24h, totalScore, dex) {
  const price = parseFloat(dex?.priceUsd || 0);

  if (!price || !mc) {
    return {
      entry: 'N/A', stop: 'N/A',
      tp1: 'N/A', tp2: 'N/A', tp3: 'N/A',
      conclusion: 'Data harga tidak tersedia. Verifikasi manual di GMGN/DexScreener.',
    };
  }

  // dynamic targets based on MC size
  let tp1Multi, tp2Multi, tp3Multi, stopPct;
  if (mc < 50_000)       { tp1Multi = 2;  tp2Multi = 5;   tp3Multi = 15;  stopPct = 0.30; }
  else if (mc < 200_000) { tp1Multi = 1.5;tp2Multi = 3;   tp3Multi = 8;   stopPct = 0.25; }
  else if (mc < 1_000_000){ tp1Multi = 1.3;tp2Multi = 2;  tp3Multi = 5;   stopPct = 0.20; }
  else                   { tp1Multi = 1.2;tp2Multi = 1.7; tp3Multi = 3;   stopPct = 0.18; }

  const fmt = (v) => '$' + v.toFixed(8).replace(/\.?0+$/, '');

  let conclusion;
  if (totalScore >= 85) {
    conclusion = `<strong>HIGH CONVICTION.</strong> Setup menarik — MC masih kecil, data mendukung entry. Gunakan posisi 1–2% portfolio. Amankan sebagian posisi di TP1, biarkan sisanya ride ke TP2/TP3.`;
  } else if (totalScore >= 70) {
    conclusion = `<strong>ENTRY LAYAK</strong> dengan manajemen risiko ketat. Gunakan posisi kecil (0.5–1% portfolio). Set stop loss disiplin. Jangan average down sebelum konfirmasi volume.`;
  } else if (totalScore >= 50) {
    conclusion = `<strong>WATCHLIST saja.</strong> Ada potensi tapi risiko masih tinggi. Pantau dulu 1–2 jam, lihat apakah volume organik terbentuk. Entry hanya jika ada konfirmasi breakout.`;
  } else {
    conclusion = `<strong>SKIP.</strong> Risk/reward tidak mendukung. Terlalu banyak red flag. Jangan FOMO — ada ribuan token lain di trench setiap hari.`;
  }

  return {
    entry: fmt(price),
    stop:  fmt(price * (1 - stopPct)),
    tp1:   fmt(price * tp1Multi) + ` (${fmtUsd(mc * tp1Multi)} MC)`,
    tp2:   fmt(price * tp2Multi) + ` (${fmtUsd(mc * tp2Multi)} MC)`,
    tp3:   fmt(price * tp3Multi) + ` (${fmtUsd(mc * tp3Multi)} MC)`,
    conclusion,
  };
}

// ── MAIN HANDLER ─────────────────────────────────────────────────────────────
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const ca = searchParams.get('ca')?.trim();

  if (!ca || ca.length < 32) {
    return Response.json({ error: 'Contract address tidak valid.' }, { status: 400 });
  }

  try {
    // parallel fetches
    const [dex, rugData, heliusAsset, largestAccounts] = await Promise.all([
      fetchDex(ca),
      fetchRugcheck(ca),
      fetchHelius(ca),
      fetchHolders(ca),
    ]);

    if (!dex && !heliusAsset) {
      return Response.json({ error: 'Token tidak ditemukan. Pastikan CA valid dan token sudah ada di DEX.' }, { status: 404 });
    }

    // extract values
    const mc      = dex?.marketCap || dex?.fdv || null;
    const liqUsd  = dex?.liquidity?.usd || null;
    const vol24h  = dex?.volume?.h24 || null;
    const vol6h   = dex?.volume?.h6  || null;
    const vol1h   = dex?.volume?.h1  || null;
    const txns    = dex?.txns || null;
    const pairAge = dex?.pairCreatedAt || null;
    const name    = dex?.baseToken?.name   || heliusAsset?.content?.metadata?.name    || 'Unknown';
    const symbol  = dex?.baseToken?.symbol || heliusAsset?.content?.metadata?.symbol  || '???';
    const supply  = heliusAsset?.token_info?.supply || null;

    // scores
    const smScore    = scoreSmartMoney(vol24h, txns?.h24?.buys, txns?.h24?.sells, pairAge);
    const mcScore    = scoreMarketCap(mc);
    const liqScore   = scoreLiquidity(liqUsd, mc);
    const volScore   = scoreVolume(vol24h, vol6h, vol1h, txns);
    const holdScore  = scoreHolders(rugData, largestAccounts, supply);
    const devScore   = scoreDevWallet(rugData);
    const narrScore  = scoreNarrative(name, symbol, heliusAsset?.content?.metadata?.description);

    const total = smScore.score + mcScore.score + liqScore.score + volScore.score +
                  holdScore.score + devScore.score + narrScore.score;

    const verdict =
      total >= 85 ? 'HIGH CONVICTION' :
      total >= 70 ? 'ENTRY LAYAK'     :
      total >= 50 ? 'WATCHLIST'       : 'SKIP';

    const redFlags = buildRedFlags(dex, rugData, holdScore, liqScore, volScore);

    const bullCase = [
      { label: 'Target 1', val: `2–3x dari entry — MC ~${fmtUsd((mc||0)*2.5)}` },
      { label: 'Target 2', val: `5–10x — MC ~${fmtUsd((mc||0)*7)}` },
      { label: 'Target 3', val: `Moonshot — jika narrative viral + smart money masuk` },
    ];
    const bearCase = [
      { label: 'Invalidasi', val: 'Volume drop + price break di bawah stop loss' },
      { label: 'Risiko 1',   val: 'Dev dump / rug pull tanpa warning' },
      { label: 'Risiko 2',   val: 'Whale exit di konsentrasi holder tinggi' },
    ];

    const plan = buildTradingPlan(mc, liqUsd, vol24h, total, dex);

    return Response.json({
      token: { name, symbol, ca, chain: 'Solana', price: dex?.priceUsd },
      scores: {
        smartMoney: smScore,
        marketCap:  mcScore,
        liquidity:  liqScore,
        volume:     volScore,
        holders:    holdScore,
        dev:        devScore,
        narrative:  narrScore,
      },
      total, verdict,
      redFlags,
      bullCase, bearCase,
      plan,
      links: {
        gmgn:       `https://gmgn.ai/sol/token/${ca}`,
        dexscreener:`https://dexscreener.com/solana/${ca}`,
        solscan:    `https://solscan.io/token/${ca}`,
        rugcheck:   `https://rugcheck.xyz/tokens/${ca}`,
        pump:       `https://pump.fun/coin/${ca}`,
      },
      raw: { dex: { priceUsd: dex?.priceUsd, mc, liqUsd, vol24h, vol6h, vol1h } },
    });

  } catch (err) {
    console.error(err);
    return Response.json({ error: 'Gagal mengambil data: ' + err.message }, { status: 500 });
  }
}
