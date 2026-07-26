(function () {
'use strict';
const B = window.__blynkInternals;
const { $, el, escapeHtml, clamp, debounce, showToast, getWidgetPinAddress, openBottomSheet, uid,
        LS, DEFAULT_SERVER, loadProjects, upsertProject, removeProject, rememberFields,
        parseServerAddress, apiTestConnection, apiGetProject, apiGetPinHistory,
        getWSClient, stopAllWSClients } = B;
const { WIDGET_FACTORY, UnknownView } = window.__blynkWidgets;

const app = $('#app');

const state = {
    conn: null,
    token: null,
    project: null,
    devices: {},
    activeTabId: 0,
    selectedDeviceId: null,
    autoSync: Number(localStorage.getItem(LS.SYNC_INTERVAL)) || 10000,
    pinRegistry: {},
    resizeObs: null,
    scale: 1,
    deviceTokens: {},
    deviceStatus: {},
    pendingDeviceTokens: [],
};


function collectPinRefs(widget) {
    const refs = [];
    if (widget.pinId !== undefined && widget.pinId !== -1) refs.push({ deviceId: widget.deviceId, pinId: widget.pinId });
    (widget.pins || []).forEach(p => { if (p.pinId !== undefined && p.pinId !== -1) refs.push({ deviceId: p.deviceId !== undefined ? p.deviceId : widget.deviceId, pinId: p.pinId }); });
    (widget.dataStreams || []).forEach(ds => {
        if (ds.pin && ds.pin.pinId !== undefined && ds.pin.pinId !== -1) {
            refs.push({ deviceId: ds.targetId !== undefined ? ds.targetId : widget.deviceId, pinId: ds.pin.pinId });
        }
    });
    return refs;
}

function collectDeviceIds(widget) {
    const ids = new Set([widget.deviceId]);
    (widget.pins || []).forEach(p => ids.add(p.deviceId !== undefined ? p.deviceId : widget.deviceId));
    (widget.dataStreams || []).forEach(ds => ids.add(ds.targetId !== undefined ? ds.targetId : widget.deviceId));
    return Array.from(ids).filter(id => id !== undefined && id !== -1);
}

function processPinBlock(block, deviceId) {
    if (!block) return block;
    const pin = block.pin !== undefined ? block.pin : -1;
    if (pin !== -1) {
        block.pinId = getWidgetPinAddress(block);
        if (block.value !== undefined) {
            if (!state.devices[deviceId]) state.devices[deviceId] = { id: deviceId, pins: {} };
            state.devices[deviceId].pins[block.pinId] = block.value;
        }
    }
    return block;
}

function normalizeProject(raw) {
    const project = raw;
    const devices = project.devices || [{ id: 0, name: project.name }];
    devices.forEach(d => {
        state.devices[d.id] = { id: d.id, token: state.deviceTokens[d.id], pins: (state.devices[d.id] && state.devices[d.id].pins) || {} };
    });
    project.deviceList = devices;
    state.selectedDeviceId = devices[0] ? devices[0].id : 0;

    const widgetsById = {};
    (project.widgets || []).forEach(widget => {
        widget.followsSelector = widget.deviceId === -1;
        processPinBlock(widget, widget.deviceId !== undefined && widget.deviceId !== -1 ? widget.deviceId : devices[0].id);
        if (widget.deviceId === undefined || widget.deviceId === -1) widget.deviceId = devices[0].id;
        (widget.pins || []).forEach(p => processPinBlock(p, p.deviceId !== undefined ? p.deviceId : widget.deviceId));
        (widget.dataStreams || []).forEach(ds => {
            if (ds.pin) processPinBlock(ds.pin, ds.targetId !== undefined ? ds.targetId : widget.deviceId);
        });
        widgetsById[widget.id] = widget;
    });
    project.widgetsById = widgetsById;
    const rtcWidget = (project.widgets || []).find(w => w.type === 'RTC' && w.tzName);
    project.rtcTimezone = rtcWidget ? rtcWidget.tzName : null;
    return project;
}

function connectDevice(deviceId) {
    const token = state.deviceTokens[deviceId];
    if (!token) { setDeviceStatus(deviceId, 'no_token'); return; }
    setDeviceStatus(deviceId, 'connecting');
    const client = getWSClient(deviceId);
    client.init({
        token,
        serverHost: state.conn.serverHost, serverPort: state.conn.serverPort, connectionMode: state.conn.connectionMode,
        onOpen: (result) => setDeviceStatus(deviceId, result === 'ok' ? 'online' : 'auth_error'),
        onClose: () => setDeviceStatus(deviceId, state.deviceStatus[deviceId] === 'auth_error' ? 'auth_error' : 'offline'),
    });
    if (!client._writePinBound) {
        client._writePinBound = true;
        client.addEventListener('write-pin', ({ pin, value }) => {
            if (!state.devices[deviceId]) return;
            state.devices[deviceId].pins[pin] = value;
            const key = deviceId + ':' + pin;
            (state.pinRegistry[key] || new Set()).forEach(inst => inst.onPinUpdate && inst.onPinUpdate(pin, value));
        });
    }
    client.setSyncTimerInterval(state.autoSync);
}

function setDeviceStatus(deviceId, status) {
    state.deviceStatus[deviceId] = status;
    refreshHeaderStatus();
    if (typeof paintStatusRows === 'function') paintStatusRows();
}

function assignDeviceToken(deviceId, token) {
    token = (token || '').trim();
    if (!token) return;
    state.deviceTokens[deviceId] = token;
    if (state.devices[deviceId]) state.devices[deviceId].token = token;
    state.pendingDeviceTokens = state.pendingDeviceTokens.filter(t => t !== token);
    upsertProject({ name: (state.project && state.project.name) || 'Dự án Blynk', server: currentServerRaw, token: state.token, deviceTokens: state.deviceTokens });
    connectDevice(deviceId);
}

function removeDeviceToken(deviceId) {
    delete state.deviceTokens[deviceId];
    if (state.devices[deviceId]) state.devices[deviceId].token = undefined;
    getWSClient(deviceId).stop();
    setDeviceStatus(deviceId, 'no_token');
    upsertProject({ name: (state.project && state.project.name) || 'Dự án Blynk', server: currentServerRaw, token: state.token, deviceTokens: state.deviceTokens });
}

let currentServerRaw = '';

async function doConnect(serverRaw, token, opts) {
    opts = opts || {};
    const conn = parseServerAddress(serverRaw);
    await apiTestConnection(conn, token);
    const rawProject = await apiGetProject(conn, token);

    state.conn = conn;
    state.token = token;
    state.devices = {};
    state.pinRegistry = {};
    state.activeTabId = 0;
    currentServerRaw = serverRaw;

    const devicesRaw = rawProject.devices || [{ id: 0, name: rawProject.name }];
    state.deviceTokens = Object.assign({}, opts.savedDeviceTokens || {});
    state.deviceStatus = {};
    state.pendingDeviceTokens = (opts.extraTokens || []).map(t => (t || '').trim()).filter(Boolean);

    const tokenAlreadyAssigned = Object.values(state.deviceTokens).includes(token);
    if (!tokenAlreadyAssigned) {
        if (devicesRaw.length === 1) {
            state.deviceTokens[devicesRaw[0].id] = token;
        } else {
            state.pendingDeviceTokens.unshift(token);
        }
    }
    state.pendingDeviceTokens = state.pendingDeviceTokens.filter(t => !Object.values(state.deviceTokens).includes(t));

    state.project = normalizeProject(rawProject);

    devicesRaw.forEach(d => {
        if (state.deviceTokens[d.id]) connectDevice(d.id);
        else setDeviceStatus(d.id, 'no_token');
    });

    if (!opts.silent) {
        rememberFields(serverRaw, token);
        upsertProject({ name: state.project.name || 'Dự án Blynk', server: serverRaw, token, deviceTokens: state.deviceTokens });
        localStorage.setItem(LS.ACTIVE_PROJECT, JSON.stringify({ server: serverRaw, token }));
    }
    renderDashboard();
    if (state.pendingDeviceTokens.length) openStatusPopup();
}

function doLogout() {
    stopAllWSClients();
    state.conn = null; state.token = null; state.project = null; state.devices = {}; state.pinRegistry = {};
    state.deviceTokens = {}; state.deviceStatus = {}; state.pendingDeviceTokens = [];
    localStorage.removeItem(LS.ACTIVE_PROJECT);
    renderConnection();
}

function statusLabel(st) {
    switch (st) {
        case 'online': return 'Đã kết nối (qua Token này)';
        case 'connecting': return 'Đang kết nối...';
        case 'auth_error': return 'Sai Token / bị từ chối';
        case 'offline': return 'Mất kết nối';
        default: return 'Chưa có Token';
    }
}

function statusSummary() {
    const devices = (state.project && state.project.deviceList) || [];
    let total = 0, online = 0, hasToken = 0;
    devices.forEach(d => {
        total++;
        const st = state.deviceStatus[d.id];
        if (st && st !== 'no_token') hasToken++;
        if (st === 'online') online++;
    });
    return { total, online, hasToken };
}

function refreshHeaderStatus() {
    const dot = $('.dash .dash-title .dot');
    const text = $('.dash .dash-title .s-text');
    if (!dot) return;
    const { total, online, hasToken } = statusSummary();
    const allOnline = hasToken > 0 && online === hasToken;
    dot.classList.toggle('on', allOnline);
    dot.classList.toggle('off', !allOnline);
    if (text) text.textContent = total <= 1 ? (allOnline ? 'Đã kết nối' : 'Đang kết nối...') : `${online}/${total} Device online`;
}

let paintStatusRows = null;

async function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
        try { await navigator.clipboard.writeText(text); return true; } catch (e) {  }
    }
    try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        ta.style.top = '0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);
        return ok;
    } catch (e) { return false; }
}

