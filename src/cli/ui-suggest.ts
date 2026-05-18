import http from "http";
import path from "path";
import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import { getArgValue, hasFlag } from "./_args";

type Client = {
  id: string;
  res: http.ServerResponse;
};

function nowId(): string {
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

function htmlPage(params: { title: string }): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${params.title}</title>
<style>
*,*::before,*::after{box-sizing:border-box}
:root{
  color-scheme:dark;
  --bg:#02030a;--bg2:#06080f;
  --s1:#0d1117;--s2:#111827;--s3:#161e2e;
  --t:#e8ecf6;--m:rgba(232,236,246,.52);
  --b1:rgba(232,236,246,.07);--b2:rgba(232,236,246,.13);
  --acc:#7c3aed;--acc2:#a855f7;
  --g:#22c55e;--g2:#4ade80;
  --r:#ef4444;--r2:#f87171;
  --a:#f59e0b;--a2:#fbbf24;
  --bl:#3b82f6;--bl2:#60a5fa;
  --cy:#06b6d4;
  --mono:ui-monospace,'JetBrains Mono','SF Mono',Consolas,monospace;
}
body{margin:0;font-family:system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;background:var(--bg);color:var(--t);min-height:100vh}
::-webkit-scrollbar{width:5px;height:5px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:rgba(232,236,246,.12);border-radius:3px}

/* NAV */
.nav{background:rgba(6,8,15,.93);backdrop-filter:blur(16px);border-bottom:1px solid var(--b1);position:sticky;top:0;z-index:100}
.nav-i{max-width:1400px;margin:0 auto;padding:0 18px;display:flex;align-items:center;justify-content:space-between;height:50px;gap:10px}
.nav-logo{width:30px;height:30px;border-radius:9px;background:linear-gradient(135deg,var(--acc),var(--cy));display:flex;align-items:center;justify-content:center;font-weight:900;font-size:15px;color:#fff;flex-shrink:0}
.nav-t{font-size:15px;font-weight:700;letter-spacing:-.3px}
.nav-s{font-size:10px;color:var(--m);margin-top:1px}
.nav-right{display:flex;align-items:center;gap:8px}
.sdot{width:8px;height:8px;border-radius:50%;background:var(--m);transition:background .3s}
.sdot.live{background:var(--g);box-shadow:0 0 7px var(--g);animation:blink 2s infinite}
@keyframes blink{0%,100%{opacity:1}50%{opacity:.4}}
.asof{font-size:10px;color:var(--m);font-family:var(--mono)}

/* BUTTONS */
.btn{padding:5px 11px;border:1px solid var(--b2);border-radius:8px;font-size:12px;font-weight:600;background:rgba(255,255,255,.05);color:var(--t);cursor:pointer;transition:all .15s}
.btn:hover{background:rgba(255,255,255,.1);border-color:rgba(255,255,255,.22)}
.btn:disabled{opacity:.38;cursor:not-allowed}
.btn-g{background:rgba(34,197,94,.12);border-color:rgba(34,197,94,.35);color:var(--g2)}
.btn-g:hover{background:rgba(34,197,94,.2)}

/* WRAP */
.wrap{max-width:1400px;margin:0 auto;padding:12px 18px 48px}

/* CARDS */
.card{background:var(--s1);border:1px solid var(--b1);border-radius:16px;padding:14px 16px;position:relative;overflow:hidden;margin-bottom:12px}
.card::before{content:'';position:absolute;top:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,rgba(124,58,237,.45),transparent)}
.ct{font-size:10px;font-weight:700;letter-spacing:.9px;text-transform:uppercase;color:var(--m);margin:0 0 12px;display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.ct::before{content:'';width:3px;height:13px;border-radius:2px;background:var(--acc);flex-shrink:0}
.ct .hint{font-size:10px;font-weight:400;text-transform:none;letter-spacing:0;color:var(--m);opacity:.8}

/* GRIDS */
.g2{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px}
@media(max-width:960px){.g2{grid-template-columns:1fr}}

/* QUICK STATS — 4 cols only (VIX + straddle removed, both in context card) */
.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:12px}
@media(max-width:800px){.stats{grid-template-columns:repeat(2,1fr)}}
.sc{background:var(--s2);border:1px solid var(--b1);border-radius:12px;padding:10px 14px}
.sl{font-size:10px;color:var(--m);text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px}
.sv{font-size:22px;font-weight:800;font-family:var(--mono);line-height:1}
.ss{font-size:10px;color:var(--m);margin-top:2px;font-family:var(--mono)}
.up{color:var(--g)}.dn{color:var(--r)}.neu{color:var(--a)}

/* KV */
.kv{display:grid;grid-template-columns:148px 1fr;gap:6px 10px;align-items:baseline;font-size:13px}
.k{color:var(--m);font-size:12px}

/* PILLS */
.pill{display:inline-flex;align-items:center;gap:5px;padding:2px 9px;border:1px solid var(--b2);border-radius:999px;font-size:12px;font-weight:600}
.pL{background:rgba(34,197,94,.14);border-color:rgba(34,197,94,.38);color:var(--g2)}
.pS{background:rgba(239,68,68,.14);border-color:rgba(239,68,68,.38);color:var(--r2)}
.pW{background:rgba(245,158,11,.12);border-color:rgba(245,158,11,.38);color:var(--a2)}
.pN{background:rgba(232,236,246,.06);border-color:var(--b2)}
.pY{background:rgba(34,197,94,.14);border-color:rgba(34,197,94,.38);color:var(--g2)}
.pCALM{background:rgba(59,130,246,.1);border-color:rgba(59,130,246,.35);color:var(--bl2)}
.pNORMAL{background:rgba(124,58,237,.1);border-color:rgba(124,58,237,.35);color:var(--acc2)}
.pVOLATILE{background:rgba(245,158,11,.1);border-color:rgba(245,158,11,.35);color:var(--a2)}

/* TABLES */
.mono{font-family:var(--mono)}
table{width:100%;border-collapse:collapse}
th,td{padding:7px 8px;border-bottom:1px solid var(--b1);text-align:right;font-size:12px}
th{font-size:11px;color:var(--m);font-weight:600;text-transform:uppercase;letter-spacing:.4px}
td:first-child,th:first-child{text-align:left}
tr:last-child td{border-bottom:none}
tr:hover td{background:rgba(232,236,246,.025)}
.tfTable td:nth-child(2),.tfTable th:nth-child(2){text-align:left}

/* LIFECYCLE */
.lc-current{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:12px}
@media(max-width:960px){.lc-current{grid-template-columns:1fr}}
.lc-block{background:var(--s2);border:1px solid var(--b1);border-radius:12px;padding:12px 14px}
.lc-label{font-size:10px;color:var(--m);text-transform:uppercase;letter-spacing:.7px;margin-bottom:4px}
.lc-val{font-size:16px;font-weight:800;letter-spacing:-.2px;line-height:1.2}
.lc-sub{font-size:11px;color:var(--m);margin-top:3px}
.lc-action-CE{color:var(--g2);border-color:rgba(34,197,94,.35);background:rgba(34,197,94,.1)}
.lc-action-PE{color:var(--r2);border-color:rgba(239,68,68,.35);background:rgba(239,68,68,.1)}
.lc-action-WAIT{color:var(--a2);border-color:rgba(245,158,11,.35);background:rgba(245,158,11,.08)}
.lc-action-NO{color:var(--m);border-color:var(--b2);background:rgba(232,236,246,.05)}
.lc-action-REDUCE{color:var(--r2);border-color:rgba(239,68,68,.35);background:rgba(239,68,68,.1)}
.lc-hist table{font-size:11px}
.lc-hist td,.lc-hist th{padding:5px 8px;font-size:11px}
.lc-hist th{font-size:10px}
.act-ce{color:var(--g2);font-weight:700}
.act-pe{color:var(--r2);font-weight:700}
.act-wait{color:var(--a2)}
.act-no{color:var(--m)}
.act-reduce{color:var(--r2);opacity:.7}
.flow-bull{color:var(--g2)}.flow-bear{color:var(--r2)}.flow-chop{color:var(--m)}.flow-edge{color:var(--a2)}
.scse-hi{color:var(--g2);font-weight:700}
.scse-mid{color:var(--a2);font-weight:600}
.scse-lo{color:var(--m)}
.exp-tag{display:inline-block;padding:1px 7px;border-radius:4px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.3px}
.exp-full{background:rgba(34,197,94,.18);color:var(--g2)}
.exp-mid{background:rgba(245,158,11,.15);color:var(--a2)}
.exp-low{background:rgba(239,68,68,.15);color:var(--r2)}

/* MARKET SCORE — bigger */
.score-wrap{background:linear-gradient(135deg,rgba(124,58,237,.09),rgba(6,182,212,.05));border:1px solid rgba(124,58,237,.22);border-radius:16px;padding:18px;margin-bottom:0}
.score-inner{display:flex;align-items:center;gap:16px;flex-wrap:wrap}
.score-right{flex:1;min-width:160px}
.score-tag{font-size:10px;text-transform:uppercase;letter-spacing:1px;color:var(--m);margin-bottom:5px}
.score-sent{font-size:20px;font-weight:900;letter-spacing:-.3px}
.score-num{font-size:52px;font-weight:900;font-family:var(--mono);line-height:1;margin-top:0}
.score-desc{font-size:11px;color:var(--m);margin-top:5px;line-height:1.5}
/* score facts removed — no duplication */

/* PREDICTION */
.pred-s{margin-bottom:9px}
.pred-sh{display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px}
.pred-sl{font-weight:600}.pred-sp{font-family:var(--mono);font-weight:700}
.pred-bar{height:7px;border-radius:4px;background:rgba(232,236,246,.08);overflow:hidden}
.pred-fill{height:100%;border-radius:4px;transition:width .6s ease}
.fb{background:linear-gradient(90deg,var(--r2),var(--r))}
.fs{background:linear-gradient(90deg,var(--a2),var(--a))}
.fg{background:linear-gradient(90deg,var(--g),var(--g2))}

/* RMS */
.rms-row{display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid var(--b1);font-size:12px}
.rms-row:last-child{border-bottom:none}
.rmsk{color:var(--m)}.rmsv{font-family:var(--mono);font-weight:700}

/* PIVOT LEVELS — standalone bigger card */
.piv-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:8px}
.piv-tile{background:var(--s2);border:1px solid var(--b2);border-radius:12px;padding:12px 14px;display:flex;flex-direction:column;gap:4px}
.piv-tile-cpr{border-color:rgba(124,58,237,.35);background:rgba(124,58,237,.07)}
.piv-tile-res{border-color:rgba(239,68,68,.2)}
.piv-tile-sup{border-color:rgba(34,197,94,.2)}
.piv-n{font-weight:800;font-size:11px;font-family:var(--mono);color:var(--m);letter-spacing:.5px;text-transform:uppercase}
.piv-v{font-family:var(--mono);font-size:26px;font-weight:900;line-height:1}
.piv-st{font-size:11px;display:flex;align-items:center;gap:4px;font-weight:600}
.piv-ex{font-size:10px;color:var(--m);margin-top:2px}
.dA{color:var(--g)}.dN{color:var(--a)}.dB{color:var(--r)}

