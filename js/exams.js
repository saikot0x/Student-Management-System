/**
 * exams.js - Grading rules, exam management and exam schedule.
 *
 * GRADING IS CONFIGURABLE: change the SCALE table below (or the two options under it)
 * and every page (results, marksheets, reports, dashboard) updates automatically.
 */
const Grading = {
    // min = lowest percentage for that grade, point = grade point used for GPA
    SCALE: [
        { grade: 'A+', min: 80, point: 5.0 },
        { grade: 'A', min: 70, point: 4.0 },
        { grade: 'A-', min: 60, point: 3.5 },
        { grade: 'B', min: 50, point: 3.0 },
        { grade: 'C', min: 40, point: 2.0 },
        { grade: 'D', min: 33, point: 1.0 },
        { grade: 'F', min: 0, point: 0.0 }
    ],
    PASS_PERCENT: 33,               // used when a schedule row has no pass marks
    FAIL_IF_ANY_SUBJECT_FAILS: true, // true: failing one subject = overall Fail and GPA 0.00

    forPercent(p) {
        const v = Math.round(Number(p) * 100) / 100;
        return this.SCALE.find(g => v >= g.min) || this.SCALE[this.SCALE.length - 1];
    },

    // subjects = [{ subject, obtained (number or null), total, passMarks }]
    summarize(subjects) {
        const complete = subjects.length > 0 && subjects.every(s => s.obtained !== null);
        const rows = subjects.map(s => {
            if (s.obtained === null) return { ...s, percent: null, grade: '—', point: null, passed: null };
            const percent = s.total ? (s.obtained / s.total) * 100 : 0;
            const g = this.forPercent(percent);
            const pass = s.obtained >= (s.passMarks || Math.ceil((s.total * this.PASS_PERCENT) / 100));
            return { ...s, percent, grade: pass ? g.grade : 'F', point: pass ? g.point : 0, passed: pass };
        });
        if (!complete) return { complete: false, subjects: rows };
        const totalObtained = rows.reduce((t, s) => t + s.obtained, 0);
        const totalMax = rows.reduce((t, s) => t + s.total, 0);
        const percent = totalMax ? (totalObtained / totalMax) * 100 : 0;
        const allPassed = rows.every(s => s.passed);
        const passed = this.FAIL_IF_ANY_SUBJECT_FAILS ? allPassed : percent >= this.PASS_PERCENT;
        const average = rows.reduce((t, s) => t + s.point, 0) / rows.length;
        const gpa = passed || !this.FAIL_IF_ANY_SUBJECT_FAILS ? average : 0;
        return { complete: true, subjects: rows, totalObtained, totalMax, percent, gpa, passed, grade: passed ? this.forPercent(percent).grade : 'F' };
    }
};

Grading.DEFAULT_SCALE = Grading.SCALE.map(g => ({ ...g }));
{ const saved = Store.get('gradingScale'); if (Array.isArray(saved) && saved.length) Grading.SCALE = saved; }

const Exams = {
    upcoming() {
        const today = D.today();
        return DB.all('exams').filter(e => e.endDate >= today).sort((a, b) => a.startDate.localeCompare(b.startDate));
    }
};

