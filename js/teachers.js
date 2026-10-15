/**
 * teachers.js - Teacher and staff management.
 * Both pages share the same helper (People.profile) and the same field layout.
 */
const People = {
    profile(title, person, rows) {
        const items = rows.map(([label, value]) => `<div class="info-item"><small>${esc(label)}</small><div>${value === '' || value == null ? '—' : esc(value)}</div></div>`).join('');
        Modal.document(title, `<div class="profile-header">${person.photo ? `<img class="profile-photo" src="${esc(person.photo)}" alt="">` : Avatar.html(person.name, '', 90)}
            <div><h3>${esc(person.name)}</h3><p class="text-small">${esc(person.empId)} &bull; ${esc(person.designation)}</p>${Badge.html(person.status)}</div></div>
            <div class="info-grid mt-2">${items}</div>`, { printTitle: `${title} - ${person.name}` });
    },
    nextEmpId(collection, prefix) { return `${prefix}-${pad(DB.peekId(collection))}`; },
    validate(collection) {
        return (data, raw) => {
            const errors = {};
            const others = DB.all(collection).filter(p => !raw || p.id !== raw.id);
            if (data.email && others.some(p => (p.email || '').toLowerCase() === data.email.toLowerCase())) errors.email = 'This email is already used';
            if (data.joiningDate && data.joiningDate > D.today()) errors.joiningDate = 'Joining date cannot be in the future';
            return errors;
        };
    }
};

function makeTeachersCrud() {
    const classesOf = (t) => DB.all('classes').filter(c => c.classTeacherId === t.id).map(c => `${c.name} - ${c.section}`).join(', ');
    return Crud.create({
        collection: 'teachers', title: 'Teachers', singular: 'Teacher', plural: 'teachers', defaultSort: 'empId',
        searchKeys: ['name', 'empId', 'subjectName', 'email', 'phone', 'designation'],
        label: (t) => t.name,
        rows: () => DB.all('teachers').map(t => ({ ...t, subjectName: Lookup.subjectName(t.subjectId), classTeacherOf: classesOf(t) })),
        filters: [
            { key: 'subjectId', label: 'Subjects', options: () => Lookup.subjectOptions() },
            { key: 'designation', label: 'Designations', options: () => ['Head of Department', 'Senior Teacher', 'Assistant Teacher', 'Teacher', 'Sports Teacher', 'Art Teacher'] },
            { key: 'status', label: 'Statuses', options: () => ['Active', 'On leave', 'Inactive'] }
        ],
        columns: [
            { key: 'name', label: 'Teacher', render: (t) => `<span class="person">${Avatar.html(t.name, t.photo)}<span><strong>${esc(t.name)}</strong><small>${esc(t.email)}</small></span></span>` },
            { key: 'empId', label: 'Employee ID' },
            { key: 'subjectName', label: 'Subject' },
            { key: 'classTeacherOf', label: 'Class teacher of', render: (t) => esc(t.classTeacherOf || '—') },
            { key: 'designation', label: 'Designation', cls: 'hide-on-mobile' },
            { key: 'phone', label: 'Phone', cls: 'hide-on-mobile' },
            { key: 'joiningDate', label: 'Joined', render: (t) => D.fmt(t.joiningDate), text: (t) => D.fmt(t.joiningDate) },
            { key: 'status', label: 'Status', render: (t) => Badge.html(t.status) }
        ],
        onView: (t) => People.profile('Teacher profile', t, [['Employee ID', t.empId], ['Subject', t.subjectName], ['Class teacher of', t.classTeacherOf], ['Designation', t.designation], ['Qualification', t.qualification], ['Phone', t.phone], ['Email', t.email], ['Joining date', D.fmt(t.joiningDate)], ['Gender', t.gender], ['Address', t.address]]),
        fields: (raw) => [
            { name: 'photo', label: 'Photo', type: 'photo', full: true },
            { name: 'name', label: 'Full name', required: true },
            ...(raw ? [{ name: 'empId', label: 'Employee ID', readonly: true }] : []),
            { name: 'gender', label: 'Gender', type: 'select', required: true, options: ['Male', 'Female', 'Other'] },
            { name: 'subjectId', label: 'Main subject', type: 'select', ref: true, required: true, options: () => Lookup.subjectOptions() },
            { name: 'designation', label: 'Designation', type: 'select', required: true, options: ['Head of Department', 'Senior Teacher', 'Assistant Teacher', 'Teacher', 'Sports Teacher', 'Art Teacher'] },
            { name: 'qualification', label: 'Qualification' },
            { name: 'phone', label: 'Phone', type: 'tel', required: true },
            { name: 'email', label: 'Email', type: 'email', required: true },
            { name: 'joiningDate', label: 'Joining date', type: 'date', required: true },
            { name: 'status', label: 'Status', type: 'select', required: true, options: ['Active', 'On leave', 'Inactive'] },
            { name: 'address', label: 'Address', type: 'textarea', full: true },
            ...(raw ? [] : Credentials.teacherFields())
        ],
        defaults: () => ({ status: 'Active', gender: 'Male', designation: 'Teacher', joiningDate: D.today() }),
        validate: (d, raw) => ({ ...People.validate('teachers')(d, raw), ...(raw ? {} : Credentials.validateTeacher(d)) }),
        beforeSave: (data, raw) => (raw ? data : Credentials.takeTeacher({ ...data, empId: People.nextEmpId('teachers', 'TCH') })),
        afterSave: (saved, raw) => { if (!raw) Credentials.finishTeacher(saved); },
        actions: [{ name: 'logins', label: 'Login', cls: 'btn-info', show: () => Session.isAdmin(), run: (t) => Credentials.manageTeacher(t) }],
        deleteGuard: (t) => (DB.all('issues').some(i => i.memberType === 'teacher' && i.memberId === t.id && !i.returnDate) ? 'This teacher still has library books. Return them first.' : null),
        deleteWarning: (t) => {
            const classes = DB.all('classes').filter(c => c.classTeacherId === t.id).length;
            const periods = DB.all('routine').filter(r => r.teacherId === t.id).length;
            const notes = [];
            if (classes) notes.push(`${classes} class(es) will have no class teacher`);
            if (periods) notes.push(`${periods} timetable period(s) will become free`);
            return notes.length ? `Also: ${notes.join(', ')}.` : '';
        },
        afterDelete: (t) => { // keep every other page consistent
            DB.all('classes').filter(c => c.classTeacherId === t.id).forEach(c => DB.update('classes', c.id, { classTeacherId: '' }));
            DB.removeWhere('teaching', x => x.teacherId === t.id);
            DB.removeWhere('routine', r => r.teacherId === t.id);
            DB.all('assignments').filter(x => x.teacherId === t.id).forEach(x => DB.update('assignments', x.id, { teacherId: '' }));
            DB.removeWhere('users', u => u.role === 'teacher' && u.teacherId === t.id); // their login
            DB.removeWhere('issues', i => i.memberType === 'teacher' && i.memberId === t.id); // their (returned) library history
        }
    });
}

