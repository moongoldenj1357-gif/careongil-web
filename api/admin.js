// 케어온길 비즈 — 관리자용 (신청 목록, 입금 확인·승인 → 보고서 자동 발행, 카톡 알림 연결)
// 모든 요청은 헤더 x-admin-code 에 관리자 코드(ADMIN_CODE)가 있어야 함.
//  GET  /api/admin?list=1                         → 신청 목록 (최근 200건) + 카톡 연결 상태
//  POST /api/admin {action:"approve", no}         → 입금 확인 → 보고서 만들어 '완료'
//  POST /api/admin {action:"rebuild", no}         → 보고서 다시 만들기
//  POST /api/admin {action:"cancel", no}          → 신청 취소
//  POST /api/admin {action:"kakaoUrl"}            → 카톡 알림 연결 주소
//  POST /api/admin {action:"kakaoTest"}           → 카톡 시험 전송
//  POST /api/admin {action:"silverApprove", id}   → 실버타운 시설이 보낸 정보 승인 → 공개 (silver_facilities.info)
//  POST /api/admin {action:"silverReject", id}    → 실버타운 시설이 보낸 정보 반려
//  GET  /api/admin?code=..&state=..               → (카카오가 돌려보내는 주소) 알림 연결 마무리
import crypto from "node:crypto";
import { sb, kvGet, kvSet, SB_URL, SB_KEY } from "../lib/db.js";
import { buildReport, PRODUCTS, KIND_NM } from "../lib/report.js";
import * as kakao from "../lib/kakao.js";

