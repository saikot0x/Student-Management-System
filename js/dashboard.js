/**
 * dashboard.js - Role-based dashboard.
 *  Admin / teacher : school-wide numbers + charts
 *  Student / parent: personal summary (attendance, fees, latest result, assignments)
 */
const Dashboard = {
    stat(label, value, note, cls = '') {
        return `<div class="stat-card ${cls}"><div class="stat-label">${esc(label)}</div><div class="stat-value">${esc(value)}</div><div class="stat-change">${esc(note)}</div></div>`;
    },

    noticesCard() {
        const list = NoticeService.recent(5);
        return `<section class="card"><div class="card-header"><h3 class="card-title">Recent notices</h3><a class="btn btn-outline btn-small" href="#/notices">View all</a></div>
            <ul class="list-plain">${list.map(n => `<li class="list-item"><div><a href="#/notice-details/${n.id}"><strong>${esc(n.title)}</strong></a><br><small class="text-small">${esc(D.fmt(n.date))} &bull; ${esc(NoticeService.targetLabel(n))}</small></div>${Badge.html(n.category, 'primary')}</li>`).join('') || '<li class="empty-state">No notices yet</li>'}</ul></section>`;
    },

    // Admin only: students who asked to return a library book
    requestsBanner() {
        const n = DB.all('issues').filter(i => i.returnRequested && !i.returnDate).length;
        if (!Session.isAdmin() || !n) return '';
        return `<a class="notice-banner info" href="#/library/requests" style="display:block;text-decoration:none;color:inherit">📚 <strong>${n} library return request(s)</strong> from students or teachers are waiting. <u>Review and accept</u></a>`;
    },

    staffView() {
        const students = DB.all('students');
        const active = students.filter(s => s.status === 'Active').length;
        const att = Attendance.todaySummary();
        const totals = FeeService.totals();
        const upcoming = Exams.upcoming();
        const admin = Session.isAdmin();

        // last 7 school days attendance chart
        const dates = [...new Set(DB.all('attendance').map(a => a.date))].sort().slice(-7);
        const dayBars = dates.map(date => {
            const c = Attendance.emptyCounts();
            DB.all('attendance').filter(a => a.date === date).forEach(r => { const x = Attendance.counts(r); Object.keys(x).forEach(k => { c[k] += x[k]; }); });
            return { label: D.dayName(date).slice(0, 3), value: Math.round(Attendance.percent(c) ?? 0) };
        });
        const perClass = DB.all('classes').map(c => ({ label: `${c.name.replace('Class ', 'C')}-${c.section}`, value: students.filter(s => s.classId === c.id && s.status === 'Active').length }));
        const grades = {};
        const latest = DB.all('exams').filter(e => e.published).sort((a, b) => b.startDate.localeCompare(a.startDate))[0];
        if (latest) students.filter(s => s.status === 'Active').forEach(s => { const r = ResultService.compute(latest.id, s.id); if (r.complete) grades[r.grade] = (grades[r.grade] || 0) + 1; });

        return `
        ${this.requestsBanner()}
        <div class="dashboard-grid">
            ${this.stat('Total Students', active, `${students.length} on record`)}
            ${this.stat('Total Teachers', DB.all('teachers').length, 'Teaching staff', 'secondary')}
            ${this.stat('Total Staff', DB.all('staff').length, 'Non-teaching staff', 'info')}
            ${this.stat('Total Classes', DB.all('classes').length, `Session ${Settings.session()}`, 'success')}
            ${this.stat(att.isToday ? "Today's Attendance" : 'Latest Attendance', Fmt.pct(att.pct), att.isToday ? `${att.classesMarked} of ${att.totalClasses} classes marked` : `Last school day: ${D.fmt(att.date)}`, 'success')}
            ${admin ? this.stat('Fee Collection', Fmt.money(totals.collected), `${Fmt.pct(totals.rate)} of ${Fmt.money(totals.billed)} billed`, 'secondary') : ''}
            ${admin ? this.stat('Outstanding Fees', Fmt.money(totals.outstanding), 'Still to be collected', 'danger') : ''}
            ${this.stat('Upcoming Exams', upcoming.length, upcoming[0] ? `Next: ${upcoming[0].name}` : 'None scheduled', 'warning')}
        </div>
        <div class="dashboard-cols">
            <section class="card"><div class="card-header"><h3 class="card-title">Attendance - last 7 school days</h3></div>${dayBars.length ? Charts.bars(dayBars, { max: 100, format: v => v + '%' }) : '<div class="empty-state">No attendance yet</div>'}</section>
            <section class="card"><div class="card-header"><h3 class="card-title">Active students per class</h3></div>${Charts.hbars(perClass, { max: Math.max(...perClass.map(p => p.value), 1) })}</section>
            ${admin ? `<section class="card"><div class="card-header"><h3 class="card-title">Fee collection</h3></div>${Charts.donut(totals.rate, 'collected')}
                <p class="text-center text-small mt-2">${Fmt.money(totals.collected)} collected &bull; ${Fmt.money(totals.outstanding)} outstanding</p></section>` : ''}
            <section class="card"><div class="card-header"><h3 class="card-title">${latest ? `Grades - ${esc(latest.name)}` : 'Grades'}</h3></div>
                ${Object.keys(grades).length ? Charts.hbars(Grading.SCALE.filter(g => grades[g.grade]).map(g => ({ label: g.grade, value: grades[g.grade] }))) : '<div class="empty-state">No published results yet</div>'}</section>
            <section class="card"><div class="card-header"><h3 class="card-title">Upcoming exams</h3><a class="btn btn-outline btn-small" href="#/exams">Schedule</a></div>
                <ul class="list-plain">${upcoming.map(e => `<li class="list-item"><div><strong>${esc(e.name)}</strong><br><small class="text-small">${esc(D.fmt(e.startDate))} &ndash; ${esc(D.fmt(e.endDate))}</small></div>${Badge.html(e.status)}</li>`).join('') || '<li class="empty-state">No upcoming exams</li>'}</ul></section>
            ${this.noticesCard()}
        </div>`;
    },

    familyView() {
        const me = Session.student();
        if (!me) return '<div class="card"><div class="empty-state"><div class="empty-state-title">No student record is linked to this account.</div></div></div>';
        const att = Attendance.studentStats(me.id);
        const fees = FeeService.rowsForStudent(me.id);
        const due = fees.reduce((t, f) => t + f.due, 0);
        const latest = ResultService.latestFor(me.id);
        const pending = AssignmentService.pendingFor(me.id);
        const who = Session.role() === 'parent' ? `${me.name}'s overview` : `Welcome back, ${me.name.split(' ')[0]}`;
        return `
        <h2 class="mb-2">${esc(who)}</h2>
        <p class="text-small mb-3">${esc(Lookup.classLabel(me.classId))} &bull; Roll ${esc(me.rollNo)} &bull; ${esc(me.studentId)}</p>
        <div class="dashboard-grid">
            ${this.stat('Attendance', Fmt.pct(att.pct), `${att.days} school days recorded`, 'success')}
            ${this.stat('Fees due', Fmt.money(due), due > 0 ? 'Please pay at the accounts office' : 'All paid', due > 0 ? 'danger' : 'success')}
            ${this.stat('Latest result', latest ? `GPA ${latest.result.gpa.toFixed(2)}` : '—', latest ? `${latest.exam.name} - ${latest.result.grade}` : 'None published', 'secondary')}
            ${this.stat('Assignments due', pending.length, 'Not yet submitted', 'warning')}
        </div>
        <div class="dashboard-cols">
            <section class="card"><div class="card-header"><h3 class="card-title">Open assignments</h3><a class="btn btn-outline btn-small" href="#/assignments">View all</a></div>
                <ul class="list-plain">${pending.map(a => `<li class="list-item"><div><strong>${esc(a.title)}</strong><br><small class="text-small">${esc(Lookup.subjectName(a.subjectId))} &bull; due ${esc(D.fmt(a.deadline))}</small></div>${Badge.html('Pending')}</li>`).join('') || '<li class="empty-state">Nothing due. Well done!</li>'}</ul></section>
            <section class="card"><div class="card-header"><h3 class="card-title">Fees</h3><a class="btn btn-outline btn-small" href="#/fees">Details</a></div>
                <ul class="list-plain">${fees.map(f => `<li class="list-item"><div><strong>${esc(f.feeTypeName)}</strong><br><small class="text-small">${esc(f.period)} &bull; due ${esc(D.fmt(f.dueDate))}</small></div><div>${Fmt.money(f.due)} ${Badge.html(f.status)}</div></li>`).join('') || '<li class="empty-state">No fees</li>'}</ul></section>
            ${this.noticesCard()}
        </div>`;
    }
};

Pages.dashboard = {
    title: 'Dashboard',
    render() { return Session.isFamily() ? Dashboard.familyView() : Dashboard.staffView(); }
};

console.log('Dashboard module initialized');
