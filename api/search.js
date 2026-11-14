// 케어온길 검색 API — 누구나 쓰는 읽기 전용. 관리자 코드 필요 없음.
//  /api/search?mode=regions                                   → 시도·시군구 이름 표
//  /api/search?sido=41&sgg=110&kind=home&q=이름&sort=name&page=1 → 목록 (한 쪽 20곳)
//      kind는 쉼표로 여러 개 가능(home,daycare). sido 없이 쓰려면 q(이름 2글자 이상) 필요.
//      sort: name(이름순) | capacity(정원 큰 순) | new(최근 지정) | old(오래된 곳) | grade(평가 등급 순)
//  /api/search?id=기관기호:유형코드                           → 1곳 상세
//  /api/search?ids=기호:유형,기호:유형 (최대 5곳)              → 비교
//  /api/search?mode=stats&sido=41&sgg=110&kind=daycare          → 창업 참고용 지역 요약 (시도 전체 + 시군구별)
//  /api/search?mode=silver&sido=41&sgg=110&q=이름                → 실버타운·양로원 목록 (silver_facilities)
//  /api/search?mode=silver&ids=1,2,3                             → 실버타운·양로원 비교 (최대 5곳)
export const config = { maxDuration: 15 };
const SB_URL = (process.env.SUPABASE_URL ?? "").trim().replace(/\/+$/, "").replace(/\/rest\/v1$/, "");
const SB_KEY = process.env.SUPABASE_SECRET_KEY ?? "";
const H = (x = {}) => ({ apikey: SB_KEY, ...(SB_KEY.startsWith("sb_") ? {} : { Authorization: `Bearer ${SB_KEY}` }), ...x });

