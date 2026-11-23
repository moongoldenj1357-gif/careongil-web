// 케어온길 지역별 현황 페이지 (검색엔진용, 서버에서 HTML을 바로 만들어 보냄)
//  /area                      → 전국 시·도 목록            (vercel.json: /area → /api/area)
//  /area/41                   → 시·도의 시·군·구 × 기관 종류 목록
//  /area/41/285/home          → 시·군·구 × 기관 종류 현황 (기관 수·정원·이용률·빈자리·대기·평가·기관 목록)
//  자료: ltc_insts(공단 장기요양기관), sgg_names(지역 이름), pop_sgg(주민등록 인구)
//  개인정보·좌표는 다루지 않음. 응답은 CDN에 하루 캐시(검색 로봇이 DB를 자주 두드리지 않게).
import { sb, SB_URL, SB_KEY } from "../lib/db.js";

export const config = { maxDuration: 30 };
const SITE = "https://www.careongil.kr";
export const AREA_KINDS = { home: "요양원", daycare: "주야간보호", short: "단기보호", visit_care: "방문요양", visit_bath: "방문목욕", visit_nurse: "방문간호" };
const STAY = ["home", "daycare", "short"]; // 정원이 있는 시설형
const KIND_DESC = {
  home: "어르신이 입소해 24시간 돌봄을 받는 시설(노인요양시설)",
  daycare: "낮 동안 어르신을 모셔 와 돌보고 저녁에 댁으로 모셔다 드리는 시설(주야간보호)",
  short: "가족이 잠시 돌보기 어려울 때 짧은 기간 입소하는 시설(단기보호)",
  visit_care: "요양보호사가 댁으로 찾아가 식사·위생·가사 등을 돕는 서비스(방문요양)",
  visit_bath: "목욕 장비를 갖춘 차량으로 댁에 찾아가 목욕을 돕는 서비스(방문목욕)",
  visit_nurse: "간호사 등이 댁으로 찾아가 간호·건강 관리를 하는 서비스(방문간호)",
};
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const num = (n) => (n == null ? "–" : Number(n).toLocaleString("ko-KR"));
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : null);
// 받침에 따라 조사 고르기 (요양원은 / 주야간보호는)
const jo = (w, a, b) => { const c = String(w).charCodeAt(String(w).length - 1) - 0xac00; return w + (c >= 0 && c <= 11171 && c % 28 ? a : b); };
const sum = (a, b) => (a == null && b == null ? null : (a || 0) + (b || 0));

async function all(path, max = 25000) {
  const out = [];
  for (let off = 0; off < max; off += 1000) {
    const d = await sb(`${path}&limit=1000&offset=${off}`);
    out.push(...d);
    if (d.length < 1000) break;
  }
  return out;
}
export async function regionNames() {
  const rows = await sb("sgg_names?select=sido_cd,sgg_cd,sido_nm,sgg_nm,n&order=sido_cd,sgg_nm");
  const sidos = new Map();
  for (const r of rows) {
    if (!sidos.has(r.sido_cd)) sidos.set(r.sido_cd, { cd: r.sido_cd, nm: r.sido_nm, sggs: [] });
    if (r.sgg_nm && r.sgg_nm !== r.sido_nm) sidos.get(r.sido_cd).sggs.push({ cd: r.sgg_cd, nm: r.sgg_nm, n: r.n });
  }
  return [...sidos.values()].sort((a, b) => a.cd.localeCompare(b.cd));
}
// 시·도(선택) 안의 시·군·구 × 기관 종류별 기관 수
export async function kindCounts(sido) {
  const lists = await Promise.all(Object.keys(AREA_KINDS).map((k) => all(`ltc_insts?select=sido_cd,sgg_cd&kind=eq.${k}${sido ? `&sido_cd=eq.${sido}` : ""}&order=sym.asc,pttn.asc`, 40000).then((rows) => [k, rows])));
  const m = new Map(); // "41-285" → {home: 3, ...}
  for (const [k, rows] of lists) for (const r of rows) {
    const key = `${r.sido_cd}-${r.sgg_cd}`;
    if (!m.has(key)) m.set(key, {});
    m.get(key)[k] = (m.get(key)[k] || 0) + 1;
  }
  return m;
}