/* SIGNAL HISTORY TABLE */
.sigt td,.sigt th{padding:6px 8px;border-bottom:1px solid var(--b1);white-space:nowrap;font-size:11px}
.sigt th{position:sticky;top:0;background:var(--s1);z-index:2}
.sigt td:first-child{font-weight:700;text-align:left;min-width:88px}
.sigt td{text-align:center}
.sg{color:var(--g)}.sr{color:var(--r)}.sa{color:var(--a2);font-weight:700}
.srow{background:rgba(245,158,11,.05)}
.fi{background:var(--s2);border:1px solid var(--b2);border-radius:8px;padding:5px 10px;color:var(--t);font-size:12px;width:148px;outline:none;font-family:inherit}
.fi:focus{border-color:var(--acc)}

/* COLLAPSIBLE */
.ctog{display:flex;align-items:center;justify-content:space-between;cursor:pointer;user-select:none;gap:8px}
.ctog .chev{transition:transform .2s;font-size:11px;opacity:.5;flex-shrink:0}
.ctog.open .chev{transform:rotate(180deg)}
.cbody{overflow:hidden;transition:max-height .3s ease}
.cbody.cls{max-height:0!important}

/* REASONING */
.rlist{list-style:none;margin:0;padding:0}
.ri{padding:5px 0;border-bottom:1px solid var(--b1);font-size:12px;display:flex;align-items:flex-start;gap:7px;color:var(--m)}
.ri:last-child{border-bottom:none}
.ri::before{content:'→';color:var(--acc2);flex-shrink:0}

/* GLOW */
.glow-g{box-shadow:0 0 0 1px rgba(34,197,94,.2),0 0 14px rgba(34,197,94,.07)}
.glow-r{box-shadow:0 0 0 1px rgba(239,68,68,.2),0 0 14px rgba(239,68,68,.07)}

.note{font-size:11px;color:var(--m);margin-top:6px}
.atm-row{background:rgba(124,58,237,.08)}
.divider{height:1px;background:var(--b2);margin:10px 0}
</style>
</head>
<body>

<!-- NAV -->
<div class="nav">
  <div class="nav-i">
    <div style="display:flex;align-items:center;gap:10px">
      <div class="nav-logo">N</div>
      <div><div class="nav-t">Live NIFTY Trader</div><div class="nav-s">Analysis-only · Lifecycle + Options + Breadth + RMS</div></div>
    </div>
    <div class="nav-right">
      <div class="sdot" id="sdot"></div>
      <span class="asof" id="asof">–</span>
      <button class="btn" id="btnPause">⏸ Pause</button>
      <button class="btn" id="btnResume" disabled>▶ Resume</button>
      <a href="/token" class="btn btn-a" style="text-decoration:none;font-size:11px">🔑 Kite Auth</a>
      <a href="/logout" class="btn" style="text-decoration:none;color:rgba(232,236,246,.45);font-size:11px">Sign out</a>
    </div>
  </div>
</div>

<div class="wrap">

<!-- QUICK STATS (4 cols — VIX & straddle are in Context card below) -->
<div class="stats">
  <div class="sc"><div class="sl">Futures LTP</div><div class="sv mono" id="stF">–</div><div class="ss" id="stFc">–</div></div>
  <div class="sc"><div class="sl">Breadth Move</div><div class="sv mono" id="stB">–</div><div class="ss" id="stAD">–</div></div>
  <div class="sc"><div class="sl">Buy/Sell Imb</div><div class="sv mono" id="stI">–</div><div class="ss">depth imbalance</div></div>
  <div class="sc"><div class="sl">PCR</div><div class="sv mono" id="stP">–</div><div class="ss">put / call OI ratio</div></div>
</div>

<!-- LIFECYCLE TABLE (full width, primary trading signal) -->
<div class="card">
  <div class="ct">Lifecycle Trading Signal <span class="hint">— session · flow state · action · SCSE · dominance · RR</span></div>

  <!-- Current state — 3 big blocks -->
  <div class="lc-current" id="lcCurrent">
    <div class="lc-block">
      <div class="lc-label">Session</div>
      <div class="lc-val" id="lcSession">–</div>
      <div class="lc-sub" id="lcExposure">–</div>
    </div>
    <div class="lc-block">
      <div class="lc-label">Flow State</div>
      <div class="lc-val" id="lcState">–</div>
      <div class="lc-sub" id="lcExplain" style="font-size:10px;line-height:1.5;margin-top:4px">–</div>
    </div>
    <div class="lc-block">
      <div class="lc-label">Action</div>
      <div class="lc-val" id="lcAction" style="font-size:22px">–</div>
      <div class="lc-sub" id="lcConf">–</div>
    </div>
  </div>

  <!-- Metrics row -->
  <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:8px;margin-bottom:12px;font-size:11px;text-align:center" id="lcMetrics">
    <div><div style="color:var(--m);font-size:10px;margin-bottom:2px">SCSE</div><div class="mono" id="lcScse" style="font-size:18px;font-weight:800">–</div></div>
    <div><div style="color:var(--m);font-size:10px;margin-bottom:2px">RSI 1m</div><div class="mono" id="lcRsi1" style="font-size:16px;font-weight:700">–</div></div>
    <div><div style="color:var(--m);font-size:10px;margin-bottom:2px">RSI 5m</div><div class="mono" id="lcRsi5" style="font-size:16px;font-weight:700">–</div></div>
    <div><div style="color:var(--m);font-size:10px;margin-bottom:2px">Dom B/S</div><div class="mono" id="lcDom" style="font-size:13px;font-weight:700">–</div></div>
    <div><div style="color:var(--m);font-size:10px;margin-bottom:2px">SP↑/↓</div><div class="mono" id="lcSp" style="font-size:13px;font-weight:700">–</div></div>
    <div><div style="color:var(--m);font-size:10px;margin-bottom:2px">SU↑/↓</div><div class="mono" id="lcSu" style="font-size:13px;font-weight:700">–</div></div>
    <div><div style="color:var(--m);font-size:10px;margin-bottom:2px">Eff RR CE/PE</div><div class="mono" id="lcRr" style="font-size:12px;font-weight:700">–</div></div>
  </div>

  <!-- History log -->
  <div class="ctog open" id="lcHistTog">
    <div style="font-size:10px;font-weight:700;letter-spacing:.7px;text-transform:uppercase;color:var(--m)">History Log <span style="font-weight:400;text-transform:none;letter-spacing:0">(last 40 snapshots)</span></div>
    <span class="chev">▼</span>
  </div>
  <div class="cbody lc-hist" id="lcHistBody" style="max-height:360px">
    <div style="overflow:auto;max-height:340px;margin-top:8px">
      <table class="mono">
        <thead><tr>
          <th style="text-align:left">Time (IST)</th>
          <th style="text-align:left">Session</th>
          <th style="text-align:left">State / Flow</th>
          <th style="text-align:left">Action</th>
          <th>RSI 1m/5m</th>
          <th>Raw RR</th>
          <th>Eff CE</th>
          <th>Eff PE</th>
          <th>SCSE</th>
          <th>Dom B/S</th>
          <th>SP↑↓ SU↑↓</th>
          <th style="text-align:left">Explanation</th>
        </tr></thead>
        <tbody id="lcHistTbody"></tbody>
      </table>
    </div>
    <div id="lcHistNote" class="note">Waiting for lifecycle history…</div>
  </div>
</div>

