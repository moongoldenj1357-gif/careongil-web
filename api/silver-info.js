// 케어온길 실버타운·양로원 — 시설이 직접 보내는 정보 등록·수정 요청 (관리자 승인 후 공개)
//  POST /api/silver-info { sid, info:{monthly,rooms,meals,cleaning,health,care,entry,refund},
//                          writer_name, writer_role, writer_contact, agree:true, hp:"" }
import { sb, SB_URL, SB_KEY } from "../lib/db.js";
import * as kakao from "../lib/kakao.js";

export const config = { maxDuration: 15 };
export const INFO_KEYS = ["monthly", "rooms", "meals", "cleaning", "health", "care", "entry", "refund"];
const clean = (s, n) => String(s ?? "").replace(/[\u0000-\u0008\u000b-\u001f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ 오류: "POST만 받습니다" });
  if (!SB_URL || !SB_KEY) return res.status(500).json({ 오류: "SUPABASE 환경변수 없음" });
  try {
    const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    if (b.hp) return res.status(200).json({ ok: true });            // 자동 등록 방지용 빈칸
    const sid = String(b.sid || "");
    if (!/^\d{1,7}$/.test(sid)) return res.status(400).json({ 오류: "시설 번호가 올바르지 않습니다" });
    if (b.agree !== true) return res.status(400).json({ 오류: "개인정보 수집·이용에 동의해 주셔야 보내실 수 있습니다" });
    const writer_name = clean(b.writer_name, 30), writer_role = clean(b.writer_role, 30), writer_contact = clean(b.writer_contact, 60);
    if (writer_name.length < 2 || writer_contact.length < 7) return res.status(400).json({ 오류: "담당자 성함과 연락처를 적어 주시면 됩니다" });
    const info = {};
    for (const k of INFO_KEYS) { const v = clean(b.info?.[k], 300); if (v) info[k] = v; }
    if (!Object.keys(info).length) return res.status(400).json({ 오류: "적어 주신 내용이 없습니다" });

    const [f] = await sb(`silver_facilities?select=id,name&id=eq.${sid}`);
    if (!f) return res.status(404).json({ 오류: "시설을 찾지 못했습니다" });
    const pend = await sb(`silver_info_requests?select=id&sid=eq.${sid}&status=eq.pending`);
    if (pend.length >= 3) return res.status(429).json({ 오류: "이 시설로 확인을 기다리는 요청이 이미 있습니다. 확인 후 반영해 드리겠습니다" });

    await sb("silver_info_requests", { method: "POST", body: { sid: Number(sid), info, writer_name, writer_role: writer_role || null, writer_contact }, prefer: "return=minimal" });
    await kakao.memo(`[케어온길] 실버타운 정보 등록 요청\n${f.name}\n${writer_name}${writer_role ? ` (${writer_role})` : ""}\n관리자 화면에서 확인해 주세요.`).catch(() => {});
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ 오류: e.message });
  }
}
