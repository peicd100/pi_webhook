# Pi Webhook 通知

版本：`1.1.1`；套件 `pi-webhook-notifier`；儲存庫 `peicd100/pi_webhook`。

Pi 回合完全結束後傳送必要通知資訊，不附對話、回答或檔案內容。支援 Discord、Slack 與一般 JSON；持久防重送，不自動重試。

## 安裝

需要 Node.js 22.19 以上、Git、Pi。整合驗證基準為 Pi 1.1.0。

```sh
pi install git:github.com/peicd100/pi_webhook@v1.1.1
```

或追蹤最新分支：

```sh
pi install git:github.com/peicd100/pi_webhook
pi update git:github.com/peicd100/pi_webhook
```

不要與相同本機來源重複安裝；固定標籤不自動跳版本。安裝後重新啟動，或等工具與佇列完成再 `/reload`。

## 中文指令與設定

| 指令 | 用途 |
|---|---|
| `/webhook` | 列出指令與用法 |
| `/webhook-status` | 中文顯示總開關、預設、此對話與最近結果 |
| `/webhook-status json` | 原始技術欄位，不改 JSON 識別碼 |
| `/webhook-setup` | 先選格式，再遮蔽輸入端點與非必要金鑰 |
| `/webhook-test` | 明確傳送一則真正測試通知 |
| `/webhook-on`、`/webhook-off` | 全域總開關，不修改對話選擇 |
| `/webhook-default [on\|off]` | 選擇新對話預設；尚未設定端點也可保存 |
| `/webhook-session [on\|off\|default]` | 保存此對話的選擇 |
| `/webhook-events` | 選擇完成／錯誤／取消等通知事件 |
| `/webhook-clear` | 確認刪除端點與金鑰，保留偏好與收據 |

初始新對話預設 **關閉**。完成設定只啟用全域總開關；要讓此對話通知，使用 `/webhook-session on`。Discord 只需端點；Slack／一般 JSON 可選填 Bearer 金鑰。

不要把秘密放在指令參數、聊天、設定範例或 Git。網址／金鑰只在遮蔽視窗輸入；取消不保存。測試需你明確執行，**Discord 會 `@everyone`**。

## 開關與對話記憶

- 全域總開關控制是否允許送出；關閉時連明確測試也阻擋。
- 新對話預設只影響新對話，既有選擇不變。
- 每個對話在啟動時凍結自己的預設；`on`／`off` 保存明確選擇。
- `/webhook-session default` 明確採用「當下」全域預設並凍結；之後全域改動不持續修改此對話。
- 恢復／重新載入／分支切換／複製遵循所選分支的非上下文自訂紀錄，不依賴模型記憶。
- 升版遇到已有使用者／模型紀錄但沒有偏好的舊對話，首次 TUI 載入保留當時總開關意圖；不強制套新關閉預設。
- 無會話保存或尚未保存的空對話不能保證跨程式恢復。

自動通知需同時：端點已設定、總開關開啟、此對話開啟、事件允許，以及新產生的 TUI 完全結束回合。SDK／列印／RPC／子工作不自動通知；指令可明確操作。

偏好操作需要閒置與佇列清空；切換對話／取消不保存。明確測試可越過此對話關閉，但不能越過全域關閉。開關變更不補送歷史通知。

## 安全與送出結果

端點只允許公開 DNS 名稱的 HTTPS／443。拒絕 IP、內部網域、私人／保留位址、重新導向與無效 TLS；送出時重新核對 DNS 並固定已驗證位址。這是風險限制，不是完整作業系統沙盒。

以會話／最後回覆／結果建立持久識別碼，跨程式獨占取得一次送出權。逾時或未確認接受顯示「未知」，不盲目重送；HTTP 成功只是端點接受，不保證裝置收到。清除端點不清收據。

關閉、清除、分支切換與結束會取消本次插件持有的待送請求；已提交的請求仍可能送達。

通知只有工作區檔名、會話名稱／識別碼、結果、時間等資訊。會話名稱可能包含私人文字，請自行使用適合傳至端點的名稱。Discord 保留 `@everyone`；所有格式附送出機器的本地時間與 UTC 偏移，非對話開始時間。

## 保存、更新與移除

檔案位於套件外的 `<agent-dir>/config/webhook-notifier/`：

- `config.json`：端點、金鑰、總開關與事件。
- `preferences.json`：新對話預設。
- `events/`：持久收據，不能以刪除方式重試未知結果。

不得提交真實設定。POSIX 權限受限；Windows 的 chmod 不代表 ACL 證明，私人目錄仍應由使用者權限保護。更新不搬移／清除設定與收據；舊版本核心保持原檔，現行入口使用新版本路徑，避免快取模組復活。

```sh
pi remove git:github.com/peicd100/pi_webhook
```

移除不刪除保存資料；閒置重新載入或重啟以停止載入。

```sh
npm ci --ignore-scripts
npm run check:package
npm test
npm run test:install
npm run test:remote
```

測試只使用隔離目錄與模擬 DNS／HTTPS，不送真實通知或呼叫模型。公開安裝需網路。發布流程見 `docs/RELEASING.md`。

目前 `UNLICENSED`；公開可安裝不等於一般開源授權。來源與第三方說明見 `NOTICE.md`。
