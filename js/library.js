/**
 * library.js - Books, issuing and returning, due dates, fines and borrowing history.
 * Change LIBRARY below to adjust the rules.
 */
const LIBRARY = {
    LOAN_DAYS: 14,       // default loan period
    FINE_PER_DAY: 0.5,   // fine per overdue day (in the school currency)
    MAX_ACTIVE: 3        // books one member may borrow at the same time
};

const LibraryService = {
    status(issue) { return issue.returnDate ? 'Returned' : issue.dueDate < D.today() ? 'Overdue' : 'Issued'; },
    daysOverdue(issue) {
        const end = issue.returnDate || D.today();
        return Math.max(0, D.diff(issue.dueDate, end));
    },
    fine(issue) { return issue.returnDate ? Number(issue.fine || 0) : this.daysOverdue(issue) * LIBRARY.FINE_PER_DAY; },
    activeLoans(bookId) { return DB.all('issues').filter(i => i.bookId === bookId && !i.returnDate).length; },
    memberName(i) {
        if (i.memberType === 'teacher') return Lookup.teacherName(i.memberId);
        return Lookup.studentName(i.memberId);
    },
    memberOptions() {
        return [
            ...DB.all('students').filter(s => s.status === 'Active').map(s => ({ value: `student:${s.id}`, label: `${s.name} (student, ${Lookup.classLabel(s.classId)})` })),
            ...DB.all('teachers').map(t => ({ value: `teacher:${t.id}`, label: `${t.name} (teacher)` }))
        ];
    },
    // Whose loans may this login see? admin = everyone (null); teacher = own; student/parent = the student's
    mine() {
        const role = Session.role();
        if (role === 'teacher') { const t = Session.teacher(); return { type: 'teacher', id: t ? t.id : -1 }; }
        if (Session.isFamily()) { const s = Session.student(); return { type: 'student', id: s ? s.id : -1 }; }
        return null;
    },
    availableBooks() { return DB.all('books').filter(b => b.quantity - this.activeLoans(b.id) > 0).map(b => ({ value: b.id, label: `${b.title} - ${b.author}` })); }
};

function makeBooksCrud() {
    return Crud.create({
        collection: 'books', title: 'Book Catalogue', singular: 'Book', plural: 'books', defaultSort: 'title',
        searchKeys: ['title', 'author', 'isbn', 'category'], label: (b) => b.title,
        rows: () => DB.all('books').map(b => { const out = LibraryService.activeLoans(b.id); return { ...b, issued: out, available: b.quantity - out }; }),
        filters: [
            { key: 'category', label: 'Categories', options: () => [...new Set(DB.all('books').map(b => b.category))].sort() },
            { key: 'availability', label: 'Availability', options: () => ['Available', 'Out of stock'], match: (b, v) => (v === 'Available' ? b.available > 0 : b.available <= 0) }
        ],
        columns: [
            { key: 'title', label: 'Title', render: (b) => `<strong>${esc(b.title)}</strong><br><small class="text-small">${esc(b.author)}</small>`, text: (b) => `${b.title} - ${b.author}` },
            { key: 'isbn', label: 'ISBN', cls: 'hide-on-mobile' }, { key: 'category', label: 'Category' },
            { key: 'quantity', label: 'Copies' }, { key: 'issued', label: 'Issued' },
            { key: 'available', label: 'Available', render: (b) => Badge.html(`${b.available}`, b.available > 0 ? 'success' : 'danger'), text: (b) => b.available }
        ],
        actions: [{ name: 'issue', label: 'Issue', cls: 'btn-success', show: (b) => Session.isAdmin() && b.available > 0, run: (b) => LibraryUI.issue(b.id) }],
        fields: [
            { name: 'title', label: 'Title', required: true }, { name: 'author', label: 'Author', required: true },
            { name: 'isbn', label: 'ISBN', required: true }, { name: 'category', label: 'Category', required: true, placeholder: 'e.g. Fiction' },
            { name: 'quantity', label: 'Quantity (copies)', type: 'number', min: 1, required: true }, { name: 'shelf', label: 'Shelf / location' }
        ],
        defaults: () => ({ quantity: 1 }),
        validate: (d, raw) => {
            const e = {};
            if (DB.all('books').some(b => b.isbn.replace(/-/g, '') === d.isbn.replace(/-/g, '') && (!raw || b.id !== raw.id))) e.isbn = 'A book with this ISBN already exists';
            if (raw && d.quantity < LibraryService.activeLoans(raw.id)) e.quantity = `${LibraryService.activeLoans(raw.id)} copies are currently issued`;
            return e;
        },
        deleteGuard: (b) => (LibraryService.activeLoans(b.id) ? 'This book is currently issued. Return it first.' : null),
        afterDelete: (b) => DB.removeWhere('issues', i => i.bookId === b.id)
    });
}

