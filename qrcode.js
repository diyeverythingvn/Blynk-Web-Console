(function (global) {
'use strict';

const EXP = new Array(256);
const LOG = new Array(256);
for (let i = 0; i < 8; i++) EXP[i] = 1 << i;
for (let i = 8; i < 256; i++) EXP[i] = EXP[i - 4] ^ EXP[i - 5] ^ EXP[i - 6] ^ EXP[i - 8];
for (let i = 0; i < 255; i++) LOG[EXP[i]] = i;
function glog(n) { return LOG[n]; }
function gexp(n) { while (n < 0) n += 255; while (n >= 256) n -= 255; return EXP[n]; }

function Poly(nums, shift) {
    let offset = 0;
    while (offset < nums.length && nums[offset] === 0) offset++;
    const len = nums.length - offset;
    this.num = new Array(len + (shift || 0)).fill(0);
    for (let i = 0; i < len; i++) this.num[i] = nums[i + offset];
}
Poly.prototype.get = function (i) { return this.num[i]; };
Poly.prototype.getLength = function () { return this.num.length; };
Poly.prototype.multiply = function (e) {
    const num = new Array(this.getLength() + e.getLength() - 1).fill(0);
    for (let i = 0; i < this.getLength(); i++)
        for (let j = 0; j < e.getLength(); j++)
            num[i + j] ^= gexp(glog(this.get(i)) + glog(e.get(j)));
    return new Poly(num, 0);
};
Poly.prototype.mod = function (e) {
    if (this.getLength() - e.getLength() < 0) return this;
    const ratio = glog(this.get(0)) - glog(e.get(0));
    const num = this.num.slice();
    for (let i = 0; i < e.getLength(); i++) num[i] ^= gexp(glog(e.get(i)) + ratio);
    return new Poly(num, 0).mod(e);
};
function errorCorrectPoly(ecLen) {
    let a = new Poly([1], 0);
    for (let i = 0; i < ecLen; i++) a = a.multiply(new Poly([1, gexp(i)], 0));
    return a;
}

const CAPACITY = { 1: [19, 7], 2: [34, 10], 3: [55, 15], 4: [80, 20], 5: [108, 26] };
const ALIGN_POS = { 2: 18, 3: 22, 4: 26, 5: 30 };
const G15 = 0x537;
const G15_MASK = 0x5412;

function getBCHDigit(data) { let d = 0; while (data !== 0) { d++; data >>>= 1; } return d; }
function getBCHTypeInfo(data) {
    let d = data << 10;
    while (getBCHDigit(d) - getBCHDigit(G15) >= 0) d ^= (G15 << (getBCHDigit(d) - getBCHDigit(G15)));
    return ((data << 10) | d) ^ G15_MASK;
}

function BitBuffer() { this.buffer = []; this.length = 0; }
BitBuffer.prototype.put = function (num, len) { for (let i = 0; i < len; i++) this.putBit(((num >>> (len - i - 1)) & 1) === 1); };
BitBuffer.prototype.putBit = function (bit) {
    const idx = Math.floor(this.length / 8);
    if (this.buffer.length <= idx) this.buffer.push(0);
    if (bit) this.buffer[idx] |= (0x80 >>> (this.length % 8));
    this.length++;
};

function pickVersion(byteLen) {
    for (let v = 1; v <= 5; v++) if (byteLen <= CAPACITY[v][0] - 2) return v;
    return null;
}

function buildDataCodewords(bytes, version) {
    const dataCapacity = CAPACITY[version][0];
    const buf = new BitBuffer();
    buf.put(0b0100, 4);
    buf.put(bytes.length, 8);
    for (const b of bytes) buf.put(b, 8);
    const totalBits = dataCapacity * 8;
    if (buf.length + 4 <= totalBits) buf.put(0, 4);
    while (buf.length % 8 !== 0) buf.putBit(false);
    const pad = [0xEC, 0x11];
    let pi = 0;
    while (buf.buffer.length < dataCapacity) buf.buffer.push(pad[(pi++) % 2]);
    return buf.buffer.slice(0, dataCapacity);
}

function rsEncode(dataBytes, ecCount) {
    const rsPoly = errorCorrectPoly(ecCount);
    const rawPoly = new Poly(dataBytes, rsPoly.getLength() - 1);
    const modPoly = rawPoly.mod(rsPoly);
    const ec = new Array(rsPoly.getLength() - 1).fill(0);
    for (let i = 0; i < ec.length; i++) {
        const mi = i + modPoly.getLength() - ec.length;
        ec[i] = mi >= 0 ? modPoly.get(mi) : 0;
    }
    return ec;
}

function setFinder(modules, n, row, col) {
    for (let r = -1; r <= 7; r++) {
        for (let c = -1; c <= 7; c++) {
            const rr = row + r, cc = col + c;
            if (rr < 0 || rr >= n || cc < 0 || cc >= n) continue;
            const dark = (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
                         (c >= 0 && c <= 6 && (r === 0 || r === 6)) ||
                         (r >= 2 && r <= 4 && c >= 2 && c <= 4);
            modules[rr][cc] = dark;
        }
    }
}
function setAlignment(modules, pos) {
    for (let r = -2; r <= 2; r++)
        for (let c = -2; c <= 2; c++)
            modules[pos + r][pos + c] = (Math.max(Math.abs(r), Math.abs(c)) !== 1);
}
function placeFormatInfo(modules, n, bits) {
    for (let i = 0; i < 15; i++) {
        const mod = ((bits >> i) & 1) === 1;
        if (i < 6) modules[i][8] = mod;
        else if (i < 8) modules[i + 1][8] = mod;
        else modules[n - 15 + i][8] = mod;
        if (i < 8) modules[8][n - i - 1] = mod;
        else if (i < 9) modules[8][15 - i] = mod;
        else modules[8][14 - i] = mod;
    }
}
function getMask(row, col) { return (row + col) % 2 === 0; }

function placeData(modules, n, codewords) {
    let inc = -1, row = n - 1, bitIndex = 7, byteIndex = 0;
    for (let col = n - 1; col > 0; col -= 2) {
        if (col === 6) col--;
        for (;;) {
            for (let c = 0; c < 2; c++) {
                const cc = col - c;
                if (modules[row][cc] === null) {
                    let dark = false;
                    if (byteIndex < codewords.length) dark = ((codewords[byteIndex] >>> bitIndex) & 1) === 1;
                    if (getMask(row, cc)) dark = !dark;
                    modules[row][cc] = dark;
                    bitIndex--;
                    if (bitIndex === -1) { byteIndex++; bitIndex = 7; }
                }
            }
            row += inc;
            if (row < 0 || row >= n) { row -= inc; inc = -inc; break; }
        }
    }
}

function encodeQR(text) {
    const bytes = Array.from(new TextEncoder().encode(text));
    const version = pickVersion(bytes.length);
    if (!version) return null;
    const dataCodewords = buildDataCodewords(bytes, version);
    const ecCodewords = rsEncode(dataCodewords, CAPACITY[version][1]);
    const n = version * 4 + 17;
    const modules = Array.from({ length: n }, () => new Array(n).fill(null));
    setFinder(modules, n, 0, 0);
    setFinder(modules, n, 0, n - 7);
    setFinder(modules, n, n - 7, 0);
    for (let i = 8; i < n - 8; i++) {
        if (modules[i][6] === null) modules[i][6] = (i % 2 === 0);
        if (modules[6][i] === null) modules[6][i] = (i % 2 === 0);
    }
    if (ALIGN_POS[version]) setAlignment(modules, ALIGN_POS[version]);
    modules[n - 8][8] = true; // dark module (always dark)
    placeFormatInfo(modules, n, getBCHTypeInfo((0b01 << 3) | 0)); // level L, mask 0
    placeData(modules, n, dataCodewords.concat(ecCodewords));
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (modules[r][c] === null) modules[r][c] = false;
    return { size: n, isDark: (r, c) => modules[r][c] };
}

function qrToSvgString(qr, opts) {
    opts = opts || {};
    const margin = opts.margin !== undefined ? opts.margin : 2;
    const n = qr.size, full = n + margin * 2;
    let d = '';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + margin},${r + margin}h1v1h-1z`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${full} ${full}" shape-rendering="crispEdges"><rect width="${full}" height="${full}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}

const QR = { encodeQR, qrToSvgString };
if (typeof module !== 'undefined') module.exports = QR;
if (typeof global !== 'undefined') global.QR = QR;
})(typeof window !== 'undefined' ? window : globalThis);