const CSS = `:root{--bg:#f7f4ee;--card:#fff;--ink:#1f2a24;--sub:#5d6a62;--line:#e4ded2;--main:#2f6b4f;--main-soft:#e6f0ea;--warm:#c8762f;--warm-soft:#fbefe2}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font-family:"Pretendard","Apple SD Gothic Neo","Malgun Gothic","Noto Sans KR",sans-serif;line-height:1.6;word-break:keep-all}
a{color:var(--main)}.wrap{max-width:920px;margin:0 auto;padding:0 16px}
header{background:var(--main);color:#fff;padding:14px 0}header a{color:#fff;text-decoration:none;font-weight:700;font-size:1.1rem}
nav.crumb{font-size:.85rem;color:var(--sub);margin:16px 0 4px}nav.crumb a{color:var(--sub)}
h1{font-size:1.5rem;margin:4px 0 8px}h2{font-size:1.1rem;margin:0 0 10px}
.panel{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px;margin:14px 0}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}
.stat{background:var(--main-soft);border-radius:12px;padding:12px}.stat b{display:block;font-size:1.3rem}.stat span{font-size:.85rem;color:var(--sub)}
.muted{color:var(--sub);font-size:.86rem}.signal{background:var(--warm-soft);border-radius:12px;padding:12px 14px;margin-top:12px}
table{width:100%;border-collapse:collapse;font-size:.9rem}th,td{border-bottom:1px solid var(--line);padding:8px 6px;text-align:left;vertical-align:top}th{color:var(--sub);font-weight:600}td.n,th.n{text-align:right;white-space:nowrap}
.tbl{overflow-x:auto}.btns{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
.btn{display:inline-block;border:1px solid var(--main);border-radius:10px;padding:9px 14px;text-decoration:none;color:var(--main);font-weight:600}.btn.pri{background:var(--main);color:#fff}
.chips{display:flex;flex-wrap:wrap;gap:6px}.chips a{border:1px solid var(--line);background:#fff;border-radius:999px;padding:5px 11px;text-decoration:none;color:var(--ink);font-size:.88rem}.chips a.on{background:var(--main);border-color:var(--main);color:#fff}
.g{display:inline-block;min-width:22px;text-align:center;border-radius:6px;padding:0 5px;font-weight:700;font-size:.82rem;background:#eee}.gA{background:#d7eadf;color:#1f5a3c}.gB{background:#e6f0ea}.gD,.gE{background:#f6dcd6;color:#8a2d1f}
footer{color:var(--sub);font-size:.8rem;padding:24px 0 40px}`;

function page({ title, desc, canonical, crumbs, body }) {
  const ld = { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: crumbs.map((c, i) => ({ "@type": "ListItem", position: i + 1, name: c.nm, item: SITE + c.href })) };
  return `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="${esc(desc)}"><link rel="canonical" href="${SITE}${canonical}">
<meta property="og:type" content="website"><meta property="og:site_name" content="케어온길"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:url" content="${SITE}${canonical}"><meta property="og:image" content="${SITE}/og.png">
<link rel="icon" href="/favicon.png"><style>${CSS}</style><script type="application/ld+json">${JSON.stringify(ld)}</script>
<script defer src="/_vercel/insights/script.js"></script></head><body>
<header><div class="wrap"><a href="/">케어온길</a></div></header>
<main class="wrap"><nav class="crumb">${crumbs.map((c, i) => (i < crumbs.length - 1 ? `<a href="${c.href}">${esc(c.nm)}</a>` : esc(c.nm))).join(" › ")}</nav>${body}</main>
<footer><div class="wrap"><p>자료: 국민건강보험공단 장기요양기관 정보(공공데이터포털), 행정안전부 주민등록 인구. 정원·현원·대기는 기관이 공단에 신고한 값이라 실제와 다를 수 있으니 기관에 확인해 보시길 권해 드립니다. 케어온길은 기관을 소개·추천·알선하지 않습니다.</p>
<p><a href="/">케어온길 (보호자용)</a> · <a href="/biz">케어온길 비즈 (운영·창업)</a> · <a href="/area">지역별 현황</a> · <a href="/privacy">개인정보처리방침</a> · <a href="/terms">이용약관</a></p>
<p>주식회사 벤투런 · 대표 문창조 · 사업자등록번호 588-86-02083 · 031-818-6336</p></div></footer></body></html>`;
}

function send(res, code, html, cache = true) {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", cache ? "public, s-maxage=86400, stale-while-revalidate=604800" : "no-store");
  return res.status(code).send(html);
}
const notFound = (res, msg) => send(res, 404, page({ title: "찾을 수 없는 지역입니다 | 케어온길", desc: msg, canonical: "/area", crumbs: [{ nm: "지역별 현황", href: "/area" }], body: `<div class="panel"><h1>찾을 수 없는 페이지입니다</h1><p>${esc(msg)}</p><p><a class="btn pri" href="/area">지역별 현황 처음으로</a></p></div>` }), false);

