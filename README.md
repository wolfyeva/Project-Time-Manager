# Project Time Manager（計畫工時管理員）

![Version](https://img.shields.io/badge/version-2.0-brightgreen)

這個專案提供兩支 Tampermonkey 腳本（皆為 v2.0），用來自動處理 NYCU Portal 登入與「受雇者線上簽到退」排程操作。

- `PortalHelper.js`：自動登入、逾時處理、自動跳轉到差勤頁
- `AutoAttend.js`：簽到/簽退排程佇列、自動執行、LINE 推播通知

---

## 檔案說明

### 1) `PortalHelper.js`（v2.0）

功能重點：
- 自動填入單一入口帳號密碼並送出登入
- 處理 Token Timeout 彈窗後自動回首頁
- 偵測錯誤頁（`"Action not found."`）並自動返回 Portal
- 登入後自動導向差勤入口（`#/redirect/timeclockParttime`）

需設定欄位：
- `YOUR_ID`：你的 NYCU 單一入口帳號
- `YOUR_PWD`：你的 NYCU 單一入口密碼

---

### 2) `AutoAttend.js`（v2.0）

功能重點：
- 支援多筆排程佇列（依時間排序執行）
- 支援簽到、簽退與僅簽退流程
- 支援空白時數/不限時數情境
- 自動處理 timeout 頁面並返回 Portal
- 支援 LINE Bot 推播（成功/失敗、剩餘排程、下一筆資訊）

需設定欄位（若要啟用通知）：
- `LINE_TOKEN`：LINE Channel Access Token
- `LINE_USER_ID`：接收通知的 LINE 使用者 ID（通常以 `U` 開頭）

> 若 `LINE_TOKEN` 或 `LINE_USER_ID` 未填，腳本仍可執行排程，但不會發送 LINE 通知。

---

## 安裝教學（Tampermonkey）

1. 安裝 Tampermonkey
   - Chrome: https://chrome.google.com/webstore/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo
   - Edge: https://microsoftedge.microsoft.com/addons/detail/tampermonkey/iikmkjmpaadaobahmlepeloendndfphd

2. 新增 `PortalHelper.js`
   - 開啟 Tampermonkey → 建立新腳本
   - 清空預設內容
   - 貼上 `PortalHelper.js` 的內容並儲存

3. 新增 `AutoAttend.js`
   - 再建立一支新腳本
   - 貼上 `AutoAttend.js` 的內容並儲存

4. 確認兩支腳本都已啟用
   - `NYCU Portal Helper`
   - `NYCU 自動簽到退排程助手`

---

## 建議瀏覽器設定（避免背景凍結）

為確保排程準時執行，建議把以下網域加入瀏覽器「永不休眠/永遠保持作用中」清單：

- `portal.nycu.edu.tw`
- `timeclock.nycu.edu.tw`

---

## 使用流程

1. 在 `PortalHelper.js` 填入 `YOUR_ID`、`YOUR_PWD`。
2. （可選）在 `AutoAttend.js` 填入 `LINE_TOKEN`、`LINE_USER_ID`。
3. 開啟 NYCU Portal（`https://portal.nycu.edu.tw/`）。
4. PortalHelper 會自動登入並導向差勤頁。
5. 在簽到頁右下角控制面板設定排程並啟動。
6. AutoAttend 會在指定時間自動執行簽到/簽退。

---

## 安全提醒

- 請勿將包含真實帳號、密碼、Token 的腳本上傳到公開倉庫。
- 建議只在自己的瀏覽器環境中保存個人憑證。
- 使用前後請自行確認簽到退結果。

---

## 免責聲明

本工具僅供個人輔助使用。使用者需自行承擔使用風險與結果，並自行確認工時與簽到退紀錄是否正確。