function slugifyFilename(s) {
    return String(s || 'blynk')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/gi, 'd')
        .replace(/[^a-zA-Z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .toLowerCase() || 'blynk';
}

function downloadQrPng(svgString, filename, label) {
    const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const svgUrl = URL.createObjectURL(svgBlob);
    const img = new Image();
    img.onload = () => {
        const qrSize = 640, pad = 32, labelH = label ? 56 : 0;
        const canvas = document.createElement('canvas');
        canvas.width = qrSize + pad * 2;
        canvas.height = qrSize + pad * 2 + labelH;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, pad, pad, qrSize, qrSize);
        if (label) {
            ctx.fillStyle = '#111';
            ctx.font = 'bold 28px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            let text = label;
            while (ctx.measureText(text).width > canvas.width - pad * 2 && text.length > 1) {
                text = text.slice(0, -1);
            }
            if (text !== label) text = text.replace(/.{0,3}$/, '') + '…';
            ctx.fillText(text, canvas.width / 2, pad + qrSize + labelH / 2);
        }
        URL.revokeObjectURL(svgUrl);
        canvas.toBlob(blob => {
            if (!blob) { showToast('Không tạo được ảnh QR để tải', true); return; }
            const dlUrl = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = dlUrl;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(dlUrl), 2000);
        }, 'image/png');
    };
    img.onerror = () => { URL.revokeObjectURL(svgUrl); showToast('Không tạo được ảnh QR để tải', true); };
    img.src = svgUrl;
}

