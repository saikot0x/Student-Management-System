/**
 * data.js - The data layer.
 *  - DB:       tiny "database" on top of localStorage (all / find / insert / update / remove)
 *  - D, Fmt:   date and money helpers
 *  - Lookup:   turn ids into names (class label, teacher name ...)
 *  - Session:  who is logged in (and which student they belong to)
 *  - Seed:     realistic demo data created on first launch
 */
const pad = (n, w = 3) => String(n).padStart(w, '0');

/* ---------- Dates (all dates are stored as "YYYY-MM-DD" text) ---------- */
const D = {
    iso(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1, 2)}-${pad(d.getDate(), 2)}`; },
    today() { return D.iso(new Date()); },
    parse(iso) { const [y, m, d] = String(iso).split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); },
    addDays(iso, n) { const d = D.parse(iso); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); },
    diff(a, b) { return Math.round((D.parse(b) - D.parse(a)) / 86400000); }, // days from a to b
    fmt(iso) {
        if (!iso) return '—';
        return D.parse(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
    },
    monthLabel(ym) { return D.parse(ym + '-01').toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }); },
    weekday(iso) { return D.parse(iso).getUTCDay(); },
    dayName(iso) { return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][D.weekday(iso)]; },
    isWeekend(iso) { const w = D.weekday(iso); return w === 0 || w === 6; }
};

/* ---------- School settings ---------- */
const Settings = {
    get() { return Store.get('settings', {}); },
    save(patch) { const next = { ...this.get(), ...patch }; Store.set('settings', next); return next; },
    session() { return this.get().academicSession || String(new Date().getFullYear()); }
};

const Fmt = {
    money(n) {
        const c = Settings.get().currency || '$';
        return c + (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    },
    pct(n) { return n === null || n === undefined || Number.isNaN(n) ? '—' : (Math.round(n * 10) / 10).toFixed(1) + '%'; }
};

/* ---------- DB ---------- */
const DB = {
    _cache: {},
    clearCache() { this._cache = {}; },
    all(name) {
        if (!this._cache[name]) this._cache[name] = Store.get('db_' + name, []);
        return this._cache[name]; // do not modify this array directly - use insert/update/remove
    },
    save(name, rows) {
        this._cache[name] = rows;
        if (!Store.set('db_' + name, rows)) UI.toast('Could not save - browser storage may be full.', 'error');
    },
    find(name, id) { return this.all(name).find(r => String(r.id) === String(id)) || null; },
    peekId(name) { return Store.get('seq_' + name, 0) + 1; }, // the id the next insert will get
    insert(name, rec) { return this.insertMany(name, [rec])[0]; },
    insertMany(name, recs) {
        let id = Store.get('seq_' + name, 0);
        const rows = recs.map(r => ({ ...r, id: ++id, createdAt: new Date().toISOString() }));
        Store.set('seq_' + name, id);
        this.save(name, [...this.all(name), ...rows]);
        return rows;
    },
    update(name, id, patch) {
        let out = null;
        this.save(name, this.all(name).map(r => {
            if (String(r.id) !== String(id)) return r;
            out = { ...r, ...patch, id: r.id };
            return out;
        }));
        return out;
    },
    remove(name, id) { this.save(name, this.all(name).filter(r => String(r.id) !== String(id))); },
    removeWhere(name, fn) { this.save(name, this.all(name).filter(r => !fn(r))); },
    bulk(name, rows) { // used by the seed: replaces a whole collection
        const out = rows.map((r, i) => ({ ...r, id: r.id ?? i + 1 }));
        this.save(name, out);
        Store.set('seq_' + name, out.reduce((m, r) => Math.max(m, r.id), 0));
        return out;
    }
};

// Another browser tab changed the data: forget what this tab remembered so it never overwrites newer data
window.addEventListener('storage', () => DB.clearCache());

/* ---------- Lookups ---------- */
const Lookup = {
    classLabel(id) { const c = DB.find('classes', id); return c ? `${c.name} - ${c.section}` : '—'; },
    className(id) { const c = DB.find('classes', id); return c ? c.name : '—'; },
    section(id) { const c = DB.find('classes', id); return c ? c.section : '—'; },
    studentName(id) { const s = DB.find('students', id); return s ? s.name : 'Unknown student'; },
    teacherName(id) { const t = DB.find('teachers', id); return t ? t.name : '—'; },
    subjectName(id) { const s = DB.find('subjects', id); return s ? s.name : '—'; },
    feeTypeName(id) { const f = DB.find('feeTypes', id); return f ? f.name : '—'; },
    classOptions() { return DB.all('classes').map(c => ({ value: c.id, label: `${c.name} - ${c.section}` })); },
    studentOptions() { return DB.all('students').map(s => ({ value: s.id, label: `${s.name} (${s.studentId})` })); },
    teacherOptions() { return DB.all('teachers').map(t => ({ value: t.id, label: t.name })); },
    subjectOptions() { return DB.all('subjects').map(s => ({ value: s.id, label: s.name })); },
    feeTypeOptions() { return DB.all('feeTypes').map(f => ({ value: f.id, label: f.name })); },
    sessionOptions() { return DB.all('sessions').map(s => s.name); },
    examOptions() { return DB.all('exams').map(e => ({ value: e.id, label: e.name })); }
};

/* ---------- Who is logged in ---------- */
const Session = {
    user() { return Auth.getCurrentUser(); },
    role() { return Auth.getRole(); },
    isAdmin() { return this.role() === 'admin'; },
    isStaff() { return ['admin', 'teacher'].includes(this.role()); },
    isFamily() { return ['student', 'parent'].includes(this.role()); },
    // The student record linked to a student/parent login (matched by e-mail)
    student() {
        const u = this.user();
        if (!u || !this.isFamily()) return null;
        if (u.studentId) return DB.find('students', u.studentId);
        return DB.all('students').find(s => s.email === u.email || s.guardianEmail === u.email) || null;
    },
    teacher() {
        const u = this.user();
        if (!u) return null;
        if (u.teacherId) return DB.find('teachers', u.teacherId);
        return DB.all('teachers').find(t => t.email === u.email) || null;
    }
};

/* ---------- Demo data ---------- */
const Seed = {
    VERSION: 'v1',
    ensure() {
        if (Store.get('seedVersion') !== this.VERSION) this.run();
        else if (!Store.has('db_users')) this.seedUsers(); // upgrade: existing data is kept
    },
    seedUsers() {
        const link = { 'teacher@school.com': { teacherId: 2 }, 'student@school.com': { studentId: 1 }, 'parent@school.com': { studentId: 1 } };
        DB.bulk('users', Auth.DEMO_USERS.map(u => ({ name: u.name, email: u.email, password: u.password, role: u.role, studentId: '', teacherId: '', ...(link[u.email] || {}) })));
    },
    reset() {
        Store.getAllKeys().filter(k => k.startsWith('db_') || k.startsWith('seq_')).forEach(k => Store.remove(k));
        DB.clearCache();
        this.run();
    },
    run() {
        let seed = 20260;
        const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
        const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
        const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
        const today = D.today();
        const year = Number(today.slice(0, 4));
        DB.clearCache();

        Settings.save({
            schoolName: 'Greenfield Model School', schoolAddress: '45 Lake Road, Springfield',
            schoolPhone: '+1 555 0142', schoolEmail: 'office@greenfield.edu', currency: '$',
            academicSession: String(year), logo: ''
        });

        DB.bulk('sessions', [
            { name: String(year - 1), startDate: `${year - 1}-01-05`, endDate: `${year - 1}-12-20`, status: 'Closed' },
            { name: String(year), startDate: `${year}-01-05`, endDate: `${year}-12-20`, status: 'Active' }
        ]);

        const subjectDefs = [['ENG', 'English', 'Core'], ['MATH', 'Mathematics', 'Core'], ['SCI', 'General Science', 'Core'],
            ['SOC', 'Social Studies', 'Core'], ['ICT', 'Computer Studies', 'Core'], ['PE', 'Physical Education', 'Co-curricular'], ['ART', 'Art & Craft', 'Elective']];
        DB.bulk('subjects', subjectDefs.map(([code, name, category]) => ({ code, name, category, totalMarks: 100, passMarks: 33 })));

        // 7 teachers: teacher N teaches subject N
        const teacherDefs = [['Emily Brown', 'Female', 'Head of Department'], ['John Carter', 'Male', 'Senior Teacher'], ['Daniel Lee', 'Male', 'Senior Teacher'],
            ['Sophia Martinez', 'Female', 'Assistant Teacher'], ['Michael Chen', 'Male', 'Teacher'], ['Olivia Wilson', 'Female', 'Sports Teacher'], ['Liam Anderson', 'Male', 'Art Teacher']];
        DB.bulk('teachers', teacherDefs.map(([name, gender, designation], i) => ({
            empId: `TCH-${pad(i + 1)}`, name, gender, designation, subjectId: i + 1,
            email: i === 1 ? 'teacher@school.com' : `${name.toLowerCase().replace(' ', '.')}@greenfield.edu`,
            phone: `+1 555 01${pad(ri(0, 99), 2)}`, joiningDate: `${year - ri(1, 9)}-0${ri(1, 9)}-1${ri(0, 9)}`,
            qualification: pick(['B.Ed', 'M.Ed', 'M.Sc', 'B.A. (Hons)']), address: `${ri(10, 99)} Oak Avenue, Springfield`, status: 'Active', photo: ''
        })));

        DB.bulk('staff', [['Patricia Hughes', 'Accountant', 'Accounts'], ['George Fisher', 'Librarian', 'Library'], ['Linda Park', 'Office Assistant', 'Administration'],
            ['Raymond Cole', 'Lab Assistant', 'Science Lab'], ['Henry Brooks', 'Security Guard', 'Security'], ['Maria Gomez', 'School Nurse', 'Health Room']]
            .map(([name, designation, department], i) => ({
                empId: `STF-${pad(i + 1)}`, name, designation, department, gender: i % 2 ? 'Male' : 'Female',
                email: `${name.toLowerCase().replace(' ', '.')}@greenfield.edu`, phone: `+1 555 02${pad(ri(0, 99), 2)}`,
                joiningDate: `${year - ri(1, 8)}-0${ri(1, 9)}-0${ri(1, 9)}`, address: `${ri(10, 99)} Pine Street, Springfield`, status: 'Active', photo: ''
            })));

        const classDefs = [[6, 'A'], [7, 'A'], [8, 'A'], [8, 'B'], [9, 'A'], [9, 'B'], [10, 'A']];
        DB.bulk('classes', classDefs.map(([g, s], i) => ({
            name: `Class ${g}`, section: s, room: `Room ${101 + i}`, capacity: 40, classTeacherId: i + 1, session: String(year)
        })));

        const teaching = [];
        classDefs.forEach((_, ci) => subjectDefs.forEach((__, si) => teaching.push({ classId: ci + 1, subjectId: si + 1, teacherId: si + 1 })));
        DB.bulk('teaching', teaching);

        // Students: Alice (id 1) is the demo student account; her guardian is the demo parent account
        const boys = ['Liam', 'Noah', 'Ethan', 'Lucas', 'Mason', 'Logan', 'Aiden', 'Owen', 'James', 'Henry', 'Samuel', 'Ryan', 'Caleb', 'Isaac'];
        const girls = ['Emma', 'Ava', 'Mia', 'Zoe', 'Chloe', 'Grace', 'Lily', 'Nora', 'Ruby', 'Ella', 'Hannah', 'Layla', 'Maya', 'Ivy'];
        const lasts = ['Smith', 'Williams', 'Brown', 'Davis', 'Miller', 'Wilson', 'Moore', 'Taylor', 'Clark', 'Hall', 'Young', 'King', 'Wright', 'Scott', 'Green'];
        const dads = ['Robert', 'David', 'Thomas', 'Andrew', 'Paul', 'Mark'];
        const moms = ['Karen', 'Linda', 'Susan', 'Maria', 'Laura', 'Julie'];
        const students = [];
        const rolls = {};
        const addStudent = (o) => {
            const id = students.length + 1;
            rolls[o.classId] = (rolls[o.classId] || 0) + 1;
            const age = classDefs[o.classId - 1][0] + 5;
            students.push({
                id, studentId: `STU-${year}${pad(id)}`, regNo: `REG-${year}-${pad(id, 4)}`, rollNo: rolls[o.classId], session: String(year),
                dob: `${year - age}-${pad(ri(1, 12), 2)}-${pad(ri(1, 28), 2)}`, admissionDate: `${year - ri(0, 3)}-01-10`,
                phone: `+1 555 03${pad(ri(0, 99), 2)}`, address: `${ri(10, 99)} Maple Street, Springfield`, status: 'Active', photo: '', ...o
            });
        };
        addStudent({ classId: 3, name: 'Alice Johnson', gender: 'Female', email: 'student@school.com', guardianName: 'Robert Johnson', guardianRelation: 'Father', guardianPhone: '+1 555 0177', guardianEmail: 'parent@school.com' });
        classDefs.forEach((_, ci) => {
            const count = ci === 2 ? 5 : 6;
            for (let k = 0; k < count; k++) {
                const female = rnd() < 0.5;
                const first = pick(female ? girls : boys), last = pick(lasts);
                const father = rnd() < 0.6;
                addStudent({
                    classId: ci + 1, name: `${first} ${last}`, gender: female ? 'Female' : 'Male',
                    email: `${first}.${last}${students.length + 1}@students.greenfield.edu`.toLowerCase(),
                    guardianName: `${pick(father ? dads : moms)} ${last}`, guardianRelation: father ? 'Father' : 'Mother',
                    guardianPhone: `+1 555 04${pad(ri(0, 99), 2)}`, guardianEmail: '',
                });
                if (rnd() < 0.05) students[students.length - 1].status = 'Inactive';
            }
        });
        DB.bulk('students', students);

        // Attendance for the last 20 school days (Mon-Fri)
        const days = [];
        for (let cur = today; days.length < 20; cur = D.addDays(cur, -1)) if (!D.isWeekend(cur)) days.unshift(cur);
        const attendance = [];
        days.forEach(date => classDefs.forEach((_, ci) => {
            const classId = ci + 1;
            if (date === today && classId % 3 === 0) return; // a few classes not marked yet today
            const records = {};
            students.filter(s => s.classId === classId && s.status === 'Active').forEach(s => {
                const x = rnd();
                records[s.id] = x < 0.88 ? 'Present' : x < 0.93 ? 'Absent' : x < 0.97 ? 'Late' : 'Excused';
            });
            attendance.push({ date, classId, records, markedBy: 'Demo data' });
        }));
        DB.bulk('attendance', attendance);

        // Exams, schedule and marks
        DB.bulk('exams', [
            { name: 'Half Yearly Exam', session: String(year), startDate: D.addDays(today, -120), endDate: D.addDays(today, -112), status: 'Completed', published: true },
            { name: 'Unit Test 2', session: String(year), startDate: D.addDays(today, -30), endDate: D.addDays(today, -26), status: 'Completed', published: false },
            { name: 'Annual Exam', session: String(year), startDate: D.addDays(today, 45), endDate: D.addDays(today, 53), status: 'Scheduled', published: false }
        ]);
        const schedule = [];
        [1, 2, 3].forEach(examId => {
            const exam = DB.all('exams')[examId - 1];
            const total = examId === 2 ? 50 : 100;
            classDefs.forEach((_, ci) => [1, 2, 3, 4, 5].forEach(subjectId => schedule.push({
                examId, classId: ci + 1, subjectId, date: D.addDays(exam.startDate, (subjectId - 1) * 2),
                startTime: '10:00', duration: examId === 2 ? 60 : 120, totalMarks: total, passMarks: Math.ceil(total * 0.33)
            })));
        });
        DB.bulk('examSchedule', schedule);
        const ability = {};
        students.forEach(s => { ability[s.id] = s.id === 1 ? 84 : 38 + rnd() * 57; });
        const marks = [];
        [1, 2].forEach(examId => students.forEach(s => [1, 2, 3, 4, 5].forEach(subjectId => {
            const total = examId === 2 ? 50 : 100;
            const v = Math.round(((ability[s.id] + (rnd() - 0.5) * 30) / 100) * total);
            marks.push({ examId, studentId: s.id, subjectId, obtained: Math.max(0, Math.min(total, v)) });
        })));
        DB.bulk('marks', marks);

        // Fees
        DB.bulk('feeTypes', [
            { name: 'Tuition Fee', amount: 120, frequency: 'Monthly', description: 'Monthly tuition' },
            { name: 'Admission Fee', amount: 200, frequency: 'One-time', description: 'Charged once at admission' },
            { name: 'Exam Fee', amount: 40, frequency: 'Per term', description: 'Term examination fee' },
            { name: 'Library Fee', amount: 15, frequency: 'Yearly', description: 'Library membership' },
            { name: 'Transport Fee', amount: 30, frequency: 'Monthly', description: 'School bus' }
        ]);
        const monthName = D.monthLabel(today.slice(0, 7));
        const studentFees = [];
        students.forEach(s => {
            studentFees.push({ studentId: s.id, feeTypeId: 1, period: monthName, amount: 120, discount: rnd() < 0.12 ? pick([10, 20]) : 0, dueDate: D.addDays(today, ri(-12, 6)) });
            studentFees.push({ studentId: s.id, feeTypeId: 3, period: 'Annual Exam', amount: 40, discount: 0, dueDate: D.addDays(today, 30) });
            if (rnd() < 0.3) studentFees.push({ studentId: s.id, feeTypeId: 5, period: monthName, amount: 30, discount: 0, dueDate: D.addDays(today, ri(-5, 10)) });
        });
        const fees = DB.bulk('studentFees', studentFees);
        const payments = [];
        let receipt = 0;
        fees.forEach(f => {
            const net = f.amount - f.discount;
            const x = rnd();
            let amount = 0;
            if (f.studentId === 1) amount = f.feeTypeId === 1 ? Math.round(net / 2) : 0; // Alice: tuition half paid, exam fee unpaid
            else amount = x < 0.55 ? net : x < 0.8 ? Math.round(net / 2) : 0;
            if (amount > 0) payments.push({
                studentFeeId: f.id, studentId: f.studentId, amount, date: D.addDays(today, -ri(0, 20)),
                method: pick(['Cash', 'Bank Transfer', 'Card']), receiptNo: `RCT-${pad(++receipt, 6)}`, receivedBy: 'Admin User', note: ''
            });
        });
        DB.bulk('payments', payments);
        Store.set('seq_receipt', receipt);

        // Library
        const bookDefs = [['To Kill a Mockingbird', 'Harper Lee', 'Fiction'], ["Charlotte's Web", 'E. B. White', 'Fiction'], ['A Brief History of Time', 'Stephen Hawking', 'Science'],
            ['The Diary of a Young Girl', 'Anne Frank', 'Biography'], ['Introduction to Algorithms', 'Cormen et al.', 'Computer Science'], ['Python Crash Course', 'Eric Matthes', 'Computer Science'],
            ['Oxford Atlas of the World', 'Oxford University Press', 'Reference'], ['Wings of Fire', 'A. P. J. Abdul Kalam', 'Biography'], ['The Hobbit', 'J. R. R. Tolkien', 'Fiction'],
            ['Basic Mathematics', 'Serge Lang', 'Mathematics'], ['Physics for Beginners', 'Various', 'Science'], ['World History: An Illustrated Guide', 'Various', 'History'],
            ['Grammar in Use', 'Raymond Murphy', 'Language'], ['Essential Art Techniques', 'Various', 'Arts']];
        DB.bulk('books', bookDefs.map(([title, author, category], i) => ({
            title, author, category, isbn: `9780${String(100000000 + i * 10397).padStart(9, '0')}`, quantity: ri(2, 5), shelf: `${category[0]}-${ri(1, 9)}`
        })));
        const issue = (bookId, memberType, memberId, issued, due, returned = null, fine = 0) => ({
            bookId, memberType, memberId, issueDate: D.addDays(today, issued), dueDate: D.addDays(today, due), returnDate: returned === null ? null : D.addDays(today, returned), fine
        });
        DB.bulk('issues', [
            issue(1, 'student', 1, -5, 9), issue(3, 'student', 3, -20, -6), issue(6, 'teacher', 5, -3, 11),
            issue(2, 'student', 8, -30, -16, -10, 3), issue(9, 'student', 2, -40, -26, -27, 0), issue(5, 'student', 12, -12, 2)
        ]);

        // Notices
        DB.bulk('notices', [
            { title: 'Annual Exam Schedule Published', category: 'Exam', targetClass: 'all', date: D.addDays(today, -2), description: 'The Annual Exam will begin in about six weeks.\nPlease check the exam schedule and prepare early. Admit cards will be issued one week before the exam.', createdBy: 'Admin User' },
            { title: 'Parent-Teacher Meeting', category: 'Event', targetClass: 'all', date: D.addDays(today, -5), description: 'A parent-teacher meeting will be held on the first Saturday of next month from 9:00 AM to 12:00 PM.', createdBy: 'Admin User' },
            { title: 'Tuition Fee Reminder', category: 'Fee', targetClass: 'all', date: D.addDays(today, -7), description: 'This month\'s tuition fee is due. Please pay at the accounts office to avoid delays.', createdBy: 'Admin User' },
            { title: 'Class 8-A Science Fair Preparation', category: 'General', targetClass: '3', date: D.addDays(today, -3), description: 'Students of Class 8-A should form groups of three and submit their project titles to the class teacher.', createdBy: 'John Carter' },
            { title: 'Winter Break Announcement', category: 'Holiday', targetClass: 'all', date: D.addDays(today, -10), description: 'The school will remain closed for the winter break. Classes resume as per the academic calendar.', createdBy: 'Admin User' },
            { title: 'Library Week', category: 'Event', targetClass: 'all', date: D.addDays(today, -1), description: 'Visit the library this week to borrow books. Overdue fines are waived for books returned during Library Week.', createdBy: 'Admin User' }
        ]);

        // Assignments
        DB.bulk('assignments', [
            { title: 'Algebra Practice Set 4', classId: 3, subjectId: 2, teacherId: 2, assignedDate: D.addDays(today, -4), deadline: D.addDays(today, 3), description: 'Solve all questions from exercise 4.2 and show your working.' },
            { title: 'Essay: My Favourite Season', classId: 3, subjectId: 1, teacherId: 1, assignedDate: D.addDays(today, -6), deadline: D.addDays(today, -1), description: 'Write a 300-word essay with an introduction, body and conclusion.' },
            { title: 'Build a Simple Web Page', classId: 3, subjectId: 5, teacherId: 5, assignedDate: D.addDays(today, -2), deadline: D.addDays(today, 8), description: 'Create a one-page HTML document about yourself using headings, a list and an image.' },
            { title: 'Plant Cell Diagram', classId: 3, subjectId: 3, teacherId: 3, assignedDate: D.addDays(today, -8), deadline: D.addDays(today, -3), description: 'Draw and label a plant cell.' },
            { title: 'Map Work: Continents', classId: 1, subjectId: 4, teacherId: 4, assignedDate: D.addDays(today, -1), deadline: D.addDays(today, 6), description: 'Label the seven continents and five oceans on the outline map.' },
            { title: 'Fractions Worksheet', classId: 2, subjectId: 2, teacherId: 2, assignedDate: D.addDays(today, -3), deadline: D.addDays(today, 4), description: 'Complete the worksheet handed out in class.' }
        ]);
        DB.bulk('submissions', [
            { assignmentId: 2, studentId: 1, status: 'Submitted', submittedAt: D.addDays(today, -2) },
            { assignmentId: 4, studentId: 1, status: 'Submitted', submittedAt: D.addDays(today, -4) }
        ]);

        // Weekly timetable: a rotation that never double-books a teacher
        const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
        const routine = [];
        classDefs.forEach((_, ci) => dayNames.forEach((day, d) => {
            for (let p = 1; p <= 6; p++) {
                const si = (ci + d * 6 + (p - 1)) % 7;
                routine.push({ classId: ci + 1, day, period: p, subjectId: si + 1, teacherId: si + 1 });
            }
        }));
        DB.bulk('routine', routine);

        this.seedUsers();
        Store.set('seedVersion', this.VERSION);
    }
};

Seed.ensure();
console.log('Data module initialized');
