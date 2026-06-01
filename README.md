# Project Time Manager（計畫工時管理員）

![Version](https://img.shields.io/badge/version-2.0-brightgreen)

這個專案提供兩支 Tampermonkey 腳本（皆為 v2.0），用來自動處理 NYCU Portal 登入與「受雇者線上簽到退」排程操作。

*   `PortalHelper.js`：自動登入、逾時處理、自動跳轉到差勤頁。
*   `AutoAttend.js`：簽到 / 簽退排程佇列、自動執行、LINE 推播通知。

---

## 📂 檔案說明

### 1) `PortalHelper.js`（v2.0）

**功能重點：**
*   自動填入單一入口帳號密碼並送出登入
*   處理 Token Timeout 彈窗後自動回首頁
*   偵測錯誤頁（`"Action not found."`）並自動返回 Portal
*   登入後自動導向差勤入口（`#/redirect/timeclockParttime`）

**需設定欄位：**
*   `YOUR_ID`：你的 NYCU 單一入口帳號
*   `YOUR_PWD`：你的 NYCU 單一入口密碼

### 2) `AutoAttend.js`（v2.0）

**功能重點：**
*   支援多筆排程佇列（依時間排序執行）
*   支援簽到、簽退與僅簽退流程
*   支援空白時數 / 不限時數情境
*   自動處理 timeout 頁面並返回 Portal
*   支援 LINE Bot 推播（成功 / 失敗、剩餘排程、下一筆資訊）

**需設定欄位（若要啟用通知）：**
*   `LINE_TOKEN`：LINE Channel Access Token
*   `LINE_USER_ID`：接收通知的 LINE 使用者 ID（通常以 `U` 開頭）

> 💡 **提示：** 若 `LINE_TOKEN` 或 `LINE_USER_ID` 未填，腳本仍可執行排程，但不會發送 LINE 通知。

---

## 🛠️ 安裝教學（Tampermonkey）

### 步驟 1：安裝 Tampermonkey
*   [Chrome 線上應用程式商店](https://chrome.google.com/webstore/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo)
*   [Microsoft Edge 外掛程式](https://microsoftedge.microsoft.com/addons/detail/tampermonkey/iikmkjmpaadaobahmlepeloendndfphd)

### 步驟 2：開啟篡改猴
1.  於瀏覽器擴充功能找到「篡改猴」，點選右方三個點的圖示，選「管理擴充功能」。
    <br><img width="200" alt="image" src="https://github.com/user-attachments/assets/7ab5be84-afd2-45cc-beab-4f95a419d821" />
2.  開啟「允許使用者指令碼」選項。
    <br><img width="400" alt="image" src="https://github.com/user-attachments/assets/3905f856-a1c0-41bc-9544-92c7bc24166e" />

### 步驟 3：安裝腳本
1.  點擊瀏覽器右上角的 Tampermonkey 圖示，選擇「**添加新腳本**」。
2.  刪除編輯器內原本的所有預設內容。
3.  複製本專案 `PortalHelper.js` 的完整程式碼，貼入編輯器中並儲存。
4.  重複上述步驟，再新增一支腳本並貼上 `AutoAttend.js` 的完整程式碼後儲存。

### 步驟 4：確保腳本已啟用 (重要設定)
1.  點擊瀏覽器右上角的 Tampermonkey 圖示。
2.  確認 **Tampermonkey** 本身是 **「已啟用」** (Enabled) 狀態。
3.  確認 **NYCU 自動簽到退排程助手** 的開關是 **「綠色 (開啟)」** 狀態。
4.  若您在腳本清單中看到 "No script is running"，請重新整理學校簽到頁面。

---

## ⚡ 建議瀏覽器設定（避免背景凍結）

為了讓腳本能在您切換分頁或縮小視窗時持續運作，**強烈建議**調整瀏覽器的記憶體節省設定，防止分頁被「凍結」或「捨棄」。

**Google Chrome 設定方法：**
1.  在網址列輸入 `chrome://settings/performance` 並按下 Enter。
2.  找到「**記憶體節省模式**」 (Memory Saver)。
3.  在「**一律啟用這些網站**」點擊「**新增**」。
4.  輸入網址 `timeclock.nycu.edu.tw` 並儲存。
    <br>![image](https://hackmd.io/_uploads/BkGuu5Gmbe.png)

**Microsoft Edge 設定方法：**
1.  在網址列輸入 `edge://settings/system` 並按下 Enter。
2.  找到「**最佳化效能**」區塊。
3.  在「**不要讓這些網站進入睡眠狀態**」點擊「**新增**」。
4.  輸入網址 `timeclock.nycu.edu.tw` 並儲存。

---

## 📱 圖文教學：如何取得 LINE Token 與 ID

為了讓腳本能專屬推播通知給你，你需要建立並連結 LINE 機器人。請跟著以下步驟操作：

**步驟 1：建立 Messaging API 頻道**
進入 [LINE Developers Console](https://developers.line.biz/console/) 登入你的 LINE 帳號。建立或選擇一個 Provider 後，點選「Create a new channel」，並選擇 **「Messaging API」**。
<br><img width="1124" height="606" alt="image" src="https://github.com/user-attachments/assets/06a0b405-3a07-46ba-8391-8b35258ace4e" />

**步驟 2：跳轉建立官方帳號**
目前 LINE 系統規定需先建立官方帳號才能使用 API，請直接點選畫面中的 **「Create a LINE Official Account」** 綠色按鈕。
<br><img width="1496" height="361" alt="image" src="https://github.com/user-attachments/assets/132f183d-1b69-4fc7-a274-c20d2beb6e44" />

**步驟 3：填寫官方帳號基本資料**
填寫官方帳號的必要資訊（如帳號名稱、電子郵件、業種等），點選最下方的「確定」完成建立。
<br><img width="824" height="921" alt="image" src="https://github.com/user-attachments/assets/6a456de3-2328-4ec7-9e7b-5799f3456d44" />

**步驟 4：啟用 Messaging API**
帳號建立完成後，點擊啟用 Messaging API。
<br><img width="1131" height="421" alt="image" src="https://github.com/user-attachments/assets/65032b3c-7cc5-450f-9bc6-f0eee941886f" />
選擇你剛剛建立的 Channel，並按下【同意】。
<br><img width="582" height="305" alt="image" src="https://github.com/user-attachments/assets/79447a61-939e-4a61-b075-5cfba6d4b70d" />

**步驟 5：取得 `LINE_TOKEN` (存取權杖)**
切換到上方的 **「Messaging API」** 分頁，滑到最底下找到「Channel access token (long-lived)」，點擊 **【Issue】** 產生金鑰。請複製這串代碼，準備貼到腳本的 `LINE_TOKEN` 欄位。
<br><img width="858" height="757" alt="image" src="https://github.com/user-attachments/assets/91a6221e-01bd-421e-aeb6-195788951465" />

**步驟 6：取得 `LINE_USER_ID` (專屬 ID)**
回到 LINE Developers Console，進入你剛剛建好的頻道。在預設的 **「Basic settings」** 分頁中一直滑到最底部，找到 **「Your user ID」**。這串以 `U` 開頭的代碼就是腳本需要的 ID，請將它複製下來！
<br><img width="522" height="621" alt="image" src="https://github.com/user-attachments/assets/95b18d35-4552-4e00-b901-446757e5c299" />

**步驟 7：加機器人為好友 (重要！)**
最後，請在手機上將剛創好的LINE 機器人加入好友，這樣才能順利接收通知!

👉 **完成！** 將複製好的 `LINE_USER_ID` 與 `LINE_TOKEN` 貼回 `AutoAttend.js` 腳本最上方的設定區即可。

---

## 🚀 使用流程

1.  在 `PortalHelper.js` 填入 `YOUR_ID`、`YOUR_PWD`。
2.  （可選）在 `AutoAttend.js` 填入 `LINE_TOKEN`、`LINE_USER_ID`。
3.  開啟 NYCU Portal（`https://portal.nycu.edu.tw/`）。
4.  PortalHelper 會自動登入並導向差勤頁。
5.  在簽到頁右下角控制面板設定排程並啟動。
6.  AutoAttend 會在指定時間自動執行簽到/簽退。

---

## ⚠️ 安全提醒

*   **請勿將包含真實帳號、密碼、Token 的腳本上傳到公開倉庫（例如 GitHub）。**
*   建議只在自己的瀏覽器環境中保存個人憑證。
*   使用前後請自行確認簽到退結果。

---

## ⚖️ 免責聲明

本工具僅供個人輔助使用。使用者需自行承擔使用風險與結果，並自行確認工時與簽到退紀錄是否正確。
