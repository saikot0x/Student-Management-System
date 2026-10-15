/**
 * components.js - Reusable UI building blocks used by every page:
 * esc, Badge, Avatar, Modal, Form, Pager, Table (CSV), Print, Tabs, Charts
 */
const Pages = {}; // every page registers itself: Pages.students = { title, render(), init() }

// Escape text before putting it inside HTML (protects against broken markup / XSS)
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

/* ---------- Badges & avatars ---------- */
const Badge = {
    type(text) {
        const s = String(text).toLowerCase();
        if (['active', 'present', 'paid', 'published', 'returned', 'submitted', 'completed', 'pass', 'a+', 'a', 'open', 'available'].includes(s)) return 'success';
        if (['late', 'partial', 'pending', 'scheduled', 'ongoing', 'issued', 'a-', 'b', 'unpublished'].includes(s)) return 'warning';
        if (['absent', 'unpaid', 'overdue', 'inactive', 'fail', 'f', 'd'].includes(s)) return 'danger';
        return 'secondary';
    },
    html(text, type) { return `<span class="badge badge-${type || Badge.type(text)}">${esc(text)}</span>`; }
};

const Avatar = {
    COLORS: ['#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#0ea5e9', '#ec4899'],
    html(name, photo, size = 36) {
        if (photo) return `<img class="avatar" style="width:${size}px;height:${size}px" src="${esc(photo)}" alt="">`;
        const label = name || '?';
        const color = Avatar.COLORS[[...label].reduce((a, c) => a + c.charCodeAt(0), 0) % Avatar.COLORS.length];
        const initials = label.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
        return `<span class="avatar avatar-initials" style="width:${size}px;height:${size}px;background:${color};font-size:${Math.round(size * 0.38)}px" aria-hidden="true">${esc(initials)}</span>`;
    }
};

/* ---------- Modal ---------- */
const Modal = {
    open({ title, body, footer = '', size = '', onClose }) {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `
            <div class="modal ${size}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
                <div class="modal-header">
                    <h2 class="modal-title">${esc(title)}</h2>
                    <button type="button" class="modal-close" aria-label="Close dialog">&times;</button>
                </div>
                <div class="modal-body">${body}</div>
                ${footer ? `<div class="modal-footer">${footer}</div>` : ''}
            </div>`;
        let closed = false;
        const close = () => { if (closed) return; closed = true; overlay.remove(); if (onClose) onClose(); };
        overlay.querySelector('.modal-close').addEventListener('click', close);
        overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
        document.getElementById('modal-container').appendChild(overlay);
        const first = overlay.querySelector('input:not([type=hidden]):not([readonly]):not([type=file]), select, textarea');
        if (first) first.focus();
        return { el: overlay, close };
    },

    // Yes/No dialog that returns a Promise<boolean>
    confirm(message, { title = 'Please confirm', confirmText = 'Delete', danger = true } = {}) {
        return new Promise((resolve) => {
            const m = Modal.open({
                title, body: `<p class="confirm-message">${esc(message)}</p>`, onClose: () => resolve(false),
                footer: `<button type="button" class="btn btn-outline" data-no>Cancel</button><button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-yes>${esc(confirmText)}</button>`
            });
            m.el.querySelector('[data-no]').onclick = m.close;
            m.el.querySelector('[data-yes]').onclick = () => { resolve(true); m.close(); };
            m.el.querySelector('[data-yes]').focus();
        });
    },

    // Form dialog. onSubmit(data, modal) may return false to keep the dialog open.
    form({ title, fields, values = {}, onSubmit, submitText = 'Save', size = 'modal-lg' }) {
        const body = `<form novalidate><div class="form-grid">${Form.fields(fields, values)}</div>
            <div class="modal-footer form-footer"><button type="button" class="btn btn-outline" data-cancel>Cancel</button><button type="submit" class="btn btn-primary">${esc(submitText)}</button></div></form>`;
        const m = Modal.open({ title, body, size });
        const form = m.el.querySelector('form');
        Form.bind(form);
        form.querySelector('[data-cancel]').onclick = m.close;
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const { data, errors } = Form.read(form, fields);
            Form.showErrors(form, errors);
            if (Object.keys(errors).length) return;
            const result = await onSubmit(data, m);
            if (result !== false) m.close();
        });
        return m;
    },

    // Read-only document (receipt, marksheet, profile) with a Print button
    document(title, html, { printTitle = title, size = 'modal-lg' } = {}) {
        const m = Modal.open({
            title, size, body: `<div class="doc">${Print.header()}${html}</div>`,
            footer: '<button type="button" class="btn btn-outline" data-close>Close</button><button type="button" class="btn btn-primary" data-print>Print</button>'
        });
        m.el.querySelector('[data-close]').onclick = m.close;
        m.el.querySelector('[data-print]').onclick = () => Print.open(printTitle, html);
        return m;
    }
};