function makeIssuesCrud() {
    return Crud.create({
        collection: 'issues', id: 'issues', title: 'Issued Books & Borrowing History', singular: 'Issue', plural: 'borrowing records', readOnly: true, defaultSort: 'issueDate', defaultDir: 'desc',
        searchKeys: ['bookTitle', 'memberName', 'status'],
        rows: () => DB.all('issues').filter(i => { const m = LibraryService.mine(); return !m || (i.memberType === m.type && i.memberId === m.id); }).map(i => ({
            ...i, bookTitle: (DB.find('books', i.bookId) || {}).title || 'Removed book', memberName: LibraryService.memberName(i),
            status: LibraryService.status(i), overdueDays: LibraryService.daysOverdue(i), fineNow: LibraryService.fine(i), requested: !!i.returnRequested && !i.returnDate
        })),
        filters: [
            { key: 'status', label: 'Statuses', options: () => ['Issued', 'Overdue', 'Returned'] },
            { key: 'memberType', label: 'Members', options: () => [{ value: 'student', label: 'Students' }, { value: 'teacher', label: 'Teachers' }] },
            { key: 'requested', label: 'Requests', options: () => [{ value: 'yes', label: 'Return requested' }], match: (r) => r.requested }
        ],
        summary: () => {
            const n = DB.all('issues').filter(i => i.returnRequested && !i.returnDate).length;
            return Session.isAdmin() && n ? `<div class="notice-banner"><strong>${n} return request(s)</strong> from students or teachers. Check that you received the book, then press <em>Accept return</em> (or <em>Decline</em> if it was not handed over).</div>` : '';
        },
        columns: [
            { key: 'bookTitle', label: 'Book' },
            { key: 'memberName', label: 'Borrower', render: (i) => `${esc(i.memberName)}<br><small class="text-small">${esc(i.memberType)}</small>`, text: (i) => `${i.memberName} (${i.memberType})` },
            { key: 'issueDate', label: 'Issued', render: (i) => D.fmt(i.issueDate), text: (i) => i.issueDate },
            { key: 'dueDate', label: 'Due', render: (i) => D.fmt(i.dueDate), text: (i) => i.dueDate },
            { key: 'returnDate', label: 'Returned', render: (i) => D.fmt(i.returnDate), text: (i) => i.returnDate || '' },
            { key: 'fineNow', label: 'Fine', render: (i) => (i.fineNow ? `<strong>${Fmt.money(i.fineNow)}</strong>` : Fmt.money(0)), text: (i) => Fmt.money(i.fineNow) },
            { key: 'status', label: 'Status', render: (i) => Badge.html(i.status) + (i.requested ? ' ' + Badge.html('Return requested', 'warning') : ''), text: (i) => i.status + (i.requested ? ' (return requested)' : '') }
        ],
        headerActions: [{ name: 'issue', label: 'Issue book', cls: 'btn-primary', show: () => Session.isAdmin(), run: () => LibraryUI.issue() }],
        actions: [
            { name: 'accept', label: 'Accept return', cls: 'btn-success', show: (i) => Session.isAdmin() && i.requested, run: (i) => LibraryUI.giveBack(i) },
            { name: 'decline', label: 'Decline', cls: 'btn-outline', show: (i) => Session.isAdmin() && i.requested, run: (i) => LibraryUI.declineReturn(i) },
            { name: 'return', label: 'Return', cls: 'btn-success', show: (i) => Session.isAdmin() && !i.returnDate && !i.requested, run: (i) => LibraryUI.giveBack(i) },
            { name: 'request', label: 'Request return', cls: 'btn-outline', show: (i) => ['student', 'teacher'].includes(Session.role()) && !i.returnDate && !i.requested, run: (i, api) => LibraryUI.requestReturn(i, api) }
        ]
    });
}

