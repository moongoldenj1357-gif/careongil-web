// 케어온길 비즈 — 리포트 신청 (고객용)
//  POST /api/order                     → 신청 접수 (관리자 카톡 알림)
//  GET  /api/order?t=열쇠               → 신청 상태
//  GET  /api/order?t=열쇠&report=1      → 발행된 보고서 내용 (완료된 경우만)
//  POST /api/order {find:{no, phone}}   → 신청번호 + 휴대폰으로 열쇠 찾기
// 환경변수: BANK_INFO (예: "국민은행 000-00-0000 주식회사 벤투런"), LAUNCH_HALF (오픈 기념 반값 인원, 기본 20, 0이면 끔)
import crypto from "node:crypto";
import { sb, SB_URL, SB_KEY } from "../lib/db.js";
import { PRODUCTS, KIND_NM } from "../lib/report.js";
import { memo } from "../lib/kakao.js";

export const config = { maxDuration: 15 };
const won = (n) => Number(n).toLocaleString("ko-KR") + "원";
const digits = (s) => String(s || "").replace(/\D/g, "");
const clean = (s, n) => String(s ?? "").replace(/[<>\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, n);
const numOrNull = (x, lo, hi) => { if (x === "" || x == null) return null; const v = +x; return isFinite(v) && v >= lo && v <= hi ? v : null; };
const bank = () => (process.env.BANK_INFO || "").trim();

function pub(o) {
  return {
    no: o.no, product: o.product, product_nm: PRODUCTS[o.product]?.nm, amount: o.amount, status: o.status,
    region_nm: o.region_nm, kind_nm: KIND_NM[o.kind] || o.kind, created_at: o.created_at, done_at: o.done_at,
    depositor: depositor(o), bank: bank(), name: o.name.slice(0, 1) + "*".repeat(Math.max(1, o.name.length - 1)),
  };
}
const depositor = (o) => `${o.name.replace(/\s/g, "").slice(0, 4)}${o.no.slice(-4)}`;

export default async function handler(req, res) {
  if (!SB_URL || !SB_KEY) return res.status(500).json({ 오류: "서버 설정이 아직 끝나지 않았습니다" });
  res.setHeader("Cache-Control", "no-store");
  try {
    if (req.method === "GET") {
      const t = String(req.query.t || "");
      if (!/^[A-Za-z0-9_-]{20,64}$/.test(t)) return res.status(400).json({ 오류: "확인 주소가 올바르지 않습니다" });
      const [o] = await sb(`report_orders?select=*&token=eq.${t}`);
      if (!o) return res.status(404).json({ 오류: "신청을 찾지 못했습니다" });
      if (req.query.report) {
        if (o.status !== "done" || !o.report) return res.status(403).json({ 오류: "아직 발행되지 않았습니다" });
        return res.status(200).json(o.report);
      }
      return res.status(200).json(pub(o));
    }
    if (req.method !== "POST") return res.status(405).end();
    const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};

    // 신청번호 + 휴대폰으로 찾기
    if (b.find) {
      const no = clean(b.find.no, 12), ph = digits(b.find.phone);
      if (!/^\d{4}-\d{4}$/.test(no) || ph.length < 10) return res.status(400).json({ 오류: "신청번호와 휴대폰 번호를 확인해 주세요" });
      const [o] = await sb(`report_orders?select=token,phone&no=eq.${no}`);
      if (!o || o.phone !== ph) return res.status(404).json({ 오류: "일치하는 신청이 없습니다" });
      return res.status(200).json({ t: o.token });
    }

    // 신청 접수
    if (b.hp) return res.status(200).json({ ok: true }); // 자동 등록 차단용 숨은 칸
    const product = String(b.product || "");
    if (!PRODUCTS[product]) return res.status(400).json({ 오류: "상품을 골라 주세요" });
    const sido = String(b.sido || ""), sgg = String(b.sgg || ""), kind = String(b.kind || "");
    if (!/^\d{2}$/.test(sido) || !/^\d{3}$/.test(sgg)) return res.status(400).json({ 오류: "시·군·구까지 골라 주세요" });
    if (!KIND_NM[kind]) return res.status(400).json({ 오류: "기관 종류를 골라 주세요" });
    const name = clean(b.name, 20), phone = digits(b.phone), email = clean(b.email, 80) || null;
    if (name.length < 2) return res.status(400).json({ 오류: "성함(입금자명)을 적어 주세요" });
    if (!/^01\d{8,9}$/.test(phone)) return res.status(400).json({ 오류: "휴대폰 번호를 확인해 주세요" });
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ 오류: "이메일 형식을 확인해 주세요" });
    if (!b.agree) return res.status(400).json({ 오류: "개인정보 수집·이용에 동의해 주셔야 신청할 수 있습니다" });
    if (!b.agreeRefund) return res.status(400).json({ 오류: "환불 규정을 확인해 주세요" });

    const [region] = await sb(`sgg_names?select=sido_nm,sgg_nm&sido_cd=eq.${sido}&sgg_cd=eq.${sgg}`);
    if (!region) return res.status(400).json({ 오류: "지역을 다시 골라 주세요" });

    // 맞춤형 조건
    let inputs = {};
    if (product === "custom") {
      const i = b.inputs || {};
      inputs = {
        cap: numOrNull(i.cap, 1, 300), rent: numOrNull(i.rent, 0, 100000), labor: numOrNull(i.labor, 0, 1000000),
        other: numOrNull(i.other, 0, 1000000), deposit: numOrNull(i.deposit, 0, 10000000), invest: numOrNull(i.invest, 0, 10000000),
        days: kind === "daycare" ? numOrNull(i.days, 15, 31) : null, addr: clean(i.addr, 100) || null,
      };
      if (!inputs.cap) return res.status(400).json({ 오류: "정원을 적어 주세요" });
      if (inputs.rent == null) return res.status(400).json({ 오류: "월 임대료를 적어 주세요 (자가라면 0)" });
    }

    // 증빙
    const rt = ["none", "cash", "tax"].includes(b.receipt?.type) ? b.receipt.type : "none";
    const rno = digits(b.receipt?.no);
    if (rt === "cash" && !(rno.length === 10 || /^01\d{8,9}$/.test(rno))) return res.status(400).json({ 오류: "현금영수증 번호(휴대폰 또는 사업자번호)를 확인해 주세요" });
    if (rt === "tax" && (rno.length !== 10 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(b.receipt?.email || "")))) return res.status(400).json({ 오류: "세금계산서용 사업자등록번호(10자리)와 이메일을 확인해 주세요" });
    const receipt = rt === "none" ? { type: "none" } : { type: rt, no: rno, ...(rt === "tax" ? { email: clean(b.receipt.email, 80), corp: clean(b.receipt.corp, 40) } : {}) };

    // 같은 번호로 입금 전 신청이 너무 많으면 막음
    const pend = await sb(`report_orders?select=no&phone=eq.${phone}&status=eq.requested`);
    if (pend.length >= 3) return res.status(429).json({ 오류: "입금 전 신청이 3건 있습니다. 기존 신청을 먼저 마무리해 주세요" });

    // 가격 (오픈 기념 반값)
    const half = Math.max(0, parseInt(process.env.LAUNCH_HALF ?? "20", 10) || 0);
    let amount = PRODUCTS[product].price;
    if (half) {
      const used = await sb(`report_orders?select=no&status=eq.done&limit=${half}`);
      if (used.length < half) amount = Math.round(amount / 2 / 100) * 100;
    }

    const ym = new Date(Date.now() + 9 * 3600e3).toISOString().slice(2, 7).replace("-", "");
    let o;
    for (let k = 0; k < 5 && !o; k++) {
      const row = { no: `${ym}-${String(crypto.randomInt(0, 10000)).padStart(4, "0")}`, token: crypto.randomBytes(24).toString("base64url"), product, amount,
        sido_cd: sido, sgg_cd: sgg, kind, region_nm: `${region.sido_nm} ${region.sgg_nm}`, inputs, name, phone, email, receipt };
      o = await sb("report_orders", { method: "POST", body: row, prefer: "return=representation" }).then((d) => d[0]).catch((e) => { if (!/duplicate|23505/.test(e.message)) throw e; return null; });
    }
    if (!o) throw new Error("신청번호를 만들지 못했습니다. 다시 시도해 주세요");

    // 관리자 카톡 알림 (실패해도 신청은 접수됨)
    await Promise.race([
      memo(`[케어온길] 새 리포트 신청\n${o.no} · ${PRODUCTS[product].nm}\n${o.region_nm} ${KIND_NM[kind]}\n입금 끝자리 ${o.no.slice(-4)} · ${won(amount)}`),
      new Promise((r) => setTimeout(r, 4000)),
    ]).catch(() => {});

    return res.status(200).json({ ...pub(o), t: o.token });
  } catch (e) {
    return res.status(500).json({ 오류: e.message });
  }
}
