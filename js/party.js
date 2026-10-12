// 派對資料存取:所有會改動播放清單的操作都用 transaction,30 人同時按也不會互相覆蓋。
// 資料結構 parties/{code} = { createdAt, paused, queue: [歌曲...] }
// queue[0] 是「正在播放」,queue[1] 是下一首,以此類推。
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getDatabase, ref, onValue, runTransaction, get,
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

function randomCode() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// 超過 24 小時的派對視為過期,代碼可以重新使用
const EXPIRE_MS = 24 * 60 * 60 * 1000;

export async function createParty() {
  for (let i = 0; i < 20; i++) {
    const code = randomCode();
    const result = await runTransaction(partyRef(code), (cur) => {
      if (cur && Date.now() - (cur.createdAt || 0) < EXPIRE_MS) return; // 代碼使用中,放棄
      return { createdAt: Date.now(), paused: false, queue: [] };
    });
    if (result.committed) return code;
  }
  throw new Error("建立派對失敗,請再試一次");
}

export async function partyExists(code) {
  if (!/^[0-9]{4}$/.test(code)) return false;
  const snap = await get(partyRef(code));
  return snap.exists();
}

export function subscribe(code, callback) {
  return onValue(partyRef(code), (snap) => {
    const p = snap.val();
    callback(p ? { ...p, queue: toList(p.queue) } : null);
  });
}

// 點歌:加到清單最後
export async function addSong(code, song) {
  const item = { ...song, id: newId(), addedAt: Date.now() };
  const result = await runTransaction(partyRef(code), (p) => {
    if (!p) return p; // 尚未從伺服器載入,Firebase 會用最新資料重跑
    const queue = toList(p.queue);
    queue.push(item);
    return { ...p, queue };
  });
  if (!result.committed || !result.snapshot.exists()) throw new Error("找不到這個派對");
  return item;
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
