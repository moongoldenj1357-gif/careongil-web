// 국민건강보험공단 장기요양기관 API (공공데이터포털, 이용허락 제한 없음)
const KEY = process.env.DATA_GO_KR_KEY ?? "";
const BASE = "https://apis.data.go.kr/B550928";
export const SIDOS = ["11", "26", "27", "28", "29", "30", "31", "36", "41", "42", "43", "44", "45", "46", "47", "48", "50", "51", "52"];
// 유형코드: 공단 활용가이드(2026) 기준.
// G·M = 요양원 안 치매전담실, H·I = 주야간보호 안 치매전담실 → 따로 "unit"으로 두고 본 기관(같은 기관기호)에 표시만 함
export const KIND = (p) => {
  const c = String(p || "").toUpperCase();
  if (/^[GMHI]\d/.test(c)) return "unit";                // 치매전담실 (검색 목록에는 안 나옴, 상세 수집 안 함)
  if (/^(A0[1-4]|S\d)/.test(c)) return "home";            // 요양원 (노인요양시설·공동생활가정·치매전담형)
  if (/^(B03|C03)/.test(c)) return "daycare";             // 주야간보호
  if (/^(A05|B04|C04)/.test(c)) return "short";            // 단기보호
  if (/^(B01|C01)/.test(c)) return "visit_care";          // 방문요양
  if (/^(B02|C02)/.test(c)) return "visit_bath";          // 방문목욕
  if (/^(B05|C05)/.test(c)) return "visit_nurse";         // 방문간호
  if (/^(B06|C06)/.test(c)) return "tool";                // 복지용구
  return "other";
};
export const STAY = ["home", "daycare", "short"];          // 정원·인력·시설·비급여까지 받는 종류
export const PRIORITY = ["home", "daycare", "short", "visit_care", "visit_nurse", "visit_bath", "other"];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// XML이든 JSON이든 <item> 목록을 객체 배열로
function parse(t) {
  t = String(t || "");
  if (/PER_SECOND|초당/.test(t)) throw new Error("초당 요청 초과");
  if (/NO_OPENAPI_SERVICE_ERROR|SERVICE_KEY_IS_NOT_REGISTERED|LIMITED_NUMBER_OF_SERVICE_REQUESTS|SERVICE_ACCESS_DENIED/.test(t)) {
    const m = t.match(/<returnAuthMsg>([^<]*)/)?.[1] || t.match(/<errMsg>([^<]*)/)?.[1] || "API 오류";
    throw new Error(/LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS/.test(t) ? "오늘 호출 한도 초과" : m);
  }
  if (t.trim().startsWith("{")) {
    const j = JSON.parse(t), b = j?.response?.body || {};
    let it = b.items?.item ?? b.items ?? [];
    if (!Array.isArray(it)) it = it ? [it] : [];
    return { items: it, total: Number(b.totalCount ?? it.length) };
  }
  const items = [...t.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, x]) => Object.fromEntries([...x.matchAll(/<(\w+)>([\s\S]*?)<\/\1>/g)].map(([, k, v]) => [k, v.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim()])));
  return { items, total: Number(t.match(/<totalCount>(\d+)/)?.[1] ?? items.length) };
}
async function call(path, params) {
  const u = new URL(`${BASE}/${path}`);
  u.searchParams.set("serviceKey", KEY);
  for (const [k, v] of Object.entries(params)) if (v != null && v !== "") u.searchParams.set(k, String(v));
  let last;
  for (let i = 0; i < 3; i++) {
    try { const r = await fetch(u, { signal: AbortSignal.timeout(20000) }); return parse(await r.text()); }
    catch (e) { last = e; if (/오늘 호출 한도|등록되지|SERVICE_KEY/.test(e.message)) throw e; await sleep((/초당/.test(e.message) ? 1500 : 800) * (i + 1)); }
  }
  throw last;
}
const ymd = (s) => { const d = String(s ?? "").replace(/\D/g, ""); return d.length === 8 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : null; };
const int = (v) => (v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);
export async function listPage(sido, page, rows = 1000) {
  const { items, total } = await call("searchLtcInsttService02/getLtcInsttSeachList02", { siDoCd: sido, pageNo: page, numOfRows: rows, _type: "json" });
  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  return { total, rows: items.map((o) => ({ sym: String(o.longTermAdminSym), pttn: String(o.adminPttnCd || ""), name: o.adminNm, kind: KIND(o.adminPttnCd),
    sido_cd: String(o.siDoCd ?? sido), sgg_cd: o.siGunGuCd != null ? String(o.siGunGuCd).padStart(3, "0") : null, designated: ymd(o.longTermPeribRgtDt), list_seen: today, updated_at: new Date().toISOString() }))
    .filter((r, i, a) => r.sym && r.pttn && a.findIndex((x) => x.sym === r.sym && x.pttn === r.pttn) === i) };
}
// 상세: 일반현황(주소·전화) + 기관기타(홈페이지·주차·교통)
//  + 입소형(요양원·주야간·단기)은 입소인원·인력·시설·비급여·프로그램까지 (기관당 7번 호출)
const NONPAY = { 1: "식재료비", 2: "상급침실사용료", 3: "이미용비", 4: "경관영양유동식비", 5: "간식비", 6: "상급침실사용료(2인실)", 7: "기타" };
const PGM = { 1: "인지기능향상", 2: "운동보조", 3: "기타" };
const lc = (o) => Object.fromEntries(Object.entries(o || {}).map(([k, v]) => [k.toLowerCase().replace(/_/g, ""), v]));
const n0 = (v) => int(v) ?? 0;
function staffOf(x) {
  if (!x || !Object.keys(x).length) return null;
  return { 시설장: n0(x.equiplong), 사무국장: n0(x.hdofce), 사회복지사: n0(x.socwel), 의사: n0(x.chrgdoc) + n0(x.chargedoc), 간호사: n0(x.nur), 간호조무사: n0(x.nurarticle),
    물리치료사: n0(x.physicalmtret), 작업치료사: n0(x.wrkmtret), 요양보호사: n0(x.recuprot1) + n0(x.recuprot2), 요양보호사유예: n0(x.recuprotdelay), 영양사: n0(x.nut), 조리원: n0(x.cook),
    위생원: n0(x.hygiprsn), 사무원: n0(x.ofceemp), 관리인: n0(x.mgmtprsn), 보조원: n0(x.suppprsn), 기타: n0(x.etcper) };
}
function roomsOf(x) {
  if (!x || !Object.keys(x).length) return null;
  return { "1인실": n0(x.prsnroomreal1), "2인실": n0(x.prsnroomreal2), "3인실": n0(x.prsnroomreal3), "4인실": n0(x.prsnroomreal4), 특수침실: n0(x.spcacuproomreal),
    프로그램실: n0(x.pgmroomreal), 훈련실: n0(x.functrnroomreal), "의료·간호사실": n0(x.medroomreal), 식당조리실: n0(x.crmnyprst), 화장실: n0(x.batroom), 목욕실: n0(x.taxpagelong) };
}
export async function detail(sym, pttn, kind) {
  const P = { longTermAdminSym: sym, adminPttnCd: pttn }, L = { longTermAdminSym: sym, pageNo: 1, numOfRows: 50 };
  const D = "getLtcInsttDetailInfoService02";
  const stay = STAY.includes(kind);
  const ops = [[`${D}/getGeneralSttusDetailInfoItem02`, P], [`${D}/getInsttEtcDetailInfoItem02`, P],
    ...(stay ? [[`${D}/getAceptncNmprDetailInfoItem02`, P], [`${D}/getStaffSttusDetailInfoItem02`, P], [`${D}/getInsttSttusDetailInfoItem02`, P],
      [`${D}/getNonBenefitSttusDetailInfoList02`, L], [`${D}/getProgramSttusDetailInfoList02`, L]] : [])];
  // 공공데이터포털 초당 제한 때문에 한 기관 안에서는 차례로 부름
  const res = [];
  for (const [op, params] of ops) { res.push(await call(op, params)); await sleep(120); }
  const [g, e, a, st, rm, np, pg] = res;
  const G = g.items[0] || {}, E = e.items[0] || {}, A = a?.items?.[0] || {};
  const tel = [G.locTelNo_1, G.locTelNo_2, G.locTelNo_3].filter(Boolean).join("-") || null;
  const home = String(E.hmpgAddr || "").trim();
  const extra = stay ? {
    staff: staffOf(lc(st?.items?.[0])),
    rooms: roomsOf(lc(rm?.items?.[0])),
    nonpay: (np?.items || []).map((x) => ({ 종류: NONPAY[String(x.nonpayKind).trim()] || "기타", 금액: int(String(x.nonpayTgtAmt ?? "").replace(/[^\d.-]/g, "")), 근거: x.prodBase || null, 등록일: ymd(x.uptDt) })),
    programs: (pg?.items || []).slice(0, 50).map((x) => ({ 종류: PGM[String(x.pgmType).trim()] || "기타", 이름: x.pgmNm || null, 대상: int(x.tgtNop), 주기: x.cyclTm || null, 장소: x.runPlc || null })),
    extra_at: new Date().toISOString(),
  } : {};
  return { calls: ops.length, row: {
    addr: G.adminAddr || null, addr_detail: G.detailAddr || null, post: G.hmPostNo || null, tel, bdong: G.BDongCd || null,
    ...(G.siGunGuCd ? { sgg_cd: String(G.siGunGuCd).padStart(3, "0") } : {}),
    capacity: int(A.totPer), now_m: int(A.maNowPer), now_f: int(A.fmNowPer), wait_m: int(A.maRsvPer), wait_f: int(A.fmRsvPer),
    homepage: /\.[a-z가-힣]{2,}/i.test(home) ? (/^https?:\/\//i.test(home) ? home : "http://" + home) : null, parking: E.pkngEquip || null, transport: E.tfMth || null,
    ...extra, detail_at: new Date().toISOString(), detail_err: null, updated_at: new Date().toISOString() } };
}
