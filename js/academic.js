/**
 * academic.js - Academic management
 *  Classes page   : academic sessions + classes/sections (with class teacher)
 *  Subjects page  : subjects + teacher assignments (which teacher teaches what in which class)
 *  Timetable page : weekly routine grid
 */
function makeSessionsCrud() {
    return Crud.create({
        collection: 'sessions', title: 'Academic Sessions', singular: 'Session', plural: 'sessions', defaultSort: 'name', defaultDir: 'desc', pageSize: 5,
        searchKeys: ['name', 'status'], label: (s) => s.name,
        columns: [
            { key: 'name', label: 'Session' },
            { key: 'startDate', label: 'Starts', render: (s) => D.fmt(s.startDate), text: (s) => D.fmt(s.startDate) },
            { key: 'endDate', label: 'Ends', render: (s) => D.fmt(s.endDate), text: (s) => D.fmt(s.endDate) },
            { key: 'status', label: 'Status', render: (s) => Badge.html(s.status, s.status === 'Active' ? 'success' : 'secondary') }
        ],
        fields: [
            { name: 'name', label: 'Session name', required: true, placeholder: 'e.g. 2027' },
            { name: 'status', label: 'Status', type: 'select', required: true, options: ['Active', 'Closed'] },
            { name: 'startDate', label: 'Start date', type: 'date', required: true },
            { name: 'endDate', label: 'End date', type: 'date', required: true }
        ],
        defaults: () => ({ status: 'Closed' }),
        validate: (d, raw) => {
            const e = {};
            if (d.endDate <= d.startDate) e.endDate = 'End date must be after the start date';
            if (DB.all('sessions').some(s => s.name === d.name && (!raw || s.id !== raw.id))) e.name = 'This session already exists';
            return e;
        },
        afterSave: (saved) => { // only one session can be active; it also becomes the school's current session
            if (saved.status === 'Active') {
                DB.all('sessions').filter(s => s.id !== saved.id && s.status === 'Active').forEach(s => DB.update('sessions', s.id, { status: 'Closed' }));
                Settings.save({ academicSession: saved.name });
            }
            Pages.classes.parts.forEach(p => p.api.refresh());
        },
        deleteGuard: (s) => (DB.all('students').some(x => x.session === s.name) || s.name === Settings.session() ? 'This session is in use. Close it instead of deleting.' : null)
    });
}

function makeClassesCrud() {
    return Crud.create({
        collection: 'classes', title: 'Classes & Sections', singular: 'Class', plural: 'classes', defaultSort: 'label',
        searchKeys: ['label', 'room', 'teacherName'],
        label: (c) => `${c.name} - ${c.section}`,
        rows: () => DB.all('classes').map(c => ({
            ...c, label: `${c.name} - ${c.section}`, teacherName: Lookup.teacherName(c.classTeacherId),
            students: DB.all('students').filter(s => s.classId === c.id).length
        })),
        filters: [{ key: 'name', label: 'Classes', options: () => [...new Set(DB.all('classes').map(c => c.name))] }, { key: 'session', label: 'Sessions', options: () => Lookup.sessionOptions() }],
        columns: [
            { key: 'label', label: 'Class - Section' }, { key: 'room', label: 'Room' }, { key: 'capacity', label: 'Capacity' },
            { key: 'students', label: 'Students' }, { key: 'teacherName', label: 'Class teacher' }, { key: 'session', label: 'Session' }
        ],
        fields: [
            { name: 'name', label: 'Class', type: 'select', required: true, options: Array.from({ length: 12 }, (_, i) => `Class ${i + 1}`) },
            { name: 'section', label: 'Section', type: 'select', required: true, options: ['A', 'B', 'C', 'D'] },
            { name: 'room', label: 'Room' },
            { name: 'capacity', label: 'Capacity', type: 'number', min: 1, max: 100, required: true },
            { name: 'classTeacherId', label: 'Class teacher', type: 'select', ref: true, options: () => Lookup.teacherOptions() },
            { name: 'session', label: 'Session', type: 'select', required: true, options: () => Lookup.sessionOptions() }
        ],
        defaults: () => ({ capacity: 40, session: Settings.session() }),
        validate: (d, raw) => (DB.all('classes').some(c => c.name === d.name && c.section === d.section && (!raw || c.id !== raw.id)) ? { section: 'This class and section already exists' } : {}),
        deleteGuard: (c) => {
            if (DB.all('students').some(s => s.classId === c.id)) return 'This class still has students. Move them first.';
            return null;
        },
        afterDelete: (c) => { DB.removeWhere('teaching', t => t.classId === c.id); DB.removeWhere('routine', r => r.classId === c.id); DB.removeWhere('examSchedule', x => x.classId === c.id); DB.removeWhere('attendance', a => a.classId === c.id); }
    });
}