/* ---------- Form builder ----------
 * A field is { name, label, type, required, options, ref, full, readonly, min, max, step, placeholder }
 * type: text | number | date | time | email | tel | select | textarea | photo
 * ref: true  -> the select stores a number (an id of another record)
 */
const Form = {
    fields(fields, values) {
        return fields.map(f => {
            const id = 'f_' + f.name;
            const val = values[f.name] ?? f.default ?? '';
            const attrs = `id="${id}" name="${f.name}" ${f.required ? 'required' : ''} ${f.readonly ? 'readonly' : ''} ${f.placeholder ? `placeholder="${esc(f.placeholder)}"` : ''}`;
            let input;
            if (f.type === 'select') {
                const opts = (typeof f.options === 'function' ? f.options(values) : f.options) || [];
                input = `<select ${attrs}>${f.required ? '<option value="">Select...</option>' : '<option value="">-- None --</option>'}${opts.map(o => {
                    const v = typeof o === 'object' ? o.value : o, l = typeof o === 'object' ? o.label : o;
                    return `<option value="${esc(v)}" ${String(v) === String(val) ? 'selected' : ''}>${esc(l)}</option>`;
                }).join('')}</select>`;
            } else if (f.type === 'textarea') {
                input = `<textarea ${attrs} rows="3">${esc(val)}</textarea>`;
            } else if (f.type === 'photo') {
                input = `<div class="photo-field"><img class="photo-preview" data-preview-for="${f.name}" ${val ? `src="${esc(val)}"` : ''} alt="Preview">
                    <div><input type="file" accept="image/*" data-photo-for="${f.name}" data-size="${f.size || 160}" aria-label="${esc(f.label)}"><small class="text-small">Optional. The image is resized and stored in your browser.</small></div>
                    <input type="hidden" id="${id}" name="${f.name}" value="${esc(val)}"></div>`;
            } else {
                input = `<input type="${f.type || 'text'}" ${attrs} value="${esc(val)}" ${f.min !== undefined ? `min="${f.min}"` : ''} ${f.max !== undefined ? `max="${f.max}"` : ''} ${f.step ? `step="${f.step}"` : ''}>`;
            }
            return `<div class="form-group ${f.full ? 'full' : ''}"><label for="${id}">${esc(f.label)}${f.required ? ' <span class="req" aria-hidden="true">*</span>' : ''}</label>${input}<small class="field-error" data-error-for="${f.name}" role="alert"></small></div>`;
        }).join('');
    },

    read(form, fields) {
        const data = {}, errors = {};
        fields.forEach(f => {
            const el = form.elements[f.name];
            let v = el ? String(el.value).trim() : '';
            if (f.type === 'number' && v !== '') v = Number(v);
            if (f.ref && v !== '') v = Number(v);
            data[f.name] = v;
            if (f.required && (v === '' || v === null)) { errors[f.name] = `${f.label} is required`; return; }
            if (v === '') return;
            if (f.type === 'email' && !StringUtils.isValidEmail(v)) errors[f.name] = 'Enter a valid email address';
            if (f.type === 'tel' && !/^[\d\s\-+()]{7,}$/.test(v)) errors[f.name] = 'Enter a valid phone number';
            if (f.type === 'number') {
                if (Number.isNaN(v)) errors[f.name] = 'Enter a valid number';
                else if (f.min !== undefined && v < f.min) errors[f.name] = `${f.label} must be at least ${f.min}`;
                else if (f.max !== undefined && v > f.max) errors[f.name] = `${f.label} must be at most ${f.max}`;
            }
        });
        return { data, errors };
    },

    showErrors(form, errors) {
        form.querySelectorAll('[data-error-for]').forEach(el => { el.textContent = errors[el.dataset.errorFor] || ''; });
        form.querySelectorAll('[name]').forEach(el => el.removeAttribute('aria-invalid'));
        const names = Object.keys(errors);
        names.forEach(n => form.elements[n] && form.elements[n].setAttribute('aria-invalid', 'true'));
        if (names.length && form.elements[names[0]] && form.elements[names[0]].focus) form.elements[names[0]].focus();
    },

    bind(root) { // image upload preview
        root.querySelectorAll('input[type=file][data-photo-for]').forEach(inp => {
            inp.addEventListener('change', () => {
                const file = inp.files[0];
                if (!file) return;
                if (!file.type.startsWith('image/')) { UI.toast('Please choose an image file', 'error'); return; }
                Form.resizeImage(file, Number(inp.dataset.size)).then(url => {
                    root.querySelector(`[name="${inp.dataset.photoFor}"]`).value = url;
                    root.querySelector(`[data-preview-for="${inp.dataset.photoFor}"]`).src = url;
                }).catch(() => UI.toast('Could not read that image', 'error'));
            });
        });
    },

    resizeImage(file, max) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                const img = new Image();
                img.onload = () => {
                    const scale = Math.min(1, max / Math.max(img.width, img.height));
                    const canvas = document.createElement('canvas');
                    canvas.width = Math.round(img.width * scale); canvas.height = Math.round(img.height * scale);
                    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
                    resolve(canvas.toDataURL(file.type === 'image/png' ? 'image/png' : 'image/jpeg', 0.8));
                };
                img.onerror = reject;
                img.src = reader.result;
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }
};

