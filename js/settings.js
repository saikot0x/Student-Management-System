/**
 * settings.js - School name, logo, address, phone, email, session, currency, theme + data tools.
 * Everything is saved in localStorage and used by every page (receipts, reports, navbar ...).
 */
Pages.settings = {
    title: 'Settings',
    fields: [
        { name: 'schoolName', label: 'School name', required: true },
        { name: 'schoolEmail', label: 'Email', type: 'email', required: true },
        { name: 'schoolPhone', label: 'Phone', type: 'tel', required: true },
        { name: 'currency', label: 'Currency symbol', required: true, placeholder: '$' },
        { name: 'academicSession', label: 'Current academic session', type: 'select', required: true, options: () => Lookup.sessionOptions() },
        { name: 'theme', label: 'Theme', type: 'select', required: true, options: [{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }] },
        { name: 'schoolAddress', label: 'Address', type: 'textarea', full: true, required: true },
        { name: 'logo', label: 'School logo', type: 'photo', size: 200, full: true }
    ],

    gradingHtml() {
        const rows = Grading.SCALE.map((g, i) => `<tr><td><input class="input" data-g="grade" value="${esc(g.grade)}" size="4" aria-label="Grade ${i + 1}"></td>
            <td><input class="input" type="number" min="0" max="100" data-g="min" value="${g.min}" aria-label="Minimum percent for ${esc(g.grade)}"></td>
            <td><input class="input" type="number" min="0" max="10" step="0.1" data-g="point" value="${g.point}" aria-label="Grade point for ${esc(g.grade)}"></td></tr>`).join('');
        return `<div class="card"><div class="card-header"><h3 class="card-title">Grading scale</h3></div><div class="card-body">
            <p class="text-small mb-2">Minimum percentage for each grade and the grade point used for GPA. Highest grade first; the last row must start at 0.</p>
            <div class="table-container"><table><thead><tr><th>Grade</th><th>Minimum %</th><th>Grade point</th></tr></thead><tbody>${rows}</tbody></table></div>
            <div class="btn-group mt-2"><button type="button" class="btn btn-primary" id="grading-save">Save grading scale</button><button type="button" class="btn btn-outline" id="grading-reset">Restore default</button></div></div></div>`;
    },

    bindGrading() {
        const redraw = () => { document.getElementById('content').innerHTML = this.render(); this.init(); };
        document.getElementById('grading-save').onclick = () => {
            const rows = [...document.querySelectorAll('.table-container tbody tr')].filter(tr => tr.querySelector('[data-g=grade]'));
            const list = rows.map(tr => ({ grade: tr.querySelector('[data-g=grade]').value.trim(), min: Number(tr.querySelector('[data-g=min]').value), point: Number(tr.querySelector('[data-g=point]').value) }));
            let err = '';
            if (list.some(g => !g.grade || Number.isNaN(g.min) || Number.isNaN(g.point))) err = 'Fill in every grade, percentage and point.';
            else if (new Set(list.map(g => g.grade)).size !== list.length) err = 'Each grade name must be different.';
            else if (list.some((g, i) => i > 0 && g.min >= list[i - 1].min)) err = 'Minimum percentages must go down from top to bottom.';
            else if (list[list.length - 1].min !== 0) err = 'The last grade must start at 0%.';
            if (err) { UI.toast(err, 'error', 4500); return; }
            Grading.SCALE = list;
            Store.set('gradingScale', list);
            UI.toast('Grading scale saved. Results use it immediately.', 'success');
        };
        document.getElementById('grading-reset').onclick = () => { Store.remove('gradingScale'); Grading.SCALE = Grading.DEFAULT_SCALE.map(g => ({ ...g })); UI.toast('Default grading scale restored', 'success'); redraw(); };
    },

    render() {
        if (!Session.isAdmin()) return '<div class="card"><div class="empty-state"><div class="empty-state-title">Only the administrator can change settings.</div></div></div>';
        const values = { ...Settings.get(), theme: Store.get('theme', 'light') };
        return `
        <div class="card"><div class="card-header"><h3 class="card-title">School settings</h3></div><div class="card-body">
            <form id="settings-form" novalidate><div class="form-grid">${Form.fields(this.fields, values)}</div>
            <div class="form-footer"><button type="submit" class="btn btn-primary">Save settings</button></div></form></div></div>
        <div class="section-gap"></div>
        ${this.gradingHtml()}
        <div class="section-gap"></div>
        <div class="card"><div class="card-header"><h3 class="card-title">Data tools</h3></div><div class="card-body">
            <p class="text-small mb-2">All data lives in this browser (localStorage). Make a backup before clearing browser data.</p>
            <div class="btn-group">
                <button type="button" class="btn btn-outline" id="data-export">Download backup (JSON)</button>
                <label class="btn btn-outline" for="data-import">Restore from backup</label><input type="file" id="data-import" accept="application/json" class="sr-only">
                <button type="button" class="btn btn-danger" id="data-reset">Reset to demo data</button>
            </div></div></div>
        <div class="section-gap"></div>
        <div class="notice-banner"><strong>Security note:</strong> this project uses frontend-only demo authentication stored in the browser. It is NOT suitable for production security.</div>`;
    },

    init() {
        const form = document.getElementById('settings-form');
        if (!form) return;
        Form.bind(form);
        this.bindGrading();
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            const { data, errors } = Form.read(form, this.fields);
            Form.showErrors(form, errors);
            if (Object.keys(errors).length) return;
            const { theme, ...rest } = data;
            Settings.save(rest);
            Store.set('theme', theme);
            App.applyTheme();
            App.applyBranding();
            UI.toast('Settings saved', 'success');
        });

        document.getElementById('data-export').onclick = () => {
            const skip = ['currentUser', 'isLoggedIn'];
            const data = {};
            Store.getAllKeys().filter(k => !skip.includes(k)).forEach(k => { data[k] = Store.get(k); });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
            a.download = `sms-backup-${D.today()}.json`;
            document.body.appendChild(a); a.click(); a.remove();
            UI.toast('Backup downloaded', 'success');
        };

        document.getElementById('data-import').addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            try {
                const data = JSON.parse(await file.text());
                if (typeof data !== 'object' || !data.settings || !data.seedVersion) throw new Error('This does not look like a backup of this system.');
                if (!(await Modal.confirm('Replace ALL current data with this backup?', { title: 'Restore backup', confirmText: 'Restore' }))) return;
                Object.entries(data).filter(([k]) => !['currentUser', 'isLoggedIn'].includes(k)).forEach(([k, v]) => Store.set(k, v));
                DB.clearCache();
                Auth.logout(); // accounts may have changed, so sign in again
                UI.toast('Backup restored. Please log in again.', 'success');
                setTimeout(() => location.reload(), 600);
            } catch (err) { UI.toast(`Could not restore: ${err.message}`, 'error', 5000); }
            e.target.value = '';
        });

        document.getElementById('data-reset').onclick = async () => {
            if (!(await Modal.confirm('Delete all current data and restore the demo data? This cannot be undone.', { title: 'Reset data', confirmText: 'Reset everything' }))) return;
            Seed.reset();
            Store.remove('gradingScale');
            Auth.logout(); // the default accounts are back, so sign in again
            UI.toast('Demo data restored. Please log in again.', 'success');
            setTimeout(() => location.reload(), 600);
        };
    }
};

console.log('Settings module initialized');
