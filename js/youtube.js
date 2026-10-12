// YouTube 搜尋:搜尋一次扣 100 點額度(每天約 100 次),所以
// 1. 搜過的關鍵字存在 Firebase,全派對共用,不重複扣額度
// 2. 額度用完時記在 Firebase,當天其他人就不再嘗試,直接提示改用貼連結
import { ref, get, set } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { db } from "./party.js";
import { youtubeApiKey } from "./config.js";

const API = "https://www.googleapis.com/youtube/v3";
const CACHE_MS = 7 * 24 * 60 * 60 * 1000;
const KARAOKE_WORDS = /ktv|伴唱|卡拉|karaoke|導唱|导唱|伴奏|消音|instrumental/i;

export class QuotaExceededError extends Error {
  constructor() { super("今天的搜尋次數用完了,請改用「到 YouTube 找」或貼連結點歌"); }
}

// 額度在美國太平洋時間午夜重置,用太平洋時間的日期判斷「今天」
const pacificDay = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });

// Firebase 的 key 不能有 . # $ [ ] /
const cacheKey = (q) => encodeURIComponent(q).replace(/\./g, "%2E").slice(0, 700);

export const normalize = (q) => q.trim().replace(/\s+/g, " ").toLowerCase();

export const isKaraoke = (title) => KARAOKE_WORDS.test(title);

// YouTube App / 網頁的搜尋連結,不消耗 API 額度
export const youtubeSearchUrl = (q) =>
  `https://www.youtube.com/results?search_query=${encodeURIComponent(`${q} KTV`)}`;

export async function searchSongs(query) {
  const q = normalize(query);
  const cacheRef = ref(db, `searchCache/${cacheKey(q)}`);

  const cached = (await get(cacheRef)).val();
  if (cached && Date.now() - cached.t < CACHE_MS) return cached.items || [];

  const quotaRef = ref(db, "quota/exhaustedDay");
  if ((await get(quotaRef)).val() === pacificDay()) throw new QuotaExceededError();

  const params = new URLSearchParams({
    part: "snippet",
    type: "video",
    videoEmbeddable: "true",   // 只要能嵌入播放的影片
    videoSyndicated: "true",
    maxResults: "15",
    regionCode: "TW",
    relevanceLanguage: "zh-Hant",
    q: `${q} KTV 伴唱`,
    key: youtubeApiKey,
  });
  const data = await callApi(`${API}/search?${params}`, quotaRef);

  let items = (data.items || []).map((it) => ({
    videoId: it.id.videoId,
    title: decodeEntities(it.snippet.title),
    channel: decodeEntities(it.snippet.channelTitle),
  }));

  // 補上影片長度(每次只扣 1 點)
  if (items.length) {
    const ids = items.map((i) => i.videoId).join(",");
    try {
      const detail = await callApi(`${API}/videos?part=contentDetails&id=${ids}&key=${youtubeApiKey}`, quotaRef);
      const durations = Object.fromEntries((detail.items || []).map((v) => [v.id, formatDuration(v.contentDetails.duration)]));
      items = items.map((i) => ({ ...i, duration: durations[i.videoId] || "" }));
    } catch (_) { /* 沒有長度也能點歌 */ }
  }

  // 伴唱版排前面,同類之間維持 YouTube 原本的相關性順序
  items = items
    .map((i) => ({ ...i, karaoke: isKaraoke(i.title) }))
    .sort((a, b) => b.karaoke - a.karaoke);

  set(cacheRef, { t: Date.now(), items }).catch(() => {});
  return items;
}

async function callApi(url, quotaRef) {
  const res = await fetch(url);
  const data = await res.json();
  if (data.error) {
    const reason = data.error.errors?.[0]?.reason || "";
    if (reason === "quotaExceeded" || reason === "dailyLimitExceeded") {
      set(quotaRef, pacificDay()).catch(() => {});
      throw new QuotaExceededError();
    }
    throw new Error("搜尋失敗,請稍後再試");
  }
  return data;
}

// ISO 8601 長度(PT4M13S)轉成 4:13
function formatDuration(iso) {
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return "";
  const [h, min, s] = [m[1], m[2], m[3]].map((x) => Number(x || 0));
  const ss = String(s).padStart(2, "0");
  return h ? `${h}:${String(min).padStart(2, "0")}:${ss}` : `${min}:${ss}`;
}

function decodeEntities(s) {
  const t = document.createElement("textarea");
  t.innerHTML = s;
  return t.value;
}
