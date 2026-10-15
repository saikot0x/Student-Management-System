/**
 * results.js - Subject-wise marks, automatic percentage / grade / GPA, publishing and marksheets.
 * The grading rules live in exams.js (Grading).
 */
const ResultService = {
    // Result of one student in one exam (uses the exam schedule of the student's class)
    compute(examId, studentId) {
        const student = DB.find('students', studentId);
        if (!student) return null;
        const schedule = DB.all('examSchedule').filter(x => String(x.examId) === String(examId) && x.classId === student.classId).sort((a, b) => a.subjectId - b.subjectId);
        const marks = DB.all('marks').filter(m => String(m.examId) === String(examId) && m.studentId === student.id);
        const subjects = schedule.map(x => {
            const m = marks.find(k => k.subjectId === x.subjectId);
            return { subjectId: x.subjectId, subject: Lookup.subjectName(x.subjectId), total: Number(x.totalMarks), passMarks: Number(x.passMarks), obtained: m && m.obtained !== '' && m.obtained !== null ? Number(m.obtained) : null };
        });
        return { student, examId: Number(examId), hasSchedule: schedule.length > 0, ...Grading.summarize(subjects) };
    },

    // Every exam that has a result for this student
    examsFor(studentId, { publishedOnly = false } = {}) {
        return DB.all('exams')
            .filter(e => !publishedOnly || e.published)
            .map(exam => ({ exam, result: this.compute(exam.id, studentId) }))
            .filter(x => x.result && x.result.hasSchedule && x.result.subjects.some(s => s.obtained !== null))
            .sort((a, b) => b.exam.startDate.localeCompare(a.exam.startDate));
    },

    // Class result sheet with ranks
    sheet(examId, classId) {
        const rows = DB.all('students').filter(s => s.classId === Number(classId) && s.status === 'Active').sort((a, b) => a.rollNo - b.rollNo)
            .map(s => ({ student: s, result: this.compute(examId, s.id) }));
        const ranked = rows.filter(r => r.result.complete && r.result.passed).sort((a, b) => b.result.totalObtained - a.result.totalObtained);
        rows.forEach(r => { r.rank = ranked.length && ranked.includes(r) ? ranked.findIndex(x => x.result.totalObtained === r.result.totalObtained) + 1 : null; });
        return rows;
    },

    marksheetHtml(res) {
        const exam = DB.find('exams', res.examId) || {};
        const s = res.student;
        const legend = Grading.SCALE.map(g => `${g.grade}: ${g.min}%+`).join(' &nbsp;|&nbsp; ');
        return `
            <div class="doc-meta">
                <div><strong>Student:</strong> ${esc(s.name)}<br><strong>Student ID:</strong> ${esc(s.studentId)}<br><strong>Roll:</strong> ${esc(s.rollNo)}</div>
                <div><strong>Exam:</strong> ${esc(exam.name)}<br><strong>Class:</strong> ${esc(Lookup.classLabel(s.classId))}<br><strong>Session:</strong> ${esc(exam.session)}</div>
            </div>
            <table><thead><tr><th>Subject</th><th>Total</th><th>Pass</th><th>Obtained</th><th>%</th><th>Grade</th><th>GP</th></tr></thead><tbody>
            ${res.subjects.map(x => `<tr><td>${esc(x.subject)}</td><td>${x.total}</td><td>${x.passMarks}</td><td>${x.obtained === null ? '—' : x.obtained}</td><td>${x.percent === null ? '—' : x.percent.toFixed(1)}</td><td>${esc(x.grade)}</td><td>${x.point === null ? '—' : x.point.toFixed(2)}</td></tr>`).join('')}
            </tbody></table>
            ${res.complete ? `<div class="doc-summary"><span><strong>Total:</strong> ${res.totalObtained} / ${res.totalMax}</span><span><strong>Percentage:</strong> ${res.percent.toFixed(2)}%</span>
                <span><strong>GPA:</strong> ${res.gpa.toFixed(2)}</span><span><strong>Grade:</strong> ${esc(res.grade)}</span><span><strong>Result:</strong> ${res.passed ? 'PASS' : 'FAIL'}</span></div>`
                : '<p><strong>Marks are incomplete, so the overall result is not available yet.</strong></p>'}
            <p class="text-small">Grading: ${legend}</p>
            <div class="sign-row"><div>Class teacher</div><div>Principal</div></div>`;
    },

    showMarksheet(examId, studentId) {
        const res = this.compute(examId, studentId);
        if (!res) return;
        const exam = DB.find('exams', examId);
        if (Session.isFamily() && !(exam && exam.published)) { UI.toast('This result has not been published yet.', 'warning'); return; }
        Modal.document(`Marksheet - ${res.student.name}`, this.marksheetHtml(res), { printTitle: `Marksheet - ${res.student.name} - ${exam.name}` });
    },

    // Cache of the numbers shown on the dashboard
    latestFor(studentId) {
        const list = this.examsFor(studentId, { publishedOnly: true }).filter(x => x.result.complete);
        return list[0] || null;
    }
};