<!-- ROW: MARKET SCORE (bigger) | DECISION -->
<div class="g2">
  <!-- Market Score -->
  <div class="score-wrap">
    <div class="score-inner">
      <div>
        <svg id="gaugeSvg" viewBox="0 0 400 235" width="240" height="141" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="gRed" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stop-color="#ef4444" stop-opacity=".9"/>
              <stop offset="100%" stop-color="#f59e0b" stop-opacity=".5"/>
            </linearGradient>
            <linearGradient id="gGreen" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stop-color="#f59e0b" stop-opacity=".5"/>
              <stop offset="100%" stop-color="#22c55e" stop-opacity=".9"/>
            </linearGradient>
          </defs>
          <path d="M 40 200 A 160 160 0 0 1 360 200" fill="none" stroke="rgba(232,236,246,.06)" stroke-width="26" stroke-linecap="round"/>
          <path d="M 40 200 A 160 160 0 0 1 120 61" fill="none" stroke="url(#gRed)" stroke-width="26"/>
          <path d="M 120 61 A 160 160 0 0 1 280 61" fill="none" stroke="rgba(245,158,11,.28)" stroke-width="26"/>
          <path d="M 280 61 A 160 160 0 0 1 360 200" fill="none" stroke="url(#gGreen)" stroke-width="26"/>
          <line id="needle" x1="200" y1="198" x2="200" y2="50" stroke="white" stroke-width="3.5" stroke-linecap="round"/>
          <circle cx="200" cy="200" r="12" fill="var(--s1)" stroke="rgba(232,236,246,.2)" stroke-width="2"/>
          <circle cx="200" cy="200" r="5" fill="white"/>
          <text x="26" y="224" text-anchor="middle" font-size="10" fill="#f87171" font-weight="700">BEAR</text>
          <text x="200" y="33" text-anchor="middle" font-size="10" fill="#fbbf24" font-weight="700">NEUTRAL</text>
          <text x="374" y="224" text-anchor="middle" font-size="10" fill="#4ade80" font-weight="700">BULL</text>
        </svg>
      </div>
      <div class="score-right">
        <div class="score-tag">Market Score</div>
        <div class="score-sent" id="scoreSent" style="color:var(--m)">–</div>
        <div class="score-num" id="scoreNum" style="color:var(--m)">–</div>
        <div class="score-desc" id="scoreDesc">Waiting…</div>
      </div>
    </div>
  </div>

  <!-- Decision -->
  <div class="card" id="decCard" style="margin-bottom:0">
    <div class="ct">Decision</div>
    <div class="kv">
      <span class="k">Recommendation</span><div><span id="recPill" class="pill"><strong id="rec">–</strong></span></div>
      <span class="k">Trade TF</span><div id="tradeTf">–</div>
      <span class="k">Confidence</span><div><span class="pill mono" id="conf">–</span></div>
      <span class="k">Take trade</span><div><span id="takePill" class="pill"><strong id="take">–</strong></span></div>
      <span class="k">Options action</span><div><strong id="optAction">–</strong></div>
      <span class="k">ATM strike</span><div><strong id="atmStrike" class="mono">–</strong></div>
      <span class="k">Instrument</span><div id="optInst" class="mono" style="font-size:11px;word-break:break-all">–</div>
      <span class="k">ATM CE / PE</span><div id="atmInst" style="font-size:11px;color:var(--m)">–</div>
      <span class="k">Entry / TGT / SL</span><div id="plan" class="mono" style="color:var(--a2)">–</div>
      <span class="k">Premium / Credit</span><div id="optPremium" class="mono">–</div>
      <span class="k">Risk (max loss)</span><div id="optRisk" class="mono">–</div>
      <span class="k">Greeks Δ Γ Θ V</span><div id="posGreeks" class="mono" style="font-size:11px">–</div>
    </div>
  </div>
</div>

<!-- PIVOT LEVELS — full width, above context -->
<div class="card">
  <div class="ct">Pivot Levels <span class="hint">CPR = Central Pivot Range · TC/BC = Top/Bottom of CPR · PDH/PDL = Prev Day High/Low · R = Resistance · S = Support · ● green=ABOVE · yellow=NEAR · red=BELOW</span></div>
  <div id="pivNote" class="note">Fetching previous-day OHLC from Kite historical data…</div>
  <div id="pivGrid" style="display:none"></div>
</div>

<!-- ROW: PREDICTION+RMS | CONTEXT -->
<div class="g2">
  <div class="card" style="margin-bottom:0">
    <div class="ct">Prediction <span class="hint">1m/5m/15m confluence</span></div>
    <div style="margin-bottom:10px">
      <div class="pred-s">
        <div class="pred-sh"><span class="pred-sl" style="color:var(--r2)">▼ BEARISH</span><span class="pred-sp" id="pBear" style="color:var(--r2)">–%</span></div>
        <div class="pred-bar"><div class="pred-fill fb" id="bBear" style="width:0%"></div></div>
      </div>
      <div class="pred-s">
        <div class="pred-sh"><span class="pred-sl" style="color:var(--a2)">◆ SIDEWAYS</span><span class="pred-sp" id="pSide" style="color:var(--a2)">–%</span></div>
        <div class="pred-bar"><div class="pred-fill fs" id="bSide" style="width:0%"></div></div>
      </div>
      <div class="pred-s">
        <div class="pred-sh"><span class="pred-sl" style="color:var(--g2)">▲ BULLISH</span><span class="pred-sp" id="pBull" style="color:var(--g2)">–%</span></div>
        <div class="pred-bar"><div class="pred-fill fg" id="bBull" style="width:0%"></div></div>
      </div>
    </div>
    <div class="divider"></div>
    <div class="ct" style="margin-bottom:8px">Risk Management</div>
    <div id="rmsRows"></div>
  </div>

  <!-- Market Context card — includes VIX, straddle, regime AND pivot levels -->
  <div class="card" style="margin-bottom:0">
    <div class="ct">Market Context</div>
    <div class="kv">
      <span class="k">Breadth move</span><div><span id="bm" class="mono">–</span></div>
      <span class="k">Adv / Dec</span><div><span id="ad" class="mono">–</span></div>
      <span class="k">Buy/Sell imbalance</span><div><span id="imb" class="mono">–</span></div>
      <span class="k">PCR (chain OI)</span><div><span id="pcr" class="mono">–</span></div>
      <span class="k">ATM straddle</span><div><span id="straddle" class="mono">–</span></div>
      <span class="k">OI Δ (P / C)</span><div><span id="oid" class="mono">–</span></div>
      <span class="k">VIX</span><div><span id="vix" class="mono">–</span></div>
      <span class="k">Regime</span><div><span id="regPill" class="pill" style="font-size:15px;padding:4px 14px;font-weight:900;letter-spacing:.5px"><span id="reg">–</span></span></div>
      <span class="k">Sweep ATM CE/PE</span><div><span id="sw" class="mono" style="font-size:11px">–</span></div>
      <span class="k">News risk</span><div><span id="news" class="mono">–</span></div>
    </div>
  </div>
</div>

<!-- TIMEFRAMES -->
<div class="card">
  <div class="ct">Timeframes <span class="hint">1m · 5m · 15m — PnC = probability × confidence × confluence</span></div>
  <div style="overflow:auto">
    <table class="mono tfTable">
      <thead><tr><th>TF</th><th>Fut</th><th>Rec</th><th>Conf</th><th>Prob</th><th>PnC</th><th>Align</th></tr></thead>
      <tbody id="tfBody"></tbody>
    </table>
  </div>
  <div id="tfNote" class="note">Warming up…</div>
</div>

<!-- OPTION CHAIN -->
<div class="card">
  <div class="ct">Option Chain <span class="hint">★ ATM · CE green · PE red · ΔOI green=buildup red=unwinding</span></div>
  <div style="overflow:auto">
    <table class="mono">
      <thead><tr><th>Strike</th><th>CE LTP</th><th>CE OI</th><th>CE ΔOI</th><th>PE LTP</th><th>PE OI</th><th>PE ΔOI</th></tr></thead>
      <tbody id="chainBody"></tbody>
    </table>
  </div>
  <div id="chainNote" class="note">Waiting for chain…</div>
</div>

<!-- SIGNAL HISTORY -->
<div class="card">
  <div class="ctog open" id="sigTog">
    <div class="ct" style="margin:0">NIFTY 50 — Signal History <span class="hint">last trigger per stock (IST) · SPARTAN ≥100cr/min · sorted by latest SPARTAN</span></div>
    <span class="chev">▼</span>
  </div>
  <div class="cbody" id="sigBody" style="max-height:600px">
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:10px 0 8px">
      <input id="sigFilter" class="fi" placeholder="Filter symbol…"/>
      <button class="btn btn-g" id="btnExport">⬇ Export CSV</button>
    </div>
    <div style="overflow:auto;max-height:360px">
      <table class="mono sigt" style="width:100%">
        <thead><tr>
          <th style="text-align:left">Symbol</th>
          <th>Last BUY ↑ (IST)</th><th>Last SPARTAN↑ (IST)</th><th>Last SURFING↑ (IST)</th>
          <th>Last SELL ↓ (IST)</th><th>Last SPARTAN↓ (IST)</th><th>Last SURFING↓ (IST)</th>
        </tr></thead>
        <tbody id="sigBody2"></tbody>
      </table>
    </div>
    <div id="sigNote" class="note">Waiting for signal history…</div>
  </div>
</div>


<!-- REASONING -->
<div class="card">
  <div class="ctog" id="rsnTog">
    <div class="ct" style="margin:0">Signal Reasoning <span class="hint">why the engine made its recommendation</span></div>
    <span class="chev">▼</span>
  </div>
  <div class="cbody cls" id="rsnBody" style="max-height:0">
    <ul class="rlist" id="reasons" style="margin-top:10px"></ul>
  </div>
</div>

</div><!-- /wrap -->

<script>
var paused=false, lastSH=[], sigFilt='';

// ── Collapsible ────────────────────────────────────────────────────
function coll(tId,bId){
  var t=document.getElementById(tId),b=document.getElementById(bId);
  if(!t||!b)return;
  t.addEventListener('click',function(){
    var op=t.classList.toggle('open');
    if(op){b.classList.remove('cls');b.style.maxHeight='600px';}
    else{b.classList.add('cls');b.style.maxHeight='0';}
  });
}
coll('sigTog','sigBody'); coll('logTog','logBody'); coll('rsnTog','rsnBody'); coll('lcHistTog','lcHistBody');

// ── Utils ──────────────────────────────────────────────────────────
function fmt(n,d){if(n==null||!isFinite(n))return '-';return Number(n).toFixed(d!=null?d:2);}
function toIST(iso){
  if(!iso)return '-';
  var d=new Date(iso),ist=new Date(d.getTime()+5.5*60*60*1000);
  var dd=String(ist.getUTCDate()).padStart(2,'0');
  var mo=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][ist.getUTCMonth()];
  return dd+'-'+mo+' '+String(ist.getUTCHours()).padStart(2,'0')+':'+String(ist.getUTCMinutes()).padStart(2,'0');
}
function pillCls(r){
  var u=String(r||'').toUpperCase();
  if(u==='LONG')return 'pL';if(u==='SHORT')return 'pS';if(u==='NO_TRADE')return 'pN';return 'pW';
}
function e(id){return document.getElementById(id);}

