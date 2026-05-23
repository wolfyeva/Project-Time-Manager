// ==UserScript==
// @name         NYCU 自動簽到退排程助手
// @namespace    [http://tampermonkey.net/](http://tampermonkey.net/)
// @version      1.0
// @description  多筆排程佇列，防斷線機制，支援 LINE 推播通知
// @author       Gemini
// @match        *://*/*OnlineProjectAttend_NYCU.aspx*
// @grant        GM_xmlhttpRequest
// @connect      api.line.me
// ==/UserScript==

(function() {
    'use strict';

    // --- 設定區 & 狀態管理 ---
    const STORAGE_PREFIX = 'nycu_attendance_v1_';
    const KEY_SCHEDULES = STORAGE_PREFIX + 'schedules';
    const KEY_EXECUTING_TASK = STORAGE_PREFIX + 'executing_task';
    const KEY_DEBUG_MODE = STORAGE_PREFIX + 'debug_mode';
    const KEY_UI_STATE = STORAGE_PREFIX + 'ui_state';
    const KEY_LAST_REFRESH = STORAGE_PREFIX + 'last_refresh';
    const KEY_IS_COLLAPSED = STORAGE_PREFIX + 'is_collapsed';

    const MAIN_PAGE_ID = 'ContentPlaceHolder1_GridView_attend';
    const CONFIRM_BTN_ID = 'ContentPlaceHolder1_Button_attend';

    const KEEP_ALIVE_INTERVAL_MINUTES = 5;

    // --- 工具函式 ---
    function sendLineNotify(actionText, projectName, status = 'success') {
        const LINE_TOKEN = "XwhlG35/NiaSrZXBNZ7tTBtvfZqe9Rgotn/svgGpmZk+H6L/vWLHOyX+lKj/Ub+6d8cx3CrdMyq7gLAhyqTUCA8jPfYp/trWIIiruUl5W0cW5w4l3Pch8RGL9H75iIdel0bTJjh3S5RlHXbUo2+KhwdB04t89/1O/w1cDnyilFU="; 
        // 👇👇👇 請在這裡填入你的 LINE 資訊 👇👇👇
        const LINE_USER_ID = "";
        // 👆👆👆 ------------------------------ 👆👆👆

        if (!LINE_TOKEN || !LINE_USER_ID) return;

        const timeStr = new Date().toLocaleTimeString('zh-TW', { hour12: false, hour: '2-digit', minute: '2-digit' });
        const isDebug = actionText.includes('[測試]');
        const realAction = actionText.replace('[測試] ', '');

        let msgText = '';

        if (status === 'error') {
            msgText = `❌ 自動${realAction}失敗！\n⚠️ 找不到對應的按鈕\n📌 ${projectName}\n⏰ ${timeStr}`;
        } else {
            let actionIcon = realAction === '簽到' ? '🟢' : '🔴';
            if (isDebug) actionIcon = '🐞';
            msgText = `${actionIcon} 自動${actionText}成功\n📌 ${projectName}\n⏰ ${timeStr}`;
        }

        GM_xmlhttpRequest({
            method: "POST",
            url: "[https://api.line.me/v2/bot/message/push](https://api.line.me/v2/bot/message/push)",
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
        console.log(`[自動助手] ${msg}`);
        const display = document.getElementById('helper_msg_display');
        if (display) display.innerText = msg;
        const miniDisplay = document.getElementById('helper_mini_msg');
        if (miniDisplay) miniDisplay.innerText = msg.replace(/\n/g, ' ');
    }

    function updateHeartbeat() {
        const now = new Date();
        const el = document.getElementById('helper_heartbeat');
        if (el) el.innerText = `💓 運作中: ${now.toLocaleTimeString('zh-TW', { hour12: false })}`;
    }

    function updateTabTitle(text) { document.title = text + " - 線上簽到退"; }
    function getStorage(key) { return localStorage.getItem(key); }
    function setStorage(key, val) { localStorage.setItem(key, val); }
    function formatTime(dateObj) { return new Date(dateObj).toLocaleTimeString('zh-TW', { hour12: false }); }

    function formatCountDown(ms) {
        if (ms < 0) return "00:00:00";
        const h = Math.floor((ms % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const m = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
        const s = Math.floor((ms % (1000 * 60)) / 1000);
        return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }

    function getSchedules() {
        try { return JSON.parse(getStorage(KEY_SCHEDULES) || '[]'); } catch (e) { return []; }
    }

    function saveSchedules(list) {
        list.sort((a, b) => a.targetTime - b.targetTime);
        setStorage(KEY_SCHEDULES, JSON.stringify(list));
        renderScheduleList();
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
                    name = text.includes('\n') ? text.split('\n')[0].trim() : text.trim();
                    const match = text.match(/尚缺\s*[：:]\s*(\d+)\s*小時/);
                    if (match && match[1]) missingHours = parseInt(match[1], 10);
                }
                const type = btn.id.includes('signIn') ? 'signIn' : 'signOut';
                projectList.push({ index, name, missing: missingHours, btnId: btn.id, type });
            }
        });
        return projectList;
    }

    function getActionButtonById(id) { return document.getElementById(id); }

    function calculateSmartDefaults() {
        const projects = scanProjects();
        const now = new Date();
        let defaultInPeriod = now.getHours() >= 12 ? 'PM' : 'AM';
        let defaultInH = now.getHours() % 12;
        if (defaultInH === 0) defaultInH = 12;

        const availableSignIn = projects.filter(p => p.type === 'signIn' && p.missing !== 0);
        let targetId = availableSignIn.length > 0 ? availableSignIn[0].btnId : (projects.length > 0 ? projects[0].btnId : "");
        let defaultOutH = availableSignIn.length > 0 && availableSignIn[0].missing <= 4 && availableSignIn[0].missing > 0 ? availableSignIn[0].missing : 1;

        return {
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
        if (savedStateJson) { try { return JSON.parse(savedStateJson); } catch (e) {} }
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
        const bodyText = document.body.innerText;
        if (bodyText.includes("您尚未登入") || bodyText.includes("Timeout=1") || bodyText.includes("已被登出")) {
            const div = document.createElement('div');
            div.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.9); color:#fff; display:flex; justify-content:center; align-items:center; z-index:999999; font-size:24px; flex-direction:column;';
            div.innerHTML = `<div style="margin-bottom:20px; font-size:50px;">🔄</div><div>連線逾時，正在自動返回入口網登入...</div>`;
            document.body.appendChild(div);
            setTimeout(() => { window.location.href = "[https://portal.nycu.edu.tw/](https://portal.nycu.edu.tw/)"; }, 1000);
            return true;
        }
        return false;
    }

    function createPanel() {
        if (document.getElementById('nycu_helper_panel') || checkLogoutAndRedirect()) return;

        const state = getInitialState();
        const isCollapsed = getStorage(KEY_IS_COLLAPSED) === 'true';

        const div = document.createElement('div');
        div.id = 'nycu_helper_panel';
        div.style.cssText = 'position:fixed; bottom:10px; right:10px; background:rgba(0,0,0,0.9); color:white; padding:10px; border-radius:8px; z-index:2147483647; box-shadow:0 0 15px rgba(0,0,0,0.7); font-family:Arial, sans-serif; width: 330px; border: 1px solid #444; transition: all 0.3s ease;';
        const toggleBtnStyle = 'float:right; cursor:pointer; font-weight:bold; color:#ccc; border:1px solid #555; padding:0 5px; border-radius:3px; background:#333; margin-left:10px;';

        div.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:5px;">
                <h3 id="panel_title" style="margin:0; font-size:16px; color:#4CAF50;">📅 排程助手 V1.0</h3>
                <span id="btn_panel_toggle" style="${toggleBtnStyle}" title="縮小/展開">${isCollapsed ? '⬜' : '➖'}</span>
            </div>
            <div id="panel_content_mini" style="display:${isCollapsed ? 'block' : 'none'}; color:yellow; font-size:13px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                <span id="helper_mini_msg">佇列監控中...</span>
            </div>
            <div id="panel_content_full" style="display:${isCollapsed ? 'none' : 'block'};">
                <div style="background:#111; border: 1px solid #555; border-radius:4px; padding: 5px; margin-bottom: 10px;">
                    <div style="font-size:12px; color:#aaa; margin-bottom: 5px; font-weight:bold;">📋 待執行任務清單:</div>
                    <div id="schedule_list_container" style="max-height: 100px; overflow-y: auto; font-size: 12px;"></div>
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
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:3px;">
                        <span id="lbl_time_setting" style="color:#2196F3; font-weight:bold; font-size:13px;">設定執行時間</span>
                        <button id="btn_set_now" style="background:#4CAF50; color:white; border:none; border-radius:3px; padding:2px 8px; cursor:pointer; font-size:11px;">🕒 設為下一分鐘</button>
                    </div>
                    <select id="in_period" style="padding:2px;">
                        <option value="AM" ${state.inPeriod === 'AM' ? 'selected' : ''}>上午</option>
                        <option value="PM" ${state.inPeriod === 'PM' ? 'selected' : ''}>下午</option>
                    </select>
                    <select id="in_h" style="padding:2px;">${createRangeOptions(1, 12, state.inH)}</select> 點
                    <select id="in_m" style="padding:2px;">${createRangeOptions(0, 59, state.inM, true)}</select> 分
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

        document.getElementById('btn_set_now').addEventListener('click', () => {
            const now = new Date();
            now.setMinutes(now.getMinutes() + 1);
            let h = now.getHours();
            const m = now.getMinutes();
            const period = h >= 12 ? 'PM' : 'AM';
            if (h === 0) h = 12;
            else if (h > 12) h -= 12;
            document.getElementById('in_period').value = period;
            document.getElementById('in_h').value = h;
            document.getElementById('in_m').value = m;
            saveUIState();
            log("🕒 已快速設定為下一分鐘！");
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

        setTimeout(refreshProjectList, 1500);
        renderScheduleList();

        document.getElementById('schedule_list_container').addEventListener('click', (e) => {
            if(e.target.classList.contains('del-btn')) deleteSchedule(parseInt(e.target.dataset.id));
        });
    }

    function refreshProjectList() {
        const projects = scanProjects();
        let html = '';

        const filteredProjects = projects.filter(p => p.type === 'signOut' || (p.type === 'signIn' && p.missing !== 0));

        if (filteredProjects.length === 0) {
            html = `<option value="-1" data-type="none">⚠️ 無可操作計畫 (等待或重新整理)</option>`;
        } else {
            const currentSelected = document.getElementById('target_project').value;
            filteredProjects.forEach(p => {
                const isSel = (p.btnId === currentSelected) ? 'selected' : '';
                const missingText = (p.missing > 0 && p.type === 'signIn') ? `(缺${p.missing}h)` : '';
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
        container.innerHTML = html;
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

        const targetDate = new Date();
        targetDate.setHours(inH, inM, 0, 0);

        if (targetDate < new Date()) {
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

    function checkKeepAlive() {
        const lastRefresh = parseInt(getStorage(KEY_LAST_REFRESH) || 0);
        const now = Date.now();
        if (lastRefresh > 0 && (now - lastRefresh > KEEP_ALIVE_INTERVAL_MINUTES * 60 * 1000)) {
            log("🔄 執行防斷線自動重整...");
            setStorage(KEY_LAST_REFRESH, now);
            location.reload();
            return true;
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
            setStorage(KEY_EXECUTING_TASK, JSON.stringify(nextTask));

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
                const fuzzy = scan.find(p => p.type === typeNeeded && p.name.includes(nextTask.projectName.substring(0,3)));
                if (fuzzy) btn = document.getElementById(fuzzy.btnId);
            }

            if (btn) {
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

        if (isDebug) {
            confirmBtn.style.border = "5px solid #ff4444";
            confirmBtn.style.boxShadow = "0 0 10px red";
            log("🛑 Debug模式：攔截送出，請手動按確認");
            sendLineNotify(`[測試] ${task.actionText}`, task.projectName);
            localStorage.removeItem(KEY_EXECUTING_TASK);
            return;
        }

        log(`🤖 自動確認${task.actionText}...`);

        localStorage.removeItem(KEY_EXECUTING_TASK);
        setStorage(KEY_LAST_REFRESH, Date.now());

        sendLineNotify(task.actionText, task.projectName);

        setTimeout(() => {
            confirmBtn.click();
            setTimeout(() => { window.location.href = './OnlineProjectAttend_NYCU.aspx'; }, 1000);
        }, 1500);
    }

    setInterval(() => {
        if (!document.getElementById('nycu_helper_panel')) createPanel();
        if (getSchedules().length > 0) runLoop();
    }, 1000);

    window.addEventListener('load', function() {
        if (checkLogoutAndRedirect()) return;
        if (document.getElementById(MAIN_PAGE_ID)) {
            createPanel();
            if(!getStorage(KEY_LAST_REFRESH)) setStorage(KEY_LAST_REFRESH, Date.now());
        } else if (document.getElementById(CONFIRM_BTN_ID)) {
            checkConfirmPage();
        }
    });

})();