function openStatusPopup() {
    const devices = (state.project && state.project.deviceList) || [];
    const rowEls = {};
    const rowsWrap = el('div', { class: 'status-rows' });

    devices.forEach(d => {
        const dot = el('span', { class: 'dot' });
        const nameEl = el('div', { class: 'status-name' }, d.name || ('Board ' + d.id));
        const textEl = el('div', { class: 'status-text' }, '');
        rowEls[d.id] = { dot, textEl };

        const editBtn = el('button', { class: 'icon-btn status-edit-btn', title: 'Sửa/xoá Token của Device này' }, '✎');
        const tokenInput = el('input', { class: 'input', placeholder: 'Token phần cứng của Device này', value: state.deviceTokens[d.id] || '' });
        const saveBtn = el('button', { class: 'btn btn-sm btn-primary' }, 'Lưu & kết nối');
        const clearBtn = el('button', { class: 'btn btn-sm btn-ghost' }, 'Xoá Token');
        const editForm = el('div', { class: 'status-edit-form hidden' }, [tokenInput, el('div', { class: 'status-edit-actions' }, [saveBtn, clearBtn])]);
        editBtn.addEventListener('click', () => editForm.classList.toggle('hidden'));
        saveBtn.addEventListener('click', () => {
            if (!tokenInput.value.trim()) { showToast('Chưa nhập Token', true); return; }
            assignDeviceToken(d.id, tokenInput.value);
            editForm.classList.add('hidden');
            showToast('Đã lưu token cho ' + (d.name || ('Device ' + d.id)));
        });
        clearBtn.addEventListener('click', () => {
            removeDeviceToken(d.id);
            tokenInput.value = '';
            showToast('Đã xoá Token của ' + (d.name || ('Device ' + d.id)));
        });

        rowsWrap.appendChild(el('div', { class: 'status-row-wrap' }, [
            el('div', { class: 'status-row' }, [dot, el('div', { class: 'status-meta' }, [nameEl, textEl]), editBtn]),
            editForm,
        ]));
    });

    let pendingSection = null;
    if (state.pendingDeviceTokens.length) {
        const select = el('select', { class: 'input' }, devices.map(d => el('option', { value: d.id }, d.name || ('Device ' + d.id))));
        const tokenInput = el('input', { class: 'input', value: state.pendingDeviceTokens[0] });
        const saveBtn = el('button', { class: 'btn btn-sm btn-primary' }, 'Gán Token này cho Device đã chọn');
        saveBtn.addEventListener('click', () => {
            assignDeviceToken(Number(select.value), tokenInput.value);
            openStatusPopup();
        });
        pendingSection = el('div', { class: 'status-add' }, [
            el('div', { class: 'status-add-title' }, 'Token chưa rõ thuộc Device nào — chọn đúng Device:'),
            el('div', { class: 'status-add-row' }, [select, tokenInput]),
            saveBtn,
        ]);
    }

    paintStatusRows = function () {
        devices.forEach(d => {
            const r = rowEls[d.id];
            if (!r) return;
            const st = state.deviceStatus[d.id] || 'no_token';
            r.dot.className = 'dot' + (st === 'online' ? ' on' : (st === 'no_token' ? '' : ' off'));
            r.textEl.textContent = statusLabel(st);
        });
    };
    paintStatusRows();

    const warningNote = el('div', { class: 'status-warning' },
        '⚠ Token cũng chính là danh tính đăng nhập — Server không phân biệt được Token được đăng nhập trên Console này hay Device vật lý. "Đã kết nối" chỉ có nghĩa là có 1 kênh nào đó đang dùng Token này để đăng nhập. Có server Blynk bản cũ chỉ hỗ trợ 1 kết nối/token cùng lúc — nên có thể xảy ra tình trạng nếu mở Console này có thể khiến Server ngắt kết nối thật của Device vật lý để nhường chỗ.');

    let quickConnectSection = null;
    if (Object.keys(state.deviceTokens).length) {
        const toggleBtn = el('button', { class: 'btn btn-sm' }, 'Tạo link kết nối nhanh');
        const revealWrap = el('div', { class: 'quickconnect-reveal hidden' });
        toggleBtn.addEventListener('click', () => {
            revealWrap.classList.toggle('hidden');
            if (revealWrap.classList.contains('hidden') || revealWrap.childElementCount) return;
            const url = buildQuickConnectUrl();
            const linkInput = el('input', { class: 'input', readonly: true, value: url });
            const copyBtn = el('button', { class: 'btn btn-sm btn-primary' }, 'Sao chép link');
            copyBtn.addEventListener('click', async () => {
                const ok = await copyToClipboard(url);
                if (ok) showToast('Đã sao chép link');
                else { linkInput.select(); showToast('Không tự sao chép được, hãy bôi đen & copy', true); }
            });
            const qrWrap = el('div', { class: 'quickconnect-qr' });
            const qr = window.QR && window.QR.encodeQR(url);
            let downloadBtn = null;
            let qrLabel = null;
            if (qr) {
                const svgString = window.QR.qrToSvgString(qr, { margin: 2 });
                qrWrap.innerHTML = svgString;
                const projectName = (state.project && state.project.name) || 'blynk';
                qrLabel = el('div', { class: 'quickconnect-qr-label' }, projectName);
                downloadBtn = el('button', { class: 'btn btn-sm' }, 'Tải ảnh QR');
                downloadBtn.addEventListener('click', () => downloadQrPng(svgString, `qr-ket-noi-${slugifyFilename(projectName)}.png`, projectName));
            } else {
                qrWrap.appendChild(el('div', { class: 'status-add-title' }, 'Link quá dài để tạo mã QR — dùng link phía trên nhé.'));
            }
            revealWrap.appendChild(el('div', { class: 'quickconnect-body' }, [
                el('div', { class: 'status-edit-form' }, [linkInput, copyBtn]),
                qrLabel,
                qrWrap,
                downloadBtn,
                el('div', { class: 'status-warning' }, 'Ai có link/mã QR này đều điều khiển được Device của bạn — chỉ chia sẻ cho người/thiết bị bạn tin tưởng.'),
            ]));
        });
        quickConnectSection = el('div', { class: 'status-add' }, [toggleBtn, revealWrap]);
    }

    const body = el('div', { class: 'status-popup-body' }, [warningNote, rowsWrap, pendingSection, quickConnectSection]);
    openBottomSheet('Trạng thái board', body, () => { paintStatusRows = null; });
}


