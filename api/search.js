// 케어온길 검색 API — 누구나 쓰는 읽기 전용. 관리자 코드 필요 없음.
//  /api/search?mode=regions                                   → 시도·시군구 이름 표
//  /api/search?sido=41&sgg=110&kind=home&q=이름&sort=name&page=1 → 목록 (한 쪽 20곳)
//      kind는 쉼표로 여러 개 가능(home,daycare). sido 없이 쓰려면 q(이름 2글자 이상) 필요.
//      sort: name(이름순) | capacity(정원 큰 순) | new(최근 지정) | old(오래된 곳)
//  /api/search?id=기관기호:유형코드                           → 1곳 상세
//  /api/search?ids=기호:유형,기호:유형 (최대 5곳)              → 비교
export const config = { maxDuration: 15 };
const SB_URL = (process.env.SUPABASE_URL ?? "").trim().replace(/\/+$/, "").replace(/\/rest\/v1$/, "");
const SB_KEY = process.env.SUPABASE_SECRET_KEY ?? "";
const H = (x = {}) => ({ apikey: SB_KEY, ...(SB_KEY.startsWith("sb_") ? {} : { Authorization: `Bearer ${SB_KEY}` }), ...x });

const KIND_NM = { home: "요양원", daycare: "주야간보호", short: "단기보호", visit_care: "방문요양", visit_bath: "방문목욕", visit_nurse: "방문간호", tool: "복지용구", other: "기타", unit: "치매전담실" };
const SORTS = { name: "name.asc", capacity: "capacity.desc.nullslast,name.asc", new: "designated.desc.nullslast,name.asc", old: "designated.asc.nullslast,name.asc" };
const LIST_COLS = "sym,pttn,name,kind,sido_cd,sgg_cd,addr,tel,capacity,now_m,now_f,wait_m,wait_f,designated,homepage,detail_at";
const DETAIL_COLS = `${LIST_COLS},addr_detail,post,parking,transport,list_seen,staff,rooms,nonpay,programs,extra_at`;
const PAGE = 20;

const sub = (p) => {
  const c = String(p || "").toUpperCase();
  if (c === "A04") return "공동생활가정";
  if (c === "S41") return "치매전담형 공동생활가정";
  if (c === "A05") return "단기보호 전환";
  return null;
};
// 홈페이지 칸에 "없음" 같은 글자가 들어온 경우 걸러냄
const site = (u) => { const h = String(u || "").replace(/^https?:\/\//i, "").trim(); return /\.[a-z가-힣]{2,}/i.test(h) ? u : null; };
const sum = (a, b) => (a == null && b == null ? null : (a || 0) + (b || 0));
// 화면에서 바로 쓰도록 숫자를 정리
function shape(r) {
  const now = sum(r.now_m, r.now_f), wait = sum(r.wait_m, r.wait_f);
  const st = r.staff || null, rm = r.rooms || null;
  return { ...r, homepage: site(r.homepage), id: `${r.sym}:${r.pttn}`, kind_nm: KIND_NM[r.kind] || "기타", sub_nm: sub(r.pttn), now, wait,
    vacancy: r.capacity != null && now != null ? Math.max(0, r.capacity - now) : null, has_detail: !!r.detail_at,
    // 비교표용 요약
    ...(st ? { care_workers: st.요양보호사 ?? null, nurses: (st.간호사 || 0) + (st.간호조무사 || 0) } : {}),
    ...(rm ? { beds: ["1인실", "2인실", "3인실", "4인실"].map((k) => `${k} ${rm[k] || 0}`).join(" · ") } : {}),
    ...(Array.isArray(r.nonpay) ? { food: r.nonpay.find((x) => x.종류 === "식재료비") || null } : {}) };
}
async function sb(path, extra) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, { headers: H(extra) });
  const t = await r.text();
  if (!r.ok) throw new Error(`DB ${r.status}: ${t.slice(0, 200)}`);
  return { data: t ? JSON.parse(t) : [], range: r.headers.get("content-range") };
}
// 같은 기관기호의 치매전담실(G·M = 요양원, H·I = 주야간보호)을 세어 본 기관에 붙임
async function addUnits(rows) {
  const syms = [...new Set(rows.filter((r) => r.kind === "home" || r.kind === "daycare").map((r) => r.sym))];
  if (!syms.length) return rows;
  const { data } = await sb(`ltc_insts?select=sym,pttn&kind=eq.unit&sym=in.(${syms.join(",")})`);
  for (const r of rows) {
    const pre = r.kind === "home" ? /^[GM]/ : /^[HI]/;
    const n = data.filter((u) => u.sym === r.sym && pre.test(u.pttn)).length;
    if (n) r.dementia_units = n;
  }
  return rows;
}
const ID = /^(\d{5,15}):([A-Z]\d{2})$/;
const parseId = (s) => { const m = String(s || "").trim().toUpperCase().match(ID); return m ? { sym: m[1], pttn: m[2] } : null; };

