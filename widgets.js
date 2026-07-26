(function () {
'use strict';
const B = window.__blynkInternals;
const { el, escapeHtml, clamp, decodeBlynkColor, getWidgetPinAddress, formatValueString, formatValueMulti, showToast, openBottomSheet } = B;

function widgetLabel(title, info) {
    if (!title && !info) return null;
    return el('div', { class: 'w-label' }, [
        el('div', { class: 't' }, title || ''),
        info !== undefined && info !== null && info !== '' ? el('div', { class: 'i' }, String(info)) : null,
    ]);
}

function widgetMinMax(widget) {
    const min = widget.min !== undefined && widget.min !== null ? Number(widget.min) : 0;
    const isDigital = (widget.pinType || '').toUpperCase() === 'DIGITAL';
    const max = widget.max !== undefined && widget.max !== null ? Number(widget.max) : (isDigital ? 1 : 255);
    return { min, max };
}

/* ---------- BUTTON / STYLED_BUTTON ---------- */
function ButtonView(widget, ctx) {
    const isStyled = widget.type === 'STYLED_BUTTON';
    const pin = getWidgetPinAddress(widget);
    const { min: wMin, max: wMax } = widgetMinMax(widget);
    let pressed = false;
    const value = ctx.getPinValue(widget.pinId);

    function isActive() { return String(ctx.lastValue) === String(wMax) || pressed; }

    const btn = el('button', { class: 'w-push-btn' + (isStyled ? ' styled' : '') }, isActive() ? (widget.onLabel || 'ON') : (widget.offLabel || 'OFF'));

    function applyStyle() {
        btn.textContent = isActive() ? (widget.onLabel || (widget.onButtonState && widget.onButtonState.text) || 'ON')
                                      : (widget.offLabel || (widget.offButtonState && widget.offButtonState.text) || 'OFF');
        btn.className = 'w-push-btn' + (isStyled ? ' styled' : '') + (isActive() ? ' active' : '');
        if (isStyled) {
            const state = isActive() ? widget.onButtonState : widget.offButtonState;
            if (state) {
                btn.style.background = decodeBlynkColor(state.backgroundColor);
                btn.style.color = decodeBlynkColor(state.textColor);
                btn.style.borderRadius = widget.edge === 'PILL' ? '999px' : widget.edge === 'SHARP' ? '0' : '6px';
            }
        } else {
            btn.style.borderColor = decodeBlynkColor(widget.color);
        }
    }

    ctx.lastValue = value;
    applyStyle();

    function press() {
        pressed = true; applyStyle();
        if (pin === -1) return;
        if (widget.pushMode) {
            ctx.sendWrite(widget.deviceId, pin, wMax);
            ctx.lastValue = wMax;
        } else if (String(ctx.lastValue) === String(wMax)) {
            ctx.sendWrite(widget.deviceId, pin, wMin);
            ctx.lastValue = wMin;
        } else {
            ctx.sendWrite(widget.deviceId, pin, wMax);
            ctx.lastValue = wMax;
        }
        applyStyle();
    }
    function release() {
        pressed = false;
        if (pin !== -1 && widget.pushMode) {
            ctx.sendWrite(widget.deviceId, pin, wMin);
            ctx.lastValue = wMin;
        }
        applyStyle();
    }
    btn.addEventListener('pointerdown', e => { e.preventDefault(); press(); });
    btn.addEventListener('pointerup', release);
    btn.addEventListener('pointerleave', () => { if (pressed) release(); });

    return {
        el: el('div', { class: 'w-btn-wrap' }, btn),
        label: widget.label || (isStyled ? '' : 'Button'),
        onPinUpdate(pinId, value) {
            if (pinId !== widget.pinId) return;
            ctx.lastValue = value; applyStyle();
        },
    };
}

/* ---------- SLIDER / VERTICAL_SLIDER ---------- */
function SliderView(widget, ctx, vertical) {
    const pin = getWidgetPinAddress(widget);
    const { min: wMin, max: wMax } = widgetMinMax(widget);
    let value = clamp(Number(ctx.getPinValue(widget.pinId)) || wMin, wMin, wMax);
    const range = el('input', { type: 'range', class: 'w-range', min: wMin, max: wMax, step: widget.step || 1, value });
    if (vertical) range.setAttribute('orient', 'vertical');
    const infoEl = el('div', { class: 'i' }, String(value));

    range.addEventListener('input', () => {
        const v = Number(range.value);
        infoEl.textContent = String(v);
        if (pin === -1) return;
        ctx.sendWrite(widget.deviceId, pin, v, widget.sendOnReleaseOn);
    });
    range.addEventListener('change', () => {
        if (pin === -1) return;
        if (widget.sendOnReleaseOn) ctx.sendWrite(widget.deviceId, pin, Number(range.value));
    });

    return {
        el: el('div', { class: 'w-slider-wrap' + (vertical ? ' vert' : '') }, range),
        label: widget.label || (!vertical ? 'Slider' : ''),
        infoEl,
        onPinUpdate(pinId, v) {
            if (pinId !== widget.pinId) return;
            if (document.activeElement === range) return;
            range.value = clamp(Number(v), wMin, wMax);
            infoEl.textContent = String(v);
        },
    };
}

/* ---------- LED ---------- */
function LedView(widget, ctx) {
    const color = decodeBlynkColor(widget.color);
    const wrap = el('div', { class: 'w-led-wrap' });
    const dot = el('div', { class: 'w-led' });
    dot.style.color = color;
    dot.style.background = color;
    wrap.appendChild(dot);

    function update(v) {
        const size = 'min(60%,44px)';
        dot.style.width = size; dot.style.height = size;
        dot.style.opacity = clamp((Number(v) || 0) / 255, 0.08, 1);
    }
    update(ctx.getPinValue(widget.pinId) || 0);

    return {
        el: wrap, label: widget.label || 'Led',
        onPinUpdate(pinId, v) { if (pinId === widget.pinId) update(v); },
    };
}

/* ---------- NUMERICAL DISPLAY / LABELED VALUE ---------- */
function NumericalDisplayView(widget, ctx) {
    const valEl = el('div', { class: 'val' });
    function render(v) { valEl.innerHTML = formatValueString(v, widget.valueFormatting); }
    render(ctx.getPinValue(widget.pinId));
    if (widget.fontSize === 'LARGE') valEl.style.fontSize = '26px';
    else if (widget.fontSize === 'SMALL') valEl.style.fontSize = '16px';
    if (widget.textAlignment === 'MIDDLE') valEl.style.textAlign = 'center';
    else if (widget.textAlignment === 'RIGHT') valEl.style.textAlign = 'right';

    return {
        el: el('div', { class: 'w-numeric' }, valEl),
        label: widget.label,
        onPinUpdate(pinId, v) { if (pinId === widget.pinId) render(v); },
    };
}

/* ---------- LCD ---------- */
function LcdDisplayView(widget, ctx) {
    let pin1 = widget.pins && widget.pins[0] && widget.pins[0].pinId !== undefined ? widget.pins[0].pinId : -1;
    let pin2 = widget.pins && widget.pins[1] && widget.pins[1].pinId !== undefined ? widget.pins[1].pinId : -1;
    const singlePin = (pin1 === -1 && pin2 === -1) ? getWidgetPinAddress(widget) : -1;

    const l1 = el('div', { class: 'line' });
    const l2 = el('div', { class: 'line' });

    function render() {
        if (singlePin !== -1) {
            const raw = ctx.getPinValue(singlePin);
            const parts = raw === undefined || raw === null ? ['', ''] : String(raw).split('\n');
            l1.innerHTML = formatValueMulti(parts[0], widget.textFormatLine1, ['pin1', 'pin0', 'pin']);
            l2.innerHTML = formatValueMulti(parts[1], widget.textFormatLine2, ['pin2', 'pin1', 'pin']);
        } else {
            l1.innerHTML = formatValueMulti(ctx.getPinValue(pin1), widget.textFormatLine1, ['pin1', 'pin0', 'pin']);
            l2.innerHTML = formatValueMulti(ctx.getPinValue(pin2), widget.textFormatLine2, ['pin2', 'pin1', 'pin']);
        }
    }
    render();
    return {
        el: el('div', { class: 'w-lcd' }, [l1, l2]), label: null,
        onPinUpdate(pinId) { if (pinId === pin1 || pinId === pin2 || pinId === singlePin) render(); },
    };
}

/* ---------- GAUGE ---------- */
function GaugeView(widget, ctx) {
    const wrap = el('div', { class: 'w-chart-wrap' });
    const color = decodeBlynkColor(widget.color);
    const { min: wMin, max: wMax } = widgetMinMax(widget);
    let box = { w: 140, h: 100 };

    function polar(cx, cy, r, angle) { return [cx + r * Math.sin(angle), cy - r * Math.cos(angle)]; }
    function arcPath(cx, cy, rInner, rOuter, a0, a1) {
        const large = Math.abs(a1 - a0) > Math.PI ? 1 : 0;
        const sweep = a1 > a0 ? 1 : 0;
        const [x0, y0] = polar(cx, cy, rOuter, a0);
        const [x1, y1] = polar(cx, cy, rOuter, a1);
        const [x2, y2] = polar(cx, cy, rInner, a1);
        const [x3, y3] = polar(cx, cy, rInner, a0);
        return `M${x0},${y0} A${rOuter},${rOuter} 0 ${large} ${sweep} ${x1},${y1} L${x2},${y2} A${rInner},${rInner} 0 ${large} ${1 - sweep} ${x3},${y3} Z`;
    }

    function render(value) {
        const w = box.w, h = box.h;
        const cx = w / 2, cy = h / 1.5;
        const thickness = Math.max(8, Math.min(w, h) * 0.14);
        const radius = Math.min(w, h) / 1.5 - thickness / 2;
        const a0 = -Math.PI / 1.5, a1 = Math.PI / 1.5;
        const fillFactor = clamp((Number(value) - wMin) / ((wMax - wMin) || 1), 0, 1);
        const filledA1 = a0 + (a1 - a0) * fillFactor;
        const valueText = formatValueString(value, widget.valueFormatting).replace(/<[^>]+>/g, '');

        wrap.innerHTML = '';
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
        svg.setAttribute('width', '100%'); svg.setAttribute('height', '100%');

        const back = document.createElementNS(svg.namespaceURI, 'path');
        back.setAttribute('d', arcPath(cx, cy, radius - thickness, radius, a0, a1));
        back.setAttribute('fill', '#2a3742');
        svg.appendChild(back);

        if (fillFactor > 0) {
            const front = document.createElementNS(svg.namespaceURI, 'path');
            front.setAttribute('d', arcPath(cx, cy, radius - thickness, radius, a0, filledA1));
            front.setAttribute('fill', color);
            svg.appendChild(front);
        }

        const minL = document.createElementNS(svg.namespaceURI, 'text');
        minL.setAttribute('x', cx - radius); minL.setAttribute('y', cy + 13);
        minL.setAttribute('fill', '#71828e'); minL.setAttribute('font-size', '9');
        minL.textContent = wMin;
        svg.appendChild(minL);

        const maxL = document.createElementNS(svg.namespaceURI, 'text');
        maxL.setAttribute('x', cx + radius - 14); maxL.setAttribute('y', cy + 13);
        maxL.setAttribute('fill', '#71828e'); maxL.setAttribute('font-size', '9');
        maxL.setAttribute('text-anchor', 'end');
        maxL.textContent = wMax;
        svg.appendChild(maxL);

        const valT = document.createElementNS(svg.namespaceURI, 'text');
        valT.setAttribute('x', cx); valT.setAttribute('y', cy - radius / 2.6);
        valT.setAttribute('fill', color); valT.setAttribute('font-size', Math.max(11, radius * 0.22));
        valT.setAttribute('font-weight', '700'); valT.setAttribute('text-anchor', 'middle');
        valT.textContent = valueText;
        svg.appendChild(valT);

        wrap.appendChild(svg);
    }
    render(ctx.getPinValue(widget.pinId) || 0);

    return {
        el: wrap, label: widget.label || 'Gauge',
        onResize(w, h) { box = { w, h }; render(ctx.getPinValue(widget.pinId) || 0); },
        onPinUpdate(pinId, v) { if (pinId === widget.pinId) render(v); },
    };
}

/* ---------- LEVEL / VERTICAL_LEVEL ---------- */
function LevelView(widget, ctx) {
    const isVertical = widget.type === 'VERTICAL_LEVEL_DISPLAY';
    const color = decodeBlynkColor(widget.color);
    const { min: wMin, max: wMax } = widgetMinMax(widget);
    const back = el('div', { style: { position: 'absolute', inset: '0', background: '#2a3742', borderRadius: '4px' } });
    const front = el('div', { style: { position: 'absolute', background: color, borderRadius: '4px' } });
    const box = el('div', { style: { position: 'relative', flex: '1', width: '100%', minHeight: '0' } }, [back, front]);

    function render(value) {
        const fillFactor = clamp((Number(value) - wMin) / ((wMax - wMin) || 1), 0, 1);
        front.style.opacity = fillFactor ? '1' : '0';
        if (isVertical) {
            front.style.left = '0'; front.style.right = '0'; front.style.width = 'auto';
            front.style.height = (fillFactor * 100) + '%';
            front.style[widget.isAxisFlipOn ? 'top' : 'bottom'] = '0';
            front.style[widget.isAxisFlipOn ? 'bottom' : 'top'] = 'auto';
        } else {
            front.style.top = '0'; front.style.bottom = '0'; front.style.height = 'auto';
            front.style.width = (fillFactor * 100) + '%';
            front.style[widget.isAxisFlipOn ? 'right' : 'left'] = '0';
            front.style[widget.isAxisFlipOn ? 'left' : 'right'] = 'auto';
        }
    }
    render(ctx.getPinValue(widget.pinId));
    const infoEl = el('div', { class: 'i' }, String(ctx.getPinValue(widget.pinId) || ''));

    return {
        el: el('div', { class: 'w-chart-wrap', style: { flexDirection: 'column' } }, box),
        label: widget.label || (isVertical ? '' : 'Level'),
        infoEl,
        onPinUpdate(pinId, v) { if (pinId === widget.pinId) { render(v); infoEl.textContent = String(v); } },
    };
}

/* ---------- STEP / VERTICAL_STEP ---------- */
function StepView(widget, ctx) {
    const isVertical = widget.type === 'VERTICAL_STEP';
    const pin = getWidgetPinAddress(widget);
    const { min: wMin, max: wMax } = widgetMinMax(widget);
    const arrows = !!widget.isArrowsOn;
    let repeatTimer = null;

    const valueEl = el('div', { class: 'w-step-value' }, String(ctx.getPinValue(widget.pinId) ?? ''));

    function labelFor(dir) {
        if (!arrows) return dir === -1 ? '\u2190' : '\u2192';
        return dir === -1 ? '\u2212' : '+';
    }
    function makeBtn(dir) {
        const b = el('div', { class: 'w-step-btn' }, labelFor(isVertical ? dir * -1 : dir));
        const fire = () => {
            const step = widget.step || 1;
            let value = Number(ctx.getPinValue(widget.pinId)) || 0;
            let sendValue;
            if (widget.isSendStep) sendValue = step * dir;
            else {
                sendValue = value + step * dir;
                if (sendValue > wMax) sendValue = widget.isLoopOn ? wMin : wMax;
                else if (sendValue < wMin) sendValue = widget.isLoopOn ? wMax : wMin;
            }
            if (pin !== -1) ctx.sendWrite(widget.deviceId, pin, sendValue);
            valueEl.textContent = String(sendValue);
        };
        const down = e => { e.preventDefault(); fire(); repeatTimer = setInterval(fire, 90); };
        const up = () => clearInterval(repeatTimer);
        b.addEventListener('pointerdown', down);
        b.addEventListener('pointerup', up);
        b.addEventListener('pointerleave', up);
        return b;
    }

    const container = el('div', { class: 'w-step' + (isVertical ? ' vert' : '') }, [
        makeBtn(isVertical ? 1 : -1),
        valueEl,
        makeBtn(isVertical ? -1 : 1),
    ]);
    const infoEl = el('div', { class: 'i' }, String(ctx.getPinValue(widget.pinId) ?? ''));

    return {
        el: container, label: widget.label || (isVertical ? 'Step V' : 'Step H'), infoEl,
        onPinUpdate(pinId, v) {
            if (pinId !== widget.pinId) return;
            infoEl.textContent = String(v);
            valueEl.textContent = String(v);
        },
    };
}

/* ---------- SEGMENTED CONTROL ---------- */
function SegmentedControlView(widget, ctx) {
    const pin = getWidgetPinAddress(widget);
    const color = decodeBlynkColor(widget.color);
    const wrap = el('div', { class: 'w-seg' });
    const btns = [];
    (widget.labels || []).forEach((label, idx) => {
        const b = el('div', { class: 'w-seg-btn' }, label);
        b.addEventListener('click', () => {
            if (pin !== -1) ctx.sendWrite(widget.deviceId, pin, idx + 1);
            paint(idx + 1);
        });
        btns.push(b);
        wrap.appendChild(b);
    });
    function paint(value) {
        btns.forEach((b, idx) => {
            const active = Number(value) === idx + 1;
            b.classList.toggle('active', active);
            b.style.background = active ? color : '';
            b.style.borderColor = active ? color : '';
        });
    }
    paint(ctx.getPinValue(widget.pinId) || 0);

    return {
        el: wrap, label: widget.label,
        onPinUpdate(pinId, v) { if (pinId === widget.pinId) paint(v); },
    };
}

/* ---------- MENU ---------- */
function MenuView(widget, ctx) {
    const pin = getWidgetPinAddress(widget);
    const labels = widget.labels || [];
    const select = el('select', { class: 'input w-menu-select' },
        labels.map((label, idx) => el('option', { value: idx + 1 }, label)));

    function paint(value) {
        const v = Number(value);
        if (v >= 1 && v <= labels.length) select.value = String(v);
    }
    paint(ctx.getPinValue(widget.pinId) || 1);

    select.addEventListener('change', () => {
        if (pin === -1) return;
        ctx.sendWrite(widget.deviceId, pin, Number(select.value));
    });

    return {
        el: el('div', { class: 'w-menu' }, select),
        label: widget.label || 'Menu',
        onPinUpdate(pinId, v) { if (pinId === widget.pinId) paint(v); },
    };
}

/* ---------- TIME_INPUT ---------- */
function TimeInputView(widget, ctx) {
    let pin = getWidgetPinAddress(widget);
    let pinIdForListen = widget.pinId;
    if (pin === -1 && widget.pins && widget.pins[0]) {
        pin = getWidgetPinAddress(widget.pins[0]);
        pinIdForListen = widget.pins[0].pinId;
    }

    const showStop = widget.isStartStopAllowed !== false;
    const showDays = widget.isDayOfWeekAllowed !== false;
    const showTz = widget.isTimezoneAllowed !== false;
    const showSun = widget.isSunsetSunriseAllowed === true;

    const DAYS = [
        { n: 1, label: 'T2' }, { n: 2, label: 'T3' }, { n: 3, label: 'T4' }, { n: 4, label: 'T5' },
        { n: 5, label: 'T6' }, { n: 6, label: 'T7' }, { n: 7, label: 'CN' },
    ];
    const ALL_DAYS = [1, 2, 3, 4, 5, 6, 7];
    const rtcTz = ctx.getRtcTimezone && ctx.getRtcTimezone();
    const TIMEZONES = [
        'Asia/Ho_Chi_Minh', 'UTC', 'Asia/Bangkok', 'Asia/Singapore', 'Asia/Tokyo',
        'Asia/Shanghai', 'Europe/London', 'Europe/Paris', 'America/New_York', 'America/Los_Angeles',
    ];
    if (rtcTz && !TIMEZONES.includes(rtcTz)) TIMEZONES.unshift(rtcTz);
    else if (rtcTz) { TIMEZONES.splice(TIMEZONES.indexOf(rtcTz), 1); TIMEZONES.unshift(rtcTz); }

    function secToHHMM(sec) {
        if (sec === 'SR') return 'Mặt trời mọc';
        if (sec === 'SS') return 'Mặt trời lặn';
        sec = Number(sec);
        if (!isFinite(sec) || sec < 0) return '--:--';
        const h = Math.floor(sec / 3600) % 24, m = Math.floor((sec % 3600) / 60);
        return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
    }
    function hhmmToSec(hhmm) {
        if (!hhmm) return -1;
        const [h, m] = hhmm.split(':').map(Number);
        return h * 3600 + m * 60;
    }
    function parseValue(raw) {
        raw = raw === undefined || raw === null ? '' : String(raw);
        const parts = raw.includes('\0') ? raw.split('\0') : raw.trim().split(/\s+/).filter(Boolean);
        function parseTime(p) {
            if (p === 'SR' || p === 'SS') return p;
            const n = Number(p);
            return p !== undefined && p !== '' && isFinite(n) ? n : -1;
        }
        const start = parseTime(parts[0]);
        const stop = parseTime(parts[1]);
        const rest = parts.slice(2).filter(p => p !== undefined && p !== '');
        const daysField = rest.find(p => /^[1-7](,[1-7])*$/.test(p));
        const tzField = rest.find(p => p !== daysField && (TIMEZONES.includes(p) || p.includes('/')));
        const days = daysField ? daysField.split(',').map(Number) : ALL_DAYS;
        const tz = tzField || TIMEZONES[0];
        return { start, stop, days, tz };
    }
    function tzOffsetSeconds(tz) {
        try {
            const now = new Date();
            const asUTC = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' }));
            const asTZ = new Date(now.toLocaleString('en-US', { timeZone: tz }));
            return Math.round((asTZ - asUTC) / 1000);
        } catch (e) { return 25200; }
    }
    function daysSummary(days) {
        if (ALL_DAYS.every(d => days.includes(d)) && days.length === 7) return 'Hàng ngày';
        if (!days.length) return 'Không lặp lại';
        return DAYS.filter(d => days.includes(d.n)).map(d => d.label).join(', ');
    }

    const rangeEl = el('div', { class: 'w-timein-range' }, '--:--');
    const daysSumEl = el('div', { class: 'w-timein-dayssum' }, '');
    const display = el('div', { class: 'w-timein-display' }, [rangeEl, daysSumEl]);
    display.addEventListener('click', () => openEditSheet());

    const startInput = el('input', { type: 'time', class: 'w-time-input' });
    const stopInput = el('input', { type: 'time', class: 'w-time-input' });
    const tzSelect = el('select', { class: 'input w-time-input' }, TIMEZONES.map(tz => el('option', { value: tz }, tz)));
    const dayBtns = {};
    const daysRow = el('div', { class: 'w-timein-days' }, DAYS.map(d => {
        const b = el('div', { class: 'w-day-chip' }, d.label);
        b.addEventListener('click', () => { b.classList.toggle('active'); });
        dayBtns[d.n] = b;
        return b;
    }));
    function makeSunModeSelect(labelPrefix) {
        if (!showSun) return null;
        const sel = el('select', { class: 'input w-time-input' }, [
            el('option', { value: 'FIXED' }, 'Giờ cố định'),
            el('option', { value: 'SR' }, 'Lúc mặt trời mọc'),
            el('option', { value: 'SS' }, 'Lúc mặt trời lặn'),
        ]);
        return sel;
    }
    const startSunSelect = makeSunModeSelect('start');
    const stopSunSelect = makeSunModeSelect('stop');
    function syncSunUI(sel, timeInput, mode) {
        if (!sel) return;
        sel.value = mode === 'SR' || mode === 'SS' ? mode : 'FIXED';
        timeInput.style.display = sel.value === 'FIXED' ? '' : 'none';
    }
    if (startSunSelect) startSunSelect.addEventListener('change', () => { startInput.style.display = startSunSelect.value === 'FIXED' ? '' : 'none'; });
    if (stopSunSelect) stopSunSelect.addEventListener('change', () => { stopInput.style.display = stopSunSelect.value === 'FIXED' ? '' : 'none'; });

    const saveBtn = el('button', { class: 'btn btn-sm btn-primary w-timein-save' }, 'Lưu lịch hẹn giờ');

    let lastRaw;
    function paint(raw) {
        lastRaw = raw;
        const v = parseValue(raw);
        rangeEl.textContent = showStop ? (secToHHMM(v.start) + ' - ' + secToHHMM(v.stop)) : secToHHMM(v.start);
        daysSumEl.textContent = showDays ? daysSummary(v.days) : '';
        daysSumEl.style.display = showDays ? '' : 'none';
        if (document.activeElement !== startInput) startInput.value = (v.start !== -1 && v.start !== 'SR' && v.start !== 'SS') ? secToHHMM(v.start) : '';
        if (document.activeElement !== stopInput) stopInput.value = (v.stop !== -1 && v.stop !== 'SR' && v.stop !== 'SS') ? secToHHMM(v.stop) : '';
        if (document.activeElement !== tzSelect && TIMEZONES.includes(v.tz)) tzSelect.value = v.tz;
        DAYS.forEach(d => dayBtns[d.n].classList.toggle('active', v.days.includes(d.n)));
        syncSunUI(startSunSelect, startInput, v.start);
        syncSunUI(stopSunSelect, stopInput, v.stop);
    }
    paint(pin !== -1 ? ctx.getPinValue(pinIdForListen) : undefined);

    function commit(closeAfter) {
        if (pin === -1) {
            showToast('Widget Hẹn giờ chưa gán pin — không thể lưu', true);
            return;
        }
        const prev = parseValue(lastRaw);
        let startSec;
        if (startSunSelect && startSunSelect.value !== 'FIXED') startSec = startSunSelect.value;
        else startSec = startInput.value ? hhmmToSec(startInput.value) : prev.start;

        let stopSec;
        if (!showStop) stopSec = prev.stop;
        else if (stopSunSelect && stopSunSelect.value !== 'FIXED') stopSec = stopSunSelect.value;
        else stopSec = stopInput.value ? hhmmToSec(stopInput.value) : prev.stop;

        const daysStr = showDays
            ? (() => { const sel = DAYS.filter(d => dayBtns[d.n].classList.contains('active')).map(d => d.n); return (sel.length ? sel : ALL_DAYS).join(','); })()
            : prev.days.join(',');
        const tz = showTz ? tzSelect.value : prev.tz;
        const payload = [startSec, stopSec, tz, daysStr, tzOffsetSeconds(tz)].join('\0');
        ctx.sendWrite(widget.deviceId, pin, payload);
        showToast('Đã lưu lịch hẹn giờ');
        paint(payload);
        if (closeAfter) closeAfter();
    }

    function openEditSheet() {
        paint(lastRaw);
        const rows = [];
        rows.push(el('div', { class: 'w-timein-row' }, [el('span', {}, showStop ? 'Bắt đầu' : 'Thời gian'), startInput]));
        if (startSunSelect) rows.push(el('div', { class: 'w-timein-row' }, [el('span', {}, ''), startSunSelect]));
        if (showStop) {
            rows.push(el('div', { class: 'w-timein-row' }, [el('span', {}, 'Kết thúc'), stopInput]));
            if (stopSunSelect) rows.push(el('div', { class: 'w-timein-row' }, [el('span', {}, ''), stopSunSelect]));
        }
        if (showTz) rows.push(el('div', { class: 'w-timein-row' }, [el('span', {}, 'Múi giờ'), tzSelect]));
        if (showDays) {
            rows.push(el('div', { class: 'w-timein-row' }, [el('span', {}, 'Ngày lặp')]));
            rows.push(daysRow);
        }
        rows.push(saveBtn);
        const body = el('div', { class: 'w-timein-sheet-body' }, rows);
        const close = openBottomSheet(widget.label || 'Hẹn giờ', body);
        saveBtn.onclick = () => commit(close);
    }

    return {
        el: el('div', { class: 'w-timein' }, [display]),
        label: widget.label || 'Hẹn giờ',
        onPinUpdate(pinId, v) { if (pinId === pinIdForListen) paint(v); },
    };
}

/* ---------- TEXT_INPUT / NUMBER_INPUT ---------- */
function TextInputView(widget, ctx) {
    const isNumber = widget.type === 'NUMBER_INPUT';
    const pin = getWidgetPinAddress(widget);
    const input = el('input', { type: isNumber ? 'text' : 'text', placeholder: widget.hint || '', value: ctx.getPinValue(widget.pinId) || '' });
    if (isNumber) input.style.textAlign = 'center';

    function commit() {
        let v = input.value;
        if (isNumber) v = Number(v) || widget.min || 0;
        if (pin !== -1) ctx.sendWrite(widget.deviceId, pin, v);
    }
    input.addEventListener('blur', commit);
    input.addEventListener('keypress', e => { if (e.key === 'Enter') input.blur(); });

    const children = [];
    if (isNumber) {
        children.push(el('div', { class: 'mini', onclick: () => { input.value = (Number(input.value) || 0) - (widget.step || 1); commit(); } }, '\u2212'));
    }
    children.push(input);
    children.push(el('div', { class: 'mini', onclick: isNumber ? () => { input.value = (Number(input.value) || 0) + (widget.step || 1); commit(); } : commit },
        isNumber ? '+' : '\u23ce'));

    const suffix = (widget.suffix || '').trim();
    return {
        el: el('div', { class: 'w-textin' }, children),
        label: (widget.label || '') + (suffix ? ` (${suffix})` : ''),
        onPinUpdate(pinId, v) { if (pinId === widget.pinId && document.activeElement !== input) input.value = v; },
    };
}

/* ---------- TERMINAL ---------- */
function TerminalView(widget, ctx) {
    const pin = getWidgetPinAddress(widget);
    const out = el('div', { class: 'w-term-out' });
    const history = [];
    let lastAppended;

    function append(line) {
        history.push(line);
        if (history.length > 300) history.shift();
        out.textContent = history.join(widget.attachNewLine === false ? '' : '\n');
        if (widget.autoScrollOn !== false) out.scrollTop = out.scrollHeight;
    }
    function onValue(v) {
        const s = String(v);
        if (s === lastAppended) return;
        lastAppended = s;
        append(s);
    }
    if (ctx.getPinValue(widget.pinId) !== undefined) onValue(ctx.getPinValue(widget.pinId));

    const children = [el('div', { class: 'w-term-out' }, out)];
    let realOut = children[0];

    let inputRow = null;
    if (widget.terminalInputOn) {
        const input = el('input', { placeholder: 'Nhập lệnh...' });
        const send = () => {
            if (!input.value) return;
            if (pin !== -1) ctx.sendWrite(widget.deviceId, pin, input.value);
            append('> ' + input.value);
            input.value = '';
        };
        input.addEventListener('keypress', e => { if (e.key === 'Enter') send(); });
        inputRow = el('div', { class: 'w-term-in' }, [input, el('div', { class: 'mini', onclick: send }, '\u23ce')]);
    }

    return {
        el: el('div', { class: 'w-terminal' }, [realOut, inputRow]),
        label: null,
        onPinUpdate(pinId, v) { if (pinId === widget.pinId) onValue(v); },
    };
}

/* ---------- RGB ---------- */
function RgbView(widget, ctx) {
    const pin1 = widget.pins && widget.pins[0] ? widget.pins[0].pinId : -1;
    const pin2 = widget.pins && widget.pins[1] ? widget.pins[1].pinId : -1;
    const pin3 = widget.pins && widget.pins[2] ? widget.pins[2].pinId : -1;
    const p1 = widget.pins && widget.pins[0] ? getWidgetPinAddress(widget.pins[0]) : -1;
    const p2 = widget.pins && widget.pins[1] ? getWidgetPinAddress(widget.pins[1]) : -1;
    const p3 = widget.pins && widget.pins[2] ? getWidgetPinAddress(widget.pins[2]) : -1;

    function toHex(r, g, b) {
        const h = n => Math.round(clamp(Number(n) || 0, 0, 255)).toString(16).padStart(2, '0');
        return '#' + h(r) + h(g) + h(b);
    }
    const picker = el('input', { type: 'color', value: toHex(ctx.getPinValue(pin1), ctx.getPinValue(pin2), ctx.getPinValue(pin3)) });
    const valLabel = el('div', { class: 'rgb-val' }, picker.value.toUpperCase());

    picker.addEventListener('input', () => {
        const hex = picker.value;
        const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
        valLabel.textContent = hex.toUpperCase();
        if (p1 !== -1) ctx.sendWrite(widget.deviceId, p1, r);
        if (p2 !== -1) ctx.sendWrite(widget.deviceId, p2, g);
        if (p3 !== -1) ctx.sendWrite(widget.deviceId, p3, b);
    });

    return {
        el: el('div', { class: 'w-rgb' }, [picker, valLabel]),
        label: widget.label || 'RGB',
        onPinUpdate(pinId) {
            if (pinId !== pin1 && pinId !== pin2 && pinId !== pin3) return;
            const hex = toHex(ctx.getPinValue(pin1), ctx.getPinValue(pin2), ctx.getPinValue(pin3));
            picker.value = hex; valLabel.textContent = hex.toUpperCase();
        },
    };
}

/* ---------- TWO_AXIS_JOYSTICK ---------- */
function TwoAxisJoystickView(widget, ctx) {
    const pins = widget.pins || [];
    const pin1Id = pins[0] ? pins[0].pinId : -1;
    const pin2Id = pins[1] ? pins[1].pinId : -1;
    const p1 = pins[0] ? getWidgetPinAddress(pins[0]) : -1;
    const p2 = pins[1] ? getWidgetPinAddress(pins[1]) : -1;
    const mid1 = pins[0] ? ((pins[0].max - pins[0].min + 1) / 2) : 512;
    const mid2 = pins[1] ? ((pins[1].max - pins[1].min + 1) / 2) : 512;

    const area = el('div', { class: 'w-joy-area' });
    const stick = el('div', { class: 'w-joy-stick' });
    stick.style.background = decodeBlynkColor(widget.color);
    area.appendChild(stick);
    const wrap = el('div', { class: 'w-joy-wrap' }, area);
    const infoEl = el('div', { class: 'i' }, (ctx.getPinValue(pin1Id) ?? mid1) + ' / ' + (ctx.getPinValue(pin2Id) ?? mid2));

    let areaSize = 100, stickSize = 34, margin = 0;
    function layout() {
        const box = wrap.getBoundingClientRect();
        areaSize = Math.max(40, Math.min(box.width, box.height) - 16);
        stickSize = areaSize * 0.42;
        margin = (areaSize - stickSize) / 2;
        area.style.width = areaSize + 'px'; area.style.height = areaSize + 'px';
        stick.style.width = stickSize + 'px'; stick.style.height = stickSize + 'px';
        placeStick(0, 0);
    }
    function placeStick(dx, dy) {
        stick.style.left = (margin + dx) + 'px';
        stick.style.top = (margin + dy) + 'px';
    }

    let dragging = false;
    function toValue(dx, dy) {
        const r = margin;
        const v1 = Math.round(mid1 + (dx / r) * mid1);
        const v2 = Math.round(mid2 - (dy / r) * mid2);
        return [v1, v2];
    }
    area.addEventListener('pointerdown', e => { dragging = true; area.setPointerCapture(e.pointerId); move(e); });
    area.addEventListener('pointermove', e => { if (dragging) move(e); });
    area.addEventListener('pointerup', end);
    area.addEventListener('pointercancel', end);

    function move(e) {
        const box = area.getBoundingClientRect();
        let dx = (e.clientX - box.left) - areaSize / 2;
        let dy = (e.clientY - box.top) - areaSize / 2;
        const r = margin;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > r) { dx *= r / dist; dy *= r / dist; }
        placeStick(dx, dy);
        const [v1, v2] = toValue(dx, dy);
        infoEl.textContent = v1 + ' / ' + v2;
        if (p1 !== -1) ctx.sendWrite(widget.deviceId, p1, v1);
        if (p2 !== -1) ctx.sendWrite(widget.deviceId, p2, v2);
    }
    function end() {
        dragging = false;
        placeStick(0, 0);
        infoEl.textContent = mid1 + ' / ' + mid2;
        if (p1 !== -1) ctx.sendWrite(widget.deviceId, p1, mid1);
        if (p2 !== -1) ctx.sendWrite(widget.deviceId, p2, mid2);
    }

    function renderFromPins() {
        if (dragging) return;
        const v1raw = ctx.getPinValue(pin1Id), v2raw = ctx.getPinValue(pin2Id);
        const v1 = v1raw !== undefined ? Number(v1raw) : mid1;
        const v2 = v2raw !== undefined ? Number(v2raw) : mid2;
        const r = margin || 1;
        const dx = mid1 ? ((v1 - mid1) / mid1) * r : 0;
        const dy = mid2 ? -((v2 - mid2) / mid2) * r : 0;
        placeStick(clamp(dx, -r, r), clamp(dy, -r, r));
        infoEl.textContent = v1 + ' / ' + v2;
    }

    return {
        el: wrap, label: widget.label || 'Joystick', infoEl,
        onResize(w, h) { layout(); renderFromPins(); },
        onPinUpdate(pinId) { if (pinId === pin1Id || pinId === pin2Id) renderFromPins(); },
    };
}

/* ---------- IMAGE ---------- */
function ImageView(widget, ctx) {
    const box = el('div', { class: 'w-image' });
    function render(value) {
        box.innerHTML = '';
        const urls = widget.urls || [];
        if (!urls.length) return;
        let url = urls[0];
        const idx = Number(value);
        if (idx >= 1 && idx <= urls.length) url = urls[idx - 1];
        const img = el('img', { src: url, alt: 'image' });
        if (widget.scaling === 'FIT') img.style.objectFit = 'contain';
        box.appendChild(img);
    }
    render(ctx.getPinValue(widget.pinId));
    return {
        el: box, label: widget.label,
        onPinUpdate(pinId, v) { if (pinId === widget.pinId) render(v); },
    };
}

/* ---------- MAP ---------- */
function MapView(widget, ctx) {
    const lat = widget.lat, lon = widget.lon;
    const box = el('div', { class: 'w-map' });
    if (lat !== undefined && lon !== undefined) {
        const d = 0.01;
        const bbox = [lon - d, lat - d, lon + d, lat + d].join('%2C');
        const src = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&marker=${lat}%2C${lon}&layer=mapnik`;
        box.appendChild(el('iframe', { src, loading: 'lazy' }));
    }
    return { el: box, label: null, onPinUpdate() {} };
}

/* ---------- TABS ---------- */
function TabsView(widget, ctx) {
    const list = el('div', { class: 'w-tabs-list' });
    function render() {
        list.innerHTML = '';
        (widget.tabs || []).forEach((tab, idx) => {
            const t = el('div', { class: 'wt-tab' + (idx === ctx.state.activeTabId ? ' active' : '') }, tab.label || `Tab ${idx + 1}`);
            t.addEventListener('click', () => { ctx.setActiveTab(idx); });
            list.appendChild(t);
        });
    }
    render();
    return { el: list, label: null, rootClass: 'w-tabs', rerenderOnTabChange: render, onPinUpdate() {} };
}

/* ---------- DEVICE_SELECTOR ---------- */
function DeviceSelectorView(widget, ctx) {
    const allDevices = ctx.getDevices();
    const allowedIds = Array.isArray(widget.deviceIds) && widget.deviceIds.length ? widget.deviceIds : null;
    const devices = allowedIds ? allDevices.filter(d => allowedIds.includes(d.id)) : allDevices;

    const select = el('select', { class: 'input w-devsel-select' },
        devices.map(d => el('option', { value: d.id }, d.name || ('Thiết bị ' + d.id))));
    const initial = widget.value !== undefined ? widget.value : ctx.getSelectedDevice();
    select.value = String(initial);
    select.addEventListener('change', () => {
        ctx.setSelectedDevice(Number(select.value));
    });
    return {
        el: el('div', { class: 'w-devsel' }, select),
        label: widget.label || 'Thiết bị',
        onPinUpdate() {},
    };
}

/* ---------- TIMER ---------- */
function TimerView(widget, ctx) {
    const pin = getWidgetPinAddress(widget);

    function sec2hhmm(sec) {
        sec = Number(sec);
        if (!isFinite(sec) || sec < 0) return '--:--';
        const h = Math.floor(sec / 3600) % 24, m = Math.floor((sec % 3600) / 60);
        return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
    }
    const startTime = widget.startTime !== undefined ? widget.startTime : (widget.value ? Number(String(widget.value).split(' ')[0]) : -1);
    const stopTime = widget.stopTime !== undefined ? widget.stopTime : (widget.value ? Number(String(widget.value).split(' ')[1]) : -1);
    const onValue = widget.startValue !== undefined ? widget.startValue : (widget.max !== undefined ? widget.max : 1);
    const offValue = widget.stopValue !== undefined ? widget.stopValue : (widget.min !== undefined ? widget.min : 0);

    let lastValue = pin !== -1 ? ctx.getPinValue(widget.pinId) : undefined;

    function statusInfo(v) {
        const isOn = v !== undefined && String(v) === String(onValue);
        return {
            dotClass: 'dot' + (v === undefined ? '' : (isOn ? ' on' : ' off')),
            text: v === undefined ? 'Chưa có dữ liệu' : (isOn ? 'Đang BẬT' : 'Đang TẮT'),
        };
    }

    const cardDot = el('span', { class: 'dot' });
    const cardText = el('span', {}, '');
    function paintCard() {
        const s = statusInfo(lastValue);
        cardDot.className = s.dotClass;
        cardText.textContent = s.text;
    }
    paintCard();
    const rangeEl = el('div', { class: 'w-timein-range' }, sec2hhmm(startTime) + ' - ' + sec2hhmm(stopTime));
    const display = el('div', { class: 'w-timein-display' }, [rangeEl, el('div', { class: 'w-timein-dayssum' }, [cardDot, cardText])]);
    display.addEventListener('click', openSheet);

    function openSheet() {
        const s = statusInfo(lastValue);
        const popupDot = el('span', { class: s.dotClass });
        const popupText = el('span', {}, s.text);
        const rtcTz = ctx.getRtcTimezone && ctx.getRtcTimezone();
        const infoRows = [
            el('div', { class: 'row status' }, [popupDot, popupText]),
            el('div', { class: 'row' }, [el('span', { class: 'k' }, 'Bật lúc'), el('span', { class: 'v' }, sec2hhmm(startTime))]),
            el('div', { class: 'row' }, [el('span', { class: 'k' }, 'Tắt lúc'), el('span', { class: 'v' }, sec2hhmm(stopTime))]),
        ];
        if (rtcTz) infoRows.push(el('div', { class: 'row' }, [el('span', { class: 'k' }, 'Múi giờ (theo RTC)'), el('span', { class: 'v' }, rtcTz)]));
        const rows = [
            el('div', { class: 'w-timer-info' }, infoRows),
            el('div', { class: 'w-eventor-note' }, 'Lịch hẹn giờ này nằm trong cấu hình project trên server Blynk — console chỉ đọc để hiển thị, chưa có cách sửa giờ hẹn từ đây (cần đổi trong app/project gốc). Vẫn bật/tắt thủ công ngay được bên dưới.'),
        ];
        if (pin !== -1) {
            rows.push(el('div', { class: 'w-timer-btns' }, [
                el('button', { class: 'btn btn-sm', onclick: () => ctx.sendWrite(widget.deviceId, pin, onValue) }, 'Bật ngay'),
                el('button', { class: 'btn btn-sm btn-ghost', onclick: () => ctx.sendWrite(widget.deviceId, pin, offValue) }, 'Tắt ngay'),
            ]));
        }
        openBottomSheet(widget.label || 'Timer', el('div', { class: 'w-timein-sheet-body' }, rows));
    }

    return {
        el: el('div', { class: 'w-timein' }, [display]),
        label: widget.label || 'Timer',
        onPinUpdate(pinId, v) { if (pinId === widget.pinId) { lastValue = v; paintCard(); } },
    };
}

/* ---------- TABLE ---------- */
function TableView(widget, ctx) {
    const pin = getWidgetPinAddress(widget);
    const rows = [];
    const body = el('div', { class: 'w-table-body' });
    const empty = el('div', { class: 'w-table-empty' }, 'Chưa có dữ liệu');

    function renderRows() {
        body.innerHTML = '';
        if (!rows.length) { body.appendChild(empty); return; }
        rows.forEach(row => {
            const tr = el('div', { class: 'w-table-row' + (row.selected ? ' selected' : '') }, row.cells.map(c => el('div', { class: 'cell' }, String(c))));
            tr.addEventListener('click', () => {
                row.selected = !row.selected;
                if (pin !== -1) ctx.sendWrite(widget.deviceId, pin, `select ${row.id} ${row.selected ? 1 : 0}`, true);
                renderRows();
            });
            body.appendChild(tr);
        });
    }
    renderRows();

    function handleCommand(raw) {
        const str = String(raw || '');
        const parts = str.split(' ');
        const cmd = parts[0];
        if (cmd === 'add') {
            const id = parts[1];
            const cells = parts.slice(2);
            rows.push({ id, cells, selected: false });
            if (rows.length > 200) rows.shift();
        } else if (cmd === 'clear') {
            rows.length = 0;
        } else if (cmd === 'delete') {
            const idx = rows.findIndex(r => r.id === parts[1]);
            if (idx !== -1) rows.splice(idx, 1);
        } else if (cmd === 'update') {
            const row = rows.find(r => r.id === parts[1]);
            const colIdx = Number(parts[2]);
            if (row && !isNaN(colIdx)) row.cells[colIdx] = parts.slice(3).join(' ');
        } else if (cmd === 'select') {
            const row = rows.find(r => r.id === parts[1]);
            if (row) row.selected = parts[2] === '1';
        }
        renderRows();
    }
    const initial = ctx.getPinValue(widget.pinId);
    if (initial !== undefined) handleCommand(initial);

    return {
        el: el('div', { class: 'w-table' }, body),
        label: widget.label || 'Table',
        onPinUpdate(pinId, value) { if (pinId === widget.pinId) handleCommand(value); },
    };
}

/* ---------- RTC ---------- */
function RtcView(widget) {
    const wrap = el('div', { class: 'w-numeric' }, el('div', { class: 'val', style: { fontSize: '15px' } }));
    const valEl = wrap.querySelector('.val');
    function render() {
        try {
            valEl.textContent = new Intl.DateTimeFormat('vi-VN', {
                hour: '2-digit', minute: '2-digit', second: '2-digit',
                timeZone: widget.tzName || 'UTC',
            }).format(new Date());
        } catch (e) { valEl.textContent = new Date().toLocaleTimeString(); }
    }
    render();
    const timer = setInterval(() => {
        if (!wrap.isConnected) { clearInterval(timer); return; }
        render();
    }, 1000);
    return { el: wrap, label: widget.label || 'RTC', onPinUpdate() {} };
}

/* ---------- EVENTOR ---------- */
function EventorView(widget) {
    const rules = widget.rules || [];
    function describeRule(r) {
        const cond = r.condition ? r.condition.type : '?';
        const nActions = (r.actions || []).length;
        return `${r.isActive === false ? '⏸' : '▶'} Khi pin ${r.triggerPin ? getWidgetPinAddress(r.triggerPin) : '?'} ${cond} → ${nActions} hành động`;
    }
    const body = rules.length
        ? el('div', { class: 'w-eventor' }, [
            el('div', { class: 'w-eventor-count' }, `${rules.length} quy tắc tự động hoá`),
            el('div', { class: 'w-eventor-rules' }, rules.slice(0, 4).map(r => el('div', { class: 'w-eventor-rule' }, describeRule(r)))),
            el('div', { class: 'w-eventor-note' }, 'Chạy phía server, không cần mở trang này'),
          ])
        : el('div', { class: 'w-eventor-note' }, 'Chưa có quy tắc nào được cấu hình');
    return { el: body, label: widget.label || 'Eventor', onPinUpdate() {} };
}

/* ---------- GPS_STREAMING ---------- */
function GpsStreamingView(widget, ctx) {
    const pin = getWidgetPinAddress(widget);
    const supported = 'geolocation' in navigator;
    const statusEl = el('div', { class: 'w-gps-status' }, supported ? 'Chưa bật' : 'Trình duyệt/thiết bị không hỗ trợ định vị');
    const coordEl = el('div', { class: 'w-gps-coord' }, '--');
    const btn = el('button', { class: 'btn btn-sm' + (supported ? '' : ' btn-disabled') }, 'Bắt đầu gửi vị trí');
    if (!supported) btn.setAttribute('disabled', 'true');
    let watchId = null;

    function formatGps(pos) {
        const { latitude, longitude, altitude } = pos.coords;
        return `${latitude.toFixed(6)},${longitude.toFixed(6)},${altitude !== null && altitude !== undefined ? altitude.toFixed(1) : 0}`;
    }
    function onPos(pos) {
        coordEl.textContent = `${pos.coords.latitude.toFixed(6)}, ${pos.coords.longitude.toFixed(6)}`;
        if (pin !== -1) ctx.sendWrite(widget.deviceId, pin, formatGps(pos));
    }
    function onErr(err) {
        statusEl.textContent = 'Lỗi định vị: ' + ((err && err.message) || 'không rõ nguyên nhân');
        stop();
    }
    function start() {
        if (!supported || watchId !== null) return;
        watchId = navigator.geolocation.watchPosition(onPos, onErr, { enableHighAccuracy: true, maximumAge: widget.interval || 10000 });
        statusEl.textContent = 'Đang gửi vị trí...';
        btn.textContent = 'Dừng gửi vị trí';
    }
    function stop() {
        if (watchId !== null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
        btn.textContent = 'Bắt đầu gửi vị trí';
        if (supported) statusEl.textContent = 'Chưa bật';
    }
    btn.addEventListener('click', () => { if (watchId !== null) stop(); else start(); });

    return {
        el: el('div', { class: 'w-gps' }, [statusEl, coordEl, btn]),
        label: widget.label || 'GPS',
        onPinUpdate() {},
    };
}

/* ---------- GPS_TRIGGER ---------- */
function GpsTriggerView(widget) {
    const dir = widget.triggerOnEnter ? 'vào' : 'ra khỏi';
    const body = el('div', { class: 'w-eventor' }, [
        el('div', { class: 'w-eventor-count' }, `Khi ${dir} bán kính ${widget.triggerRadius || 0}m`),
        el('div', { class: 'w-eventor-rules' }, [
            el('div', { class: 'w-eventor-rule' }, `Toạ độ: ${widget.triggerLat}, ${widget.triggerLon}`),
        ]),
        el('div', { class: 'w-eventor-note' }, 'Chạy phía server, không cần mở trang này'),
    ]);
    return { el: body, label: widget.label || 'GPS Trigger', onPinUpdate() {} };
}

/* ---------- ACCELEROMETER / GRAVITY  ---------- */
function MotionSensorView(widget, ctx, mode) {
    const pins = widget.pins || [];
    const singlePin = getWidgetPinAddress(widget);
    const px = pins[0] ? getWidgetPinAddress(pins[0]) : singlePin;
    const py = pins[1] ? getWidgetPinAddress(pins[1]) : -1;
    const pz = pins[2] ? getWidgetPinAddress(pins[2]) : -1;
    const throttleMs = Number(widget.frequency) > 0 ? Number(widget.frequency) : 300;

    const supported = typeof DeviceMotionEvent !== 'undefined' && window.isSecureContext !== false;
    const statusEl = el('div', { class: 'w-gps-status' }, supported ? 'Chưa bật' : 'Thiết bị/trình duyệt không hỗ trợ cảm biến chuyển động (cần HTTPS)');
    const valEl = el('div', { class: 'w-gps-coord' }, 'x: -- y: -- z: --');
    const btn = el('button', { class: 'btn btn-sm' + (supported ? '' : ' btn-disabled') }, 'Bật cảm biến');
    if (!supported) btn.setAttribute('disabled', 'true');
    let active = false, lastSent = 0;

    function handleMotion(e) {
        const v = mode === 'gravity' ? e.accelerationIncludingGravity : e.acceleration;
        if (!v || v.x === null) return;
        const x = v.x || 0, y = v.y || 0, z = v.z || 0;
        valEl.textContent = `x: ${x.toFixed(2)}  y: ${y.toFixed(2)}  z: ${z.toFixed(2)}`;
        const now = Date.now();
        if (now - lastSent < throttleMs) return;
        lastSent = now;
        if (px !== -1) ctx.sendWrite(widget.deviceId, px, x.toFixed(3));
        if (py !== -1) ctx.sendWrite(widget.deviceId, py, y.toFixed(3));
        if (pz !== -1) ctx.sendWrite(widget.deviceId, pz, z.toFixed(3));
    }
    function grant() {
        window.addEventListener('devicemotion', handleMotion);
        active = true;
        statusEl.textContent = 'Đang đọc cảm biến...';
        btn.textContent = 'Tắt cảm biến';
    }
    function start() {
        if (!supported || active) return;
        if (typeof DeviceMotionEvent.requestPermission === 'function') {
            DeviceMotionEvent.requestPermission()
                .then(res => { if (res === 'granted') grant(); else statusEl.textContent = 'Bị từ chối quyền truy cập cảm biến'; })
                .catch(() => { statusEl.textContent = 'Không xin được quyền truy cập cảm biến'; });
        } else {
            grant();
        }
    }
    function stop() {
        window.removeEventListener('devicemotion', handleMotion);
        active = false;
        btn.textContent = 'Bật cảm biến';
        if (supported) statusEl.textContent = 'Chưa bật';
    }
    btn.addEventListener('click', () => { if (active) stop(); else start(); });

    return {
        el: el('div', { class: 'w-gps' }, [statusEl, valEl, btn]),
        label: widget.label || (mode === 'gravity' ? 'Gravity' : 'Accelerometer'),
        onPinUpdate() {},
    };
}

/* ---------- EMPTY (EMAIL / NOTIFICATION / TWITTER / BRIDGE) ---------- */
function EmptyView(widget) {
    return { el: el('div', { style: { flex: '1' } }), label: null, onPinUpdate() {} };
}

/* ---------- ENHANCED_GRAPH ---------- */
function EnhancedGraphView(widget, ctx) {
    const WEEKDAY_VN = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
    const NUM_WORDS = {
        N: 1, ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5, SIX: 6, SEVEN: 7, EIGHT: 8, NINE: 9, TEN: 10,
        ELEVEN: 11, TWELVE: 12, FIFTEEN: 15, TWENTY: 20, THIRTY: 30, FORTY: 40, SIXTY: 60,
    };
    const UNIT_SECONDS = {
        SECOND: 1, SECONDS: 1, MINUTE: 60, MINUTES: 60, HOUR: 3600, HOURS: 3600,
        DAY: 86400, DAYS: 86400, WEEK: 604800, WEEKS: 604800,
        MONTH: 2592000, MONTHS: 2592000, YEAR: 31536000, YEARS: 31536000,
    };
    const UNIT_LABEL = {
        SECOND: 'gy', SECONDS: 'gy', MINUTE: 'min', MINUTES: 'min', HOUR: 'h', HOURS: 'h',
        DAY: 'd', DAYS: 'd', WEEK: 'wk', WEEKS: 'wk', MONTH: 'Mo', MONTHS: 'Mo', YEAR: 'Yr', YEARS: 'Yr',
    };
    function parsePeriodKey(key) {
        if (key === 'LIVE') return { label: 'Live', sec: 5 * 60 };
        if (key === 'ALL') return { label: 'Tất cả', sec: 0 };
        const tokens = String(key).split('_');
        let mult = null, unit = null;
        tokens.forEach(tok => {
            if (NUM_WORDS[tok] !== undefined) mult = NUM_WORDS[tok];
            else if (UNIT_SECONDS[tok] !== undefined) unit = tok;
        });
        if (!unit) return null;
        if (mult === null) mult = 1;
        return { label: mult + UNIT_LABEL[unit], sec: mult * UNIT_SECONDS[unit] };
    }
    const DEFAULT_RANGES = [
        { label: '1h', sec: 3600 }, { label: '6h', sec: 6 * 3600 }, { label: '12h', sec: 12 * 3600 },
        { label: '1d', sec: 24 * 3600 }, { label: '3d', sec: 3 * 24 * 3600 }, { label: 'Tất cả', sec: 0 },
    ];
    let RANGES = Array.isArray(widget.selectedPeriods) && widget.selectedPeriods.length
        ? widget.selectedPeriods.map(parsePeriodKey).filter(Boolean)
        : [];
    if (!RANGES.length) RANGES = DEFAULT_RANGES;
    const defaultPeriod = widget.period ? parsePeriodKey(widget.period) : null;
    let rangeSec = defaultPeriod ? defaultPeriod.sec : RANGES[Math.min(1, RANGES.length - 1)].sec;
    let viewWindow = null;

    const rangeBtns = [];
    const rangeRow = el('div', { class: 'w-graph-ranges' }, RANGES.map(r => {
        const b = el('div', { class: 'w-range-chip' + (r.sec === rangeSec ? ' active' : '') }, r.label);
        b.addEventListener('click', () => {
            rangeSec = r.sec;
            viewWindow = null;
            rangeBtns.forEach(x => x.el.classList.toggle('active', x.sec === rangeSec));
            draw();
        });
        rangeBtns.push({ el: b, sec: r.sec });
        return b;
    }));

    const legend = el('div', { class: 'w-graph-legend' });
    const canvasWrap = el('div', { class: 'w-graph-canvas-wrap' });
    const canvas = el('canvas');
    canvasWrap.appendChild(canvas);
    const loading = el('div', { class: 'w-graph-loading' }, 'Đang tải lịch sử...');
    canvasWrap.appendChild(loading);

    const streams = widget.dataStreams || [];
    const seriesData = streams.map(() => []);
    const disabled = new Set();
    const seriesColors = streams.map(ds => decodeBlynkColor(ds.color, true)[0]);

    streams.forEach((ds, idx) => {
        const sw = el('span', {}, [
            el('span', { class: 'sw', style: { background: seriesColors[idx] } }),
            document.createTextNode(ds.title || ('Pin ' + idx)),
        ]);
        sw.style.cursor = 'pointer';
        sw.addEventListener('click', () => {
            if (disabled.has(idx)) disabled.delete(idx); else disabled.add(idx);
            sw.style.opacity = disabled.has(idx) ? '0.35' : '1';
            draw();
        });
        legend.appendChild(sw);
    });

    let box = { w: 260, h: 120 };
    let hoverPx = null;
    let lastLayout = null;
    let fullExtent = { min: -Infinity, max: Infinity };

    function clampWindow(tMin, tMax) {
        const fullSpan = (fullExtent.max - fullExtent.min) || 1;
        const MIN_SPAN_MS = 5000;
        let span = Math.max(MIN_SPAN_MS, Math.min(tMax - tMin, fullSpan));
        let min = tMin, max = tMin + span;
        if (min < fullExtent.min) { min = fullExtent.min; max = min + span; }
        if (max > fullExtent.max) { max = fullExtent.max; min = max - span; }
        return { tMin: min, tMax: max };
    }

    function draw() {
        const dpr = window.devicePixelRatio || 1;
        const w = Math.max(20, box.w), h = Math.max(20, box.h);
        canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
        canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
        const c = canvas.getContext('2d');
        c.setTransform(dpr, 0, 0, dpr, 0, 0);
        c.clearRect(0, 0, w, h);
        lastLayout = null;

        const activeIdx = streams.map((_, i) => i).filter(i => !disabled.has(i));

        let fullMin = Infinity, fullMax = -Infinity;
        activeIdx.forEach(idx => {
            const pts = seriesData[idx];
            if (pts.length) { fullMin = Math.min(fullMin, pts[0][0]); fullMax = Math.max(fullMax, pts[pts.length - 1][0]); }
        });
        const hasAnyData = isFinite(fullMin);
        if (!hasAnyData) { fullMin = Date.now() - 3600 * 1000; fullMax = Date.now(); }
        fullExtent = { min: fullMin, max: fullMax };

        let tMin, tMax;
        if (viewWindow) {
            tMin = viewWindow.tMin; tMax = viewWindow.tMax;
        } else {
            tMax = fullMax;
            tMin = rangeSec ? (tMax - rangeSec * 1000) : fullMin;
        }
        if (tMax <= tMin) tMax = tMin + 1;
        const tSpan = tMax - tMin;

        const perSeries = activeIdx.map(idx => {
            const pts = seriesData[idx].filter(p => p[0] >= tMin && p[0] <= tMax);
            if (!pts.length) return null;
            let vMin = Math.min(...pts.map(p => p[1]));
            let vMax = Math.max(...pts.map(p => p[1]));
            if (vMin === vMax) { vMin -= 1; vMax += 1; }
            return { idx, pts, vMin, vMax };
        }).filter(Boolean);

        const twoLineTicks = tSpan > 20 * 3600 * 1000 && tSpan <= 45 * 24 * 3600 * 1000;
        const dateOnlyTicks = tSpan > 45 * 24 * 3600 * 1000;
        const padL = 12 + Math.max(1, activeIdx.length) * 22, padR = 6, padT = 8, padB = twoLineTicks ? 26 : 16;

        function X(t) { return padL + ((t - tMin) / tSpan) * (w - padL - padR); }
        function Yfor(s) { const vSpan = (s.vMax - s.vMin) || 1; return v => h - padB - ((v - s.vMin) / vSpan) * (h - padT - padB); }

        const plotW = w - padL - padR;
        const tickCount = Math.max(2, Math.min(8, Math.round(plotW / 85)));
        c.strokeStyle = '#1c252e';
        c.lineWidth = 1;
        c.font = '9px sans-serif';
        c.textAlign = 'center';
        let prevTickDate = null;
        for (let i = 0; i < tickCount; i++) {
            const t = tMin + (tSpan * i) / (tickCount - 1 || 1);
            const x = X(t);
            c.strokeStyle = '#1c252e';
            c.beginPath(); c.moveTo(x, padT); c.lineTo(x, h - padB); c.stroke();
            const d = new Date(t);
            c.fillStyle = '#71828e';
            if (dateOnlyTicks) {
                c.fillText(String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0'), x, h - padB + 11);
                continue;
            }
            let hh = d.getHours() % 12; if (hh === 0) hh = 12;
            const hourLabel = String(hh).padStart(2, '0') + ' ' + (d.getHours() < 12 ? 'AM' : 'PM');
            const dayChanged = twoLineTicks && (prevTickDate === null || d.getDate() !== prevTickDate);
            prevTickDate = d.getDate();
            if (dayChanged) {
                c.fillText(WEEKDAY_VN[d.getDay()] + ' ' + d.getDate(), x, h - padB + 10);
                c.fillText(hourLabel, x, h - padB + 21);
            } else if (twoLineTicks) {
                c.fillText(hourLabel, x, h - padB + 21);
            } else {
                c.fillText(hourLabel, x, h - padB + 11);
            }
        }
        c.strokeStyle = '#2c3844';
        c.lineWidth = 1;
        c.beginPath(); c.moveTo(padL, padT); c.lineTo(padL, h - padB); c.lineTo(w - padR, h - padB); c.stroke();

        perSeries.forEach((s, col) => {
            const color = seriesColors[s.idx];
            const colX = padL - 6 - col * 22;
            c.fillStyle = color;
            c.font = '8px sans-serif';
            c.textAlign = 'right';
            c.fillText(formatAxisNum(s.vMax), colX, padT + 8);
            c.fillText(formatAxisNum(s.vMin), colX, h - padB);
        });

        perSeries.forEach(s => {
            const ds = streams[s.idx];
            const color = seriesColors[s.idx];
            const Y = Yfor(s);
            const type = ds.graphType;

            if (type === 'BAR') {
                c.fillStyle = color;
                const bw = Math.max(2, ((w - padL - padR) / s.pts.length) * 0.6);
                s.pts.forEach(p => { c.fillRect(X(p[0]) - bw / 2, Y(p[1]), bw, (h - padB) - Y(p[1])); });
                return;
            }
            c.beginPath();
            s.pts.forEach((p, i) => { const x = X(p[0]), y = Y(p[1]); if (i === 0) c.moveTo(x, y); else c.lineTo(x, y); });
            if (type === 'FILLED_LINE') {
                c.lineTo(X(s.pts[s.pts.length - 1][0]), h - padB);
                c.lineTo(X(s.pts[0][0]), h - padB);
                c.closePath();
                c.fillStyle = color + '33';
                c.fill();
                c.beginPath();
                s.pts.forEach((p, i) => { const x = X(p[0]), y = Y(p[1]); if (i === 0) c.moveTo(x, y); else c.lineTo(x, y); });
            }
            c.strokeStyle = color;
            c.lineWidth = 1.5;
            c.stroke();
        });

        if (!perSeries.length) {
            c.fillStyle = '#71828e';
            c.font = '11px sans-serif';
            c.textAlign = 'center';
            c.fillText(hasAnyData ? 'Không có dữ liệu trong khoảng đang xem' : 'Chưa có dữ liệu', w / 2, (padT + h - padB) / 2);
        }

        lastLayout = { w, h, padL, padR, padT, padB, tMin, tMax, tSpan, perSeries, X, YforList: perSeries.map(s => ({ idx: s.idx, Y: Yfor(s) })) };

        if (hoverPx !== null && lastLayout && perSeries.length) {
            const { padL: pL, padT: pT, padB: pB } = lastLayout;
            const hx = Math.min(Math.max(hoverPx, pL), w - padR);
            c.strokeStyle = '#a9b7c3';
            c.lineWidth = 1;
            c.beginPath(); c.moveTo(hx, pT); c.lineTo(hx, h - pB); c.stroke();

            const hoverT = tMin + ((hx - pL) / (w - pL - padR || 1)) * tSpan;
            let nearestT = null;
            perSeries.forEach(s => {
                // điểm gần nhất theo thời gian trong chuỗi này
                let best = s.pts[0], bestDiff = Math.abs(s.pts[0][0] - hoverT);
                for (let i = 1; i < s.pts.length; i++) {
                    const diff = Math.abs(s.pts[i][0] - hoverT);
                    if (diff < bestDiff) { best = s.pts[i]; bestDiff = diff; }
                }
                if (nearestT === null || bestDiff < Math.abs(nearestT - hoverT)) nearestT = best[0];
                const Y = Yfor(s);
                const px = X(best[0]), py = Y(best[1]);
                const color = seriesColors[s.idx];

                c.fillStyle = color;
                c.beginPath(); c.arc(px, py, 2.5, 0, Math.PI * 2); c.fill();

                const label = formatAxisNum(best[1]);
                c.font = 'bold 10px sans-serif';
                const tw = c.measureText(label).width;
                const bx = Math.min(Math.max(hx, pL + tw / 2 + 4), w - padR - tw / 2 - 4);
                const by = Math.min(Math.max(py, pT + 9), h - pB - 3);
                c.fillStyle = 'rgba(16,22,28,0.85)';
                c.fillRect(bx - tw / 2 - 3, by - 9, tw + 6, 12);
                c.fillStyle = color;
                c.textAlign = 'center';
                c.fillText(label, bx, by);
            });

            if (nearestT !== null) {
                const dt = new Date(nearestT);
                const stamp = dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' +
                    String(dt.getDate()).padStart(2, '0') + ' ' + String(dt.getHours()).padStart(2, '0') + ':' +
                    String(dt.getMinutes()).padStart(2, '0') + ':' + String(dt.getSeconds()).padStart(2, '0');
                c.font = '10px sans-serif';
                const sw2 = c.measureText(stamp).width;
                const sx = Math.min(Math.max(hx, padL + sw2 / 2 + 4), w - padR - sw2 / 2 - 4);
                const sy = h - pB + (twoLineTicks ? 21 : 11);
                c.fillStyle = 'rgba(16,22,28,0.92)';
                c.fillRect(sx - sw2 / 2 - 4, sy - 10, sw2 + 8, 14);
                c.fillStyle = '#eef3f7';
                c.textAlign = 'center';
                c.fillText(stamp, sx, sy);
            }
        }
    }
    function formatAxisNum(n) { return Math.abs(n) >= 1000 ? (n / 1000).toFixed(1) + 'k' : (Math.round(n * 100) / 100).toString(); }

    function pointerPos(evt) {
        const rect = canvas.getBoundingClientRect();
        const logicalW = (lastLayout ? lastLayout.w : box.w) || rect.width || 1;
        const scaleX = rect.width ? (logicalW / rect.width) : 1;
        return (evt.clientX - rect.left) * scaleX;
    }

    canvas.addEventListener('wheel', evt => {
        evt.preventDefault();
        if (!lastLayout) return;
        const { padL, padR, w, tMin, tMax } = lastLayout;
        const plotW = (w - padL - padR) || 1;
        const px = pointerPos(evt);
        const ratio = Math.min(Math.max((px - padL) / plotW, 0), 1);
        const tAtCursor = tMin + ratio * (tMax - tMin);
        const factor = evt.deltaY > 0 ? 1.25 : 1 / 1.25;
        const newSpan = (tMax - tMin) * factor;
        const newMin = tAtCursor - ratio * newSpan;
        viewWindow = clampWindow(newMin, newMin + newSpan);
        rangeBtns.forEach(x => x.el.classList.remove('active'));
        draw();
    }, { passive: false });

    let dragState = null;
    canvas.addEventListener('pointerdown', evt => {
        try { canvas.setPointerCapture(evt.pointerId); } catch (e) { /* ignore */ }
        const px = pointerPos(evt);
        dragState = {
            startPx: px,
            winTMin: lastLayout ? lastLayout.tMin : fullExtent.min,
            winTMax: lastLayout ? lastLayout.tMax : fullExtent.max,
            moved: false,
        };
        hoverPx = px;
        draw();
    });
    canvas.addEventListener('pointermove', evt => {
        const px = pointerPos(evt);
        hoverPx = px;
        if (dragState && lastLayout) {
            const dx = px - dragState.startPx;
            if (Math.abs(dx) > 2) dragState.moved = true;
            if (dragState.moved) {
                const plotW = (lastLayout.w - lastLayout.padL - lastLayout.padR) || 1;
                const span = dragState.winTMax - dragState.winTMin;
                const dt = -(dx / plotW) * span;
                viewWindow = clampWindow(dragState.winTMin + dt, dragState.winTMax + dt);
                rangeBtns.forEach(x => x.el.classList.remove('active'));
            }
        }
        draw();
    });
    canvas.addEventListener('pointerup', evt => {
        dragState = null;
        if (evt.pointerType === 'touch') hoverPx = null;
        draw();
    });
    canvas.addEventListener('pointerleave', () => { hoverPx = null; dragState = null; draw(); });
    canvas.addEventListener('dblclick', () => {
        viewWindow = null;
        rangeBtns.forEach(x => x.el.classList.toggle('active', x.sec === rangeSec));
        draw();
    });

    let loadingHistory = false;
    async function loadHistory() {
        if (loadingHistory) return;
        loadingHistory = true;
        try {
            for (let i = 0; i < streams.length; i++) {
                const ds = streams[i];
                const deviceId = ds.targetId !== undefined ? ds.targetId : widget.deviceId;
                const pinId = ds.pin ? ds.pin.pinId : undefined;
                if (pinId === undefined || pinId === -1) continue;
                const pinAddr = getWidgetPinAddress(ds.pin);
                if (pinAddr === -1) continue;
                const points = await ctx.getHistory(deviceId, pinAddr);
                if (points === null) continue;
                if (!points.length && seriesData[i].length) continue;
                if (!seriesData[i].length) { seriesData[i] = points; continue; }
                const byTime = new Map(seriesData[i].map(p => [p[0], p]));
                points.forEach(p => byTime.set(p[0], p));
                seriesData[i] = Array.from(byTime.values()).sort((a, b) => a[0] - b[0]);
                if (seriesData[i].length > 5000) seriesData[i] = seriesData[i].slice(-5000);
            }
        } finally {
            loadingHistory = false;
        }
        loading.remove();
        draw();
    }
    loadHistory();

    const REFRESH_MS = 30000;
    const refreshTimer = setInterval(() => {
        if (!canvas.isConnected) { clearInterval(refreshTimer); return; }
        loadHistory();
    }, REFRESH_MS);
    document.addEventListener('visibilitychange', function onVis() {
        if (!canvas.isConnected) { document.removeEventListener('visibilitychange', onVis); return; }
        if (document.visibilityState === 'visible') loadHistory();
    });

    return {
        el: el('div', { class: 'w-graph' }, [
            el('div', { class: 'w-graph-toolbar' }, [legend, rangeRow]),
            canvasWrap,
        ]),
        label: widget.label,
        resizeEl: canvasWrap,
        onResize(w, h) { box = { w, h }; draw(); },
        onPinUpdate(pinId, value) {
            streams.forEach((ds, idx) => {
                if (!ds.pin || ds.pin.pinId !== pinId) return;
                seriesData[idx].push([Date.now(), Number(value)]);
                if (seriesData[idx].length > 500) seriesData[idx].shift();
            });
            draw();
        },
    };
}

/* ---------- UNKNOWN ---------- */
function UnknownView(widget) {
    return {
        el: el('div', { class: 'unknown-widget' }, `Loại Widget "${escapeHtml(widget.type)}" chưa được hỗ trợ`),
        label: widget.label || widget.type,
        onPinUpdate() {},
    };
}

const WIDGET_FACTORY = {
    BUTTON: (w, c) => ButtonView(w, c),
    STYLED_BUTTON: (w, c) => ButtonView(w, c),
    SLIDER: (w, c) => SliderView(w, c, false),
    VERTICAL_SLIDER: (w, c) => SliderView(w, c, true),
    RGB: RgbView,
    TWO_AXIS_JOYSTICK: TwoAxisJoystickView,
    ENHANCED_GRAPH: EnhancedGraphView,
    DIGIT4_DISPLAY: NumericalDisplayView,
    LABELED_VALUE_DISPLAY: NumericalDisplayView,
    GAUGE: GaugeView,
    LCD: LcdDisplayView,
    LEVEL_DISPLAY: (w, c) => LevelView(w, c),
    VERTICAL_LEVEL_DISPLAY: (w, c) => LevelView(w, c),
    TERMINAL: TerminalView,
    STEP: StepView,
    VERTICAL_STEP: StepView,
    LED: LedView,
    TABS: TabsView,
    DEVICE_SELECTOR: DeviceSelectorView,
    TIMER: TimerView,
    TABLE: TableView,
    EMAIL: EmptyView,
    NOTIFICATION: EmptyView,
    TWITTER: EmptyView,
    BRIDGE: EmptyView,
    RTC: RtcView,
    EVENTOR: EventorView,
    GPS_STREAMING: GpsStreamingView,
    GPS_TRIGGER: GpsTriggerView,
    ACCELEROMETER: (widget, ctx) => MotionSensorView(widget, ctx, 'accel'),
    GRAVITY: (widget, ctx) => MotionSensorView(widget, ctx, 'gravity'),
    LIGHT: NumericalDisplayView,
    PROXIMITY: NumericalDisplayView,
    BAROMETER: NumericalDisplayView,
    MAP: MapView,
    IMAGE: ImageView,
    TEXT_INPUT: TextInputView,
    NUMBER_INPUT: TextInputView,
    SEGMENTED_CONTROL: SegmentedControlView,
    MENU: MenuView,
    TIME_INPUT: TimeInputView,
};

window.__blynkWidgets = { WIDGET_FACTORY, UnknownView, widgetLabel };

})();
