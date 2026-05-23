# Project Time Manager (計畫工時管理員)

這是一個輔助專任/兼任助理進行工時管理的瀏覽器擴充工具。旨在解決網頁閒置登出造成的不便，並優化操作介面。

![Version](https://img.shields.io/badge/version-1.0-green)
![image](https://hackmd.io/_uploads/r11rU5zQ-e.png)
## 🛠️ 安裝教學

### 步驟 1：安裝瀏覽器擴充功能
您需要安裝使用者腳本管理器。推薦使用 **Tampermonkey (竄改猴)**：
* [Chrome 線上應用程式商店 (Tampermonkey)](https://chrome.google.com/webstore/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo)
* [Microsoft Edge 外掛程式 (Tampermonkey)](https://microsoftedge.microsoft.com/addons/detail/tampermonkey/iikmkjmpaadaobahmlepeloendndfphd)

### 步驟 2：開啟篡改猴
1. 於瀏覽器擴充功能找到「篡改猴」，點選右方三個點的圖示，選「管理擴充功能」
    - ![image](https://hackmd.io/_uploads/S1de_cG7Ze.png =50%x)
2. 開啟「允許使用者指令碼」選項
    - ![image](https://hackmd.io/_uploads/SJE0vqMX-e.png =80%x)

### 步驟 2：安裝腳本
1.  點擊瀏覽器右上角的 Tampermonkey 圖示，選擇「**添加新腳本**」。
2.  刪除編輯器內原本的所有內容。
3.  複製本專案 `script.js` 的完整程式碼，貼入編輯器中。
4.  按下 `Ctrl + S` 或點擊「**檔案**」>「**儲存**」。

### 步驟 3：確保腳本已啟用 (重要設定)
安裝完成後，請確認以下設定以確保腳本能正常運作：
1.  點擊瀏覽器右上角的 Tampermonkey 圖示。
2.  確認 **Tampermonkey** 本身是 **「已啟用」** (Enabled) 狀態。
3.  確認 **NYCU 自動簽到退排程助手** 的開關是 **「綠色 (開啟)」** 狀態。
4.  若您在腳本清單中看到 "No script is running"，請重新整理學校簽到頁面。

---

## ⚡ 效能設定 (必做！防止背景凍結)

為了讓腳本能在您切換分頁或縮小視窗時持續運作，**強烈建議**調整 Chrome/Edge 的記憶體節省設定，防止分頁被瀏覽器「凍結」或「捨棄」。

### Google Chrome 設定方法
1.  在網址列輸入 `chrome://settings/performance` 並按下 Enter。
2.  找到「**記憶體節省模式**」 (Memory Saver)。
3.  在「**一律啟用這些網站**」 (Always keep these sites active) 點擊「**新增**」。
4.  輸入網址：`timeclock.nycu.edu.tw` 並儲存。
5.  完成畫面如下： ![image](https://hackmd.io/_uploads/BkGuu5Gmbe.png)


### Microsoft Edge 設定方法
1.  在網址列輸入 `edge://settings/system` 並按下 Enter。
2.  找到「**最佳化效能**」區塊。
3.  在「**不要讓這些網站進入睡眠狀態**」點擊「**新增**」。
4.  輸入網址：`timeclock.nycu.edu.tw` 並儲存。

---

## 🔑 開始前先填這 3 個欄位

在安裝腳本前，請先打開對應的腳本檔案，把以下個人資訊的欄位填好：

- **`PortalHelper.user.js`**
  - `YOUR_ID`：你的 NYCU 單一入口帳號
  - `YOUR_PWD`：你的 NYCU 單一入口密碼

- **`AutoAttend.user.js`**
  - `LINE_USER_ID`：接收 LINE 通知的使用者專屬 ID

> ⚠️ **安全警告**：請勿將填入真實帳號密碼與 Token 的腳本分享給他人，或上傳至公開的 GitHub 儲存庫。

---

### 📱 圖文教學：如何取得 `LINE_USER_ID`

為了讓腳本能專屬推播通知給你，你需要建立一個免費的 LINE 機器人。請跟著以下步驟操作：

**步驟 1：建立 Messaging API 頻道**
進入 [LINE Developers Console](https://developers.line.biz/console/) 登入你的 LINE 帳號。建立或選擇一個 Provider 後，點選「Create a new channel」，並選擇 **「Messaging API」**。
<img width="1124" height="606" alt="image" src="https://github.com/user-attachments/assets/06a0b405-3a07-46ba-8391-8b35258ace4e" />

**步驟 2：跳轉建立官方帳號**
目前 LINE 系統規定需先建立官方帳號才能使用 API，請直接點選畫面中的 **「Create a LINE Official Account」** 綠色按鈕。
<img width="1496" height="361" alt="image" src="https://github.com/user-attachments/assets/132f183d-1b69-4fc7-a274-c20d2beb6e44" />

**步驟 3：填寫官方帳號基本資料**
填寫官方帳號的必要資訊（如帳號名稱、電子郵件、業種等），完成後點選最下方的「確定」完成建立。
<img width="824" height="921" alt="image" src="https://github.com/user-attachments/assets/6a456de3-2328-4ec7-9e7b-5799f3456d44" />

**步驟 4：取得 `LINE_USER_ID` (專屬 ID)**
回到 LINE Developers Console，進入你剛剛建好的頻道。在預設的 **「Basic settings」** 分頁中一直滑到最底部，找到 **「Your user ID」**。這串以 `U` 開頭的代碼就是腳本需要的 `LINE_USER_ID`，請將它複製下來！
<img width="522" height="621" alt="image" src="https://github.com/user-attachments/assets/95b18d35-4552-4e00-b901-446757e5c299" />


**步驟 5：加機器人為好友 (重要！)**
在手機將「柴柴機器人」加入好友：<img width="200" alt="image" src="https://github.com/user-attachments/assets/8fc57c47-b8ae-4dc9-889d-f23e6db4170a" />
<img width="200" alt="image" src="https://github.com/user-attachments/assets/48fbeb02-5896-4f32-b2f7-a1f217cf8792" />
[@303kmzhe](https://line.me/R/ti/p/%40303kmzhe)

👉 最後，將複製好的 `LINE_USER_ID` 貼回 `AutoAttend.user.js` 腳本最上方的設定區即可。

## 🚀 主要功能

* **📅 工時排程管理**：協助規劃每日工作時段，避免工時計算錯誤。
* **🛡️ 連線穩定機制**：優化網頁 Session 管理，減少因閒置而發生資料遺失的狀況。
* **⌚ 介面視覺優化**：提供深色模式面板與即時時間顯示，提升閱讀體驗。
* **🚫 誤觸防護**：優化瀏覽器彈窗行為，提供更流暢的操作流程。
* **💓 雙核心運作**：UI 顯示與執行邏輯分離，確保瀏覽器背景節能模式下時間依然準確。

---


## 📖 使用說明

1.  透過[單一入口](https://portal.nycu.edu.tw/#/login?redirect=%2F)登入「兼任拆勤 （受雇者線上簽到退）」網站。
2.  網頁右下角會出現 **黑色控制面板**。
    - ![image](https://hackmd.io/_uploads/ByuFYqG7-e.png)
3.  **設定排程**：
    * 選擇要執行的「計畫」。
    * 設定「預約簽到時間」。
    * 勾選「自動簽退」並設定工作時數 (例如 4 小時)。
4.  按下 **「啟動排程」**。
5.  腳本會自動倒數，時間到時自動點擊按鈕並處理確認視窗。

**注意**：啟動後請勿關閉該分頁 (可以切換到其他分頁或縮小瀏覽器)。

---

## 💡 各種情境範例

### 情境 A：上班一條龍 (最常用)
> **需求**：我想要早上 09:00 簽到，然後工作 4 小時後自動簽退。

1.  **時間**：設定 `上午` `9` 點 `00` 分。
2.  **自動簽退**：**勾選** `✅ 2. 自動簽退`。
3.  **工時**：設定 `4` 小時 `01` 分鐘。
4.  **動作**：按下「啟動排程」。
    * *結果：腳本會等待到 09:00 執行簽到，接著自動等待 4 小時 01 分後執行簽退。*
* ![image](https://hackmd.io/_uploads/r1Xwa5GQZx.png)


### 情境 B：單純預約簽到
> **需求**：我只想預約 08:30 簽到，簽退我之後再自己按，或還不確定幾點走。

1.  **時間**：設定 `上午` `8` 點 `30` 分。
2.  **自動簽退**：**取消勾選** `⬜ 2. 自動簽退`。
3.  **動作**：按下「啟動排程」。
    * *結果：腳本會在 08:30 執行簽到後，即停止運作。*
* ![image](https://hackmd.io/_uploads/HykS6qfX-l.png)


### 情境 C：補設定簽退 (怕忘記)
> **需求**：我早上已經手動簽到了，但我怕下午 17:00 會忘記簽退。

1.  **模式**：**勾選** `✅ 只執行簽退 (不簽到)`。
2.  **時間**：設定 `下午` `5` 點 `00` 分 (這裡設定的是您想簽退的時間)。
3.  **動作**：按下「啟動排程」。
    * *結果：腳本會直接進入等待簽退模式，直到 17:00 執行簽退。*
* ![image](https://hackmd.io/_uploads/rJ3W69zXbg.png)


### 情境 D：Debug 測試模式
> **需求**：我想測試腳本會不會運作，但我不想真的簽下去。

1.  **模式**：**勾選** `✅ 🐞 Debug Mode (不按確認)`。
2.  **時間**：設定一個 1 分鐘後的時間 (例如現在是 10:00，設 10:01)。
3.  **動作**：按下「啟動排程」。
    * *結果：時間到時，腳本會跳出確認視窗，但**不會**真的點擊網頁上的確認按鈕，讓您可以安心測試流程。*
- ![image](https://hackmd.io/_uploads/B1cmh5GQbg.png)


---

## ⚠️ 免責聲明

本腳本僅供學術研究與輔助使用，開發者不對因使用本腳本導致的任何打卡異常、權益損失或系統問題負責。請使用者務必自行確認簽到退結果。
