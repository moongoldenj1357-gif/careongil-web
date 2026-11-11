// 시험용 3차: 공단 API가 쓰는 시·도 코드 찾기 (전남광주통합특별시 출범 후 바뀐 코드 확인용, 관리자 코드 필요)
//  /api/probe?code=관리자코드
//  10~99 코드마다 1건씩 요청해서, 기관이 있는 코드와 그 코드의 첫 기관 주소를 보여 줌
export const config = { maxDuration: 60 };
const KEY = process.env.DATA_GO_KR_KEY ?? "";
const BASE = "https://apis.data.go.kr/B550928/searchLtcInsttService02/getLtcInsttSeachList02";
async function one(cd) {
  const u = new URL(BASE);
  u.searchParams.set("serviceKey", KEY);
  for (const [k, v] of Object.entries({ siDoCd: cd, pageNo: 1, numOfRows: 1, _type: "json" })) u.searchParams.set(k, String(v));
  try {
    const t = await (await fetch(u, { signal: AbortSignal.timeout(15000) })).text();
    const total = Number((t.match(/"totalCount"\s*:\s*(\d+)/) || t.match(/<totalCount>(\d+)/) || [])[1] || 0);
    const addr = (t.match(/"(?:adminAddr|addr|baseAddr)"\s*:\s*"([^"]*)"/) || t.match(/<(?:adminAddr|addr|baseAddr)>([^<]*)/) || [])[1] || "";
    const sgg = (t.match(/"siGunGuCd"\s*:\s*"?(\d+)/) || t.match(/<siGunGuCd>(\d+)/) || [])[1] || "";
    const err = /SERVICE_ERROR|errMsg|LIMITED/.test(t) ? t.replace(/\s+/g, " ").slice(0, 120) : "";
    return { cd, total, addr: addr.slice(0, 40), sgg, err };
  } catch (e) { return { cd, total: -1, err: e.message }; }
}
export default async function handler(req, res) {
  const q = req.query || {};
  if (!process.env.ADMIN_CODE || q.code !== process.env.ADMIN_CODE) return res.status(403).json({ 오류: "관리자 코드가 필요해요" });
  const codes = Array.from({ length: 90 }, (_, i) => String(i + 10));
  const out = [];
  for (let i = 0; i < codes.length; i += 10) {
    out.push(...(await Promise.all(codes.slice(i, i + 10).map(one))));
    await new Promise((r) => setTimeout(r, 400));
  }
  const found = out.filter((x) => x.total > 0);
  return res.status(200).json({ 기관있는코드: found, 오류: out.filter((x) => x.err).slice(0, 5), 확인한코드수: out.length });
}
