/**
 * fees.js - Fee types, student fees (with discount), payments, payment history and printable receipts.
 *
 * Money rules (used everywhere): net = amount - discount ; due = net - total paid
 * Status: Paid (due = 0), Overdue (due > 0 and past the due date), Partial (some paid), Unpaid.
 */
const FeeService = {
    paid(studentFeeId) { return DB.all('payments').filter(p => p.studentFeeId === studentFeeId).reduce((t, p) => t + Number(p.amount), 0); },

    row(sf) {
        const net = Number(sf.amount) - Number(sf.discount || 0);
        const paid = this.paid(sf.id);
        const due = Math.max(0, Math.round((net - paid) * 100) / 100);
        const overdue = due > 0 && sf.dueDate < D.today();
        const status = due <= 0 ? 'Paid' : overdue ? 'Overdue' : paid > 0 ? 'Partial' : 'Unpaid';
        const student = DB.find('students', sf.studentId);
        return {
            ...sf, net, paid, due, status, studentName: student ? student.name : 'Unknown student', studentCode: student ? student.studentId : '',
            classId: student ? student.classId : null, classLabel: student ? Lookup.classLabel(student.classId) : '—', feeTypeName: Lookup.feeTypeName(sf.feeTypeId)
        };
    },

    rows() { return DB.all('studentFees').map(f => this.row(f)); },
    rowsForStudent(id) { return DB.all('studentFees').filter(f => f.studentId === id).map(f => this.row(f)); },
    scopedRows() { const me = Session.student(); return Session.isFamily() ? (me ? this.rowsForStudent(me.id) : []) : this.rows(); },

    totals(rows = this.rows()) {
        const billed = rows.reduce((t, r) => t + r.net, 0);
        const collected = rows.reduce((t, r) => t + r.paid, 0);
        return { billed, collected, outstanding: rows.reduce((t, r) => t + r.due, 0), rate: billed ? (collected / billed) * 100 : 0 };
    },

    receiptHtml(p) {
        const sf = DB.find('studentFees', p.studentFeeId);
        const r = sf ? this.row(sf) : null;
        const student = DB.find('students', p.studentId);
        return `
            <div class="doc-meta"><div><strong>Receipt no:</strong> ${esc(p.receiptNo)}<br><strong>Date:</strong> ${esc(D.fmt(p.date))}<br><strong>Payment method:</strong> ${esc(p.method)}</div>
            <div><strong>Student:</strong> ${esc(student ? student.name : 'Unknown')}<br><strong>ID:</strong> ${esc(student ? student.studentId : '')}<br><strong>Class:</strong> ${esc(student ? Lookup.classLabel(student.classId) : '')}</div></div>
            <table><thead><tr><th>Description</th><th>Period</th><th>Amount paid</th></tr></thead><tbody>
            <tr><td>${esc(r ? r.feeTypeName : 'Fee')}</td><td>${esc(r ? r.period : '')}</td><td>${Fmt.money(p.amount)}</td></tr></tbody></table>
            ${r ? `<div class="doc-summary"><span><strong>Fee amount:</strong> ${Fmt.money(r.amount)}</span><span><strong>Discount:</strong> ${Fmt.money(r.discount)}</span>
                <span><strong>Total paid so far:</strong> ${Fmt.money(r.paid)}</span><span><strong>Balance due:</strong> ${Fmt.money(r.due)}</span></div>` : ''}
            ${p.note ? `<p><strong>Note:</strong> ${esc(p.note)}</p>` : ''}
            <p class="text-small">Received by: ${esc(p.receivedBy)}</p>
            <div class="sign-row"><div>Parent / Guardian</div><div>Accounts office</div></div>`;
    },

    showReceipt(p) { Modal.document(`Receipt ${p.receiptNo}`, this.receiptHtml(p), { printTitle: `Fee Receipt ${p.receiptNo}`, size: '' }); },

    collect(row, api) {
        Modal.form({
            title: `Collect payment - ${row.studentName}`, size: '', submitText: 'Record payment',
            fields: [
                { name: 'amount', label: `Amount (due ${Fmt.money(row.due)})`, type: 'number', required: true, min: 0.01, max: row.due, step: '0.01' },
                { name: 'date', label: 'Payment date', type: 'date', required: true },
                { name: 'method', label: 'Method', type: 'select', required: true, options: ['Cash', 'Bank Transfer', 'Card', 'Mobile Wallet'] },
                { name: 'note', label: 'Note', type: 'textarea', full: true }
            ],
            values: { amount: row.due, date: D.today(), method: 'Cash' },
            onSubmit: (data) => {
                const n = Store.get('seq_receipt', 0) + 1;
                Store.set('seq_receipt', n);
                const p = DB.insert('payments', { ...data, studentFeeId: row.id, studentId: row.studentId, receiptNo: `RCT-${pad(n, 6)}`, receivedBy: (Session.user() || {}).name || '' });
                UI.toast('Payment recorded', 'success');
                api.refresh();
                if (Pages.fees.parts) { Pages.fees.parts.pay.api.refresh(); Pages.fees.refreshSummary(); }
                this.showReceipt(p);
            }
        });
    },

    lastPayment(sfId) { return DB.all('payments').filter(p => p.studentFeeId === sfId).sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id)[0]; }
};

