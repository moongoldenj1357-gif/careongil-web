// 화면에서 쓰는 공개 설정. 카카오 지도 JavaScript 키는 원래 웹페이지에 드러나는 키라(도메인으로 잠금) 여기서 내려줌.
//  /api/config → { kakaoJsKey }
export default function handler(req, res) {
  res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=86400");
  res.status(200).json({ kakaoJsKey: (process.env.KAKAO_JS_KEY || "").trim() || null });
}
