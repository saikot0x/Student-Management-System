/**
 * notices.js - Add / edit / delete notices, target class, notice details page.
 * Students and parents only see notices for "All classes" or their own class.
 */
const NoticeService = {
    visible() {
        const all = DB.all('notices');
        if (!Session.isFamily()) return all;
        const me = Session.student();
        return all.filter(n => n.targetClass === 'all' || (me && String(n.targetClass) === String(me.classId)));
    },
    targetLabel(n) { return n.targetClass === 'all' ? 'All classes' : Lookup.classLabel(n.targetClass); },
    recent(limit = 5) { return this.visible().slice().sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id).slice(0, limit); }
};

function makeNoticesCrud() {
    return Crud.create({
        collection: 'notices', title: 'Notices', singular: 'Notice', plural: 'notices', defaultSort: 'date', defaultDir: 'desc',
        writeRoles: ['admin', 'teacher'],
        searchKeys: ['title', 'description', 'category', 'targetLabel', 'createdBy'], label: (n) => n.title,
        rows: () => NoticeService.visible().map(n => ({ ...n, targetLabel: NoticeService.targetLabel(n) })),
        filters: [
            { key: 'category', label: 'Categories', options: () => ['General', 'Exam', 'Event', 'Holiday', 'Fee'] },
            { key: 'targetClass', label: 'Targets', options: () => [{ value: 'all', label: 'All classes' }, ...Lookup.classOptions()] }
        ],
        columns: [
            { key: 'title', label: 'Title', render: (n) => `<a href="#/notice-details/${n.id}"><strong>${esc(n.title)}</strong></a>` },
            { key: 'category', label: 'Category', render: (n) => Badge.html(n.category, 'primary') },
            { key: 'targetLabel', label: 'Target' },
            { key: 'date', label: 'Date', render: (n) => D.fmt(n.date), text: (n) => n.date },
            { key: 'createdBy', label: 'Posted by', cls: 'hide-on-mobile' }
        ],
        onView: (n) => { location.hash = `#/notice-details/${n.id}`; },
        fields: [
            { name: 'title', label: 'Notice title', required: true, full: true },
            { name: 'category', label: 'Category', type: 'select', required: true, options: ['General', 'Exam', 'Event', 'Holiday', 'Fee'] },
            { name: 'targetClass', label: 'Target class', type: 'select', required: true, options: () => [{ value: 'all', label: 'All classes' }, ...Lookup.classOptions()] },
            { name: 'date', label: 'Date', type: 'date', required: true },
            { name: 'description', label: 'Description', type: 'textarea', required: true, full: true }
        ],
        defaults: () => ({ category: 'General', targetClass: 'all', date: D.today() }),
        beforeSave: (d, raw) => ({ ...d, targetClass: String(d.targetClass), createdBy: raw ? raw.createdBy : (Session.user() || {}).name || '' })
    });
}

Pages.notices = Crud.page({ title: 'Notices', make: () => [makeNoticesCrud()] });

Pages['notice-details'] = {
    title: 'Notice Details', nav: 'notices',
    render(id) {
        const n = NoticeService.visible().find(x => String(x.id) === String(id));
        if (!n) return '<div class="card"><div class="empty-state"><div class="empty-state-icon">📢</div><div class="empty-state-title">Notice not found</div><a class="btn btn-primary" href="#/notices">Back to notices</a></div></div>';
        return `<article class="card notice-detail"><div class="card-header"><div><h2>${esc(n.title)}</h2>
            <p class="text-small">${Badge.html(n.category, 'primary')} &bull; ${esc(D.fmt(n.date))} &bull; For: ${esc(NoticeService.targetLabel(n))} &bull; Posted by ${esc(n.createdBy)}</p></div>
            <div class="btn-group"><a class="btn btn-outline" href="#/notices">&larr; All notices</a><button type="button" class="btn btn-outline" id="notice-print">Print</button></div></div>
            <div class="card-body"><div class="notice-body">${esc(n.description)}</div></div></article>`;
    },
    init(id) {
        const n = DB.find('notices', id);
        const btn = document.getElementById('notice-print');
        if (n && btn) btn.onclick = () => Print.open(n.title, `<p>${esc(D.fmt(n.date))} &bull; ${esc(n.category)}</p><div style="white-space:pre-wrap">${esc(n.description)}</div>`);
    }
};

console.log('Notices module initialized');
