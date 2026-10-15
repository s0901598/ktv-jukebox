// 網頁自己畫的確認視窗,取代瀏覽器內建的 confirm(Chrome 內建視窗的按鈕要等約 1 秒才按得到)。
// 回傳 Promise:按「確定」= true,按「取消」或點旁邊空白處 = false
export function confirmDialog(message, { ok = "確定", cancel = "取消" } = {}) {
  return new Promise((resolve) => {
    const box = document.createElement("div");
    box.className = "dialog";
    box.innerHTML = `
      <div class="dialog-card" role="dialog" aria-modal="true">
        <p class="dialog-msg"></p>
        <div class="dialog-btns">
          <button class="btn secondary" type="button" data-ok="0"></button>
          <button class="btn danger" type="button" data-ok="1"></button>
        </div>
      </div>`;
    box.querySelector(".dialog-msg").textContent = message;
    box.querySelector('[data-ok="0"]').textContent = cancel;
    box.querySelector('[data-ok="1"]').textContent = ok;
    box.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-ok]");
      if (!btn && e.target !== box) return;
      box.remove();
      resolve(btn?.dataset.ok === "1");
    });
    document.body.appendChild(box);
  });
}