// ── Market Score ───────────────────────────────────────────────────
function calcScore(obj){
  var sc=0,b=obj.breadth||{},opt=obj.options||{},tfs=obj.timeframes||{};
  var adv=Number(b.advancers||0),dec=Number(b.decliners||0);
  var ad=dec>0?adv/dec:(adv>0?5:1);
  if(ad>2)sc+=18;else if(ad>1.4)sc+=10;else if(ad>1.1)sc+=4;
  else if(ad<0.5)sc-=18;else if(ad<0.7)sc-=10;else if(ad<0.9)sc-=4;
  var wm=Number(b.weighted_move_pct||0);
  if(wm>0.5)sc+=14;else if(wm>0.15)sc+=7;else if(wm>0.04)sc+=3;
  else if(wm<-0.5)sc-=14;else if(wm<-0.15)sc-=7;else if(wm<-0.04)sc-=3;
  var imb=Number(b.buy_sell_imbalance||0);
  if(imb>0.25)sc+=10;else if(imb>0.1)sc+=5;else if(imb<-0.25)sc-=10;else if(imb<-0.1)sc-=5;
  var pcr=opt.chain&&opt.chain.totals?opt.chain.totals.pcr:null;
  if(pcr!=null){if(pcr>1.4)sc+=8;else if(pcr>1.1)sc+=4;else if(pcr<0.65)sc-=8;else if(pcr<0.9)sc-=4;}
  var wts={'1m':1,'5m':1.5,'15m':2};
  for(var k in wts){var r2=String((tfs[k]||{}).recommendation||'NO_TRADE').toUpperCase();if(r2==='LONG')sc+=7*wts[k];else if(r2==='SHORT')sc-=7*wts[k];}
  var vix=opt.vix?opt.vix.value:null;
  if(vix!=null){if(vix>22)sc-=12;else if(vix>18)sc-=5;else if(vix<12)sc+=6;else if(vix<15)sc+=2;}
  var sw=opt.sweeps?opt.sweeps.fut:null;
  if(sw&&sw.side==='BUY')sc+=6;else if(sw&&sw.side==='SELL')sc-=6;
  return Math.max(-100,Math.min(100,Math.round(sc)));
}
function updateGauge(score){
  var needle=e('needle');if(!needle)return;
  var ang=(90-score*90/100)*Math.PI/180,R=148,cx=200,cy=200;
  needle.setAttribute('x2',(cx+R*Math.cos(ang)).toFixed(1));
  needle.setAttribute('y2',(cy-R*Math.sin(ang)).toFixed(1));
  var col=score>20?'var(--g2)':score<-20?'var(--r2)':'var(--a2)';
  needle.setAttribute('stroke',col);
  var sn=e('scoreNum');if(sn){sn.textContent=(score>=0?'+':'')+score;sn.style.color=col;}
  var ss=e('scoreSent');if(ss){
    var lbl=score>40?'STRONGLY BULLISH':score>15?'BULLISH':score>-15?'NEUTRAL':score>-40?'BEARISH':'STRONGLY BEARISH';
    ss.textContent=lbl;ss.style.color=col;
  }
  var dc=e('decCard');if(dc)dc.className='card'+(score>20?' glow-g':score<-20?' glow-r':'');
}
function updateScoreFacts(obj,score){
  var opt=obj.options||{};
  var sd=e('scoreDesc');
  if(sd){
    var reg=(opt.regime?opt.regime.label:null)||'NORMAL';
    var nw=String((obj.news?obj.news.level:null)||'medium').toUpperCase();
    var lbl=score>40?'Full bull momentum — favour CE buys':score>15?'Leaning bullish — look for CE setups':score>-15?'Balanced — wait for clean flow':score>-40?'Leaning bearish — look for PE setups':'Full bear momentum — favour PE buys';
    sd.textContent=lbl+' · Regime: '+reg+' · News: '+nw;
  }
}

// ── Lifecycle ──────────────────────────────────────────────────────
function actionCls(a){
  if(!a)return 'act-no';
  var u=String(a).toUpperCase();
  if(u.indexOf('CE')>=0)return 'act-ce';
  if(u.indexOf('PE')>=0)return 'act-pe';
  if(u.indexOf('REDUCE')>=0)return 'act-reduce';
  if(u.indexOf('WAIT')>=0||u.indexOf('CLEAN')>=0)return 'act-wait';
  return 'act-no';
}
function stateCls(s){
  if(!s)return 'flow-chop';
  var u=String(s).toUpperCase();
  if(u.indexOf('BULL')>=0)return 'flow-bull';
  if(u.indexOf('BEAR')>=0)return 'flow-bear';
  if(u.indexOf('CHOP')>=0||u.indexOf('CONFLICT')>=0)return 'flow-chop';
  return 'flow-edge';
}
function scseClass(n){if(n>=50)return 'scse-hi';if(n>=30)return 'scse-mid';return 'scse-lo';}
function expTagCls(pct){if(pct>=80)return 'exp-full';if(pct>=40)return 'exp-mid';return 'exp-low';}

function renderLifecycle(obj){
  var lc=obj.lifecycle;
  if(!lc)return;
  // Big blocks
  var sess=String(lc.session||'–').replace(/_/g,' ');
  var sessEl=e('lcSession');if(sessEl)sessEl.textContent=sess;
  var expEl=e('lcExposure');
  if(expEl){var ep=lc.maxExposurePct||0;expEl.innerHTML='Max exposure <span class="exp-tag '+expTagCls(ep)+'">'+ep+'%</span>';}
  var stEl=e('lcState');
  if(stEl){stEl.textContent=String(lc.state||'–').replace(/_/g,' ');stEl.className='lc-val '+stateCls(lc.state);}
  var exEl=e('lcExplain');if(exEl)exEl.textContent=lc.explanation||'–';
  var acEl=e('lcAction');
  if(acEl){
    var acStr=String(lc.action||'–').replace(/_/g,' ');
    acEl.textContent=acStr;
    var ac=String(lc.action||'').toUpperCase();
    if(ac.indexOf('CE')>=0)acEl.style.color='var(--g2)';
    else if(ac.indexOf('PE')>=0)acEl.style.color='var(--r2)';
    else if(ac.indexOf('REDUCE')>=0)acEl.style.color='var(--r2)';
    else if(ac.indexOf('WAIT')>=0||ac.indexOf('CLEAN')>=0)acEl.style.color='var(--a2)';
    else acEl.style.color='var(--m)';
  }
  var confEl=e('lcConf');if(confEl)confEl.textContent='Confidence: '+(lc.confidence!=null?lc.confidence+'%':'–');
  // Metrics
  var sc=lc.scse!=null?lc.scse:null;
  var scEl=e('lcScse');if(scEl){scEl.textContent=sc!=null?String(sc):'–';scEl.className='mono '+scseClass(sc||0);}
  var r1=e('lcRsi1');if(r1){r1.textContent=lc.rsi&&lc.rsi.m1!=null?fmt(lc.rsi.m1,1):'–';if(lc.rsi&&lc.rsi.m1!=null)r1.style.color=lc.rsi.m1>55?'var(--g)':lc.rsi.m1<45?'var(--r)':'var(--m)';}
  var r5=e('lcRsi5');if(r5){r5.textContent=lc.rsi&&lc.rsi.m5!=null?fmt(lc.rsi.m5,1):'–';}
  var dm=e('lcDom');if(dm&&lc.dominance){var d=lc.dominance;dm.textContent='B '+d.buy+'/S '+d.sell;dm.style.color=d.side==='BUY'?'var(--g)':d.side==='SELL'?'var(--r)':'var(--m)';}
  var sp=e('lcSp');if(sp&&lc.spartan)sp.textContent=lc.spartan.up+'↑ '+lc.spartan.dn+'↓';
  var su=e('lcSu');if(su&&lc.surfing)su.textContent=lc.surfing.up+'↑ '+lc.surfing.dn+'↓';
  var rr=e('lcRr');if(rr&&lc.rr)rr.textContent=fmt(lc.rr.effCE,2)+' / '+fmt(lc.rr.effPE,2);

  // History table
  var hist=obj.lifecycleHistory||[];
  var tb=e('lcHistTbody'),hn=e('lcHistNote');
  if(tb){
    tb.innerHTML='';
    var rows=hist.slice().reverse().slice(0,40);
    if(rows.length){
      if(hn)hn.textContent='';
      for(var i=0;i<rows.length;i++){
        var h=rows[i];
        var tr=document.createElement('tr');
        var ac2=String(h.action||'');var ac2cls=actionCls(ac2);
        var sc2=h.scse!=null?h.scse:null;
        var domStr=h.dominance?('B'+h.dominance.buy+'/S'+h.dominance.sell):'–';
        var spStr=h.spartan?h.spartan.up+'↑'+h.spartan.dn+'↓':'–';
        var suStr=h.surfing?h.surfing.up+'↑'+h.surfing.dn+'↓':'–';
        tr.innerHTML=
          '<td style="white-space:nowrap;text-align:left">'+toIST(h.asof)+'</td>'+
          '<td style="text-align:left;font-size:10px;color:var(--m)">'+String(h.session||'–').replace(/_/g,' ')+'</td>'+
          '<td style="text-align:left" class="'+stateCls(h.state)+'">'+String(h.state||'–').replace(/_/g,' ')+'</td>'+
          '<td style="text-align:left" class="'+ac2cls+'">'+ac2.replace(/_/g,' ')+'</td>'+
          '<td>'+(h.rsi&&h.rsi.m1!=null?fmt(h.rsi.m1,0):'–')+' / '+(h.rsi&&h.rsi.m5!=null?fmt(h.rsi.m5,0):'–')+'</td>'+
          '<td>'+(h.rr?fmt(h.rr.rawCE,2):'–')+'</td>'+
          '<td class="'+(h.rr&&h.rr.effCE>1.5?'up':h.rr&&h.rr.effCE<0.8?'dn':'')+'">'+  (h.rr?fmt(h.rr.effCE,2):'–')+'</td>'+
          '<td class="'+(h.rr&&h.rr.effPE>1.5?'up':h.rr&&h.rr.effPE<0.8?'dn':'')+'">'+  (h.rr?fmt(h.rr.effPE,2):'–')+'</td>'+
          '<td class="'+scseClass(sc2||0)+'">'+(sc2!=null?sc2:'–')+'</td>'+
          '<td style="color:'+(h.dominance&&h.dominance.side==='BUY'?'var(--g)':h.dominance&&h.dominance.side==='SELL'?'var(--r)':'var(--m)')+'">'+domStr+'</td>'+
          '<td style="font-size:10px;color:var(--m)">'+spStr+' '+suStr+'</td>'+
          '<td style="text-align:left;font-size:10px;color:var(--m);max-width:280px;white-space:normal">'+String(h.explanation||'–')+'</td>';
        tb.appendChild(tr);
      }
    } else { if(hn)hn.textContent='Waiting for lifecycle history…'; }
  }
}

