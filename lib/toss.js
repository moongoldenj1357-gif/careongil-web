// 토스페이먼츠 결제위젯(v2) 서버 쪽: 결제 승인, 결제 취소(환불)
// 환경변수
//  TOSS_CLIENT_KEY : 결제위젯 연동 클라이언트 키 (test_gck_… / live_gck_…). 화면에 드러나도 되는 키
//  TOSS_SECRET_KEY : 결제위젯 연동 시크릿 키 (test_gsk_… / live_gsk_…). 서버에서만 사용, 절대 화면·채팅에 노출 금지
const env = (k) => (process.env[k] || "").trim();
export const clientKey = () => env("TOSS_CLIENT_KEY") || null;
export const ready = () => !!(env("TOSS_CLIENT_KEY") && env("TOSS_SECRET_KEY"));
export const isTest = () => env("TOSS_SECRET_KEY").startsWith("test_");
export const orderIdOf = (no) => `careongil-${no}`; // 토스 주문번호 (영문·숫자·-·_ 6~64자)

async function call(path, body, idem) {
  const r = await fetch(`https://api.tosspayments.com${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(env("TOSS_SECRET_KEY") + ":").toString("base64"),
      "Content-Type": "application/json",
      ...(idem ? { "Idempotency-Key": idem } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.message || `토스페이먼츠 오류 (${r.status})`); e.code = j.code; throw e; }
  return j;
}

// 결제 승인: 성공 주소로 돌아온 paymentKey·orderId·amount를 토스에 확인
export const confirm = (paymentKey, orderId, amount) => call("/v1/payments/confirm", { paymentKey, orderId, amount }, `confirm-${paymentKey}`.slice(0, 300));

// 결제 키로 결제 조회 (가상계좌 입금 알림을 받았을 때 진짜인지 토스에 다시 확인)
//  ※ 주문번호 조회는 결제위젯 키로는 안 되고 결제 키(paymentKey) 조회를 써야 함
export const getPayment = (paymentKey) => call(`/v1/payments/${encodeURIComponent(paymentKey)}`);

// 결제 취소(전액 환불)
export const cancel = (paymentKey, reason) => call(`/v1/payments/${encodeURIComponent(paymentKey)}/cancel`, { cancelReason: String(reason || "고객 요청").slice(0, 200) }, `cancel-${paymentKey}`);

// DB에 남길 결제 요약 (카드번호 등 민감정보는 남기지 않음)
export const summary = (p) => ({
  method: p.method || null, easyPay: p.easyPay?.provider || null, card: p.card?.issuerCode || null,
  approvedAt: p.approvedAt || null, receipt: p.receipt?.url || null, total: p.totalAmount ?? null, test: isTest(),
  // 가상계좌: 고객이 입금할 계좌 (회사 정산용 계좌가 아니라 이 주문 전용 임시 계좌)
  va: p.virtualAccount ? { bank: BANKS[p.virtualAccount.bankCode] || p.virtualAccount.bankCode, account: p.virtualAccount.accountNumber, due: p.virtualAccount.dueDate, holder: p.virtualAccount.customerName || null } : null,
});

// 토스 은행 코드 → 이름
export const BANKS = { "02": "산업은행", "03": "IBK기업은행", "06": "KB국민은행", "07": "수협은행", "11": "NH농협은행", "12": "단위농협", "20": "우리은행", "23": "SC제일은행", "27": "씨티은행", "31": "iM뱅크(대구)", "32": "부산은행", "34": "광주은행", "35": "제주은행", "37": "전북은행", "39": "경남은행", "45": "새마을금고", "48": "신협", "50": "저축은행", "54": "HSBC", "64": "산림조합", "71": "우체국", "81": "하나은행", "88": "신한은행", "89": "케이뱅크", "90": "카카오뱅크", "92": "토스뱅크" };
