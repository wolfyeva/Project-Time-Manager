# NYCU 自動簽到退排程助手

這是一個輔助專任/兼任助理進行工時管理的瀏覽器擴充工具。旨在解決網頁閒置登出造成的不便，並優化操作介面。
目前支援最新的 **多重任務排程、跨日設定** 以及 **智慧接續計算** 功能！

![Version](https://img.shields.io/badge/version-3.0-green)

<img width="300" alt="V3.0 Panel" src="assets/v43_panel.png" />

## ✨ 最新版本更新 (V3.0 / 腳本 V43)
* **無縫視覺化行事曆**：解決了原本色塊被切斷的問題，現在跨日期的計畫橫幅會像 Google Calendar 一樣完美連續！同時優化了格子高度，讓您一眼看遍整個月。
* **浮動式顯示選項下拉選單**：右上角的「顯示選項 (Display Filters)」全新升級為浮動下拉選單，展開時不再推擠行事曆畫面，大幅提升閱讀體驗。
* **精確的自動排程打包**：修復了「智能一鍵排滿」在處理法定 4 小時休息限制時可能產生的排班碎裂問題。現在演算法能更聰明地「緊湊打包」時段，確保給您完美合規又無碎裂的排班。
* **動態工時結算器**：排程清單底部新增即時結算區塊，完美模擬學校後台「逐筆無條件捨去法」計時邏輯，一眼看出已排定時數與尚缺時數！
* **智慧接續 (+30分)**：一鍵抓取佇列中最後一筆簽退時間，自動推算 30 分鐘休息時間，無縫排入下一筆簽到。
## 🛠️ 安裝教學

### 步驟 1：安裝瀏覽器擴充功能
您需要安裝使用者腳本管理器。推薦使用 **Tampermonkey (竄改猴)**：
* [Chrome 線上應用程式商店 (Tampermonkey)](https://chrome.google.com/webstore/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo)
* [Microsoft Edge 外掛程式 (Tampermonkey)](https://microsoftedge.microsoft.com/addons/detail/tampermonkey/iikmkjmpaadaobahmlepeloendndfphd)

### 步驟 2：開啟篡改猴並安裝腳本
1.  點擊瀏覽器右上角的 Tampermonkey 圖示，選擇「**添加新腳本**」。
2.  刪除編輯器內原本的所有內容。
3.  複製本專案 `PortalHelper.js` 的完整程式碼，貼入編輯器中並儲存。
4.  重複上述步驟，再新增一支腳本並貼上 `AutoAttend.js` 的完整程式碼後儲存。

> **注意**：安裝完成後，請確保 Tampermonkey 以及兩支腳本都在**啟用**狀態。若您在腳本清單中看到 "No script is running"，請重新整理學校簽到頁面。

---

## ⚡ 效能設定 (必做！防止背景凍結)

為了讓腳本能在您切換分頁或縮小視窗時持續運作，**強烈建議**調整 Chrome/Edge 的記憶體節省設定，防止分頁被瀏覽器「凍結」或「捨棄」。
1. **Chrome**: 到 `chrome://settings/performance`，在「記憶體節省模式」的「一律啟用這些網站」新增 `timeclock.nycu.edu.tw`。
2. **Edge**: 到 `edge://settings/system`，在「最佳化效能」的「不要讓這些網站進入睡眠狀態」新增 `timeclock.nycu.edu.tw`。

---

## 🔑 LINE 提醒功能設定 (選用)

您可以透過 LINE 機器人來接收簽到退成功與否的通知：
1. 進入腳本程式碼，找到 `LINE_TOKEN` 與 `LINE_USER_ID` 變數。
2. 填入您的 LINE 授權碼與個人 ID，即可在每次任務執行時收到即時推播。

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
在手機將「柴柴機器人」加入好友：<br>
<img width="200" alt="image" src="https://github.com/user-attachments/assets/8fc57c47-b8ae-4dc9-889d-f23e6db4170a" />
<img width="200" alt="image" src="https://github.com/user-attachments/assets/48fbeb02-5896-4f32-b2f7-a1f217cf8792" />
<br>[@303kmzhe](https://line.me/R/ti/p/%40303kmzhe)

👉 最後，將複製好的 `LINE_USER_ID` 貼回腳本最上方的設定區即可。

---

## 🚀 主要功能 (V3.0 全新進化)

* **📅 多重排程清單**：您可以一次加入好幾天的簽到退任務，腳本會依序幫您執行。
* **🧠 智慧時間接續 (+30分)**：一鍵自動抓取最後一次簽退時間，並加上法定的 30 分鐘休息時間，無縫排入下一次簽到。
* **📆 跨日與日期選擇**：解除 24 小時限制，您現在可以自由選擇未來任何一天的日期進行排程。
* **🛡️ 雙重防呆機制**：自動處理「尚缺時數不限/空白」的計畫，並在遇到網頁跨夜未更新時自動校正日期。
* **🌐 連線防斷機制**：優化網頁 Session 管理，如果遇到登出會自動跳轉 Portal 重登。

---

## 💡 各種情境範例

### 情境 A：上班一條龍 (最常用)
> **需求**：我要預約今天早上 09:00 簽到，然後工作 4 小時後自動簽退。
1. **選擇計畫**：在下拉選單選擇目標計畫。
2. **設定時間**：日期選今天，時間設為 `上午` `9` 點 `00` 分。
3. **自動簽退**：**勾選** `完成後，自動接續排入簽退`，並將時長設為 `4` 小時 `00` 分鐘。
4. **加入排程**：按下「➕ 加入排程清單」。面板上方會出現兩筆任務 (一個簽到、一個簽退)。

### 情境 B：連續排班 (中間休息 30 分鐘)
> **需求**：我預約了 08:00 到 12:00 的班，下午還要繼續上 13:00 到 17:00。
1. 先依照「情境 A」加入 08:00 簽到、工作 4 小時的排程。
2. 此時排程清單的最後一筆是 `12:00 簽退`。
3. 直接點擊面板上的 **「接續+30分」** 按鈕（系統會自動將時間帶入 12:30）。
4. （若您要休滿一小時，可手動將 12:30 改成 13:00）。
5. 再次點擊「➕ 加入排程清單」。系統就會再幫您排入下午的簽到與簽退任務！

<img width="300" alt="V3.0 Chain" src="assets/v43_chain.png" />

### 🌟 新功能：多日連續排班 (打破單日限制)
> **需求**：我想要一次排好今天、明天、後天連續三天的班表。
1. **第一天**：選擇今天的日期，設定 09:00 簽到，勾選「自動接續排入簽退」設定時長 4 小時。按下「➕ 加入排程清單」。
2. **第二天**：點擊日期選擇器，將日期切換到 **明天**。設定 09:00 簽到，同樣加入排程清單。
3. **第三天**：切換日期到 **後天**，再次加入排程清單。
4. **結果**：您的任務清單中會同時存在這三天的簽到與簽退任務！只要瀏覽器不關，腳本就會依序在指定日期幫您打卡。

### 情境 C：單次補簽退
> **需求**：我早上已經手動簽到了，但我怕下午 17:00 會忘記簽退。
1. **模式**：**勾選** `單次加入: 只執行簽退`。
2. **設定時間**：設定 `下午` `5` 點 `00` 分。
3. **加入排程**：按下「➕ 加入排程清單」。時間到時就會自動幫您簽退。

### 情境 D：Debug 測試模式
> **需求**：我想測試腳本會不會運作，但我不想真的簽下去。
1. **模式**：**勾選** `🐞 Debug(不送出)`。
2. 將時間設為下一分鐘並加入排程。時間到時，腳本會跳出確認視窗但**不會**真的點擊確認，讓您可以安心測試流程。

---

## 🧪 全自動化測試套件 (Automated Test Suite)

為了讓您與開發團隊隨時隨地都能進行系統健檢，我們開發了完全免安裝伺服器、直接瀏覽器執行的 **「全自動化互動測試套件」**！

### 🚀 如何啟動全自動測試：
1. 在瀏覽器直接點擊打開本專案的 [`test_suite.html`](file:///c:/Users/chung/Downloads/NYCU%20Auto%20Attendance/Project-Time-Manager/test_suite.html) 檔案。
2. 點擊頁面右上方的 **「🚀 啟動全自動化 8 大案例測試」** 綠色按鈕。
3. 系統將會自動在右側監控控制台輸出即時 Log，並於左側模擬網頁自動變換 DOM 結構，一次性幫您完成以下 8 大核心驗證：
   * **Case 1**: 標準成對簽到退測試
   * **Case 2**: 單次簽退與本日簽到時間匹配測試 (精準迴避其他計畫時間)
   * **Case 3**: 尚缺時數不限/空白之防呆測試
   * **Case 4**: 簽退確認頁全自動填寫測試 (秒填「忘記即時簽退」)
   * **Case 5**: 多視窗防衝突與容錯轉移測試 (Master Tab Election)
   * **Case 6**: Portal 跨網域跳轉與攔截測試
   * **Case 7**: Debug (不送出) 測試模式
   * **Case 8**: 跨日與進階時間差測試 (驗證 1h59m 算 1h 的無條件捨去機制)

👉 完整的書面測試腳本與標準程序，請參閱 [`TESTING_CASES.md`](file:///c:/Users/chung/Downloads/NYCU%20Auto%20Attendance/Project-Time-Manager/TESTING_CASES.md)。

---

## ⚠️ 免責聲明
本腳本僅供學術研究與輔助使用，開發者不對因使用本腳本導致的任何打卡異常、權益損失或系統問題負責。請使用者務必自行確認簽到退結果。