export const config = { maxDuration: 60 };
const page = (msg) => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:sans-serif;padding:24px;line-height:1.6"><p>${msg}</p><p><a href="/admin">관리자 화면으로</a></p>`;

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!SB_URL || !SB_KEY) return res.status(500).json({ 오류: "SUPABASE 환경변수 없음" });
  const q = req.query || {};
  try {
    // 카카오 로그인 후 돌아오는 곳
    if (req.method === "GET" && q.state && (q.code || q.error)) {
      const saved = await kvGet("kakao_state");
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      if (!saved || saved.state !== q.state || Date.now() > saved.until) return res.status(400).send(page("연결 요청이 만료되었습니다. 관리자 화면에서 다시 눌러 주세요."));
      if (q.error) return res.status(400).send(page(`카카오 연결을 취소했거나 실패했습니다 (${String(q.error).slice(0, 40)}).`));
      await kakao.connect(String(q.code));
      await kvSet("kakao_state", null);
      await kakao.memo("[케어온길] 카카오톡 알림이 연결되었습니다. 새 리포트 신청이 들어오면 이 대화방으로 알려 드립니다.").catch(() => {});
      return res.status(200).send(page("✅ 카카오톡 알림이 연결되었습니다. 카카오톡 '나와의 채팅'에 시험 메시지가 왔는지 확인해 주세요."));
    }

    const code = String(req.headers["x-admin-code"] || "");
    const want = process.env.ADMIN_CODE || "";
    if (!want || code.length !== want.length || !crypto.timingSafeEqual(Buffer.from(code), Buffer.from(want))) return res.status(403).json({ 오류: "관리자 코드가 맞지 않습니다" });

    if (req.method === "GET") {
      const rows = await sb("report_orders?select=no,product,amount,status,region_nm,kind,inputs,name,phone,email,receipt,report_err,created_at,done_at,token&order=created_at.desc&limit=200");
      // 실버타운 시설이 보낸 정보 (확인 대기)
      let silver = [];
      try {
        const reqs = await sb("silver_info_requests?select=id,sid,info,writer_name,writer_role,writer_contact,created_at&status=eq.pending&order=created_at.asc&limit=50");
        const ids = [...new Set(reqs.map((r) => r.sid))];
        const fs = ids.length ? await sb(`silver_facilities?select=id,name,sido,tel,info&id=in.(${ids.join(",")})`) : [];
        silver = reqs.map((r) => ({ ...r, facility: fs.find((f) => f.id === r.sid) || null }));
      } catch (e) { silver = { err: e.message }; }
      return res.status(200).json({ rows: rows.map((r) => ({ ...r, product_nm: PRODUCTS[r.product]?.nm, kind_nm: KIND_NM[r.kind] })), silver, kakao: await kakao.status().catch((e) => ({ connected: false, err: e.message })) });
    }
    if (req.method !== "POST") return res.status(405).end();
    const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const no = String(b.no || "");

    if (b.action === "kakaoUrl") {
      if (!process.env.KAKAO_REST_KEY) return res.status(400).json({ 오류: "Vercel 환경변수 KAKAO_REST_KEY가 없습니다" });
      const state = crypto.randomBytes(16).toString("hex");
      await kvSet("kakao_state", { state, until: Date.now() + 10 * 60e3 });
      return res.status(200).json({ url: kakao.authUrl(state) });
    }
    if (b.action === "kakaoTest") { await kakao.memo("[케어온길] 시험 알림입니다. 잘 받으셨다면 연결이 정상입니다."); return res.status(200).json({ ok: true }); }

    if (b.action === "silverApprove" || b.action === "silverReject") {
      const id = String(b.id || "");
      if (!/^\d{1,9}$/.test(id)) return res.status(400).json({ 오류: "요청 번호가 올바르지 않습니다" });
      const [r] = await sb(`silver_info_requests?select=*&id=eq.${id}`);
      if (!r || r.status !== "pending") return res.status(404).json({ 오류: "확인을 기다리는 요청이 없습니다" });
      if (b.action === "silverApprove") {
        const [f] = await sb(`silver_facilities?select=info&id=eq.${r.sid}`);
        const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
        // 시설이 적은 항목만 덮어쓰고, 나머지는 기존 내용 유지
        // 공개 자료로 채운 항목의 출처(src·at)는 그대로 두고, 시설이 보낸 항목만 fac_keys에 적어 둠
        const old = f?.info || {};
        const info = { ...old, ...r.info, fac_keys: [...new Set([...(old.fac_keys || []), ...Object.keys(r.info)])], fac_at: today };
        await sb(`silver_facilities?id=eq.${r.sid}`, { method: "PATCH", body: { info }, prefer: "return=minimal" });
      }
      await sb(`silver_info_requests?id=eq.${id}`, { method: "PATCH", body: { status: b.action === "silverApprove" ? "approved" : "rejected", decided_at: new Date().toISOString() }, prefer: "return=minimal" });
      return res.status(200).json({ ok: true });
    }

    if (!/^\d{4}-\d{4}$/.test(no)) return res.status(400).json({ 오류: "신청번호가 올바르지 않습니다" });
    const [o] = await sb(`report_orders?select=*&no=eq.${no}`);
    if (!o) return res.status(404).json({ 오류: "신청이 없습니다" });

    if (b.action === "cancel") {
      await sb(`report_orders?no=eq.${no}`, { method: "PATCH", body: { status: "canceled" }, prefer: "return=minimal" });
      return res.status(200).json({ ok: true });
    }
    if (b.action === "approve" || b.action === "rebuild") {
      if (o.status === "canceled") return res.status(400).json({ 오류: "취소된 신청입니다" });
      let report;
      try { report = await buildReport(o); }
      catch (e) {
        await sb(`report_orders?no=eq.${no}`, { method: "PATCH", body: { report_err: e.message.slice(0, 300) }, prefer: "return=minimal" });
        throw new Error(`보고서를 만들지 못했습니다: ${e.message}`);
      }
      await sb(`report_orders?no=eq.${no}`, { method: "PATCH", body: { status: "done", report, report_err: null, done_at: o.done_at || new Date().toISOString() }, prefer: "return=minimal" });
      return res.status(200).json({ ok: true, near: report.custom?.near ? { missing: report.custom.near.missing } : null, nearErr: report.custom?.nearErr || null });
    }
    return res.status(400).json({ 오류: "알 수 없는 요청" });
  } catch (e) {
    return res.status(500).json({ 오류: e.message });
  }
}