Pages.classes = Crud.page({ title: 'Classes & Sessions', make: () => [makeSessionsCrud(), makeClassesCrud()] });

function makeSubjectsCrud() {
    return Crud.create({
        collection: 'subjects', title: 'Subjects', singular: 'Subject', plural: 'subjects', defaultSort: 'code',
        searchKeys: ['code', 'name', 'category'], label: (s) => s.name,
        filters: [{ key: 'category', label: 'Categories', options: () => ['Core', 'Elective', 'Co-curricular'] }],
        columns: [
            { key: 'code', label: 'Code' }, { key: 'name', label: 'Subject' }, { key: 'category', label: 'Category' },
            { key: 'totalMarks', label: 'Total marks' }, { key: 'passMarks', label: 'Pass marks' }
        ],
        fields: [
            { name: 'code', label: 'Subject code', required: true }, { name: 'name', label: 'Subject name', required: true },
            { name: 'category', label: 'Category', type: 'select', required: true, options: ['Core', 'Elective', 'Co-curricular'] },
            { name: 'totalMarks', label: 'Default total marks', type: 'number', min: 1, required: true },
            { name: 'passMarks', label: 'Default pass marks', type: 'number', min: 0, required: true }
        ],
        defaults: () => ({ category: 'Core', totalMarks: 100, passMarks: 33 }),
        validate: (d, raw) => {
            const e = {};
            if (d.passMarks > d.totalMarks) e.passMarks = 'Pass marks cannot be more than total marks';
            if (DB.all('subjects').some(s => s.code.toLowerCase() === d.code.toLowerCase() && (!raw || s.id !== raw.id))) e.code = 'This code is already used';
            return e;
        },
        deleteGuard: (s) => (['teaching', 'routine', 'examSchedule', 'assignments'].some(n => DB.all(n).some(x => x.subjectId === s.id)) || DB.all('teachers').some(t => t.subjectId === s.id) ? 'This subject is used in timetables, exams, assignments or teacher records.' : null)
    });
}

function makeTeachingCrud() {
    return Crud.create({
        collection: 'teaching', title: 'Teacher Assignments', singular: 'Assignment', plural: 'assignments', defaultSort: 'classLabel',
        intro: 'Which teacher teaches which subject in which class. Class teachers are set on the Classes page.',
        searchKeys: ['teacherName', 'subjectName', 'classLabel'],
        rows: () => DB.all('teaching').map(t => ({ ...t, teacherName: Lookup.teacherName(t.teacherId), subjectName: Lookup.subjectName(t.subjectId), classLabel: Lookup.classLabel(t.classId) })),
        filters: [{ key: 'classId', label: 'Classes', options: () => Lookup.classOptions() }, { key: 'teacherId', label: 'Teachers', options: () => Lookup.teacherOptions() }, { key: 'subjectId', label: 'Subjects', options: () => Lookup.subjectOptions() }],
        columns: [{ key: 'classLabel', label: 'Class' }, { key: 'subjectName', label: 'Subject' }, { key: 'teacherName', label: 'Teacher' }],
        fields: [
            { name: 'classId', label: 'Class', type: 'select', ref: true, required: true, options: () => Lookup.classOptions() },
            { name: 'subjectId', label: 'Subject', type: 'select', ref: true, required: true, options: () => Lookup.subjectOptions() },
            { name: 'teacherId', label: 'Teacher', type: 'select', ref: true, required: true, options: () => Lookup.teacherOptions() }
        ],
        validate: (d, raw) => (DB.all('teaching').some(t => t.classId === d.classId && t.subjectId === d.subjectId && (!raw || t.id !== raw.id))
            ? { subjectId: 'This subject already has a teacher in that class. Edit that row instead.' } : {})
    });
}

Pages.subjects = Crud.page({ title: 'Subjects & Teacher Assignments', make: () => [makeSubjectsCrud(), makeTeachingCrud()] });

