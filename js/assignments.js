/**
 * assignments.js - Teachers create assignments (class, subject, deadline, description).
 * Students and parents see their class's assignments with a status: Pending / Submitted / Overdue.
 * A student can press "Mark submitted" (demo of a submission).
 */
const AssignmentService = {
    submission(assignmentId, studentId) { return DB.all('submissions').find(s => s.assignmentId === assignmentId && s.studentId === studentId) || null; },

    statusFor(a, studentId) {
        const sub = this.submission(a.id, studentId);
        if (sub) return sub.submittedAt > a.deadline ? 'Submitted (late)' : 'Submitted';
        return a.deadline < D.today() ? 'Overdue' : 'Pending';
    },

    // Assignments the logged-in user may see
    visible() {
        const all = DB.all('assignments');
        if (!Session.isFamily()) return all;
        const me = Session.student();
        return me ? all.filter(a => a.classId === me.classId) : [];
    },

    pendingFor(studentId) {
        const s = DB.find('students', studentId);
        return s ? DB.all('assignments').filter(a => a.classId === s.classId && !this.submission(a.id, s.id) && a.deadline >= D.today()) : [];
    }
};

function makeAssignmentsCrud() {
    const me = () => Session.student();
    const family = () => Session.isFamily();
    return Crud.create({
        collection: 'assignments', title: family() ? 'My Assignments' : 'Assignments', singular: 'Assignment', plural: 'assignments', defaultSort: 'deadline', defaultDir: 'desc',
        writeRoles: ['admin', 'teacher'],
        searchKeys: ['title', 'subjectName', 'classLabel', 'teacherName'], label: (a) => a.title,
        canEditRow: (a) => Session.isAdmin() || (Session.teacher() && a.teacherId === Session.teacher().id),
        rows: () => AssignmentService.visible().map(a => {
            const total = DB.all('students').filter(s => s.classId === a.classId && s.status === 'Active').length;
            const done = DB.all('submissions').filter(s => s.assignmentId === a.id).length;
            return { ...a, classLabel: Lookup.classLabel(a.classId), subjectName: Lookup.subjectName(a.subjectId), teacherName: Lookup.teacherName(a.teacherId),
                state: a.deadline < D.today() ? 'Closed' : 'Open', progress: `${done} / ${total}`, progressValue: total ? done / total : 0,
                myStatus: me() ? AssignmentService.statusFor(a, me().id) : '' };
        }),
        filters: [
            { key: 'classId', label: 'Classes', options: () => Lookup.classOptions() },
            { key: 'subjectId', label: 'Subjects', options: () => Lookup.subjectOptions() },
            family() ? { key: 'myStatus', label: 'My status', options: () => ['Pending', 'Submitted', 'Submitted (late)', 'Overdue'] }
                : { key: 'state', label: 'States', options: () => ['Open', 'Closed'] }
        ],
        columns: () => [
            { key: 'title', label: 'Assignment', render: (a) => `<strong>${esc(a.title)}</strong><br><small class="text-small">${esc(a.subjectName)}${family() ? '' : ' &bull; ' + esc(a.classLabel)}</small>`, text: (a) => `${a.title} (${a.subjectName})` },
            { key: 'teacherName', label: 'Teacher', cls: 'hide-on-mobile' },
            { key: 'assignedDate', label: 'Assigned', cls: 'hide-on-mobile', render: (a) => D.fmt(a.assignedDate), text: (a) => a.assignedDate },
            { key: 'deadline', label: 'Deadline', render: (a) => D.fmt(a.deadline), text: (a) => a.deadline },
            family()
                ? { key: 'myStatus', label: 'My status', render: (a) => Badge.html(a.myStatus, a.myStatus.startsWith('Submitted') ? 'success' : Badge.type(a.myStatus)) }
                : { key: 'progress', label: 'Submitted', sortValue: (a) => a.progressValue },
            { key: 'state', label: 'State', render: (a) => Badge.html(a.state, a.state === 'Open' ? 'success' : 'secondary') }
        ],
        onView: (a) => Modal.document(a.title, `<div class="doc-meta"><div><strong>Class:</strong> ${esc(a.classLabel)}<br><strong>Subject:</strong> ${esc(a.subjectName)}</div>
            <div><strong>Teacher:</strong> ${esc(a.teacherName)}<br><strong>Deadline:</strong> ${esc(D.fmt(a.deadline))}</div></div><p style="white-space:pre-wrap">${esc(a.description)}</p>`, { size: '' }),
        actions: () => [
            { name: 'submit', label: 'Mark submitted', cls: 'btn-success', show: (a) => Session.role() === 'student' && !a.myStatus.startsWith('Submitted'),
              run: (a, api) => { DB.insert('submissions', { assignmentId: a.id, studentId: me().id, status: 'Submitted', submittedAt: D.today() }); UI.toast('Marked as submitted', 'success'); api.refresh(); } },
            { name: 'subs', label: 'Submissions', cls: 'btn-info', show: () => Session.isStaff(), run: (a) => AssignmentsUI.showSubmissions(a) }
        ],
        fields: [
            { name: 'title', label: 'Title', required: true, full: true },
            { name: 'classId', label: 'Class', type: 'select', ref: true, required: true, options: () => Lookup.classOptions() },
            { name: 'subjectId', label: 'Subject', type: 'select', ref: true, required: true, options: () => Lookup.subjectOptions() },
            { name: 'assignedDate', label: 'Assigned on', type: 'date', required: true },
            { name: 'deadline', label: 'Deadline', type: 'date', required: true },
            { name: 'description', label: 'Description', type: 'textarea', required: true, full: true }
        ],
        defaults: () => ({ assignedDate: D.today(), deadline: D.addDays(D.today(), 7) }),
        validate: (d) => (d.deadline < d.assignedDate ? { deadline: 'Deadline cannot be before the assigned date' } : {}),
        beforeSave: (d, raw) => {
            if (raw) return d;
            const t = Session.teacher();
            const taught = DB.all('teaching').find(x => x.classId === d.classId && x.subjectId === d.subjectId);
            return { ...d, teacherId: t ? t.id : taught ? taught.teacherId : '' };
        },
        afterDelete: (a) => DB.removeWhere('submissions', s => s.assignmentId === a.id)
    });
}

const AssignmentsUI = {
    showSubmissions(a) {
        const students = DB.all('students').filter(s => s.classId === a.classId && s.status === 'Active').sort((x, y) => x.rollNo - y.rollNo);
        const rows = students.map(s => { const st = AssignmentService.statusFor(a, s.id); const sub = AssignmentService.submission(a.id, s.id);
            return `<tr><td>${esc(s.rollNo)}</td><td>${esc(s.name)}</td><td>${Badge.html(st, st.startsWith('Submitted') ? 'success' : undefined)}</td><td>${sub ? esc(D.fmt(sub.submittedAt)) : '—'}</td></tr>`; }).join('');
        Modal.document(`Submissions - ${a.title}`, `<p class="text-small">${esc(Lookup.classLabel(a.classId))} &bull; deadline ${esc(D.fmt(a.deadline))}</p>
            <table><thead><tr><th>Roll</th><th>Student</th><th>Status</th><th>Submitted on</th></tr></thead><tbody>${rows || '<tr><td colspan="4">No students</td></tr>'}</tbody></table>`);
    }
};

Pages.assignments = Crud.page({ title: 'Assignments', make: () => [makeAssignmentsCrud()] });

console.log('Assignments module initialized');
