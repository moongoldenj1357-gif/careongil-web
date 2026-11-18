// 케어온길 비즈 — 카드·간편결제·가상계좌(토스페이먼츠 결제위젯) 승인
//  GET /api/pay?t=열쇠&paymentKey=..&orderId=..&amount=..   (토스가 결제 성공 뒤 돌려보내는 주소)
//    → 금액·주문 확인 → 토스에 승인 요청
//      · 카드·간편결제: 바로 '결제 완료' → 보고서 자동 발행 (lib/paid.js)
//      · 가상계좌: '입금 대기' (계좌번호를 고객 화면에 보여 줌) → 입금되면 /api/toss-hook 이 처리
//    → /order?t=열쇠 로 이동
import { sb, SB_URL, SB_KEY } from "../lib/db.js";
import { PRODUCTS } from "../lib/report.js";
import { markPaid, tell } from "../lib/paid.js";
import * as toss from "../lib/toss.js";

export const config = { maxDuration: 60 };
const won = (n) => Number(n).toLocaleString("ko-KR") + "원";
const back = (res, t, extra = "") => { res.setHeader("Cache-Control", "no-store"); res.writeHead(302, { Location: `/order?t=${encodeURIComponent(t)}${extra}` }); res.end(); };

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
    if (o.pay_key && o.pay_info?.va) return back(res, t); // 이미 가상계좌를 발급받은 신청
    // 금액·주문번호가 우리 신청과 같은지 확인 (화면에서 금액을 바꿔치기한 경우 막음)
    if (!paymentKey || orderId !== toss.orderIdOf(o.no) || amount !== o.amount) return back(res, t, "&payerr=" + encodeURIComponent("결제 정보가 신청 내용과 달라 승인하지 않았습니다"));

    const p = await toss.confirm(paymentKey, orderId, amount);
    if (p.totalAmount !== o.amount) throw new Error("결제 금액이 신청 금액과 다릅니다");

    if (p.status === "WAITING_FOR_DEPOSIT") { // 가상계좌 발급 → 입금 대기
      await sb(`report_orders?no=eq.${o.no}&status=eq.requested`, { method: "PATCH", body: { pay_method: "toss", pay_key: paymentKey, pay_info: toss.summary(p) }, prefer: "return=minimal" });
      const va = toss.summary(p).va || {};
      await tell(`[케어온길] ${toss.isTest() ? "(테스트) " : ""}가상계좌 발급 (입금 대기)\n${o.no} · ${PRODUCTS[o.product]?.nm} · ${won(o.amount)}\n${va.bank || ""} · 입금기한 ${va.due ? new Date(va.due).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }) : "-"}\n입금되면 자동으로 확인·발행됩니다`);
      return back(res, t, "&va=1");
    }
    if (p.status !== "DONE") throw new Error("결제가 완료되지 않았습니다");
    await markPaid(o, p, paymentKey);
    return back(res, t, "&paid=1");
  } catch (e) {
    // 관리자 화면에서 원인을 볼 수 있게 마지막 결제 오류를 남김 (카드번호 등은 없음)
    await sb(`report_orders?token=eq.${t}&status=eq.requested`, { method: "PATCH", body: { report_err: `결제 승인 실패 ${new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}: ${String(e.code ? `[${e.code}] ` : "")}${String(e.message || "").slice(0, 200)}` }, prefer: "return=minimal" }).catch(() => {});
    return back(res, t, "&payerr=" + encodeURIComponent(e.message || "결제 승인에 실패했습니다"));
  }
}