function makeStudentFeesCrud() {
    return Crud.create({
        collection: 'studentFees', id: 'student-fees', title: 'Student Fees', singular: 'Fee', plural: 'student fees', defaultSort: 'dueDate',
        searchKeys: ['studentName', 'studentCode', 'feeTypeName', 'period'],
        rows: () => FeeService.scopedRows(),
        label: (f) => Lookup.feeTypeName(f.feeTypeId),
        filters: [
            { key: 'status', label: 'Statuses', options: () => ['Paid', 'Partial', 'Unpaid', 'Overdue'] },
            { key: 'classId', label: 'Classes', options: () => Lookup.classOptions() },
            { key: 'feeTypeId', label: 'Fee types', options: () => Lookup.feeTypeOptions() }
        ],
        columns: [
            { key: 'studentName', label: 'Student', render: (r) => `<strong>${esc(r.studentName)}</strong><br><small class="text-small">${esc(r.classLabel)}</small>`, text: (r) => `${r.studentName} (${r.classLabel})` },
            { key: 'feeTypeName', label: 'Fee', render: (r) => `${esc(r.feeTypeName)}<br><small class="text-small">${esc(r.period)}</small>`, text: (r) => `${r.feeTypeName} - ${r.period}` },
            { key: 'amount', label: 'Amount', render: (r) => Fmt.money(r.amount), text: (r) => Fmt.money(r.amount) },
            { key: 'discount', label: 'Discount', render: (r) => Fmt.money(r.discount), text: (r) => Fmt.money(r.discount) },
            { key: 'paid', label: 'Paid', render: (r) => Fmt.money(r.paid), text: (r) => Fmt.money(r.paid) },
            { key: 'due', label: 'Due', render: (r) => Fmt.money(r.due), text: (r) => Fmt.money(r.due) },
            { key: 'dueDate', label: 'Due date', cls: 'hide-on-mobile', render: (r) => D.fmt(r.dueDate), text: (r) => r.dueDate },
            { key: 'status', label: 'Status', render: (r) => Badge.html(r.status) }
        ],
        summary: (rows) => { const t = FeeService.totals(rows); return `<div class="summary-row"><div class="summary-item"><small>Billed (shown rows)</small><strong>${Fmt.money(t.billed)}</strong></div><div class="summary-item"><small>Collected</small><strong>${Fmt.money(t.collected)}</strong></div><div class="summary-item"><small>Outstanding</small><strong>${Fmt.money(t.outstanding)}</strong></div></div>`; },
        actions: [
            { name: 'collect', label: 'Collect', cls: 'btn-success', show: (r) => Session.isAdmin() && r.due > 0, run: (r, api) => FeeService.collect(r, api) },
            { name: 'receipt', label: 'Receipt', cls: 'btn-outline', show: (r) => !!FeeService.lastPayment(r.id), run: (r) => FeeService.showReceipt(FeeService.lastPayment(r.id)) }
        ],
        fields: [
            { name: 'studentId', label: 'Student', type: 'select', ref: true, required: true, options: () => Lookup.studentOptions() },
            { name: 'feeTypeId', label: 'Fee type', type: 'select', ref: true, required: true, options: () => Lookup.feeTypeOptions() },
            { name: 'period', label: 'Period', required: true, placeholder: 'e.g. November 2026' },
            { name: 'amount', label: 'Amount', type: 'number', min: 0, step: '0.01', placeholder: 'Empty = fee type amount' },
            { name: 'discount', label: 'Discount', type: 'number', min: 0, step: '0.01' },
            { name: 'dueDate', label: 'Due date', type: 'date', required: true }
        ],
        defaults: () => ({ discount: 0, dueDate: D.addDays(D.today(), 14), period: D.monthLabel(D.today().slice(0, 7)) }),
        beforeSave: (d) => ({ ...d, amount: d.amount === '' ? (DB.find('feeTypes', d.feeTypeId) || {}).amount || 0 : d.amount, discount: d.discount === '' ? 0 : d.discount }),
        validate: (d, raw) => {
            const amount = d.amount === '' ? (DB.find('feeTypes', d.feeTypeId) || {}).amount || 0 : d.amount;
            const e = {};
            if (Number(d.discount || 0) > Number(amount)) e.discount = 'Discount cannot be more than the amount';
            if (raw && Number(amount) - Number(d.discount || 0) < FeeService.paid(raw.id)) e.amount = 'Amount (after discount) is less than what has already been paid';
            return e;
        },
        deleteGuard: (f) => (FeeService.paid(f.id) > 0 ? 'Payments exist for this fee, so it cannot be deleted.' : null),
        afterSave: () => Pages.fees.refreshSummary(),
        afterDelete: () => Pages.fees.refreshSummary()
    });
}