function renderConnection(prefill) {
    app.innerHTML = '';
    const lastServer = (prefill && prefill.server) || localStorage.getItem(LS.LAST_SERVER) || DEFAULT_SERVER;
    const lastToken = (prefill && prefill.token) || localStorage.getItem(LS.LAST_TOKEN) || '';
    const remember = localStorage.getItem(LS.REMEMBER) !== '0';

    const screen = el('div', { class: 'conn-screen' });

    screen.appendChild(el('div', { class: 'conn-logo' }, [
        el('div', { class: 'mark' }, el('img', { src: 'logo.png', alt: 'Logo' })),
        el('div', { class: 'name' }, ['Blynk Web Console', el('small', {}, 'Thay thế App Blynk Legacy trên các thiết bị mà App dừng hỗ trợ')]),
    ]));

    const errorBox = el('div', { class: 'conn-error', style: { display: 'none' } });

    const serverInput = el('input', { class: 'input', id: 'f-server', placeholder: DEFAULT_SERVER, value: lastServer, autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false' });
    const tokenInput = el('input', { class: 'input', id: 'f-token', placeholder: 'Auth Token của Project', value: lastToken, autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false' });
    const rememberBox = el('input', { type: 'checkbox', id: 'f-remember' });
    rememberBox.checked = remember;

    const connectBtn = el('button', { class: 'btn btn-primary btn-block' }, 'Kết nối');

    const persistLive = debounce(() => {
        rememberFields(serverInput.value, tokenInput.value);
    }, 400);
    serverInput.addEventListener('input', persistLive);
    tokenInput.addEventListener('input', persistLive);
    rememberBox.addEventListener('change', () => localStorage.setItem(LS.REMEMBER, rememberBox.checked ? '1' : '0'));

    const extraTokenRows = [];
    const extraTokensWrap = el('div', { class: 'extra-tokens-wrap' });
    function addExtraTokenRow(prefill) {
        const input = el('input', { class: 'input', placeholder: `Token Device phụ #${extraTokenRows.length + 1}`, value: prefill || '', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false' });
        const removeBtn = el('button', { type: 'button', class: 'icon-btn', title: 'Xóa dòng này' }, '✕');
        const row = el('div', { class: 'extra-token-row' }, [input, removeBtn]);
        removeBtn.addEventListener('click', () => {
            row.remove();
            const idx = extraTokenRows.findIndex(r => r.row === row);
            if (idx !== -1) extraTokenRows.splice(idx, 1);
        });
        extraTokenRows.push({ input, row });
        extraTokensWrap.appendChild(row);
    }
    const addBoardBtn = el('button', { type: 'button', class: 'btn btn-sm btn-ghost' }, '+ Thêm Device');
    addBoardBtn.addEventListener('click', () => addExtraTokenRow());

    const form = el('form', { class: 'conn-card' }, [
        el('h2', {}, 'Đăng nhập bằng Auth Token'),
        errorBox,
        el('div', { class: 'field' }, [
            el('label', {}, 'Địa chỉ Server'),
            serverInput,
            el('div', { class: 'hint' }, 'Ví dụ: http://blynk-server.com:8080 — bao gồm giao thức (http/https) và cổng của server Blynk Legacy.'),
        ]),
        el('div', { class: 'field' }, [
            el('label', {}, 'Auth Token'),
            tokenInput,
            el('div', { class: 'hint' }, 'Token của từng Project, lấy trong app Blynk Legacy (Project Settings) hoặc email khi tạo project.'),
        ]),
        el('div', { class: 'field' }, [
            el('label', {}, 'Device khác trong cùng Project (nếu có)'),
            extraTokensWrap,
            addBoardBtn,
            el('div', { class: 'hint' }, 'Mỗi Device vật lý có 1 Token riêng — Với Project có nhiều Device, cần Token của các Device còn lại để có quyền điều khiển Device đó. Nếu bỏ qua có thể thêm sau ở nút "Status" trên Dashboard.'),
        ]),
        el('div', { class: 'checkbox-row' }, [rememberBox, el('label', { for: 'f-remember' }, 'Lưu thông tin đăng nhập này')]),
        connectBtn,
    ]);
    form.addEventListener('submit', async e => {
        e.preventDefault();
        errorBox.style.display = 'none';
        connectBtn.disabled = true;
        connectBtn.textContent = 'Đang kết nối...';
        try {
            const extraTokens = extraTokenRows.map(r => r.input.value.trim()).filter(Boolean);
            await doConnect(serverInput.value, tokenInput.value.trim(), { extraTokens });
        } catch (err) {
            errorBox.textContent = 'Không thể kết nối: ' + err.message;
            errorBox.style.display = 'block';
            connectBtn.disabled = false;
            connectBtn.textContent = 'Kết nối';
        }
    });
    screen.appendChild(form);

    const saved = loadProjects();
    if (saved.length) {
        const list = el('div', { class: 'saved-projects' }, [
            el('div', { class: 'saved-projects-head' }, [
                el('h3', {}, 'Đã lưu (' + saved.length + ')'),
                el('button', {
                    class: 'saved-clear-all', type: 'button',
                    onclick: () => {
                        if (!confirm('Xóa toàn bộ ' + saved.length + ' thông tin đăng nhập đã lưu?')) return;
                        loadProjects().forEach(p => removeProject(p.id));
                        renderConnection();
                    },
                }, 'Xóa tất cả'),
            ]),
        ]);
        saved.forEach(p => {
            const initials = (p.name || '?').trim().slice(0, 2).toUpperCase();
            const item = el('div', { class: 'saved-item' }, [
                el('div', { class: 'saved-avatar' }, initials),
                el('div', { class: 'saved-meta' }, [
                    el('div', { class: 'n' }, p.name || 'Không tên'),
                    el('div', { class: 's' }, p.server),
                ]),
                el('button', {
                    class: 'saved-del', type: 'button', title: 'Xóa thông tin đăng nhập',
                    onclick: (e) => {
                        e.stopPropagation();
                        if (!confirm('Xóa thông tin đăng nhập "' + (p.name || p.server) + '"?')) return;
                        removeProject(p.id);
                        renderConnection();
                    },
                }, [svgIcon('trash'), el('span', { class: 'saved-del-label' }, 'Xóa')]),
            ]);
            item.addEventListener('click', async () => {
                serverInput.value = p.server; tokenInput.value = p.token;
                connectBtn.disabled = true; connectBtn.textContent = 'Đang kết nối...';
                try { await doConnect(p.server, p.token, { savedDeviceTokens: p.deviceTokens || {} }); }
                catch (err) {
                    errorBox.textContent = 'Không thể kết nối: ' + err.message;
                    errorBox.style.display = 'block';
                    connectBtn.disabled = false; connectBtn.textContent = 'Kết nối';
                }
            });
            list.appendChild(item);
        });
        screen.appendChild(list);
    }

    screen.appendChild(el('div', { class: 'conn-footer' }, ['Console điều khiển dự án Blynk Legacy thông qua kết nối WebSocket. Các bạn có thể sử dụng để điều khiển các dự án trên server Blynk Free như blynk-server.com hoặc bất kỳ server nào bạn tự host.', el('br'), el('a', { href: 'https://diyeverything.cc', target: '_blank' }, 'diyeverything.cc'), el('br'), '©CươngNV']));

    app.appendChild(screen);
}


function svgIcon(name) {
    const paths = {
        bolt: '<path d="M13 2 4 14h6l-1 8 9-12h-6z" fill="currentColor"/>',
        refresh: '<path d="M17.65 6.35A8 8 0 1 0 19.94 13h-2.07A6 6 0 1 1 16.2 7.8L13 11h7V4z" fill="currentColor"/>',
        logout: '<path d="M16 17v-3H9v-4h7V7l5 5-5 5zM14 2v2H4v16h10v2H2V2h12z" fill="currentColor"/>',
        trash: '<path d="M6 7h12l-1 13H7L6 7zm3-3h6l1 2H8l1-2z" fill="currentColor"/>',
        switch: '<path d="M7 7h11l-3-3 1.4-1.4L21.8 8 16.4 13.4 15 12l3-3H7V7zm10 10H6l3 3-1.4 1.4L2.2 16 7.6 10.6 9 12l-3 3h11v2z" fill="currentColor"/>',
        plus: '<path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z" fill="currentColor"/>',
        minus: '<path d="M5 11h14v2H5z" fill="currentColor"/>',
        fit: '<path d="M4 4h6v2H6v4H4V4zm10 0h6v6h-2V6h-4V4zM4 14h2v4h4v2H4v-6zm16 0v6h-6v-2h4v-4h2z" fill="currentColor"/>',
        warning: '<path d="M12 2.5c.5 0 1 .27 1.25.72l8.5 15.2c.5.9-.15 2.03-1.25 2.03H3.5c-1.1 0-1.75-1.13-1.25-2.03l8.5-15.2c.25-.45.75-.72 1.25-.72Z" fill="currentColor" stroke="currentColor" stroke-linejoin="round"/><rect x="11" y="8.5" width="2" height="6" rx="1" fill="#fff"/><rect x="11" y="16.3" width="2" height="2" rx="1" fill="#fff"/>',
    };
    return el('span', { html: `<svg viewBox="0 0 24 24">${paths[name] || ''}</svg>` });
}

function widgetExtent(widgets, yOffsetRows) {
    yOffsetRows = yOffsetRows || 0;
    let maxX = 8, maxY = 6;
    widgets.forEach(w => {
        if (w.type === 'TABS') return;
        maxX = Math.max(maxX, (w.x || 0) + (w.width || 1));
        maxY = Math.max(maxY, (w.y || 0) - yOffsetRows + (w.height || 1));
    });
    return { w: maxX * 60, h: maxY * 70 };
}

function renderDashboard() {
    app.innerHTML = '';
    const project = state.project;
    const widgets = Object.values(project.widgetsById || {});

    const dash = el('div', { class: 'dash' });

    const syncBtn = el('button', { class: 'btn btn-sm', onclick: () => { Object.keys(state.deviceTokens).forEach(id => getWSClient(id).sync()); showToast('Đã đồng bộ'); } }, [svgIcon('refresh'), 'Sync ngay']);

    const SYNC_OPTIONS = [
        { ms: 0, label: 'Tắt tự động' },
        { ms: 1000, label: '1 giây' },
        { ms: 2000, label: '2 giây' },
        { ms: 5000, label: '5 giây' },
        { ms: 10000, label: '10 giây' },
        { ms: 30000, label: '30 giây' },
        { ms: 60000, label: '60 giây' },
    ];
    const syncSelect = el('select', { class: 'input w-sync-select', title: 'Chu kỳ tự đồng bộ' },
        SYNC_OPTIONS.map(o => el('option', { value: o.ms }, o.label)));
    syncSelect.value = String(state.autoSync);
    syncSelect.addEventListener('change', () => {
        const ms = Number(syncSelect.value) || 0;
        state.autoSync = ms;
        localStorage.setItem(LS.SYNC_INTERVAL, String(ms));
        Object.keys(state.deviceTokens).forEach(id => getWSClient(id).setSyncTimerInterval(ms));
        showToast(ms ? `Tự đồng bộ mỗi ${syncSelect.selectedOptions[0].textContent}` : 'Đã tắt tự đồng bộ');
    });

    const statusBtn = el('button', { class: 'btn btn-sm', onclick: openStatusPopup }, [svgIcon('bolt'), 'Status']);

    const header = el('div', { class: 'dash-header' }, [
        el('div', { class: 'dash-header-row' }, [
            el('div', { class: 'dash-title' }, [
                el('div', { class: 't' }, project.name || 'Dự án Blynk'),
                el('div', { class: 's' }, [el('span', { class: 'dot off' }), el('span', { class: 's-text' }, 'Đang kết nối...')]),
            ]),
            el('button', { class: 'icon-btn', title: 'Đổi Project', onclick: () => { stopAllWSClients(); renderConnection(); } }, svgIcon('switch')),
            el('button', { class: 'icon-btn', title: 'Đăng xuất', onclick: doLogout }, svgIcon('logout')),
        ]),
        el('div', { class: 'dash-toolbar' }, [statusBtn, syncBtn, syncSelect]),
    ]);
    dash.appendChild(header);
    refreshHeaderStatus();
    const tabsWidget = widgets.find(w => w.type === 'TABS');
    const yOffsetRows = tabsWidget ? (tabsWidget.height || 1) : 0;
    let paintTabbar = () => {};
    if (tabsWidget && Array.isArray(tabsWidget.tabs) && tabsWidget.tabs.length) {
        const tabBtns = tabsWidget.tabs.map((tab, idx) => {
            const b = el('div', { class: 'tab' }, tab.label || `Tab ${idx + 1}`);
            b.addEventListener('click', () => { state.activeTabId = idx; buildStage(); paintTabbar(); });
            return b;
        });
        const tabbarEl = el('div', { class: 'tabbar' }, tabBtns);
        paintTabbar = () => tabBtns.forEach((b, idx) => b.classList.toggle('active', idx === state.activeTabId));
        paintTabbar();
        dash.appendChild(tabbarEl);
    }

    const stageScroll = el('div', { class: 'stage-scroll' });
    const stageSizer = el('div', { class: 'stage-sizer' });
    const stageInner = el('div', { class: 'stage', style: { position: 'absolute', top: '0', left: '0', transformOrigin: 'top left' } });
    stageSizer.appendChild(stageInner);
    stageScroll.appendChild(stageSizer);
    dash.appendChild(stageScroll);

    const ctx = {
        state,
        getPinValue(pinId) { return undefined; },
        sendWrite(deviceId, pin, value, dontSend) {
            if (!state.deviceTokens[deviceId]) { showToast('Device này chưa có Token — bấm "Status" ở trên để thêm', true); return; }
            getWSClient(deviceId).sendWritePin(pin, value, dontSend);
        },
        getHistory(deviceId, pinAddr) {
            const token = state.deviceTokens[deviceId];
            if (!token) return Promise.resolve(null);
            return apiGetPinHistory(state.conn, token, pinAddr);
        },
        setActiveTab(idx) { state.activeTabId = idx; buildStage(); paintTabbar(); },
        getDevices() { return project.deviceList || []; },
        getSelectedDevice() { return state.selectedDeviceId; },
        setSelectedDevice(id) { state.selectedDeviceId = id; buildStage(); },
        getRtcTimezone() { return project.rtcTimezone || null; },
    };

    function makeWidgetCtx(widget) {
        return Object.assign({}, ctx, {
            getPinValue(pinId) {
                const dev = state.devices[widget.deviceId];
                return dev ? dev.pins[pinId] : undefined;
            },
        });
    }

    function buildStage() {
        stageInner.innerHTML = '';
        state.pinRegistry = {};
        const visible = widgets.filter(w => w.type !== 'TABS' && (w.tabId === state.activeTabId || (w.tabId === undefined && state.activeTabId === 0)));
        const ext = widgetExtent(widgets, yOffsetRows);
        stageInner.style.width = ext.w + 'px';
        stageInner.style.height = ext.h + 'px';

        if (!visible.length) {
            stageInner.appendChild(el('div', { class: 'empty-state' }, [
                svgIcon('bolt'),
                el('p', {}, 'Project chưa có Widget nào ở tab này, hoặc Project rỗng.'),
            ]));
        }

        visible.forEach(widget => {
            if (widget.followsSelector) widget.deviceId = state.selectedDeviceId;
            const factory = WIDGET_FACTORY[widget.type] || UnknownView;
            const wctx = makeWidgetCtx(widget);
            let instance;
            try { instance = factory(widget, wctx); }
            catch (e) { instance = UnknownView(widget); }

            const deviceIds = collectDeviceIds(widget);
            const noToken = deviceIds.length > 0 && !deviceIds.some(id => state.deviceTokens[id]);
            const pinRefs = collectPinRefs(widget);
            const box = el('div', {
                class: 'w-box' + (widget.type === 'TABS' ? ' w-tabs' : '') + (noToken ? ' w-no-token' : ''),
                style: {
                    left: (widget.x || 0) * 60 + 'px',
                    top: ((widget.y || 0) - yOffsetRows) * 70 + 'px',
                    width: Math.max(1, (widget.width || 1) * 60 - 1) + 'px',
                    height: Math.max(1, (widget.height || 1) * 70 - 1) + 'px',
                },
            });
            if (noToken) {
                box.appendChild(el('div', { class: 'w-no-token-badge', title: 'Device chưa có Token — bấm Status ở trên để thêm' }, svgIcon('warning')));
                box.addEventListener('click', () => {
                    showToast('Device này chưa có Token — bấm Status để thêm', true);
                    openStatusPopup();
                });
            }
            const labelText = instance.label;
            const infoEl = instance.infoEl;
            if (labelText !== null && labelText !== undefined) {
                const lab = el('div', { class: 'w-label' }, [
                    el('div', { class: 't' }, labelText || ''),
                ]);
                if (infoEl) lab.appendChild(infoEl);
                box.appendChild(lab);
            }
            const body = el('div', { class: 'w-body' }, instance.el);
            box.appendChild(body);
            stageInner.appendChild(box);

            pinRefs.forEach(({ deviceId, pinId }) => {
                const key = deviceId + ':' + pinId;
                (state.pinRegistry[key] = state.pinRegistry[key] || new Set()).add(instance);
            });

            if (instance.onResize) {
                const ro = new ResizeObserver(entries => {
                    const r = entries[0].contentRect;
                    if (r.width && r.height) instance.onResize(r.width, r.height);
                });
                ro.observe(instance.resizeEl || body);
            }
        });
    }
    buildStage();

    let scale = state.scale || 1;
    function applyScale() {
        const natural = widgetExtent(widgets, yOffsetRows);
        const scaledW = natural.w * scale;
        const scaledH = natural.h * scale;
        const availW = stageScroll.clientWidth || scaledW;
        const availH = stageScroll.clientHeight || scaledH;
        const sizerW = Math.max(scaledW, availW);
        const sizerH = Math.max(scaledH, availH);
        stageSizer.style.width = sizerW + 'px';
        stageSizer.style.height = sizerH + 'px';
        stageInner.style.transform = `scale(${scale})`;
        stageInner.style.left = Math.max(0, (sizerW - scaledW) / 2) + 'px';
        stageInner.style.top = '0px';
    }
    applyScale();

    function fitToWidth() {
        const avail = stageScroll.clientWidth - 24;
        scale = clamp(avail / (widgetExtent(widgets, yOffsetRows).w || 1), 0.3, 1);
        applyScale();
        state.scale = scale;
    }
    const zoomBox = el('div', { class: 'dash-zoom' }, [
        el('button', { class: 'icon-btn', title: 'Vừa màn hình', onclick: fitToWidth }, svgIcon('fit')),
        el('button', { class: 'icon-btn', title: 'Phóng to', onclick: () => { scale = clamp(scale + 0.1, 0.3, 2); applyScale(); state.scale = scale; } }, svgIcon('plus')),
        el('button', { class: 'icon-btn', title: 'Thu nhỏ', onclick: () => { scale = clamp(scale - 0.1, 0.3, 2); applyScale(); state.scale = scale; } }, svgIcon('minus')),
    ]);
    dash.appendChild(zoomBox);

    app.appendChild(dash);

    if (window.innerWidth < 760) requestAnimationFrame(fitToWidth);
}


function buildQuickConnectUrl() {
    const entries = Object.entries(state.deviceTokens);
    if (!entries.length) return null;
    const payload = currentServerRaw + '~' + entries.map(([id, tok]) => `${id}:${tok}`).join('~');
    return location.origin + location.pathname + '#c=' + encodeURIComponent(payload);
}

function parseQuickConnectHash() {
    const m = location.hash.match(/^#c=(.+)$/);
    if (!m) return null;
    try {
        const parts = decodeURIComponent(m[1]).split('~');
        const server = parts[0];
        const deviceTokens = {};
        let firstToken = null;
        parts.slice(1).forEach(p => {
            const idx = p.indexOf(':');
            if (idx === -1) return;
            const id = Number(p.slice(0, idx));
            const tok = p.slice(idx + 1);
            if (!tok) return;
            deviceTokens[id] = tok;
            if (firstToken === null) firstToken = tok;
        });
        if (!server || !firstToken) return null;
        return { server, token: firstToken, deviceTokens };
    } catch (e) { return null; }
}

async function boot() {
    const quick = parseQuickConnectHash();
    if (quick) {
        history.replaceState(null, '', location.pathname + location.search);
        renderConnection();
        try {
            await doConnect(quick.server, quick.token, { savedDeviceTokens: quick.deviceTokens });
            showToast('Đã kết nối nhanh qua link');
        } catch (e) {
            showToast('Link kết nối nhanh bị lỗi: ' + e.message, true);
        }
        return;
    }

    let active = null;
    try { active = JSON.parse(localStorage.getItem(LS.ACTIVE_PROJECT) || 'null'); } catch (e) {}

    renderConnection();

    if (active && active.server && active.token) {
        try {
            const saved = loadProjects().find(p => p.server === active.server && p.token === active.token);
            await doConnect(active.server, active.token, { silent: true, savedDeviceTokens: (saved && saved.deviceTokens) || {} });
        } catch (e) {
            showToast('Không tự kết nối lại được: ' + e.message, true);
        }
    }
}

window.addEventListener('DOMContentLoaded', boot);

})();
