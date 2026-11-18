// 케어온길 비즈 — 토스페이먼츠 웹훅 (가상계좌 입금 알림)
//  POST /api/toss-hook   ← 토스 개발자센터 > 웹훅에 이 주소를 등록 (이벤트: DEPOSIT_CALLBACK)
//  받은 내용을 그대로 믿지 않고, 주문번호로 토스에 결제 상태를 다시 조회해서 '입금 완료(DONE)'일 때만 처리
//    → '결제 완료' → 보고서 자동 발행 (lib/paid.js)
//  입금 전 가상계좌가 취소·만료되면 결제 정보만 정리 (신청은 그대로 두어 다시 결제할 수 있게)
import { sb, SB_URL, SB_KEY } from "../lib/db.js";
import { markPaid } from "../lib/paid.js";
import * as toss from "../lib/toss.js";

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ 오류: "POST만 받습니다" });
  if (!SB_URL || !SB_KEY || !toss.ready()) return res.status(500).json({ 오류: "설정 전" });
  try {
    const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const orderId = String(b.orderId || b.data?.orderId || "");
    const m = orderId.match(/^careongil-([0-9]{4}-[0-9]{4})$/);
    if (!m) return res.status(200).json({ ok: true, 무시: "케어온길 주문이 아님" }); // 200으로 답해야 토스가 재전송하지 않음
    const [o] = await sb(`report_orders?select=*&no=eq.${m[1]}`);
    if (!o) return res.status(200).json({ ok: true, 무시: "신청 없음" });

    const p = await toss.getByOrder(orderId); // 토스에 직접 다시 확인
    if (p.status === "DONE" && p.totalAmount === o.amount && o.status === "requested") {
      await markPaid(o, p, p.paymentKey);
    } else if ((p.status === "CANCELED" || p.status === "EXPIRED" || p.status === "ABORTED") && o.status === "requested" && o.pay_info?.va) {
      await sb(`report_orders?no=eq.${o.no}&status=eq.requested`, { method: "PATCH", body: { pay_key: null, pay_info: { ...o.pay_info, va: null, vaClosed: p.status } }, prefer: "return=minimal" });
    }
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ 오류: String(e.message).slice(0, 200) }); // 500이면 토스가 나중에 다시 보내 줌
  }
}
