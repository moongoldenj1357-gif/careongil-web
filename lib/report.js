// 케어온길 비즈 — 지역 리포트 자동 작성
// buildReport(order) → 보고서 내용(JSON). report.html이 이 JSON을 그려서 보여 줌.
//  product: basic(기본) | detail(상세) | custom(맞춤형 종합 분석)
import { sb, sbAll } from "./db.js";
import { geocode } from "./kakao.js";

export const KIND_NM = { home: "요양원", daycare: "주야간보호", short: "단기보호" };
export const PRODUCTS = {
  basic: { nm: "기본 리포트", price: 33000 },
  detail: { nm: "상세 리포트", price: 55000 },
  custom: { nm: "맞춤형 종합 분석", price: 99000 },
};
// 2026년 장기요양 수가 (하루, 원) — 주야간보호는 8~10시간 기준
export const FEE = {
  daycare: { 1: 69730, 2: 64590, 3: 59640, 4: 58010, 5: 56360 },
  home: { 1: 93070, 2: 86340, 3: 81540, 4: 81540, 5: 81540 },
  short: { 1: 74060, 2: 68580, 3: 63350, 4: 61680, 5: 60000 },
};
// 이용자 등급 구성 가정
export const MIX = {
  home: { 1: 0.3, 2: 0.4, 3: 0.3 },
  daycare: { 1: 0.03, 2: 0.12, 3: 0.4, 4: 0.35, 5: 0.1 },
  short: { 1: 0.2, 2: 0.3, 3: 0.3, 4: 0.15, 5: 0.05 },
};
const DAYS = { home: 30.4, short: 30.4, daycare: 22 };
const OTHER_PER_CAP = { home: 250000, short: 250000, daycare: 200000 }; // 식재료·공과금·소모품·차량 등 (정원 1명당 월)
const AREA_PY_PER_CAP = { home: 7.56, short: 7.56, daycare: 3 }; // 표준 가정 임차 면적 (정원 1명당 평)
const LABOR_RATIO = 0.6; // 표준 가정: 이용률 95%일 때 매출의 60%
const CW_RATIO = { daycare: 7, home: 2.3, short: 2.3 }; // 요양보호사 1명당 이용자 수 (법정 최소 배치 기준)
const CW_WAGE = 2900000; // 요양보호사 1명 월 인건비 가정 (급여 + 4대보험·퇴직금 등)

