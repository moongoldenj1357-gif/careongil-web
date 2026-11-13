// Supabase(PostgREST) 공용 호출 도구 — 서버에서만 사용 (비밀키)
export const SB_URL = (process.env.SUPABASE_URL ?? "").trim().replace(/\/+$/, "").replace(/\/rest\/v1$/, "");
export const SB_KEY = process.env.SUPABASE_SECRET_KEY ?? "";
const H = (x = {}) => ({ apikey: SB_KEY, ...(SB_KEY.startsWith("sb_") ? {} : { Authorization: `Bearer ${SB_KEY}` }), ...x });

// sb("table?select=...", { method, body, prefer })
export async function sb(path, { method = "GET", body, prefer, headers } = {}) {
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    method,
    headers: H({ ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(prefer ? { Prefer: prefer } : {}), ...headers }),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const t = await r.text();
  if (!r.ok) throw new Error(`DB ${r.status}: ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : [];
}
// 1,000줄씩 끝까지
export async function sbAll(path, max = 30000) {
  const out = [];
  for (let off = 0; off < max; off += 1000) {
    const d = await sb(`${path}&limit=1000&offset=${off}`);
    out.push(...d);
    if (d.length < 1000) break;
  }
  return out;
}
export const kvGet = async (k) => (await sb(`app_kv?select=v&k=eq.${encodeURIComponent(k)}`))[0]?.v ?? null;
export const kvSet = (k, v) => sb("app_kv?on_conflict=k", { method: "POST", body: { k, v, updated_at: new Date().toISOString() }, prefer: "resolution=merge-duplicates,return=minimal" });
