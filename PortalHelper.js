// ==UserScript==
// @name         NYCU Portal Helper
// @namespace    http://tampermonkey.net/
// @version      2.0
// @description  解決前端框架資料綁定問題，優化 Token Timeout 處理流程，全自動登入跳轉。
// @author       Gemini
// @match        https://portal.nycu.edu.tw/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // ================= 配置區域 =================
    const YOUR_ID = "";      // <--- 請使用者在此填寫單一入口帳號
    const YOUR_PWD = "";     // <--- 請使用者在此填寫單一入口密碼
    // ===========================================

    // 強制觸發前端框架更新的核心函式
    function setNativeValue(element, value) {
        const valueSetter = Object.getOwnPropertyDescriptor(element.__proto__, 'value')?.set;
        const prototypeHasSpace = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;

        if (valueSetter && valueSetter !== prototypeHasSpace) {
            valueSetter.call(element, value);
        } else if (prototypeHasSpace) {
            prototypeHasSpace.call(element, value);
        } else {
            element.value = value;
        }
        // 觸發對應事件讓 Vue 捕捉到更動
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
    }

    async function main() {
        // 0. 處理卡在 JSON 錯誤頁面 (Action not found) 的例外狀況
        if (document.body && document.body.innerText.includes('"Action not found."')) {
            console.log("[Portal Helper] 卡在錯誤頁面，強制返回首頁...");
            window.location.href = 'https://portal.nycu.edu.tw/';
            return;
        }

        // 1. 優先處理 Token Timeout 錯誤視窗 (Element UI)
        const errorBox = document.querySelector('.el-message-box__wrapper');
        if (errorBox && errorBox.style.display !== 'none') {
            const confirmBtn = errorBox.querySelector('.el-button--primary');
            if (confirmBtn) {
                console.log("[Portal Helper] 偵測到連線逾時彈窗，點擊確認並重整...");
                confirmBtn.click();
                setTimeout(() => { window.location.href = 'https://portal.nycu.edu.tw/'; }, 500);
                return; // 處理了彈窗就結束當次執行，避免與後續登入邏輯衝突
            }
        }

        // 2. 登入頁面：自動填寫並登入
        const accountInput = document.querySelector('input[name="account"]');
        const passwordInput = document.querySelector('input[name="password"]');
        const loginBtn = document.querySelector('button[type="submit"]');

        if (accountInput && passwordInput && loginBtn) {
            // 檢查是否真的填入成功（利用 dataset 做標記，防止無限重複模擬輸入）
            if (!accountInput.dataset.filled && YOUR_ID) {
                accountInput.focus();
                setNativeValue(accountInput, YOUR_ID);
                accountInput.dataset.filled = "true";
                console.log("[Portal Helper] 已填入帳號");
            }

            if (!passwordInput.dataset.filled && YOUR_PWD) {
                passwordInput.focus();
                setNativeValue(passwordInput, YOUR_PWD);
                passwordInput.dataset.filled = "true";
                console.log("[Portal Helper] 已填入密碼");
            }

            // 確保兩個欄位都有值才發送登入
            if (accountInput.value === YOUR_ID && passwordInput.value === YOUR_PWD) {
                // 給網頁底部的 Vue 一點反應時間，隨後點擊登入
                if (!loginBtn.dataset.clicked) {
                    loginBtn.dataset.clicked = "true";
                    console.log("[Portal Helper] 欄位填寫完全，準備觸發登入...");
                    setTimeout(() => { loginBtn.click(); }, 1200);
                }
            }
            return;
        }

        // 3. 登入成功後：尋找差勤系統連結
        if (document.querySelector('.user-name') || window.location.href.includes('/links/')) {
            const attendanceLink = document.querySelector('a[href="#/redirect/timeclockParttime"]');

            if (attendanceLink) {
                console.log("[Portal Helper] 找到差勤連結，準備跳轉...");
                setTimeout(() => {
                    window.location.hash = "/redirect/timeclockParttime";
                }, 1000);
            } else {
                if (!window.location.href.includes('/links/nycu')) {
                    console.log("[Portal Helper] 未找到連結，嘗試切換至 [陽明交通大學] 列表...");
                    setTimeout(() => {
                        window.location.hash = "/links/nycu";
                    }, 2000);
                }
            }
        }
    }

    // 啟動循環檢查
    setInterval(main, 2000);
    window.addEventListener('load', main);
})();