// ── Pivot Levels — standalone bigger tiles ─────────────────────────
var PIV_META={
  r2:{ex:'Strong Resistance',cls:'piv-tile-res'},
  r1:{ex:'Resistance',cls:'piv-tile-res'},
  pdh:{ex:'Prev Day High',cls:''},
  tc:{ex:'Top of CPR',cls:'piv-tile-cpr'},
  cpr:{ex:'Central Pivot Point',cls:'piv-tile-cpr'},
  bc:{ex:'Bottom of CPR',cls:'piv-tile-cpr'},
  pdl:{ex:'Prev Day Low',cls:''},
  s1:{ex:'Support',cls:'piv-tile-sup'},
  s2:{ex:'Strong Support',cls:'piv-tile-sup'},
  s3:{ex:'Next Support',cls:'piv-tile-sup'}
};
function renderPiv(piv){
  var note=e('pivNote'),grid=e('pivGrid');if(!grid||!note)return;
  if(!piv){note.style.display='';grid.style.display='none';return;}
  note.style.display='none';grid.style.display='';
  var keys=['r2','r1','pdh','tc','cpr','bc','pdl','s1','s2','s3'];
  var ordered=keys.map(function(k){return{k:k,lv:piv[k]};}).filter(function(x){return x.lv;});
  ordered.sort(function(a,b){return b.lv.value-a.lv.value;});
  var html='';
  if(piv.prevDayOhlc){var o=piv.prevDayOhlc;html+='<div style="font-size:11px;color:var(--m);margin-bottom:10px;font-family:var(--mono)">Prev Day  H: <b>'+o.h.toFixed(0)+'</b>  L: <b>'+o.l.toFixed(0)+'</b>  C: <b>'+o.c.toFixed(0)+'</b></div>';}
  html+='<div class="piv-grid">';
  for(var i=0;i<ordered.length;i++){
    var item=ordered[i],lv=item.lv,meta=PIV_META[item.k]||{ex:'',cls:''};
    var dc=lv.status==='ABOVE'?'dA':lv.status==='NEAR'?'dN':'dB';
    html+='<div class="piv-tile '+(meta.cls||'')+'">';
    html+='<div class="piv-n">'+lv.name+'</div>';
    html+='<div class="piv-v '+dc+'">'+lv.value.toFixed(0)+'</div>';
    html+='<div class="piv-st"><span class="'+dc+'">●</span><span class="'+dc+'">'+lv.status+'</span></div>';
    html+='<div class="piv-ex">'+meta.ex+'</div>';
    html+='</div>';
  }
  html+='</div>';
  grid.innerHTML=html;
}

// ── Prediction + RMS ───────────────────────────────────────────────
function renderPredRms(obj){
  var tfs=obj.timeframes||{};
  var bull=0,bear=0,side=0,wts={'1m':1,'5m':1.5,'15m':2};
  for(var k in wts){var r2=String((tfs[k]||{}).recommendation||'NO_TRADE').toUpperCase();if(r2==='LONG')bull+=wts[k];else if(r2==='SHORT')bear+=wts[k];else side+=wts[k];}
  var tot=bull+bear+side||1,bP=Math.round(bear/tot*100),sP=Math.round(side/tot*100),buP=100-bP-sP;
  if(e('pBear'))e('pBear').textContent=bP+'%';if(e('pSide'))e('pSide').textContent=sP+'%';if(e('pBull'))e('pBull').textContent=buP+'%';
  if(e('bBear'))e('bBear').style.width=bP+'%';if(e('bSide'))e('bSide').style.width=sP+'%';if(e('bBull'))e('bBull').style.width=buP+'%';
  var opt=obj.options||{},sug=opt.suggestion||{},plan=opt.tradePlan||null,rms=obj.rms||{},nw=obj.news||{};
  var planStr='-';
  if(plan&&plan.kind==='BUY_PREMIUM')planStr=fmt(plan.entryPremium,2)+' / '+fmt(plan.targetPremium,2)+' / '+fmt(plan.stopPremium,2);
  else if(plan&&plan.kind==='CREDIT_SPREAD')planStr='Cr '+fmt(plan.entryNetCredit,2)+' / TBk '+fmt(plan.targetBuyback,2)+' / SBk '+fmt(plan.stopBuyback,2);
  var maxLoss=sug.maxLoss!=null?'₹'+fmt(sug.maxLoss,0):(opt.creditSpreads&&opt.creditSpreads.put&&opt.creditSpreads.put.maxLoss!=null?'₹'+fmt(opt.creditSpreads.put.maxLoss,0):'–');
  var rows=[
    {k:'Max Daily Loss',v:rms.maxDailyLoss!=null?'₹'+Number(rms.maxDailyLoss).toLocaleString():'— not set'},
    {k:'Max Risk / Trade',v:rms.maxRiskPerTrade!=null?'₹'+Number(rms.maxRiskPerTrade).toLocaleString():'— not set'},
    {k:'Position Max Loss',v:maxLoss},
    {k:'Entry / TGT / SL',v:planStr},
    {k:'Regime',v:(opt.regime?opt.regime.label:null)||'–'},
    {k:'News Risk',v:String(nw.level||'–').toUpperCase()},
    {k:'Implied Move',v:opt.ivProxy&&opt.ivProxy.impliedMovePct!=null?fmt(opt.ivProxy.impliedMovePct,2)+'%':'–'},
  ];
  var rr=e('rmsRows');if(rr)rr.innerHTML=rows.map(function(i){var c=String(i.v).indexOf('not set')>=0?'color:var(--m)':'';return '<div class="rms-row"><span class="rmsk">'+i.k+'</span><span class="rmsv" style="'+c+'">'+i.v+'</span></div>';}).join('');
}

// ── Signal History ─────────────────────────────────────────────────
function renderSH(arr){
  lastSH=arr||[];
  var tbody=e('sigBody2'),note=e('sigNote');if(!tbody)return;
  tbody.innerHTML='';
  if(!Array.isArray(arr)||!arr.length){if(note)note.textContent='Waiting for signal history…';return;}
  if(note)note.textContent='';
  var filt=sigFilt.trim().toUpperCase();
  var rows=filt?arr.filter(function(r){return(r.symbol||'').toUpperCase().indexOf(filt)>=0;}):arr;
  rows=rows.slice().sort(function(a,b){var ta=a.lastSpartanUp||a.lastSpartanDn||a.lastBuy||'',tb=b.lastSpartanUp||b.lastSpartanDn||b.lastBuy||'';if(ta&&tb)return tb.localeCompare(ta);return ta?-1:tb?1:(a.symbol||'').localeCompare(b.symbol||'');});
  for(var i=0;i<rows.length;i++){
    var r=rows[i],hasSp=r.lastSpartanUp||r.lastSpartanDn,tr=document.createElement('tr');
    if(hasSp)tr.className='srow';
    var sym=document.createElement('td');sym.textContent=r.symbol||r.key||'-';tr.appendChild(sym);
    var cols=[{v:r.lastBuy,p:'[UP] ',c:'sg'},{v:r.lastSpartanUp,p:'SPARTAN ',c:'sa'},{v:r.lastSurfingUp,p:'SURF ',c:'sg'},{v:r.lastSell,p:'[DN] ',c:'sr'},{v:r.lastSpartanDn,p:'SPARTAN ',c:'sa'},{v:r.lastSurfingDn,p:'SURF ',c:'sr'}];
    for(var j=0;j<cols.length;j++){var c=cols[j],td=document.createElement('td');if(c.v){td.textContent=c.p+toIST(c.v);td.className=c.c;}else{td.textContent='–';td.style.opacity='0.22';}tr.appendChild(td);}
    tbody.appendChild(tr);
  }
}
var sf=e('sigFilter');if(sf)sf.addEventListener('input',function(){sigFilt=this.value;renderSH(lastSH);});

e('btnExport')&&e('btnExport').addEventListener('click',function(){
  if(!lastSH.length){alert('No signal history yet.');return;}
  var h=['Symbol','Last BUY','Last SPARTAN UP','Last SURFING UP','Last SELL','Last SPARTAN DN','Last SURFING DN'];
  var lines=[h.join(',')];
  for(var i=0;i<lastSH.length;i++){var r=lastSH[i];lines.push([r.symbol,toIST(r.lastBuy),toIST(r.lastSpartanUp),toIST(r.lastSurfingUp),toIST(r.lastSell),toIST(r.lastSpartanDn),toIST(r.lastSurfingDn)].join(','));}
  var blob=new Blob([lines.join('\\n')],{type:'text/csv'});
  var url=URL.createObjectURL(blob);
  var a=document.createElement('a');a.href=url;a.download='signal_history_'+new Date().toISOString().slice(0,10)+'.csv';a.click();URL.revokeObjectURL(url);
});

// ── Reasoning ─────────────────────────────────────────────────────
function setReasons(list){
  var el=e('reasons');if(!el)return;el.innerHTML='';
  for(var i=0;i<(list||[]).length;i++){var li=document.createElement('li');li.className='ri';li.textContent=list[i];el.appendChild(li);}
}