export default async function handler(req, res) {
  if (!SB_URL || !SB_KEY) return res.status(500).json({ 오류: "SUPABASE_URL / SUPABASE_SECRET_KEY 환경변수가 없어요" });
  const q = req.query || {};
  try {
    // 1) 지역 이름 표
    if (q.mode === "regions") {
      const { data } = await sb("sgg_names?select=sido_cd,sgg_cd,sido_nm,sgg_nm,n&order=sido_cd,sgg_nm");
      const by = new Map();
      for (const r of data) {
        if (!by.has(r.sido_cd)) by.set(r.sido_cd, { cd: r.sido_cd, nm: r.sido_nm, sggs: [] });
        if (r.sgg_nm && r.sgg_nm !== r.sido_nm) by.get(r.sido_cd).sggs.push({ cd: r.sgg_cd, nm: r.sgg_nm, n: r.n });
      }
      res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=86400");
      return res.status(200).json({ sidos: [...by.values()].sort((a, b) => a.cd.localeCompare(b.cd)), kinds: KIND_NM });
    }

    // 2) 한 곳 또는 여러 곳(비교)
    if (q.id || q.ids) {
      const ids = String(q.id || q.ids).split(",").map(parseId).filter(Boolean).slice(0, 5);
      if (!ids.length) return res.status(400).json({ 오류: "기관 번호가 올바르지 않아요" });
      const or = ids.map((x) => `and(sym.eq.${x.sym},pttn.eq.${x.pttn})`).join(",");
      const { data } = await sb(`ltc_insts?select=${DETAIL_COLS}&or=(${or})`);
      const rows = await addUnits(ids.map((x) => data.find((r) => r.sym === x.sym && r.pttn === x.pttn)).filter(Boolean).map(shape));
      res.setHeader("Cache-Control", "public, s-maxage=600, stale-while-revalidate=3600");
      if (q.id) return rows[0] ? res.status(200).json(rows[0]) : res.status(404).json({ 오류: "기관을 찾지 못했어요" });
      return res.status(200).json({ rows });
    }

    // 3) 목록 검색
    const sido = /^\d{2}$/.test(q.sido || "") ? q.sido : null;
    const sgg = /^\d{3}$/.test(q.sgg || "") ? q.sgg : null;
    const name = String(q.q || "").replace(/[*,()%\\.:"'`;=&]/g, " ").trim().slice(0, 30);
    if (!sido && name.length < 2) return res.status(400).json({ 오류: "지역(시도)을 고르거나 이름을 2글자 이상 넣어 주세요" });
    const kinds = String(q.kind || "").split(",").map((k) => k.trim()).filter((k) => k in KIND_NM);
    const page = Math.min(Math.max(parseInt(q.page, 10) || 1, 1), 500);
    const f = [`select=${LIST_COLS}`];
    if (sido) f.push(`sido_cd=eq.${sido}`);
    if (sido && sgg) f.push(`sgg_cd=eq.${sgg}`);
    if (kinds.length === 1) f.push(`kind=eq.${kinds[0]}`);
    else if (kinds.length > 1) f.push(`kind=in.(${kinds.join(",")})`);
    if (name) f.push(`name=ilike.${encodeURIComponent(`*${name.replace(/\s+/g, "*")}*`)}`);
    f.push(`order=${SORTS[q.sort] || SORTS.name}`, `limit=${PAGE}`, `offset=${(page - 1) * PAGE}`);
    const { data, range } = await sb(`ltc_insts?${f.join("&")}`, { Prefer: "count=exact" });
    const total = Number(String(range || "").split("/")[1]) || data.length;
    res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=1800");
    return res.status(200).json({ total, page, pages: Math.max(1, Math.ceil(total / PAGE)), rows: await addUnits(data.map(shape)) });
  } catch (e) {
    return res.status(500).json({ 오류: e.message });
  }
}
