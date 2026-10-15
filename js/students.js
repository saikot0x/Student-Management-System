/**
 * students.js - Student management (CRUD, search, filter, sort, pagination) and the student profile page
 */
const StudentRows = {
    // Students plus a few extra values that the table needs
    all() {
        return DB.all('students').map(s => ({
            ...s, className: Lookup.className(s.classId), section: Lookup.section(s.classId), classLabel: Lookup.classLabel(s.classId)
        }));
    }
};

function makeStudentsCrud() {
    return Crud.create({
        collection: 'students', title: 'Students', singular: 'Student', plural: 'students', defaultSort: 'classLabel',
        searchKeys: ['name', 'studentId', 'regNo', 'rollNo', 'guardianName', 'phone', 'guardianPhone'],
        rows: StudentRows.all,
        label: (s) => s.name,
        filters: [
            { key: 'classId', label: 'Classes', options: () => Lookup.classOptions() },
            { key: 'section', label: 'Sections', options: () => ['A', 'B', 'C'] },
            { key: 'session', label: 'Sessions', options: () => Lookup.sessionOptions() },
            { key: 'status', label: 'Statuses', options: () => ['Active', 'Inactive', 'Graduated', 'Transferred'] }
        ],
        columns: [
            { key: 'name', label: 'Student', render: (s) => `<a class="person" href="#/student-profile/${s.id}">${Avatar.html(s.name, s.photo)}<span><strong>${esc(s.name)}</strong><small>${esc(s.studentId)}</small></span></a>` },
            { key: 'rollNo', label: 'Roll', sortValue: (s) => Number(s.rollNo) },
            { key: 'regNo', label: 'Reg. No', cls: 'hide-on-mobile' },
            { key: 'classLabel', label: 'Class', text: (s) => s.className },
            { key: 'section', label: 'Section' },
            { key: 'guardianName', label: 'Guardian', cls: 'hide-on-mobile', render: (s) => `${esc(s.guardianName)}<br><small class="text-small">${esc(s.guardianPhone)}</small>`, text: (s) => `${s.guardianName} (${s.guardianPhone})` },
            { key: 'status', label: 'Status', render: (s) => Badge.html(s.status) }
        ],
        onView: (s) => { location.hash = `#/student-profile/${s.id}`; },
        fields: (raw) => [
            { name: 'photo', label: 'Student photo', type: 'photo', full: true },
            { name: 'name', label: 'Full name', required: true },
            { name: 'gender', label: 'Gender', type: 'select', options: ['Male', 'Female', 'Other'], required: true },
            { name: 'dob', label: 'Date of birth', type: 'date', required: true },
            ...(raw ? [{ name: 'studentId', label: 'Student ID', readonly: true }] : []),
            { name: 'regNo', label: 'Registration number', required: true },
            { name: 'rollNo', label: 'Roll number', type: 'number', min: 1, required: true },
            { name: 'classId', label: 'Class & section', type: 'select', ref: true, required: true, options: () => Lookup.classOptions() },
            { name: 'session', label: 'Session', type: 'select', required: true, options: () => Lookup.sessionOptions() },
            { name: 'admissionDate', label: 'Admission date', type: 'date', required: true },
            { name: 'status', label: 'Status', type: 'select', required: true, options: ['Active', 'Inactive', 'Graduated', 'Transferred'] },
            { name: 'guardianName', label: 'Guardian name', required: true },
            { name: 'guardianRelation', label: 'Relation', type: 'select', required: true, options: ['Father', 'Mother', 'Guardian', 'Other'] },
            { name: 'guardianPhone', label: 'Guardian phone', type: 'tel', required: true },
            { name: 'guardianEmail', label: 'Guardian email', type: 'email' },
            { name: 'phone', label: 'Student phone', type: 'tel' },
            { name: 'email', label: 'Student email', type: 'email' },
            { name: 'address', label: 'Address', type: 'textarea', full: true },
            ...(raw ? [] : Credentials.studentFields())
        ],
        defaults: () => ({
            status: 'Active', gender: 'Male', guardianRelation: 'Father', session: Settings.session(), admissionDate: D.today(),
            regNo: `REG-${D.today().slice(0, 4)}-${pad(DB.peekId('students'), 4)}`
        }),
        validate: (data, raw) => {
            const errors = {};
            const others = DB.all('students').filter(s => !raw || s.id !== raw.id);
            if (others.some(s => String(s.classId) === String(data.classId) && Number(s.rollNo) === Number(data.rollNo))) errors.rollNo = 'This roll number is already used in that class';
            if (others.some(s => String(s.regNo).toLowerCase() === String(data.regNo).toLowerCase())) errors.regNo = 'This registration number already exists';
            if (data.dob && data.dob > D.today()) errors.dob = 'Date of birth cannot be in the future';
            if (!raw) Object.assign(errors, Credentials.validateStudent(data));
            return errors;
        },
        beforeSave: (data, raw) => (raw ? data : Credentials.takeStudent(data)),
        afterSave: (saved, raw) => { if (!raw) Credentials.finishStudent(saved); },
        actions: [{ name: 'logins', label: 'Logins', cls: 'btn-info', show: () => Session.isAdmin(), run: (s) => Credentials.manageStudent(s) }],
        deleteGuard: (s) => (DB.all('issues').some(i => i.memberType === 'student' && String(i.memberId) === String(s.id) && !i.returnDate) ? 'Return this student\'s library books before deleting.' : null),
        afterDelete: (s) => {
            // keep the other pages consistent: remove everything that belongs to this student
            DB.removeWhere('marks', m => m.studentId === s.id);
            DB.removeWhere('studentFees', f => f.studentId === s.id);
            DB.removeWhere('payments', p => p.studentId === s.id);
            DB.removeWhere('submissions', x => x.studentId === s.id);
            DB.removeWhere('issues', i => i.memberType === 'student' && i.memberId === s.id);
            DB.removeWhere('users', u => ['student', 'parent'].includes(u.role) && u.studentId === s.id); // their logins
            DB.save('attendance', DB.all('attendance').map(a => { // take them out of the saved attendance sheets
                if (!a.records[s.id]) return a;
                const records = { ...a.records };
                delete records[s.id];
                return { ...a, records };
            }));
        }
    });
}

