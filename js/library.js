// 歌庫:先查歌庫(不扣 YouTube 額度),查不到再搜 YouTube。
// 來源有兩個:
// 1. data/library.json — 事先整理好的經典歌單(tools/build_library.py 產生)
// 2. Firebase library/ — 有人點過的歌自動收進來
import { ref, get, update } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { db } from "./party.js";
import { normalize, isKaraoke } from "./youtube.js";

let cache = null;

export async function loadLibrary() {
  if (cache) return cache;
  const [curated, collected] = await Promise.all([
    fetch("data/library.json").then((r) => r.json()).catch(() => []),
    get(ref(db, "library")).then((s) => Object.values(s.val() || {})).catch(() => []),
  ]);
  const seen = new Set();
  cache = [...curated.map((s) => ({ ...s, curated: true })), ...collected]
    .filter((s) => s.videoId && !seen.has(s.videoId) && seen.add(s.videoId));
  return cache;
}

// 簡單的繁簡對照,讓「爱情」也找得到「愛情」
const SIMPLIFIED = { "爱": "愛", "里": "裡", "干": "乾", "梦": "夢", "见": "見", "别": "別", "温": "溫", "伤": "傷", "说": "說", "乐": "樂", "风": "風", "听": "聽", "难": "難", "过": "過", "双": "雙", "恋": "戀", "泪": "淚", "后": "後", "来": "來", "长": "長", "这": "這", "时": "時", "为": "為", "们": "們", "么": "麼", "飞": "飛", "凤": "鳳", "邓": "鄧", "丽": "麗", "叶": "葉", "陈": "陳", "张": "張", "刘": "劉", "黄": "黃", "伦": "倫", "杰": "傑" };
const fold = (s) => normalize(s).replace(/./g, (c) => SIMPLIFIED[c] || c).replace(/\s+/g, "");

export async function searchLibrary(query) {
  const terms = normalize(query).split(" ").map(fold).filter(Boolean);
  if (!terms.length) return [];
  const songs = await loadLibrary();
  return songs
    .filter((s) => {
      const hay = fold(`${s.artist || ""}${s.song || ""}${s.title}`);
      return terms.every((t) => hay.includes(t));
    })
    .map((s) => ({ ...s, fromLibrary: true }));
}

// 點歌時自動收進歌庫(同一支影片只存一次)
export function collect(song) {
  const entry = {
    videoId: song.videoId,
    title: song.title,
    channel: song.channel || "",
    duration: song.duration || "",
    karaoke: isKaraoke(song.title),
    addedAt: Date.now(),
  };
  if (cache && !cache.some((s) => s.videoId === song.videoId)) cache.push(entry);
  return update(ref(db, `library/${song.videoId}`), entry).catch(() => {});
}