// ── Main applyUpdate ───────────────────────────────────────────────
function applyUpdate(obj){
  if(!obj||paused)return;
  var sd=e('sdot');if(sd)sd.className='sdot live';
  var ao=e('asof');if(ao&&obj.asof)ao.textContent='Last: '+toIST(obj.asof)+' IST';

  var s=obj.suggestion||{};
  if(e('rec'))e('rec').textContent=s.recommendation||'–';
  if(e('conf'))e('conf').textContent=typeof s.confidence==='number'?(s.confidence*100).toFixed(1)+'%':'–';
  if(e('tradeTf'))e('tradeTf').textContent=obj.tradeTimeframe||obj.tradeTimeframeRequested||'–';
  if(e('recPill'))e('recPill').className='pill '+pillCls(s.recommendation);

  // Timeframes table
  var tfs=obj.timeframes||{},tfb=e('tfBody'),tfn=e('tfNote');
  if(tfb){
    tfb.innerHTML='';
    var order=['1m','5m','15m'],rows=order.map(function(k){return{k:k,v:tfs[k]};}).filter(function(x){return x.v;});
    if(rows.length){
      if(tfn)tfn.textContent='PnC = probability × confidence × confluence.';
      for(var i=0;i<rows.length;i++){
        var rv=rows[i].v||{};
        var tr=document.createElement('tr');
        tr.innerHTML='<td class="mono">'+rows[i].k+'</td><td class="mono">'+(obj.futureLtp!=null?fmt(obj.futureLtp,2):'–')+'</td>'+
          '<td><span class="pill '+pillCls(rv.recommendation)+'">'+String(rv.recommendation||'–')+'</span></td>'+
          '<td class="mono">'+(rv.confidence!=null?(rv.confidence*100).toFixed(1)+'%':'–')+'</td>'+
          '<td class="mono">'+(rv.probability!=null?(rv.probability*100).toFixed(1)+'%':'–')+'</td>'+
          '<td class="mono">'+(rv.pnc!=null?Number(rv.pnc).toFixed(4):'–')+'</td>'+
          '<td class="mono">'+((rv.confluence&&rv.confluence.ratio!=null)?(rv.confluence.ratio*100).toFixed(0)+'%':'–')+'</td>';
        tfb.appendChild(tr);
      }
    } else {if(tfn)tfn.textContent='Warming up…';}
  }

  var b=obj.breadth||{},bmv=b.weighted_move_pct,imbv=b.buy_sell_imbalance;
  if(e('bm')){e('bm').textContent=bmv==null?'–':fmt(bmv,3)+'%';e('bm').className='mono '+(bmv>0?'up':bmv<0?'dn':'');}
  if(e('ad'))e('ad').textContent=String(b.advancers||'–')+' / '+String(b.decliners||'–');
  if(e('imb')){e('imb').textContent=imbv==null?'–':fmt(imbv,3);e('imb').className='mono '+(imbv>0.05?'up':imbv<-0.05?'dn':'');}

  // Quick stats (4 cols)
  if(e('stF'))e('stF').textContent=obj.futureLtp!=null?fmt(obj.futureLtp,0):'–';
  if(e('stFc'))e('stFc').textContent=obj.futureLtp!=null?'ltp':'–';
  if(e('stB')){e('stB').textContent=bmv!=null?(bmv>=0?'+':'')+fmt(bmv,2)+'%':'–';e('stB').className='sv mono '+(bmv>0?'up':bmv<0?'dn':'neu');}
  if(e('stAD'))e('stAD').textContent=String(b.advancers||'–')+' adv / '+String(b.decliners||'–')+' dec';
  if(e('stI')){e('stI').textContent=imbv!=null?(imbv>=0?'+':'')+fmt(imbv,3):'–';e('stI').className='sv mono '+(imbv>0.05?'up':imbv<-0.05?'dn':'neu');}
  var pcrv=obj.options&&obj.options.chain&&obj.options.chain.totals?obj.options.chain.totals.pcr:null;
  if(e('stP')){e('stP').textContent=pcrv!=null?fmt(pcrv,2):'–';e('stP').className='sv mono '+(pcrv>1.1?'up':pcrv<0.9?'dn':'neu');}

  var opt=obj.options||{},sug=opt.suggestion||{},plan=opt.tradePlan||null,dec=opt.decision||null,ivp=opt.ivProxy||{},reg=opt.regime||{},nw=obj.news||{};
  var vixv=opt.vix?opt.vix.value:null;

  if(e('atmStrike'))e('atmStrike').textContent=opt.atmStrike!=null?String(opt.atmStrike):'–';
  if(e('optAction')){var st=sug.style||'–',ac2=sug.action||'–';e('optAction').textContent=st==='–'?'–':(st+(ac2!=='–'?' / '+ac2:''));}
  if(e('straddle')){var s0=ivp.straddle!=null?Number(ivp.straddle):null,mv=ivp.impliedMovePct!=null?Number(ivp.impliedMovePct):null;e('straddle').textContent=(s0!=null?fmt(s0,2):'–')+' (move '+(mv!=null?fmt(mv,2)+'%':'–')+')';}
  if(e('underPx')){var bas=opt.atmBasis||{};var sp2=bas.spot&&bas.spot.instrument?(bas.spot.instrument+(bas.spot.ltp!=null?' @ '+fmt(bas.spot.ltp,2):'')):'–';e('underPx')&&(e('underPx').textContent='used '+(bas.source||'–')+' | spot '+sp2);}
  if(e('plan')){if(!plan)e('plan').textContent='–';else if(plan.kind==='BUY_PREMIUM')e('plan').textContent='Entry '+fmt(plan.entryPremium,2)+' | TGT '+fmt(plan.targetPremium,2)+' | SL '+fmt(plan.stopPremium,2);else if(plan.kind==='CREDIT_SPREAD')e('plan').textContent='Credit '+fmt(plan.entryNetCredit,2)+' | Tgt buyback '+fmt(plan.targetBuyback,2)+' | SL buyback '+fmt(plan.stopBuyback,2);else e('plan').textContent='–';}
  if(e('optInst')){if(sug.style==='BUY'){var inst=String(sug.instrument||'–'),str2=sug.strike!=null?String(sug.strike):null,mon=sug.moneyness?String(sug.moneyness):null,dlt=sug.delta!=null&&isFinite(sug.delta)?'Δ '+fmt(sug.delta,2):null;var ex=[str2?'strike '+str2:null,mon,dlt].filter(Boolean).join(' · ');e('optInst').textContent=ex?(inst+' ('+ex+')'):inst;}else if(sug.style==='CREDIT_SPREAD'){var sp3=sug.spread||{},sl2=sp3.legs&&sp3.legs.sell?sp3.legs.sell:{},bl2=sp3.legs&&sp3.legs.buy?sp3.legs.buy:{};e('optInst').textContent='SELL '+(sl2.instrument||'–')+(sl2.premium!=null?' @ '+fmt(sl2.premium,2):'')+' | BUY '+(bl2.instrument||'–')+(bl2.premium!=null?' @ '+fmt(bl2.premium,2):'')+' | credit '+(sp3.netCredit!=null?fmt(sp3.netCredit,2):'–');}else e('optInst').textContent='–';}
  if(e('atmInst')){var ce2=opt.atm&&opt.atm.ce?opt.atm.ce:{},pe2=opt.atm&&opt.atm.pe?opt.atm.pe:{};e('atmInst').textContent='CE: '+(ce2.instrument||'–')+(ce2.premium!=null?' @ '+fmt(ce2.premium,2):'')+' | PE: '+(pe2.instrument||'–')+(pe2.premium!=null?' @ '+fmt(pe2.premium,2):'');}
  if(e('take'))e('take').textContent=dec&&typeof dec.takeTrade==='boolean'?(dec.takeTrade?'YES'+(dec.action?' / '+dec.action:''):'NO'+(dec.action?' / '+dec.action:'')):'–';
  if(e('takePill'))e('takePill').className='pill'+(dec&&dec.takeTrade===true?' pY':dec&&dec.takeTrade===false?' pW':'');
  if(e('optPremium')){if(sug.style==='BUY')e('optPremium').textContent=sug.premium!=null?fmt(sug.premium,2):'–';else if(sug.style==='CREDIT_SPREAD')e('optPremium').textContent='Net credit: '+(sug.spread&&sug.spread.netCredit!=null?fmt(sug.spread.netCredit,2):'–');else e('optPremium').textContent='–';}
  if(e('optRisk')){if(sug.style==='BUY')e('optRisk').textContent=sug.maxLoss!=null?fmt(sug.maxLoss,2)+' on qty '+String(sug.quantity):'–';else if(sug.style==='CREDIT_SPREAD'){var sp4=sug.spread||{};e('optRisk').textContent='MaxP:'+fmt(sp4.maxProfit,2)+' | MaxL:'+fmt(sp4.maxLoss,2)+' | BE:'+fmt(sp4.breakeven,2)+' | qty '+(obj.quantity||'–');}else e('optRisk').textContent='–';}
  var pg=opt.greeks&&opt.greeks.position?opt.greeks.position:null;
  if(e('posGreeks'))e('posGreeks').textContent=pg?'Δ '+fmt(pg.delta,2)+' | Γ '+fmt(pg.gamma,4)+' | Θ/day '+fmt(pg.thetaPerDay,2)+' | Vega '+fmt(pg.vega,2):'–';
  if(e('pcr'))e('pcr').textContent=pcrv!=null?fmt(pcrv,4):'–';
  var pod=opt.chain&&opt.chain.totals?opt.chain.totals.putOiChange:null,cod=opt.chain&&opt.chain.totals?opt.chain.totals.callOiChange:null;
  if(e('oid'))e('oid').textContent=(pod==null&&cod==null)?'–':(String(pod||'–')+' / '+String(cod||'–'));
  if(e('vix'))e('vix').textContent=vixv!=null?fmt(vixv,2):'–';
  if(e('reg'))e('reg').textContent=reg.label?(String(reg.label)+(reg.impliedMovePct!=null?' | ±'+fmt(reg.impliedMovePct,2)+'%':'')):'–';
  if(e('regPill'))e('regPill').className='pill p'+(reg.label||'');
  var swCe=opt.sweeps&&opt.sweeps.atmCE?opt.sweeps.atmCE:{},swPe=opt.sweeps&&opt.sweeps.atmPE?opt.sweeps.atmPE:{};
  if(e('sw'))e('sw').textContent='CE:'+(swCe.side?swCe.side+' ('+fmt(swCe.score,1)+')':'–')+' | PE:'+(swPe.side?swPe.side+' ('+fmt(swPe.score,1)+')':'–');
  if(e('news'))e('news').textContent=nw.level?(String(nw.level)+(nw.score!=null?' ('+fmt(nw.score,2)+')':'')):'–';

  // Option chain
  var cb=e('chainBody'),cn2=e('chainNote');
  if(cb){cb.innerHTML='';var cr=opt.chain&&opt.chain.strikes?opt.chain.strikes:[];
    if(Array.isArray(cr)&&cr.length){if(cn2)cn2.textContent='';
      for(var i2=0;i2<Math.min(cr.length,19);i2++){var rr2=cr[i2],isAtm=rr2&&rr2.strike===opt.atmStrike,tr2=document.createElement('tr');if(isAtm)tr2.className='atm-row';var ceOiC=rr2&&rr2.ce&&rr2.ce.oiChange,peOiC=rr2&&rr2.pe&&rr2.pe.oiChange;tr2.innerHTML='<td class="mono" style="font-weight:'+(isAtm?'700':'400')+'">'+(rr2&&rr2.strike?String(rr2.strike):'–')+(isAtm?' ★':'')+'</td><td class="mono up">'+(rr2&&rr2.ce&&rr2.ce.premium!=null?fmt(rr2.ce.premium,2):'–')+'</td><td class="mono">'+(rr2&&rr2.ce&&rr2.ce.oi!=null?String(rr2.ce.oi):'–')+'</td><td class="mono" style="color:'+(ceOiC>0?'var(--g)':ceOiC<0?'var(--r)':'var(--m)')+'">'+String(ceOiC!=null?ceOiC:'–')+'</td><td class="mono dn">'+(rr2&&rr2.pe&&rr2.pe.premium!=null?fmt(rr2.pe.premium,2):'–')+'</td><td class="mono">'+(rr2&&rr2.pe&&rr2.pe.oi!=null?String(rr2.pe.oi):'–')+'</td><td class="mono" style="color:'+(peOiC>0?'var(--g)':peOiC<0?'var(--r)':'var(--m)')+'">'+String(peOiC!=null?peOiC:'–')+'</td>';cb.appendChild(tr2);}
    } else {if(cn2)cn2.textContent='No chain data yet.';}
  }

  // All new sections
  renderPiv(obj.pivotLevels||null);
  renderPredRms(obj);
  renderSH(obj.stockSignalHistory||[]);
  renderLifecycle(obj);
  var score=calcScore(obj);updateGauge(score);updateScoreFacts(obj,score);


  // Reasoning
  var headlines=(nw.headlines||[]).slice(0,4).map(function(h){return 'news: '+String(h&&h.title?h.title:'');});
  var decR=(dec&&dec.reasons?dec.reasons:[]).slice(0,4).map(function(r){return 'decision: '+String(r);});
  setReasons([].concat(s.reasoning||[]).concat(decR).concat(headlines));
}