export default async function handler(req, res) {
  if (!SB_URL || !SB_KEY) return send(res, 500, "설정 전", false);
  const q = req.query || {};
  const sido = /^\d{2}$/.test(q.sido || "") ? q.sido : null, sgg = /^\d{3}$/.test(q.sgg || "") ? q.sgg : null, kind = AREA_KINDS[q.kind] ? q.kind : null;
  try {
    const regions = await regionNames();

    // 1) 전국: 시·도 목록
    if (!sido) {
      const body = `<h1>지역별 장기요양기관 현황</h1><p>시·도를 고르시면 시·군·구별 요양원·주야간보호·방문요양 등 기관 수와 정원·빈자리·기관평가를 보실 수 있습니다.</p>
<div class="panel"><div class="chips">${regions.map((s) => `<a href="/area/${s.cd}">${esc(s.nm)}</a>`).join("")}</div></div>`;
      return send(res, 200, page({ title: "지역별 요양원·주야간보호·방문요양 현황 | 케어온길", desc: "전국 시·도·시·군·구별 장기요양기관(요양원·주야간보호·단기보호·방문요양·방문목욕·방문간호) 수와 정원·빈자리·기관평가 현황.", canonical: "/area", crumbs: [{ nm: "지역별 현황", href: "/area" }], body }));
    }
    const S = regions.find((s) => s.cd === sido);
    if (!S) return notFound(res, "시·도 코드를 찾지 못했습니다.");

    // 2) 시·도: 시·군·구 × 기관 종류 목록
    if (!sgg || !kind) {
      const cnt = await kindCounts(sido);
      const rows = S.sggs.map((g) => {
        const c = cnt.get(`${sido}-${g.cd}`) || {};
        return `<tr><th scope="row">${esc(g.nm)}</th>${Object.keys(AREA_KINDS).map((k) => `<td class="n">${c[k] ? `<a href="/area/${sido}/${g.cd}/${k}">${num(c[k])}</a>` : "–"}</td>`).join("")}</tr>`;
      }).join("");
      const body = `<h1>${esc(S.nm)} 장기요양기관 현황</h1><p>${esc(S.nm)}의 시·군·구별 기관 수입니다. 숫자를 누르시면 그 지역의 정원·빈자리·기관평가와 기관 목록을 보실 수 있습니다.</p>
<div class="panel tbl"><table><tr><th>시·군·구</th>${Object.values(AREA_KINDS).map((n) => `<th class="n">${n}</th>`).join("")}</tr>${rows}</table></div>`;
      return send(res, 200, page({ title: `${S.nm} 요양원·주야간보호·방문요양 기관 수 (시·군·구별) | 케어온길`, desc: `${S.nm} 시·군·구별 요양원·주야간보호·단기보호·방문요양·방문목욕·방문간호 기관 수와 지역별 현황.`, canonical: `/area/${sido}`, crumbs: [{ nm: "지역별 현황", href: "/area" }, { nm: S.nm, href: `/area/${sido}` }], body }));
    }

    // 3) 시·군·구 × 기관 종류
    const G = S.sggs.find((g) => g.cd === sgg);
    if (!G) return notFound(res, "시·군·구 코드를 찾지 못했습니다.");
    const K = AREA_KINDS[kind], stay = STAY.includes(kind);
    // 시설형은 시·도 평균 이용률과 비교하려고 시·도 전체를, 방문형은 그 시·군·구만 읽음 (DB 부담 줄이기)
    const [sidoRows, list, pops, cnt] = await Promise.all([
      all(`ltc_insts?select=sgg_cd,capacity,now_m,now_f,wait_m,wait_f,eval_grade,designated&sido_cd=eq.${sido}${stay ? "" : `&sgg_cd=eq.${sgg}`}&kind=eq.${kind}&order=sym.asc,pttn.asc`),
      sb(`ltc_insts?select=sym,pttn,name,addr,capacity,now_m,now_f,wait_m,wait_f,eval_grade,designated&sido_cd=eq.${sido}&sgg_cd=eq.${sgg}&kind=eq.${kind}&order=${stay ? "capacity.desc.nullslast," : ""}name.asc&limit=60`),
      sb(`pop_sgg?select=sgg_cd,ym,p65,p80_89,p90,total&sido_cd=eq.${sido}&order=ym.desc&limit=400`).catch(() => []),
      all(`ltc_insts?select=kind&sido_cd=eq.${sido}&sgg_cd=eq.${sgg}&kind=in.(${Object.keys(AREA_KINDS).join(",")})&order=sym.asc,pttn.asc`, 5000)
        .then((rs) => rs.reduce((m, r) => ((m[r.kind] = (m[r.kind] || 0) + 1), m), {})).catch(() => ({})),
    ]);
    const since = new Date(Date.now() - 3 * 365.25 * 864e5).toISOString().slice(0, 10);
    const agg = (rows) => {
      const o = { n: rows.length, cap: 0, now: 0, wait: 0, new3y: 0, g: { A: 0, B: 0, C: 0, D: 0, E: 0, 없음: 0 } };
      for (const r of rows) {
        const now = sum(r.now_m, r.now_f), wait = sum(r.wait_m, r.wait_f);
        if (r.capacity != null && now != null) { o.cap += r.capacity; o.now += now; }
        if (wait != null) o.wait += wait;
        if (r.designated && r.designated >= since) o.new3y++;
        o.g[/^[A-E]$/.test(r.eval_grade || "") ? r.eval_grade : "없음"]++;
      }
      o.occ = pct(o.now, o.cap); o.vac = o.cap ? Math.max(0, o.cap - o.now) : null;
      return o;
    };
    const local = agg(sidoRows.filter((r) => r.sgg_cd === sgg)), whole = agg(sidoRows);
    if (!local.n) return notFound(res, `${S.nm} ${G.nm}에는 공단에 등록된 ${jo(K, "이", "가")} 없습니다.`);
    const ym = pops[0]?.ym, p = pops.find((x) => x.ym === ym && x.sgg_cd === sgg);
    const p80 = p ? (p.p80_89 || 0) + (p.p90 || 0) : null;
    const region = `${S.nm} ${G.nm}`, short = G.nm.split(" ").slice(-1)[0];

    const stat = (v, l) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`;
    const stats = [stat(`${num(local.n)}곳`, `${K} 기관 수`)];
    if (stay) stats.push(stat(`${num(local.cap)}명`, "정원 합계"), stat(local.occ == null ? "–" : `${local.occ}%`, `이용률 (시·도 평균 ${whole.occ ?? "–"}%)`), stat(`${num(local.vac)}명`, "남는 자리(정원−현원)"), stat(`${num(local.wait)}명`, "대기 인원"));
    stats.push(stat(`${num(local.new3y)}곳`, "최근 3년 새로 지정"));
    if (p) stats.push(stat(`${num(p.p65)}명`, `65세 이상 인구 (${String(ym).replace(/^(\d{4})(\d{2})$/, "$1.$2")})`), stat(`${num(p80)}명`, "80세 이상 인구"));

    let sig = "";
    if (stay && local.occ != null && whole.occ != null) {
      const d = Math.round((local.occ - whole.occ) * 10) / 10;
      sig = d >= 3 ? `이용률이 ${S.nm} 평균보다 ${d}%p 높아, 빈자리를 찾기 비교적 어려운 지역입니다. 대기 신청을 함께 알아보시길 권해 드립니다.`
        : d <= -3 ? `이용률이 ${S.nm} 평균보다 ${-d}%p 낮아, 비교적 빈자리를 찾기 쉬운 편입니다.`
        : `이용률이 ${S.nm} 평균(${whole.occ}%)과 비슷한 지역입니다.`;
    }
    const gTot = Object.values(local.g).reduce((a, b) => a + b, 0);
    const grades = `<p class="muted" style="margin:10px 0 0">공단 기관평가(최근 결과): ${["A", "B", "C", "D", "E"].map((k) => `<span class="g g${k}">${k}</span> ${local.g[k]}곳`).join(" · ")} · 평가 없음 ${local.g.없음}곳 (총 ${gTot}곳)</p>`;

    const rows = list.map((r) => {
      const now = sum(r.now_m, r.now_f), wait = sum(r.wait_m, r.wait_f), id = `${r.sym}:${r.pttn}`;
      const addr = String(r.addr || "").replace(S.nm, "").replace(G.nm, "").trim().split(" ").slice(0, 3).join(" ");
      return `<tr><td><a href="/?sido=${sido}&sgg=${sgg}&kind=${kind}&inst=${encodeURIComponent(id)}">${esc(r.name)}</a><br><span class="muted">${esc(addr)}</span></td>${stay ? `<td class="n">${num(r.capacity)}</td><td class="n">${num(now)}</td><td class="n">${num(wait)}</td>` : ""}<td class="n">${/^[A-E]$/.test(r.eval_grade || "") ? `<span class="g g${r.eval_grade}">${r.eval_grade}</span>` : "–"}</td></tr>`;
    }).join("");
    const more = local.n > list.length ? `<p class="muted">${num(local.n)}곳 중 ${list.length}곳만 보여 드립니다. 전체 목록과 비교는 케어온길에서 보실 수 있습니다.</p>` : "";
    const otherKinds = Object.entries(AREA_KINDS).filter(([k]) => cnt[k]).map(([k, n]) => `<a href="/area/${sido}/${sgg}/${k}"${k === kind ? ' class="on"' : ""}>${n} ${num(cnt[k])}</a>`).join("");
    const near = S.sggs.filter((g) => g.cd !== sgg).slice(0, 40).map((g) => `<a href="/area/${sido}/${g.cd}/${kind}">${esc(g.nm)}</a>`).join("");

    const body = `<h1>${esc(region)} ${K} ${num(local.n)}곳</h1>
<p>${esc(region)}에 있는 ${K}의 현황입니다. ${jo(K, "은", "는")} ${KIND_DESC[kind]}입니다.${stay ? " 정원·현원·대기 인원과 공단 기관평가를 한눈에 보실 수 있습니다." : ""}</p>
<div class="panel"><h2>${esc(short)} ${K} 한눈에 보기</h2><div class="stats">${stats.join("")}</div>${grades}${sig ? `<div class="signal">${esc(sig)}</div>` : ""}
<div class="btns"><a class="btn pri" href="/?sido=${sido}&sgg=${sgg}&kind=${kind}">케어온길에서 ${esc(short)} ${K} 비교하기</a><a class="btn" href="/biz?sido=${sido}&sgg=${sgg}&kind=${kind}">창업·운영 참고 (무료 지역 요약)</a></div></div>
<div class="panel tbl"><h2>${esc(short)} ${K} 목록</h2><table><tr><th>기관</th>${stay ? '<th class="n">정원</th><th class="n">현원</th><th class="n">대기</th>' : ""}<th class="n">평가</th></tr>${rows}</table>${more}
<p class="muted">기관 이름을 누르시면 연락처·비용(비급여)·인력·평가 이력을 보실 수 있습니다.</p></div>
<div class="panel"><h2>${esc(short)}의 다른 장기요양 서비스</h2><div class="chips">${otherKinds}</div></div>
<div class="panel"><h2>${esc(S.nm)}의 다른 지역 ${K}</h2><div class="chips">${near}</div></div>
<div class="panel"><h2>${K} 이용 전에 알아 두실 점</h2><ul>
<li>장기요양 급여는 <b>장기요양등급</b>을 받은 어르신이 이용하실 수 있습니다. 등급 신청은 국민건강보험공단(1577-1000)에 하시면 됩니다.</li>
<li>본인부담금은 보통 급여비용의 ${kind === "home" || kind === "short" ? "20%" : "15%"}이며, 기초생활수급자는 면제, 감경 대상자는 줄어듭니다. 식재료비·상급침실료 같은 비급여는 따로 냅니다.</li>
<li>장기요양 본인부담금은 연말정산 의료비 세액공제 대상이 될 수 있습니다. <a href="/#guide">자세히 보기</a></li>
<li>정원·현원·대기는 기관이 공단에 신고한 값이라 실제와 다를 수 있습니다. 방문 전에 전화로 확인해 보세요.</li></ul></div>`;
    const title = `${region} ${K} ${num(local.n)}곳 — ${stay ? "정원·빈자리·" : ""}기관평가 | 케어온길`;
    const desc = `${region} ${K} ${num(local.n)}곳${stay ? `, 정원 ${num(local.cap)}명, 이용률 ${local.occ ?? "–"}%, 남는 자리 ${num(local.vac)}명` : ""}. 공단 기관평가와 기관 목록을 한눈에 비교하세요.`;
    return send(res, 200, page({ title, desc, canonical: `/area/${sido}/${sgg}/${kind}`, crumbs: [{ nm: "지역별 현황", href: "/area" }, { nm: S.nm, href: `/area/${sido}` }, { nm: `${G.nm} ${K}`, href: `/area/${sido}/${sgg}/${kind}` }], body }));
  } catch (e) {
    return send(res, 500, page({ title: "잠시 후 다시 시도해 주세요 | 케어온길", desc: "", canonical: "/area", crumbs: [{ nm: "지역별 현황", href: "/area" }], body: `<div class="panel"><h1>잠시 후 다시 시도해 주세요</h1><p class="muted">${esc(String(e.message).slice(0, 120))}</p></div>` }), false);
  }
}
