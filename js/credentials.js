/**
 * credentials.js - Login accounts that are created together with new records.
 * The admin TYPES every login ID and password (nothing is generated automatically):
 *   new teacher -> teacher login
 *   new student -> student login + a separate parent login linked to that student
 * Frontend-only demo authentication - NOT suitable for production security.
 */
const Credentials = {
    pending: null,

    taken(login, exceptId) { return DB.all('users').some(u => String(u.email).toLowerCase() === String(login).toLowerCase() && u.id !== exceptId); },
    nextStudentCode() { return `STU-${D.today().slice(0, 4)}${pad(DB.peekId('students'))}`; },
    addUser({ name, login, password, role, studentId = '', teacherId = '' }) { return DB.insert('users', { name, email: login, password, role, studentId, teacherId }); },
    userFor(role, key, id) { return DB.all('users').find(u => u.role === role && u[key] === id); },

    // Checks the typed login IDs / passwords. `p` = { studentLogin, studentPassword, parentLogin, parentPassword, teacherLogin, loginPassword }
    check(p) {
        const e = {}, ids = [];
        const id = (field, value) => {
            if (!value) return;
            if (this.taken(value)) e[field] = 'This login ID is already used';
            else if (ids.includes(String(value).toLowerCase())) e[field] = 'Login IDs must be different from each other';
            ids.push(String(value).toLowerCase());
        };
        const pw = (field, value) => { if (value !== undefined && String(value).length < 6) e[field] = 'At least 6 characters'; };
        if ('studentLogin' in p) { id('studentLogin', p.studentLogin); pw('studentPassword', p.studentPassword); }
        if ('parentLogin' in p) { id('parentLogin', p.parentLogin); pw('parentPassword', p.parentPassword); }
        if ('teacherLogin' in p) { id('teacherLogin', p.teacherLogin); pw('loginPassword', p.loginPassword); }
        return e;
    },

    studentFields(roles = ['student', 'parent']) {
        return [
            ...(roles.includes('student') ? [
                { name: 'studentLogin', label: 'Student login ID', required: true, placeholder: 'e.g. alice2026' },
                { name: 'studentPassword', label: 'Student login password', required: true, placeholder: 'min 6 characters' }] : []),
            ...(roles.includes('parent') ? [
                { name: 'parentLogin', label: 'Parent login ID', required: true, placeholder: 'e.g. alice.parent' },
                { name: 'parentPassword', label: 'Parent login password', required: true, placeholder: 'min 6 characters' }] : [])
        ];
    },
    teacherFields() {
        return [
            { name: 'teacherLogin', label: 'Login ID (email or username)', required: true },
            { name: 'loginPassword', label: 'Login password', required: true, placeholder: 'min 6 characters' }
        ];
    },

    /* ---------- Student + parent ---------- */
    validateStudent(d) { return this.check({ studentLogin: d.studentLogin, studentPassword: d.studentPassword, parentLogin: d.parentLogin, parentPassword: d.parentPassword }); },
    takeStudent(data) { // keeps the login fields out of the student record
        const { studentLogin, studentPassword, parentLogin, parentPassword, ...rest } = data;
        this.pending = { studentLogin, studentPassword, parentLogin, parentPassword };
        return { ...rest, studentId: this.nextStudentCode() };
    },
    createStudentLogins(student, p) {
        if (p.studentLogin) this.addUser({ name: student.name, login: p.studentLogin, password: p.studentPassword, role: 'student', studentId: student.id });
        if (p.parentLogin) this.addUser({ name: student.guardianName || `Parent of ${student.name}`, login: p.parentLogin, password: p.parentPassword, role: 'parent', studentId: student.id });
    },
    studentRows(student) { return DB.all('users').filter(u => u.studentId === student.id && ['student', 'parent'].includes(u.role)).sort((a, b) => b.role.localeCompare(a.role)); },
    finishStudent(student) {
        this.createStudentLogins(student, this.pending || {});
        this.pending = null;
        this.show(`Logins created - ${student.name}`, this.studentRows(student));
    },
    // "Logins" button: shows existing logins; asks for the missing ones
    manageStudent(student) {
        const missing = ['student', 'parent'].filter(r => !this.userFor(r, 'studentId', student.id));
        if (!missing.length) { this.show(`Login details - ${student.name}`, this.studentRows(student)); return; }
        Modal.form({
            title: `Create ${missing.join(' & ')} login - ${student.name}`, fields: this.studentFields(missing), size: '', submitText: 'Create login',
            onSubmit: (data, m) => {
                const errors = this.check(data);
                if (Object.keys(errors).length) { Form.showErrors(m.el.querySelector('form'), errors); return false; }
                this.createStudentLogins(student, data);
                this.show(`Login details - ${student.name}`, this.studentRows(student));
            }
        });
    },

    /* ---------- Teacher ---------- */
    validateTeacher(d) { return this.check({ teacherLogin: d.teacherLogin, loginPassword: d.loginPassword }); },
    takeTeacher(data) { const { teacherLogin, loginPassword, ...rest } = data; this.pending = { teacherLogin, loginPassword }; return rest; },
    teacherRows(t) { return DB.all('users').filter(u => u.role === 'teacher' && u.teacherId === t.id); },
    finishTeacher(teacher) {
        const p = this.pending || {};
        this.pending = null;
        this.addUser({ name: teacher.name, login: p.teacherLogin, password: p.loginPassword, role: 'teacher', teacherId: teacher.id });
        this.show(`Login created - ${teacher.name}`, this.teacherRows(teacher));
    },
    manageTeacher(teacher) {
        if (this.teacherRows(teacher).length) { this.show(`Login details - ${teacher.name}`, this.teacherRows(teacher)); return; }
        Modal.form({
            title: `Create login - ${teacher.name}`, fields: this.teacherFields(), size: '', submitText: 'Create login',
            onSubmit: (data, m) => {
                const errors = this.check(data);
                if (Object.keys(errors).length) { Form.showErrors(m.el.querySelector('form'), errors); return false; }
                this.addUser({ name: teacher.name, login: data.teacherLogin, password: data.loginPassword, role: 'teacher', teacherId: teacher.id });
                this.show(`Login details - ${teacher.name}`, this.teacherRows(teacher));
            }
        });
    },

    /* ---------- Printable slip ---------- */
    show(title, users) {
        const rows = users.map(u => `<tr><td>${esc(Auth.getRoleDisplayName(u.role))}</td><td>${esc(u.name)}</td><td><strong>${esc(u.email)}</strong></td><td><strong>${esc(u.password)}</strong></td></tr>`).join('');
        Modal.document(title, `<table><thead><tr><th>Account</th><th>Name</th><th>Login ID</th><th>Password</th></tr></thead><tbody>${rows}</tbody></table>
            <p class="text-small">Sign in on the login page with the Login ID and Password above. A parent login only shows that student's information.
            Logins can be changed later in <em>Users &amp; Logins</em>.</p>`, { printTitle: title, size: '' });
    }
};

console.log('Credentials module initialized');
