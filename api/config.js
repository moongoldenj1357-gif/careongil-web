// 화면에서 쓰는 공개 설정. 카카오 JavaScript 키는 원래 웹페이지에 드러나는 키라(도메인으로 잠금) 여기서 내려줌.
//  /api/config → { kakaoJsKey, kakaoShareKey }
//  - kakaoJsKey    : 지도용 (AI Location Insight 앱, 카카오맵 무료 쿼터)
//  - kakaoShareKey : 카카오톡 공유용 (케어온길 앱 — 공유 카드에 "케어온길"로 표시). 없으면 지도용 키로 공유
export default function handler(req, res) {
  const v = (k) => (process.env[k] || "").trim() || null;
  res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=86400");
  res.status(200).json({ kakaoJsKey: v("KAKAO_JS_KEY"), kakaoShareKey: v("KAKAO_SHARE_KEY") });
}
