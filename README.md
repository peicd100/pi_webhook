# Pi Webhook Notifier

**Pi 回合結束後的 metadata-only webhook 通知。** 不呼叫模型、不產生摘要、不傳送 prompt、回答、檔案內容或 provider credentials。

版本：`1.0.4`。Package 名稱 `pi-webhook-notifier`，GitHub repo 名稱 `pi_webhook`。

> **Discord 注意：目前會附加 `@everyone`，並允許 everyone mention。** 自動通知及手動 `/webhook-test` 都適用；user／role mentions 不允許。這是既有 1.0.4 行為，不是可切換的設定。

## 安裝

需求：Node.js 22.19 以上、Git、已安裝的 Pi。開發／整合驗證使用 `@earendil-works/pi-coding-agent@1.1.0`；其他版本需自行驗證。

```sh
pi install git:github.com/peicd100/pi_webhook
```

需要可重現版本時，改用固定 tag（兩者擇一）：

```sh
pi install git:github.com/peicd100/pi_webhook@v1.0.4
```

只保留一份 webhook package source，不要同時載入原 local copy 與 Git 安裝版本。Extensions 會以 Pi 的 OS 權限執行，安裝前應審閱來源。

安裝後重啟 Pi，或在**沒有工具執行、沒有排隊訊息**的 idle session 執行 `/reload`，接著：

```text
/webhook-status
/webhook-setup
```

`status` 應顯示 `loaded_version: "1.0.4"`。第一次安裝沒有 URL／key，不會發送通知；setup 先選擇格式（Discord → Slack → Generic），再於 masked dialog 輸入自己的 HTTPS URL。Discord 不詢問 Bearer key；Slack／Generic 可選填 key，最後明確確認啟用。**不要把 URL 或 key 放在聊天、slash-command arguments 或 repo。**

只有在你想要真正發送一則測試通知時，才執行 `/webhook-test`；Discord 會 mention everyone。安裝、unit tests 與安裝 smoke tests 不發送真正 webhook。

## 指令

| 指令 | 行為 |
| --- | --- |
| `/webhook` | 列出連字號指令；不接受空格子指令 |
| `/webhook-status` | 顯示 loaded version、endpoint hostname 與近期 receipts，不顯示 URL path／query／key |
| `/webhook-setup` | 先選格式（Discord 第一），再填 masked URL；Discord 跳過 key，其他格式可選填，最後確認啟用 |
| `/webhook-test` | 已設定且 enabled 時，真正 POST 一則「Pi 測試通知」；每次都有新 identity，Discord 會 @everyone |
| `/webhook-on`、`/webhook-off` | 啟用／停用共用 user configuration |
| `/webhook-events` | 選 completed-only、加 errors、或加 errors／cancellations |
| `/webhook-clear` | 互動確認後移除 URL／key，保留去重 receipts |

## 設定與隱私

設定在 package 外：`<agent-dir>/config/webhook-notifier/config.json`，去重 evidence 在同層 `events/`。升版、切換來源與移除 package 不應清除這些資料。使用另一個 agent directory 則是不同的設定／receipt namespace。

Key 與 URL 是本機**明文**，不是加密儲存。POSIX 目錄／檔案使用 0700／0600；Windows 的 chmod 不等於 NTFS ACL，請確保私人 store 只有必要帳號可讀寫，搬移或備份時保留 ACL。其他 trusted extensions、管理員與同帳號程式仍可能存取資料；masked dialog 不是 OS sandbox。

僅允許 public DNS HTTPS、port 443。拒絕 IP literal、private／reserved DNS addresses、internal hosts、URL user-info／fragments。所有 DNS answers 都驗證，選定 address 綁定到 request，保留原 TLS hostname 與 certificate verification。

- 不跟隨 redirects，不使用環境 proxy，不自動 retry，不記錄 response body。
- DNS＋POST 合計 deadline 為 8 秒。
- 可選 raw key 送成 `Authorization: Bearer <key>`；不要使用 model／provider key。
- Slack／Discord 的 token-in-URL webhook 通常不需要另一個 key。
- 不提供 arbitrary headers、key command、free-form template 或模型選擇目的地。

Generic payload 只有機械 metadata：

```json
{
  "schema_version": 1,
  "event": "pi.agent.settled",
  "notification_id": "deterministic-sha256",
  "status": "completed",
  "session_id": "...",
  "session_name": "...",
  "workspace": "directory-basename-only",
  "finished_at": "ISO8601",
  "elapsed_ms": 1200,
  "text": "Pi 完成 ..."
}
```

