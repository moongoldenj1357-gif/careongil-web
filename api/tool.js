// 복지용구 안내 + 복지용구 사업소 찾기 (검색엔진용, 서버에서 HTML을 바로 만듦)
//  /tool                → 복지용구 제도 안내 + 시·도 목록
//  /tool/41             → 시·도의 시·군·구별 사업소 수
//  /tool/41/285         → 시·군·구의 복지용구 사업소 목록(이름·주소·전화)
//  자료: ltc_insts(kind=tool, 공단 장기요양기관 중 복지용구 사업소), sgg_names. CDN 하루 캐시.
//  급여 품목·한도: 「복지용구 급여범위 및 급여기준 등에 관한 고시」(보건복지부고시 제2026-13호), 「복지용구 품목별 제품목록 및 급여비용 등에 관한 고시」(제2026-14호)
import { sb } from "../lib/db.js";
import { esc, num, page, send, regionNames } from "./area.js";

export const config = { maxDuration: 30 };
async function all(path, max = 20000) {
  const out = [];
  for (let off = 0; off < max; off += 1000) { const d = await sb(`${path}&limit=1000&offset=${off}`); out.push(...d); if (d.length < 1000) break; }
  return out;
}
// 시·도(선택) 안의 시·군·구별 복지용구 사업소 수  "41-285" → n
export async function toolCounts(sido) {
  const rows = await all(`ltc_insts?select=sido_cd,sgg_cd&kind=eq.tool${sido ? `&sido_cd=eq.${sido}` : ""}&order=sym.asc,pttn.asc`);
  const m = new Map(); for (const r of rows) { const k = `${r.sido_cd}-${r.sgg_cd}`; m.set(k, (m.get(k) || 0) + 1); }
  return m;
}

const GUIDE = `<div class="panel"><h1>복지용구, 인터넷에서 사기 전에 확인하세요</h1>
<p>장기요양등급(1~5등급, 인지지원등급)을 받으신 어르신은 <b>전동침대, 휠체어, 욕창예방매트리스, 성인용보행기, 안전손잡이</b> 같은 용구를 장기요양보험으로 <b>구입하거나 빌리실 수 있습니다.</b> 본인은 가격의 일부만 내시면 됩니다.</p>
<div class="stats"><div class="stat"><b>연 160만 원</b><span>1년 동안 쓸 수 있는 한도<br>(등급과 관계없이 같음, 공단+본인 부담 합계)</span></div>
<div class="stat"><b>15%</b><span>일반 본인부담<br>(감경 대상 9%·6%, 기초생활수급자 면제)</span></div>
<div class="stat"><b>따로 계산</b><span>방문요양·주야간보호 등<br>재가 월 한도와는 별도</span></div></div>
<p class="signal">같은 물건이라도 인터넷 쇼핑몰에서 사면 제값을 다 내셔야 합니다. 등급이 있으시면 <b>장기요양기관으로 지정된 복지용구 사업소</b>에서 장기요양인정서를 보여 주고 구입·대여하세요.</p></div>

<div class="panel"><h2>어떤 용구가 되나요?</h2>
<table class="kv"><tr><th>구입 품목</th><td>이동변기, 목욕의자, 성인용보행기, 안전손잡이, 미끄럼방지용품, 간이변기, 지팡이, 욕창예방방석, 자세변환용구, 요실금 팬티, 구강세척기, 기저귀센서, 배회감지기(태그형) 등</td></tr>
<tr><th>대여 품목</th><td>수동휠체어, 전동침대, 수동침대, 이동욕조, 목욕리프트, 배회감지기</td></tr>
<tr><th>구입 또는 대여</th><td>욕창예방매트리스, 경사로 등</td></tr></table>
<p class="muted">품목마다 정해진 제품(바코드 등록 제품)만 되고, 사용 가능 햇수와 수량이 정해져 있습니다(예: 수동휠체어 대여 5년, 전동침대 대여 10년). 어르신의 신체 상태에 맞는 품목만 이용하실 수 있으니 사업소나 공단에 먼저 확인해 주세요. 2026년 보건복지부 고시 기준입니다.</p></div>

<div class="panel"><h2>이용 방법</h2><ul class="ck">
<li>장기요양인정서와 복지용구 급여확인서를 확인합니다. 등급을 받을 때 함께 받으신 서류에 이용 가능한 품목이 적혀 있습니다.</li>
<li>가까운 <b>복지용구 사업소</b>(아래에서 찾기)에 연락해 필요한 용구를 고르고, 구입 또는 대여 계약을 합니다.</li>
<li>본인부담금(일반 15%)만 사업소에 내시면 나머지는 공단이 사업소에 냅니다.</li>
<li>남은 한도와 이용 내역은 노인장기요양보험 누리집(www.longtermcare.or.kr)이나 공단(1577-1000)에서 확인하실 수 있습니다.</li></ul>
<p class="muted">복지용구는 집에서 지내시는 분을 위한 재가급여라서, 요양원 등 시설에 입소해 계신 동안에는 이용하실 수 없습니다. 장기요양등급이 아직 없으시면 <a href="/grade">등급 신청 방법</a>부터 보세요.</p></div>`;

