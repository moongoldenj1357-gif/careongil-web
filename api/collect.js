// 케어온길 수집기 — Supabase 자동 작업(pg_cron)이 주기적으로 부름. 한 번에 50초 안쪽만 일하고 다음 번에 이어서 함.
//  ?code=관리자코드&mode=list    → 전국 목록(모든 유형) 한 바퀴 (이어하기)
//  ?code=관리자코드&mode=detail  → 상세가 없거나 30일 지난 기관부터 채움 (하루 9,000번 안쪽)
//  ?code=관리자코드&mode=status  → 진행 상황
import { SIDOS, PRIORITY, STAY, listPage, detail } from "../lib/ltc.js";
export const config = { maxDuration: 60 };
const SB_URL = (process.env.SUPABASE_URL ?? "").trim().replace(/\/+$/, "").replace(/\/rest\/v1$/, "");
const SB_KEY = process.env.SUPABASE_SECRET_KEY ?? "";
const H = (x = {}) => ({ apikey: SB_KEY, "Content-Type": "application/json", ...(SB_KEY.startsWith("sb_") ? {} : { Authorization: `Bearer ${SB_KEY}` }), ...x });
async function sb(method, path, body, extra) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { method, headers: H(extra), body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); if (!r.ok) throw new Error(`DB ${r.status}: ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : null;
}
const getState = async (id) => ((await sb("GET", `collect_state?id=eq.${id}&select=val`))?.[0]?.val) || {};
const setState = (id, val) => sb("POST", "collect_state?on_conflict=id", [{ id, val, updated_at: new Date().toISOString() }], { Prefer: "resolution=merge-duplicates,return=minimal" });
const today = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const DAILY_DETAIL = Number(process.env.DETAIL_DAILY_CALLS || 9000);

export default async function handler(req, res) {
  const q = req.query || {};
  if (!process.env.ADMIN_CODE || q.code !== process.env.ADMIN_CODE) return res.status(403).json({ 오류: "관리자 코드가 필요해요" });
  if (!SB_URL || !SB_KEY) return res.status(500).json({ 오류: "SUPABASE_URL / SUPABASE_SECRET_KEY 환경변수가 없어요" });
  const t0 = Date.now(), left = () => 48000 - (Date.now() - t0);
  try {
    if (q.mode === "status") {
      const [L, D] = await Promise.all([getState("list"), getState("detail")]);
      const cnt = async (f) => { const r = await fetch(`${SB_URL}/rest/v1/ltc_insts?select=sym&${f}`, { method: "HEAD", headers: H({ Prefer: "count=exact", Range: "0-0" }) }); return Number((r.headers.get("content-range") || "/0").split("/")[1]); };
      const by = {}; for (const k of [...PRIORITY, "tool"]) by[k] = { 전체: await cnt(`kind=eq.${k}`), 상세완료: await cnt(`kind=eq.${k}&detail_at=not.is.null`), ...(STAY.includes(k) ? { 비급여등완료: await cnt(`kind=eq.${k}&extra_at=not.is.null`) } : {}) };
      return res.status(200).json({ 목록: L, 상세: D, 종류별: by });
    }
    if (q.mode === "list") {
      const st = await getState("list");
      if (st.day === today() && st.done) return res.status(200).json({ 목록: "오늘 이미 끝남", ...st });
      let s = st.day === today() ? st : { day: today(), i: 0, page: 1, got: 0, saved: 0, done: false };
      while (left() > 8000 && s.i < SIDOS.length) {
        const { total, rows } = await listPage(SIDOS[s.i], s.page);
        if (rows.length) await sb("POST", "ltc_insts?on_conflict=sym,pttn", rows, { Prefer: "resolution=merge-duplicates,return=minimal" });
        s.saved += rows.length; s.got = (s.got || 0) + rows.length;
        if (!rows.length || s.got >= total) { s.i++; s.page = 1; s.got = 0; } else s.page++;
      }
      if (s.i >= SIDOS.length) s.done = true;
      await setState("list", s);
      return res.status(200).json({ 목록: s.done ? "한 바퀴 끝" : "이어서 계속", ...s, 다음시도: SIDOS[s.i] || null });
    }
    if (q.mode === "detail") {
      let d = await getState("detail"); if (d.day !== today() || q.reset === "1") d = { day: today(), calls: 0, done: 0, errors: 0 };
      if (d.calls >= DAILY_DETAIL) return res.status(200).json({ 상세: "오늘 한도까지 했어요", ...d });
      const old = new Date(Date.now() - 30 * 864e5).toISOString();
      let worked = 0;
      for (const kind of PRIORITY) {
        while (left() > 10000 && d.calls < DAILY_DETAIL) {
          // 입소형은 인력·시설·비급여(extra_at)가 아직 없는 곳도 다시 받음
          const need = STAY.includes(kind) ? `or=(detail_at.is.null,detail_at.lt.${old},extra_at.is.null)` : `or=(detail_at.is.null,detail_at.lt.${old})`;
          const rows = await sb("GET", `ltc_insts?select=sym,pttn,kind&kind=eq.${kind}&${need}&order=detail_at.asc.nullsfirst&limit=3`);
          if (!rows.length) break;
          const outs = await Promise.all(rows.map(async (r) => {
            try { const x = await detail(r.sym, r.pttn, r.kind); d.calls += x.calls; return { ...r, ...x.row }; }
            catch (e) {
              d.errors++; d.calls += STAY.includes(r.kind) ? 4 : 2; d.lastErr = e.message.slice(0, 120);
              if (/오늘 호출 한도/.test(e.message)) d.calls = DAILY_DETAIL;
              // 실패한 곳은 내일 다시 받도록 (29일 전으로 표시)
              const back = new Date(Date.now() - 29 * 864e5).toISOString();
              return { ...r, detail_at: back, ...(STAY.includes(r.kind) ? { extra_at: back } : {}), detail_err: e.message.slice(0, 200) };
            }
          }));
          for (const o of outs) { const { sym, pttn, kind: _k, ...patch } = o; await sb("PATCH", `ltc_insts?sym=eq.${sym}&pttn=eq.${encodeURIComponent(pttn)}`, patch, { Prefer: "return=minimal" }); }
          d.done += outs.length; worked += outs.length;
        }
        if (left() <= 10000 || d.calls >= DAILY_DETAIL) break;
      }
      await setState("detail", d);
      return res.status(200).json({ 상세: worked ? "채우는 중" : "채울 기관 없음", 이번에: worked, ...d });
    }
    return res.status(400).json({ 오류: "mode=list | detail | status" });
  } catch (e) { return res.status(500).json({ 오류: e.message }); }
}