const LibraryUI = {
    refresh() { if (Pages.library.parts) { Pages.library.parts.books.api.refresh(); Pages.library.parts.issues.api.refresh(); } },

    issue(bookId) {
        const books = LibraryService.availableBooks();
        if (!books.length) { UI.toast('No books are available to issue.', 'warning'); return; }
        Modal.form({
            title: 'Issue book', size: '', submitText: 'Issue book',
            fields: [
                { name: 'bookId', label: 'Book', type: 'select', ref: true, required: true, options: () => books },
                { name: 'member', label: 'Borrower', type: 'select', required: true, options: () => LibraryService.memberOptions() },
                { name: 'issueDate', label: 'Issue date', type: 'date', required: true },
                { name: 'dueDate', label: 'Due date', type: 'date', required: true }
            ],
            values: { bookId: bookId || '', issueDate: D.today(), dueDate: D.addDays(D.today(), LIBRARY.LOAN_DAYS) },
            onSubmit: (data, m) => {
                const [memberType, id] = data.member.split(':');
                const memberId = Number(id);
                const form = m.el.querySelector('form');
                if (data.dueDate < data.issueDate) { Form.showErrors(form, { dueDate: 'Due date cannot be before the issue date' }); return false; }
                const active = DB.all('issues').filter(i => i.memberType === memberType && i.memberId === memberId && !i.returnDate);
                if (active.length >= LIBRARY.MAX_ACTIVE) { Form.showErrors(form, { member: `This borrower already has ${LIBRARY.MAX_ACTIVE} books` }); return false; }
                if (active.some(i => i.bookId === data.bookId)) { Form.showErrors(form, { bookId: 'This borrower already has a copy of this book' }); return false; }
                DB.insert('issues', { bookId: data.bookId, memberType, memberId, issueDate: data.issueDate, dueDate: data.dueDate, returnDate: null, fine: 0 });
                UI.toast('Book issued', 'success');
                this.refresh();
            }
        });
    },

    // Student side: ask the librarian to take the book back (the physical book is handed over at the library)
    async requestReturn(i, api) {
        const fine = LibraryService.fine(i);
        const msg = `Send a return request for "${i.bookTitle}"? Please hand the book to the librarian. ${fine > 0 ? `It is overdue (fine so far ${Fmt.money(fine)}). ` : ''}The fine keeps growing until the librarian marks it returned.`;
        if (!(await Modal.confirm(msg, { title: 'Request return', confirmText: 'Send request', danger: false }))) return;
        DB.update('issues', i.id, { returnRequested: D.today() });
        UI.toast('Return request sent. Please hand the book to the librarian.', 'success', 4500);
        api.refresh();
    },

    // Admin: the student did not actually hand the book over
    async declineReturn(i) {
        if (!(await Modal.confirm(`Decline the return request for "${i.bookTitle}"? The book stays issued to ${i.memberName}.`, { title: 'Decline request', confirmText: 'Decline', danger: false }))) return;
        DB.update('issues', i.id, { returnRequested: null });
        UI.toast('Return request declined', 'info');
        this.refresh();
    },

    async giveBack(i) {
        const fine = LibraryService.fine(i);
        const days = LibraryService.daysOverdue(i);
        const from = i.requested ? ` ${i.memberName} asked to return it.` : '';
        const msg = fine > 0 ? `"${i.bookTitle}" is ${days} day(s) overdue. A fine of ${Fmt.money(fine)} will be recorded.${from} Accept the return?` : `Accept the return of "${i.bookTitle}"?${from}`;
        if (!(await Modal.confirm(msg, { title: 'Accept return', confirmText: 'Accept return', danger: false }))) return;
        DB.update('issues', i.id, { returnDate: D.today(), fine });
        UI.toast(fine > 0 ? `Book returned. Fine: ${Fmt.money(fine)}` : 'Book returned', fine > 0 ? 'warning' : 'success');
        this.refresh();
    }
};

Pages.library = {
    title: 'Library',
    render() {
        this.parts = { books: makeBooksCrud(), issues: makeIssuesCrud() };
        const rules = `Loan period ${LIBRARY.LOAN_DAYS} days &bull; fine ${Fmt.money(LIBRARY.FINE_PER_DAY)} per overdue day &bull; max ${LIBRARY.MAX_ACTIVE} books per borrower`;
        return `<div id="lib-root"><p class="text-small mb-2">${rules}</p>${Tabs.markup([['books', 'Books'], ['issues', Session.isAdmin() ? 'Issue / return & history' : 'My borrowing']], Session.isAdmin() ? 'books' : 'issues')}
            <div class="tab-content ${Session.isAdmin() ? 'active' : ''}" data-panel="books">${this.parts.books.render()}</div>
            <div class="tab-content ${Session.isAdmin() ? '' : 'active'}" data-panel="issues">${this.parts.issues.render()}</div></div>`;
    },
    init(param) {
        const show = Tabs.bind(document.getElementById('lib-root'));
        this.parts.books.init();
        this.parts.issues.init();
        if (param === 'requests') { // opened from the dashboard alert: show only the pending return requests
            show('issues');
            const sel = document.querySelector('#crud-issues-root [data-filter=requested]');
            if (sel) { sel.value = 'yes'; sel.dispatchEvent(new Event('change', { bubbles: true })); }
        }
    }
};

console.log('Library module initialized');
