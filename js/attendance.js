/**
 * attendance.js - Student attendance
 *  Attendance = calculations + saving (also used by the dashboard, profile and reports)
 *  Pages.attendance = Mark / History / Statistics tabs
 *
 * One record is stored per class per day:
 *   { date: '2026-10-05', classId: 3, records: { '1': 'Present', '2': 'Late', ... } }
 */
const Attendance = {
    STATUSES: ['Present', 'Absent', 'Late', 'Excused'],

    emptyCounts() { return { Present: 0, Absent: 0, Late: 0, Excused: 0 }; },

    // RULE: Present and Late count as attended. Excused days are left out of the calculation.
    percent(c) {
        const base = c.Present + c.Absent + c.Late;
        return base ? ((c.Present + c.Late) / base) * 100 : null;
    },

    record(date, classId) { return DB.all('attendance').find(a => a.date === date && String(a.classId) === String(classId)) || null; },

    counts(record) {
        const c = this.emptyCounts();
        Object.values(record.records).forEach(s => { if (c[s] !== undefined) c[s]++; });
        return c;
    },

    save(date, classId, records) {
        const existing = this.record(date, classId);
        const payload = { date, classId, records, markedBy: (Session.user() || {}).name || '' };
        return existing ? DB.update('attendance', existing.id, payload) : DB.insert('attendance', payload);
    },

    studentHistory(studentId, { from = '', to = '' } = {}) {
        return DB.all('attendance')
            .filter(a => a.records[studentId] && (!from || a.date >= from) && (!to || a.date <= to))
            .map(a => ({ date: a.date, status: a.records[studentId], classId: a.classId }))
            .sort((a, b) => b.date.localeCompare(a.date));
    },

    studentStats(studentId, range) {
        const history = this.studentHistory(studentId, range);
        const counts = this.emptyCounts();
        history.forEach(h => { counts[h.status]++; });
        return { counts, pct: this.percent(counts), days: history.length, history };
    },

    // Overall numbers for today (or the latest day that has data - e.g. on weekends)
    todaySummary() {
        const all = DB.all('attendance');
        const today = D.today();
        let date = today;
        if (!all.some(a => a.date === today)) date = all.map(a => a.date).sort().pop() || today;
        const recs = all.filter(a => a.date === date);
        const counts = this.emptyCounts();
        recs.forEach(r => { const c = this.counts(r); Object.keys(c).forEach(k => { counts[k] += c[k]; }); });
        return { date, isToday: date === today, counts, pct: this.percent(counts), classesMarked: recs.length, totalClasses: DB.all('classes').length };
    },

    months() { return [...new Set(DB.all('attendance').map(a => a.date.slice(0, 7)))].sort().reverse(); },
    classStudents(classId) { return DB.all('students').filter(s => s.classId === Number(classId) && s.status === 'Active').sort((a, b) => a.rollNo - b.rollNo); }
};