/* ---------- Pagination ---------- */
const Pager = {
    render(el, { total, page, perPage, onChange }) {
        if (!el) return;
        const pages = Math.max(1, Math.ceil(total / perPage));
        const btn = (label, p, { disabled = false, active = false } = {}) =>
            `<button type="button" data-page="${p}" ${disabled ? 'disabled' : ''} class="${active ? 'active' : ''}" ${active ? 'aria-current="page"' : ''}>${label}</button>`;
        let start = Math.max(1, page - 2);
        const end = Math.min(pages, start + 4);
        start = Math.max(1, end - 4);
        let html = btn('&lsaquo; Prev', page - 1, { disabled: page <= 1 });
        for (let p = start; p <= end; p++) html += btn(p, p, { active: p === page });
        html += btn('Next &rsaquo;', page + 1, { disabled: page >= pages });
        el.innerHTML = pages > 1 ? html : '';
        el.onclick = (e) => { const b = e.target.closest('button[data-page]'); if (b && !b.disabled) onChange(Number(b.dataset.page)); };
    }
};

/* ---------- Tables: CSV export & plain HTML ---------- */
const Table = {
    cell(col, row) { return col.text ? col.text(row) : col.value ? col.value(row) : row[col.key]; },
    csv(filename, columns, rows) {
        const safe = (v) => { let t = String(v ?? ''); if (/^[=+\-@]/.test(t)) t = "'" + t; return `"${t.replace(/"/g, '""')}"`; };
        const lines = [columns.map(c => safe(c.label)).join(',')].concat(rows.map(r => columns.map(c => safe(Table.cell(c, r))).join(',')));
        const blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    },
    html(columns, rows) {
        return `<table><thead><tr>${columns.map(c => `<th>${esc(c.label)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${columns.map(c => `<td>${esc(Table.cell(c, r))}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    }
};

/* ---------- Printing ---------- */
const Print = {
    header() {
        const s = Settings.get();
        return `<div class="doc-header">${s.logo ? `<img class="doc-logo" src="${esc(s.logo)}" alt=""><br>` : ''}<h2>${esc(s.schoolName)}</h2><div>${esc(s.schoolAddress)} &bull; ${esc(s.schoolPhone)} &bull; ${esc(s.schoolEmail)}</div></div>`;
    },
    open(title, body) {
        const css = `body{font-family:Arial,sans-serif;color:#111;margin:24px;font-size:13px}h2,h3{margin:0 0 6px}
            .doc-header{text-align:center;border-bottom:2px solid #333;padding-bottom:10px;margin-bottom:16px}.doc-logo{height:50px}
            table{width:100%;border-collapse:collapse;margin:10px 0}th,td{border:1px solid #444;padding:6px 8px;text-align:left}th{background:#eee}
            .doc-meta{display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;margin-bottom:10px}.doc-summary span{display:inline-block;margin:0 18px 6px 0}
            .sign-row{display:flex;justify-content:space-between;margin-top:50px}.sign-row div{border-top:1px solid #333;padding-top:4px;min-width:160px;text-align:center}
            .badge{font-weight:bold}.text-small{color:#555;font-size:11px}@page{margin:14mm}`;
        const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${css}</style></head><body>${Print.header()}<h3>${esc(title)}</h3>${body}<p class="text-small">Printed on ${esc(D.fmt(D.today()))}</p></body></html>`;
        const frame = document.createElement('iframe');
        frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
        document.body.appendChild(frame);
        const doc = frame.contentWindow.document;
        doc.open(); doc.write(html); doc.close();
        setTimeout(() => { frame.contentWindow.focus(); frame.contentWindow.print(); setTimeout(() => frame.remove(), 60000); }, 250);
    }
};

/* ---------- Tabs ---------- */
const Tabs = {
    markup(tabs, active) { // tabs = [[id, label], ...]
        return `<div class="tabs" role="tablist">${tabs.map(([id, label]) => `<button type="button" role="tab" class="tab-button ${id === active ? 'active' : ''}" data-tab="${id}" aria-selected="${id === active}">${esc(label)}</button>`).join('')}</div>`;
    },
    bind(root) {
        const buttons = root.querySelectorAll('[data-tab]');
        const show = (name) => {
            buttons.forEach(b => { const on = b.dataset.tab === name; b.classList.toggle('active', on); b.setAttribute('aria-selected', on); });
            root.querySelectorAll('[data-panel]').forEach(p => p.classList.toggle('active', p.dataset.panel === name));
        };
        buttons.forEach(b => b.addEventListener('click', () => show(b.dataset.tab)));
        return show;
    }
};

/* ---------- Charts (pure HTML/CSS) ---------- */
const Charts = {
    bars(items, { height = 180, format = v => v, max } = {}) {
        const m = max ?? Math.max(1, ...items.map(i => i.value));
        return `<div class="chart-bars" role="img" aria-label="Bar chart" style="height:${height}px">${items.map(i =>
            `<div class="chart-bar" title="${esc(i.label)}: ${esc(format(i.value))}"><span class="chart-bar-value">${esc(format(i.value))}</span><div class="chart-bar-area"><div class="chart-bar-fill" style="height:${Math.max(2, (i.value / m) * 100)}%"></div></div><span class="chart-bar-label">${esc(i.label)}</span></div>`).join('')}</div>`;
    },
    hbars(items, { max, format = v => v } = {}) {
        const m = max ?? Math.max(1, ...items.map(i => i.value));
        return items.map(i => `<div class="hbar-row"><span>${esc(i.label)}</span><div class="hbar-track"><div class="hbar-fill" style="width:${(i.value / m) * 100}%"></div></div><strong>${esc(format(i.value))}</strong></div>`).join('');
    },
    donut(percent, label) {
        const p = Math.max(0, Math.min(100, Number(percent) || 0));
        return `<div class="donut" style="background:conic-gradient(var(--success) 0 ${p}%, var(--danger) ${p}% 100%)" role="img" aria-label="${esc(label)}: ${p.toFixed(0)}%"><div class="donut-hole"><div><div class="donut-value">${p.toFixed(0)}%</div><small>${esc(label)}</small></div></div></div>`;
    }
};

console.log('Components module initialized');