function connect(){var es=new EventSource('/events');es.onmessage=function(ev){try{applyUpdate(JSON.parse(ev.data));}catch(e2){}};es.onerror=function(){};}

e('btnPause').onclick=function(){paused=true;e('btnPause').disabled=true;e('btnResume').disabled=false;var sd=e('sdot');if(sd)sd.className='sdot';};
e('btnResume').onclick=function(){paused=false;e('btnPause').disabled=false;e('btnResume').disabled=true;var sd=e('sdot');if(sd)sd.className='sdot live';};

connect();
</script>
</body>
</html>`;
}

function startSuggestProcess(args: string[]): ChildProcessWithoutNullStreams {
  const nodeBin = process.execPath;
  const tsxCli = path.join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
  const script = path.join(process.cwd(), "src", "cli", "stream-suggest.ts");
  const child = spawn(nodeBin, [tsxCli, script, ...args], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  try { child.stdin.end(); } catch {}
  return child;
}

async function main() {
  // Railway injects PORT; fall back to --port flag, then 3333.
  const requestedPort = Number(getArgValue("--port") ?? process.env.PORT ?? "3333");
  if (!Number.isFinite(requestedPort) || requestedPort < 0) throw new Error("Invalid --port");

  const suggestArgs: string[] = [];
  if (!hasFlag("--optionsOnly") && !hasFlag("--options-only")) suggestArgs.push("--optionsOnly");

  const passthrough = [
    "--weights", "--mode", "--intervalMs", "--interval-ms",
    "--historyDays", "--history-days", "--tradeTf", "--trade-tf",
    "--fast", "--slow", "--underlying", "--expiry",
    "--optStep", "--opt-step", "--creditDistance", "--credit-distance",
    "--creditWidth", "--credit-width", "--tpPct", "--tp-pct",
    "--slPct", "--sl-pct", "--creditTakePct", "--credit-take-pct",
    "--creditStopMult", "--credit-stop-mult", "--newsRisk", "--news-risk",
    "--lot", "--lots", "--fee", "--slippage-bps",
    "--maxDailyLoss", "--max-daily-loss", "--maxRiskPerTrade", "--max-risk-per-trade",
  ];
  for (const k of passthrough) { const v = getArgValue(k); if (v !== null) suggestArgs.push(k, v); }
  if (hasFlag("--aggressive")) suggestArgs.push("--aggressive");
  if (hasFlag("--telegram")) suggestArgs.push("--telegram");
  if (!suggestArgs.includes("--mode")) suggestArgs.push("--mode", "full");

  let child: ChildProcessWithoutNullStreams | null = null;
  let childRunning = false;
  let buffer = "";
  let lastEngineError: string | null = null;
  let lastEngineExit: { code: number | null; signal: NodeJS.Signals | null; at: string } | null = null;
  const clients = new Map<string, Client>();

  function broadcast(line: string) { for (const c of clients.values()) c.res.write(`data: ${line}\n\n`); }

  function ensureChild() {
    if (childRunning) return;
    lastEngineError = null;
    child = startSuggestProcess(suggestArgs);
    childRunning = true;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.on("error", (err) => { lastEngineError = err instanceof Error ? err.message : String(err); childRunning = false; child = null; buffer = ""; });
    child.stdout.on("data", (chunk: string) => {
      buffer += chunk;
      while (true) { const idx = buffer.indexOf("\n"); if (idx < 0) break; const line = buffer.slice(0, idx).trim(); buffer = buffer.slice(idx + 1); if (!line) continue; if (line.startsWith("{")) broadcast(line); }
    });
    child.stderr.on("data", (chunk: string) => { const s = String(chunk ?? "").trim(); if (s) lastEngineError = s.slice(-600); });
    child.on("exit", (code, signal) => { lastEngineExit = { code: code ?? null, signal: (signal as any) ?? null, at: new Date().toISOString() }; childRunning = false; child = null; buffer = ""; });
  }

  function authHtml(message: string, ok: boolean): string {
    const col = ok ? "#22c55e" : "#ef4444";
    const icon = ok ? "✓" : "✗";
    return `<!doctype html><html><body style="font-family:system-ui;background:#02030a;color:#e8ecf6;padding:48px;text-align:center">
