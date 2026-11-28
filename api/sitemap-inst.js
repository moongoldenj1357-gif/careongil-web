// 기관별 페이지 사이트맵 (/sitemap-inst.xml → /api/sitemap-inst). 최근 공단 목록에 있는 기관만 (3주 넘게 안 보인 곳은 뺌)
import { sb } from "../lib/db.js";
import { AREA_KINDS } from "./area.js";
export const config = { maxDuration: 60 };
export default async function handler(req, res) {
  try {
    const since = new Date(Date.now() - 21 * 864e5).toISOString().slice(0, 10);
    const kinds = Object.keys(AREA_KINDS).join(",");
    const rows = [];
    for (let off = 0; off < 60000; off += 1000) {
      const d = await sb(`ltc_insts?select=sym,pttn,detail_at&kind=in.(${kinds})&or=(list_seen.is.null,list_seen.gte.${since})&order=sym.asc,pttn.asc&limit=1000&offset=${off}`);
      rows.push(...d);
      if (d.length < 1000) break;
    }
    const today = new Date().toISOString().slice(0, 10);
    const urls = rows.slice(0, 50000).map((r) => `<url><loc>https://www.careongil.kr/inst/${r.sym}-${r.pttn}</loc><lastmod>${String(r.detail_at || today).slice(0, 10)}</lastmod></url>`);
    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Cache-Control", "public, s-maxage=86400, stale-while-revalidate=604800");
    return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>`);
  } catch (e) {
    res.setHeader("Cache-Control", "no-store");
    return res.status(500).send("sitemap error");
  }
}