/* ---------- Weekly timetable ---------- */
const Routine = {
    DAYS: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
    PERIODS: [
        { n: 1, time: '08:00 - 08:45' }, { n: 2, time: '08:50 - 09:35' }, { n: 3, time: '09:40 - 10:25' },
        { n: 4, time: '10:45 - 11:30' }, { n: 5, time: '11:35 - 12:20' }, { n: 6, time: '12:25 - 13:10' }
    ],
    classId: null,

    defaultClass() {
        if (Session.isFamily()) { const s = Session.student(); return s ? s.classId : null; }
        const t = Session.teacher();
        const own = t && DB.all('classes').find(c => c.classTeacherId === t.id);
        return own ? own.id : (DB.all('classes')[0] || {}).id || null;
    },

    cell(classId, day, period) { return DB.all('routine').find(r => r.classId === classId && r.day === day && r.period === period); },

    gridHtml(classId) {
        const editable = Session.isAdmin();
        const rows = this.PERIODS.map(p => `<tr><th scope="row">P${p.n}<small>${p.time}</small></th>${this.DAYS.map(day => {
            const c = this.cell(classId, day, p.n);
            const inner = c ? `<strong>${esc(Lookup.subjectName(c.subjectId))}</strong><small>${esc(Lookup.teacherName(c.teacherId))}</small>` : '<small class="text-small">Free</small>';
            return `<td class="tt-cell">${editable ? `<button type="button" class="tt-btn" data-day="${day}" data-period="${p.n}" aria-label="Edit ${day} period ${p.n}">${inner}</button>` : inner}</td>`;
        }).join('')}</tr>`).join('');
        return `<div class="table-container"><table class="timetable"><thead><tr><th></th>${this.DAYS.map(d => `<th scope="col">${d}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>
            ${editable ? '<p class="text-small mt-1">Click any period to change its subject and teacher.</p>' : ''}`;
    },

    editCell(day, period) {
        const classId = this.classId;
        const existing = this.cell(classId, day, period);
        Modal.form({
            title: `${day}, period ${period} - ${Lookup.classLabel(classId)}`, size: '',
            fields: [
                { name: 'subjectId', label: 'Subject (leave empty for a free period)', type: 'select', ref: true, options: () => Lookup.subjectOptions() },
                { name: 'teacherId', label: 'Teacher', type: 'select', ref: true, options: () => Lookup.teacherOptions() }
            ],
            values: existing || {}, submitText: 'Save period',
            onSubmit: (data, m) => {
                if (data.subjectId && !data.teacherId) { // suggest the teacher assigned to this subject in this class
                    const t = DB.all('teaching').find(x => x.classId === classId && x.subjectId === data.subjectId);
                    data.teacherId = t ? t.teacherId : '';
                }
                if (data.subjectId && !data.teacherId) { Form.showErrors(m.el.querySelector('form'), { teacherId: 'Choose a teacher' }); return false; }
                if (data.teacherId) {
                    const clash = DB.all('routine').find(r => r.teacherId === data.teacherId && r.day === day && r.period === period && r.classId !== classId);
                    if (clash) { Form.showErrors(m.el.querySelector('form'), { teacherId: `${Lookup.teacherName(data.teacherId)} already teaches ${Lookup.classLabel(clash.classId)} in this period` }); return false; }
                }
                if (existing) DB.remove('routine', existing.id);
                if (data.subjectId) DB.insert('routine', { classId, day, period, subjectId: data.subjectId, teacherId: data.teacherId });
                UI.toast('Timetable updated', 'success');
                this.refresh();
            }
        });
    },

    refresh() { document.getElementById('routine-grid').innerHTML = this.gridHtml(this.classId); },
};

Pages.routine = {
    title: 'Weekly Timetable',
    render() {
        Routine.classId = Routine.defaultClass();
        const picker = Session.isFamily() ? `<strong>${esc(Lookup.classLabel(Routine.classId))}</strong>`
            : `<label for="routine-class">Class</label> <select id="routine-class" class="input">${Lookup.classOptions().map(o => `<option value="${o.value}" ${o.value === Routine.classId ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`;
        if (!Routine.classId) return '<div class="card"><div class="empty-state"><div class="empty-state-title">No class found</div></div></div>';
        return `<div class="card"><div class="card-header"><h3 class="card-title">Weekly Routine</h3>
            <div class="btn-group">${picker}<button type="button" class="btn btn-outline" id="routine-print">Print</button></div></div>
            <div class="card-body" id="routine-grid">${Routine.gridHtml(Routine.classId)}</div></div>`;
    },
    init() {
        const sel = document.getElementById('routine-class');
        if (sel) sel.addEventListener('change', () => { Routine.classId = Number(sel.value); Routine.refresh(); });
        const btn = document.getElementById('routine-print');
        if (btn) btn.onclick = () => Print.open(`Weekly Routine - ${Lookup.classLabel(Routine.classId)}`, document.getElementById('routine-grid').innerHTML.replace(/<button[^>]*>|<\/button>/g, ''));
        document.getElementById('routine-grid').addEventListener('click', (e) => {
            const b = e.target.closest('.tt-btn');
            if (b) Routine.editCell(b.dataset.day, Number(b.dataset.period));
        });
    }
};

console.log('Academic module initialized');
