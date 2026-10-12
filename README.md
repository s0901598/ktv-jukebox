# 🎤 KTV 點唱機

家族聚會用的 KTV 點唱機。一支手機接投影機當大螢幕，其他人用手機輸入派對代碼點歌。

- 網址:https://s0901598.github.io/ktv-jukebox/
- 技術:GitHub Pages(純前端)+ Firebase Realtime Database(即時同步)
- 需求規格:見 [PROMPT.md](PROMPT.md)

## 檔案

| 檔案 | 用途 |
|---|---|
| `index.html` | 首頁:輸入代碼加入 / 建立派對 |
| `remote.html` | 點歌端(手機直式) |
| `screen.html` | 大螢幕(橫版 16:9,接投影機) |
| `js/party.js` | 派對資料存取(transaction 防多人同時操作衝突) |
| `js/config.js` | Firebase 設定 |
| `database.rules.json` | 資料庫存取規則(`npx firebase-tools deploy --only database` 部署) |

## 進度

- [x] 階段 1:建立派對、代碼加入、貼連結點歌、清單即時同步
- [x] 階段 2:大螢幕播放(自動接續、防休眠、全螢幕、無法播放自動跳過並通知)
- [x] 階段 3:YouTube 搜尋(伴唱版優先)+ 全派對共用快取 + 額度用完處理 + 「到 YouTube 找」
- [x] 歌庫:126 首(國語 73、台語 53,含 23 首對唱),先查歌庫再搜 YouTube,點過的歌自動收錄;顯示演唱者與對唱標籤
- [x] 階段 4:插播、切歌、刪除、暫停 + 多人同時操作防呆;點歌頁底部分頁「點歌｜播放中」
- [ ] 階段 5:上線檢查清單
