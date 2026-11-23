// 지역별 현황 페이지 사이트맵 (/sitemap-area.xml → 이 함수, vercel.json rewrites)
//  기관이 1곳 이상 있는 시·군·구 × 기관 종류만 넣음. 하루 캐시.
import { SB_URL, SB_KEY } from "../lib/db.js";
import { regionNames, kindCounts } from "./area.js";

export const config = { maxDuration: 60 };
const SITE = "https://www.careongil.kr";

export default async function handler(req, res) {
  if (!SB_URL || !SB_KEY) return res.status(500).send("설정 전");
  try {
    const [regions, cnt] = await Promise.all([regionNames(), kindCounts(null)]);
    const today = new Date().toISOString().slice(0, 10);
    const urls = [`${SITE}/area`];
    for (const s of regions) {
      urls.push(`${SITE}/area/${s.cd}`);
      for (const g of s.sggs) {
        const c = cnt.get(`${s.cd}-${g.cd}`) || {};
        for (const k of Object.keys(c)) if (c[k] > 0) urls.push(`${SITE}/area/${s.cd}/${g.cd}/${k}`);
      }
    }
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${u}</loc><lastmod>${today}</lastmod><changefreq>weekly</changefreq></url>`).join("\n")}\n</urlset>\n`;
    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Cache-Control", "public, s-maxage=86400, stale-while-revalidate=604800");
    return res.status(200).send(xml);
  } catch (e) {
    return res.status(500).send("잠시 후 다시 시도해 주세요");
  }
}