/* ---------- History table (Crud) ---------- */
function makeAttendanceHistoryCrud() {
    if (Session.isFamily()) {
        const me = Session.student();
        return Crud.create({
            collection: 'attendance', id: 'att-history', title: 'My Attendance History', singular: 'Record', readOnly: true, defaultSort: 'date', defaultDir: 'desc',
            searchKeys: ['date', 'status', 'day'],
            rows: () => (me ? Attendance.studentHistory(me.id).map((h, i) => ({ id: i + 1, ...h, day: D.dayName(h.date), month: h.date.slice(0, 7) })) : []),
            filters: [
                { key: 'month', label: 'Months', options: () => Attendance.months().map(m => ({ value: m, label: D.monthLabel(m) })) },
                { key: 'status', label: 'Statuses', options: () => Attendance.STATUSES }
            ],
            columns: [
                { key: 'date', label: 'Date', render: (r) => D.fmt(r.date), text: (r) => r.date },
                { key: 'day', label: 'Day' },
                { key: 'status', label: 'Status', render: (r) => Badge.html(r.status) }
            ]
        });
    }
    return Crud.create({
        collection: 'attendance', id: 'att-history', title: 'Attendance History', singular: 'Record', plural: 'attendance records', readOnly: true, defaultSort: 'date', defaultDir: 'desc',
        searchKeys: ['date', 'classLabel', 'markedBy'],
        rows: () => DB.all('attendance').map(a => {
            const c = Attendance.counts(a);
            return { ...a, classLabel: Lookup.classLabel(a.classId), present: c.Present, absent: c.Absent, late: c.Late, excused: c.Excused, pct: Attendance.percent(c), month: a.date.slice(0, 7) };
        }),
        filters: [
            { key: 'classId', label: 'Classes', options: () => Lookup.classOptions() },
            { key: 'month', label: 'Months', options: () => Attendance.months().map(m => ({ value: m, label: D.monthLabel(m) })) }
        ],
        columns: [
            { key: 'date', label: 'Date', render: (r) => `${D.fmt(r.date)}<br><small class="text-small">${D.dayName(r.date)}</small>`, text: (r) => r.date },
            { key: 'classLabel', label: 'Class' },
            { key: 'present', label: 'Present' }, { key: 'absent', label: 'Absent' }, { key: 'late', label: 'Late' }, { key: 'excused', label: 'Excused' },
            { key: 'pct', label: 'Attendance %', render: (r) => Fmt.pct(r.pct), text: (r) => Fmt.pct(r.pct), sortValue: (r) => r.pct ?? -1 }
        ],
        actions: [
            { name: 'view', label: 'View', cls: 'btn-outline', run: (row) => AttendanceUI.viewRecord(row.date, row.classId) },
            { name: 'edit', label: 'Edit', cls: 'btn-primary', show: () => Session.isStaff(), run: (row) => AttendanceUI.edit(row.date, row.classId) }
        ]
    });
}