export default async function handler(req, res) {
  const q = req.query || {};
  const sido = /^\d{2}$/.test(q.sido || "") ? q.sido : null, sgg = /^\d{3}$/.test(q.sgg || "") ? q.sgg : null;
  try {
    const regs = await regionNames();
    const S = sido ? regs.find((x) => x.cd === sido) : null;
    if (sido && !S) return send(res, 404, page({ title: "찾을 수 없는 지역입니다 | 케어온길", desc: "", canonical: "/tool", robots: "noindex", crumbs: [{ nm: "케어온길", href: "/" }, { nm: "복지용구", href: "/tool" }], body: `<div class="panel"><h1>찾을 수 없는 지역입니다</h1><p><a class="btn pri" href="/tool">복지용구 안내로</a></p></div>` }), false);

    // 1) 안내 + 시·도
    if (!sido) {
      const cnt = await toolCounts(null), bySido = new Map();
      for (const [k, n] of cnt) { const s = k.split("-")[0]; bySido.set(s, (bySido.get(s) || 0) + n); }
      const body = GUIDE + `<div class="panel"><h2>우리 지역 복지용구 사업소 찾기</h2><div class="chips">${regs.filter((r) => bySido.get(r.cd)).map((r) => `<a href="/tool/${r.cd}">${esc(r.nm)} <span class="muted">${num(bySido.get(r.cd))}</span></a>`).join("")}</div></div>`;
      return send(res, 200, page({ title: "복지용구 구입·대여 방법과 사업소 찾기 (2026) — 전동침대·휠체어·보행기 15%만 | 케어온길",
        desc: "장기요양등급이 있으면 전동침대·휠체어·욕창예방매트리스·보행기 등을 연 160만 원 한도에서 본인부담 15%로 구입·대여할 수 있습니다. 품목, 이용 방법, 지역별 복지용구 사업소를 정리했습니다.",
        canonical: "/tool", crumbs: [{ nm: "케어온길", href: "/" }, { nm: "복지용구", href: "/tool" }], body }));
    }
    // 2) 시·도 → 시·군·구
    if (!sgg) {
      const cnt = await toolCounts(sido);
      const list = S.sggs.filter((g) => cnt.get(`${sido}-${g.cd}`));
      const body = `<div class="panel"><h1>${esc(S.nm)} 복지용구 사업소</h1><p>시·군·구를 고르시면 장기요양 복지용구 사업소의 이름·주소·전화번호를 보실 수 있습니다.</p>
        <div class="chips">${list.map((g) => `<a href="/tool/${sido}/${g.cd}">${esc(g.nm)} <span class="muted">${num(cnt.get(`${sido}-${g.cd}`))}</span></a>`).join("") || `<p class="muted">등록된 사업소가 없습니다.</p>`}</div>
        <div class="btns"><a class="btn" href="/tool">복지용구 이용 방법 보기</a></div></div>`;
      return send(res, 200, page({ title: `${S.nm} 복지용구 사업소 — 시·군·구별 목록 | 케어온길`, desc: `${S.nm} 장기요양 복지용구 사업소를 시·군·구별로 찾아보세요. 전동침대·휠체어·보행기 등을 등급이 있으면 15%로 구입·대여할 수 있습니다.`,
        canonical: `/tool/${sido}`, crumbs: [{ nm: "케어온길", href: "/" }, { nm: "복지용구", href: "/tool" }, { nm: S.nm, href: `/tool/${sido}` }], body }));
    }
    // 3) 시·군·구 사업소 목록
    const G = S.sggs.find((g) => g.cd === sgg);
    const rows = await sb(`ltc_insts?select=sym,pttn,name,addr,addr_detail,tel,designated,homepage&kind=eq.tool&sido_cd=eq.${sido}&sgg_cd=eq.${sgg}&order=name.asc&limit=300`);
    if (!G || !rows.length) return send(res, 404, page({ title: "등록된 복지용구 사업소가 없습니다 | 케어온길", desc: "", canonical: `/tool/${sido}`, robots: "noindex", crumbs: [{ nm: "케어온길", href: "/" }, { nm: "복지용구", href: "/tool" }, { nm: S.nm, href: `/tool/${sido}` }], body: `<div class="panel"><h1>등록된 복지용구 사업소가 없습니다</h1><p>이웃 지역의 사업소도 이용하실 수 있습니다.</p><p><a class="btn pri" href="/tool/${sido}">${esc(S.nm)} 전체 보기</a></p></div>` }), false);
    const place = `${S.nm} ${G.nm}`;
    const body = `<div class="panel"><h1>${esc(place)} 복지용구 사업소 ${num(rows.length)}곳</h1>
      <p>장기요양등급이 있으시면 아래 사업소에서 장기요양인정서를 보여 주고 전동침대·휠체어·욕창예방매트리스·보행기 등을 <b>연 160만 원 한도, 본인부담 15%</b>(감경 9%·6%, 기초생활수급자 면제)로 구입·대여하실 수 있습니다.</p>
      <div class="tbl"><table><tr><th>사업소</th><th>전화</th></tr>${rows.map((r) => `<tr><td><b>${esc(r.name)}</b><br><span class="muted">${esc([r.addr, r.addr_detail].filter(Boolean).join(" ") || "주소 수집 중")}</span></td><td class="n">${r.tel ? `<a href="tel:${esc(r.tel.replace(/[^\d-]/g, ""))}">${esc(r.tel)}</a>` : "–"}</td></tr>`).join("")}</table></div>
      <p class="muted">국민건강보험공단에 장기요양기관(복지용구)으로 등록된 사업소입니다. 취급 품목과 재고, 방문 상담 가능 여부는 사업소마다 다르니 전화로 확인해 주세요. 케어온길은 사업소를 소개·추천하지 않으며 수수료를 받지 않습니다.</p>
      <div class="btns"><a class="btn pri" href="/tool">복지용구 이용 방법</a><a class="btn" href="/tool/${sido}">${esc(S.nm)} 다른 지역</a><a class="btn" href="/area/${sido}">${esc(S.nm)} 요양기관 현황</a></div></div>`;
    return send(res, 200, page({ title: `${place} 복지용구 사업소 ${rows.length}곳 — 전동침대·휠체어 대여 | 케어온길`,
      desc: `${place} 장기요양 복지용구 사업소 ${rows.length}곳의 주소·전화번호. 등급이 있으면 전동침대·휠체어·보행기 등을 15%로 구입·대여할 수 있습니다.`,
      canonical: `/tool/${sido}/${sgg}`, crumbs: [{ nm: "케어온길", href: "/" }, { nm: "복지용구", href: "/tool" }, { nm: S.nm, href: `/tool/${sido}` }, { nm: G.nm, href: `/tool/${sido}/${sgg}` }], body }));
  } catch (e) {
    return send(res, 500, page({ title: "잠시 후 다시 시도해 주세요 | 케어온길", desc: "", canonical: "/tool", robots: "noindex", crumbs: [{ nm: "케어온길", href: "/" }], body: `<div class="panel"><h1>잠시 후 다시 시도해 주세요</h1></div>` }), false);
  }
}