Session name 與 workspace basename 本身也可能敏感，請使用不敏感名稱。Slack 只送 `{text}`；Discord 送 `{content, allowed_mentions: {parse: ["everyone"]}}`。

## 通知與去重語意

自動通知只在 interactive Pi TUI 的 `agent_settled` 發送，不在 print／JSON／SDK／RPC 模式發送。不是 per-tool 通知，也不在 startup／resume／reload 回補歷史完成事件。若 worker 自己也以 interactive TUI 執行，請另行控制它的 package configuration；本插件不是 OS 層的 Main／worker 隔離器。

回合結束**不代表任務成功、測試通過或產物品質合格**。取消 race 的分類有 API 限制；缺少 matching persisted facts 時會抑制通知。通知 evidence 不觸發另一輪通知。

Identity 綁定 session-file namespace、session ID、terminal assistant entry ID 與 outcome。送出前先以 exclusive directory claim 持久保存；競爭程序或 reload 不會重送同一 identity。保留 claims／receipts，不自動刪除；偏向避免重複，而不是保證送達。

| Receipt state | 意義 |
| --- | --- |
| `ACCEPTED` | Endpoint 回覆 2xx；不保證使用者已看到 |
| `HTTP_REJECTED` | 收到非 2xx，不 retry |
| `FAILED_PRECHECK` | DNS／validation／pre-dispatch 失敗，沒有 POST |
| `UNKNOWN` | POST 後未確認結果，或 interrupted `SENDING`；**禁止盲目 retry** |
| `DUPLICATE_NO_RESEND` | 已有 claim，不再發送 |

`/webhook-test` 每次都是新的通知，不是 UNKNOWN 自動通知的 retry。Off／shutdown／reload 會 abort owned sends；已提交的 request 仍可能被 endpoint 接收。Generic receiver 可用 `X-Pi-Notification-Id` 做自己的 idempotency。

## 更新與移除

追蹤預設 branch 的安裝可手動更新：

```sh
pi update git:github.com/peicd100/pi_webhook
```

固定 tag 不會自動跳到新 tag；升版時使用新的 tag，確認只留一份 source。更新後 idle `/reload` 或重啟，再 `/webhook-status`。同一 process 的 implementation upgrade 要使用新的 versioned module path；詳見 [docs/RELEASING.md](docs/RELEASING.md)。

移除使用與安裝相同的來源：

```sh
pi remove git:github.com/peicd100/pi_webhook
# 或固定版本：
pi remove git:github.com/peicd100/pi_webhook@v1.0.4
```

然後 idle `/reload` 或重啟。單純更換 local／Git source 時，**不要執行 `/webhook-off`**，因為新舊版本共用同一設定；只移除舊 source 即可。真正要停用所有 webhook 時才 off。不要用歷史整份 settings backup 覆蓋後續無關設定。

## 本機開發與驗證

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run check:package
npm test
npm run test:install
```

Local development 可在此目錄執行 `pi install .`；這會修改個人 Pi settings。若只想測試，使用 disposable `test:install`，不要把 local development 與 Git source 同時載入。

Test host 預設由 devDependency 解析；也可設定 `PI_TEST_HOST` 為已安裝的 Pi coding-agent package directory（或 file URL）。不探查 personal home、不自動下載 SDK、不讀個人 auth。

Unit tests 使用 dummy credentials、mock DNS／HTTP 與 disposable stores。`test:install` 使用真正 Pi CLI，但 Git source 導向 disposable local repo，驗證 install／tag／list／load／branch update／remove、space／non-ASCII paths 與 store retention；不 push、不改個人 Pi 設定。

發布後可執行 `npm run test:remote` 驗證真正的 Public GitHub 安裝／更新／移除；需要 GitHub 網路，不呼叫 provider、不發送 webhook。失敗保留 fixture，成功清除。測試通過不等於 live endpoint delivery 已驗證。

## 授權狀態

目前 `private: true` 防止意外 npm publish，Git 安裝不受影響；`license: UNLICENSED` 表示尚未選擇一般開源授權。**Public repo 與可 Git 安裝不等於已授予一般修改／再散布權利。** 維護者須先確認來源與權利，再明確選擇授權。見 [LICENSE](LICENSE)、[NOTICE.md](NOTICE.md)。
