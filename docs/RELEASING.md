# 發布流程

目前版本 1.1.1，儲存庫 peicd100/pi_webhook。只發布必要的已驗證檔案；不發布個人設定、金鑰、對話、記憶、依賴目錄、暫存或大型產物。

1. 核對 worktree，保留使用者既有修改；不要直接把所有變更帶入提交。
2. 版本、入口、相容轉接、新版本模組與文件一致；不得修改舊公開標籤或舊版本核心。
3. 執行 npm test、npm run check:package、npm run test:install、npm pack --dry-run。
4. 檢查 tracked files、套件清單、UTF-8、秘密／私人絕對路徑與授權狀態。
5. 使用者授權後提交明確檔案，建立新 v1.1.1 標籤，一般快轉 push；禁止 force 或移動既有標籤。
6. 核對遠端 main／標籤 SHA，執行 npm run test:remote，核對 Linux／Windows／macOS CI。
7. 實際使用者另行在閒置與佇列清空後更新／重新載入；不得替忙碌的 Docker 對話操作。

固定標籤不跟隨分支更新。private:true 防止意外 npm publish；本流程是 Git 發布，不會建立 npm 套件或自動改授權。
