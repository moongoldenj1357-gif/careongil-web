// 케어온길 비즈 — 카드·간편결제(토스페이먼츠 결제위젯) 승인
//  GET /api/pay?t=열쇠&paymentKey=..&orderId=..&amount=..   (토스가 결제 성공 뒤 돌려보내는 주소)
//    → 금액·주문 확인 → 토스에 승인 요청 → '결제 완료' → 보고서 자동 발행 시도 → /order?t=열쇠 로 이동
//  보고서 발행이 실패해도 결제는 완료 상태로 남고, 관리자 화면에서 '보고서 발행'을 누르면 됨
import { sb, SB_URL, SB_KEY } from "../lib/db.js";
import { buildReport, PRODUCTS, KIND_NM } from "../lib/report.js";
import { memo } from "../lib/kakao.js";
import * as toss from "../lib/toss.js";

export const config = { maxDuration: 60 };
const won = (n) => Number(n).toLocaleString("ko-KR") + "원";
const back = (res, t, extra = "") => { res.setHeader("Cache-Control", "no-store"); res.writeHead(302, { Location: `/order?t=${encodeURIComponent(t)}${extra}` }); res.end(); };
const tell = (msg) => Promise.race([memo(msg), new Promise((r) => setTimeout(r, 4000))]).catch(() => {});

export default async function handler(req, res) {
  const t = String(req.query.t || "");
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(t)) return res.status(400).send("잘못된 주소입니다");
  if (!SB_URL || !SB_KEY || !toss.ready()) return back(res, t, "&payerr=" + encodeURIComponent("결제 설정이 아직 끝나지 않았습니다"));
  const paymentKey = String(req.query.paymentKey || ""), orderId = String(req.query.orderId || ""), amount = Number(req.query.amount);
  try {
    const [o] = await sb(`report_orders?select=*&token=eq.${t}`);
    if (!o) return res.status(404).send("신청을 찾지 못했습니다");
    if (o.status === "paid" || o.status === "done") return back(res, t); // 새로고침 등으로 다시 들어온 경우
    if (o.status !== "requested") return back(res, t, "&payerr=" + encodeURIComponent("취소된 신청이라 결제할 수 없습니다"));
    // 금액·주문번호가 우리 신청과 같은지 확인 (화면에서 금액을 바꿔치기한 경우 막음)
    if (!paymentKey || orderId !== toss.orderIdOf(o.no) || amount !== o.amount) return back(res, t, "&payerr=" + encodeURIComponent("결제 정보가 신청 내용과 달라 승인하지 않았습니다"));

    const p = await toss.confirm(paymentKey, orderId, amount);
    if (p.status !== "DONE" || p.totalAmount !== o.amount) throw new Error("결제가 완료되지 않았습니다");
    const now = new Date().toISOString();
    await sb(`report_orders?no=eq.${o.no}&status=eq.requested`, { method: "PATCH", body: { status: "paid", pay_method: "toss", pay_key: paymentKey, paid_at: now, pay_info: toss.summary(p), receipt: { type: "card" } }, prefer: "return=minimal" });

    // 보고서 자동 발행
    let issued = false;
    try {
      const report = await buildReport({ ...o, status: "paid" });
      await sb(`report_orders?no=eq.${o.no}`, { method: "PATCH", body: { status: "done", report, report_err: null, done_at: new Date().toISOString() }, prefer: "return=minimal" });
      issued = true;
    } catch (e) {
      await sb(`report_orders?no=eq.${o.no}`, { method: "PATCH", body: { report_err: String(e.message).slice(0, 300) }, prefer: "return=minimal" }).catch(() => {});
    }
    await tell(`[케어온길] ${toss.isTest() ? "(테스트) " : ""}카드 결제 완료\n${o.no} · ${PRODUCTS[o.product]?.nm} · ${won(o.amount)}\n${o.region_nm} ${KIND_NM[o.kind] || ""}\n${issued ? "보고서 자동 발행 완료" : "⚠ 보고서 자동 발행 실패 → 관리자 화면에서 '보고서 발행'을 눌러 주세요"}`);
    return back(res, t, "&paid=1");
  } catch (e) {
    return back(res, t, "&payerr=" + encodeURIComponent(e.message || "결제 승인에 실패했습니다"));
  }
}
