// 派對資料存取:所有會改動播放清單的操作都用 transaction,30 人同時按也不會互相覆蓋。
// 資料結構 parties/{code} = { createdAt, lastActiveAt, paused, queue: [歌曲...] }
// queue[0] 是「正在播放」,queue[1] 是下一首,以此類推。
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getDatabase, ref, onValue, runTransaction, get, remove,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { firebaseConfig } from "./config.js";

const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);

const partyRef = (code) => ref(db, `parties/${code}`);

// Realtime Database 會把陣列存成物件,讀回來統一轉成陣列
export function toList(queue) {
  if (!queue) return [];
  return (Array.isArray(queue) ? queue : Object.values(queue)).filter(Boolean);
}

// 派對代碼:5 位數字(10000~99999,共 90,000 組)
export const CODE_RE = /^[0-9]{5}$/;

function randomCode() {
  return String(Math.floor(10000 + Math.random() * 90000));
}

function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// 最後活動(點歌、切歌、插播、刪歌、播完換歌)超過 12 小時的派對視為過期,代碼可以重新使用
const EXPIRE_MS = 12 * 60 * 60 * 1000;
const lastActive = (p) => p.lastActiveAt || p.createdAt || 0;
export const isExpired = (p) => Date.now() - lastActive(p) >= EXPIRE_MS;

export async function createParty() {
  for (let i = 0; i < 20; i++) {
    const code = randomCode();
    const result = await runTransaction(partyRef(code), (cur) => {
      if (cur && !isExpired(cur)) return; // 代碼使用中,放棄
      const now = Date.now();
      return { createdAt: now, lastActiveAt: now, paused: false, queue: [] };
    });
    if (result.committed) return code;
  }
  throw new Error("建立派對失敗,請再試一次");
}

// 加入前檢查:"ok" = 可以加入,"missing" = 找不到,"expired" = 已過期
export async function partyStatus(code) {
  if (!CODE_RE.test(code)) return "missing";
  const p = (await get(partyRef(code))).val();
  if (!p) return "missing";
  return isExpired(p) ? "expired" : "ok";
}

// 開著的頁面:派對過期,或代碼已經被新派對拿走(createdAt 不同),跳出提示後強制回首頁。
// 回傳 check(party),每次收到派對資料時呼叫;另外每分鐘、從背景切回來時也會自己檢查。
// 判定前先向伺服器重讀一次,避免手機剛醒來時用到舊的暫存資料而誤判
export function watchExpiry(code, getParty, beforeLeave = () => {}) {
  let createdAt = null;
  let busy = false;
  let ended = false;
  const stale = (p) => isExpired(p) || p.createdAt !== createdAt;

  async function check(p) {
    if (ended || busy || !p) return;
    if (createdAt === null) createdAt = p.createdAt;
    if (!stale(p)) return;
    busy = true;
    try {
      const fresh = (await get(partyRef(code))).val();
      if (!fresh || !stale(fresh)) return; // 派對被結束(另有畫面處理)或其實沒過期
    } catch (_) {
      return; // 連不上伺服器,下次再檢查
    } finally {
      busy = false;
    }
    ended = true;
    beforeLeave();
    alert("派對已超過 12 小時沒有活動,已自動結束");
    location.replace("./");
  }

  setInterval(() => check(getParty()), 60 * 1000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") check(getParty());
  });
  return check;
}

// 改派對資料的交易:先確定派對資料已載入再跑。資料還沒載入時交易會先在手機上把派對當成空的,
// 畫面會誤以為「派對已結束」;已載入過就直接用手機上的資料,不會多等。
async function partyTx(code, update) {
  await get(partyRef(code));
  return runTransaction(partyRef(code), update);
}

export function subscribe(code, callback) {
  return onValue(partyRef(code), (snap) => {
    const p = snap.val();
    callback(p ? { ...p, queue: toList(p.queue), history: toList(p.history) } : null);
  });
}

