/**
 * users.js - Manage login accounts: name, email, password, role and the student/teacher
 * record each login is linked to (so editing a student's email never breaks their login).
 * Frontend-only demo authentication - NOT suitable for production security.
 */
function makeUsersCrud() {
    const admins = () => DB.all('users').filter(u => u.role === 'admin');
    return Crud.create({
        collection: 'users', title: 'Login Accounts', singular: 'Account', plural: 'accounts', defaultSort: 'name',
        searchKeys: ['name', 'email', 'role', 'linkedTo'], label: (u) => u.email,
        rows: () => DB.all('users').map(u => ({ ...u, linkedTo: u.role === 'teacher' ? Lookup.teacherName(u.teacherId) : ['student', 'parent'].includes(u.role) ? Lookup.studentName(u.studentId) : '—' })),
        filters: [{ key: 'role', label: 'Roles', options: () => [{ value: 'admin', label: 'Administrator' }, { value: 'teacher', label: 'Teacher' }, { value: 'student', label: 'Student' }, { value: 'parent', label: 'Parent' }] }],
        columns: [
            { key: 'name', label: 'Name' }, { key: 'email', label: 'Login ID' },
            { key: 'role', label: 'Role', render: (u) => Badge.html(Auth.getRoleDisplayName(u.role), 'primary'), text: (u) => u.role },
            { key: 'linkedTo', label: 'Linked record', render: (u) => (u.role === 'parent' ? `Parent of ${esc(u.linkedTo)}` : esc(u.linkedTo)), text: (u) => u.linkedTo }
        ],
        fields: [
            { name: 'name', label: 'Full name', required: true },
            { name: 'email', label: 'Login ID (email or username)', required: true },
            { name: 'password', label: 'Password (min 6 characters)', type: 'password', required: true },
            { name: 'role', label: 'Role', type: 'select', required: true, options: [{ value: 'admin', label: 'Administrator' }, { value: 'teacher', label: 'Teacher' }, { value: 'student', label: 'Student' }, { value: 'parent', label: 'Parent' }] },
            { name: 'teacherId', label: 'Linked teacher (Teacher role)', type: 'select', ref: true, options: () => Lookup.teacherOptions() },
            { name: 'studentId', label: 'Linked student (Student / Parent role)', type: 'select', ref: true, options: () => Lookup.studentOptions() }
        ],
        defaults: () => ({ role: 'teacher' }),
        validate: (d, raw) => {
            const e = {};
            if (DB.all('users').some(u => u.email.toLowerCase() === d.email.toLowerCase() && (!raw || u.id !== raw.id))) e.email = 'This login ID is already used by another account';
            if (String(d.password).length < 6) e.password = 'Password must be at least 6 characters';
            if (d.role === 'teacher' && !d.teacherId) e.teacherId = 'Choose the teacher this login belongs to';
            if (['student', 'parent'].includes(d.role) && !d.studentId) e.studentId = 'Choose the student this login belongs to';
            if (raw && raw.role === 'admin' && d.role !== 'admin' && admins().length === 1) e.role = 'Keep at least one administrator';
            return e;
        },
        beforeSave: (d) => ({ ...d, teacherId: d.role === 'teacher' ? d.teacherId : '', studentId: ['student', 'parent'].includes(d.role) ? d.studentId : '' }),
        deleteGuard: (u) => {
            const me = Session.user();
            if (me && me.id === u.id) return 'You cannot delete the account you are logged in with.';
            if (u.role === 'admin' && admins().length === 1) return 'You cannot delete the only administrator.';
            return null;
        },
        afterSave: (saved) => { // keep the open session in sync if you edited your own account
            const me = Session.user();
            if (me && me.id === saved.id) { Store.set('currentUser', Auth.sessionFor(saved)); App.renderNav(); }
        }
    });
}

Pages.users = Crud.page({
    title: 'Users & Logins', make: () => [makeUsersCrud()],
    before: '<div class="notice-banner"><strong>Demo security:</strong> passwords are stored as plain text in this browser. Frontend-only login is NOT suitable for production.</div>'
});

console.log('Users module initialized');
