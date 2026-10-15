/**
 * reports.js - Five report types with filters, print-friendly output and CSV export.
 * To add a report: add an entry to Reports.defs with filters + build(filters).
 * build() returns { columns: [{label, text(row)}], rows: [...], summary: [[label, value], ...] }
 */
const Reports = {
    current: 'students',
    values: {},

    defs: {
        students: {
            label: 'Students',
            filters: () => [
                { key: 'classId', label: 'Class', options: Lookup.classOptions() },
                { key: 'status', label: 'Status', options: ['Active', 'Inactive', 'Graduated', 'Transferred'] }
            ],
            build(f) {
                const rows = DB.all('students').filter(s => (!f.classId || String(s.classId) === f.classId) && (!f.status || s.status === f.status))
                    .sort((a, b) => a.classId - b.classId || a.rollNo - b.rollNo);
                return {
                    rows, summary: [['Students', rows.length], ['Active', rows.filter(s => s.status === 'Active').length], ['Female', rows.filter(s => s.gender === 'Female').length], ['Male', rows.filter(s => s.gender === 'Male').length]],
                    columns: [
                        { label: 'Student ID', text: s => s.studentId }, { label: 'Name', text: s => s.name }, { label: 'Class', text: s => Lookup.classLabel(s.classId) }, { label: 'Roll', text: s => s.rollNo },
                        { label: 'Reg. No', text: s => s.regNo }, { label: 'Guardian', text: s => s.guardianName }, { label: 'Guardian phone', text: s => s.guardianPhone }, { label: 'Status', text: s => s.status }
                    ]
                };
            }
        },
        attendance: {
            label: 'Attendance',
            filters: () => [
                { key: 'classId', label: 'Class', options: Lookup.classOptions(), required: true },
                { key: 'from', label: 'From', type: 'date' }, { key: 'to', label: 'To', type: 'date' }
            ],
            build(f) {
                const classId = Number(f.classId) || (DB.all('classes')[0] || {}).id;
                const records = DB.all('attendance').filter(a => a.classId === classId && (!f.from || a.date >= f.from) && (!f.to || a.date <= f.to));
                const rows = Attendance.classStudents(classId).map(s => {
                    const c = Attendance.emptyCounts();
                    records.forEach(r => { if (r.records[s.id]) c[r.records[s.id]]++; });
                    return { s, c, pct: Attendance.percent(c) };
                });
                const total = Attendance.emptyCounts();
                rows.forEach(r => Attendance.STATUSES.forEach(k => { total[k] += r.c[k]; }));
                return {
                    rows, summary: [['Class', Lookup.classLabel(classId)], ['Days recorded', records.length], ['Class attendance', Fmt.pct(Attendance.percent(total))]],
                    columns: [{ label: 'Roll', text: r => r.s.rollNo }, { label: 'Student', text: r => r.s.name }, ...Attendance.STATUSES.map(k => ({ label: k, text: r => r.c[k] })), { label: 'Attendance %', text: r => Fmt.pct(r.pct) }]
                };
            }
        },
        results: {
            label: 'Results',
            filters: () => [{ key: 'examId', label: 'Exam', options: Lookup.examOptions(), required: true }, { key: 'classId', label: 'Class', options: Lookup.classOptions(), required: true }],
            build(f) {
                const examId = Number(f.examId) || (DB.all('exams')[0] || {}).id;
                const classId = Number(f.classId) || (DB.all('classes')[0] || {}).id;
                const rows = ResultService.sheet(examId, classId);
                const done = rows.filter(r => r.result.complete);
                const exam = DB.find('exams', examId) || {};
                return {
                    rows, summary: [['Exam', exam.name || '—'], ['Class', Lookup.classLabel(classId)], ['Passed', `${done.filter(r => r.result.passed).length} of ${done.length}`], ['Published', exam.published ? 'Yes' : 'No']],
                    columns: ResultsUI.sheetColumns()
                };
            }
        },
        fees: {
            label: 'Fees',
            filters: () => [
                { key: 'classId', label: 'Class', options: Lookup.classOptions() },
                { key: 'status', label: 'Status', options: ['Paid', 'Partial', 'Unpaid', 'Overdue'] },
                { key: 'feeTypeId', label: 'Fee type', options: Lookup.feeTypeOptions() }
            ],
            build(f) {
                const rows = FeeService.rows().filter(r => (!f.classId || String(r.classId) === f.classId) && (!f.status || r.status === f.status) && (!f.feeTypeId || String(r.feeTypeId) === f.feeTypeId));
                const t = FeeService.totals(rows);
                return {
                    rows, summary: [['Billed', Fmt.money(t.billed)], ['Collected', Fmt.money(t.collected)], ['Outstanding', Fmt.money(t.outstanding)], ['Collection rate', Fmt.pct(t.rate)]],
                    columns: [
                        { label: 'Student', text: r => r.studentName }, { label: 'Class', text: r => r.classLabel }, { label: 'Fee', text: r => `${r.feeTypeName} (${r.period})` },
                        { label: 'Amount', text: r => Fmt.money(r.amount) }, { label: 'Discount', text: r => Fmt.money(r.discount) }, { label: 'Paid', text: r => Fmt.money(r.paid) },
                        { label: 'Due', text: r => Fmt.money(r.due) }, { label: 'Due date', text: r => D.fmt(r.dueDate) }, { label: 'Status', text: r => r.status }
                    ]
                };
            }
        },
        library: {
            label: 'Library',
            filters: () => [{ key: 'status', label: 'Status', options: ['Issued', 'Overdue', 'Returned'] }, { key: 'from', label: 'Issued from', type: 'date' }, { key: 'to', label: 'Issued to', type: 'date' }],
            build(f) {
                const rows = DB.all('issues').map(i => ({ ...i, status: LibraryService.status(i), book: (DB.find('books', i.bookId) || {}).title || 'Removed book', member: LibraryService.memberName(i), fineNow: LibraryService.fine(i) }))
                    .filter(i => (!f.status || i.status === f.status) && (!f.from || i.issueDate >= f.from) && (!f.to || i.issueDate <= f.to));
                return {
                    rows, summary: [['Records', rows.length], ['Currently issued', rows.filter(r => !r.returnDate).length], ['Overdue', rows.filter(r => r.status === 'Overdue').length], ['Total fines', Fmt.money(rows.reduce((t, r) => t + r.fineNow, 0))]],
                    columns: [
                        { label: 'Book', text: r => r.book }, { label: 'Borrower', text: r => `${r.member} (${r.memberType})` }, { label: 'Issued', text: r => D.fmt(r.issueDate) },
                        { label: 'Due', text: r => D.fmt(r.dueDate) }, { label: 'Returned', text: r => D.fmt(r.returnDate) }, { label: 'Fine', text: r => Fmt.money(r.fineNow) }, { label: 'Status', text: r => r.status }
                    ]
                };
            }
        }
    },

    filterHtml() {
        return this.defs[this.current].filters().map(f => {
            const id = `rep-f-${f.key}`;
            const val = this.values[f.key] ?? (f.required && f.options[0] ? String(typeof f.options[0] === 'object' ? f.options[0].value : f.options[0]) : '');
            if (f.type === 'date') return `<label for="${id}">${f.label}</label><input type="date" id="${id}" class="input" data-rep-filter="${f.key}" value="${esc(val)}">`;
            return `<label for="${id}">${f.label}</label><select id="${id}" class="input" data-rep-filter="${f.key}">${f.required ? '' : '<option value="">All</option>'}${f.options.map(o => {
                const v = typeof o === 'object' ? o.value : o, l = typeof o === 'object' ? o.label : o;
                return `<option value="${esc(v)}" ${String(v) === String(val) ? 'selected' : ''}>${esc(l)}</option>`;
            }).join('')}</select>`;
        }).join('');
    },

    readFilters() {
        const f = {};
        document.querySelectorAll('[data-rep-filter]').forEach(el => { f[el.dataset.repFilter] = el.value; this.values[el.dataset.repFilter] = el.value; });
        return f;
    },

    generate() {
        const out = document.getElementById('rep-out');
        let report;
        try { report = this.defs[this.current].build(this.readFilters()); } catch (err) { console.error(err); out.innerHTML = `<div class="empty-state error-state"><div class="empty-state-title">Could not build this report</div><div class="empty-state-description">${esc(err.message)}</div></div>`; return; }
        this.last = report;
        const title = `${this.defs[this.current].label} Report`;
        if (!report.rows.length) { out.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📄</div><div class="empty-state-title">No data for these filters</div></div>'; return; }
        out.innerHTML = `<div class="summary-row">${report.summary.map(([k, v]) => `<div class="summary-item"><small>${esc(k)}</small><strong>${esc(v)}</strong></div>`).join('')}</div>
            <div class="table-container"><table>${Table.html(report.columns, report.rows).replace(/^<table>|<\/table>$/g, '')}</table></div>
            <p class="text-small mt-1">${report.rows.length} row(s) &bull; ${esc(title)}</p>`;
    },

    summaryHtml() { return `<div class="doc-summary">${this.last.summary.map(([k, v]) => `<span><strong>${esc(k)}:</strong> ${esc(v)}</span>`).join('')}</div>`; }
};

Pages.reports = {
    title: 'Reports',
    render() {
        const tabs = Object.entries(Reports.defs).map(([id, d]) => [id, d.label]);
        return `<div class="card" id="rep-root"><div class="card-header"><h3 class="card-title">Reports</h3>
            <div class="btn-group"><button type="button" class="btn btn-outline" id="rep-csv">Export CSV</button><button type="button" class="btn btn-primary" id="rep-print">Print report</button></div></div>
            <div class="card-body">${Tabs.markup(tabs, Reports.current)}<div class="control-bar" id="rep-filters">${Reports.filterHtml()}</div><div id="rep-out"></div></div></div>`;
    },
    init() {
        const root = document.getElementById('rep-root');
        root.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => {
            Reports.current = b.dataset.tab;
            Reports.values = {};
            root.querySelectorAll('[data-tab]').forEach(x => { const on = x === b; x.classList.toggle('active', on); x.setAttribute('aria-selected', on); });
            document.getElementById('rep-filters').innerHTML = Reports.filterHtml();
            Reports.generate();
        }));
        document.getElementById('rep-filters').addEventListener('change', () => Reports.generate());
        document.getElementById('rep-csv').onclick = () => { if (Reports.last && Reports.last.rows.length) Table.csv(`${Reports.current}-report.csv`, Reports.last.columns, Reports.last.rows); else UI.toast('Nothing to export', 'warning'); };
        document.getElementById('rep-print').onclick = () => {
            if (!Reports.last || !Reports.last.rows.length) { UI.toast('Nothing to print', 'warning'); return; }
            Print.open(`${Reports.defs[Reports.current].label} Report`, Reports.summaryHtml() + Table.html(Reports.last.columns, Reports.last.rows));
        };
        Reports.generate();
    }
};

console.log('Reports module initialized');
