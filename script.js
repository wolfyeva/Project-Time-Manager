// ==UserScript==
// @name        自動簽到退排程助手
// @namespace   http://tampermonkey.net/
// @version     1
// @description 啟動後可隨時更改預約時間並即時生效；維持 F5 自動校時與彈窗攔截功能。
// @author      Gemini
// @match       *://timeclock.nycu.edu.tw/*
// @grant       none
// @run-at      document-start
// ==/UserScript==

(function() {
    'use strict';

    // ==========================================
    // 第一階段：核彈級攔截 (針對原生彈窗)
    // ==========================================
    window.alert = function(msg) { console.log('🚫 成功攔截 Alert:', msg); return true; };
    window.confirm = function(msg) { console.log('🚫 成功攔截 Confirm:', msg); return true; };
    window.prompt = function(msg) { console.log('🚫 成功攔截 Prompt:', msg); return null; };

    function checkAndRedirect() {
        const currentUrl = window.location.href;
        const bodyText = document.body ? document.body.innerText : "";
        const isTimeoutUrl = currentUrl.includes('TimeOut.aspx') || currentUrl.includes('Logout');
        const isJsonError = bodyText.includes('Action not found') || bodyText.includes('"status":"false"');
        const isTextError = bodyText.includes('您尚未登入') || bodyText.includes('已逾時');

        if (isTimeoutUrl || isJsonError || isTextError) {
            console.log("⚡ 偵測到失效狀態，強制導回 Portal 重登...");
            window.stop();
            window.location.href = "https://portal.nycu.edu.tw/";
            return true;
        }
        return false;
    }

    if(checkAndRedirect()) return;

    // ==========================================
    // 第二階段：排程主邏輯
    // ==========================================
    document.addEventListener('DOMContentLoaded', function() {
        if(checkAndRedirect()) return;
        runMainScript();
    });

    setInterval(checkAndRedirect, 2000);

    function runMainScript() {
        // --- 設定區 & 狀態管理 ---
        const STORAGE_PREFIX = 'nycu_attendance_v22_';
        const KEY_STATUS = STORAGE_PREFIX + 'status';
        const KEY_TARGET_TIME = STORAGE_PREFIX + 'target_time';
        const KEY_SIGNOUT_DURATION = STORAGE_PREFIX + 'signout_duration';
        const KEY_SIGNOUT_TIME_DISPLAY = STORAGE_PREFIX + 'signout_time_display';
        const KEY_DEBUG_MODE = STORAGE_PREFIX + 'debug_mode';
        const KEY_PROJECT_INDEX = STORAGE_PREFIX + 'project_index';
        const KEY_PROJECT_NAME = STORAGE_PREFIX + 'project_name';
        const KEY_UI_STATE = STORAGE_PREFIX + 'ui_state';
        const KEY_LAST_REFRESH = STORAGE_PREFIX + 'last_refresh';
        const KEY_IS_COLLAPSED = STORAGE_PREFIX + 'is_collapsed';

        const MAIN_PAGE_ID = 'ContentPlaceHolder1_GridView_attend';
        const CONFIRM_BTN_ID = 'ContentPlaceHolder1_Button_attend';
        const KEEP_ALIVE_INTERVAL_MINUTES = 5;

        // --- 工具函式 ---
        function log(msg) {
            console.log(`[自動助手] ${msg}`);
            const display = document.getElementById('helper_msg_display');
            if (display) display.innerText = msg;
            const miniDisplay = document.getElementById('helper_mini_msg');
            if (miniDisplay) miniDisplay.innerText = msg.replace(/\n/g, ' ');
        }

        function updateHeartbeat() {
            const now = new Date();
            const timeStr = now.toLocaleTimeString('zh-TW', { hour12: false });
            const el = document.getElementById('helper_heartbeat');
            if (el) el.innerText = `💓 最後運作: ${timeStr}`;
        }

        function updateTabTitle(text) {
            document.title = text + " - 線上簽到退";
        }

        function getStorage(key) { return localStorage.getItem(key); }
        function setStorage(key, val) { localStorage.setItem(key, val); }

        function clearExecutionState() {
            localStorage.removeItem(KEY_STATUS);
            localStorage.removeItem(KEY_TARGET_TIME);
            localStorage.removeItem(KEY_SIGNOUT_DURATION);
            localStorage.removeItem(KEY_SIGNOUT_TIME_DISPLAY);
            localStorage.removeItem(KEY_DEBUG_MODE);
            document.title = "受僱者線上簽到退";
        }

        function formatTime(dateObj) {
            const d = new Date(dateObj);
            return d.toLocaleTimeString('zh-TW', { hour12: false });
        }

        function formatCountDown(ms) {
            if (ms < 0) return "00:00:00";
            const h = Math.floor((ms % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
            const m = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
            const s = Math.floor((ms % (1000 * 60)) / 1000);
            return `${h}時${m}分${s}秒`;
        }

        // --- 核心：掃描網頁上的計畫 ---
        function scanProjects() {
            const grid = document.getElementById(MAIN_PAGE_ID);
            if (!grid) return [];

            const projectList = [];
            const buttons = Array.from(grid.querySelectorAll('a[id*="LinkButton_signIn"], a[id*="LinkButton_signOut"]'));

            buttons.forEach((btn, index) => {
                let tr = btn.closest('tr');
                if (tr) {
                    const tds = tr.querySelectorAll('td');
                    let name = "未知計畫";
                    let missingHours = -1;

                    if (tds.length > 0) {
                        const text = tds[0].innerText;
                        if (text.includes('\n')) {
                            name = text.split('\n')[0].trim();
                        } else {
                            name = text.trim();
                        }
                        const match = text.match(/尚缺\s*[：:]\s*(\d+)\s*小時/);
                        if (match && match[1]) {
                            missingHours = parseInt(match[1], 10);
                        }
                    }
                    const type = btn.id.includes('signIn') ? 'signIn' : 'signOut';
                    projectList.push({ index, name, missing: missingHours, btnId: btn.id, type });
                }
            });
            return projectList;
        }

        function getActionButtonById(id) {
            return document.getElementById(id);
        }

        // --- 智慧預設值 ---
        function calculateSmartDefaults() {
            const projects = scanProjects();
            const now = new Date();
            now.setMinutes(now.getMinutes() + 1); // 預設下一分鐘

            let defaultInPeriod = now.getHours() >= 12 ? 'PM' : 'AM';
            let defaultInH = now.getHours() % 12;
            if (defaultInH === 0) defaultInH = 12;
            let defaultInM = now.getMinutes();

            const availableSignIn = projects.filter(p => p.type === 'signIn' && p.missing !== 0);

            let targetId = "";
            let defaultOutH = 1;
            let defaultOutM = 1;

            if (availableSignIn.length > 0) {
                targetId = availableSignIn[0].btnId;
                const p = availableSignIn[0];
                if (p.missing > 0 && p.missing <= 4) {
                    defaultOutH = p.missing;
                    defaultOutM = 1;
                }
            }

            return {
                inPeriod: defaultInPeriod,
                inH: defaultInH,
                inM: defaultInM,
                projectIndex: targetId,
                outH: defaultOutH,
                outM: defaultOutM,
                chkSignOut: true,
                chkDebug: false,
                chkOnlySignOut: false
            };
        }

        function saveUIState() {
            if (!document.getElementById('nycu_helper_panel')) return;

            const state = {
                projectIndex: document.getElementById('target_project').value,
                inPeriod: document.getElementById('in_period').value,
                inH: document.getElementById('in_h').value,
                inM: document.getElementById('in_m').value,
                chkSignOut: document.getElementById('chk_auto_signout').checked,
                chkOnlySignOut: document.getElementById('chk_only_signout').checked,
                outH: document.getElementById('out_h').value,
                outM: document.getElementById('out_m').value,
                chkDebug: document.getElementById('chk_debug_mode').checked
            };
            setStorage(KEY_UI_STATE, JSON.stringify(state));
        }

        function getInitialState() {
            const savedStateJson = getStorage(KEY_UI_STATE);
            if (savedStateJson) {
                try {
                    return JSON.parse(savedStateJson);
                } catch (e) {
                    console.error("UI State Parse Error", e);
                }
            }
            return calculateSmartDefaults();
        }

        function createSpecificOptions(values, selectedVal, pad = false) {
            let html = '';
            values.forEach(v => {
                 let txt = pad ? v.toString().padStart(2, '0') : v;
                 const isSel = (v == selectedVal) ? 'selected' : '';
                 html += `<option value="${v}" ${isSel}>${txt}</option>`;
            });
            return html;
        }

        function createRangeOptions(start, end, selectedVal, pad = false) {
            let html = '';
            for (let i = start; i <= end; i++) {
                let val = i;
                let txt = pad ? i.toString().padStart(2, '0') : i;
                const isSel = (i == selectedVal) ? 'selected' : '';
                html += `<option value="${val}" ${isSel}>${txt}</option>`;
            }
            return html;
        }

        // --- 事件處理：更新工時 (簽退時間) ---
        function handleDurationChange() {
            const outH = parseInt(document.getElementById('out_h').value);
            const outM = parseInt(document.getElementById('out_m').value);
            const newDuration = (outH * 3600 + outM * 60) * 1000;

            const status = getStorage(KEY_STATUS);
            saveUIState();

            // 如果正在等待簽退 (且不是因為"只執行簽退"模式進來的，是簽到後進來的)，則更新目標時間
            // 這裡的邏輯是：如果是 waiting_signout，我們就假設這是基於工時的
            if (status === 'waiting_signout') {
                const isOnlySignOut = document.getElementById('chk_only_signout').checked;
                // 只有在「非」只執行簽退模式下（即：自動簽退模式），調整工時才應該影響簽退時間
                // 如果是「只執行簽退」，那簽退時間是由上面的時間選擇器控制的，不該由工時控制
                if (!isOnlySignOut) {
                     const oldTarget = parseInt(getStorage(KEY_TARGET_TIME));
                     const oldDuration = parseInt(getStorage(KEY_SIGNOUT_DURATION));
                     if (oldTarget && oldDuration) {
                        const startTime = oldTarget - oldDuration;
                        const newTarget = startTime + newDuration;
                        setStorage(KEY_TARGET_TIME, newTarget);
                        setStorage(KEY_SIGNOUT_TIME_DISPLAY, formatTime(newTarget));
                        log(`🔄 工時已更新！\n新簽退時間：${formatTime(newTarget)}`);
                     }
                }
            }
            setStorage(KEY_SIGNOUT_DURATION, newDuration);
        }

        // --- 事件處理：更新預約時間 (新功能) ---
        function handleTargetTimeChange() {
            const status = getStorage(KEY_STATUS);
            if (!status) return; // 沒在跑排程就不處理

            const isOnlySignOut = document.getElementById('chk_only_signout').checked;

            // 判斷是否允許更新：
            // 1. 正在等待簽到 (waiting_signin) -> 當然要更新
            // 2. 正在等待簽退 (waiting_signout) 且 是「只執行簽退」模式 -> 也要更新
            const canUpdate = (status === 'waiting_signin') || (status === 'waiting_signout' && isOnlySignOut);

            if (!canUpdate) return;

            const period = document.getElementById('in_period').value;
            let inH = parseInt(document.getElementById('in_h').value);
            const inM = parseInt(document.getElementById('in_m').value);
            if (period === 'PM' && inH !== 12) inH += 12;
            if (period === 'AM' && inH === 12) inH = 0;

            const now = new Date();
            const targetDate = new Date();
            targetDate.setHours(inH, inM, 0, 0);

            // 如果時間已過，自動設為明天 (保持一致性)
            if (targetDate < now) {
                targetDate.setDate(targetDate.getDate() + 1);
            }

            setStorage(KEY_TARGET_TIME, targetDate.getTime());
            if (status === 'waiting_signout') {
                setStorage(KEY_SIGNOUT_TIME_DISPLAY, formatTime(targetDate));
            }

            log(`🔄 預約時間已更新為：${targetDate.toLocaleString()}`);
            saveUIState();
        }

        function createPanel() {
            if (document.getElementById('nycu_helper_panel')) return;

            let state = getInitialState();
            const isCollapsed = getStorage(KEY_IS_COLLAPSED) === 'true';
            const currentStatus = getStorage(KEY_STATUS);
            const isRunning = (currentStatus === 'waiting_signin' || currentStatus === 'waiting_signout');

            if (!isRunning) {
                const smartDefaults = calculateSmartDefaults();
                state.inPeriod = smartDefaults.inPeriod;
                state.inH = smartDefaults.inH;
                state.inM = smartDefaults.inM;
            }

            const div = document.createElement('div');
            div.id = 'nycu_helper_panel';
            div.style.cssText = 'position:fixed; bottom:10px; right:10px; background:rgba(0,0,0,0.9); color:white; padding:10px; border-radius:8px; z-index:2147483647; box-shadow:0 0 15px rgba(0,0,0,0.7); font-family:Arial, sans-serif; width: 320px; border: 1px solid #444; transition: all 0.3s ease;';

            const toggleBtnStyle = 'float:right; cursor:pointer; font-weight:bold; color:#ccc; border:1px solid #555; padding:0 5px; border-radius:3px; background:#333; margin-left:10px;';
            const titleText = isRunning ? "🟢 V27.2 任務進行中" : "📅 自動簽到退 V1";
            const titleColor = isRunning ? "#4CAF50" : "#2196F3";

            div.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:5px;">
                    <h3 id="panel_title" style="margin:0; font-size:16px; color:${titleColor};">${titleText}</h3>
                    <span id="btn_panel_toggle" style="${toggleBtnStyle}" title="縮小/展開">${isCollapsed ? '⬜' : '➖'}</span>
                </div>
                <div id="panel_content_mini" style="display:${isCollapsed ? 'block' : 'none'}; color:yellow; font-size:13px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                    <span id="helper_mini_msg">等待操作...</span>
                </div>
                <div id="panel_content_full" style="display:${isCollapsed ? 'none' : 'block'};">
                    <div style="margin-bottom: 8px;">
                        <label style="color:#ffeb3b; font-weight:bold; cursor:pointer;">
                            <input type="checkbox" id="chk_only_signout" ${state.chkOnlySignOut ? 'checked' : ''}> 只執行簽退 (不簽到)
                        </label>
                    </div>
                    <div style="margin-bottom: 10px; background:#222; padding:8px; border-radius:4px; border-left: 4px solid #9C27B0;">
                        <div style="color:#ba68c8; font-weight:bold; margin-bottom:5px;">0. 選擇目標計畫</div>
                        <select id="target_project" style="padding:5px; width:100%; font-size:14px;">
                            <option>讀取中...</option>
                        </select>
                    </div>
                    <div style="margin-bottom: 10px; background:#222; padding:8px; border-radius:4px; border-left: 4px solid #2196F3;">
                        <div id="lbl_time_setting" style="color:#2196F3; font-weight:bold; margin-bottom:5px;">1. 預約簽到時間</div>
                        <select id="in_period" style="padding:2px; margin-right:5px;">
                            <option value="AM" ${state.inPeriod === 'AM' ? 'selected' : ''}>上午</option>
                            <option value="PM" ${state.inPeriod === 'PM' ? 'selected' : ''}>下午</option>
                        </select>
                        <select id="in_h" style="padding:2px;">${createRangeOptions(1, 12, state.inH)}</select> 點
                        <select id="in_m" style="padding:2px;">${createRangeOptions(0, 59, state.inM, true)}</select> 分
                    </div>
                    <div id="block_duration_setting" style="margin-bottom: 10px; background:#222; padding:8px; border-radius:4px; border-left: 4px solid #FF9800;">
                        <div style="color:#FF9800; font-weight:bold; margin-bottom:5px;">
                            <label style="cursor:pointer;">
                                <input type="checkbox" id="chk_auto_signout" ${state.chkSignOut ? 'checked' : ''}> 2. 自動簽退 (工作時長)
                            </label>
                        </div>
                        <div id="signout_options" style="opacity: ${state.chkSignOut ? '1' : '0.5'}; pointer-events: ${state.chkSignOut ? 'auto' : 'none'}; padding-left: 5px;">
                            簽到後，工作<br>
                            <select id="out_h" style="padding:2px;">
                                ${createSpecificOptions([0, 1, 2, 3, 4], state.outH)}
                            </select> 小時
                            <select id="out_m" style="padding:2px;">
                                ${createSpecificOptions([1, 5, 10, 15, 30], state.outM, true)}
                            </select> 分鐘
                        </div>
                    </div>
                    <div style="margin-bottom: 10px; border-top: 1px solid #555; padding-top: 5px;">
                        <label style="color: #ff5555; font-size: 13px; cursor: pointer; display: flex; align-items: center;">
                            <input type="checkbox" id="chk_debug_mode" style="margin-right: 5px;" ${state.chkDebug ? 'checked' : ''}> 🐞 Debug Mode (不按確認)
                        </label>
                    </div>
                    <div id="helper_heartbeat" style="font-size:11px; color:#888; text-align:right; margin-bottom:5px;">💓 初始化中...</div>
                    <button id="btn_start_task" style="background:#4CAF50; color:white; border:none; padding:10px; cursor:pointer; width:100%; border-radius:4px; font-weight:bold; font-size:14px; display:${isRunning ? 'none' : 'block'};">啟動排程</button>
                    <button id="btn_stop_task" style="background:#f44336; color:white; border:none; padding:8px; cursor:pointer; width:100%; border-radius:4px; margin-top:5px; display:${isRunning ? 'block' : 'none'};">❌ 停止排程</button>
                    <div id="helper_msg_display" style="margin-top:10px; color:#FFFF00; font-size:13px; text-align:center; line-height: 1.4;">
                        ${isRunning ? '恢復執行中...' : '設定完成請按啟動'}
                    </div>
                </div>
            `;
            document.body.appendChild(div);

            const toggleBtn = document.getElementById('btn_panel_toggle');
            const contentFull = document.getElementById('panel_content_full');
            const contentMini = document.getElementById('panel_content_mini');

            toggleBtn.addEventListener('click', () => {
                const currentlyCollapsed = contentFull.style.display === 'none';
                if (currentlyCollapsed) {
                    contentFull.style.display = 'block';
                    contentMini.style.display = 'none';
                    toggleBtn.innerText = '➖';
                    setStorage(KEY_IS_COLLAPSED, 'false');
                } else {
                    contentFull.style.display = 'none';
                    contentMini.style.display = 'block';
                    toggleBtn.innerText = '⬜';
                    setStorage(KEY_IS_COLLAPSED, 'true');
                }
            });

            const inputs = div.querySelectorAll('select, input');
            inputs.forEach(el => el.addEventListener('change', saveUIState));

            const chkOnlySignOut = document.getElementById('chk_only_signout');
            const chkAutoSignOut = document.getElementById('chk_auto_signout');
            const outH = document.getElementById('out_h');
            const outM = document.getElementById('out_m');
            const blockDuration = document.getElementById('block_duration_setting');
            const lblTime = document.getElementById('lbl_time_setting');
            const optsDiv = document.getElementById('signout_options');
            const selectProject = document.getElementById('target_project');
            const inPeriod = document.getElementById('in_period');
            const inH = document.getElementById('in_h');
            const inM = document.getElementById('in_m');

            // 綁定更新事件
            [outH, outM].forEach(el => el.addEventListener('change', handleDurationChange));
            [inPeriod, inH, inM].forEach(el => el.addEventListener('change', handleTargetTimeChange));

            function refreshProjectList() {
                const isOnlySignOut = chkOnlySignOut.checked;
                const projects = scanProjects();
                let html = '';

                const filteredProjects = projects.filter(p => {
                    const typeMatch = isOnlySignOut ? (p.type === 'signOut') : (p.type === 'signIn');
                    let hoursMatch = true;
                    if (!isOnlySignOut) {
                        hoursMatch = (p.missing !== 0);
                    }
                    return typeMatch && hoursMatch;
                });

                if (filteredProjects.length === 0) {
                    const typeName = isOnlySignOut ? "可簽退" : "可簽到";
                    html = `<option value="-1">⚠️ 無${typeName}計畫 (等待中...)</option>`;
                } else {
                    filteredProjects.forEach(p => {
                        const isSel = (p.btnId === state.projectIndex) ? 'selected' : '';
                        const missingText = (p.missing > 0 && !isOnlySignOut) ? `(缺${p.missing}h)` : '';
                        const icon = isOnlySignOut ? '🏁' : '📝';
                        html += `<option value="${p.btnId}" ${isSel}>${icon} ${p.name} ${missingText}</option>`;
                    });
                }
                selectProject.innerHTML = html;
            }

            function refreshUI() {
                if (chkOnlySignOut.checked) {
                    lblTime.innerText = "1. 預約簽退時間";
                    lblTime.style.color = "#ffeb3b";
                    blockDuration.style.display = 'none';
                } else {
                    lblTime.innerText = "1. 預約簽到時間";
                    lblTime.style.color = "#2196F3";
                    blockDuration.style.display = 'block';
                }

                const isActive = chkAutoSignOut.checked;
                optsDiv.style.opacity = isActive ? '1' : '0.5';
                optsDiv.style.pointerEvents = isActive ? 'auto' : 'none';

                const status = getStorage(KEY_STATUS);
                const isRunning = (status === 'waiting_signin' || status === 'waiting_signout');

                // 預設全部啟用
                selectProject.disabled = false;
                chkOnlySignOut.disabled = false;
                inPeriod.disabled = false;
                inH.disabled = false;
                inM.disabled = false;

                if (isRunning) {
                    // 執行中：鎖定重要設定，防止邏輯炸裂
                    selectProject.disabled = true;
                    chkOnlySignOut.disabled = true;

                    // 智慧鎖定時間選單：
                    // 如果目前是「等待簽退」且「不是」只執行簽退模式 (代表是簽到後進來的)
                    // 這時候調整「簽到時間」已經沒意義了，鎖定它以免誤導
                    const isWaitingSignOutFromAuto = (status === 'waiting_signout' && !chkOnlySignOut.checked);
                    if (isWaitingSignOutFromAuto) {
                        inPeriod.disabled = true;
                        inH.disabled = true;
                        inM.disabled = true;
                        // 此時使用者應該去調整下方的「工作時長」來改變簽退時間
                    }
                    // 其他情況 (等待簽到 OR 等待簽退且只執行簽退)，時間選單保持開啟，隨時可調
                }

                refreshProjectList();
            }

            refreshUI();
            setTimeout(refreshProjectList, 2000);

            chkOnlySignOut.addEventListener('change', refreshUI);
            chkAutoSignOut.addEventListener('change', refreshUI);

            document.getElementById('btn_start_task').addEventListener('click', startTask);
            document.getElementById('btn_stop_task').addEventListener('click', stopTask);
        }

        function updatePanelState(isRunning) {
            const btnStart = document.getElementById('btn_start_task');
            const btnStop = document.getElementById('btn_stop_task');
            const projectSelect = document.getElementById('target_project');
            const chkOnly = document.getElementById('chk_only_signout');
            const panelTitle = document.getElementById('panel_title');

            if (document.getElementById('nycu_helper_panel')) {
                btnStart.style.display = isRunning ? 'none' : 'block';
                btnStop.style.display = isRunning ? 'block' : 'none';

                // 呼叫 refreshUI 來處理細部的鎖定/解鎖邏輯
                const refreshBtn = document.getElementById('chk_only_signout');
                if (refreshBtn) refreshBtn.dispatchEvent(new Event('change'));

                if (isRunning) {
                    panelTitle.innerText = "🟢 V27.2 任務進行中";
                    panelTitle.style.color = "#4CAF50";
                } else {
                    panelTitle.innerText = "📅 自動簽到退 V27.2";
                    panelTitle.style.color = "#2196F3";
                }
            }
        }

        function startTask() {
            const projectSelect = document.getElementById('target_project');
            const projectBtnId = projectSelect.value;
            const projectName = projectSelect.options[projectSelect.selectedIndex].text;

            if (projectBtnId === "-1") {
                alert("❌ 錯誤：沒有可用的計畫！請等待網頁載入或確認您有權限。");
                return;
            }

            const isOnlySignOut = document.getElementById('chk_only_signout').checked;
            const period = document.getElementById('in_period').value;
            let inH = parseInt(document.getElementById('in_h').value);
            const inM = parseInt(document.getElementById('in_m').value);
            if (period === 'PM' && inH !== 12) inH += 12;
            if (period === 'AM' && inH === 12) inH = 0;

            const now = new Date();
            const targetDate = new Date();
            targetDate.setHours(inH, inM, 0, 0);
            if (targetDate < now) {
                targetDate.setDate(targetDate.getDate() + 1);
            }

            if (!isOnlySignOut) {
                const doSignOut = document.getElementById('chk_auto_signout').checked;
                if (doSignOut) {
                    const outH = parseInt(document.getElementById('out_h').value);
                    const outM = parseInt(document.getElementById('out_m').value);
                    const outMs = (outH * 3600 + outM * 60) * 1000;
                    setStorage(KEY_SIGNOUT_DURATION, outMs);
                } else {
                    localStorage.removeItem(KEY_SIGNOUT_DURATION);
                }
                setStorage(KEY_STATUS, 'waiting_signin');
            } else {
                setStorage(KEY_STATUS, 'waiting_signout');
                localStorage.removeItem(KEY_SIGNOUT_DURATION);
                setStorage(KEY_SIGNOUT_TIME_DISPLAY, formatTime(targetDate));
            }

            const isDebug = document.getElementById('chk_debug_mode').checked;
            setStorage(KEY_DEBUG_MODE, isDebug);
            setStorage(KEY_PROJECT_INDEX, projectBtnId);
            setStorage(KEY_PROJECT_NAME, projectName);
            setStorage(KEY_TARGET_TIME, targetDate.getTime());

            const KEY_LAST_REFRESH = STORAGE_PREFIX + 'last_refresh';
            setStorage(KEY_LAST_REFRESH, now.getTime());

            saveUIState();

            const actionText = isOnlySignOut ? "簽退" : "簽到";
            log(`已排程: ${projectName}\n預計${actionText}：${targetDate.toLocaleString()}`);
            updatePanelState(true);
            const refreshBtn = document.getElementById('target_project');
            if (refreshBtn) refreshBtn.dispatchEvent(new Event('change'));

            runLoop();
        }

        function stopTask() {
            clearExecutionState();
            updatePanelState(false);
            log("排程已取消");
            location.reload();
        }

        function checkKeepAlive() {
            const lastRefresh = parseInt(getStorage(KEY_LAST_REFRESH) || 0);
            const now = new Date().getTime();
            const intervalMs = KEEP_ALIVE_INTERVAL_MINUTES * 60 * 1000;

            if (lastRefresh > 0 && (now - lastRefresh > intervalMs)) {
                log("🔄 執行防斷線自動重整...");
                setStorage(KEY_LAST_REFRESH, now);
                location.reload();
                return true;
            }
            return false;
        }

        function runLoop() {
            const status = getStorage(KEY_STATUS);
            if (!status) return;

            updatePanelState(true);
            updateHeartbeat();

            if (checkKeepAlive()) return;

            const now = new Date().getTime();
            const target = parseInt(getStorage(KEY_TARGET_TIME));
            const projectBtnId = getStorage(KEY_PROJECT_INDEX);
            const projectName = getStorage(KEY_PROJECT_NAME);
            const timeLeftText = formatCountDown(target - now);

            if (status === 'waiting_signin') {
                updateTabTitle(`[剩 ${timeLeftText}] 簽到`);
                if (now >= target) {
                    log(`⏰ 時間到！\n正在對 [${projectName}] 簽到...`);
                    const btn = getActionButtonById(projectBtnId);
                    if (btn) {
                        setStorage(KEY_STATUS, 'confirm_signin');
                        btn.click();
                    } else {
                        log("❌ 錯誤：找不到簽到按鈕！(嘗試重刷列表...)");
                        const scan = scanProjects();
                        const fuzzy = scan.find(p => p.type === 'signIn');
                        if (fuzzy) {
                            log("⚠️ 模糊匹配成功，嘗試點擊...");
                            document.getElementById(fuzzy.btnId).click();
                            setStorage(KEY_STATUS, 'confirm_signin');
                        }
                    }
                } else {
                    log(`⏳ 簽到倒數中...\n目標: ${formatTime(target)}\n剩餘: ${timeLeftText}`);
                    setTimeout(runLoop, 1000);
                }
            }
            else if (status === 'waiting_signout') {
                updateTabTitle(`[剩 ${timeLeftText}] 簽退`);
                if (now >= target) {
                    log(`⏰ 時間到！\n正在對 [${projectName}] 簽退...`);
                    let btn = getActionButtonById(projectBtnId);
                    if (!btn || btn.id.includes('signIn')) {
                        let newId = projectBtnId.replace('signIn', 'signOut');
                        btn = getActionButtonById(newId);
                        if (!btn) {
                            const scan = scanProjects();
                            const fuzzy = scan.find(p => p.type === 'signOut');
                            if (fuzzy) {
                                btn = document.getElementById(fuzzy.btnId);
                            }
                        }
                    }
                    if (btn) {
                        setStorage(KEY_STATUS, 'confirm_signout');
                        btn.click();
                    } else {
                        log("❌ 錯誤：找不到簽退按鈕！");
                    }
                } else {
                    let displayTime = getStorage(KEY_SIGNOUT_TIME_DISPLAY);
                    if (!displayTime) displayTime = formatTime(target);
                    log(`🏢 工作中/等待簽退...\n目標: ${displayTime}\n剩餘: ${timeLeftText}`);
                    setTimeout(runLoop, 1000);
                }
            }
        }

        function checkConfirmPage() {
            const confirmBtn = document.getElementById(CONFIRM_BTN_ID);
            if (!confirmBtn) return;

            const status = getStorage(KEY_STATUS);
            const isDebug = getStorage(KEY_DEBUG_MODE) === 'true';

            const finalizeAction = (nextStatus, nextTarget = 0) => {
                if (isDebug) {
                    confirmBtn.style.border = "5px solid #ff4444";
                    confirmBtn.style.boxShadow = "0 0 10px red";
                    log("🛑 Debug模式：已停止，請手動確認");
                } else {
                    confirmBtn.click();
                    if (nextStatus) {
                        setStorage(KEY_STATUS, nextStatus);
                        if (nextTarget > 0) {
                            setStorage(KEY_TARGET_TIME, nextTarget);
                            setStorage(KEY_SIGNOUT_TIME_DISPLAY, formatTime(nextTarget));
                            setStorage(KEY_LAST_REFRESH, new Date().getTime());
                        }
                    } else {
                        clearExecutionState();
                    }
                    setTimeout(() => {
                        window.location.href = './OnlineProjectAttend_NYCU.aspx';
                    }, 500);
                }
            };

            if (status === 'confirm_signin') {
                log(isDebug ? "Debug: 簽到確認" : "🤖 自動確認簽到...");
                const outDuration = getStorage(KEY_SIGNOUT_DURATION);
                setTimeout(() => {
                    if (outDuration) {
                        const nextTarget = new Date().getTime() + parseInt(outDuration);
                        finalizeAction('waiting_signout', nextTarget);
                    } else {
                        finalizeAction(null);
                    }
                }, 1000);
            }
            else if (status === 'confirm_signout') {
                log(isDebug ? "Debug: 簽退確認" : "🤖 自動確認簽退...");
                setTimeout(() => {
                    finalizeAction(null);
                }, 1000);
            }
        }

        // --- Watchdog & Initial Check ---
        setInterval(() => {
            if (document.getElementById(MAIN_PAGE_ID) && !document.getElementById('nycu_helper_panel')) {
                createPanel();
            }
            const status = getStorage(KEY_STATUS);
            if (status && (status === 'waiting_signin' || status === 'waiting_signout')) {
                const btnStart = document.getElementById('btn_start_task');
                if (btnStart && btnStart.style.display !== 'none') {
                    updatePanelState(true);
                    runLoop();
                }
            }
        }, 3000);

        document.addEventListener("visibilitychange", () => {
            if (!document.hidden) {
                updateHeartbeat();
                const status = getStorage(KEY_STATUS);
                if (status === 'waiting_signin' || status === 'waiting_signout') {
                    runLoop();
                }
            }
        });

        // 頁面載入檢查
        if (document.getElementById(MAIN_PAGE_ID)) {
            createPanel();
            const status = getStorage(KEY_STATUS);
            if (status === 'waiting_signin' || status === 'waiting_signout') {
                updatePanelState(true);
                runLoop();
            }
        } else if (document.getElementById(CONFIRM_BTN_ID)) {
            checkConfirmPage();
        }
    }

})();