function makeExamsCrud() {
    return Crud.create({
        collection: 'exams', title: 'Examinations', singular: 'Exam', plural: 'exams', defaultSort: 'startDate', defaultDir: 'desc', pageSize: 6,
        searchKeys: ['name', 'session', 'status'], label: (e) => e.name,
        filters: [{ key: 'status', label: 'Statuses', options: () => ['Scheduled', 'Ongoing', 'Completed'] }, { key: 'session', label: 'Sessions', options: () => Lookup.sessionOptions() }],
        columns: [
            { key: 'name', label: 'Exam' }, { key: 'session', label: 'Session' },
            { key: 'startDate', label: 'Dates', render: (e) => `${D.fmt(e.startDate)} &ndash; ${D.fmt(e.endDate)}`, text: (e) => `${D.fmt(e.startDate)} - ${D.fmt(e.endDate)}` },
            { key: 'status', label: 'Status', render: (e) => Badge.html(e.status) },
            { key: 'published', label: 'Results', render: (e) => Badge.html(e.published ? 'Published' : 'Unpublished'), text: (e) => (e.published ? 'Published' : 'Unpublished') }
        ],
        fields: [
            { name: 'name', label: 'Exam name', required: true },
            { name: 'session', label: 'Session', type: 'select', required: true, options: () => Lookup.sessionOptions() },
            { name: 'startDate', label: 'Start date', type: 'date', required: true },
            { name: 'endDate', label: 'End date', type: 'date', required: true },
            { name: 'status', label: 'Status', type: 'select', required: true, options: ['Scheduled', 'Ongoing', 'Completed'] }
        ],
        defaults: () => ({ status: 'Scheduled', session: Settings.session() }),
        validate: (d) => (d.endDate < d.startDate ? { endDate: 'End date cannot be before the start date' } : {}),
        beforeSave: (d, raw) => (raw ? d : { ...d, published: false }),
        deleteGuard: (e) => (e.published ? 'Unpublish the results before deleting this exam.' : null),
        afterDelete: (e) => { DB.removeWhere('examSchedule', x => x.examId === e.id); DB.removeWhere('marks', m => m.examId === e.id); },
        afterSave: () => Pages.exams.parts[1].api.refresh()
    });
}

function makeScheduleCrud() {
    return Crud.create({
        collection: 'examSchedule', title: 'Exam Schedule', singular: 'Schedule entry', plural: 'schedule entries', defaultSort: 'date',
        writeRoles: ['admin'],
        intro: 'One row per exam, class and subject. The total marks you enter here are used for marks entry, percentage and grade.',
        searchKeys: ['examName', 'classLabel', 'subjectName'],
        rows: () => DB.all('examSchedule').map(x => ({ ...x, examName: (DB.find('exams', x.examId) || {}).name || '—', classLabel: Lookup.classLabel(x.classId), subjectName: Lookup.subjectName(x.subjectId) })),
        filters: [{ key: 'examId', label: 'Exams', options: () => Lookup.examOptions() }, { key: 'classId', label: 'Classes', options: () => Lookup.classOptions() }],
        columns: [
            { key: 'examName', label: 'Exam' }, { key: 'classLabel', label: 'Class' }, { key: 'subjectName', label: 'Subject' },
            { key: 'date', label: 'Date', render: (x) => D.fmt(x.date), text: (x) => x.date }, { key: 'startTime', label: 'Time' },
            { key: 'duration', label: 'Minutes', cls: 'hide-on-mobile' }, { key: 'totalMarks', label: 'Total' }, { key: 'passMarks', label: 'Pass' }
        ],
        fields: [
            { name: 'examId', label: 'Exam', type: 'select', ref: true, required: true, options: () => Lookup.examOptions() },
            { name: 'classId', label: 'Class', type: 'select', ref: true, required: true, options: () => Lookup.classOptions() },
            { name: 'subjectId', label: 'Subject', type: 'select', ref: true, required: true, options: () => Lookup.subjectOptions() },
            { name: 'date', label: 'Exam date', type: 'date', required: true },
            { name: 'startTime', label: 'Start time', type: 'time', required: true },
            { name: 'duration', label: 'Duration (minutes)', type: 'number', min: 10, required: true },
            { name: 'totalMarks', label: 'Total marks', type: 'number', min: 1, required: true },
            { name: 'passMarks', label: 'Pass marks', type: 'number', min: 0, required: true }
        ],
        defaults: () => ({ startTime: '10:00', duration: 120, totalMarks: 100, passMarks: 33 }),
        validate: (d, raw) => {
            const e = {};
            if (d.passMarks > d.totalMarks) e.passMarks = 'Pass marks cannot be more than total marks';
            if (DB.all('examSchedule').some(x => x.examId === d.examId && x.classId === d.classId && x.subjectId === d.subjectId && (!raw || x.id !== raw.id))) e.subjectId = 'This subject is already scheduled for that exam and class';
            return e;
        },
        deleteGuard: (x) => (DB.all('marks').some(m => m.examId === x.examId && m.subjectId === x.subjectId && DB.find('students', m.studentId)?.classId === x.classId) ? 'Marks already exist for this subject. Remove the marks first.' : null)
    });
}

Pages.exams = Crud.page({ title: 'Examinations', make: () => [makeExamsCrud(), makeScheduleCrud()] });

console.log('Exams module initialized');
