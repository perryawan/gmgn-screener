# GMGN Trenches Scanner 🔍

Real-time Solana meme coin screening tool dengan framework GMGN Trenches.

## Data Sources
- **DexScreener** — Harga, MC, Volume, Likuiditas
- **Rugcheck.xyz** — Dev wallet risk, holder analysis
- **Helius** — On-chain data, top holders

## Setup

### 1. Clone & Install
```bash
npm install
```

### 2. Environment Variables
Buat file `.env.local`:
```
HELIUS_API_KEY=your_helius_api_key_here
```

### 3. Run locally
```bash
npm run dev
```

### 4. Deploy ke Vercel
1. Push ke GitHub
2. Import project di vercel.com
3. Tambahkan Environment Variable: `HELIUS_API_KEY`
4. Deploy!

## Scoring Framework
| Kategori | Max Score |
|----------|-----------|
| Smart Money | 25 |
| Market Cap | 15 |
| Liquidity | 15 |
| Holder Distribution | 15 |
| Volume & Momentum | 10 |
| Dev Wallet | 10 |
| Narrative | 10 |
| **Total** | **100** |

## Verdict
- 0–50: SKIP
- 50–70: WATCHLIST  
- 70–85: ENTRY LAYAK
- 85–100: HIGH CONVICTION

## Disclaimer
Tool ini hanya untuk referensi. Bukan financial advice. DYOR selalu.