<h2 style="color:${col};font-size:28px">${icon} ${message}</h2>
${ok ? '<p style="color:#aaa">Token saved. Engine restarting — go back to the dashboard.</p>' : ""}
<p style="margin-top:24px"><a href="/" style="color:#7c3aed;font-size:14px">← Back to dashboard</a></p>
</body></html>`;
  }

  function tokenPageHtml(error = ""): string {
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Kite Auth — NIFTY Trader</title>
<style>
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
    background:radial-gradient(ellipse at 50% 0%,rgba(6,182,212,.15) 0%,#02030a 70%);
    font-family:system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#e8ecf6}
  .card{background:#0d1117;border:1px solid rgba(6,182,212,.28);border-radius:20px;
    padding:36px 40px;width:480px;box-shadow:0 0 40px rgba(6,182,212,.1)}
  h1{font-size:19px;font-weight:800;margin:0 0 4px}
  .sub{font-size:12px;color:rgba(232,236,246,.5);margin:0 0 24px;line-height:1.5}
  .step{background:rgba(232,236,246,.05);border:1px solid rgba(232,236,246,.1);border-radius:10px;
    padding:12px 14px;margin-bottom:10px;font-size:12px;line-height:1.6}
  .step b{color:#e8ecf6}.step a{color:#06b6d4}
  label{display:block;font-size:11px;font-weight:700;letter-spacing:.7px;text-transform:uppercase;
    color:rgba(232,236,246,.5);margin:16px 0 5px}
  input{width:100%;padding:11px 14px;background:rgba(232,236,246,.06);border:1px solid rgba(232,236,246,.13);
    border-radius:10px;color:#e8ecf6;font-size:13px;outline:none;font-family:var(--mono,monospace);transition:border .15s}
  input:focus{border-color:#06b6d4}
  .err{color:#f87171;font-size:12px;margin:8px 0;padding:8px 12px;background:rgba(239,68,68,.1);
    border-radius:8px;display:${error ? "block" : "none"}}
  button{width:100%;margin-top:14px;padding:12px;background:linear-gradient(135deg,#0891b2,#06b6d4);
    border:none;border-radius:10px;color:#fff;font-size:14px;font-weight:700;cursor:pointer;transition:opacity .15s}
  button:hover{opacity:.88}
  .back{text-align:center;margin-top:16px;font-size:12px}
  .back a{color:rgba(232,236,246,.4)}
</style>
</head>
<body>
<div class="card">
  <h1>🔑 Kite Authentication</h1>
  <p class="sub">Generate a Kite session to start receiving live data.<br>Do this each morning before 9:15 AM.</p>

  <div class="step">
    <b>Step 1</b> — <a href="/auth" target="_blank">Click here to open Zerodha login →</a><br>
    Log in with your Zerodha credentials.
  </div>
  <div class="step">
    <b>Step 2</b> — After login, look at the URL in your browser.<br>
    Copy the value after <b>request_token=</b> (stops at &amp; or end of URL).
  </div>
  <div class="step">
    <b>Step 3</b> — Paste it below and click Submit.
  </div>

  <form method="POST" action="/token">
    <label>Request Token</label>
    <input name="request_token" type="text" placeholder="Paste request_token here…" autocomplete="off" required/>
    <div class="err">${error}</div>
    <button type="submit">Submit &amp; Activate →</button>
  </form>
  <div class="back"><a href="/">← Back to dashboard</a></div>
</div>
</body>
</html>`;
  }

  // ── Login / session auth ────────────────────────────────────────────
  const UI_USERNAME = (process.env.UI_USERNAME ?? "admin").trim();
  const UI_PASSWORD = (process.env.UI_PASSWORD ?? "").trim();
  const authEnabled = UI_PASSWORD.length > 0;

  // Sessions survive restarts: derive a deterministic token from credentials + a fixed secret.
  // Any browser that has a valid cookie keeps working across redeploys.
  const { createHmac } = await import("crypto");
  const SESSION_SECRET = process.env.UI_SESSION_SECRET ?? (UI_PASSWORD + UI_USERNAME + "nifty-trader-v1");
  function makeToken(username: string): string {
    return createHmac("sha256", SESSION_SECRET).update(username).digest("hex");
  }
  // Deterministic: same credentials always produce the same token, so no in-memory Set needed.
  const VALID_TOKEN = authEnabled ? makeToken(UI_USERNAME) : null;

  function loginHtml(error = false): string {
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Login — NIFTY Trader</title>
<style>
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
    background:radial-gradient(ellipse at 50% 0%,rgba(124,58,237,.18) 0%,#02030a 70%);
    font-family:system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:#e8ecf6}
  .card{background:#0d1117;border:1px solid rgba(124,58,237,.3);border-radius:20px;
    padding:40px 44px;width:360px;box-shadow:0 0 40px rgba(124,58,237,.12)}
  .logo{width:44px;height:44px;border-radius:13px;background:linear-gradient(135deg,#7c3aed,#06b6d4);
    display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:900;
    color:#fff;margin:0 auto 20px}
  h1{text-align:center;font-size:20px;font-weight:800;margin:0 0 6px;letter-spacing:-.3px}
  .sub{text-align:center;font-size:12px;color:rgba(232,236,246,.5);margin-bottom:28px}
  label{display:block;font-size:11px;font-weight:700;letter-spacing:.7px;text-transform:uppercase;
    color:rgba(232,236,246,.55);margin-bottom:5px}
  input{width:100%;padding:11px 14px;background:rgba(232,236,246,.06);border:1px solid rgba(232,236,246,.13);
    border-radius:10px;color:#e8ecf6;font-size:14px;outline:none;margin-bottom:16px;
    font-family:inherit;transition:border .15s}
  input:focus{border-color:rgba(124,58,237,.6)}
  .err{background:rgba(239,68,68,.12);border:1px solid rgba(239,68,68,.35);border-radius:8px;
    color:#f87171;font-size:12px;padding:9px 12px;margin-bottom:16px;text-align:center;
    display:${error ? "block" : "none"}}
  button{width:100%;padding:12px;background:linear-gradient(135deg,#7c3aed,#6d28d9);
    border:none;border-radius:10px;color:#fff;font-size:14px;font-weight:700;
    cursor:pointer;letter-spacing:.2px;transition:opacity .15s}
  button:hover{opacity:.88}
</style>
</head>
<body>
<div class="card">
  <div class="logo">N</div>
  <h1>NIFTY Trader</h1>
  <p class="sub">Live options analysis dashboard</p>
  <form method="POST" action="/login">
    <div class="err">Invalid username or password</div>
    <label>Username</label>
    <input name="username" type="text" autocomplete="username" autofocus required/>
    <label>Password</label>
    <input name="password" type="password" autocomplete="current-password" required/>
    <button type="submit">Sign in →</button>
  </form>
</div>
</body>
</html>`;
  }

  function getCookieToken(req: http.IncomingMessage): string | null {
    const header = req.headers.cookie ?? "";
    for (const part of header.split(";")) {
      const [k, v] = part.trim().split("=");
      if (k?.trim() === "nifty_sess" && v?.trim()) return v.trim();
    }
    return null;
  }

  function isLoggedIn(req: http.IncomingMessage): boolean {
    if (!authEnabled) return true;
    const token = getCookieToken(req);
    return token !== null && token === VALID_TOKEN;
  }

  function makeSessionCookie(token: string): string {
    const secure = process.env.NODE_ENV === "production" || process.env.RAILWAY_ENVIRONMENT ? "; Secure" : "";
    // SameSite=Lax (not Strict) so the cookie is sent on OAuth top-level redirects back from Zerodha.
    return `nifty_sess=${token}; HttpOnly; Path=/; Max-Age=86400; SameSite=Lax${secure}`;
  }

  async function readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve) => {
      let data = "";
      req.on("data", (chunk) => { data += String(chunk); });
      req.on("end", () => resolve(data));
      req.on("error", () => resolve(""));
    });
  }

  const server = http.createServer(async (req, res) => {
    const url = req.url ?? "/";

    // ── Login routes (always public) ─────────────────────────────────
    if (url === "/login" || url === "/login/") {
      if (req.method === "POST") {
        const body = await readBody(req);
        const params = Object.fromEntries(new URLSearchParams(body));
        if (params.username === UI_USERNAME && params.password === UI_PASSWORD) {
          const token = VALID_TOKEN!;
          res.writeHead(302, { "set-cookie": makeSessionCookie(token), location: "/" });
          res.end();
        } else {
          res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
          res.end(loginHtml(true));
        }
      } else {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(loginHtml(false));
      }
      return;
    }

    // /token  → manual request_token entry page (no redirect URL config needed)
    if (url === "/token" || url === "/token/") {
      if (req.method === "POST") {
        const body = await readBody(req);
        const params = Object.fromEntries(new URLSearchParams(body));
        const requestToken = (params["request_token"] ?? "").trim();
        if (!requestToken) {
          res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
          res.end(tokenPageHtml("Please paste a request_token."));
          return;
        }
        try {
          const { generateAndStoreSession } = await import("../kite/auth");
          await generateAndStoreSession(requestToken);
          if (child) { try { child.kill("SIGTERM"); } catch {} child = null; childRunning = false; buffer = ""; }
          res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
          res.end(authHtml("Session activated! Engine restarting.", true));
        } catch (e) {
          res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
          res.end(tokenPageHtml("Failed: " + String(e)));
        }
      } else {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(tokenPageHtml());
      }
      return;
    }

    if (url === "/logout") {
      // No server-side state to clear — token is deterministic.
      res.writeHead(302, { "set-cookie": "nifty_sess=; HttpOnly; Path=/; Max-Age=0", location: "/login" });
      res.end();
      return;
    }

    // /auth + /auth/callback are PUBLIC — Kite's API secret secures the callback,
    // and SameSite=Lax cookies would be stripped anyway on the cross-site redirect.
    if (url === "/auth" || url === "/auth/") {
      try {
        const { getLoginUrl } = await import("../kite/auth");
        res.writeHead(302, { location: getLoginUrl() });
        res.end();
      } catch (e) {
        res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
        res.end("Failed to build login URL: " + String(e));
      }
      return;
    }

    if (url?.startsWith("/auth/callback")) {
      try {
        const qs = url.includes("?") ? url.slice(url.indexOf("?") + 1) : "";
        const params = Object.fromEntries(qs.split("&").map((p) => p.split("=").map(decodeURIComponent)));
        const requestToken = params["request_token"] ?? params["request-token"] ?? null;
        if (!requestToken) {
          res.writeHead(400, { "content-type": "text/html; charset=utf-8" });
          res.end(authHtml("Missing request_token", false));
          return;
        }
        const { generateAndStoreSession } = await import("../kite/auth");
        await generateAndStoreSession(requestToken);
        if (child) { try { child.kill("SIGTERM"); } catch {} child = null; childRunning = false; buffer = ""; }
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(authHtml("Session activated! Engine restarting.", true));
      } catch (e) {
        res.writeHead(500, { "content-type": "text/html; charset=utf-8" });
        res.end(authHtml("Failed: " + String(e), false));
      }
      return;
    }

    // ── Auth gate — redirect to /login if not authenticated ──────────
    if (!isLoggedIn(req)) {
      res.writeHead(302, { location: "/login" });
      res.end();
      return;
    }

    if (url === "/") { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(htmlPage({ title: "Live Trade Suggestion" })); return; }
    if (url === "/health") { res.writeHead(200, { "content-type": "application/json; charset=utf-8" }); res.end(JSON.stringify({ ok: true, app: "kite-fo-ui", clients: clients.size, engineRunning: childRunning, lastEngineExit, lastEngineError })); return; }
    if (url === "/events") {
      ensureChild();
      const id = nowId();
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache, no-transform",
        "connection": "keep-alive",
        "x-accel-buffering": "no",   // tell nginx/Railway proxy not to buffer
        "transfer-encoding": "identity",
      });
      res.write(`: connected ${id}\n\n`);
      clients.set(id, { id, res });

      // Keepalive ping every 25 s — prevents Railway/nginx from closing idle SSE connections.
      const keepalive = setInterval(() => {
        try { res.write(`: ping\n\n`); } catch { clearInterval(keepalive); }
      }, 25_000);

      req.on("close", () => { clients.delete(id); clearInterval(keepalive); });
      return;
    }
    if (url === "/favicon.ico") { res.writeHead(204); res.end(); return; }
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
  });

  function startOnPort(port: number) {
    server.listen(port, "0.0.0.0", () => {
      const addr = server.address();
      const actualPort = typeof addr === "object" && addr ? addr.port : port;
      // eslint-disable-next-line no-console
      console.log(`UI running at http://127.0.0.1:${actualPort}`);
      ensureChild();
    });
  }

  let tried = 0;
  server.on("error", (err: any) => {
    const code = err?.code;
    if (code === "EADDRINUSE" && tried < 20) { tried++; const next = requestedPort + tried; console.error(`Port ${requestedPort + tried - 1} in use; trying ${next}...`); setTimeout(() => startOnPort(next), 50); return; }
    console.error(err); process.exit(1);
  });

  startOnPort(requestedPort);
}

main().catch((err) => { console.error(err); process.exit(1); });
