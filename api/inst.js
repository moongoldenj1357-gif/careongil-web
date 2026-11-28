// 케어온길 기관별 페이지 (검색엔진용, 서버에서 HTML을 바로 만들어 보냄)
//  /inst/14112000123-A01 → /api/inst?id=14112000123-A01   (vercel.json rewrites)
//  기관 이름으로 검색하는 보호자가 바로 찾을 수 있게: 정원·현원·대기·평가 이력·비급여·인력·시설·프로그램·같은 지역 기관
//  자료: ltc_insts, ltc_evals(공단 평가), sgg_names. 좌표·개인정보는 다루지 않음. CDN 하루 캐시.
import { sb } from "../lib/db.js";
import { AREA_KINDS, esc, num, jo, page, send } from "./area.js";

export const config = { maxDuration: 20 };
const STAY = ["home", "daycare", "short"];
const SUB = { A04: "공동생활가정", S41: "치매전담형 공동생활가정", A05: "단기보호 전환" };
const COLS = "sym,pttn,name,kind,sido_cd,sgg_cd,addr,addr_detail,tel,homepage,capacity,now_m,now_f,wait_m,wait_f,designated,eval_grade,eval_year,parking,transport,list_seen,staff,rooms,nonpay,programs,detail_at,extra_at";
const sum = (a, b) => (a == null && b == null ? null : (a || 0) + (b || 0));
const won = (n) => (n == null || n === "" ? "–" : `${Number(n).toLocaleString("ko-KR")}원`);
const site = (u) => { const h = String(u || "").replace(/^https?:\/\//i, "").trim(); return /\.[a-z가-힣]{2,}/i.test(h) ? (/^https?:/i.test(u) ? u : "http://" + h) : null; };
const gBadge = (g) => (/^[A-E]$/.test(g || "") ? `<span class="g g${g}">${g}</span>` : "–");
const median = (a) => { const v = a.filter((x) => x != null && isFinite(x)).sort((x, y) => x - y); if (!v.length) return null; const m = (v.length - 1) / 2; return (v[Math.floor(m)] + v[Math.ceil(m)]) / 2; };
// 2026년 장기요양 수가 (index.html 계산기와 같은 값 — 해마다 1월에 함께 바꿈)
const FEE = { home: { 1: 93070, 2: 86340, 3: 81540 }, group: { 1: 74590, 2: 69210, 3: 63800 },
  short: { 1: 74060, 2: 68580, 3: 63350, 4: 61680, 5: 60000 }, day: { 1: 69730, 2: 64590, 3: 59640, 4: 58010, 5: 56360, c: 56360 } };
const LIMIT = { 1: 2512900, 2: 2331200, 3: 1528200, 4: 1409700, 5: 1208900, c: 676320 };
const r10 = (x) => Math.round(x / 10) * 10;
// 신고된 식재료비(1식) × 하루 끼니 수(산출근거에서, 없으면 기본값)
function foodPerDay(r, defMeals) {
  const meals = (f) => { const m = String(f.근거 || "").replace(/\s/g, "").match(/[xX×*](\d)식/); const n = m ? +m[1] : defMeals; return n >= 1 && n <= 5 ? n : defMeals; };
  const c = (Array.isArray(r.nonpay) ? r.nonpay : []).filter((x) => x.종류 === "식재료비" && +x.금액 > 0 && +x.금액 <= 30000);
  if (!c.length) return null;
  const f = c.find((x) => meals(x) === defMeals) || c[0];
  return +f.금액 * meals(f);
}
function costPanel(r, subNm) {
  const home = r.kind === "home", day = r.kind === "daycare";
  const fd = foodPerDay(r, day ? 1 : 3), days = home ? 30 : day ? 20 : 10;
  const grades = home ? [["1", "1등급"], ["2", "2등급"], ["3", "3~5등급"]] : [["1", "1등급"], ["2", "2등급"], ["3", "3등급"], ["4", "4등급"], ["5", "5등급"], ...(day ? [["c", "인지지원등급"]] : [])];
  const fac = home && /공동생활가정/.test(subNm || "") ? "group" : "home";
  const rows = grades.map(([g, nm]) => {
    const fee = home ? FEE[fac][g] : day ? FEE.day[g] : FEE.short[g];
    const total = fee * days, inLim = home ? total : Math.min(total, LIMIT[g]);
    const mine = inLim * (home ? 0.2 : 0.15) + (total - inLim), food = fd ? fd * days : 0;
    return `<tr><td>${nm}</td><td class="n">${won(r10(mine))}</td><td class="n">${fd ? won(r10(food)) : "–"}</td><td class="n"><b>${won(r10(mine + food))}</b></td></tr>`;
  }).join("");
  const basis = home ? "30일 입소" : day ? "하루 8~10시간 × 한 달 20일" : "10일 이용";
  return `<div class="panel"><h2>이 기관 ${home ? "한 달" : day ? "한 달" : "10일"} 예상 비용</h2>
    <p class="muted" style="margin:0 0 8px">${basis} · 일반 본인부담(${home ? "20%" : "15%"}) 기준 · ${fd ? `식비는 이 기관이 신고한 하루 ${won(fd)}` : "이 기관은 식재료비 신고가 없어 식비 제외"}</p>
    <div class="tbl"><table><tr><th>등급</th><th class="n">급여 본인부담</th><th class="n">${day ? "식사비" : "식재료비"}</th><th class="n">합계</th></tr>${rows}</table></div>
    <p class="muted">2026년 장기요양 수가로 계산한 어림값입니다. 감경 대상(본인부담 40·60% 감경, 기초생활수급자)은 더 적게 내시며, 가산·감산과 이미용비·간식비·상급침실료 같은 기타 비용은 빠져 있습니다.${home ? " 3~5등급은 공단이 시설급여를 인정한 경우에만 입소하실 수 있습니다." : ""} 등급·감경을 바꿔 보시려면 <a href="${`/?sido=${r.sido_cd}&sgg=${r.sgg_cd}&kind=${r.kind}&inst=${encodeURIComponent(`${r.sym}:${r.pttn}`)}`}">케어온길에서 이 기관 열기</a>를 눌러 주세요.</p></div>`;
}
const STAFF_GROUPS = [["직접 돌봄", ["요양보호사", "요양보호사유예"]], ["간호", ["간호사", "간호조무사"]], ["재활", ["물리치료사", "작업치료사"]],
  ["상담·관리", ["시설장", "사회복지사", "사무국장", "사무원"]], ["식사·위생", ["영양사", "조리원", "위생원"]], ["그 밖에", ["의사", "관리인", "보조원", "기타"]]];

const gone = (res) => send(res, 404, page({ title: "찾을 수 없는 기관입니다 | 케어온길", desc: "기관 정보를 찾지 못했습니다.", canonical: "/area", robots: "noindex",
  crumbs: [{ nm: "케어온길", href: "/" }, { nm: "기관 정보", href: "/area" }],
  body: `<div class="panel"><h1>기관을 찾지 못했습니다</h1><p>주소가 잘못되었거나 공단 목록에서 빠진 기관일 수 있습니다.</p><div class="btns"><a class="btn pri" href="/">케어온길에서 기관 찾기</a><a class="btn" href="/area">지역별 현황</a></div></div>` }), false);

export default async function handler(req, res) {
  const m = String(req.query?.id || "").toUpperCase().match(/^(\d{5,15})-([A-Z]\d{2})$/);
  if (!m) return gone(res);
  try {
    const [r] = await sb(`ltc_insts?select=${COLS}&sym=eq.${m[1]}&pttn=eq.${m[2]}&limit=1`);
    if (!r || !AREA_KINDS[r.kind]) return gone(res);
    const KN = AREA_KINDS[r.kind], subNm = SUB[r.pttn] || null, stay = STAY.includes(r.kind);
    const [[reg], evals, peers, units] = await Promise.all([
      sb(`sgg_names?select=sido_nm,sgg_nm&sido_cd=eq.${r.sido_cd}&sgg_cd=eq.${r.sgg_cd}&limit=1`).catch(() => [{}]),
      sb(`ltc_evals?select=round,etype,eval_date,grade,score&sym=eq.${r.sym}&kind=eq.${r.kind}&order=eval_date.desc&limit=8`).catch(() => []),
      sb(`ltc_insts?select=sym,pttn,name,capacity,now_m,now_f,wait_m,wait_f,eval_grade,cw:staff->${encodeURIComponent("요양보호사")}&sido_cd=eq.${r.sido_cd}&sgg_cd=eq.${r.sgg_cd}&kind=eq.${r.kind}&order=${stay ? "capacity.desc.nullslast," : ""}name.asc&limit=300`).catch(() => []),
      r.kind === "home" || r.kind === "daycare" ? sb(`ltc_insts?select=pttn&kind=eq.unit&sym=eq.${r.sym}`).catch(() => []) : [],
    ]);
    const sidoNm = reg?.sido_nm || "", sggNm = reg?.sgg_nm && reg.sgg_nm !== sidoNm ? reg.sgg_nm : "";
    const place = [sidoNm, sggNm].filter(Boolean).join(" ");
    const now = sum(r.now_m, r.now_f), wait = sum(r.wait_m, r.wait_f);
    const vac = r.capacity != null && now != null ? Math.max(0, r.capacity - now) : null;
    const occ = r.capacity && now != null ? Math.round((now / r.capacity) * 1000) / 10 : null;
    const st = r.staff || null, cw = st?.요양보호사 || 0, base = now > 0 ? now : r.capacity;
    const cwPer = cw > 0 && base > 0 ? Math.round((base / cw) * 10) / 10 : null;
    const dem = units.filter((u) => (r.kind === "home" ? /^[GM]/ : /^[HI]/).test(u.pttn)).length;
    const who = r.kind === "daycare" ? "이용자" : "어르신";
    // 같은 시·군·구 같은 종류 (자기 제외)
    const others = peers.filter((x) => !(x.sym === r.sym && x.pttn === r.pttn));
    const pOcc = (() => { let c = 0, n = 0; for (const x of peers) { const k = sum(x.now_m, x.now_f); if (x.capacity && k != null) { c += x.capacity; n += k; } } return c ? Math.round((n / c) * 1000) / 10 : null; })();
    const pCw = median(peers.map((x) => { const k = sum(x.now_m, x.now_f), b = k > 0 ? k : x.capacity, c = Number(x.cw) || 0; return c > 0 && b > 0 ? b / c : null; }));
    const stale = r.list_seen && (Date.now() - new Date(r.list_seen).getTime()) / 864e5 > 21;
    const grade = /^[A-E]$/.test(r.eval_grade || "") ? r.eval_grade : null;

    const title = `${r.name} - ${sggNm || sidoNm} ${subNm || KN} | ${stay ? "정원·빈자리·" : ""}기관평가·비용 | 케어온길`;
    const desc = `${place} ${subNm || KN} ${r.name}${stay && r.capacity != null ? `: 정원 ${num(r.capacity)}명, 현원 ${num(now)}명${wait ? `, 대기 ${num(wait)}명` : ""}` : ""}${grade ? `, 공단 기관평가 ${grade}등급${r.eval_year ? `(${r.eval_year})` : ""}` : ""}. 비급여 비용·돌봄 인력·프로그램을 국민건강보험공단 공개 자료로 정리했습니다.`;
    const canonical = `/inst/${r.sym}-${r.pttn}`;
    const compare = `/?sido=${r.sido_cd}&sgg=${r.sgg_cd}&kind=${r.kind}&inst=${encodeURIComponent(`${r.sym}:${r.pttn}`)}`;
    const ld2 = { "@context": "https://schema.org", "@type": "LocalBusiness", name: r.name, description: `${place} ${subNm || KN}`,
      address: { "@type": "PostalAddress", streetAddress: r.addr || "", addressRegion: sidoNm, addressLocality: sggNm, addressCountry: "KR" },
      ...(r.tel ? { telephone: r.tel } : {}), ...(site(r.homepage) ? { sameAs: site(r.homepage) } : {}), url: `https://www.careongil.kr${canonical}` };

    let h = `<div class="panel"><p style="margin:0 0 6px"><span class="badge">${esc(KN)}</span>${subNm ? `<span class="badge">${esc(subNm)}</span>` : ""}${dem ? `<span class="badge">치매전담실 ${dem}곳</span>` : ""}${grade ? `<span class="badge">기관평가 ${grade}${r.eval_year ? ` (${r.eval_year})` : ""}</span>` : ""}</p>
      <h1>${esc(r.name)}</h1><p class="muted" style="margin:0">${esc(r.addr || place)}${r.addr_detail ? ` ${esc(r.addr_detail)}` : ""}</p>
      ${stale ? `<p class="signal" style="margin-top:10px">최근 공단 기관 목록에서 확인되지 않은 기관입니다. 운영 여부를 기관이나 공단에 꼭 확인해 주세요.</p>` : ""}
      <div class="btns">${r.tel ? `<a class="btn pri" href="tel:${esc(r.tel.replace(/[^\d-]/g, ""))}">📞 ${esc(r.tel)}</a>` : ""}<a class="btn" href="${esc(compare)}">케어온길에서 비교하기</a>${r.addr ? `<a class="btn" href="https://map.kakao.com/link/search/${encodeURIComponent(r.addr)}" target="_blank" rel="noopener">지도 보기</a>` : ""}${site(r.homepage) ? `<a class="btn" href="${esc(site(r.homepage))}" target="_blank" rel="noopener nofollow">홈페이지</a>` : ""}</div></div>`;

    // 한눈에
    const stats = stay ? [
      ["정원", r.capacity != null ? `${num(r.capacity)}명` : "–"], ["현원", now != null ? `${num(now)}명` : "–"],
      ["남는 자리(추정)", vac != null ? `${num(vac)}석` : "–"], ["대기", wait != null ? `${num(wait)}명` : "–"],
      ["이용률", occ != null ? `${occ}%` : "–", pOcc != null ? `${esc(sggNm || sidoNm)} ${esc(KN)} 평균 ${pOcc}%` : ""],
      ["요양보호사 1명당 " + who, cwPer != null ? `${cwPer.toFixed(1)}명` : "–", pCw != null ? `지역 중간값 ${pCw.toFixed(1)}명` : ""],
    ] : [["요양보호사", cw ? `${num(cw)}명` : "–"], ["기관평가", grade || "평가 전·없음"], ["지정일", r.designated || "–"]];
    h += `<div class="panel"><h2>한눈에 보기</h2><div class="stats">${stats.map(([k, v, s]) => `<div class="stat"><b>${v}</b><span>${esc(k)}${s ? `<br>${s}` : ""}</span></div>`).join("")}</div>
      ${stay ? `<p class="muted" style="margin:10px 0 0">정원·현원·대기는 기관이 공단에 신고한 값이라 실제와 다를 수 있습니다. ${wait ? "대기가 있는 기관은 대기 신청 방법과 예상 기간을 꼭 여쭤보세요." : "자리 여부는 기관에 전화로 확인해 주세요."}</p>` : ""}</div>`;

    // 기본 정보
    const info = [["주소", esc([r.addr, r.addr_detail].filter(Boolean).join(" ")) || "–"], ["전화", r.tel ? esc(r.tel) : "–"], ["장기요양기관 지정일", esc(r.designated || "–")],
      r.parking ? ["주차", esc(r.parking)] : null, r.transport ? ["교통", esc(r.transport)] : null, dem ? ["치매전담실", `${dem}곳`] : null].filter(Boolean);
    h += `<div class="panel"><h2>기본 정보</h2><table class="kv">${info.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join("")}</table></div>`;

    // 평가 이력
    h += `<div class="panel"><h2>국민건강보험공단 기관평가</h2>${evals.length ? `<div class="tbl"><table><tr><th>평가일</th><th>구분</th><th>등급</th></tr>${evals.map((e) => `<tr><td>${esc(String(e.eval_date || "").slice(0, 10))}</td><td>${esc(e.etype || e.round || "")}</td><td>${gBadge(e.grade)}</td></tr>`).join("")}</table></div>`
      : `<p>${grade ? `최근 평가 ${gBadge(grade)}${r.eval_year ? ` (${r.eval_year})` : ""}` : "아직 평가 결과가 없습니다. 새로 문을 연 기관은 첫 정기평가 전까지 등급이 없습니다."}</p>`}
      <p class="muted">공단이 서비스 종류별로 약 3년마다 하는 평가로 A(최우수)~E(미흡)로 나뉩니다. 어르신의 장기요양등급(1~5등급)과는 다릅니다.</p></div>`;

    // 한 달 예상 비용 + 비급여
    if (stay) {
      h += costPanel(r, subNm);
      const seen = new Set(), np = (Array.isArray(r.nonpay) ? r.nonpay : []).filter((x) => { const k = [x.종류, x.금액, x.근거].join("|"); if (seen.has(k)) return false; seen.add(k); return true; });
      h += `<div class="panel"><h2>본인이 따로 내는 비용 (비급여)</h2>${np.length ? `<table class="kv">${np.map((x) => `<tr><th>${esc(x.종류)}</th><td><b>${won(x.금액)}</b>${x.근거 ? ` <span class="muted">(${esc(String(x.근거).replace(/^\((.*)\)$/, "$1"))})</span>` : ""}</td></tr>`).join("")}</table>
        <p class="muted">기관이 공단에 신고한 금액입니다. 식재료비는 보통 1식(한 끼) 금액이고, 여러 줄이면 일반식·경관식(콧줄)·간식처럼 어르신에 따라 다른 금액인 경우가 많습니다(예상 비용은 하루 3끼 기준). 상급침실사용료는 하루 금액입니다. 장기요양 급여의 본인부담(${r.kind === "home" ? "요양원 20%" : "재가 15%"}, 감경 대상은 더 적음)은 이와 별도입니다.</p>`
        : `<p class="muted">${r.extra_at ? "신고된 비급여 항목이 없습니다." : "비용 정보는 수집 중입니다."}</p>`}</div>`;
    }

    // 인력
    if (st && Object.values(st).some((v) => v)) {
      const rows = STAFF_GROUPS.map(([g, ks]) => [g, ks.filter((k) => st[k]).map((k) => `${esc(k === "요양보호사유예" ? "요양보호사(자격 유예)" : k)} <b>${st[k]}</b>`)]).filter(([, a]) => a.length);
      h += `<div class="panel"><h2>돌봄 인력</h2>${cwPer != null && stay ? `<p>요양보호사 1명당 ${who} <b>${cwPer.toFixed(1)}명</b>${pCw != null ? ` (같은 지역 ${esc(KN)} 중간값 ${pCw.toFixed(1)}명)` : ""}. 숫자가 작을수록 한 사람이 맡는 ${who}이 적습니다.</p>` : ""}
        <table class="kv">${rows.map(([g, a]) => `<tr><th>${g}</th><td>${a.join(" · ")}</td></tr>`).join("")}</table>
        <p class="muted">공단에 신고된 직원 수입니다. 요양보호사는 교대로 일하므로 한 시간대에 함께 있는 인원은 이보다 적습니다.</p></div>`;
    }

    // 방·프로그램
    const rm = r.rooms && Object.entries(r.rooms).filter(([, v]) => v);
    const pg = Array.isArray(r.programs) ? r.programs : [];
    if ((rm && rm.length) || pg.length) {
      h += `<div class="panel">${rm && rm.length ? `<h2>방과 시설</h2><p>${rm.map(([k, v]) => `${esc(k)} <b>${v}</b>`).join(" · ")}</p>` : ""}
        ${pg.length ? `<h2 style="margin-top:14px">프로그램 (${pg.length}개)</h2><ul class="ck">${pg.slice(0, 12).map((x) => `<li><b>${esc(x.이름 || "")}</b> <span class="muted">${esc([x.종류, x.주기].filter(Boolean).join(" · "))}</span></li>`).join("")}</ul>${pg.length > 12 ? `<p class="muted">외 ${pg.length - 12}개</p>` : ""}` : ""}</div>`;
    }

    // 전화로 확인할 것
    const ask = stay ? ["지금 빈자리와 대기 인원, 예상 대기 기간", "치매·와상·콧줄·욕창 등 돌봄이 가능한지", "한 달 본인부담금과 식재료비 등 비급여 합계", ...(r.kind === "daycare" ? ["송영(차량)이 되는 지역과 운영·귀가 시간"] : []), "방문 상담·견학이 가능한 시간"]
      : ["서비스 가능 지역과 시간대", "요양보호사 배정·교체 방법", "한 달 본인부담금 예상액", "처음 시작까지 걸리는 기간"];
    h += `<div class="panel"><h2>전화하실 때 확인할 것</h2><ul class="ck">${ask.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
      <p class="muted">어르신의 장기요양등급(인정서), 거동·치매·식사 상태를 간단히 말씀하시면 상담이 빠릅니다. 아직 등급이 없으시면 <a href="/grade">장기요양등급 신청 방법</a>부터 보세요.</p></div>`;

    // 같은 지역 기관
    if (others.length) {
      h += `<div class="panel"><h2>${esc(sggNm || sidoNm)}의 다른 ${esc(KN)} (${num(others.length)}곳)</h2><div class="tbl"><table><tr><th>기관</th>${stay ? `<th class="n">정원</th><th class="n">대기</th>` : ""}<th class="n">평가</th></tr>
        ${others.slice(0, 15).map((x) => `<tr><td><a href="/inst/${x.sym}-${x.pttn}">${esc(x.name)}</a></td>${stay ? `<td class="n">${num(x.capacity)}</td><td class="n">${num(sum(x.wait_m, x.wait_f))}</td>` : ""}<td class="n">${gBadge(x.eval_grade)}</td></tr>`).join("")}</table></div>
        <div class="btns"><a class="btn" href="/area/${r.sido_cd}/${r.sgg_cd}/${r.kind}">${esc(sggNm || sidoNm)} ${esc(KN)} 현황 전체</a><a class="btn pri" href="${esc(compare)}">가까운 순·비교하기</a></div></div>`;
    }
    h += `<p class="muted">이 페이지는 국민건강보험공단 장기요양기관 공개 자료를 정리한 것입니다. 케어온길은 기관을 소개·추천·알선하지 않으며, 기관의 의뢰로 만든 페이지가 아닙니다. 정보가 다르면 <a href="mailto:moongoldenj@naver.com">moongoldenj@naver.com</a>으로 알려 주세요.</p>`;

    const crumbs = [{ nm: "케어온길", href: "/" }, { nm: "지역별 현황", href: "/area" }, { nm: sidoNm || "시·도", href: `/area/${r.sido_cd}` },
      ...(sggNm ? [{ nm: `${sggNm} ${KN}`, href: `/area/${r.sido_cd}/${r.sgg_cd}/${r.kind}` }] : []), { nm: r.name, href: canonical }];
    return send(res, 200, page({ title, desc, canonical, crumbs, body: h, ld2, robots: stale ? "noindex" : null }));
  } catch (e) {
    return send(res, 500, page({ title: "잠시 후 다시 시도해 주세요 | 케어온길", desc: "", canonical: "/area", robots: "noindex", crumbs: [{ nm: "케어온길", href: "/" }], body: `<div class="panel"><h1>잠시 후 다시 시도해 주세요</h1><p class="muted">${esc(e.message).slice(0, 120)}</p></div>` }), false);
  }
}