const sum = (a, b) => (a == null && b == null ? null : (a || 0) + (b || 0));
const r1 = (x) => Math.round(x * 10) / 10;
const med = (a) => { const s = a.filter((x) => x != null && isFinite(x)).sort((x, y) => x - y); if (!s.length) return null; const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const yearOf = (d) => (d ? +String(d).slice(0, 4) : null);

// ---------- 시장 요약 ----------
function agg(list, since) {
  const o = { n: list.length, capacity: 0, now: 0, wait: 0, capN: 0, new3y: 0, grades: { A: 0, B: 0, C: 0, D: 0, E: 0, 없음: 0 } };
  for (const r of list) {
    const now = sum(r.now_m, r.now_f), wait = sum(r.wait_m, r.wait_f);
    if (r.capacity != null && now != null) { o.capacity += r.capacity; o.now += now; o.capN++; }
    if (wait != null) o.wait += wait;
    if (r.designated && r.designated >= since) o.new3y++;
    o.grades[/^[A-E]$/.test(r.eval_grade || "") ? r.eval_grade : "없음"]++;
  }
  o.occ = o.capacity ? r1((o.now / o.capacity) * 100) : null;
  o.vacancy = o.capacity ? Math.max(0, o.capacity - o.now) : null;
  return o;
}
function popOf(list) {
  if (!list.length) return null;
  const t = { total: 0, p65: 0, p75: 0, p80: 0, p85: 0, p90: 0, p70_79: 0, p80_89: 0 };
  for (const x of list) { t.total += x.total; t.p65 += x.p65; t.p75 += x.p75; t.p80 += x.p80_89 + x.p90; t.p85 += x.p85; t.p90 += x.p90; t.p70_79 += x.p70_79; t.p80_89 += x.p80_89; }
  t.aged = t.total ? r1((t.p65 / t.total) * 100) : null;
  return t;
}
const density = (o, pop) => { if (pop?.p80) { o.capPer1k80 = o.capN ? r1((o.capacity / pop.p80) * 1000) : o.n ? null : 0; } return o; };

// 5년 뒤 고령 인구 (지금의 나이대를 5년 뒤로 옮기고 5년 생존율을 곱함; 전입·전출 제외)
const SURV = { 70: 0.905, 75: 0.86, 80: 0.73, 85: 0.56, 90: 0.31 };
function outlook(p) {
  if (!p) return null;
  const b90 = p.p90, b85 = p.p85 - p.p90, b80 = p.p80_89 - b85, b75 = p.p75 - p.p80_89 - p.p90, b70 = p.p70_79 - b75;
  const f80 = b75 * SURV[75] + b80 * SURV[80] + b85 * SURV[85] + b90 * SURV[90];
  const f85 = b80 * SURV[80] + b85 * SURV[85] + b90 * SURV[90];
  const f75 = b70 * SURV[70] + f80;
  const row = (now, fut) => ({ now, fut: Math.round(fut), pct: now ? r1((fut / now - 1) * 100) : null });
  return { a75: row(p.p75, f75), a80: row(p.p80, f80), a85: row(p.p85, f85) };
}

function signal(o, base) {
  if (o.occ == null || !base || base.occ == null) return null;
  const d = o.occ - base.occ;
  const lines = [];
  lines.push(d >= 5 ? `이용률(${o.occ}%)이 시·도 평균(${base.occ}%)보다 ${r1(d)}%p 높아, 시·도 안에서 이용 수요가 많은 편입니다.`
    : d <= -5 ? `이용률(${o.occ}%)이 시·도 평균(${base.occ}%)보다 ${r1(-d)}%p 낮아, 남는 자리가 많은 편입니다.`
    : `이용률(${o.occ}%)은 시·도 평균(${base.occ}%)과 비슷합니다.`);
  if (o.capPer1k80 != null && base.capPer1k80) {
    const r = o.capPer1k80 / base.capPer1k80;
    const cap = r <= 0.85 ? "low" : r >= 1.15 ? "high" : "mid", use = d >= 5 || (d > -5 && o.wait > 0 && o.occ >= base.occ) ? "high" : d <= -5 ? "low" : "mid";
    const m = { "low-high": "고령 인구에 비해 자리가 적은데 이용률은 높아, 공급이 부족한 편으로 보입니다.", "high-high": "고령 인구에 비해 자리가 많은데도 이용률이 높아, 다른 지역 수요까지 들어오는 곳으로 보입니다.", "high-low": "고령 인구에 비해 자리가 많고 이용률은 낮아, 경쟁이 치열한 편으로 보입니다.", "low-low": "고령 인구에 비해 자리도 적고 이용률도 낮아, 이용 수요 자체가 적은 편으로 보입니다." }[`${cap}-${use}`];
    lines.push(`80세 이상 1,000명당 정원은 ${o.capPer1k80}석으로 시·도 평균(${base.capPer1k80}석)의 ${r1(r)}배입니다.${m ? " " + m : ""}`);
  }
  return lines;
}

// ---------- 손익 ----------
export function revPerUser(kind, mix = MIX[kind], days = DAYS[kind]) {
  let fee = 0;
  for (const [g, w] of Object.entries(mix)) fee += FEE[kind][g] * w;
  return { fee: Math.round(fee), month: Math.round(fee * days) };
}
function plCalc({ kind, cap, rent, labor, other, mix, days }) {
  const ru = revPerUser(kind, mix, days);
  const full = ru.month * cap;
  labor = labor ?? Math.round(full * 0.95 * LABOR_RATIO);
  other = other ?? OTHER_PER_CAP[kind] * cap;
  const fixed = labor + rent + other;
  const be = r1((fixed / full) * 100);
  const at = (p) => { const rev = Math.round(full * p / 100); return { occ: p, rev, profit: rev - fixed }; };
  return { cap, perUser: ru, rent, labor, other, fixed, be, rows: [70, 80, 90, 95].map(at) };
}
function ramp(pl, invest = 0, start = 30, max = 95) {
  const out = [];
  for (const step of [4, 8]) {
    let cum = -invest, occ = start, minV = Infinity, minM = 0, payback = null;
    const pts = [];
    for (let m = 1; m <= 24; m++) {
      cum += Math.round((pl.perUser.month * pl.cap * occ) / 100) - pl.fixed;
      pts.push(cum);
      if (cum < minV) { minV = cum; minM = m; }
      if (payback == null && m > 1 && cum >= 0) payback = m;
      occ = Math.min(max, occ + step);
    }
    out.push({ step, pts, min: minV, minM, payback });
  }
  return out;
}

// ---------- 반경 분석 ----------
function km(a, b) {
  const R = 6371, t = Math.PI / 180;
  const x = Math.sin(((b.lat - a.lat) * t) / 2) ** 2 + Math.cos(a.lat * t) * Math.cos(b.lat * t) * Math.sin(((b.lng - a.lng) * t) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
async function fillGeo(rows, budgetMs = 25000) {
  const t0 = Date.now(), todo = rows.filter((r) => r.lat == null && r.addr);
  for (let i = 0; i < todo.length && Date.now() - t0 < budgetMs; i += 8) {
    await Promise.all(todo.slice(i, i + 8).map(async (r) => {
      const g = await geocode(r.addr).catch(() => null);
      if (!g) return;
      r.lat = g.lat; r.lng = g.lng;
      await sb(`ltc_insts?sym=eq.${r.sym}&pttn=eq.${r.pttn}`, { method: "PATCH", body: { lat: g.lat, lng: g.lng, geo_at: new Date().toISOString() }, prefer: "return=minimal" }).catch(() => {});
    }));
  }
  return todo.filter((r) => r.lat == null).length;
}

// ---------- 본체 ----------
export async function buildReport(o) {
  const { product, sido_cd: sido, sgg_cd: sgg, kind } = o;
  const inp = o.inputs || {};
  if (!KIND_NM[kind]) throw new Error("지원하지 않는 기관 종류");
  const since = new Date(Date.now() - 3 * 365.25 * 864e5).toISOString().slice(0, 10);
  const full = product !== "basic";

  const names = await sb(`sgg_names?select=sgg_cd,sido_nm,sgg_nm&sido_cd=eq.${sido}`);
  const sidoNm = names[0]?.sido_nm || sido, nm = new Map(names.map((x) => [x.sgg_cd, x.sgg_nm]));
  const sggNm = nm.get(sgg) || sgg;

  const sidoRows = await sbAll(`ltc_insts?select=sym,pttn,sgg_cd,capacity,now_m,now_f,wait_m,wait_f,eval_grade,designated&sido_cd=eq.${sido}&kind=eq.${kind}&order=sym.asc,pttn.asc`);
  const cols = "sym,pttn,name,addr,capacity,now_m,now_f,wait_m,wait_f,eval_grade,eval_year,designated,staff,rooms,nonpay,lat,lng";
  const local = await sbAll(`ltc_insts?select=${cols}&sido_cd=eq.${sido}&sgg_cd=eq.${sgg}&kind=eq.${kind}&order=capacity.desc.nullslast,name.asc`);

  const pops = await sb(`pop_sgg?select=sgg_cd,sgg_nm,ym,total,p65,p70_79,p75,p80_89,p85,p90&sido_cd=eq.${sido}&order=ym.desc`).catch(() => []);
  const popYm = pops[0]?.ym || null, pop = new Map();
  for (const x of pops) if (x.ym === popYm) pop.set(x.sgg_cd, x);

  const sidoPop = popOf([...pop.values()]), sggPop = pop.has(sgg) ? popOf([pop.get(sgg)]) : null;
  const sidoStats = density(agg(sidoRows, since), sidoPop);
  const sggStats = density(agg(local, since), sggPop);

  // 시·군·구 비교표
  const bySgg = new Map();
  for (const r of sidoRows) { if (!bySgg.has(r.sgg_cd)) bySgg.set(r.sgg_cd, []); bySgg.get(r.sgg_cd).push(r); }
  for (const cd of pop.keys()) if (!bySgg.has(cd)) bySgg.set(cd, []);
  const sggs = [...bySgg.entries()].map(([cd, l]) => {
    const p = pop.has(cd) ? popOf([pop.get(cd)]) : null, a = density(agg(l, since), p);
    return { cd, nm: nm.get(cd) || pop.get(cd)?.sgg_nm || cd, n: a.n, capacity: a.capacity, occ: a.occ, wait: a.wait, new3y: a.new3y, p80: p?.p80 ?? null, capPer1k80: a.capPer1k80 ?? null, me: cd === sgg };
  }).filter((x) => x.n || x.p80).sort((a, b) => (b.occ ?? -1) - (a.occ ?? -1));

  // 규모별
  const SIZES = [[0, 9, "10인 미만"], [10, 29, "10~29인"], [30, 49, "30~49인"], [50, 99, "50~99인"], [100, 1e9, "100인 이상"]];
  const shaped = local.map((r) => { const now = sum(r.now_m, r.now_f), wait = sum(r.wait_m, r.wait_f); return { ...r, now, wait, occ: r.capacity && now != null ? Math.round((now / r.capacity) * 100) : null }; });
  const group = (list) => { const c = list.filter((r) => r.capacity && r.now != null); const cap = c.reduce((s, r) => s + r.capacity, 0), now = c.reduce((s, r) => s + r.now, 0); return { n: list.length, cap, occ: cap ? r1((now / cap) * 100) : null, wait: list.reduce((s, r) => s + (r.wait || 0), 0) }; };
  const bySize = SIZES.map(([lo, hi, label]) => ({ label, ...group(shaped.filter((r) => r.capacity != null && r.capacity >= lo && r.capacity <= hi)) })).filter((x) => x.n);
  const byGrade = ["A", "B", "C", "D", "E", "없음"].map((g) => ({ label: g === "없음" ? "평가 없음(신규 등)" : `${g}등급`, ...group(shaped.filter((r) => (/^[A-E]$/.test(r.eval_grade || "") ? r.eval_grade : "없음") === g)) })).filter((x) => x.n);
  const yrs = {};
  for (const r of shaped) { const y = yearOf(r.designated); if (y) yrs[y] = (yrs[y] || 0) + 1; }
  const thisY = new Date().getFullYear();
  const newByYear = Array.from({ length: 8 }, (_, i) => thisY - 7 + i).map((y) => ({ y, n: yrs[y] || 0 }));

  // 운영 중간값
  const cw = shaped.filter((r) => r.staff && r.capacity).map((r) => (r.staff.요양보호사 || 0) / r.capacity * 10);
  // 1식 식재료비: 기관이 올린 식재료비 중 가장 큰 금액(간식 제외 효과)
  const food = shaped.map((r) => (Array.isArray(r.nonpay) ? Math.max(0, ...r.nonpay.filter((x) => x.종류 === "식재료비").map((x) => +x.금액 || 0)) || null : null));
  const ops = { cwPer10: cw.length ? r1(med(cw)) : null, foodMed: med(food), n: cw.length };
  if (kind === "home") {
    const tot = { "1인실": 0, "2인실": 0, "3인실": 0, "4인실": 0 };
    for (const r of shaped) if (r.rooms) for (const k in tot) tot[k] += (r.rooms[k] || 0);
    ops.rooms = tot;
  }

  // 평가 이력 (상세·맞춤형)
  let evals = new Map();
  if (full && shaped.length) {
    const syms = [...new Set(shaped.map((r) => r.sym))];
    for (let i = 0; i < syms.length; i += 100) {
      const d = await sb(`ltc_evals?select=sym,eval_date,grade&kind=eq.${kind}&sym=in.(${syms.slice(i, i + 100).join(",")})&order=eval_date.asc`).catch(() => []);
      for (const e of d) { if (!evals.has(e.sym)) evals.set(e.sym, []); if (e.grade) evals.get(e.sym).push(e.grade); }
    }
  }
  const row = (r) => ({ name: r.name, y: yearOf(r.designated), cap: r.capacity, now: r.now, occ: r.occ, wait: r.wait, grade: /^[A-E]$/.test(r.eval_grade || "") ? r.eval_grade : null, ...(full ? { hist: evals.get(r.sym) || [], cw: r.staff?.요양보호사 ?? null } : {}) });

  const out = {
    v: 1, product, product_nm: PRODUCTS[product].nm, no: o.no, made_at: new Date().toISOString(),
    region: { sido, sgg, sido_nm: sidoNm, sgg_nm: sggNm }, kind, kind_nm: KIND_NM[kind], since, popYm,
    sgg: { ...sggStats, pop: sggPop }, sido: { ...sidoStats, pop: sidoPop }, signal: signal(sggStats, sidoStats),
    sggs, bySize, byGrade, newByYear,
    newOcc: group(shaped.filter((r) => !/^[A-E]$/.test(r.eval_grade || "") && r.designated >= since)),
    ops,
    top: shaped.slice(0, 10).map(row),
  };
  if (full) out.list = shaped.map(row);
  if (full) out.outlook = { sgg: outlook(sggPop), sido: outlook(sidoPop), cap: sggStats.capacity };

  // 표준 손익 (기본·상세)
  const caps = kind === "daycare" ? [20, 30, 50] : [30, 50, 70];
  out.plStd = { assume: { laborRatio: LABOR_RATIO, otherPerCap: OTHER_PER_CAP[kind], areaPy: AREA_PY_PER_CAP[kind], rentPy: 30000, mix: MIX[kind], days: DAYS[kind] },
    rows: caps.map((cap) => plCalc({ kind, cap, rent: Math.round(cap * AREA_PY_PER_CAP[kind] * 30000) })) };
  if (product === "detail") { const p = out.plStd.rows[1]; out.rampStd = { cap: p.cap, be: p.be, fixed: p.fixed, series: ramp(p) }; }

  // 맞춤형
  if (product === "custom") {
    const man = (x) => (x == null || x === "" ? null : Math.round(+x * 10000));
    const cap = Math.max(1, Math.min(300, +inp.cap || 30));
    const days = kind === "daycare" ? (+inp.days || 22) : DAYS[kind];
    const pl = plCalc({ kind, cap, rent: man(inp.rent) || 0, labor: man(inp.labor), other: man(inp.other), days });
    const invest = (man(inp.invest) || 0);
    const minCw = Math.ceil(cap / CW_RATIO[kind]);
    out.custom = {
      inputs: { cap, rent: pl.rent, labor: pl.labor, laborGiven: man(inp.labor) != null, other: pl.other, otherGiven: man(inp.other) != null, deposit: man(inp.deposit), invest, days, addr: inp.addr || null },
      pl, ramp: ramp(pl, invest),
      sens: [-0.1, 0, 0.1].map((dl) => ({ dl, cells: [-0.2, 0, 0.2].map((dr) => r1(((pl.labor * (1 + dl) + pl.rent * (1 + dr) + pl.other) / (pl.perUser.month * cap)) * 100)) })),
      staff: { ratio: CW_RATIO[kind], minCw, wage: CW_WAGE, minCost: minCw * CW_WAGE, share: pl.labor ? r1((minCw * CW_WAGE / pl.labor) * 100) : null },
      vsLocal: { occ: sggStats.occ, newOcc: out.newOcc.occ },
    };
    // 반경 분석
    if (inp.addr) {
      const site = await geocode(inp.addr).catch((e) => { out.custom.nearErr = e.message; return null; });
      if (site) {
        const city = sggNm.split(" ")[0];
        const area = sggNm.includes(" ") ? [...nm.entries()].filter(([, n]) => n.startsWith(city + " ")).map(([cd]) => cd) : [sgg];
        // 같은 시(일반구가 있는 시는 시 전체) + 둘레 시·군·구는 거리로 거름
        const cand = await sbAll(`ltc_insts?select=${cols},sgg_cd&sido_cd=eq.${sido}&kind=eq.${kind}${sido === "11" || sido === "26" || sido === "27" || sido === "28" || sido === "29" || sido === "30" || sido === "31" ? "" : `&sgg_cd=in.(${[...new Set([...area, sgg])].join(",")})`}&order=sym.asc`);
        const left = await fillGeo(cand);
        const withD = cand.filter((r) => r.lat != null).map((r) => { const now = sum(r.now_m, r.now_f), wait = sum(r.wait_m, r.wait_f); return { name: r.name, d: Math.round(km(site, r) * 100) / 100, cap: r.capacity, now, wait, occ: r.capacity && now != null ? Math.round((now / r.capacity) * 100) : null, grade: /^[A-E]$/.test(r.eval_grade || "") ? r.eval_grade : null, y: yearOf(r.designated) }; }).sort((a, b) => a.d - b.d);
        const ring = (k) => { const l = withD.filter((x) => x.d <= k); return { k, ...group(l.map((x) => ({ capacity: x.cap, now: x.now, wait: x.wait }))) }; };
        out.custom.near = { addr: inp.addr, rings: [ring(1), ring(2), ring(3)], list: withD.filter((x) => x.d <= 3).slice(0, 20), missing: left };
      }
    }
  }
  return out;
}