// 點歌:加到清單最後;next = true 是插播,排到「下一首」(queue[1])
// 回傳 position:0 = 馬上播放,1 = 下一首,2 = 再下一首…
export async function addSong(code, song, { next = false } = {}) {
  const item = { ...song, id: newId(), addedAt: Date.now() };
  let position = 0;
  const result = await partyTx(code, (p) => {
    if (!p) return p; // 尚未從伺服器載入,Firebase 會用最新資料重跑
    const queue = toList(p.queue);
    position = next ? Math.min(1, queue.length) : queue.length;
    queue.splice(position, 0, item);
    return { ...p, queue, lastActiveAt: Date.now() };
  });
  if (!result.committed || !result.snapshot.exists()) throw new Error("找不到這個派對");
  return { item, position };
}

// 以下操作都帶歌曲 ID:目標已經不在原位(別人先按了)就不動,30 人同時按也只會生效一次。

// 一首歌結束換下一首:播完、無法播放、切歌都走這裡,並記到「已播放」
// result:done = 唱完,skipped = 被切掉,unplayable = 無法播放
const HISTORY_MAX = 300;
export async function finishSong(code, songId, { result = "done", by = "", notice = "" } = {}) {
  return partyTx(code, (p) => {
    if (!p) return p;
    const queue = toList(p.queue);
    if (queue[0]?.id !== songId) return; // 已經換過了,不動
    const [done] = queue.splice(0, 1);
    const history = [...toList(p.history), { ...done, result, endedAt: Date.now(), ...(by ? { endedBy: by } : {}) }]
      .slice(-HISTORY_MAX);
    const next = { ...p, queue, history, paused: false, lastActiveAt: Date.now() };
    if (notice) next.notice = { text: notice.replace("{title}", done.title), at: Date.now() };
    return next;
  });
}

export const skipSong = (code, songId, by) =>
  finishSong(code, songId, { result: "skipped", by, notice: `${by} 切掉了「{title}」` });

// 已在排隊的歌插播到下一首
export async function moveToNext(code, songId) {
  return partyTx(code, (p) => {
    if (!p) return p;
    const queue = toList(p.queue);
    const i = queue.findIndex((s) => s.id === songId);
    if (i < 2) return; // 不在清單裡,或已經是正在播放/下一首
    queue.splice(1, 0, ...queue.splice(i, 1));
    return { ...p, queue, lastActiveAt: Date.now() };
  });
}

// 刪除清單中的歌(正在播放的那首請用 skipSong)
export async function removeSong(code, songId, by) {
  return partyTx(code, (p) => {
    if (!p) return p;
    const queue = toList(p.queue);
    const i = queue.findIndex((s) => s.id === songId);
    if (i < 1) return;
    const [done] = queue.splice(i, 1);
    return { ...p, queue, lastActiveAt: Date.now(), notice: { text: `${by} 刪除了「${done.title}」`, at: Date.now() } };
  });
}

// 結束派對:清單與已播放紀錄一起刪除,大家的點歌頁會顯示「派對已結束」
export function endParty(code) {
  return remove(partyRef(code));
}

export async function setPaused(code, paused) {
  return partyTx(code, (p) => {
    if (!p) return p;
    if (!toList(p.queue).length || !!p.paused === paused) return;
    return { ...p, paused };
  });
}

// 從各種 YouTube 網址取出影片 ID
export function parseYouTubeId(text) {
  const s = text.trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  try {
    const u = new URL(s);
    if (u.hostname === "youtu.be") return u.pathname.slice(1, 12) || null;
    if (u.hostname.endsWith("youtube.com")) {
      if (u.searchParams.get("v")) return u.searchParams.get("v").slice(0, 11);
      const m = u.pathname.match(/\/(shorts|embed|live)\/([\w-]{11})/);
      if (m) return m[2];
    }
  } catch (_) { /* 不是網址 */ }
  return null;
}

// 用 noembed 取得影片標題(不消耗 YouTube API 額度),失敗就用影片 ID 代替
export async function fetchTitle(videoId) {
  try {
    const res = await fetch(`https://noembed.com/embed?url=https://www.youtube.com/watch?v=${videoId}`);
    const data = await res.json();
    if (data.title) return data.title;
  } catch (_) { /* 忽略 */ }
  return `YouTube 影片 ${videoId}`;
}

// 加入網址:目前網站根目錄 + ?code=
export function joinUrl(code) {
  const base = location.href.replace(/[^/]*(\?.*)?$/, "");
  return `${base}?code=${code}`;
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