function makeFeeTypesCrud() {
    return Crud.create({
        collection: 'feeTypes', id: 'fee-types', title: 'Fee Types', singular: 'Fee type', plural: 'fee types', defaultSort: 'name',
        searchKeys: ['name', 'frequency', 'description'], label: (f) => f.name,
        columns: [
            { key: 'name', label: 'Fee type' }, { key: 'amount', label: 'Default amount', render: (f) => Fmt.money(f.amount), text: (f) => Fmt.money(f.amount) },
            { key: 'frequency', label: 'Frequency' }, { key: 'description', label: 'Description', cls: 'hide-on-mobile' }
        ],
        fields: [
            { name: 'name', label: 'Fee type name', required: true }, { name: 'amount', label: 'Default amount', type: 'number', min: 0, step: '0.01', required: true },
            { name: 'frequency', label: 'Frequency', type: 'select', required: true, options: ['Monthly', 'Per term', 'Yearly', 'One-time'] },
            { name: 'description', label: 'Description', type: 'textarea', full: true }
        ],
        defaults: () => ({ frequency: 'Monthly' }),
        deleteGuard: (f) => (DB.all('studentFees').some(x => x.feeTypeId === f.id) ? 'This fee type is assigned to students.' : null)
    });
}

function makePaymentsCrud() {
    const me = () => Session.student();
    return Crud.create({
        collection: 'payments', id: 'payments', title: 'Payment History', singular: 'Payment', plural: 'payments', readOnly: true, defaultSort: 'date', defaultDir: 'desc',
        searchKeys: ['receiptNo', 'studentName', 'feeTypeName', 'method'],
        rows: () => DB.all('payments').filter(p => !Session.isFamily() || (me() && p.studentId === me().id)).map(p => {
            const sf = DB.find('studentFees', p.studentFeeId);
            return { ...p, studentName: Lookup.studentName(p.studentId), feeTypeName: sf ? `${Lookup.feeTypeName(sf.feeTypeId)} (${sf.period})` : '—' };
        }),
        filters: [{ key: 'method', label: 'Methods', options: () => ['Cash', 'Bank Transfer', 'Card', 'Mobile Wallet'] }],
        columns: [
            { key: 'receiptNo', label: 'Receipt' }, { key: 'date', label: 'Date', render: (p) => D.fmt(p.date), text: (p) => p.date },
            { key: 'studentName', label: 'Student' }, { key: 'feeTypeName', label: 'Fee' },
            { key: 'amount', label: 'Amount', render: (p) => Fmt.money(p.amount), text: (p) => Fmt.money(p.amount) },
            { key: 'method', label: 'Method' }, { key: 'receivedBy', label: 'Received by', cls: 'hide-on-mobile' }
        ],
        actions: [{ name: 'receipt', label: 'Receipt', cls: 'btn-outline', run: (p) => FeeService.showReceipt(p) }]
    });
}

Pages.fees = {
    title: 'Fees Management',
    summaryHtml() {
        const t = FeeService.totals(FeeService.scopedRows());
        return `<div class="summary-row" id="fees-summary">
            <div class="summary-item"><small>Total billed</small><strong>${Fmt.money(t.billed)}</strong></div>
            <div class="summary-item"><small>Collected</small><strong>${Fmt.money(t.collected)}</strong></div>
            <div class="summary-item"><small>Outstanding</small><strong>${Fmt.money(t.outstanding)}</strong></div>
            <div class="summary-item"><small>Collection rate</small><strong>${Fmt.pct(t.rate)}</strong></div></div>`;
    },
    refreshSummary() { const el = document.getElementById('fees-summary'); if (el) el.outerHTML = this.summaryHtml(); },
    render() {
        this.parts = { fees: makeStudentFeesCrud(), pay: makePaymentsCrud(), types: makeFeeTypesCrud() };
        const tabs = [['fees', 'Student fees'], ['pay', 'Payment history'], ...(Session.isStaff() ? [['types', 'Fee types']] : [])];
        return `${this.summaryHtml()}<div id="fees-root">${Tabs.markup(tabs, 'fees')}
            <div class="tab-content active" data-panel="fees">${this.parts.fees.render()}</div>
            <div class="tab-content" data-panel="pay">${this.parts.pay.render()}</div>
            ${Session.isStaff() ? `<div class="tab-content" data-panel="types">${this.parts.types.render()}</div>` : ''}</div>`;
    },
    init() {
        Tabs.bind(document.getElementById('fees-root'));
        this.parts.fees.init();
        this.parts.pay.init();
        if (Session.isStaff()) this.parts.types.init();
    }
};

console.log('Fees module initialized');