/* ---------- Page ---------- */
const AttendanceUI = {
    showTab: null,

    classSelect(id, selected) {
        return `<select id="${id}" class="input" aria-label="Class">${Lookup.classOptions().map(o => `<option value="${o.value}" ${String(o.value) === String(selected) ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`;
    },

    /* --- Mark / edit --- */
    loadRoster() {
        const classId = Number(document.getElementById('att-class').value);
        const date = document.getElementById('att-date').value;
        const out = document.getElementById('att-roster');
        if (!classId || !date) { out.innerHTML = '<div class="empty-state"><div class="empty-state-title">Choose a class and a date</div></div>'; return; }
        if (date > D.today()) { out.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📅</div><div class="empty-state-title">You cannot mark attendance for a future date</div></div>'; return; }
        const students = Attendance.classStudents(classId);
        if (!students.length) { out.innerHTML = '<div class="empty-state"><div class="empty-state-icon">🎓</div><div class="empty-state-title">No active students in this class</div></div>'; return; }
        const rec = Attendance.record(date, classId);
        const banner = rec
            ? `<div class="notice-banner info">Attendance for this class and date is already saved. You are <strong>editing</strong> it.</div>`
            : `<div class="notice-banner">New attendance sheet for <strong>${esc(Lookup.classLabel(classId))}</strong> on ${esc(D.fmt(date))} (${D.dayName(date)}).${D.isWeekend(date) ? ' <strong>This is a weekend.</strong>' : ''}</div>`;
        const rows = students.map(s => {
            const current = (rec && rec.records[s.id]) || 'Present';
            return `<tr><td>${esc(s.rollNo)}</td><td><span class="person">${Avatar.html(s.name, s.photo, 30)}<strong>${esc(s.name)}</strong></span></td>
                <td><div class="att-options" role="radiogroup" aria-label="Attendance for ${esc(s.name)}">${Attendance.STATUSES.map(st =>
                    `<label class="att-pill att-${st.toLowerCase()}"><input type="radio" name="att_${s.id}" value="${st}" ${st === current ? 'checked' : ''}><span>${st}</span></label>`).join('')}</div></td></tr>`;
        }).join('');
        out.innerHTML = `${banner}
            <div class="control-bar"><button type="button" class="btn btn-outline" id="att-all-present">Mark all present</button><div class="att-live" id="att-live" aria-live="polite"></div></div>
            <div class="table-container"><table><thead><tr><th>Roll</th><th>Student</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div>
            <div class="mt-2"><button type="button" class="btn btn-success" id="att-save">${rec ? 'Update attendance' : 'Save attendance'}</button></div>`;
        const updateLive = () => {
            const c = Attendance.emptyCounts();
            out.querySelectorAll('input[type=radio]:checked').forEach(r => { c[r.value]++; });
            document.getElementById('att-live').innerHTML = Attendance.STATUSES.map(k => `${Badge.html(`${k}: ${c[k]}`, Badge.type(k))}`).join(' ') + ` <span class="text-small">Attendance: ${Fmt.pct(Attendance.percent(c))}</span>`;
        };
        updateLive();
        out.addEventListener('change', updateLive);
        document.getElementById('att-all-present').onclick = () => { out.querySelectorAll('input[value=Present]').forEach(r => { r.checked = true; }); updateLive(); };
        document.getElementById('att-save').onclick = () => {
            const records = {};
            students.forEach(s => { const r = out.querySelector(`input[name="att_${s.id}"]:checked`); records[s.id] = r ? r.value : 'Present'; });
            Attendance.save(date, classId, records);
            UI.toast(`Attendance ${rec ? 'updated' : 'saved'} for ${Lookup.classLabel(classId)}`, 'success');
            this.loadRoster();
            if (Pages.attendance.history) Pages.attendance.history.api.refresh();
        };
    },

    edit(date, classId) { // jump from History to the Mark tab
        document.getElementById('att-date').value = date;
        document.getElementById('att-class').value = classId;
        this.showTab('mark');
        this.loadRoster();
        window.scrollTo(0, 0);
    },

    viewRecord(date, classId) {
        const rec = Attendance.record(date, classId);
        if (!rec) return;
        const rows = Attendance.classStudents(classId).concat(DB.all('students').filter(s => s.classId === Number(classId) && s.status !== 'Active' && rec.records[s.id])).map(s =>
            `<tr><td>${esc(s.rollNo)}</td><td>${esc(s.name)}</td><td>${Badge.html(rec.records[s.id] || 'Not recorded', rec.records[s.id] ? undefined : 'secondary')}</td></tr>`).join('');
        Modal.document(`Attendance - ${Lookup.classLabel(classId)} - ${D.fmt(date)}`, `<table><thead><tr><th>Roll</th><th>Student</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table>`);
    },

    /* --- Statistics --- */
    statsHtml(classId, month) {
        if (Session.isFamily()) return this.familyStats(month);
        const records = DB.all('attendance').filter(a => String(a.classId) === String(classId) && (!month || a.date.startsWith(month))).sort((a, b) => a.date.localeCompare(b.date));
        if (!records.length) return '<div class="empty-state"><div class="empty-state-icon">📊</div><div class="empty-state-title">No attendance recorded for this selection</div></div>';
        const total = Attendance.emptyCounts();
        const per = {};
        Attendance.classStudents(classId).forEach(s => { per[s.id] = { s, c: Attendance.emptyCounts() }; });
        const daily = records.map(r => {
            const c = Attendance.counts(r);
            Object.keys(c).forEach(k => { total[k] += c[k]; });
            Object.entries(r.records).forEach(([sid, st]) => { if (per[sid]) per[sid].c[st]++; });
            return { label: r.date.slice(8), value: Math.round(Attendance.percent(c) ?? 0), date: r.date };
        });
        const pct = Attendance.percent(total);
        const rows = Object.values(per).map(({ s, c }) => { const p = Attendance.percent(c); return `<tr data-name="${esc(s.name.toLowerCase())}"><td>${esc(s.rollNo)}</td><td>${esc(s.name)}</td><td>${c.Present}</td><td>${c.Absent}</td><td>${c.Late}</td><td>${c.Excused}</td><td>${p === null ? '—' : Badge.html(Fmt.pct(p), p >= 90 ? 'success' : p >= 75 ? 'warning' : 'danger')}</td></tr>`; }).join('');
        return `<div class="summary-row">
                <div class="summary-item"><small>Days recorded</small><strong>${records.length}</strong></div>
                <div class="summary-item"><small>Class attendance</small><strong>${Fmt.pct(pct)}</strong></div>
                ${Attendance.STATUSES.map(k => `<div class="summary-item"><small>${k} (total)</small><strong>${total[k]}</strong></div>`).join('')}
            </div>
            <h4 class="mb-1">Daily attendance %</h4>${Charts.bars(daily, { max: 100, format: v => v + '%', height: 170 })}
            <h4 class="mt-3 mb-1">Per-student attendance</h4>
            <div class="control-bar"><div class="search-box"><label class="sr-only" for="att-stat-search">Search student</label><input type="search" id="att-stat-search" class="input w-full" placeholder="Search student..."></div></div>
            <div class="table-container"><table id="att-stat-table"><thead><tr><th>Roll</th><th>Student</th><th>Present</th><th>Absent</th><th>Late</th><th>Excused</th><th>Attendance %</th></tr></thead><tbody>${rows}</tbody></table></div>
            <p class="text-small mt-1">Present + Late count as attended. Excused days are not counted. Under 75% is shown in red.</p>`;
    },

    familyStats(month) {
        const me = Session.student();
        if (!me) return '<div class="empty-state"><div class="empty-state-title">No student linked to this account</div></div>';
        const st = Attendance.studentStats(me.id, month ? { from: month + '-01', to: month + '-31' } : {});
        if (!st.days) return '<div class="empty-state"><div class="empty-state-icon">📊</div><div class="empty-state-title">No attendance recorded for this selection</div></div>';
        return `<div class="dashboard-cols"><div>${Charts.donut(st.pct ?? 0, 'attended')}</div>
            <div class="summary-row">${Attendance.STATUSES.map(k => `<div class="summary-item"><small>${k}</small><strong>${st.counts[k]}</strong></div>`).join('')}<div class="summary-item"><small>School days</small><strong>${st.days}</strong></div></div></div>
            <p class="text-small mt-2">Present + Late count as attended. Excused days are not counted.</p>`;
    }
};

Pages.attendance = {
    title: 'Attendance',
    render() {
        const staff = Session.isStaff();
        const months = Attendance.months();
        const tabs = [...(staff ? [['mark', 'Mark attendance']] : []), ['history', 'History'], ['stats', 'Statistics']];
        const first = tabs[0][0];
        const classId = Session.isFamily() ? null : (DB.all('classes')[0] || {}).id;
        this.history = makeAttendanceHistoryCrud();
        return `<div class="card" id="att-root"><div class="card-body">${Tabs.markup(tabs, first)}
            ${staff ? `<div class="tab-content ${first === 'mark' ? 'active' : ''}" data-panel="mark">
                <div class="control-bar">
                    <label for="att-date">Date</label><input type="date" id="att-date" class="input" value="${D.today()}" max="${D.today()}">
                    <label for="att-class">Class</label>${AttendanceUI.classSelect('att-class', classId)}
                    <button type="button" class="btn btn-primary" id="att-load">Load students</button>
                </div><div id="att-roster"></div></div>` : ''}
            <div class="tab-content ${first === 'history' ? 'active' : ''}" data-panel="history">${this.history.render()}</div>
            <div class="tab-content" data-panel="stats">
                <div class="control-bar">
                    ${Session.isFamily() ? '' : `<label for="att-stat-class">Class</label>${AttendanceUI.classSelect('att-stat-class', classId)}`}
                    <label for="att-stat-month">Month</label>
                    <select id="att-stat-month" class="input"><option value="">All time</option>${months.map((m, i) => `<option value="${m}" ${i === 0 ? 'selected' : ''}>${D.monthLabel(m)}</option>`).join('')}</select>
                </div><div id="att-stats-out"></div></div>
        </div></div>`;
    },
    init() {
        const root = document.getElementById('att-root');
        AttendanceUI.showTab = Tabs.bind(root);
        this.history.init();
        const loadStats = () => {
            const cls = document.getElementById('att-stat-class');
            const out = document.getElementById('att-stats-out');
            out.innerHTML = AttendanceUI.statsHtml(cls ? cls.value : null, document.getElementById('att-stat-month').value);
            const search = document.getElementById('att-stat-search');
            if (search) search.addEventListener('input', () => {
                const q = search.value.trim().toLowerCase();
                document.querySelectorAll('#att-stat-table tbody tr').forEach(tr => { tr.hidden = q && !tr.dataset.name.includes(q); });
            });
        };
        document.querySelectorAll('#att-stat-class, #att-stat-month').forEach(el => el.addEventListener('change', loadStats));
        loadStats();
        if (Session.isStaff()) {
            ['att-date', 'att-class'].forEach(id => document.getElementById(id).addEventListener('change', () => AttendanceUI.loadRoster()));
            document.getElementById('att-load').onclick = () => AttendanceUI.loadRoster();
            AttendanceUI.loadRoster();
        }
        root.querySelectorAll('[data-tab="stats"]').forEach(b => b.addEventListener('click', loadStats));
    }
};

console.log('Attendance module initialized');