/* ---------- Page ---------- */
const ResultsUI = {
    examId: null, classId: null,

    entryHtml(exam, classId) {
        const sched = DB.all('examSchedule').filter(x => x.examId === exam.id && x.classId === classId).sort((a, b) => a.subjectId - b.subjectId);
        if (!sched.length) return `<div class="empty-state"><div class="empty-state-icon">🗓️</div><div class="empty-state-title">This exam has no schedule for ${esc(Lookup.classLabel(classId))}</div><a class="btn btn-primary" href="#/exams">Add schedule entries</a></div>`;
        const students = DB.all('students').filter(s => s.classId === classId && s.status === 'Active').sort((a, b) => a.rollNo - b.rollNo);
        if (!students.length) return '<div class="empty-state"><div class="empty-state-title">No active students in this class</div></div>';
        const marks = DB.all('marks').filter(m => m.examId === exam.id);
        const head = sched.map(x => `<th>${esc(Lookup.subjectName(x.subjectId))}<small>out of ${x.totalMarks}</small></th>`).join('');
        const rows = students.map(s => `<tr><td>${esc(s.rollNo)}</td><td>${esc(s.name)}</td>${sched.map(x => {
            const m = marks.find(k => k.studentId === s.id && k.subjectId === x.subjectId);
            return `<td><input class="input mark-input" type="number" min="0" max="${x.totalMarks}" step="0.5" data-student="${s.id}" data-subject="${x.subjectId}" data-max="${x.totalMarks}" value="${m ? esc(m.obtained) : ''}" aria-label="${esc(s.name)} - ${esc(Lookup.subjectName(x.subjectId))}"></td>`;
        }).join('')}</tr>`).join('');
        return `<p class="text-small mb-2">Leave a box empty if the mark is not available yet.</p>
            <div class="table-container"><table class="marks-table"><thead><tr><th>Roll</th><th>Student</th>${head}</tr></thead><tbody>${rows}</tbody></table></div>
            <div class="mt-2"><button type="button" class="btn btn-success" id="marks-save">Save marks</button></div>`;
    },

    saveMarks(exam, classId) {
        const inputs = [...document.querySelectorAll('.mark-input')];
        let bad = 0;
        const entries = [];
        inputs.forEach(inp => {
            inp.removeAttribute('aria-invalid');
            if (inp.value === '') return;
            const v = Number(inp.value);
            if (Number.isNaN(v) || v < 0 || v > Number(inp.dataset.max)) { inp.setAttribute('aria-invalid', 'true'); bad++; return; }
            entries.push({ examId: exam.id, studentId: Number(inp.dataset.student), subjectId: Number(inp.dataset.subject), obtained: v });
        });
        if (bad) { UI.toast(`${bad} mark(s) are invalid. Marks must be between 0 and the total.`, 'error', 4500); return; }
        const sched = DB.all('examSchedule').filter(x => x.examId === exam.id && x.classId === classId).map(x => x.subjectId);
        const ids = new Set(DB.all('students').filter(s => s.classId === classId).map(s => s.id));
        DB.removeWhere('marks', m => m.examId === exam.id && ids.has(m.studentId) && sched.includes(m.subjectId));
        DB.insertMany('marks', entries);
        UI.toast('Marks saved', 'success');
        this.renderSheet(exam, classId);
    },

    sheetColumns() {
        return [
            { label: 'Rank', text: (r) => r.rank ?? '' }, { label: 'Roll', text: (r) => r.student.rollNo }, { label: 'Student', text: (r) => r.student.name },
            { label: 'Total', text: (r) => (r.result.complete ? `${r.result.totalObtained}/${r.result.totalMax}` : '') },
            { label: 'Percentage', text: (r) => (r.result.complete ? r.result.percent.toFixed(2) + '%' : '') },
            { label: 'GPA', text: (r) => (r.result.complete ? r.result.gpa.toFixed(2) : '') },
            { label: 'Grade', text: (r) => (r.result.complete ? r.result.grade : '') },
            { label: 'Result', text: (r) => (r.result.complete ? (r.result.passed ? 'Pass' : 'Fail') : 'Incomplete') }
        ];
    },

    renderSheet(exam, classId) {
        const out = document.getElementById('res-sheet');
        const rows = ResultService.sheet(exam.id, classId);
        if (!rows.length || !rows[0].result.hasSchedule) { out.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📝</div><div class="empty-state-title">Nothing to show until the exam has a schedule and students</div></div>'; return; }
        const done = rows.filter(r => r.result.complete);
        const pass = done.filter(r => r.result.passed).length;
        out.innerHTML = `
            <div class="summary-row">
                <div class="summary-item"><small>Students</small><strong>${rows.length}</strong></div>
                <div class="summary-item"><small>Results complete</small><strong>${done.length}</strong></div>
                <div class="summary-item"><small>Passed</small><strong>${pass}</strong></div>
                <div class="summary-item"><small>Pass rate</small><strong>${done.length ? Fmt.pct((pass / done.length) * 100) : '—'}</strong></div>
                <div class="summary-item"><small>Publishing</small><strong>${exam.published ? 'Published' : 'Not published'}</strong></div>
            </div>
            <div class="btn-group mb-2"><button type="button" class="btn btn-outline" id="sheet-csv">Export CSV</button><button type="button" class="btn btn-outline" id="sheet-print">Print result sheet</button></div>
            <div class="table-container"><table><thead><tr><th>Rank</th><th>Roll</th><th>Student</th><th>Total</th><th>%</th><th>GPA</th><th>Grade</th><th>Result</th><th></th></tr></thead><tbody>
            ${rows.map(r => `<tr><td>${r.rank ?? '—'}</td><td>${esc(r.student.rollNo)}</td><td>${esc(r.student.name)}</td>
                <td>${r.result.complete ? `${r.result.totalObtained} / ${r.result.totalMax}` : '—'}</td><td>${r.result.complete ? r.result.percent.toFixed(1) + '%' : '—'}</td>
                <td>${r.result.complete ? r.result.gpa.toFixed(2) : '—'}</td><td>${r.result.complete ? Badge.html(r.result.grade) : '—'}</td>
                <td>${r.result.complete ? Badge.html(r.result.passed ? 'Pass' : 'Fail') : Badge.html('Incomplete', 'secondary')}</td>
                <td><button type="button" class="btn btn-small btn-outline" data-marksheet="${r.student.id}">Marksheet</button></td></tr>`).join('')}
            </tbody></table></div>`;
        document.getElementById('sheet-csv').onclick = () => Table.csv(`results-${exam.name}-${Lookup.classLabel(classId)}.csv`, this.sheetColumns(), rows);
        document.getElementById('sheet-print').onclick = () => Print.open(`Result Sheet - ${exam.name} - ${Lookup.classLabel(classId)}`, Table.html(this.sheetColumns(), rows));
        out.querySelectorAll('[data-marksheet]').forEach(b => b.addEventListener('click', () => {
            const res = ResultService.compute(exam.id, b.dataset.marksheet);
            Modal.document(`Marksheet - ${res.student.name}`, ResultService.marksheetHtml(res), { printTitle: `Marksheet - ${res.student.name} - ${exam.name}` });
        }));
    },

    async togglePublish(exam, classId) {
        const rows = DB.all('students').filter(s => s.status === 'Active').map(s => ResultService.compute(exam.id, s.id)).filter(r => r.hasSchedule);
        const incomplete = rows.filter(r => !r.complete).length;
        if (!exam.published) {
            const msg = incomplete ? `${incomplete} student(s) still have incomplete marks. Publish anyway? Students and parents will be able to see published results.` : 'Publish these results? Students and parents will be able to see them.';
            if (!(await Modal.confirm(msg, { title: 'Publish results', confirmText: 'Publish', danger: false }))) return;
        }
        DB.update('exams', exam.id, { published: !exam.published });
        UI.toast(exam.published ? 'Results unpublished' : 'Results published', 'success');
        this.load();
    },

    load() { // re-render everything for the selected exam + class
        const exam = DB.find('exams', document.getElementById('res-exam').value);
        const classId = Number(document.getElementById('res-class').value);
        if (!exam || !classId) return;
        const btn = document.getElementById('res-publish');
        if (btn) { btn.textContent = exam.published ? 'Unpublish results' : 'Publish results'; btn.className = `btn ${exam.published ? 'btn-outline' : 'btn-success'}`; btn.onclick = () => this.togglePublish(exam, classId); }
        document.getElementById('res-status').innerHTML = `${Badge.html(exam.published ? 'Published' : 'Unpublished')} <span class="text-small">${esc(exam.name)} &bull; ${esc(Lookup.classLabel(classId))}</span>`;
        const entry = document.getElementById('res-entry');
        entry.innerHTML = this.entryHtml(exam, classId);
        const save = document.getElementById('marks-save');
        if (save) save.onclick = () => this.saveMarks(exam, classId);
        this.renderSheet(exam, classId);
    },

    familyView() {
        const me = Session.student();
        if (!me) return '<div class="card"><div class="empty-state"><div class="empty-state-title">No student linked to this account</div></div></div>';
        const list = ResultService.examsFor(me.id, { publishedOnly: true });
        if (!list.length) return '<div class="card"><div class="empty-state"><div class="empty-state-icon">📝</div><div class="empty-state-title">No published results yet</div><div class="empty-state-description">Results appear here once the school publishes them.</div></div></div>';
        return `<div class="card"><div class="card-header"><h3 class="card-title">Results</h3>
            <div class="btn-group"><label for="res-exam">Exam</label><select id="res-exam" class="input">${list.map(x => `<option value="${x.exam.id}">${esc(x.exam.name)}</option>`).join('')}</select>
            <button type="button" class="btn btn-primary" id="res-print">Print</button></div></div><div class="card-body" id="res-family-out"></div></div>`;
    }
};

Pages.results = {
    title: 'Results',
    render() {
        if (Session.isFamily()) return ResultsUI.familyView();
        const exams = DB.all('exams').slice().sort((a, b) => b.startDate.localeCompare(a.startDate));
        if (!exams.length) return '<div class="card"><div class="empty-state"><div class="empty-state-title">Create an exam first</div><a class="btn btn-primary" href="#/exams">Go to exams</a></div></div>';
        const firstClass = (DB.all('classes')[0] || {}).id;
        return `<div class="card"><div class="card-header"><h3 class="card-title">Marks & Results</h3>
            <div class="btn-group">${Session.isAdmin() ? '<button type="button" id="res-publish" class="btn btn-success">Publish results</button>' : ''}</div></div>
            <div class="card-body" id="res-root">
                <div class="control-bar"><label for="res-exam">Exam</label><select id="res-exam" class="input">${exams.map(e => `<option value="${e.id}">${esc(e.name)}</option>`).join('')}</select>
                <label for="res-class">Class</label><select id="res-class" class="input">${Lookup.classOptions().map(o => `<option value="${o.value}" ${o.value === firstClass ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>
                <span id="res-status"></span></div>
                ${Tabs.markup([['entry', 'Marks entry'], ['sheet', 'Result sheet']], 'entry')}
                <div class="tab-content active" data-panel="entry" id="res-entry"></div>
                <div class="tab-content" data-panel="sheet" id="res-sheet"></div>
            </div></div>`;
    },
    init() {
        if (Session.isFamily()) {
            const me = Session.student();
            const sel = document.getElementById('res-exam');
            if (!sel) return;
            const show = () => { document.getElementById('res-family-out').innerHTML = `<div class="doc">${ResultService.marksheetHtml(ResultService.compute(sel.value, me.id))}</div>`; };
            sel.addEventListener('change', show);
            show();
            document.getElementById('res-print').onclick = () => Print.open(`Marksheet - ${me.name}`, ResultService.marksheetHtml(ResultService.compute(sel.value, me.id)));
            return;
        }
        const root = document.getElementById('res-root');
        if (!root) return;
        Tabs.bind(root);
        document.getElementById('res-exam').addEventListener('change', () => ResultsUI.load());
        document.getElementById('res-class').addEventListener('change', () => ResultsUI.load());
        ResultsUI.load();
    }
};

console.log('Results module initialized');
