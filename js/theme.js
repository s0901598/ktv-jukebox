// 深淺色切換:預設跟手機系統設定,按 ☀️/🌙 可手動切換,每支手機各自記住
const KEY = "ktv-theme";
const media = matchMedia("(prefers-color-scheme: dark)");

const current = () => document.documentElement.dataset.theme || (media.matches ? "dark" : "light");

function refreshButtons() {
  const dark = current() === "dark";
  for (const b of document.querySelectorAll("[data-theme-toggle]")) {
    b.textContent = dark ? "☀️" : "🌙";
    b.title = dark ? "切換成淺色" : "切換成深色";
    b.setAttribute("aria-label", b.title);
  }
}

document.addEventListener("click", (e) => {
  if (!e.target.closest("[data-theme-toggle]")) return;
  const next = current() === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem(KEY, next); } catch (_) { /* 無痕模式存不了也沒關係 */ }
  refreshButtons();
});
media.addEventListener("change", refreshButtons);
refreshButtons();
