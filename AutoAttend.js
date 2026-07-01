// ==UserScript==
// @name         NYCU 自動簽到退排程助手
// @namespace    http://tampermonkey.net/
// @version      2.1
// @description  多筆排程佇列，支援空白時數計畫，優化重複按鈕過濾，並支援 LINE 推播通知
// @author       Gemini & 柴柴
// @match        *://*/*OnlineProjectAttend_NYCU.aspx*
// @match        *://*/*TimeOut.aspx*
// @run-at       document-start
// @grant        GM_xmlhttpRequest
// @connect      api.line.me
// ==/UserScript==

(function() {
    'use strict';

    if (window.location.href.toLowerCase().includes('timeout.aspx')) {
        const script = document.createElement('script');
        script.textContent = "window.alert = function(){ console.log('已攔截逾時彈窗'); };";
        document.documentElement.appendChild(script);

        window.addEventListener('DOMContentLoaded', () => {
            document.documentElement.innerHTML = `
                <div style="background:#111; color:#fff; font-size:24px; display:flex; justify-content:center; align-items:center; height:100vh; flex-direction:column; font-family:sans-serif;">
                    <div style="font-size:50px; margin-bottom:20px;">🔄</div>
                    <div>系統已斷線，成功攔截彈窗，正在自動返回 Portal 重新登入...</div>
                </div>`;
            setTimeout(() => {
                window.location.href = "https://portal.nycu.edu.tw/";
            }, 1500);
        });
        return;
    }

    // --- 設定區 & 狀態管理 ---
    const STORAGE_PREFIX = 'nycu_attendance_core_';
    const KEY_SCHEDULES = STORAGE_PREFIX + 'schedules';
    const KEY_EXECUTING_TASK = "AutoAttend_ExecutingTask";
    const KEY_PENDING_NOTIFY = "AutoAttend_PendingNotify";
    const KEY_MASTER_ID = "AutoAttend_MasterTabId";
    const KEY_MASTER_HEARTBEAT = "AutoAttend_MasterHeartbeat";

    const MY_TAB_ID = Date.now().toString() + "_" + Math.random().toString(36).substring(2);
    const KEY_DEBUG_MODE = STORAGE_PREFIX + 'debug_mode';
    const KEY_UI_STATE = STORAGE_PREFIX + 'ui_state';
    const KEY_LAST_REFRESH = STORAGE_PREFIX + 'last_refresh';
    const KEY_IS_COLLAPSED = STORAGE_PREFIX + 'is_collapsed';
    const KEY_EXCLUDE_TIMES = STORAGE_PREFIX + 'exclude_times';
    const KEY_BATCH_TIME_RANGE = STORAGE_PREFIX + 'batch_time_range';

    const MAIN_PAGE_ID = 'ContentPlaceHolder1_GridView_attend';
    const CONFIRM_BTN_ID = 'ContentPlaceHolder1_Button_attend';

    const KEEP_ALIVE_INTERVAL_MINUTES = 5;

    // --- 工具函式 ---
    function sendLineNotify(actionText, projectName, status = 'success', savedMissingHours = "未知") {
        // 👇👇👇 請使用者在這裡填入自己的 LINE 資訊 👇👇👇
        const LINE_TOKEN = "";   // <--- 填入你的 LINE Channel Access Token
        const LINE_USER_ID = ""; // <--- 填入你的 LINE User ID (U 開頭)
        // 👆👆👆 ------------------------------ 👆👆👆

        if (!LINE_TOKEN || !LINE_USER_ID) return;

        const timeStr = new Date().toLocaleTimeString('zh-TW', { hour12: false, hour: '2-digit', minute: '2-digit' });
        const isDebug = actionText.includes('[測試]');
        const realAction = actionText.replace('[測試] ', '');

        let missingHoursText = '';

        if (savedMissingHours !== "未知" && savedMissingHours !== -1) {
            missingHoursText = `\n⏳ 尚缺: ${savedMissingHours}`;
        } else {
            const allProjects = scanProjects();
            const matchedProj = allProjects.find(p => p.name === projectName);
            if (matchedProj && matchedProj.missing !== "未知") {
                missingHoursText = `\n⏳ 尚缺: ${matchedProj.missing}`;
            }
        }

        const list = getSchedules();
        let queueText = `\n📋 剩餘排程: ${list.length} 筆`;
        if (list.length > 0) {
            const nextTime = new Date(list[0].targetTime).toLocaleTimeString('zh-TW', { hour12: false, hour: '2-digit', minute: '2-digit' });
            queueText += `\n👉 下一筆: ${nextTime} [${list[0].actionText}]`;
        }

        let msgText = '';
        if (status === 'error') {
            msgText = `❌ 自動${realAction}失敗！\n⚠️ 找不到對應的按鈕\n📌 ${projectName}${missingHoursText}\n⏰ ${timeStr}${queueText}`;
        } else {
            let actionIcon = realAction === '簽到' ? '🟢' : '🔵';
            if (isDebug) actionIcon = '🐞';
            msgText = `${actionIcon} 自動${actionText}成功\n📌 ${projectName}${missingHoursText}\n⏰ ${timeStr}${queueText}`;
        }

        GM_xmlhttpRequest({
            method: "POST",
            url: "https://api.line.me/v2/bot/message/push",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${LINE_TOKEN}`
            },
            data: JSON.stringify({
                to: LINE_USER_ID,
                messages: [
                    { type: "text", text: msgText }
                ]
            }),
            onload: function(response) {
                if (response.status === 200) log(`📱 LINE 通知(${status})發送成功！`);
            }
        });
    }

    function log(msg) {
        const display = document.getElementById('helper_msg_display');
        if(display) display.innerText = msg;
        console.log(`[AutoAttend] ${msg}`);
        const miniDisplay = document.getElementById('helper_mini_msg');
        if (miniDisplay) miniDisplay.innerText = msg.replace(/\n/g, ' ');
    }

    function checkMaster() {
        const currentMaster = getStorage(KEY_MASTER_ID);
        const masterHeartbeat = parseInt(getStorage(KEY_MASTER_HEARTBEAT) || 0);
        const now = Date.now();

        if (currentMaster === MY_TAB_ID) {
            setStorage(KEY_MASTER_HEARTBEAT, now);
            return true;
        }

        if (!currentMaster || now - masterHeartbeat > 4000) {
            setStorage(KEY_MASTER_ID, MY_TAB_ID);
            setStorage(KEY_MASTER_HEARTBEAT, now);
            log("👑 本分頁已接管為主要排程器 (Master)！");
            return true;
        }

        return false;
    }

    function updateHeartbeat() {
        const now = new Date();
        const el = document.getElementById('helper_heartbeat');
        if (el) el.innerText = `💓 運作中: ${now.toLocaleTimeString('zh-TW', { hour12: false })}`;
    }

    function updateTabTitle(text) { document.title = text + " - 線上簽到退"; }
    function getStorage(key) { return localStorage.getItem(key); }
    function setStorage(key, val) { localStorage.setItem(key, val); }

    function formatTime(dateObj) {
        const d = new Date(dateObj);
        const md = `${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`;
        const time = d.toLocaleTimeString('zh-TW', { hour12: false, hour: '2-digit', minute: '2-digit' });
        return `${md} ${time}`;
    }

    function getLocalDateString(dateObj) {
        const y = dateObj.getFullYear();
        const m = String(dateObj.getMonth() + 1).padStart(2, '0');
        const d = String(dateObj.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }

    function formatCountDown(ms) {
        if (ms < 0) return "00:00:00";
        const h = Math.floor((ms % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const m = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
        const s = Math.floor((ms % (1000 * 60)) / 1000);
        return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }

    let scheduleHistory = [];
    let isUndoing = false;

    window.addEventListener('keydown', (e) => {
        if (e.ctrlKey && e.key.toLowerCase() === 'z') {
            const activeTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
            if (activeTag === 'input' || activeTag === 'textarea') return;
            
            if (scheduleHistory.length > 0) {
                e.preventDefault();
                const previousStateJson = scheduleHistory.pop();
                try {
                    const previousList = JSON.parse(previousStateJson);
                    isUndoing = true;
                    saveSchedules(previousList);
                    isUndoing = false;
                    log("↩️ 已觸發 Ctrl+Z：成功復原上一步排程動作！");
                } catch (err) {
                    console.error("復原失敗", err);
                }
            } else {
                log("⚠️ 沒有可以復原的歷史紀錄！");
            }
        }
    });

    function getSchedules() {
        try { return JSON.parse(getStorage(KEY_SCHEDULES) || '[]'); } catch (e) { return []; }
    }

    function saveSchedules(list) {
        list.sort((a, b) => a.targetTime - b.targetTime);
        const currentJson = getStorage(KEY_SCHEDULES) || '[]';
        const newJson = JSON.stringify(list);
        
        if (!isUndoing && currentJson !== newJson) {
            scheduleHistory.push(currentJson);
            if (scheduleHistory.length > 50) scheduleHistory.shift();
        }
        
        setStorage(KEY_SCHEDULES, newJson);
        renderScheduleList();
        if (typeof renderCalendarGrid === 'function' && document.getElementById('nycu_calendar_modal')?.style.display !== 'none') {
            renderCalendarGrid();
        }
        if (document.getElementById('nycu_batch_config_modal')?.style.display !== 'none') {
            const modalTargetSelect = document.getElementById('modal_target_project');
            if (modalTargetSelect && typeof modalTargetSelect.onchange === 'function') {
                modalTargetSelect.onchange();
            }
        }
    }

    function deleteSchedule(id) {
        let list = getSchedules();
        list = list.filter(task => task.id !== id);
        saveSchedules(list);
        log("🗑️ 已刪除排程任務");
    }

    function scanProjects() {
        const grid = document.getElementById(MAIN_PAGE_ID);
        if (!grid) return [];

        const projectMap = new Map();
        const trs = Array.from(grid.querySelectorAll('tr'));

        trs.forEach((tr, index) => {
            const tds = tr.querySelectorAll('td');
            if (tds.length < 2) return;

            let name = tds[0].innerText.replace(/\n/g, '').trim();
            if (!name) return;

            let missingHours = "未知";
            let dateRange = "";
            const fullText = tr.innerText;

            const match = fullText.match(/尚缺\s*[：:]\s*(\d+)\s*小時/);
            if (match && match[1]) {
                missingHours = match[1] + "h";
            } else if (fullText.includes("尚缺")) {
                missingHours = "不限";
            }

            let startDate = null;
            let endDate = null;
            const dateMatch = fullText.match(/(\d{4}[-/]\d{2}[-/]\d{2})\s*~\s*(\d{4}[-/]\d{2}[-/]\d{2})/);
            if (dateMatch) {
                startDate = dateMatch[1].replace(/-/g, '/');
                endDate = dateMatch[2].replace(/-/g, '/');
                const d1 = startDate.substring(5);
                const d2 = endDate.substring(5);
                dateRange = ` (${d1}~${d2})`;
            }

            const signInMatch = fullText.match(/本日簽到時間\s*[：:]\s*(\d{2})\s*[:：]\s*(\d{2})/);
            const signInTime = signInMatch ? { h: parseInt(signInMatch[1]), m: parseInt(signInMatch[2]) } : null;

            name = name + dateRange;
            const btn = tr.querySelector('a[id*="LinkButton_signIn"], a[id*="LinkButton_signOut"]');
            const btnId = btn ? btn.id : `proj_no_btn_${index}`;
            const type = btn ? (btn.id.includes('signIn') ? 'signIn' : 'signOut') : 'none';

            if (!projectMap.has(btnId)) {
                projectMap.set(btnId, { index, name, missing: missingHours, btnId, type, signInTime, startDate, endDate });
            }
        });

        return Array.from(projectMap.values());
    }

    function getActionButtonById(id) { return document.getElementById(id); }

    function calculateSmartDefaults() {
        const projects = scanProjects();
        const now = new Date();
        let defaultInPeriod = now.getHours() >= 12 ? 'PM' : 'AM';
        let defaultInH = now.getHours() % 12;
        if (defaultInH === 0) defaultInH = 12;

        const availableSignIn = projects.filter(p => p.type === 'signIn');
        let targetId = availableSignIn.length > 0 ? availableSignIn[0].btnId : (projects.length > 0 ? projects[0].btnId : "");

        let defaultOutH = 1;
        if (availableSignIn.length > 0) {
            let parsedM = parseInt(availableSignIn[0].missing);
            if (!isNaN(parsedM) && parsedM <= 4 && parsedM > 0) {
                defaultOutH = parsedM;
            }
        }

        return {
            inDate: getLocalDateString(now),
            inPeriod: defaultInPeriod, inH: defaultInH, inM: now.getMinutes(),
            projectIndex: targetId, outH: defaultOutH, outM: 1,
            chkSignOut: true, chkDebug: false, chkOnlySignOut: false
        };
    }

    function saveUIState() {
        if (!document.getElementById('nycu_helper_panel')) return;
        const state = {
            projectIndex: document.getElementById('target_project').value,
            chkOnlySignOut: document.getElementById('chk_only_signout').checked,
            inDate: document.getElementById('in_date').value,
            inPeriod: document.getElementById('in_period').value,
            inH: document.getElementById('in_h').value,
            inM: document.getElementById('in_m').value,
            chkSignOut: document.getElementById('chk_auto_signout').checked,
            outH: document.getElementById('out_h').value,
            outM: document.getElementById('out_m').value,
            chkDebug: document.getElementById('chk_debug_mode').checked
        };
        setStorage(KEY_UI_STATE, JSON.stringify(state));
        setStorage(KEY_DEBUG_MODE, state.chkDebug);
    }

    function getInitialState() {
        const savedStateJson = getStorage(KEY_UI_STATE);
        if (savedStateJson) { 
            try { 
                let s = JSON.parse(savedStateJson);
                if (!s.inDate) s.inDate = getLocalDateString(new Date());
                return s;
            } catch (e) {} 
        }
        return calculateSmartDefaults();
    }

    function createSpecificOptions(values, selectedVal, pad = false) {
        return values.map(v => `<option value="${v}" ${v == selectedVal ? 'selected' : ''}>${pad ? v.toString().padStart(2, '0') : v}</option>`).join('');
    }
    function createRangeOptions(start, end, selectedVal, pad = false) {
        let html = '';
        for (let i = start; i <= end; i++) html += `<option value="${i}" ${i == selectedVal ? 'selected' : ''}>${pad ? i.toString().padStart(2, '0') : i}</option>`;
        return html;
    }

    function checkLogoutAndRedirect() {
        if (!document.body) return false;
        const bodyText = document.body.innerText;
        if (bodyText.includes("您尚未登入") || bodyText.includes("Timeout=1") || bodyText.includes("已被登出")) {
            const div = document.createElement('div');
            div.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.9); color:#fff; display:flex; justify-content:center; align-items:center; z-index:999999; font-size:24px; flex-direction:column;';
            div.innerHTML = `<div style="margin-bottom:20px; font-size:50px;">🔄</div><div>連線逾時，正在自動返回入口網登入...</div>`;
            document.body.appendChild(div);
            setTimeout(() => { window.location.href = "https://portal.nycu.edu.tw/"; }, 1000);
            return true;
        }
        return false;
    }

    function createPanel() {
        if (!document.body) return;
        if (document.getElementById('nycu_helper_panel') || checkLogoutAndRedirect()) return;

        const state = getInitialState();
        const isCollapsed = getStorage(KEY_IS_COLLAPSED) === 'true';

        const div = document.createElement('div');
        div.id = 'nycu_helper_panel';
        div.style.cssText = 'position:fixed; bottom:10px; right:10px; background:rgba(0,0,0,0.9); color:white; padding:10px; border-radius:8px; z-index:2147483647; box-shadow:0 0 15px rgba(0,0,0,0.7); font-family:Arial, sans-serif; width: 330px; border: 1px solid #444; transition: all 0.3s ease;';
        const toggleBtnStyle = 'float:right; cursor:pointer; font-weight:bold; color:#ccc; border:1px solid #555; padding:0 5px; border-radius:3px; background:#333; margin-left:10px;';

        div.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:5px;">
                <h3 id="panel_title" style="margin:0; font-size:16px; color:#4CAF50;">📅 排程助手 V3.0</h3>
                <span id="btn_panel_toggle" style="${toggleBtnStyle}" title="縮小/展開">${isCollapsed ? '⬜' : '➖'}</span>
            </div>
            <div id="panel_content_mini" style="display:${isCollapsed ? 'block' : 'none'}; color:yellow; font-size:13px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                <span id="helper_mini_msg">佇列監控中...</span>
            </div>
            <div id="panel_content_full" style="display:${isCollapsed ? 'none' : 'block'};">
                <div style="background:#111; border: 1px solid #555; border-radius:4px; padding: 5px; margin-bottom: 10px;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 5px;">
                        <span style="font-size:12px; color:#aaa; font-weight:bold;">📋 待執行任務清單 <span style="color:#00BCD4; font-size:11px;">(支援 Ctrl+Z 復原)</span>:</span>
                        <button id="btn_clear_all_schedules" style="background:#f44336; color:white; border:none; border-radius:3px; padding:2px 6px; cursor:pointer; font-size:11px; font-weight:bold;" title="清空所有待執行排程">🗑️ 全部刪除</button>
                    </div>
                    <div id="schedule_list_container" style="max-height: 100px; overflow-y: auto; font-size: 12px;"></div>
                    <div id="prediction_container" style="display:none; margin-top: 5px; padding-top: 5px; border-top: 1px dashed #555; background: #1a1a1a;"></div>
                </div>

                <div style="margin-bottom: 8px;">
                    <label style="color:#ffeb3b; font-weight:bold; cursor:pointer; font-size:14px;">
                        <input type="checkbox" id="chk_only_signout" ${state.chkOnlySignOut ? 'checked' : ''}> 單次加入: 只執行簽退
                    </label>
                </div>

                <div style="margin-bottom: 10px; background:#222; padding:6px; border-radius:4px; border-left: 4px solid #9C27B0;">
                    <select id="target_project" style="padding:4px; width:100%; font-size:13px;"><option>讀取中...</option></select>
                </div>

                <div style="margin-bottom: 10px; background:#222; padding:6px; border-radius:4px; border-left: 4px solid #2196F3;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:5px;">
                        <span id="lbl_time_setting" style="color:#2196F3; font-weight:bold; font-size:13px;">設定執行時間</span>
                        <div style="display:flex; gap:3px;">
                            <button id="btn_set_now" style="background:#4CAF50; color:white; border:none; border-radius:3px; padding:2px 6px; cursor:pointer; font-size:11px;">🕒 下一分鐘</button>
                            <button id="btn_half_hr_after_last" style="background:#00BCD4; color:white; border:none; border-radius:3px; padding:2px 6px; cursor:pointer; font-size:11px;" title="距離最後一次簽退時間+30分鐘">接續+30分</button>
                        </div>
                    </div>
                    <div style="display:flex; align-items:center;">
                        <input type="date" id="in_date" value="${state.inDate}" style="padding:2px; font-size:12px; margin-right:4px; background:#333; color:white; border:1px solid #555; border-radius:3px; cursor:pointer; min-width: 90px;">
                        <select id="in_period" style="padding:2px; margin-right:2px; background:#333; color:white; border:1px solid #555; border-radius:3px;">
                            <option value="AM" ${state.inPeriod === 'AM' ? 'selected' : ''}>上午</option>
                            <option value="PM" ${state.inPeriod === 'PM' ? 'selected' : ''}>下午</option>
                        </select>
                        <select id="in_h" style="padding:2px; background:#333; color:white; border:1px solid #555; border-radius:3px;">${createRangeOptions(1, 12, state.inH)}</select>
                        <span style="margin: 0 2px;">點</span>
                        <select id="in_m" style="padding:2px; background:#333; color:white; border:1px solid #555; border-radius:3px;">${createRangeOptions(0, 59, state.inM, true)}</select>
                        <span style="margin-left: 2px;">分</span>
                    </div>
                </div>

                <div id="block_duration_setting" style="margin-bottom: 10px; background:#222; padding:6px; border-radius:4px; border-left: 4px solid #FF9800;">
                    <label style="color:#FF9800; font-weight:bold; font-size:13px; cursor:pointer;">
                        <input type="checkbox" id="chk_auto_signout" ${state.chkSignOut ? 'checked' : ''}> 完成後，自動接續排入簽退
                    </label>
                    <div id="signout_options" style="margin-top:3px; opacity: ${state.chkSignOut ? '1' : '0.5'}; font-size:13px;">
                        時長：
                        <select id="out_h" style="padding:2px;">${createSpecificOptions([0, 1, 2, 3, 4], state.outH)}</select> 時
                        <select id="out_m" style="padding:2px;">${createSpecificOptions([0, 1, 5, 10, 15, 30], state.outM, true)}</select> 分
                    </div>
                </div>

                <div style="margin-bottom: 5px; display:flex; justify-content:space-between; align-items:center;">
                    <label style="color: #ff5555; font-size: 12px; cursor: pointer;">
                        <input type="checkbox" id="chk_debug_mode" ${state.chkDebug ? 'checked' : ''}> 🐞 Debug(不送出)
                    </label>
                    <span id="helper_heartbeat" style="font-size:11px; color:#888;"></span>
                </div>
                <button id="btn_add_task" style="background:#2196F3; color:white; border:none; padding:8px; cursor:pointer; width:100%; border-radius:4px; font-weight:bold; font-size:14px; margin-bottom:5px;">➕ 加入排程清單</button>
                <button id="btn_auto_batch_schedule" style="background:#9C27B0; color:white; border:none; padding:8px; cursor:pointer; width:100%; border-radius:4px; font-weight:bold; font-size:14px; margin-bottom:5px;">🔄 智能一鍵排滿 (合規連續6天8h)</button>
                <button id="btn_toggle_calendar" style="background:#009688; color:white; border:none; padding:8px; cursor:pointer; width:100%; border-radius:4px; font-weight:bold; font-size:14px; margin-bottom:5px;">📅 展開視覺化打卡行事曆</button>
                <div id="helper_msg_display" style="color:#FFFF00; font-size:12px; text-align:center;">設定好請點擊加入排程</div>
            </div>
        `;
        document.body.appendChild(div);

        document.getElementById('btn_panel_toggle').addEventListener('click', () => {
            const isColl = document.getElementById('panel_content_full').style.display === 'none';
            document.getElementById('panel_content_full').style.display = isColl ? 'block' : 'none';
            document.getElementById('panel_content_mini').style.display = isColl ? 'none' : 'block';
            document.getElementById('btn_panel_toggle').innerText = isColl ? '➖' : '⬜';
            setStorage(KEY_IS_COLLAPSED, !isColl);
        });

        document.getElementById('btn_clear_all_schedules').addEventListener('click', () => {
            if (getSchedules().length === 0) {
                log("⚠️ 清單已經是空的！");
                return;
            }
            if (confirm("確定要刪除所有待執行的任務清單嗎？")) {
                saveSchedules([]);
                log("🗑️ 已清空所有待執行任務清單！");
            }
        });

        document.getElementById('btn_set_now').addEventListener('click', () => {
            const now = new Date();
            now.setMinutes(now.getMinutes() + 1);
            let h = now.getHours();
            const m = now.getMinutes();
            const period = h >= 12 ? 'PM' : 'AM';
            if (h === 0) h = 12;
            else if (h > 12) h -= 12;
            document.getElementById('in_date').value = getLocalDateString(now);
            document.getElementById('in_period').value = period;
            document.getElementById('in_h').value = h;
            document.getElementById('in_m').value = m;
            saveUIState();
            log("🕒 已快速設定為下一分鐘！");
        });

        document.getElementById('btn_half_hr_after_last').addEventListener('click', () => {
            let latestOutTime = null;

            // 1. 優先檢查排程清單中的「簽退」任務
            const list = getSchedules();
            const scheduledOuts = list.filter(t => t.actionText === '簽退');
            if (scheduledOuts.length > 0) {
                scheduledOuts.forEach(t => {
                    const d = new Date(t.targetTime);
                    if (!latestOutTime || d > latestOutTime) {
                        latestOutTime = d;
                    }
                });
            } else {
                // 2. 如果排程中沒有，才去檢查網頁上的「本日簽退時間」
                const grid = document.getElementById(MAIN_PAGE_ID);
                if (grid) {
                    const regex = /本日簽退時間[：:]\s*(\d{2}):(\d{2})/g;
                    let match;
                    const text = grid.innerText;
                    const now = new Date();
                    while ((match = regex.exec(text)) !== null) {
                        const d = new Date();
                        d.setHours(parseInt(match[1]), parseInt(match[2]), 0, 0);
                        // 防呆：如果網頁上顯示的簽退時間比「現在」還晚，代表那是昨天的紀錄（過午夜尚未更新）
                        if (d > now) {
                            d.setDate(d.getDate() - 1);
                        }
                        if (!latestOutTime || d > latestOutTime) {
                            latestOutTime = d;
                        }
                    }
                }
            }

            if (latestOutTime) {
                const nextTime = new Date(latestOutTime.getTime() + 30 * 60000);
                let h = nextTime.getHours();
                const m = nextTime.getMinutes();
                const period = h >= 12 ? 'PM' : 'AM';
                if (h === 0) h = 12;
                else if (h > 12) h -= 12;
                document.getElementById('in_date').value = getLocalDateString(nextTime);
                document.getElementById('in_period').value = period;
                document.getElementById('in_h').value = h;
                document.getElementById('in_m').value = m;
                saveUIState();
                log("🕒 已設定為最後簽退時間後 30 分鐘！");
            } else {
                alert("網頁上與排程中皆找不到簽退紀錄，無法計算時間！");
            }
        });

        const inputs = div.querySelectorAll('select, input');
        inputs.forEach(el => el.addEventListener('change', () => {
            saveUIState();
            if (el.id === 'chk_only_signout' || el.id === 'chk_auto_signout') refreshUI();
        }));

        document.getElementById('target_project').addEventListener('change', (e) => {
            const selectedOpt = e.target.options[e.target.selectedIndex];
            if (selectedOpt) {
                const pType = selectedOpt.getAttribute('data-type');
                document.getElementById('chk_only_signout').checked = (pType === 'signOut');
            }
            saveUIState();
            refreshUI();
        });

        document.getElementById('btn_add_task').addEventListener('click', handleAddTask);
        document.getElementById('btn_auto_batch_schedule').addEventListener('click', handleAutoBatchSchedule);
        document.getElementById('btn_toggle_calendar').addEventListener('click', toggleCalendarModal);

        setTimeout(refreshProjectList, 1500);
        renderScheduleList();

        document.getElementById('schedule_list_container').addEventListener('click', (e) => {
            if(e.target.classList.contains('del-btn')) deleteSchedule(parseInt(e.target.dataset.id));
        });
    }

    function refreshProjectList() {
        const projects = scanProjects();
        let html = '';

        const filteredProjects = projects.filter(p => p.type !== 'none');

        if (filteredProjects.length === 0) {
            html = `<option value="-1" data-type="none">⚠️ 無可操作計畫 (今日已簽退或無按鈕)</option>`;
        } else {
            const currentSelected = document.getElementById('target_project').value;
            filteredProjects.forEach(p => {
                const isSel = (p.btnId === currentSelected) ? 'selected' : '';
                const missingText = (p.missing !== "未知") ? `(缺${p.missing})` : '';
                const icon = p.type === 'signOut' ? '🏃‍♂️(執行中)' : '📝';
                html += `<option value="${p.btnId}" data-type="${p.type}" ${isSel}>${icon} ${p.name} ${missingText}</option>`;
            });
            if (!filteredProjects.some(p => p.btnId === currentSelected) && filteredProjects.length > 0) {
                 html = html.replace(`value="${filteredProjects[0].btnId}"`, `value="${filteredProjects[0].btnId}" selected`);
            }
        }
        document.getElementById('target_project').innerHTML = html;
        refreshUI();
    }

    function refreshUI() {
        const isActionSignOut = document.getElementById('chk_only_signout').checked;
        document.getElementById('lbl_time_setting').innerText = isActionSignOut ? "設定簽退時間" : "設定簽到時間";
        document.getElementById('lbl_time_setting').style.color = isActionSignOut ? "#ffeb3b" : "#2196F3";

        document.getElementById('block_duration_setting').style.display = isActionSignOut ? 'none' : 'block';

        const isAutoOut = document.getElementById('chk_auto_signout').checked;
        document.getElementById('signout_options').style.opacity = isAutoOut ? '1' : '0.5';
        document.getElementById('signout_options').style.pointerEvents = isAutoOut ? 'auto' : 'none';
    }

    function renderScheduleList() {
        const container = document.getElementById('schedule_list_container');
        if (!container) return;
        const list = getSchedules();
        if (list.length === 0) {
            container.innerHTML = '<div style="color:#777; text-align:center; padding: 5px;">目前無排程任務</div>';
            const predictContainer = document.getElementById('prediction_container');
            if (predictContainer) predictContainer.style.display = 'none';
            return;
        }
        let html = '';
        list.forEach((t, i) => {
            const timeStr = formatTime(t.targetTime);
            const actionColor = t.actionText === '簽到' ? '#4CAF50' : '#FF9800';
            html += `
                <div style="display:flex; justify-content:space-between; border-bottom:1px solid #333; padding:3px 0;">
                    <div style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; width:90%;">
                        <span style="color:#aaa;">${i+1}.</span>
                        <span style="color:${actionColor}; font-weight:bold;">[${t.actionText}]</span>
                        <span style="color:#fff;">${timeStr}</span> - <span style="color:#ccc;">${t.projectName}</span>
                    </div>
                    <button class="del-btn" data-id="${t.id}" style="background:none; border:none; color:#f44336; cursor:pointer; font-weight:bold; font-size:14px; padding:0 5px;" title="刪除此任務">✕</button>
                </div>
            `;
        });

        // --- 計算預計剩餘時數 ---
        const allProjects = scanProjects();
        const summary = {};
        list.forEach(t => {
            const baseId = t.projectId.replace('signIn', '').replace('signOut', '');
            if (!summary[baseId]) {
                const matchedOrig = allProjects.find(p => p.btnId.includes(baseId));
                summary[baseId] = { 
                    schedules: [], 
                    name: t.projectName,
                    uiSignIn: matchedOrig ? matchedOrig.signInTime : null 
                };
            }
            summary[baseId].schedules.push(t);
        });

        let predictHtml = '';

        for (const baseId in summary) {
            const proj = summary[baseId];
            proj.schedules.sort((a, b) => a.targetTime - b.targetTime);
            let scheduledHours = 0;
            let hasPair = false;
            let lastIn = null;
            let usedUiSignIn = false;

            let uiSignInTime = null;
            if (proj.uiSignIn) {
                const now = new Date();
                now.setHours(proj.uiSignIn.h, proj.uiSignIn.m, 0, 0);
                uiSignInTime = now.getTime();
            }

            proj.schedules.forEach(t => {
                if (t.actionText === '簽到') {
                    lastIn = t.targetTime;
                } else if (t.actionText === '簽退') {
                    let effectiveIn = lastIn;
                    if (effectiveIn === null && uiSignInTime !== null && !usedUiSignIn) {
                        effectiveIn = uiSignInTime;
                        usedUiSignIn = true;
                    }
                    if (effectiveIn !== null && t.targetTime >= effectiveIn) {
                        const ms = t.targetTime - effectiveIn;
                        scheduledHours += Math.floor(ms / (1000 * 60 * 60));
                        lastIn = null;
                        hasPair = true;
                    }
                }
            });

            if (hasPair) {
                const matchedOrig = allProjects.find(p => p.btnId.includes(baseId));
                let remainText = '';
                if (matchedOrig && matchedOrig.missing && !isNaN(parseInt(matchedOrig.missing))) {
                    const origHours = parseInt(matchedOrig.missing);
                    let remain = origHours - scheduledHours;
                    if (remain < 0) remain = 0;
                    remainText = `，尚缺 <b>${remain}h</b>`;
                }
                
                predictHtml += `<div style="color:#00BCD4; font-size:12px; margin-top:3px; padding-left:5px;">📊 ${proj.name}: 已排 <b>${scheduledHours}h</b>${remainText}</div>`;
            }
        }

        container.innerHTML = html;
        const predictContainer = document.getElementById('prediction_container');
        if (predictContainer) {
            predictContainer.innerHTML = predictHtml;
            predictContainer.style.display = predictHtml === '' ? 'none' : 'block';
        }
    }

    function handleAddTask() {
        const projectSelect = document.getElementById('target_project');
        const projectBtnId = projectSelect.value;

        const allProjects = scanProjects();
        let matchedProj = allProjects.find(p => p.btnId === projectBtnId);

        if (!matchedProj) {
            const altId = projectBtnId.includes('signIn') ? projectBtnId.replace('signIn', 'signOut') : projectBtnId.replace('signOut', 'signIn');
            matchedProj = allProjects.find(p => p.btnId === altId);
        }

        const projectName = matchedProj ? matchedProj.name : "未知計畫";

        if (projectBtnId === "-1" || !matchedProj) {
            alert("❌ 錯誤：目前沒有可操作的計畫按鈕。");
            return;
        }

        const isActionSignOut = document.getElementById('chk_only_signout').checked;
        const actionText = isActionSignOut ? "簽退" : "簽到";

        let inH = parseInt(document.getElementById('in_h').value);
        const inM = parseInt(document.getElementById('in_m').value);
        if (document.getElementById('in_period').value === 'PM' && inH !== 12) inH += 12;
        if (document.getElementById('in_period').value === 'AM' && inH === 12) inH = 0;

        const dateStr = document.getElementById('in_date').value;
        let targetDate;
        if (dateStr) {
            targetDate = new Date(dateStr);
        } else {
            targetDate = new Date();
        }
        targetDate.setHours(inH, inM, 0, 0);

        const todayStr = getLocalDateString(new Date());
        if (dateStr === todayStr && targetDate < new Date()) {
            targetDate.setDate(targetDate.getDate() + 1);
        }

        const list = getSchedules();

        let autoOutDuration = null;
        if (actionText === "簽到" && document.getElementById('chk_auto_signout').checked) {
            autoOutDuration = (parseInt(document.getElementById('out_h').value) * 3600 + parseInt(document.getElementById('out_m').value) * 60) * 1000;
        }

        const newTask = {
            id: Date.now(),
            projectId: projectBtnId,
            projectName: projectName,
            actionText: actionText,
            targetTime: targetDate.getTime()
        };

        list.push(newTask);

        if (actionText === "簽到" && autoOutDuration !== null) {
            const outTargetTime = targetDate.getTime() + autoOutDuration;
            const outTask = {
                id: Date.now() + 1,
                projectId: projectBtnId.replace('signIn', 'signOut'),
                projectName: projectName,
                actionText: "簽退",
                targetTime: outTargetTime
            };
            list.push(outTask);
            log(`✅ 已排入: ${formatTime(newTask.targetTime)} [簽到] 及後續 [簽退]`);
        } else {
            log(`✅ 已排入: ${formatTime(newTask.targetTime)} [${newTask.actionText}]`);
        }

        saveSchedules(list);
        saveUIState();

        if(actionText === "簽到") document.getElementById('in_m').value = (parseInt(document.getElementById('in_m').value) + 5) % 60;
    }

    function handleAutoBatchSchedule() {
        const projectSelect = document.getElementById('target_project');
        const initialProjectBtnId = projectSelect.value;

        const allProjects = scanProjects();
        if (allProjects.length === 0) {
            alert("❌ 錯誤：目前沒有可操作的計畫按鈕。");
            return;
        }

        let matchedProj = allProjects.find(p => p.btnId === initialProjectBtnId);
        if (!matchedProj) {
            const altId = initialProjectBtnId.includes('signIn') ? initialProjectBtnId.replace('signIn', 'signOut') : initialProjectBtnId.replace('signOut', 'signIn');
            matchedProj = allProjects.find(p => p.btnId === altId) || allProjects[0];
        }

        let defaultTarget = 40;
        if (matchedProj.missing !== '不限' && matchedProj.missing !== '未知') {
            defaultTarget = parseFloat(matchedProj.missing.replace('h', ''));
        }

        let projectOptionsHtml = '<option value="ALL_PROJECTS" selected>🌟 全部計畫自動排班 (規劃所有有效計畫)</option>';
        allProjects.forEach(p => {
            projectOptionsHtml += `<option value="${p.btnId}">${p.name} (尚缺: ${p.missing})</option>`;
        });

        // 彈出課表時段排除設定窗
        let modal = document.getElementById('nycu_batch_config_modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'nycu_batch_config_modal';
            modal.style.cssText = 'position:fixed; top:50%; left:50%; transform:translate(-50%, -50%); width:90%; max-width:620px; background:rgba(18, 18, 18, 0.96); backdrop-filter:blur(16px); color:white; padding:25px; border-radius:16px; z-index:2147483647; box-shadow:0 12px 48px rgba(0,0,0,0.8); border: 1px solid rgba(255,255,255,0.15); font-family:"Inter", Arial, sans-serif; display:flex; flex-direction:column; gap:20px;';
            document.body.appendChild(modal);
        }

        let savedEx = {};
        try { savedEx = JSON.parse(localStorage.getItem(KEY_EXCLUDE_TIMES) || '{}'); } catch(e){}

        let savedTimeRange = { startH: 8, endH: 20 };
        try { savedTimeRange = Object.assign(savedTimeRange, JSON.parse(localStorage.getItem(KEY_BATCH_TIME_RANGE) || '{}')); } catch(e){}

        modal.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid rgba(255,255,255,0.1); padding-bottom:15px;">
                <div>
                    <h2 style="margin:0; font-size:22px; color:#9C27B0; font-weight:700;">🔄 智能一鍵整月排班 - 旗艦防撞設定窗</h2>
                    <p style="margin:4px 0 0; font-size:13px; color:#aaa;">支援未來計畫預排、自動閃避已排時段與課表排除</p>
                </div>
                <button id="btn_cancel_batch_modal" style="background:#333; color:#fff; border:1px solid #555; border-radius:8px; padding:8px 16px; font-weight:bold; cursor:pointer;">❌ 取消</button>
            </div>
            <div>
                <label style="display:block; color:#00E676; font-weight:bold; margin-bottom:8px; font-size:14px;">📁 目標排班計畫 (自動連動計畫與尚缺時數):</label>
                <select id="modal_target_project" style="width:100%; padding:10px; background:#111; border:1px solid #444; color:#fff; border-radius:8px; font-size:15px; font-weight:bold;">
                    ${projectOptionsHtml}
                </select>
            </div>
            <div>
                <label style="display:block; color:#2196F3; font-weight:bold; margin-bottom:8px; font-size:14px;">🎯 目標排入總時數 (預設抓取計畫尚缺):</label>
                <input type="number" id="batch_target_hours" value="${defaultTarget}" style="width:100%; padding:10px; background:#111; border:1px solid #444; color:#fff; border-radius:8px; font-size:16px; font-weight:bold;">
            </div>
            <div>
                <label style="display:block; color:#E040FB; font-weight:bold; margin-bottom:8px; font-size:14px;">⏰ 每日簽到退允許範圍 (彈性工時區間):</label>
                <div style="display:flex; gap:15px; align-items:center;">
                    <div style="flex:1; display:flex; align-items:center; background:#111; border:1px solid #444; border-radius:8px; padding:5px 12px;">
                        <span style="color:#aaa; font-size:14px; margin-right:10px;">最早開始點:</span>
                        <input type="number" id="batch_start_hour" min="0" max="23" value="${savedTimeRange.startH}" style="width:100%; padding:6px; background:transparent; border:none; color:#fff; font-size:16px; font-weight:bold; outline:none;">
                        <span style="color:#888; font-size:14px; margin-left:5px;">時</span>
                    </div>
                    <span style="color:#888; font-weight:bold;">~</span>
                    <div style="flex:1; display:flex; align-items:center; background:#111; border:1px solid #444; border-radius:8px; padding:5px 12px;">
                        <span style="color:#aaa; font-size:14px; margin-right:10px;">最晚結束點:</span>
                        <input type="number" id="batch_end_hour" min="1" max="24" value="${savedTimeRange.endH}" style="width:100%; padding:6px; background:transparent; border:none; color:#fff; font-size:16px; font-weight:bold; outline:none;">
                        <span style="color:#888; font-size:14px; margin-left:5px;">時</span>
                    </div>
                </div>
                <div style="margin-top:6px; font-size:12px; color:#aaa;">* 系統將自動在您設定的區間內搜尋空檔，並智能【優先選擇最貼近中午 12 點】的時段排班。</div>
            </div>
            <div>
                <label style="display:block; color:#FF9800; font-weight:bold; margin-bottom:12px; font-size:14px;">🚫 每週排除時段設定 (輸入不要排的時段，留白表可排班):</label>
                <div style="display:grid; grid-template-columns:repeat(4, 1fr); gap:12px;">
                    <div style="background:#1a1a1a; border:1px solid #333; padding:12px; border-radius:8px;">
                        <div style="font-weight:bold; color:#fff; margin-bottom:8px; text-align:center; border-bottom:1px solid #333; padding-bottom:4px;">星期一 (Mon)</div>
                        <input type="text" id="txt_ex_1" placeholder="例: 10:10-12:00, 13:20-15:10" value="${savedEx[1] || ''}" style="width:100%; padding:8px; background:#111; border:1px solid #444; color:#fff; border-radius:6px; font-size:13px; text-align:center;">
                    </div>
                    <div style="background:#1a1a1a; border:1px solid #333; padding:12px; border-radius:8px;">
                        <div style="font-weight:bold; color:#fff; margin-bottom:8px; text-align:center; border-bottom:1px solid #333; padding-bottom:4px;">星期二 (Tue)</div>
                        <input type="text" id="txt_ex_2" placeholder="例: 10:10-12:00, 13:20-15:10" value="${savedEx[2] || ''}" style="width:100%; padding:8px; background:#111; border:1px solid #444; color:#fff; border-radius:6px; font-size:13px; text-align:center;">
                    </div>
                    <div style="background:#1a1a1a; border:1px solid #333; padding:12px; border-radius:8px;">
                        <div style="font-weight:bold; color:#fff; margin-bottom:8px; text-align:center; border-bottom:1px solid #333; padding-bottom:4px;">星期三 (Wed)</div>
                        <input type="text" id="txt_ex_3" placeholder="例: 10:10-12:00, 13:20-15:10" value="${savedEx[3] || ''}" style="width:100%; padding:8px; background:#111; border:1px solid #444; color:#fff; border-radius:6px; font-size:13px; text-align:center;">
                    </div>
                    <div style="background:#1a1a1a; border:1px solid #333; padding:12px; border-radius:8px;">
                        <div style="font-weight:bold; color:#fff; margin-bottom:8px; text-align:center; border-bottom:1px solid #333; padding-bottom:4px;">星期四 (Thu)</div>
                        <input type="text" id="txt_ex_4" placeholder="例: 10:10-12:00, 13:20-15:10" value="${savedEx[4] || ''}" style="width:100%; padding:8px; background:#111; border:1px solid #444; color:#fff; border-radius:6px; font-size:13px; text-align:center;">
                    </div>
                    <div style="background:#1a1a1a; border:1px solid #333; padding:12px; border-radius:8px;">
                        <div style="font-weight:bold; color:#fff; margin-bottom:8px; text-align:center; border-bottom:1px solid #333; padding-bottom:4px;">星期五 (Fri)</div>
                        <input type="text" id="txt_ex_5" placeholder="例: 10:10-12:00, 13:20-15:10" value="${savedEx[5] || ''}" style="width:100%; padding:8px; background:#111; border:1px solid #444; color:#fff; border-radius:6px; font-size:13px; text-align:center;">
                    </div>
                    <div style="background:#1a1a1a; border:1px solid #333; padding:12px; border-radius:8px;">
                        <div style="font-weight:bold; color:#fff; margin-bottom:8px; text-align:center; border-bottom:1px solid #333; padding-bottom:4px;">星期六 (Sat)</div>
                        <input type="text" id="txt_ex_6" placeholder="例: 10:10-12:00, 13:20-15:10" value="${savedEx[6] || ''}" style="width:100%; padding:8px; background:#111; border:1px solid #444; color:#fff; border-radius:6px; font-size:13px; text-align:center;">
                    </div>
                    <div style="background:#1a1a1a; border:1px solid #333; padding:12px; border-radius:8px;">
                        <div style="font-weight:bold; color:#ff5252; margin-bottom:8px; text-align:center; border-bottom:1px solid #333; padding-bottom:4px;">星期日 (Sun)</div>
                        <input type="text" id="txt_ex_0" placeholder="例: 10:10-12:00, 13:20-15:10" value="${savedEx[0] || ''}" style="width:100%; padding:8px; background:#111; border:1px solid #444; color:#fff; border-radius:6px; font-size:13px; text-align:center;">
                    </div>
                </div>
                <div style="margin-top:10px; font-size:12px; color:#888;">* 勞基法規與學校規範：【每 7 日中應有 2 日之休息】。系統將追蹤過去6天上班紀錄，自動確保任意7天內最多只排班 5 天。<br>* 系統依據彈性區間搜尋空檔，並加入真人化隨機時間差。</div>
            </div>
            <button id="btn_confirm_start_batch" style="background:#4CAF50; color:white; border:none; padding:12px; cursor:pointer; width:100%; border-radius:8px; font-weight:bold; font-size:16px; box-shadow:0 4px 15px rgba(76,175,80,0.4);">🚀 確認並開始智能排班</button>
        `;

        modal.style.display = 'flex';

        const batchStartInput = document.getElementById('batch_start_hour');
        const batchEndInput = document.getElementById('batch_end_hour');
        const saveTimeRange = () => {
            try {
                const sH = parseInt(batchStartInput.value) || 8;
                const eH = parseInt(batchEndInput.value) || 20;
                localStorage.setItem(KEY_BATCH_TIME_RANGE, JSON.stringify({ startH: sH, endH: eH }));
            } catch(e){}
        };
        batchStartInput.oninput = saveTimeRange;
        batchEndInput.oninput = saveTimeRange;

        for (let i = 0; i <= 6; i++) {
            const el = document.getElementById(`txt_ex_${i}`);
            if (el) {
                el.oninput = () => {
                    savedEx[i] = el.value.trim();
                    try { localStorage.setItem(KEY_EXCLUDE_TIMES, JSON.stringify(savedEx)); } catch(e){}
                };
            }
        }

        const modalTargetSelect = document.getElementById('modal_target_project');
        const batchTargetInput = document.getElementById('batch_target_hours');

        modalTargetSelect.onchange = () => {
            const currentSelectedId = modalTargetSelect.value;
            if (currentSelectedId === 'ALL_PROJECTS') {
                batchTargetInput.disabled = true;
                batchTargetInput.style.opacity = '0.5';
                const totalMissing = allProjects.reduce((sum, p) => sum + (p.missing === '不限' ? 50 : (parseFloat(p.missing.replace('h', '')) || 0)), 0);
                batchTargetInput.value = totalMissing;
            } else {
                batchTargetInput.disabled = false;
                batchTargetInput.style.opacity = '1';
                const proj = allProjects.find(p => p.btnId === currentSelectedId);
                if (proj && proj.missing !== '不限' && proj.missing !== '未知') {
                    batchTargetInput.value = parseFloat(proj.missing.replace('h', ''));
                } else {
                    batchTargetInput.value = 40;
                }
            }
        };
        modalTargetSelect.onchange();

        document.getElementById('btn_cancel_batch_modal').onclick = () => { modal.style.display = 'none'; };

        function parseExcludeStringToMinutes(str) {
            if (!str) return [];
            const parts = str.split(',');
            const res = [];
            parts.forEach(p => {
                const match = p.trim().match(/^(\d{1,2}):(\d{1,2})\s*-\s*(\d{1,2}):(\d{1,2})$/);
                if (match) {
                    const h1 = parseInt(match[1]), m1 = parseInt(match[2]);
                    const h2 = parseInt(match[3]), m2 = parseInt(match[4]);
                    res.push({ start: h1 * 60 + m1, end: h2 * 60 + m2 });
                }
            });
            return res;
        }

        document.getElementById('btn_confirm_start_batch').onclick = () => {
            const selectedProjectBtnId = modalTargetSelect.value;
            const targetHours = parseFloat(batchTargetInput.value);
            if (selectedProjectBtnId !== 'ALL_PROJECTS' && (isNaN(targetHours) || targetHours <= 0)) {
                alert("❌ 錯誤：未設定有效目標時數，已取消一鍵排滿。");
                return;
            }

            const startH = parseInt(batchStartInput.value) || 8;
            const endH = parseInt(batchEndInput.value) || 20;
            if (startH >= endH) {
                alert("❌ 錯誤：最早開始時間必須小於最晚結束時間。");
                return;
            }

            let proj = null;
            let projectName = "";
            if (selectedProjectBtnId !== 'ALL_PROJECTS') {
                proj = allProjects.find(p => p.btnId === selectedProjectBtnId);
                if (!proj) {
                    alert("❌ 錯誤：找不到指定的計畫資訊。");
                    return;
                }
                projectName = proj.name;
            }

            // 抓取各星期幾的排除設定並儲存至 localStorage
            const excludes = {
                0: document.getElementById('txt_ex_0').value.trim(),
                1: document.getElementById('txt_ex_1').value.trim(),
                2: document.getElementById('txt_ex_2').value.trim(),
                3: document.getElementById('txt_ex_3').value.trim(),
                4: document.getElementById('txt_ex_4').value.trim(),
                5: document.getElementById('txt_ex_5').value.trim(),
                6: document.getElementById('txt_ex_6').value.trim()
            };
            try { localStorage.setItem(KEY_EXCLUDE_TIMES, JSON.stringify(excludes)); } catch(e){}

            modal.style.display = 'none';

            let inH = parseInt(document.getElementById('in_h').value);
            const inM = parseInt(document.getElementById('in_m').value);
            if (document.getElementById('in_period').value === 'PM' && inH !== 12) inH += 12;
            if (document.getElementById('in_period').value === 'AM' && inH === 12) inH = 0;

            const dateStr = document.getElementById('in_date').value;
            let currentDay = dateStr ? new Date(dateStr) : new Date();
            currentDay.setHours(inH, inM, 0, 0);

            const todayStr = getLocalDateString(new Date());
            if (dateStr === todayStr && currentDay < new Date()) {
                currentDay.setDate(currentDay.getDate() + 1);
            }

            const baseList = getSchedules();

            // 定義全能模擬/排班器
            function runSimulation(initialTasks, isCleanOverwrite, simProjName, simTargetH, simSignInId, simSignOutId, simStartDay, simEndDay) {
                const list = [...initialTasks];
                const existingIntervals = [];
                const workedDayStrings = [];
                const sortedExisting = [...list].sort((a, b) => a.targetTime - b.targetTime);
                let pendingSignIn = null;
                let existingProjHours = 0;

                sortedExisting.forEach(t => {
                    const dStr = getLocalDateString(new Date(t.targetTime));
                    if (!workedDayStrings.includes(dStr)) {
                        workedDayStrings.push(dStr);
                    }
                    if (t.actionText === '簽到') {
                        pendingSignIn = t;
                    } else if (t.actionText === '簽退' && pendingSignIn) {
                        existingIntervals.push({ start: pendingSignIn.targetTime, end: t.targetTime });
                        if (t.projectName === simProjName) {
                            existingProjHours += Math.round((t.targetTime - pendingSignIn.targetTime) / 3600000);
                        }
                        pendingSignIn = null;
                    }
                });

                let remainingHours = Math.max(0, simTargetH - existingProjHours);
                let totalGenerated = 0;
                let timeOffset = Date.now() + Math.floor(Math.random() * 100000);
                let simDay = new Date(simStartDay);

                while (remainingHours > 0) {
                    if (simEndDay && simDay > simEndDay) {
                        if (!isCleanOverwrite) {
                            log(`⚠️ 提醒：已達計畫有效截止日，接續模式仍有 ${remainingHours}h 尚缺時數無法排入。`);
                        }
                        break;
                    }

                    // 【過去時間防護機制 1】
                    const now = new Date();
                    now.setSeconds(0, 0);
                    const todayMidnight = new Date(now);
                    todayMidnight.setHours(0, 0, 0, 0);
                    if (simDay < todayMidnight) {
                        simDay = new Date(todayMidnight);
                    }

                    const dayOfWeek = simDay.getDay(); // 0 (Sun) - 6 (Sat)

                    // 學校與勞基法規範：【每 7 日中應有 2 日之休息】
                    let workedCountLast6Days = 0;
                    for (let i = 1; i <= 6; i++) {
                        const checkDate = new Date(simDay);
                        checkDate.setDate(checkDate.getDate() - i);
                        if (workedDayStrings.includes(getLocalDateString(checkDate))) {
                            workedCountLast6Days++;
                        }
                    }

                    if (workedCountLast6Days >= 5) {
                        simDay.setDate(simDay.getDate() + 1);
                        continue;
                    }

                    const startOfDayMs = new Date(simDay);
                    startOfDayMs.setHours(0, 0, 0, 0);
                    const baseDayMs = startOfDayMs.getTime();

                    const userExcludedMinutes = parseExcludeStringToMinutes(excludes[dayOfWeek]);

                    // 【既有行程防護機制】：前後擴張 30 分鐘緩衝，確保目前已排的跟等等要智能排的中間間隔至少半小時
                    const existingMinutes = [];
                    existingIntervals.forEach(iv => {
                        if (iv.end > baseDayMs && iv.start < baseDayMs + 86400000) {
                            const sMin = Math.max(0, Math.floor((iv.start - baseDayMs) / 60000));
                            const eMin = Math.min(1440, Math.ceil((iv.end - baseDayMs) / 60000));
                            existingMinutes.push({ start: sMin - 30, end: eMin + 30 });
                        }
                    });

                    const occupied = [...userExcludedMinutes, ...existingMinutes].sort((a, b) => a.start - b.start);

                    let dailyHours = 0;
                    let minStartT = startH * 60;
                    const maxT = endH * 60;
                    let scheduledAnythingToday = false;

                    // 【過去時間防護機制 2】：如果 simDay 是今天，minStartT 必須從「現在時間 + 5分鐘緩衝」之後開始
                    if (simDay.getFullYear() === now.getFullYear() && 
                        simDay.getMonth() === now.getMonth() && 
                        simDay.getDate() === now.getDate()) {
                        const nowMin = now.getHours() * 60 + now.getMinutes() + 5;
                        if (nowMin > minStartT) {
                            minStartT = nowMin;
                        }
                    }

                    while (remainingHours > 0 && dailyHours < 8) {
                        let curr = minStartT;
                        const freeIntervals = [];
                        occupied.sort((a, b) => a.start - b.start).forEach(occ => {
                            if (occ.start > curr && occ.start < maxT) {
                                freeIntervals.push({ start: curr, end: Math.min(occ.start, maxT) });
                            }
                            if (occ.end > curr) {
                                curr = occ.end;
                            }
                        });
                        if (curr < maxT) {
                            freeIntervals.push({ start: curr, end: maxT });
                        }

                        const validFree = freeIntervals.filter(iv => (iv.end - iv.start) >= 60);
                        if (validFree.length === 0) {
                            break;
                        }

                        // 核心亮點：為了避免大區塊被切碎，若當日還需排較多時數(>4h)，優先選「最早」的空檔；否則選「貼近中午」的空檔
                        validFree.sort((a, b) => {
                            if (remainingHours > 4 && (8 - dailyHours) > 4) {
                                return a.start - b.start;
                            } else {
                                const midA = (a.start + a.end) / 2;
                                const midB = (b.start + b.end) / 2;
                                return Math.abs(midA - 720) - Math.abs(midB - 720);
                            }
                        });

                        const targetIv = validFree[0];
                        const freeMinutes = targetIv.end - targetIv.start;
                        const maxPossibleH = Math.floor(freeMinutes / 60);
                        // 恢復勞基法 4 小時上限，但透過緊湊排列達成極少簽退次數
                        const H = Math.min(4, remainingHours, 8 - dailyHours, maxPossibleH);

                        if (H >= 1) {
                            const neededMinutes = H * 60;
                            const willNeedMore = (remainingHours - H > 0) && (dailyHours + H < 8);
                            
                            let baseStartMin;
                            if (willNeedMore) {
                                baseStartMin = targetIv.start; // 緊靠起始點，保留最大連續空間給下一個區塊
                            } else {
                                const idealStart = 720 - Math.floor(neededMinutes / 2);
                                baseStartMin = Math.max(targetIv.start, Math.min(targetIv.end - neededMinutes, idealStart));
                            }

                            const extraBuffer = (targetIv.end - baseStartMin) - neededMinutes;
                            const maxStartJitter = willNeedMore ? 0 : Math.min(5, Math.max(0, Math.floor(extraBuffer / 2)));
                            const startJitterMinutes = maxStartJitter > 0 ? Math.floor(Math.random() * (maxStartJitter + 1)) : 0;
                            const actualStartMin = baseStartMin + startJitterMinutes;
                            const signInTimeMs = baseDayMs + actualStartMin * 60000;

                            const remainBuffer = (targetIv.end - actualStartMin) - neededMinutes;
                            const maxEndJitter = willNeedMore ? Math.min(5, remainBuffer) : Math.min(15, Math.max(0, remainBuffer));
                            const endJitterMinutes = maxEndJitter > 0 ? Math.floor(Math.random() * (maxEndJitter + 1)) : 0;
                            const actualEndMin = actualStartMin + H * 60 + endJitterMinutes;
                            const signOutTimeMs = baseDayMs + actualEndMin * 60000;

                            list.push({
                                id: timeOffset++,
                                projectId: simSignInId,
                                projectName: simProjName,
                                actionText: "簽到",
                                targetTime: signInTimeMs
                            });

                            list.push({
                                id: timeOffset++,
                                projectId: simSignOutId,
                                projectName: simProjName,
                                actionText: "簽退",
                                targetTime: signOutTimeMs
                            });

                            existingIntervals.push({ start: signInTimeMs, end: signOutTimeMs });
                            totalGenerated += 2;
                            remainingHours -= H;
                            dailyHours += H;
                            scheduledAnythingToday = true;

                            occupied.push({ start: actualStartMin - 30, end: actualEndMin + 30 });
                        } else {
                            break;
                        }
                    }

                    if (scheduledAnythingToday) {
                        const curStr = getLocalDateString(simDay);
                        if (!workedDayStrings.includes(curStr)) {
                            workedDayStrings.push(curStr);
                        }
                    }

                    simDay.setDate(simDay.getDate() + 1);
                }

                let finalProjHours = 0;
                let tempSignIn = null;
                const sortedFinal = [...list].sort((a, b) => a.targetTime - b.targetTime);
                sortedFinal.forEach(t => {
                    if (t.projectName === simProjName) {
                        if (t.actionText === '簽到') {
                            tempSignIn = t;
                        } else if (t.actionText === '簽退' && tempSignIn) {
                            finalProjHours += Math.round((t.targetTime - tempSignIn.targetTime) / 3600000);
                            tempSignIn = null;
                        }
                    }
                });

                return {
                    list,
                    totalGenerated,
                    totalHours: finalProjHours,
                    remainingHours: Math.max(0, simTargetH - finalProjHours)
                };
            }

            if (selectedProjectBtnId === 'ALL_PROJECTS') {
                const validProjects = allProjects.filter(p => (p.missing === '不限' || parseFloat(p.missing.replace('h', '')) > 0));
                if (validProjects.length === 0) {
                    alert("✅ 系統檢測：目前所有計畫均已滿排或無尚缺時數！");
                    return;
                }

                let anyExisting = false;
                validProjects.forEach(p => {
                    if (baseList.some(t => t.projectName === p.name)) anyExisting = true;
                });

                function scheduleAllProjects(initialList, isCleanMode) {
                    let currentList = [...initialList];
                    let totalGen = 0;
                    let totalH = 0;
                    let remHSum = 0;

                    validProjects.forEach(p => {
                        const pName = p.name;
                        const pTargetH = p.missing === '不限' ? 50 : parseFloat(p.missing.replace('h', ''));
                        const pSignInId = p.btnId.includes('signIn') ? p.btnId : p.btnId.replace('signOut', 'signIn');
                        const pSignOutId = p.btnId.includes('signOut') ? p.btnId : p.btnId.replace('signIn', 'signOut');

                        let pHasSignedIn = false;
                        let pInProgressSignOut = null;
                        const pExistingTasks = currentList.filter(t => t.projectName === pName);
                        const pSortedExisting = [...pExistingTasks].sort((a, b) => a.targetTime - b.targetTime);
                        if (pSortedExisting.length > 0 && pSortedExisting[0].actionText === '簽退') {
                            pHasSignedIn = true;
                            pInProgressSignOut = pSortedExisting[0];
                        }
                        if (p.timeText && p.timeText.includes('簽到') && !p.timeText.includes('簽退')) {
                            pHasSignedIn = true;
                            if (pSortedExisting.length > 0 && pSortedExisting[0].actionText === '簽退') {
                                pInProgressSignOut = pSortedExisting[0];
                            }
                        }

                        let pBaseList = currentList;
                        if (isCleanMode) {
                            pBaseList = currentList.filter(t => {
                                if (t.projectName !== pName) return true;
                                if (pHasSignedIn && pInProgressSignOut && t.id === pInProgressSignOut.id) return true;
                                return false;
                            });
                        }

                        let pCurrentDay = new Date(currentDay);
                        if (p.startDate) {
                            const pStart = new Date(p.startDate);
                            pStart.setHours(inH, inM, 0, 0);
                            if (pCurrentDay < pStart) {
                                pCurrentDay = new Date(pStart);
                            }
                        }
                        let pProjEnd = null;
                        if (p.endDate) {
                            pProjEnd = new Date(p.endDate);
                            pProjEnd.setHours(23, 59, 59, 999);
                        }

                        const res = runSimulation(pBaseList, isCleanMode, pName, pTargetH, pSignInId, pSignOutId, pCurrentDay, pProjEnd);
                        currentList = res.list;
                        totalGen += res.totalGenerated;
                        totalH += res.totalHours;
                        remHSum += res.remainingHours;
                    });

                    return { list: currentList, totalGenerated: totalGen, totalHours: totalH, remainingHours: remHSum };
                }

                const allInc = scheduleAllProjects(baseList, false);
                const allClean = scheduleAllProjects(baseList, true);
                const targetSum = validProjects.reduce((sum, p) => sum + (p.missing === '不限' ? 50 : parseFloat(p.missing.replace('h', ''))), 0);

                let isAllCleanBetter = false;
                let allReasonText = "";
                if (allClean.totalHours > allInc.totalHours) {
                    isAllCleanBetter = true;
                    allReasonText = `演算法重新完美排班能突破多計畫間的既有時段碰撞，總共多排入 ${allClean.totalHours - allInc.totalHours} 個小時！`;
                } else if (allClean.totalHours === targetSum && allInc.totalHours < targetSum) {
                    isAllCleanBetter = true;
                    allReasonText = `演算法重新排班能完美幫所有計畫補滿總尚缺時數 ${targetSum}h，達到 100% 滿排！`;
                } else if (allClean.totalHours === allInc.totalHours && allClean.totalGenerated < allInc.totalGenerated) {
                    isAllCleanBetter = true;
                    allReasonText = `重新排班能減少各計畫間的零碎切割，提供更完整、連續且更貼近中午 12 點的絕佳作息結構！`;
                } else if (allClean.totalHours === allInc.totalHours && allClean.totalHours === targetSum) {
                    isAllCleanBetter = true;
                    allReasonText = `清除舊單重新排班，能讓所有計畫的時段完全對齊您設定的最新工時範圍，並完美置中貼近中午 12 點！`;
                }

                if (anyExisting && isAllCleanBetter) {
                    let optModal = document.getElementById('nycu_ai_opt_modal');
                    if (!optModal) {
                        optModal = document.createElement('div');
                        optModal.id = 'nycu_ai_opt_modal';
                        optModal.style.cssText = 'position:fixed; top:50%; left:50%; transform:translate(-50%, -50%); width:90%; max-width:580px; background:rgba(18, 18, 18, 0.98); backdrop-filter:blur(16px); color:white; padding:25px; border-radius:16px; z-index:2147483647; box-shadow:0 12px 48px rgba(0,0,0,0.8); border: 1px solid rgba(255,255,255,0.15); font-family:"Inter", Arial, sans-serif; display:flex; flex-direction:column; gap:15px;';
                        document.body.appendChild(optModal);
                    }
                    optModal.innerHTML = `
                        <div style="border-bottom:1px solid rgba(255,255,255,0.1); padding-bottom:12px;">
                            <h3 style="color:#00E676; margin:0 0 6px; font-size:20px;">✨ 系統排班試算建議 (Smart Scheduling Simulation)</h3>
                            <p style="color:#aaa; margin:0; font-size:13px;">系統檢測到 <b>全部計畫</b> 中部分計畫已有預排任務，且重新排班效果更佳！</p>
                        </div>
                        <div style="font-size:14px; color:#fff;">
                            <div style="background:#111; padding:16px; border-radius:10px; border:1px solid #333; display:flex; flex-direction:column; gap:12px;">
                                <div style="border-bottom:1px solid #222; padding-bottom:10px;">
                                    <div style="color:#aaa; font-size:13px; margin-bottom:4px;"><b>方案 A：保留既有清單，僅接續補班 (傳統模式)</b></div>
                                    <div style="font-size:15px;">可排入總時數：<span style="color:#2196F3; font-weight:bold;">${allInc.totalHours}h</span> (尚缺 ${allInc.remainingHours}h) | 新增任務：${allInc.totalGenerated} 筆</div>
                                </div>
                                <div>
                                    <div style="color:#aaa; font-size:13px; margin-bottom:4px;"><b>方案 B：清除未執行的舊排程，演算法重新完美排班 (推薦)</b></div>
                                    <div style="font-size:15px; margin-bottom:6px;">可排入總時數：<span style="color:#00E676; font-weight:bold;">${allClean.totalHours}h</span> (尚缺 ${allClean.remainingHours}h) | 新增任務：${allClean.totalGenerated} 筆</div>
                                    <div style="color:#FF9800; font-size:13px; background:rgba(255,152,0,0.1); padding:8px 12px; border-radius:6px;">💡 <i>演算法試算：${allReasonText}</i></div>
                                </div>
                            </div>
                        </div>
                        <p style="color:#ccc; font-size:14px; margin:0;">請問您要選擇哪一種排班策略？</p>
                        <div style="display:flex; gap:15px; margin-top:10px;">
                            <button id="btn_choose_clean" style="flex:1; background:#4CAF50; color:white; border:none; padding:12px; border-radius:8px; font-weight:bold; cursor:pointer; font-size:15px; box-shadow:0 4px 15px rgba(76,175,80,0.4);">✨ 重新完美排班 (推薦)</button>
                            <button id="btn_choose_inc" style="flex:1; background:#2196F3; color:white; border:none; padding:12px; border-radius:8px; font-weight:bold; cursor:pointer; font-size:15px;">➕ 保留舊單接續排</button>
                        </div>
                    `;
                    optModal.style.display = 'flex';

                    document.getElementById('btn_choose_clean').onclick = () => {
                        optModal.style.display = 'none';
                        saveSchedules(allClean.list);
                        saveUIState();
                        log(`🎉 全部計畫重新完美排班成功！已生成共 ${allClean.totalGenerated} 筆任務，滿足總時數 ${allClean.totalHours}h。`);
                    };
                    document.getElementById('btn_choose_inc').onclick = () => {
                        optModal.style.display = 'none';
                        saveSchedules(allInc.list);
                        saveUIState();
                        log(`🎉 全部計畫接續補班成功！已新增共 ${allInc.totalGenerated} 筆任務，滿足總時數 ${allInc.totalHours}h。`);
                    };
                    return;
                }

                saveSchedules(allInc.list);
                saveUIState();
                log(`🎉 全部計畫智能一鍵排班成功！已生成共 ${allInc.totalGenerated} 筆任務，滿足總時數 ${allInc.totalHours}h。`);
                return;
            }

            const baseSignInId = selectedProjectBtnId.includes('signIn') ? selectedProjectBtnId : selectedProjectBtnId.replace('signOut', 'signIn');
            const baseSignOutId = selectedProjectBtnId.includes('signOut') ? selectedProjectBtnId : selectedProjectBtnId.replace('signIn', 'signOut');

            const existingProjectTasks = baseList.filter(t => t.projectName === projectName);
            let hasAlreadySignedIn = false;
            let inProgressSignOutTask = null;

            const sortedProjTasks = [...existingProjectTasks].sort((a, b) => a.targetTime - b.targetTime);
            if (sortedProjTasks.length > 0 && sortedProjTasks[0].actionText === '簽退') {
                hasAlreadySignedIn = true;
                inProgressSignOutTask = sortedProjTasks[0];
            }
            if (proj.timeText && proj.timeText.includes('簽到') && !proj.timeText.includes('簽退')) {
                hasAlreadySignedIn = true;
                if (sortedProjTasks.length > 0 && sortedProjTasks[0].actionText === '簽退') {
                    inProgressSignOutTask = sortedProjTasks[0];
                }
            }

            const cleanBaseList = baseList.filter(t => {
                if (t.projectName !== projectName) return true;
                if (hasAlreadySignedIn && inProgressSignOutTask && t.id === inProgressSignOutTask.id) return true;
                return false;
            });

            let pCurDay = new Date(currentDay);
            if (proj.startDate) {
                const pStart = new Date(proj.startDate);
                pStart.setHours(inH, inM, 0, 0);
                if (pCurDay < pStart) {
                    pCurDay = new Date(pStart);
                }
            }
            let pProjEnd = null;
            if (proj.endDate) {
                pProjEnd = new Date(proj.endDate);
                pProjEnd.setHours(23, 59, 59, 999);
            }

            const simInc = runSimulation(baseList, false, projectName, targetHours, baseSignInId, baseSignOutId, pCurDay, pProjEnd);
            const simClean = runSimulation(cleanBaseList, true, projectName, targetHours, baseSignInId, baseSignOutId, pCurDay, pProjEnd);

            let isCleanBetter = false;
            let reasonText = "";
            if (simClean.totalHours > simInc.totalHours) {
                isCleanBetter = true;
                reasonText = `重新排班能突破既有時段碰撞，多排入 ${simClean.totalHours - simInc.totalHours} 個小時！`;
            } else if (simClean.totalHours === targetHours && simInc.totalHours < targetHours) {
                isCleanBetter = true;
                reasonText = `重新排班能完美補滿尚缺時數 ${targetHours}h，達到 100% 滿排！`;
            } else if (simClean.totalHours === simInc.totalHours && simClean.totalGenerated < simInc.totalGenerated) {
                isCleanBetter = true;
                reasonText = `重新排班能減少零碎切割，提供更完整、連續且更貼近中午 12 點的絕佳作息結構！`;
            } else if (simClean.totalHours === simInc.totalHours && simClean.totalHours === targetHours) {
                isCleanBetter = true;
                reasonText = `清除舊單重新排班，能讓所有時段完全對齊您設定的最新工時範圍，並完美置中貼近中午 12 點！`;
            }

            if (existingProjectTasks.length > 0 && isCleanBetter) {
                let optModal = document.getElementById('nycu_ai_opt_modal');
                if (!optModal) {
                    optModal = document.createElement('div');
                    optModal.id = 'nycu_ai_opt_modal';
                    optModal.style.cssText = 'position:fixed; top:50%; left:50%; transform:translate(-50%, -50%); width:90%; max-width:580px; background:rgba(18, 18, 18, 0.98); backdrop-filter:blur(16px); color:white; padding:25px; border-radius:16px; z-index:2147483647; box-shadow:0 12px 48px rgba(0,0,0,0.8); border: 1px solid rgba(255,255,255,0.15); font-family:"Inter", Arial, sans-serif; display:flex; flex-direction:column; gap:15px;';
                    document.body.appendChild(optModal);
                }
                optModal.innerHTML = `
                    <div style="border-bottom:1px solid rgba(255,255,255,0.1); padding-bottom:12px;">
                        <h3 style="color:#00E676; margin:0 0 6px; font-size:20px;">✨ 系統排班試算建議 (Smart Scheduling Simulation)</h3>
                        <p style="color:#aaa; margin:0; font-size:13px;">系統檢測到 <b>${projectName}</b> 目前已有預排任務，且重新排班效果更佳！</p>
                    </div>
                    <div style="font-size:14px; color:#fff;">
                        ${hasAlreadySignedIn ? '<div style="background:rgba(33,150,243,0.15); border:1px solid #2196F3; padding:10px 15px; border-radius:8px; margin-bottom:15px; color:#64B5F6;">📌 <b>狀態檢測</b>：您目前【已簽到】，系統將自動為您保留當次簽退任務，安全無虞！</div>' : ''}
                        <div style="background:#111; padding:16px; border-radius:10px; border:1px solid #333; display:flex; flex-direction:column; gap:12px;">
                            <div style="border-bottom:1px solid #222; padding-bottom:10px;">
                                <div style="color:#aaa; font-size:13px; margin-bottom:4px;"><b>方案 A：保留既有清單，僅接續補班 (傳統模式)</b></div>
                                <div style="font-size:15px;">可排入總時數：<span style="color:#2196F3; font-weight:bold;">${simInc.totalHours}h</span> (尚缺 ${simInc.remainingHours}h) | 新增任務：${simInc.totalGenerated} 筆</div>
                            </div>
                            <div>
                                <div style="color:#aaa; font-size:13px; margin-bottom:4px;"><b>方案 B：清除未執行的舊排程，演算法重新完美排班 (推薦)</b></div>
                                <div style="font-size:15px; margin-bottom:6px;">可排入總時數：<span style="color:#00E676; font-weight:bold;">${simClean.totalHours}h</span> (尚缺 ${simClean.remainingHours}h) | 新增任務：${simClean.totalGenerated} 筆</div>
                                <div style="color:#FF9800; font-size:13px; background:rgba(255,152,0,0.1); padding:8px 12px; border-radius:6px;">💡 <i>演算法試算：${reasonText}</i></div>
                            </div>
                        </div>
                    </div>
                    <p style="color:#ccc; font-size:14px; margin:0;">請問您要選擇哪一種排班策略？</p>
                    <div style="display:flex; gap:15px; margin-top:10px;">
                        <button id="btn_choose_clean" style="flex:1; background:#4CAF50; color:white; border:none; padding:12px; border-radius:8px; font-weight:bold; cursor:pointer; font-size:15px; box-shadow:0 4px 15px rgba(76,175,80,0.4);">✨ 重新完美排班 (推薦)</button>
                        <button id="btn_choose_inc" style="flex:1; background:#2196F3; color:white; border:none; padding:12px; border-radius:8px; font-weight:bold; cursor:pointer; font-size:15px;">➕ 保留舊單接續排</button>
                    </div>
                `;
                optModal.style.display = 'flex';

                document.getElementById('btn_choose_clean').onclick = () => {
                    optModal.style.display = 'none';
                    saveSchedules(simClean.list);
                    saveUIState();
                    log(`🎉 重新完美排班成功！已生成共 ${simClean.totalGenerated} 筆任務，滿足總時數 ${simClean.totalHours}h。`);
                };
                document.getElementById('btn_choose_inc').onclick = () => {
                    optModal.style.display = 'none';
                    saveSchedules(simInc.list);
                    saveUIState();
                    log(`🎉 接續補班成功！已新增共 ${simInc.totalGenerated} 筆任務，滿足總時數 ${simInc.totalHours}h。`);
                };
                return;
            }

            // 否則直接執行預設儲存 (simInc)
            saveSchedules(simInc.list);
            saveUIState();
            log(`🎉 智能一鍵排班成功！已生成共 ${simInc.totalGenerated} 筆任務，滿足總時數 ${simInc.totalHours}h。`);
        };
    }

    let currentCalendarYear = new Date().getFullYear();
    let currentCalendarMonth = new Date().getMonth(); // 0-11

    function toggleCalendarModal() {
        let modal = document.getElementById('nycu_calendar_modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'nycu_calendar_modal';
            modal.style.cssText = 'position:fixed; top:50%; left:50%; transform:translate(-50%, -50%); width:95%; max-width:1050px; max-height:95vh; background:rgba(18, 18, 18, 0.96); backdrop-filter:blur(16px); color:white; padding:15px 22px; border-radius:16px; z-index:2147483647; box-shadow:0 12px 48px rgba(0,0,0,0.8); border: 1px solid rgba(255,255,255,0.15); font-family:"Inter", Arial, sans-serif; display:flex; flex-direction:column; gap:12px; overflow-y:auto;';
            
            modal.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid rgba(255,255,255,0.1); padding-bottom:12px;">
                    <div>
                        <h2 style="margin:0; font-size:20px; color:#00B0FF; font-weight:700;">📅 視覺化打卡行事曆 (Visual Attendance Calendar)</h2>
                        <p style="margin:4px 0 0; font-size:12px; color:#aaa;">隨時監控並檢視當月份每一天的排程簽到退、計畫顯示期間與每週禁止排班時段</p>
                    </div>
                    <div style="display:flex; gap:10px;">
                        <button id="btn_toggle_cal_filters" style="background:#00838F; color:#fff; border:1px solid #00ACC1; border-radius:8px; padding:8px 14px; font-weight:bold; cursor:pointer; font-size:13px;">⚙️ 顯示選項 ▼</button>
                        <button id="btn_close_calendar" style="background:#333; color:#fff; border:1px solid #555; border-radius:8px; padding:8px 16px; font-weight:bold; cursor:pointer; font-size:13px;">❌ 關閉</button>
                    </div>
                </div>
                <div style="display:flex; justify-content:space-between; align-items:center; background:#1c1c1c; padding:8px 18px; border-radius:8px; border:1px solid #333;">
                    <button id="btn_cal_prev" style="background:#2a2a2a; color:white; border:1px solid #444; padding:6px 14px; border-radius:6px; font-weight:bold; cursor:pointer; font-size:13px;">◀ 上個月</button>
                    <h3 id="cal_month_title" style="margin:0; font-size:17px; color:#ffeb3b; font-weight:bold;">2026年 6月</h3>
                    <button id="btn_cal_next" style="background:#2a2a2a; color:white; border:1px solid #444; padding:6px 14px; border-radius:6px; font-weight:bold; cursor:pointer; font-size:13px;">下個月 ▶</button>
                </div>
                <div id="cal_options_container" style="display:none; position:absolute; top:65px; right:22px; background:#151515; padding:12px 16px; border-radius:8px; border:1px solid #444; flex-direction:column; gap:12px; align-items:flex-start; font-size:12px; z-index:999; box-shadow:0 8px 32px rgba(0,0,0,0.9);">
                    <span style="color:#00E676; font-weight:bold; margin-bottom:4px; border-bottom:1px solid #333; padding-bottom:6px; width:100%; display:block;">⚙️ 選項提供要顯示什麼 (Display Filters):</span>
                    <label style="display:flex; align-items:center; gap:6px; cursor:pointer; color:#fff;"><input type="checkbox" id="chk_hide_past_weeks" checked> 僅顯示本週起 (隱藏過去週)</label>
                    <label style="display:flex; align-items:center; gap:6px; cursor:pointer; color:#fff;"><input type="checkbox" id="chk_show_proj_duration" checked> 顯示計畫顯示期間</label>
                    <label style="display:flex; align-items:center; gap:6px; cursor:pointer; color:#fff;"><input type="checkbox" id="chk_show_ex_times" checked> 顯示星期不能排時段</label>
                    <label style="display:flex; align-items:center; gap:6px; cursor:pointer; color:#fff;"><input type="checkbox" id="chk_show_task_details" checked> 顯示打卡任務明細</label>
                    <label style="display:flex; align-items:center; gap:6px; cursor:pointer; color:#fff;"><input type="checkbox" id="chk_show_daily_hours" checked> 顯示當日累積工時</label>
                </div>
                <div id="cal_proj_duration_container" style="display:none;"></div>
                <div id="cal_grid_container" style="flex-grow:1;"></div>
            `;
            document.body.appendChild(modal);

            try {
                const savedOpts = JSON.parse(localStorage.getItem('NYCU_CALENDAR_DISPLAY_OPTS') || '{"past":true,"proj":true,"ex":true,"task":true,"hours":true}');
                document.getElementById('chk_hide_past_weeks').checked = savedOpts.past ?? true;
                document.getElementById('chk_show_proj_duration').checked = savedOpts.proj ?? true;
                document.getElementById('chk_show_ex_times').checked = savedOpts.ex ?? true;
                document.getElementById('chk_show_task_details').checked = savedOpts.task ?? true;
                document.getElementById('chk_show_daily_hours').checked = savedOpts.hours ?? true;
            } catch(e){}

            const saveAndRender = () => {
                const opts = {
                    past: document.getElementById('chk_hide_past_weeks').checked,
                    proj: document.getElementById('chk_show_proj_duration').checked,
                    ex: document.getElementById('chk_show_ex_times').checked,
                    task: document.getElementById('chk_show_task_details').checked,
                    hours: document.getElementById('chk_show_daily_hours').checked
                };
                try { localStorage.setItem('NYCU_CALENDAR_DISPLAY_OPTS', JSON.stringify(opts)); } catch(e){}
                renderCalendarGrid();
            };

            document.getElementById('chk_hide_past_weeks').addEventListener('change', saveAndRender);
            document.getElementById('chk_show_proj_duration').addEventListener('change', saveAndRender);
            document.getElementById('chk_show_ex_times').addEventListener('change', saveAndRender);
            document.getElementById('chk_show_task_details').addEventListener('change', saveAndRender);
            document.getElementById('chk_show_daily_hours').addEventListener('change', saveAndRender);

            document.getElementById('btn_toggle_cal_filters').addEventListener('click', () => {
                const optBox = document.getElementById('cal_options_container');
                const btn = document.getElementById('btn_toggle_cal_filters');
                if (optBox.style.display === 'none') {
                    optBox.style.display = 'flex';
                    btn.innerText = '⚙️ 顯示選項 ▲';
                } else {
                    optBox.style.display = 'none';
                    btn.innerText = '⚙️ 顯示選項 ▼';
                }
            });

            document.getElementById('btn_close_calendar').addEventListener('click', () => { modal.style.display = 'none'; });
            document.getElementById('btn_cal_prev').addEventListener('click', () => {
                currentCalendarMonth--;
                if (currentCalendarMonth < 0) { currentCalendarMonth = 11; currentCalendarYear--; }
                renderCalendarGrid();
            });
            document.getElementById('btn_cal_next').addEventListener('click', () => {
                currentCalendarMonth++;
                if (currentCalendarMonth > 11) { currentCalendarMonth = 0; currentCalendarYear++; }
                renderCalendarGrid();
            });
        } else {
            modal.style.display = modal.style.display === 'none' ? 'flex' : 'none';
        }

        if (modal.style.display !== 'none') {
            currentCalendarYear = new Date().getFullYear();
            currentCalendarMonth = new Date().getMonth();
            renderCalendarGrid();
        }
    }

    function renderCalendarGrid() {
        const title = document.getElementById('cal_month_title');
        const container = document.getElementById('cal_grid_container');
        const projContainer = document.getElementById('cal_proj_duration_container');
        if (!title || !container) return;

        title.innerText = `${currentCalendarYear}年 ${currentCalendarMonth + 1}月`;

        const btnPrev = document.getElementById('btn_cal_prev');
        const nowObj = new Date();
        if (btnPrev) {
            if (currentCalendarYear < nowObj.getFullYear() || (currentCalendarYear === nowObj.getFullYear() && currentCalendarMonth <= nowObj.getMonth())) {
                btnPrev.disabled = true;
                btnPrev.style.opacity = '0.3';
                btnPrev.style.cursor = 'not-allowed';
                btnPrev.title = '過去月份無排程紀錄';
            } else {
                btnPrev.disabled = false;
                btnPrev.style.opacity = '1';
                btnPrev.style.cursor = 'pointer';
                btnPrev.title = '';
            }
        }

        const showProj = document.getElementById('chk_show_proj_duration')?.checked ?? true;
        const showEx = document.getElementById('chk_show_ex_times')?.checked ?? true;
        const showTask = document.getElementById('chk_show_task_details')?.checked ?? true;
        const showHours = document.getElementById('chk_show_daily_hours')?.checked ?? true;

        const allProjs = scanProjects();
        if (projContainer) {
            projContainer.style.display = 'none';
        }

        const list = getSchedules();
        const firstDay = new Date(currentCalendarYear, currentCalendarMonth, 1).getDay(); // 0 (Sun) - 6 (Sat)
        const daysInMonth = new Date(currentCalendarYear, currentCalendarMonth + 1, 0).getDate();

        let savedEx = {};
        try { savedEx = JSON.parse(localStorage.getItem(KEY_EXCLUDE_TIMES) || '{}'); } catch(e){}

        const getExHtml = (dayIdx) => {
            if (!showEx) return '';
            const val = savedEx[dayIdx];
            if (val) {
                return `<div style="font-size:11px; color:#FF9800; background:#2a2a2a; padding:3px 4px; border-radius:4px; margin-top:6px; border:1px solid #444; font-weight:normal; word-break:break-all;" title="${val}">🚫 排除:<br>${val}</div>`;
            } else {
                return `<div style="font-size:11px; color:#4CAF50; background:#1e2e1e; padding:3px 4px; border-radius:4px; margin-top:6px; border:1px solid #2e4e2e; font-weight:normal;">✅ 全日可排</div>`;
            }
        };

        let gridHtml = `
            <div style="display:grid; grid-template-columns:repeat(7, 1fr); gap:8px; text-align:center; font-weight:bold; font-size:14px; margin-bottom:12px; color:#bbb;">
                <div><span style="color:#ff5555;">日 (Sun)</span>${getExHtml(0)}</div>
                <div><span>一 (Mon)</span>${getExHtml(1)}</div>
                <div><span>二 (Tue)</span>${getExHtml(2)}</div>
                <div><span>三 (Wed)</span>${getExHtml(3)}</div>
                <div><span>四 (Thu)</span>${getExHtml(4)}</div>
                <div><span>五 (Fri)</span>${getExHtml(5)}</div>
                <div><span style="color:#4CAF50;">六 (Sat)</span>${getExHtml(6)}</div>
            </div>
            <div style="display:grid; grid-template-columns:repeat(7, 1fr); gap:0; border-top:1px solid #2a2a2a; border-left:1px solid #2a2a2a; background:#121212; border-radius:8px; overflow:hidden; box-shadow:0 8px 32px rgba(0,0,0,0.5);">
        `;

        let cells = [];
        for (let i = 0; i < firstDay; i++) {
            cells.push({ type: 'blank' });
        }
        for (let d = 1; d <= daysInMonth; d++) {
            cells.push({ type: 'day', date: d });
        }

        const now = new Date();
        const isCurrentMonth = (currentCalendarYear === now.getFullYear() && currentCalendarMonth === now.getMonth());
        const hidePastWeeks = document.getElementById('chk_hide_past_weeks')?.checked ?? true;

        let startWeekIdx = 0;
        if (isCurrentMonth && hidePastWeeks) {
            const todayDate = now.getDate();
            const todayCellIdx = cells.findIndex(c => c.type === 'day' && c.date === todayDate);
            if (todayCellIdx !== -1) {
                startWeekIdx = Math.floor(todayCellIdx / 7);
            }
        }

        const visibleCells = cells.slice(startWeekIdx * 7);
        const todayStr = getLocalDateString(now);

        const projColors = [
            { bg: '#0288D1', fg: '#ffffff' }, // 藍色
            { bg: '#E65100', fg: '#ffffff' }, // 橘色
            { bg: '#2E7D32', fg: '#ffffff' }, // 綠色
            { bg: '#6A1B9A', fg: '#ffffff' }, // 紫色
            { bg: '#C2185B', fg: '#ffffff' }, // 粉紅
            { bg: '#00838F', fg: '#ffffff' }  // 青綠
        ];

        // 篩選出本月有效的計畫，以確保每項計畫在每一天皆在固定的垂直行高
        const activeMonthProjs = allProjs.filter(p => {
            if (!p.startDate || !p.endDate) return true;
            const pStart = new Date(p.startDate.trim()).setHours(0,0,0,0);
            const pEnd = new Date(p.endDate.trim()).setHours(23,59,59,999);
            const monthStart = new Date(currentCalendarYear, currentCalendarMonth, 1).getTime();
            const monthEnd = new Date(currentCalendarYear, currentCalendarMonth + 1, 0, 23, 59, 59).getTime();
            return pEnd >= monthStart && pStart <= monthEnd;
        });

        visibleCells.forEach((cell, cellIdx) => {
            const isLastCol = (cellIdx % 7 === 6);
            if (cell.type === 'blank') {
                gridHtml += `<div style="background:#161616; opacity:0.4; border-right:1px solid #2a2a2a; border-bottom:1px solid #2a2a2a; min-height:100px;"></div>`;
            } else {
                const d = cell.date;
                const thisDateStr = getLocalDateString(new Date(currentCalendarYear, currentCalendarMonth, d));
                const isToday = (thisDateStr === todayStr);

                const dayTasks = list.filter(t => {
                    const tDateStr = getLocalDateString(new Date(t.targetTime));
                    return tDateStr === thisDateStr;
                });
                dayTasks.sort((a,b) => a.targetTime - b.targetTime);

                let dayHours = 0;
                let currentInTime = null;
                dayTasks.forEach(task => {
                    if (task.actionText === '簽到') {
                        currentInTime = task.targetTime;
                    } else if (task.actionText === '簽退' && currentInTime) {
                        const diffMins = Math.floor((task.targetTime - currentInTime) / (60 * 1000));
                        dayHours += Math.floor(diffMins / 60);
                        currentInTime = null;
                    }
                });

                let activeProjsHtml = '';
                if (showProj) {
                    const currTime = new Date(currentCalendarYear, currentCalendarMonth, d).getTime();
                    activeMonthProjs.forEach((p, pIdx) => {
                        let isActive = false;
                        let isStart = false;
                        let isEnd = false;

                        if (p.startDate && p.endDate) {
                            const pStart = new Date(p.startDate.trim()).setHours(0,0,0,0);
                            const pEnd = new Date(p.endDate.trim()).setHours(23,59,59,999);
                            if (currTime >= pStart && currTime <= pEnd) {
                                isActive = true;
                                const pStartStr = getLocalDateString(new Date(p.startDate.trim()));
                                const pEndStr = getLocalDateString(new Date(p.endDate.trim()));
                                if (thisDateStr === pStartStr || cellIdx % 7 === 0 || cellIdx === 0) isStart = true;
                                if (thisDateStr === pEndStr || cellIdx % 7 === 6 || cellIdx === visibleCells.length - 1) isEnd = true;
                            }
                        } else {
                            isActive = true;
                            if (cellIdx % 7 === 0 || cellIdx === 0) isStart = true;
                            if (cellIdx % 7 === 6 || cellIdx === visibleCells.length - 1) isEnd = true;
                        }

                        if (isActive) {
                            const c = projColors[pIdx % projColors.length];
                            const cleanName = p.name.split(' (')[0];
                            const text = isStart ? `${cleanName} (尚缺: ${p.missing})` : '&nbsp;';
                            const mLeft = isStart ? '4px' : '-6px';
                            const mRight = isEnd ? '4px' : '-6px';
                            const rad = `${isStart ? '4px' : '0'} ${isEnd ? '4px' : '0'} ${isEnd ? '4px' : '0'} ${isStart ? '4px' : '0'}`;
                            
                            activeProjsHtml += `
                                <div style="background:${c.bg}; color:${c.fg}; margin:0 ${mRight} 3px ${mLeft}; padding:2px 6px; border-radius:${rad}; font-size:12px; font-weight:bold; text-align:left; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; height:20px; line-height:16px; position:relative; z-index:${isEnd ? 1 : 2}; box-shadow:0 1px 3px rgba(0,0,0,0.3);" title="${cleanName} (尚缺: ${p.missing})">
                                    ${text}
                                </div>
                            `;
                        } else {
                            activeProjsHtml += `<div style="height:23px; margin-bottom:3px;"></div>`;
                        }
                    });
                }

                let tasksHtml = '';
                if (showTask) {
                    dayTasks.forEach(task => {
                        const timeStr = new Date(task.targetTime).toTimeString().substring(0,5);
                        const isSignIn = task.actionText === '簽到';
                        const bg = isSignIn ? 'rgba(76, 175, 80, 0.15)' : 'rgba(244, 67, 54, 0.15)';
                        const fg = isSignIn ? '#4CAF50' : '#f44336';
                        
                        tasksHtml += `
                            <div style="background:${bg}; color:${fg}; padding:3px 6px; border-radius:4px; font-size:11px; margin-bottom:4px; text-align:left; display:flex; justify-content:space-between; align-items:center; border:1px solid ${fg};" title="${task.projectName}">
                                <span>${timeStr} [${task.actionText}]</span>
                                <span style="font-size:9px; color:#888;">${task.projectName.substring(0,6)}...</span>
                            </div>
                        `;
                    });
                }

                const hourBadge = (showHours && dayHours > 0) ? `<div style="margin:6px 0 0; background:#2a2a2a; color:#00BCD4; font-size:11px; font-weight:bold; padding:2px 4px; border-radius:4px; text-align:center; border:1px solid #00BCD4;">⏳ 當日工時: ${dayHours}h</div>` : '';
                const borderStyle = isToday ? 'border-right:1px solid #00B0FF; border-bottom:1px solid #00B0FF; border-left:1px solid #00B0FF; box-shadow:inset 0 0 12px rgba(0, 176, 255, 0.3);' : 'border-right:1px solid #2a2a2a; border-bottom:1px solid #2a2a2a;';
                const headBg = isToday ? 'background:#00B0FF; color:#000;' : 'background:#242424; color:#bbb; border-bottom:1px solid #2a2a2a;';

                gridHtml += `
                    <div style="background:#1c1c1c; ${borderStyle} overflow:hidden; display:flex; flex-direction:column; min-height:100px;">
                        <div style="padding:4px 8px; font-size:12px; font-weight:bold; text-align:right; ${headBg} margin-bottom:6px;">
                            ${d} ${isToday ? ' (今日)' : ''}
                        </div>
                        <div style="padding:0 0 6px 0; flex-grow:1; display:flex; flex-direction:column; justify-content:space-between;">
                            <div>
                                ${activeProjsHtml}
                                <div style="padding:0 6px;">
                                    ${tasksHtml}
                                </div>
                            </div>
                            <div style="padding:0 6px;">${hourBadge}</div>
                        </div>
                    </div>
                `;
            }
        });

        gridHtml += `</div>`;
        container.innerHTML = gridHtml;
    }

    function checkKeepAlive() {
        const lastRefresh = parseInt(getStorage(KEY_LAST_REFRESH) || 0);
        const now = Date.now();
        if (lastRefresh > 0 && (now - lastRefresh > KEEP_ALIVE_INTERVAL_MINUTES * 60 * 1000)) {
            log("🔄 執行防斷線背景保持連線 (無感 Keep-Alive)...");
            setStorage(KEY_LAST_REFRESH, now);
            fetch(location.href, { method: 'HEAD' }).catch(() => {});
            return false;
        }
        return false;
    }

    function runLoop() {
        updateHeartbeat();
        if (checkKeepAlive()) return;

        let list = getSchedules();
        if (list.length === 0) {
            updateTabTitle("受僱者線上簽到退");
            return;
        }

        const now = Date.now();
        const nextTask = list[0];
        const timeLeft = nextTask.targetTime - now;

        updateTabTitle(`[剩 ${formatCountDown(timeLeft)}] ${nextTask.actionText}`);

        if (now >= nextTask.targetTime) {
            log(`⏰ 啟動任務：[${nextTask.projectName}] ${nextTask.actionText}`);

            list.shift();
            saveSchedules(list);

            let btn = getActionButtonById(nextTask.projectId);

            if (nextTask.actionText === '簽到' && (!btn || btn.id.includes('signOut'))) {
                let newId = nextTask.projectId.replace('signOut', 'signIn');
                btn = getActionButtonById(newId);
            } else if (nextTask.actionText === '簽退' && (!btn || btn.id.includes('signIn'))) {
                let newId = nextTask.projectId.replace('signIn', 'signOut');
                btn = getActionButtonById(newId);
            }

            if (!btn) {
                const scan = scanProjects();
                const typeNeeded = nextTask.actionText === '簽退' ? 'signOut' : 'signIn';
                let fuzzy = scan.find(p => p.type === typeNeeded && p.name === nextTask.projectName);
                if (!fuzzy) {
                     // 退一步，比對前半段名稱
                     fuzzy = scan.find(p => p.type === typeNeeded && p.name.includes(nextTask.projectName.split(' (')[0]));
                }
                if (fuzzy) btn = document.getElementById(fuzzy.btnId);
            }

            if (btn) {
                setStorage(KEY_EXECUTING_TASK, JSON.stringify(nextTask));
                btn.click();
            } else {
                log(`❌ 錯誤：找不到對應的${nextTask.actionText}按鈕！可能是時數已滿或頁面未更新。`);
                sendLineNotify(nextTask.actionText, nextTask.projectName, 'error');
                localStorage.removeItem(KEY_EXECUTING_TASK);
            }
        } else {
            log(`⏳ 下一步: ${formatTime(nextTask.targetTime)} 準備${nextTask.actionText}\n剩餘: ${formatCountDown(timeLeft)}`);
        }
    }

    function checkConfirmPage() {
        const confirmBtn = document.getElementById(CONFIRM_BTN_ID);
        if (!confirmBtn) return;
        const executingTaskJson = getStorage(KEY_EXECUTING_TASK);
        if (!executingTaskJson) return;

        let task = JSON.parse(executingTaskJson);
        const isDebug = getStorage(KEY_DEBUG_MODE) === 'true';

        // === 自動處理單選框與填寫理由 ===
        const radios = Array.from(document.querySelectorAll('input[type="radio"]'));
        let targetRadio = radios.find(r => {
            if (r.value && r.value.includes('其他')) return true;
            const label = document.querySelector(`label[for="${r.id}"]`);
            if (label && label.innerText.includes('其他')) return true;
            if (r.parentElement && r.parentElement.innerText.includes('其他')) return true;
            return false;
        });
        if (!targetRadio && radios.length > 0) {
            targetRadio = radios[radios.length - 1];
        }
        if (targetRadio) {
            targetRadio.checked = true;
            targetRadio.dispatchEvent(new Event('change', { bubbles: true }));
            targetRadio.dispatchEvent(new Event('click', { bubbles: true }));
            console.log("已自動選擇「其他」選項");
        }

        const textInputs = Array.from(document.querySelectorAll('input[type="text"]'));
        let targetInput = textInputs.find(input => !input.readOnly && !input.disabled);
        if (targetInput) {
            targetInput.value = "忘記即時簽退";
            targetInput.dispatchEvent(new Event('input', { bubbles: true }));
            targetInput.dispatchEvent(new Event('change', { bubbles: true }));
            console.log("已自動填入「忘記即時簽退」");
        }
        // ==================================

        if (isDebug) {
            confirmBtn.style.border = "5px solid #ff4444";
            confirmBtn.style.boxShadow = "0 0 10px red";
            log("🛑 Debug模式：攔截送出，請手動按確認");
            sendLineNotify(`[測試] ${task.actionText}`, task.projectName, 'success', -1);
            localStorage.removeItem(KEY_EXECUTING_TASK);
            return;
        }

        log(`🤖 自動確認${task.actionText}...`);

        localStorage.removeItem(KEY_EXECUTING_TASK);
        setStorage(KEY_LAST_REFRESH, Date.now());

        const pendingNotify = {
            actionText: task.actionText,
            projectName: task.projectName
        };
        setStorage(KEY_PENDING_NOTIFY, JSON.stringify(pendingNotify));

        setTimeout(() => {
            confirmBtn.click();
            setTimeout(() => { window.location.href = './OnlineProjectAttend_NYCU.aspx'; }, 1000);
        }, 500);
    }

    setInterval(() => {
        if (!document.getElementById('nycu_helper_panel')) createPanel();
        
        const isMaster = checkMaster();
        const panelTitle = document.getElementById('panel_title');
        
        if (panelTitle) {
            const baseTitle = panelTitle.innerHTML.split(' <span')[0];
            if (!isMaster) {
                panelTitle.innerHTML = baseTitle + ' <span style="color:#f44336; font-size:11px; margin-left:5px;">(休眠中💤)</span>';
            } else {
                panelTitle.innerHTML = baseTitle + ' <span style="color:#4CAF50; font-size:11px; margin-left:5px;">(主控端👑)</span>';
            }
        }

        if (isMaster && getSchedules().length > 0) runLoop();
    }, 1000);

    function initApp() {
        if (checkLogoutAndRedirect()) return;

        if (document.getElementById(MAIN_PAGE_ID)) {
            createPanel();
            if(!getStorage(KEY_LAST_REFRESH)) setStorage(KEY_LAST_REFRESH, Date.now());

            const pendingNotifyStr = getStorage(KEY_PENDING_NOTIFY);
            if (pendingNotifyStr) {
                try {
                    const notifyData = JSON.parse(pendingNotifyStr);
                    const allProjects = scanProjects();
                    const matchedProj = allProjects.find(p => p.name === notifyData.projectName);
                    const newMissingHours = matchedProj ? matchedProj.missing : "未知";

                    sendLineNotify(notifyData.actionText, notifyData.projectName, 'success', newMissingHours);
                } catch (e) {
                    console.error("處理延遲通知時發生錯誤:", e);
                }
                localStorage.removeItem(KEY_PENDING_NOTIFY);
            }

        } else if (document.getElementById(CONFIRM_BTN_ID)) {
            checkConfirmPage();
        }
    }

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        initApp();
    } else {
        window.addEventListener('load', initApp);
    }

})();
