// 시험용: 국민건강보험공단 장기요양기관 API가 실제로 어떤 모양으로 답하는지 확인 (관리자 코드 필요)
//  /api/probe?code=관리자코드                      → 목록 API (경기 고양) 첫 쪽 + 상세 API 후보들
//  /api/probe?code=...&sido=11&sgg=680&kind=      → 지역 바꿔 보기
const KEY = process.env.DATA_GO_KR_KEY ?? "";
const BASE = "https://apis.data.go.kr/B550928";
const cut = (t, n = 1500) => String(t).replace(/\s+/g, " ").slice(0, n);
async function hit(path, params) {
  const u = new URL(`${BASE}/${path}`);
  u.searchParams.set("serviceKey", KEY);
  for (const [k, v] of Object.entries(params)) if (v != null && v !== "") u.searchParams.set(k, String(v));
  try {
    const r = await fetch(u, { signal: AbortSignal.timeout(15000) });
    const t = await r.text();
    return { 상태: r.status, 응답: cut(t) };
  } catch (e) { return { 오류: e.message }; }
}
export default async function handler(req, res) {
  const q = req.query || {};
  if (!process.env.ADMIN_CODE || q.code !== process.env.ADMIN_CODE) return res.status(403).json({ 오류: "관리자 코드가 필요해요" });
  if (!KEY) return res.status(500).json({ 오류: "DATA_GO_KR_KEY 환경변수가 없어요" });
  const sido = q.sido || "41", sgg = q.sgg || "";
  const list = await hit("searchLtcInsttService02/getLtcInsttSeachList02", { pageNo: 1, numOfRows: 5, siDoCd: sido, siGunGuCd: sgg, adminKindCd: q.kind || "", _type: "json" });
  // 목록에서 첫 기관 코드·유형 꺼내기
  const sym = (list.응답 || "").match(/<longTermAdminSym>([^<]+)/)?.[1] || (list.응답 || "").match(/"longTermAdminSym"\s*:\s*"?([^",}]+)/)?.[1] || q.sym || "";
  const pttn = (list.응답 || "").match(/<adminPttnCd>([^<]+)/)?.[1] || (list.응답 || "").match(/"adminPttnCd"\s*:\s*"?([^",}]+)/)?.[1] || q.pttn || "";
  const ops = ["getGeneralSttusDetailInfoItem02", "getAceptncNmprDetailInfoItem02", "getEtcDetailInfoItem02", "getNonpaySttusDetailInfoItem02", "getFcltySttusDetailInfoItem02", "getHmnrsSttusDetailInfoItem02", "getPgmSttusDetailInfoItem02", "getAgreeInsttSttusDetailInfoItem02", "getInsttEtcDetailInfoItem02", "getNonpayDetailInfoItem02", "getFacilityDetailInfoItem02", "getMnpwSttusDetailInfoItem02"];
  const detail = {};
  if (sym) for (const op of ops) detail[op] = await hit(`getLtcInsttDetailInfoService02/${op}`, { longTermAdminSym: sym, adminPttnCd: pttn, pageNo: 1, numOfRows: 5 });
  return res.status(200).json({ 목록: list, 첫기관: { sym, pttn }, 상세: detail });
}
