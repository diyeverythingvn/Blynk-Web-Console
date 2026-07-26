(function () {
'use strict';


function $(sel, root) { return (root || document).querySelector(sel); }
function el(tag, attrs, children) {
    const e = document.createElement(tag);
    if (attrs) {
        for (const k in attrs) {
            if (k === 'class') e.className = attrs[k];
            else if (k === 'html') e.innerHTML = attrs[k];
            else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), attrs[k]);
            else if (k === 'style' && typeof attrs[k] === 'object') Object.assign(e.style, attrs[k]);
            else e.setAttribute(k, attrs[k]);
        }
    }
    if (children) {
        (Array.isArray(children) ? children : [children]).forEach(c => {
            if (c === null || c === undefined) return;
            e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
        });
    }
    return e;
}
function escapeHtml(str) {
    return String(str === undefined || str === null ? '' : str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
function debounce(fn, ms) {
    let t;
    return function (...args) { clearTimeout(t); t = setTimeout(() => fn.apply(this, args), ms); };
}

let toastTimer;
function showToast(msg, isErr) {
    const t = $('#toast');
    t.textContent = msg;
    t.className = 'toast show' + (isErr ? ' err' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.className = 'toast'; }, 2600);
}

function openBottomSheet(title, bodyEl, onClose) {
    const closeBtn = el('button', { class: 'icon-btn', 'aria-label': 'Đóng' }, '✕');
    const sheet = el('div', { class: 'modal-sheet' }, [
        el('div', { class: 'mh' }, [el('h3', {}, title), closeBtn]),
        el('div', { class: 'modal-body' }, bodyEl),
    ]);
    const backdrop = el('div', { class: 'modal-backdrop' }, sheet);
    function close() {
        backdrop.remove();
        document.removeEventListener('keydown', onKey);
        if (onClose) onClose();
    }
    function onKey(e) { if (e.key === 'Escape') close(); }
    closeBtn.addEventListener('click', close);
    backdrop.addEventListener('click', e => { if (e.target === backdrop) close(); });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(backdrop);
    return close;
}


function decodeBlynkColor(blynkColor, gradient) {
    let color;
    switch (Number(blynkColor)) {
        case 600084223: color = '#23C48E'; break;   // green
        case 1602017535: color = '#5F7CD8'; break;  // purple
        case 79755519: color = '#04C0F8'; break;    // blue
        case -308477697: color = '#ED9D00'; break;  // orange
        case -750560001: color = '#D3435C'; break;  // red
        case -1: color = '#FFFFFF'; break;           // white
        case 255: color = '#293742'; break;          // black
        default: color = '#8f9ea8';
    }
    if (!gradient) return color;
    switch (Number(blynkColor)) {
        case 2147483647: return ['#D3435C', '#ED9D00', '#23C48E'];
        case -2147483648: return ['#5F7CD8', '#04C0F8', '#23C48E'];
        case 2147483646: return ['#23C48E', '#ED9D00', '#D3435C'];
        case -2147483647: return ['#23C48E', '#04C0F8', '#5F7CD8'];
        default: return [color, color];
    }
}

function getWidgetPinAddress(widget) {
    if (widget.pin === -1 || widget.pin === undefined || widget.pin === null) return -1;
    const pinType = (widget.pinType || '')[0];
    if (!pinType) return -1;
    return pinType.toLowerCase() + widget.pin;
}

function formatValueString(value, valueFormatting, pinExpression) {
    pinExpression = pinExpression || 'pin';
    if (value === undefined || value === null) value = '';
    if (!valueFormatting) {
        return '<span class="pinValue">' + escapeHtml(value) + '</span>';
    }
    const re = new RegExp('/' + pinExpression.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([.]?([#]*))/');
    return valueFormatting.replace(re, (g0, g2, g3) => {
        let result;
        if (g2) result = parseFloat(Number(value).toFixed((g3 || '').length));
        else result = value;
        return '<span class="pinValue">' + escapeHtml(String(result)) + '</span>';
    });
}

function formatValueMulti(value, valueFormatting, candidates) {
    if (!valueFormatting) return formatValueString(value, null);
    for (const cand of candidates) {
        const re = new RegExp('/' + cand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([.]?([#]*))/');
        if (re.test(valueFormatting)) return formatValueString(value, valueFormatting, cand);
    }
    return formatValueString(value, null);
}

const gunzip = (function () {
    const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
    const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
    const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
    const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
    const CLC_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

    function BitReader(data) {
        this.data = data; this.pos = 0; this.bitBuf = 0; this.bitCnt = 0;
    }
    BitReader.prototype.bits = function (n) {
        while (this.bitCnt < n) {
            this.bitBuf |= this.data[this.pos++] << this.bitCnt;
            this.bitCnt += 8;
        }
        const v = this.bitBuf & ((1 << n) - 1);
        this.bitBuf >>>= n; this.bitCnt -= n;
        return v;
    };
    BitReader.prototype.align = function () { this.bitBuf = 0; this.bitCnt = 0; };

    function buildHuffman(lengths) {
        const maxBits = Math.max(...lengths, 0);
        const blCount = new Array(maxBits + 1).fill(0);
        for (const l of lengths) if (l > 0) blCount[l]++;
        const nextCode = new Array(maxBits + 1).fill(0);
        let code = 0;
        for (let bits = 1; bits <= maxBits; bits++) { code = (code + blCount[bits - 1]) << 1; nextCode[bits] = code; }
        const codes = new Array(lengths.length).fill(0);
        for (let i = 0; i < lengths.length; i++) {
            const len = lengths[i];
            if (len > 0) { codes[i] = nextCode[len]; nextCode[len]++; }
        }
        const table = {};
        for (let i = 0; i < lengths.length; i++) {
            const len = lengths[i];
            if (len === 0) continue;
            if (!table[len]) table[len] = {};
            table[len][codes[i]] = i;
        }
        return { table, maxBits };
    }
    function decodeSymbol(br, huff) {
        let code = 0, len = 0;
        while (len < huff.maxBits) {
            code = (code << 1) | br.bits(1);
            len++;
            if (huff.table[len] && huff.table[len][code] !== undefined) return huff.table[len][code];
        }
        throw new Error('inflate: bad huffman code');
    }

    function inflateRaw(data) {
        const br = new BitReader(data);
        const out = [];
        let finalBlock = false;
        while (!finalBlock) {
            finalBlock = br.bits(1) === 1;
            const type = br.bits(2);
            if (type === 0) {
                br.align();
                const len = data[br.pos] | (data[br.pos + 1] << 8);
                br.pos += 4; // skip LEN + NLEN
                for (let i = 0; i < len; i++) out.push(data[br.pos++]);
            } else if (type === 1 || type === 2) {
                let litHuff, distHuff;
                if (type === 1) {
                    const litLens = new Array(288);
                    for (let i = 0; i <= 143; i++) litLens[i] = 8;
                    for (let i = 144; i <= 255; i++) litLens[i] = 9;
                    for (let i = 256; i <= 279; i++) litLens[i] = 7;
                    for (let i = 280; i <= 287; i++) litLens[i] = 8;
                    const distLens = new Array(30).fill(5);
                    litHuff = buildHuffman(litLens);
                    distHuff = buildHuffman(distLens);
                } else {
                    const hlit = br.bits(5) + 257, hdist = br.bits(5) + 1, hclen = br.bits(4) + 4;
                    const clLens = new Array(19).fill(0);
                    for (let i = 0; i < hclen; i++) clLens[CLC_ORDER[i]] = br.bits(3);
                    const clHuff = buildHuffman(clLens);
                    const allLens = [];
                    while (allLens.length < hlit + hdist) {
                        const sym = decodeSymbol(br, clHuff);
                        if (sym < 16) allLens.push(sym);
                        else if (sym === 16) { const r = br.bits(2) + 3; const prev = allLens[allLens.length - 1]; for (let i = 0; i < r; i++) allLens.push(prev); }
                        else if (sym === 17) { const r = br.bits(3) + 3; for (let i = 0; i < r; i++) allLens.push(0); }
                        else { const r = br.bits(7) + 11; for (let i = 0; i < r; i++) allLens.push(0); }
                    }
                    litHuff = buildHuffman(allLens.slice(0, hlit));
                    distHuff = buildHuffman(allLens.slice(hlit, hlit + hdist));
                }
                for (;;) {
                    const sym = decodeSymbol(br, litHuff);
                    if (sym < 256) { out.push(sym); continue; }
                    if (sym === 256) break;
                    const li = sym - 257;
                    const length = LEN_BASE[li] + br.bits(LEN_EXTRA[li]);
                    const dsym = decodeSymbol(br, distHuff);
                    const dist = DIST_BASE[dsym] + br.bits(DIST_EXTRA[dsym]);
                    const start = out.length - dist;
                    for (let i = 0; i < length; i++) out.push(out[start + i]);
                }
            } else {
                throw new Error('inflate: reserved block type');
            }
        }
        return out;
    }

    return function gunzip(bytes) {
        if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) throw new Error('not gzip');
        const flg = bytes[3];
        let pos = 10;
        if (flg & 0x04) { const xlen = bytes[pos] | (bytes[pos + 1] << 8); pos += 2 + xlen; }
        if (flg & 0x08) { while (bytes[pos] !== 0) pos++; pos++; }
        if (flg & 0x10) { while (bytes[pos] !== 0) pos++; pos++; }
        if (flg & 0x02) pos += 2;
        const compressed = bytes.subarray(pos, bytes.length - 8);
        const out = inflateRaw(compressed);
        return new Uint8Array(out);
    };
})();


const LS = {
    PROJECTS: 'blynk-console:projects',
    LAST_SERVER: 'blynk-console:lastServer',
    LAST_TOKEN: 'blynk-console:lastToken',
    REMEMBER: 'blynk-console:remember',
    ACTIVE_PROJECT: 'blynk-console:activeProjectId',
    SYNC_INTERVAL: 'blynk-console:syncIntervalMs',
};

const DEFAULT_SERVER = 'http://blynk-server.com:8080';

function loadProjects() {
    try { return JSON.parse(localStorage.getItem(LS.PROJECTS) || '[]'); }
    catch (e) { return []; }
}
function saveProjects(list) {
    try { localStorage.setItem(LS.PROJECTS, JSON.stringify(list)); } catch (e) {}
}
function upsertProject(p) {
    const list = loadProjects();
    const existingIdx = list.findIndex(x => x.server === p.server && x.token === p.token);
    if (existingIdx >= 0) {
        list[existingIdx] = { ...list[existingIdx], ...p };
        saveProjects(list);
        return list[existingIdx];
    }
    p.id = p.id || uid();
    list.unshift(p);
    saveProjects(list);
    return p;
}
function removeProject(id) {
    saveProjects(loadProjects().filter(p => p.id !== id));
}

function rememberFields(server, token) {
    try {
        localStorage.setItem(LS.LAST_SERVER, server || '');
        localStorage.setItem(LS.LAST_TOKEN, token || '');
    } catch (e) {}
}


function parseServerAddress(raw) {
    raw = (raw || '').trim();
    if (!raw) throw new Error('Địa chỉ server trống');
    if (!/^https?:\/\//i.test(raw)) raw = 'http://' + raw;
    let u;
    try { u = new URL(raw); } catch (e) { throw new Error('Địa chỉ server không hợp lệ'); }
    const connectionMode = u.protocol === 'https:' ? 'ssl' : 'no-ssl';
    const serverHost = u.hostname;
    const serverPort = u.port || (connectionMode === 'ssl' ? 443 : 80);
    if (!serverHost) throw new Error('Địa chỉ server không hợp lệ');
    return { serverHost, serverPort, connectionMode };
}

function httpBase({ serverHost, serverPort, connectionMode }) {
    return `${connectionMode === 'no-ssl' ? 'http' : 'https'}://${serverHost}:${serverPort}`;
}
function wsUrl({ serverHost, serverPort, connectionMode }) {
    return `${connectionMode === 'no-ssl' ? 'ws' : 'wss'}://${serverHost}:${serverPort}/websockets`;
}


async function apiTestConnection(conn, token) {
    const res = await fetch(`${httpBase(conn)}/${encodeURIComponent(token)}/isAppConnected`, { headers: { accept: 'json' }, cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return true;
}

async function apiGetProject(conn, token) {
    const res = await fetch(`${httpBase(conn)}/${encodeURIComponent(token)}/project`, { headers: { accept: 'json' }, cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

function parseCsvGz(buf) {
    let text;
    try {
        const bytes = gunzip(new Uint8Array(buf));
        text = new TextDecoder().decode(bytes);
    }
    catch (e) {
        return null;
    }
    const lines = text.split(/\r?\n/).filter(l => l.trim().length);
    const points = [];
    for (const line of lines) {
        const cells = line.split(',');
        if (cells.length < 2) continue;
        const value = Number(cells[0]);
        const ts = Number(cells[1]);
        if (!isNaN(ts)) points.push([ts, value]);
    }
    points.sort((a, b) => a[0] - b[0]);
    return points;
}

async function apiGetPinHistory(conn, token, pin) {
    try {
        const res = await fetch(`${httpBase(conn)}/${encodeURIComponent(token)}/data/${pin.toUpperCase()}`, { cache: 'no-store' });
        if (!res.ok) return null;
        const buf = await res.arrayBuffer();
        if (!buf || buf.byteLength === 0) return [];
        return parseCsvGz(buf);
    } catch (e) {
        return null;
    }
}


const MsgType = { RESPONSE: 0, LOGIN: 2, PING: 6, BRIDGE: 15, HW_SYNC: 16, HARDWARE: 20 };
function getCommandByString(s) {
    switch (s) {
        case 'ping': return MsgType.PING;
        case 'login': return MsgType.LOGIN;
        case 'hardware': return MsgType.HARDWARE;
        case 'bridge': return MsgType.BRIDGE;
        case 'hwSync': return MsgType.HW_SYNC;
        default: return 0;
    }
}
function ab2str(buf) {
    const arr = new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
    return s;
}

class EventHandler {
    constructor() { this._events = {}; }
    addEventListener(ev, fn) { (this._events[ev] = this._events[ev] || []).push(fn); }
    dispatchEvent(ev, detail) { (this._events[ev] || []).forEach(fn => fn(detail)); }
}

class BlynkWSClient extends EventHandler {
    constructor() {
        super();
        this.isRunning = false;
        this.socket = null;
        this.pingTimer = null;
        this.syncTimer = null;
        this.token = null;
        this._throttled = {};
        this._lastSent = {};
        this._msgId = 0;
        this._loginMsgId = null;
    }

    init({ token, serverHost, serverPort, connectionMode, onOpen, onClose }) {
        this.stop();
        this.token = token;
        this._onOpen = onOpen;
        this._onClose = onClose;
        const url = wsUrl({ serverHost, serverPort, connectionMode });
        this.socket = new WebSocket(url);
        this.socket.binaryType = 'arraybuffer';
        this.socket.onmessage = e => this.handleMessage(e);
        this.socket.onopen = () => { this.start(); };
        this.socket.onclose = () => { this.stop(); this._onClose && this._onClose(); };
        this.socket.onerror = () => {};

        clearInterval(this.syncTimer);
        this.syncTimer = setInterval(() => this.sync(), 1000);
        this._syncDelay = 1000;
    }

    start() {
        if (this.isRunning) return;
        this.isRunning = true;
        this._loginMsgId = this.send(`login ${this.token}`);
        this.send(`bridge 9999 i ${this.token}`);
        clearInterval(this.pingTimer);
        this.pingTimer = setInterval(() => this.send('ping'), 2000);
    }

    setSyncTimerInterval(ms) {
        clearInterval(this.syncTimer);
        this._syncDelay = ms;
        if (ms) this.syncTimer = setInterval(() => this.sync(), ms);
    }

    sync() { this.send('hwSync'); }

    stop() {
        clearInterval(this.pingTimer);
        clearInterval(this.syncTimer);
        this.isRunning = false;
        if (this.socket) { try { this.socket.close(); } catch (e) {} }
    }

    handleMessage(event) {
        if (!(event.data instanceof ArrayBuffer)) return;
        const dv = new DataView(event.data);
        const cmd = dv.getInt8(0);
        if (cmd === MsgType.RESPONSE) {
            const msgId = dv.getUint16(1);
            const status = dv.getUint16(3);
            if (msgId === this._loginMsgId) {
                this._onOpen && this._onOpen(status === 200 ? 'ok' : 'auth_error');
                this.dispatchEvent('login-result', { ok: status === 200, status });
            }
            return;
        }
        if (cmd === MsgType.HARDWARE) {
            this.handleHardware(ab2str(event.data.slice(5)));
        }
    }

    handleHardware(data) {
        const parts = data.split(String.fromCharCode(0));
        const type = parts[0], pin = parts[1];
        const value = parts.slice(2).join(String.fromCharCode(0));
        if (type === 'vw') this.dispatchEvent('write-pin', { pin: 'v' + pin, value });
        else if (type === 'aw') this.dispatchEvent('write-pin', { pin: 'a' + pin, value });
        else if (type === 'dw') this.dispatchEvent('write-pin', { pin: 'd' + pin, value });
    }

    sendWritePin(pin, value, dontSend) {
        if (typeof pin !== 'string' || pin === '-1' || !pin.length) {
            console.warn('[Blynk] Bỏ qua ghi pin: widget chưa gán pin hợp lệ', pin);
            return;
        }
        const pinType = pin[0], pinNumber = pin.slice(1);
        if (!dontSend) this.throttleSend(pin)(`bridge 9999 ${pinType}w ${pinNumber} ${value}`);
        this.dispatchEvent('write-pin', { pin, value });
    }

    throttleSend(pin) {
        if (!this._throttled[pin]) {
            let last = 0, timer = null, pending = null;
            this._throttled[pin] = (data) => {
                const now = Date.now();
                const remaining = 100 - (now - last);
                if (remaining <= 0) {
                    last = now; this.send(data);
                } else {
                    pending = data;
                    clearTimeout(timer);
                    timer = setTimeout(() => { last = Date.now(); this.send(pending); }, remaining);
                }
            };
        }
        return this._throttled[pin];
    }

    send(data) {
        if (!this.isRunning || !this.socket || this.socket.readyState !== WebSocket.OPEN) return null;
        const parts = data.split(' ');
        const cmdString = parts[0];
        const body = parts.length > 1 ? parts.slice(1).join('\0') : null;
        const cmd = getCommandByString(cmdString);
        const bodyLen = body ? body.length : 0;
        this._msgId = (this._msgId % 65535) + 1;
        const msgId = this._msgId;
        const buf = new ArrayBuffer(5 + bodyLen);
        const dv = new DataView(buf);
        dv.setInt8(0, cmd);
        dv.setInt16(1, msgId);
        dv.setInt16(3, bodyLen);
        for (let i = 0; i < bodyLen; i++) dv.setInt8(5 + i, body.charCodeAt(i));
        this.socket.send(new Uint8Array(buf));
        return msgId;
    }
}

const wsClients = {};
function getWSClient(deviceId) {
    deviceId = String(deviceId);
    if (!wsClients[deviceId]) wsClients[deviceId] = new BlynkWSClient();
    return wsClients[deviceId];
}
function stopAllWSClients() {
    Object.values(wsClients).forEach(c => c.stop());
    for (const k in wsClients) delete wsClients[k];
}

window.__blynkInternals = {
    $, el, escapeHtml, clamp, uid, debounce, showToast, openBottomSheet,
    decodeBlynkColor, getWidgetPinAddress, formatValueString, formatValueMulti,
    LS, DEFAULT_SERVER, loadProjects, saveProjects, upsertProject, removeProject, rememberFields,
    parseServerAddress, httpBase, wsUrl,
    apiTestConnection, apiGetProject, apiGetPinHistory,
    getWSClient, stopAllWSClients,
};

})();
