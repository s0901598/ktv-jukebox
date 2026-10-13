// 暫時的診斷模式:大螢幕網址加 &debug=1 時,把畫面尺寸、轉向等數字記到 parties/{code}/debug,查完就刪掉
const code = new URLSearchParams(location.search).get("code") || "";
const pending = [];
let last = "";

function snapshot(event) {
  const vv = window.visualViewport;
  const body = document.body;
  const stage = document.getElementById("stage")?.getBoundingClientRect();
  return {
    event,
    t: new Date().toISOString(),
    ver: document.querySelector('link[href*="style.css"]')?.getAttribute("href") || "",
    ua: navigator.userAgent,
    inner: [innerWidth, innerHeight],
    outer: [outerWidth, outerHeight],
    client: [document.documentElement.clientWidth, document.documentElement.clientHeight],
    screen: [screen.width, screen.height],
    vv: vv ? [vv.width, vv.height, vv.offsetLeft, vv.offsetTop, vv.scale].map((n) => Math.round(n * 100) / 100) : null,
    winOrientation: typeof window.orientation === "number" ? window.orientation : "none",
    screenOrientation: screen.orientation ? `${screen.orientation.type} ${screen.orientation.angle}` : "none",
    coarse: matchMedia("(pointer: coarse)").matches,
    mqPortrait: matchMedia("(orientation: portrait)").matches,
    bodyClass: body?.className || "",
    bodyStyle: body?.getAttribute("style") || "",
    stage: stage ? [stage.left, stage.top, stage.width, stage.height].map(Math.round) : null,
  };
}

function record(event, extra) {
  const s = { ...snapshot(event), ...extra };
  const key = JSON.stringify({ ...s, t: "", event: "" });
  if (!extra && key === last) return; // 跟上一筆一樣就不記
  last = key;
  pending.push(s);
  flush();
}

let push = null;
async function flush() {
  if (!push) return;
  while (pending.length) await push(pending.shift()).catch(() => {});
}

// 錯誤要最早開始收,主程式出錯也記得到
addEventListener("error", (e) => record("error", { error: `${e.message} @${e.filename}:${e.lineno}` }));
addEventListener("unhandledrejection", (e) => record("error", { error: String(e.reason) }));

const later = (name) => () => { record(name); setTimeout(() => record(`${name}+500ms`), 500); setTimeout(() => record(`${name}+1500ms`), 1500); };
addEventListener("load", later("load"));
addEventListener("resize", later("resize"));
addEventListener("orientationchange", later("orientationchange"));
window.visualViewport?.addEventListener("resize", later("vv-resize"));
screen.orientation?.addEventListener?.("change", later("screen-orientation"));
setTimeout(() => record("start+3s"), 3000);

if (/^[0-9]{4}$/.test(code)) {
  const { db } = await import("./party.js");
  const d = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js");
  const list = d.ref(db, `parties/${code}/debug`);
  push = (s) => d.push(list, s);
  record("ready", { earlyErrors: (window.__dbgErrors || []).join(" | ") || "none" });
  flush();
}
