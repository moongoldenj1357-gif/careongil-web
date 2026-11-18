// 결제가 끝난 주문 처리 (카드 승인 직후, 또는 가상계좌 입금 알림을 받았을 때 공통)
//  → 상태 '결제 완료' → 보고서 자동 발행 시도 → 관리자 카톡 알림
import { sb } from "./db.js";
import { buildReport, PRODUCTS, KIND_NM } from "./report.js";
import { memo } from "./kakao.js";
import * as toss from "./toss.js";

const won = (n) => Number(n).toLocaleString("ko-KR") + "원";
export const tell = (msg) => Promise.race([memo(msg), new Promise((r) => setTimeout(r, 4000))]).catch(() => {});

export async function markPaid(o, p, paymentKey) {
  const now = new Date().toISOString();
  // status=eq.requested 조건: 같은 주문을 두 번 처리하지 않도록
  const upd = await sb(`report_orders?no=eq.${o.no}&status=eq.requested`, { method: "PATCH", body: { status: "paid", pay_method: "toss", pay_key: paymentKey, paid_at: now, pay_info: toss.summary(p), receipt: { type: "card" } }, prefer: "return=representation" });
  if (!Array.isArray(upd) || !upd.length) return false;
  let issued = false;
  try {
    const report = await buildReport({ ...o, status: "paid" });
    await sb(`report_orders?no=eq.${o.no}`, { method: "PATCH", body: { status: "done", report, report_err: null, done_at: new Date().toISOString() }, prefer: "return=minimal" });
    issued = true;
  } catch (e) {
    await sb(`report_orders?no=eq.${o.no}`, { method: "PATCH", body: { report_err: String(e.message).slice(0, 300) }, prefer: "return=minimal" }).catch(() => {});
  }
  const how = p.method === "가상계좌" ? "가상계좌 입금" : p.easyPay?.provider ? `${p.easyPay.provider} 결제` : "카드 결제";
  await tell(`[케어온길] ${toss.isTest() ? "(테스트) " : ""}${how} 완료\n${o.no} · ${PRODUCTS[o.product]?.nm} · ${won(o.amount)}\n${o.region_nm} ${KIND_NM[o.kind] || ""}\n${issued ? "보고서 자동 발행 완료" : "⚠ 보고서 자동 발행 실패 → 관리자 화면에서 '보고서 발행'을 눌러 주세요"}`);
  return true;
}
