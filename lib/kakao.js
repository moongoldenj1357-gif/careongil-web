// 카카오: (1) 관리자 카톡 '나에게 보내기' 알림  (2) 주소 → 좌표 변환
// 환경변수
//  KAKAO_REST_KEY        : 케어온길 앱의 REST API 키 (카카오 로그인 + 카카오톡 메시지)
//  KAKAO_CLIENT_SECRET   : (선택) 카카오 로그인 보안에서 Client Secret을 '사용함'으로 한 경우만
//  KAKAO_LOCAL_REST_KEY  : 주소 검색용 REST API 키 (카카오맵이 켜져 있는 AI Location Insight 앱). 없으면 KAKAO_REST_KEY 사용
import { kvGet, kvSet } from "./db.js";

const env = (k) => (process.env[k] || "").trim();
export const SITE = "https://www.careongil.kr";
export const REDIRECT = `${SITE}/api/admin`;

export function authUrl(state) {
  const q = new URLSearchParams({ client_id: env("KAKAO_REST_KEY"), redirect_uri: REDIRECT, response_type: "code", scope: "talk_message", state });
  return `https://kauth.kakao.com/oauth/authorize?${q}`;
}
async function tokenCall(params) {
  const body = new URLSearchParams({ client_id: env("KAKAO_REST_KEY"), ...(env("KAKAO_CLIENT_SECRET") ? { client_secret: env("KAKAO_CLIENT_SECRET") } : {}), ...params });
  const r = await fetch("https://kauth.kakao.com/oauth/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded;charset=utf-8" }, body });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`카카오 토큰 오류: ${j.error_description || j.error || r.status}`);
  return j;
}
const save = async (j, old = {}) => {
  const v = {
    access_token: j.access_token,
    expires_at: Date.now() + (j.expires_in || 0) * 1000 - 60000,
    refresh_token: j.refresh_token || old.refresh_token,
    refresh_expires_at: j.refresh_token_expires_in ? Date.now() + j.refresh_token_expires_in * 1000 : old.refresh_expires_at,
  };
  await kvSet("kakao_admin", v);
  return v;
};
export const connect = async (code) => save(await tokenCall({ grant_type: "authorization_code", redirect_uri: REDIRECT, code }));

export async function status() {
  const v = await kvGet("kakao_admin");
  if (!v?.refresh_token) return { connected: false };
  return { connected: true, refreshUntil: v.refresh_expires_at ? new Date(v.refresh_expires_at).toISOString().slice(0, 10) : null };
}
async function access() {
  let v = await kvGet("kakao_admin");
  if (!v?.refresh_token) throw new Error("카카오톡 알림이 아직 연결되지 않았습니다");
  if (!v.access_token || Date.now() > v.expires_at) v = await save(await tokenCall({ grant_type: "refresh_token", refresh_token: v.refresh_token }), v);
  return v.access_token;
}
// 나에게 보내기 (텍스트 + 버튼 1개)
export async function memo(text, url = `${SITE}/admin`, button = "관리자 화면 열기") {
  if (!env("KAKAO_REST_KEY")) throw new Error("KAKAO_REST_KEY 없음");
  const template = { object_type: "text", text: text.slice(0, 200), link: { web_url: url, mobile_web_url: url }, button_title: button };
  const r = await fetch("https://kapi.kakao.com/v2/api/talk/memo/default/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${await access()}`, "Content-Type": "application/x-www-form-urlencoded;charset=utf-8" },
    body: new URLSearchParams({ template_object: JSON.stringify(template) }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.result_code !== 0) throw new Error(`카카오톡 전송 실패: ${j.msg || r.status}`);
  return true;
}

// 주소 → 좌표 (카카오 로컬 API)
export async function geocode(addr) {
  const key = env("KAKAO_LOCAL_REST_KEY") || env("KAKAO_REST_KEY");
  if (!key || !addr) return null;
  const q = String(addr).replace(/\(.*?\)/g, " ").replace(/\s+/g, " ").trim();
  const r = await fetch(`https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(q)}&size=1`, { headers: { Authorization: `KakaoAK ${key}` } });
  if (!r.ok) {
    if (r.status === 401 || r.status === 403) throw new Error(`카카오 주소 검색 권한 오류(${r.status}) — KAKAO_LOCAL_REST_KEY 확인`);
    return null;
  }
  const d = (await r.json()).documents?.[0];
  return d ? { lat: +d.y, lng: +d.x } : null;
}
