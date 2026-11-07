// 국민건강보험공단 장기요양기관 API (공공데이터포털, 이용허락 제한 없음)
const KEY = process.env.DATA_GO_KR_KEY ?? "";
const BASE = "https://apis.data.go.kr/B550928";
export const SIDOS = ["11", "26", "27", "28", "29", "30", "31", "36", "41", "42", "43", "44", "45", "46", "47", "48", "50", "51", "52"];
export const KIND = (p) => {
  const c = String(p || "").toUpperCase();
  if (/^(A0[1-4]|S4)/.test(c)) return "home";            // 요양원 (노인요양시설·공동생활가정)
  if (/^(B03|C03|H31|I3)/.test(c)) return "daycare";      // 주야간보호 (I3x 치매전담형)
  if (/^(B04|C04|H32)/.test(c)) return "short";           // 단기보호
  if (/^(B01|C01)/.test(c)) return "visit_care";          // 방문요양
  if (/^(B02|C02)/.test(c)) return "visit_bath";          // 방문목욕
  if (/^(B05|C05)/.test(c)) return "visit_nurse";         // 방문간호
  if (/^(B06|C06)/.test(c)) return "tool";                // 복지용구
  return "other";
};
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
// 상세: 일반현황(주소·전화) + 입소인원(시설·주야간·단기) + 기관기타(홈페이지·주차·교통)
export async function detail(sym, pttn, kind) {
  const P = { longTermAdminSym: sym, adminPttnCd: pttn };
  const D = "getLtcInsttDetailInfoService02";
  // 공공데이터포털 초당 제한 때문에 한 기관 안에서는 차례로 부름
  const ops = [`${D}/getGeneralSttusDetailInfoItem02`, `${D}/getInsttEtcDetailInfoItem02`, ...(["home", "daycare", "short"].includes(kind) ? [`${D}/getAceptncNmprDetailInfoItem02`] : [])];
  const res = [];
  for (const op of ops) { res.push(await call(op, P)); await sleep(120); }
  const tasks = ops, [g, e, a] = res;
  const G = g.items[0] || {}, E = e.items[0] || {}, A = a?.items?.[0] || {};
  const tel = [G.locTelNo_1, G.locTelNo_2, G.locTelNo_3].filter(Boolean).join("-") || null;
  return { calls: tasks.length, row: {
    addr: G.adminAddr || null, addr_detail: G.detailAddr || null, post: G.hmPostNo || null, tel, bdong: G.BDongCd || null,
    ...(G.siGunGuCd ? { sgg_cd: String(G.siGunGuCd).padStart(3, "0") } : {}),
    capacity: int(A.totPer), now_m: int(A.maNowPer), now_f: int(A.fmNowPer), wait_m: int(A.maRsvPer), wait_f: int(A.fmRsvPer),
    homepage: /^https?:\/\//.test(E.hmpgAddr || "") ? E.hmpgAddr : E.hmpgAddr ? "http://" + E.hmpgAddr : null, parking: E.pkngEquip || null, transport: E.tfMth || null,
    detail_at: new Date().toISOString(), detail_err: null, updated_at: new Date().toISOString() } };
}