function makeStaffCrud() {
    return Crud.create({
        collection: 'staff', title: 'Staff', singular: 'Staff member', plural: 'staff members', defaultSort: 'empId',
        searchKeys: ['name', 'empId', 'designation', 'department', 'phone', 'email'],
        label: (s) => s.name,
        filters: [
            { key: 'department', label: 'Departments', options: () => ['Accounts', 'Administration', 'Library', 'Science Lab', 'Security', 'Health Room', 'Maintenance'] },
            { key: 'status', label: 'Statuses', options: () => ['Active', 'On leave', 'Inactive'] }
        ],
        columns: [
            { key: 'name', label: 'Name', render: (s) => `<span class="person">${Avatar.html(s.name, s.photo)}<span><strong>${esc(s.name)}</strong><small>${esc(s.email)}</small></span></span>` },
            { key: 'empId', label: 'Employee ID' },
            { key: 'designation', label: 'Designation' },
            { key: 'department', label: 'Department' },
            { key: 'phone', label: 'Phone', cls: 'hide-on-mobile' },
            { key: 'joiningDate', label: 'Joined', render: (s) => D.fmt(s.joiningDate), text: (s) => D.fmt(s.joiningDate) },
            { key: 'status', label: 'Status', render: (s) => Badge.html(s.status) }
        ],
        onView: (s) => People.profile('Staff profile', s, [['Employee ID', s.empId], ['Department', s.department], ['Designation', s.designation], ['Phone', s.phone], ['Email', s.email], ['Joining date', D.fmt(s.joiningDate)], ['Gender', s.gender], ['Address', s.address]]),
        fields: (raw) => [
            { name: 'photo', label: 'Photo', type: 'photo', full: true },
            { name: 'name', label: 'Full name', required: true },
            ...(raw ? [{ name: 'empId', label: 'Employee ID', readonly: true }] : []),
            { name: 'gender', label: 'Gender', type: 'select', required: true, options: ['Male', 'Female', 'Other'] },
            { name: 'designation', label: 'Designation', required: true },
            { name: 'department', label: 'Department', type: 'select', required: true, options: ['Accounts', 'Administration', 'Library', 'Science Lab', 'Security', 'Health Room', 'Maintenance'] },
            { name: 'phone', label: 'Phone', type: 'tel', required: true },
            { name: 'email', label: 'Email', type: 'email' },
            { name: 'joiningDate', label: 'Joining date', type: 'date', required: true },
            { name: 'status', label: 'Status', type: 'select', required: true, options: ['Active', 'On leave', 'Inactive'] },
            { name: 'address', label: 'Address', type: 'textarea', full: true }
        ],
        defaults: () => ({ status: 'Active', gender: 'Male', joiningDate: D.today() }),
        validate: People.validate('staff'),
        beforeSave: (data, raw) => (raw ? data : { ...data, empId: People.nextEmpId('staff', 'STF') })
    });
}

Pages.teachers = Crud.page({ title: 'Teacher Management', make: () => [makeTeachersCrud()] });
Pages.staff = Crud.page({ title: 'Staff Management', make: () => [makeStaffCrud()] });

console.log('Teachers module initialized');
