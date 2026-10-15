/**
 * crud.js - A generic "table + form" manager.
 * Describe a table with a small config object and Crud.create(config) gives you:
 * search, filters, sorting, pagination, add/edit/delete dialogs, CSV export and printing.
 *
 * Main config options (see students.js for a full example):
 *   collection, title, singular, plural, columns, fields, searchKeys, filters
 *   rows()        - optional: return the rows to show (e.g. rows with extra computed values)
 *   writeRoles    - roles that may add/edit/delete (default ['admin'])
 *   readOnly      - true = no add/edit/delete at all
 *   actions       - extra row buttons: [{ name, label, show(row), run(row, api) }]
 *   validate(data, oldRecord) -> { field: 'error' }
 *   beforeSave(data, oldRecord) -> record to store
 *   deleteGuard(record) -> text to block deleting, afterDelete(record) -> clean up
 */
const Crud = {
    create(cfg) {
        const uid = 'crud-' + (cfg.id || cfg.collection);
        const perPage = cfg.pageSize || 10;
        const state = { q: '', filters: {}, sort: { key: cfg.defaultSort || '', dir: cfg.defaultDir || 'asc' }, page: 1 };

        const canWrite = () => !cfg.readOnly && (cfg.writeRoles || ['admin']).includes(Auth.getRole());
        const canEditRow = (row) => canWrite() && (!cfg.canEditRow || cfg.canEditRow(row));
        const getColumns = () => (typeof cfg.columns === 'function' ? cfg.columns() : cfg.columns);
        const getActions = () => ((typeof cfg.actions === 'function' ? cfg.actions() : cfg.actions) || []);
        const root = () => document.getElementById(uid + '-root');
        const baseRows = () => (cfg.rows ? cfg.rows() : DB.all(cfg.collection));
        const findRow = (id) => baseRows().find(r => String(r.id) === String(id));
        const cellText = (col, row) => (col.text ? col.text(row) : row[col.key]);

        function visibleRows() {
            let rows = baseRows();
            const q = state.q.trim().toLowerCase();
            if (q) rows = rows.filter(r => (cfg.searchKeys || []).some(k => String(r[k] ?? '').toLowerCase().includes(q)));
            (cfg.filters || []).forEach(f => {
                const v = state.filters[f.key];
                if (v === undefined || v === '') return;
                rows = rows.filter(r => (f.match ? f.match(r, v) : String(r[f.key]) === String(v)));
            });
            if (state.sort.key) {
                const col = getColumns().find(c => c.key === state.sort.key);
                const get = (r) => (col && col.sortValue ? col.sortValue(r) : col ? cellText(col, r) : r[state.sort.key]);
                const dir = state.sort.dir === 'asc' ? 1 : -1;
                rows = [...rows].sort((a, b) => {
                    const x = get(a), y = get(b);
                    if (typeof x === 'number' && typeof y === 'number') return (x - y) * dir;
                    return String(x ?? '').localeCompare(String(y ?? ''), undefined, { numeric: true, sensitivity: 'base' }) * dir;
                });
            }
            return rows;
        }

        /* ---------- HTML ---------- */
        function hasActions() { return canWrite() || cfg.onView || getActions().length > 0; }

        function render() {
            const cols = getColumns();
            const filters = (cfg.filters || []).map(f => {
                const opts = (typeof f.options === 'function' ? f.options() : f.options) || [];
                return `<select class="input" data-filter="${f.key}" aria-label="Filter by ${esc(f.label)}"><option value="">All ${esc(f.label)}</option>${opts.map(o => {
                    const v = typeof o === 'object' ? o.value : o, l = typeof o === 'object' ? o.label : o;
                    return `<option value="${esc(v)}">${esc(l)}</option>`;
                }).join('')}</select>`;
            }).join('');
            const headers = cols.map(c => (c.sortable === false || !c.key)
                ? `<th scope="col">${esc(c.label)}</th>`
                : `<th scope="col" data-th="${c.key}" aria-sort="none"><button type="button" class="th-btn" data-sort="${c.key}">${esc(c.label)}</button></th>`).join('');
            return `
            <section class="card crud-card" id="${uid}-root" aria-label="${esc(cfg.title)}">
                <div class="card-header">
                    <h3 class="card-title">${esc(cfg.title)}</h3>
                    <div class="btn-group">
                        ${(cfg.headerActions || []).filter(a => !a.show || a.show()).map(a => `<button type="button" class="btn ${a.cls || 'btn-outline'}" data-header="${a.name}">${a.label}</button>`).join('')}
                        ${cfg.exportable === false ? '' : '<button type="button" class="btn btn-outline" data-act="csv">Export CSV</button><button type="button" class="btn btn-outline" data-act="print">Print</button>'}
                        ${canWrite() && cfg.fields ? `<button type="button" class="btn btn-primary" data-act="add">+ Add ${esc(cfg.singular)}</button>` : ''}
                    </div>
                </div>
                <div class="card-body">
                    ${cfg.intro ? `<p class="text-small mb-2">${cfg.intro}</p>` : ''}
                    <div data-summary></div>
                    <div class="control-bar">
                        <div class="search-box"><label class="sr-only" for="${uid}-q">Search ${esc(cfg.title)}</label>
                            <input type="search" id="${uid}-q" class="input w-full" placeholder="${esc(cfg.searchPlaceholder || 'Search...')}" data-search></div>
                        ${filters}
                    </div>
                    <div class="table-container"><table>
                        <thead><tr>${headers}${hasActions() ? '<th scope="col">Actions</th>' : ''}</tr></thead>
                        <tbody data-body><tr><td colspan="${cols.length + 1}"><div class="page-loading"><div class="loading-spinner" role="status" aria-label="Loading"></div></div></td></tr></tbody>
                    </table></div>
                    <div class="table-footer"><span class="text-small" data-count></span><div class="pagination" data-pager></div></div>
                </div>
            </section>`;
        }

        function actionsHtml(row) {
            const parts = [];
            if (cfg.onView) parts.push(`<button type="button" class="btn btn-small btn-outline" data-act="view" data-id="${row.id}">View</button>`);
            getActions().filter(a => !a.show || a.show(row)).forEach(a => parts.push(`<button type="button" class="btn btn-small ${a.cls || 'btn-info'}" data-act="custom" data-name="${a.name}" data-id="${row.id}">${a.label}</button>`));
            if (canEditRow(row) && cfg.fields) parts.push(`<button type="button" class="btn btn-small btn-primary" data-act="edit" data-id="${row.id}">Edit</button>`);
            if (canEditRow(row) && cfg.allowDelete !== false) parts.push(`<button type="button" class="btn btn-small btn-danger" data-act="delete" data-id="${row.id}">Delete</button>`);
            return parts.join(' ');
        }

        function rowHtml(row) {
            const cells = getColumns().map(c => `<td data-label="${esc(c.label)}" class="${c.cls || ''}">${c.render ? c.render(row) : esc(row[c.key])}</td>`).join('');
            return `<tr>${cells}${hasActions() ? `<td class="actions-cell">${actionsHtml(row)}</td>` : ''}</tr>`;
        }

        function messageRow(html) { return `<tr><td colspan="${getColumns().length + 1}">${html}</td></tr>`; }

        function refresh() {
            const el = root();
            if (!el) return;
            const body = el.querySelector('[data-body]');
            try {
                const rows = visibleRows();
                const pages = Math.max(1, Math.ceil(rows.length / perPage));
                if (state.page > pages) state.page = pages;
                const slice = rows.slice((state.page - 1) * perPage, state.page * perPage);
                if (!rows.length) {
                    const any = baseRows().length > 0;
                    body.innerHTML = messageRow(`<div class="empty-state"><div class="empty-state-icon" aria-hidden="true">${any ? '🔍' : '📭'}</div>
                        <div class="empty-state-title">${any ? 'No matching records' : `No ${esc(cfg.plural || cfg.singular.toLowerCase() + 's')} yet`}</div>
                        <div class="empty-state-description">${any ? 'Try a different search or clear the filters.' : (canWrite() && cfg.fields ? `Use "Add ${esc(cfg.singular)}" to create the first one.` : 'Nothing to show here yet.')}</div>
                        ${any ? '<button type="button" class="btn btn-outline btn-small" data-act="clear">Clear filters</button>' : ''}</div>`);
                } else {
                    body.innerHTML = slice.map(rowHtml).join('');
                }
                const from = rows.length ? (state.page - 1) * perPage + 1 : 0;
                el.querySelector('[data-count]').textContent = `Showing ${from}-${from + slice.length - (rows.length ? 1 : 0)} of ${rows.length}`;
                Pager.render(el.querySelector('[data-pager]'), { total: rows.length, page: state.page, perPage, onChange: (p) => { state.page = p; refresh(); } });
                el.querySelectorAll('th[data-th]').forEach(th => {
                    th.setAttribute('aria-sort', th.dataset.th === state.sort.key ? (state.sort.dir === 'asc' ? 'ascending' : 'descending') : 'none');
                });
                if (cfg.summary) el.querySelector('[data-summary]').innerHTML = cfg.summary(rows);
            } catch (err) {
                console.error(err);
                body.innerHTML = messageRow(`<div class="empty-state error-state"><div class="empty-state-icon" aria-hidden="true">⚠️</div><div class="empty-state-title">Something went wrong</div>
                    <div class="empty-state-description">${esc(err.message)}</div><button type="button" class="btn btn-outline btn-small" data-act="retry">Try again</button></div>`);
            }
        }

        /* ---------- Actions ---------- */
        function openForm(raw) {
            const fields = typeof cfg.fields === 'function' ? cfg.fields(raw) : cfg.fields;
            const values = raw ? { ...raw } : (cfg.defaults ? cfg.defaults() : {});
            Modal.form({
                title: `${raw ? 'Edit' : 'Add'} ${cfg.singular}`, fields, values, size: cfg.modalSize,
                submitText: raw ? 'Save changes' : `Add ${cfg.singular}`,
                onSubmit: (data, m) => {
                    const errors = cfg.validate ? cfg.validate(data, raw) : null;
                    if (errors && Object.keys(errors).length) { Form.showErrors(m.el.querySelector('form'), errors); return false; }
                    const payload = cfg.beforeSave ? cfg.beforeSave(data, raw) : data;
                    const saved = raw ? DB.update(cfg.collection, raw.id, payload) : DB.insert(cfg.collection, payload);
                    UI.toast(`${cfg.singular} ${raw ? 'updated' : 'added'} successfully`, 'success');
                    refresh();
                    if (cfg.afterSave) cfg.afterSave(saved, raw);
                }
            });
        }

        async function onDelete(id) {
            const raw = DB.find(cfg.collection, id);
            if (!raw) return;
            const blocked = cfg.deleteGuard ? cfg.deleteGuard(raw) : null;
            if (blocked) { UI.toast(blocked, 'error', 4500); return; }
            const name = cfg.label ? ` "${cfg.label(raw)}"` : '';
            const warn = cfg.deleteWarning ? cfg.deleteWarning(raw) : '';
            const ok = await Modal.confirm(`Delete this ${cfg.singular.toLowerCase()}${name}? ${warn} This cannot be undone.`.replace('?  ', '? '));
            if (!ok) return;
            DB.remove(cfg.collection, id);
            if (cfg.afterDelete) cfg.afterDelete(raw);
            UI.toast(`${cfg.singular} deleted`, 'success');
            refresh();
        }

        function exportColumns() { return getColumns().filter(c => c.csv !== false).map(c => ({ label: c.label, text: (r) => cellText(c, r) })); }

        const api = { refresh, rows: visibleRows, state, reset() { state.q = ''; state.filters = {}; state.page = 1; } };

        function onClick(e) {
            const sortBtn = e.target.closest('[data-sort]');
            if (sortBtn) {
                const key = sortBtn.dataset.sort;
                state.sort = { key, dir: state.sort.key === key && state.sort.dir === 'asc' ? 'desc' : 'asc' };
                state.page = 1;
                refresh();
                return;
            }
            const head = e.target.closest('[data-header]');
            if (head) { const a = cfg.headerActions.find(x => x.name === head.dataset.header); if (a) a.run(api); return; }
            const btn = e.target.closest('[data-act]');
            if (!btn) return;
            const id = btn.dataset.id;
            switch (btn.dataset.act) {
                case 'add': openForm(null); break;
                case 'edit': openForm(DB.find(cfg.collection, id)); break;
                case 'delete': onDelete(id); break;
                case 'view': cfg.onView(findRow(id)); break;
                case 'custom': { const a = getActions().find(x => x.name === btn.dataset.name); if (a) a.run(findRow(id), api); break; }
                case 'csv': Table.csv(`${cfg.id || cfg.collection}.csv`, exportColumns(), visibleRows()); break;
                case 'print': Print.open(cfg.title, Table.html(exportColumns(), visibleRows())); break;
                case 'clear': {
                    api.reset();
                    const el = root();
                    el.querySelector('[data-search]').value = '';
                    el.querySelectorAll('[data-filter]').forEach(s => { s.value = ''; });
                    refresh();
                    break;
                }
                case 'retry': refresh(); break;
            }
        }

        function init() {
            const el = root();
            if (!el) return;
            el.addEventListener('click', onClick);
            let timer;
            el.querySelector('[data-search]').addEventListener('input', (e) => {
                clearTimeout(timer);
                timer = setTimeout(() => { state.q = e.target.value; state.page = 1; refresh(); }, 150);
            });
            el.querySelectorAll('[data-filter]').forEach(s => s.addEventListener('change', () => { state.filters[s.dataset.filter] = s.value; state.page = 1; refresh(); }));
            setTimeout(refresh, 80); // short delay so the loading state is visible
            if (cfg.afterInit) cfg.afterInit(api);
        }

        return { render, init, api };
    },

    // Build a page object from one or more Crud tables
    page({ title, nav, make, before = '', after = '' }) {
        return {
            title, nav,
            render() { this.parts = make(); return before + this.parts.map(p => p.render()).join('<div class="section-gap"></div>') + after; },
            init() { this.parts.forEach(p => p.init()); }
        };
    }
};

console.log('Crud module initialized');
