// 위치정보 이용사실 확인자료 기록 (위치정보법 제16조). 좌표는 받지도 저장하지도 않음.
//  POST /api/loclog { type: "consent" | "use" | "withdraw" }
//  withdraw(동의 철회) → 이 이용자(IP 해시)의 기록을 지체 없이 파기
import { createHash } from "node:crypto";
const SB_URL = (process.env.SUPABASE_URL ?? "").trim().replace(/\/+$/, "").replace(/\/rest\/v1$/, "");
const SB_KEY = process.env.SUPABASE_SECRET_KEY ?? "";
const H = { apikey: SB_KEY, "Content-Type": "application/json", Prefer: "return=minimal", ...(SB_KEY.startsWith("sb_") ? {} : { Authorization: `Bearer ${SB_KEY}` }) };
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ 오류: "잘못된 요청입니다" });
  let body = req.body; if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  const type = String(body?.type || "");
  if (!["consent", "use", "withdraw"].includes(type)) return res.status(400).json({ 오류: "잘못된 요청입니다" });
  const ip = String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "").split(",")[0].trim();
  const who = createHash("sha256").update(ip + "|" + SB_KEY.slice(-16)).digest("hex").slice(0, 32);
  try {
    if (type === "withdraw") {
      const r = await fetch(`${SB_URL}/rest/v1/loc_log?who=eq.${who}`, { method: "DELETE", headers: H });
      if (!r.ok) throw new Error(String(r.status));
      return res.status(200).json({ ok: true });
    }
    const row = { who, event: type, purpose: "내 주변 찾기(현재 위치의 시·군·구 확인)", method: "이용자 브라우저 위치 기능 → 카카오 지도 API(좌표→지역 변환), 회사 서버로 좌표 전송·저장 안 함", provided_to: "없음" };
    const r = await fetch(`${SB_URL}/rest/v1/loc_log`, { method: "POST", headers: H, body: JSON.stringify(row) });
    if (!r.ok) throw new Error(String(r.status));
    return res.status(200).json({ ok: true });
  } catch (e) { return res.status(500).json({ 오류: "기록하지 못했습니다" }); }
}