const KIND_NM = { home: "요양원", daycare: "주야간보호", short: "단기보호", visit_care: "방문요양", visit_bath: "방문목욕", visit_nurse: "방문간호", tool: "복지용구", other: "기타", unit: "치매전담실" };
const SORTS = { name: "name.asc", capacity: "capacity.desc.nullslast,name.asc", new: "designated.desc.nullslast,name.asc", old: "designated.asc.nullslast,name.asc", grade: "eval_grade.asc.nullslast,name.asc" };
const LIST_COLS = "sym,pttn,name,kind,sido_cd,sgg_cd,addr,tel,capacity,now_m,now_f,wait_m,wait_f,designated,homepage,detail_at,eval_grade,eval_year";
const DETAIL_COLS = `${LIST_COLS},addr_detail,post,parking,transport,list_seen,staff,rooms,nonpay,programs,extra_at`;
const PAGE = 20;
// 실버타운·양로원 (silver_facilities 표). 시·도 코드는 lib/ltc.js SIDOS와 같음 (12 = 전남광주통합특별시)
const SILVER_NM = { housing: "실버타운(노인복지주택)", yangro: "양로원(양로시설)", group: "노인공동생활가정" };
const SILVER_COLS = "id,kind,sido,sgg,name,addr,tel,capacity,current,staff,units_sale,units_rent,units_mixed_sale,units_mixed_rent,est_date,operator,homepage,price_status,price_deposit,price_source,price_checked_at,src,info";
const SIDO_FULL = { 11: ["서울특별시"], 26: ["부산광역시"], 27: ["대구광역시"], 28: ["인천광역시"], 30: ["대전광역시"], 31: ["울산광역시"], 36: ["세종특별자치시"],
  41: ["경기도"], 43: ["충청북도"], 44: ["충청남도"], 47: ["경상북도"], 48: ["경상남도"], 50: ["제주특별자치도"], 51: ["강원특별자치도", "강원도"], 52: ["전북특별자치도", "전라북도"],
  12: ["전남광주통합특별시", "광주광역시", "전라남도"] };

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

    // 1-2) 창업 참고용 지역 요약 (케어온길 비즈)
    if (q.mode === "stats") {
      const sido = /^\d{2}$/.test(q.sido || "") ? q.sido : null;
      const sgg = /^\d{3}$/.test(q.sgg || "") ? q.sgg : null;
      const kind = String(q.kind || "");
      if (!sido || !(kind in KIND_NM) || ["unit", "other", "tool"].includes(kind)) return res.status(400).json({ 오류: "시·도와 기관 종류를 골라 주시면 됩니다" });
      const rows = [];
      for (let off = 0; off < 20000; off += 1000) {
        const { data } = await sb(`ltc_insts?select=sgg_cd,capacity,now_m,now_f,wait_m,wait_f,eval_grade,designated,detail_at&sido_cd=eq.${sido}&kind=eq.${kind}&order=sym.asc,pttn.asc&limit=1000&offset=${off}`);
        rows.push(...data);
        if (data.length < 1000) break;
      }
      const since = new Date(Date.now() - 3 * 365.25 * 864e5).toISOString().slice(0, 10);
      const agg = (list) => {
        const o = { n: list.length, detail: 0, capacity: 0, now: 0, wait: 0, capN: 0, new3y: 0, grades: { A: 0, B: 0, C: 0, D: 0, E: 0, 없음: 0 } };
        for (const r of list) {
          if (r.detail_at) o.detail++;
          const now = sum(r.now_m, r.now_f), wait = sum(r.wait_m, r.wait_f);
          if (r.capacity != null && now != null) { o.capacity += r.capacity; o.now += now; o.capN++; }
          if (wait != null) o.wait += wait;
          if (r.designated && r.designated >= since) o.new3y++;
          o.grades[/^[A-E]$/.test(r.eval_grade || "") ? r.eval_grade : "없음"]++;
        }
        o.occ = o.capacity ? Math.round((o.now / o.capacity) * 1000) / 10 : null;
        o.vacancy = o.capacity ? Math.max(0, o.capacity - o.now) : null;
        return o;
      };
      // 고령 인구 (행정안전부 주민등록 인구, pop_sgg 표에서 가장 최근 달)
      const { data: pops } = await sb(`pop_sgg?select=sgg_cd,sgg_nm,ym,total,p65,p75,p80_89,p85,p90&sido_cd=eq.${sido}&order=ym.desc`).catch(() => ({ data: [] }));
      const popYm = pops[0]?.ym || null, pop = new Map();
      for (const x of pops) if (x.ym === popYm) pop.set(x.sgg_cd, x);
      const addPop = (o, list) => {
        if (!list.length) return o;
        const t = list.reduce((a, x) => ({ total: a.total + x.total, p65: a.p65 + x.p65, p75: a.p75 + x.p75, p80: a.p80 + x.p80_89 + x.p90, p85: a.p85 + x.p85 }), { total: 0, p65: 0, p75: 0, p80: 0, p85: 0 });
        o.pop = { ...t, ym: popYm, aged: t.total ? Math.round((t.p65 / t.total) * 1000) / 10 : null };
        if (t.p80) { o.capPer1k80 = o.capN ? Math.round((o.capacity / t.p80) * 10000) / 10 : (o.n === 0 ? 0 : null); o.instPer10k80 = Math.round((o.n / t.p80) * 100000) / 10; }
        return o;
      };
      const bySgg = new Map();
      for (const r of rows) { if (!bySgg.has(r.sgg_cd)) bySgg.set(r.sgg_cd, []); bySgg.get(r.sgg_cd).push(r); }
      res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=86400");
      // 인구는 있는데 기관이 없는 시·군·구도 표에 나오게 함 (진입 기회 확인용)
      for (const cd of pop.keys()) if (!bySgg.has(cd)) bySgg.set(cd, []);
      return res.status(200).json({ sido, sgg, kind, kind_nm: KIND_NM[kind], since, popYm,
        sidoStats: addPop(agg(rows), [...pop.values()]),
        sggStats: sgg ? addPop(agg(bySgg.get(sgg) || []), pop.has(sgg) ? [pop.get(sgg)] : []) : null,
        sggs: [...bySgg.entries()].map(([cd, l]) => ({ cd, nm: pop.get(cd)?.sgg_nm || null, ...addPop(agg(l), pop.has(cd) ? [pop.get(cd)] : []) })) });
    }

    // 1-3) 실버타운·양로원 (노인주거복지시설, 보건복지부 현황 + 가격 조사표)
    //   /api/search?mode=silver&sido=41&sgg=110&skind=housing&q=이름&sort=name
    if (q.mode === "silver") {
      const sido = /^\d{2}$/.test(q.sido || "") ? q.sido : null;
      const sgg = /^\d{3}$/.test(q.sgg || "") ? q.sgg : null;
      const name = String(q.q || "").replace(/[*,()%\\.:"'`;=&]/g, " ").trim().slice(0, 30);
      const sids = String(q.ids || "").split(",").filter((x) => /^\d{1,7}$/.test(x)).slice(0, 5);   // 비교용
      if (!sids.length && !sido && name.length < 2) return res.status(400).json({ 오류: "시·도를 고르시거나 시설 이름을 2글자 이상 넣어 주시면 됩니다" });
      const f = [`select=${SILVER_COLS}`];
      if (sids.length) f.push(`id=in.(${sids.join(",")})`);
      if (sido) {
        const nms = SIDO_FULL[sido]; if (!nms) return res.status(200).json({ total: 0, page: 1, pages: 1, rows: [] });
        f.push(`sido=in.(${nms.map((x) => `"${x}"`).join(",")})`);
        if (sgg) {
          const { data: g } = await sb(`sgg_names?select=sgg_nm&sido_cd=eq.${sido}&sgg_cd=eq.${sgg}&limit=1`);
          const nm = String(g[0]?.sgg_nm || "").replace(/[*,()%\\.:"'`;=&]/g, " ").trim();
          if (nm) f.push(`addr=ilike.${encodeURIComponent(`*${nm.replace(/\s+/g, "*")}*`)}`);
        }
      }
      const sk = String(q.skind || "").split(",").filter((k) => k in SILVER_NM);
      if (sk.length) f.push(`kind=in.(${sk.join(",")})`);
      if (name) f.push(`name=ilike.${encodeURIComponent(`*${name.replace(/\s+/g, "*")}*`)}`);
      // 실버타운(노인복지주택) 먼저, 그다음 양로원·공동생활가정
      f.push(`order=${q.sort === "capacity" ? "capacity.desc.nullslast,name.asc" : "name.asc"}`, "limit=300");
      const { data } = await sb(`silver_facilities?${f.join("&")}`);
      const RANK = { housing: 0, yangro: 1, group: 2 };
      if (q.sort !== "capacity") data.sort((a, b) => (RANK[a.kind] ?? 9) - (RANK[b.kind] ?? 9));
      const rows = data.map((r) => ({ ...r, id: `silver-${r.id}`, sid: r.id, silver: true, kind_nm: SILVER_NM[r.kind] || "노인주거복지시설",
        now: r.current, sale_type: r.kind !== "housing" ? null : (r.units_sale || r.units_mixed_sale) ? ((r.units_rent || r.units_mixed_rent) ? "분양·임대 혼합" : "분양형") : "임대형" }));
      res.setHeader("Cache-Control", "public, s-maxage=600, stale-while-revalidate=3600");
      return res.status(200).json({ total: rows.length, page: 1, pages: 1, rows });
    }

    // 2) 한 곳 또는 여러 곳(비교)
    if (q.id || q.ids) {
      const ids = String(q.id || q.ids).split(",").map(parseId).filter(Boolean).slice(0, 5);
      if (!ids.length) return res.status(400).json({ 오류: "기관 번호가 올바르지 않습니다" });
      const or = ids.map((x) => `and(sym.eq.${x.sym},pttn.eq.${x.pttn})`).join(",");
      const { data } = await sb(`ltc_insts?select=${DETAIL_COLS}&or=(${or})`);
      const rows = await addUnits(ids.map((x) => data.find((r) => r.sym === x.sym && r.pttn === x.pttn)).filter(Boolean).map(shape));
      res.setHeader("Cache-Control", "public, s-maxage=600, stale-while-revalidate=3600");
      if (q.id) {
        if (!rows[0]) return res.status(404).json({ 오류: "기관을 찾지 못했습니다" });
        // 평가 이력 (국민건강보험공단 정기·수시평가)
        const r = rows[0];
        const { data: ev } = await sb(`ltc_evals?select=round,etype,eval_date,grade,score,size,areas&sym=eq.${r.sym}&kind=eq.${r.kind}&order=eval_date.desc`).catch(() => ({ data: [] }));
        return res.status(200).json({ ...r, evals: ev });
      }
      return res.status(200).json({ rows });
    }

    // 3) 목록 검색
    const sido = /^\d{2}$/.test(q.sido || "") ? q.sido : null;
    const sgg = /^\d{3}$/.test(q.sgg || "") ? q.sgg : null;
    const name = String(q.q || "").replace(/[*,()%\\.:"'`;=&]/g, " ").trim().slice(0, 30);
    if (!sido && name.length < 2) return res.status(400).json({ 오류: "시·도를 고르시거나 기관 이름을 2글자 이상 넣어 주시면 됩니다" });
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
