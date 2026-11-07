// 시험용 2차: 유형코드로 거르는 방법 + 남은 상세 항목 이름 찾기 (관리자 코드 필요)
//  /api/probe?code=관리자코드
const KEY = process.env.DATA_GO_KR_KEY ?? "";
const BASE = "https://apis.data.go.kr/B550928";
async function raw(path, params) {
  const u = new URL(`${BASE}/${path}`);
  u.searchParams.set("serviceKey", KEY);
  for (const [k, v] of Object.entries(params)) if (v != null && v !== "") u.searchParams.set(k, String(v));
  try { const r = await fetch(u, { signal: AbortSignal.timeout(15000) }); return await r.text(); } catch (e) { return "ERR " + e.message; }
}
const total = (t) => (t.match(/"totalCount"\s*:\s*(\d+)/) || t.match(/<totalCount>(\d+)/) || [])[1] ?? (/NO_OPENAPI|SERVICE_ERROR|errMsg/.test(t) ? "오류" : "?");
const ok = (t) => /NO_OPENAPI_SERVICE_ERROR|해당 오픈API 서비스가 없거나/.test(t) ? "없음" : t.replace(/\s+/g, " ").slice(0, 700);
export default async function handler(req, res) {
  const q = req.query || {};
  if (!process.env.ADMIN_CODE || q.code !== process.env.ADMIN_CODE) return res.status(403).json({ 오류: "관리자 코드가 필요해요" });
  const L = "searchLtcInsttService02/getLtcInsttSeachList02";
  const base = { pageNo: 1, numOfRows: 1, siDoCd: "41", siGunGuCd: "281", _type: "json" };   // 경기 고양 덕양구
  const out = { 필터시험: {}, 유형분포: {}, 상세이름: {} };
  out.필터시험.기본 = total(await raw(L, base));
  for (const p of ["adminPttnCd", "adminKindCd", "adminType", "ltcAdminKindCd", "longTermAdminKind", "srvcKindCd"]) out.필터시험[p + "=A03"] = total(await raw(L, { ...base, [p]: "A03" }));
  // 한 시군구 전체를 받아 유형코드 분포 + 이름 예시
  const all = await raw(L, { ...base, numOfRows: 300 });
  const items = [...all.matchAll(/"adminNm"\s*:\s*"([^"]*)"[^}]*?"adminPttnCd"\s*:\s*"([^"]*)"[^}]*?"longTermAdminSym"\s*:\s*"?(\d+)/g)];
  for (const [, nm, cd, sym] of items) { const o = (out.유형분포[cd] ||= { 수: 0, 예시: [], 코드예: sym }); o.수++; if (o.예시.length < 3) o.예시.push(nm); }
  // 남은 상세 항목 이름 후보
  const sym = items.find((x) => x[2] === "A03")?.[3] || items[0]?.[3] || "", pttn = items.find((x) => x[2] === "A03") ? "A03" : items[0]?.[2] || "";
  const cands = ["getNonpayItemDetailInfoItem02", "getNonBnftDetailInfoItem02", "getNonpayInfoDetailInfoItem02", "getUninsrDetailInfoItem02", "getNonPaymentDetailInfoItem02", "getNpayDetailInfoItem02",
    "getFcltyDetailInfoItem02", "getEqpmnSttusDetailInfoItem02", "getInstlSttusDetailInfoItem02", "getFcltsSttusDetailInfoItem02",
    "getMnpwrSttusDetailInfoItem02", "getNmprSttusDetailInfoItem02", "getHmnrscDetailInfoItem02", "getWorkerSttusDetailInfoItem02", "getLabrrDetailInfoItem02",
    "getProgrmSttusDetailInfoItem02", "getProgramDetailInfoItem02", "getPrgmSttusDetailInfoItem02", "getCtrtInsttDetailInfoItem02", "getAgrmntInsttDetailInfoItem02", "getWelToolDetailInfoItem02"];
  for (const op of cands) out.상세이름[op] = ok(await raw(`getLtcInsttDetailInfoService02/${op}`, { longTermAdminSym: sym, adminPttnCd: pttn, pageNo: 1, numOfRows: 3 }));
  out.시험기관 = { sym, pttn };
  return res.status(200).json(out);
}