Pages.students = Crud.page({ title: 'Student Management', make: () => [makeStudentsCrud()] });

/* ---------- Student profile ---------- */
const StudentProfile = {
    info(label, value) { return `<div class="info-item"><small>${esc(label)}</small><div>${value === '' || value == null ? '—' : esc(value)}</div></div>`; },

    render(id) {
        const s = DB.find('students', id);
        if (!s) return '<div class="card"><div class="empty-state"><div class="empty-state-icon">🎓</div><div class="empty-state-title">Student not found</div><a class="btn btn-primary" href="#/students">Back to students</a></div></div>';
        const me = Session.student();
        if (Session.isFamily() && (!me || me.id !== s.id)) return '<div class="card"><div class="empty-state"><div class="empty-state-title">You can only view your own profile.</div></div></div>';

        const att = Attendance.studentStats(s.id);
        const feeRows = FeeService.rowsForStudent(s.id);
        const due = feeRows.reduce((t, f) => t + f.due, 0);
        const loans = DB.all('issues').filter(i => i.memberType === 'student' && i.memberId === s.id);
        const exams = ResultService.examsFor(s.id, { publishedOnly: Session.isFamily() });

        const overview = `
            <div class="info-grid">
                ${this.info('Student ID', s.studentId)}${this.info('Roll number', s.rollNo)}${this.info('Registration no.', s.regNo)}
                ${this.info('Class', Lookup.classLabel(s.classId))}${this.info('Session', s.session)}${this.info('Admission date', D.fmt(s.admissionDate))}
                ${this.info('Gender', s.gender)}${this.info('Date of birth', D.fmt(s.dob))}${this.info('Phone', s.phone)}
                ${this.info('Email', s.email)}${this.info('Address', s.address)}
            </div>
            <h4 class="mt-3 mb-2">Guardian information</h4>
            <div class="info-grid">${this.info('Name', s.guardianName)}${this.info('Relation', s.guardianRelation)}${this.info('Phone', s.guardianPhone)}${this.info('Email', s.guardianEmail)}</div>`;

        const attendance = `
            <div class="summary-row">
                <div class="summary-item"><small>Attendance</small><strong>${Fmt.pct(att.pct)}</strong></div>
                ${Attendance.STATUSES.map(k => `<div class="summary-item"><small>${k}</small><strong>${att.counts[k]}</strong></div>`).join('')}
            </div>
            <div class="table-container"><table><thead><tr><th>Date</th><th>Day</th><th>Status</th></tr></thead><tbody>
                ${att.history.slice(0, 10).map(h => `<tr><td>${D.fmt(h.date)}</td><td>${D.dayName(h.date)}</td><td>${Badge.html(h.status)}</td></tr>`).join('') || '<tr><td colspan="3" class="text-center">No attendance recorded yet</td></tr>'}
            </tbody></table></div><p class="text-small mt-1">Showing the latest 10 days. Present + Late count as attended; Excused days are not counted.</p>`;

        const results = exams.length ? `<div class="table-container"><table><thead><tr><th>Exam</th><th>Total</th><th>Percentage</th><th>GPA</th><th>Grade</th><th>Result</th><th></th></tr></thead><tbody>
            ${exams.map(({ exam, result: r }) => `<tr><td>${esc(exam.name)} ${exam.published ? '' : Badge.html('Unpublished', 'warning')}</td>
                <td>${r.complete ? `${r.totalObtained} / ${r.totalMax}` : '—'}</td><td>${r.complete ? Fmt.pct(r.percent) : '—'}</td><td>${r.complete ? r.gpa.toFixed(2) : '—'}</td>
                <td>${r.complete ? Badge.html(r.grade) : '—'}</td><td>${r.complete ? Badge.html(r.passed ? 'Pass' : 'Fail') : 'Incomplete'}</td>
                <td><button type="button" class="btn btn-small btn-outline" data-marksheet="${exam.id}">Marksheet</button></td></tr>`).join('')}
            </tbody></table></div>` : '<div class="empty-state"><div class="empty-state-icon">📝</div><div class="empty-state-title">No results available</div></div>';

        const fees = feeRows.length ? `<div class="table-container"><table><thead><tr><th>Fee</th><th>Period</th><th>Net</th><th>Paid</th><th>Due</th><th>Status</th></tr></thead><tbody>
            ${feeRows.map(f => `<tr><td>${esc(f.feeTypeName)}</td><td>${esc(f.period)}</td><td>${Fmt.money(f.net)}</td><td>${Fmt.money(f.paid)}</td><td>${Fmt.money(f.due)}</td><td>${Badge.html(f.status)}</td></tr>`).join('')}
            </tbody></table></div>` : '<div class="empty-state"><div class="empty-state-title">No fees assigned</div></div>';

        const library = loans.length ? `<div class="table-container"><table><thead><tr><th>Book</th><th>Issued</th><th>Due</th><th>Status</th></tr></thead><tbody>
            ${loans.map(i => { const st = LibraryService.status(i); return `<tr><td>${esc(DB.find('books', i.bookId)?.title || 'Removed book')}</td><td>${D.fmt(i.issueDate)}</td><td>${D.fmt(i.dueDate)}</td><td>${Badge.html(st)}</td></tr>`; }).join('')}
            </tbody></table></div>` : '<div class="empty-state"><div class="empty-state-title">No library records</div></div>';

        return `
        <div class="card" id="profile-root">
            <div class="profile-header">
                ${s.photo ? `<img class="profile-photo" src="${esc(s.photo)}" alt="Photo of ${esc(s.name)}">` : Avatar.html(s.name, '', 110)}
                <div class="profile-title">
                    <h2>${esc(s.name)}</h2>
                    <p class="text-small">${esc(s.studentId)} &bull; ${esc(Lookup.classLabel(s.classId))} &bull; Roll ${esc(s.rollNo)}</p>
                    <p>${Badge.html(s.status)}</p>
                </div>
                <div class="profile-stats">
                    <div class="summary-item"><small>Attendance</small><strong>${Fmt.pct(att.pct)}</strong></div>
                    <div class="summary-item"><small>Fees due</small><strong>${Fmt.money(due)}</strong></div>
                </div>
                <div class="btn-group">
                    ${Session.isStaff() ? '<a class="btn btn-outline" href="#/students">&larr; Students</a>' : ''}
                    <button type="button" class="btn btn-outline" data-print-profile>Print profile</button>
                </div>
            </div>
            ${Tabs.markup([['overview', 'Overview'], ['attendance', 'Attendance'], ['results', 'Results'], ['fees', 'Fees'], ['library', 'Library']], 'overview')}
            <div class="tab-content active" data-panel="overview">${overview}</div>
            <div class="tab-content" data-panel="attendance">${attendance}</div>
            <div class="tab-content" data-panel="results">${results}</div>
            <div class="tab-content" data-panel="fees">${fees}</div>
            <div class="tab-content" data-panel="library">${library}</div>
        </div>`;
    },

    init(id) {
        const root = document.getElementById('profile-root');
        if (!root) return;
        Tabs.bind(root);
        root.querySelector('[data-print-profile]').onclick = () => {
            const s = DB.find('students', id);
            Print.open(`Student Profile - ${s.name}`, root.querySelector('[data-panel="overview"]').innerHTML);
        };
        root.querySelectorAll('[data-marksheet]').forEach(b => b.addEventListener('click', () => ResultService.showMarksheet(b.dataset.marksheet, id)));
    }
};

Pages['student-profile'] = {
    title: 'Student Profile', nav: 'students',
    render: (id) => StudentProfile.render(id),
    init: (id) => StudentProfile.init(id)
};

// "My profile" for the student / parent logins
Pages.profile = {
    title: 'Profile',
    render() { const s = Session.student(); return s ? StudentProfile.render(s.id) : '<div class="card"><div class="empty-state"><div class="empty-state-title">No student record is linked to this account.</div></div></div>'; },
    init() { const s = Session.student(); if (s) StudentProfile.init(s.id); }
};

console.log('Students module initialized');
