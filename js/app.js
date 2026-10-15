/**
 * app.js - The application shell.
 * Pages are loaded by a tiny hash router: #/students, #/student-profile/3, #/notice-details/2 ...
 * Every page registers itself in Pages (see the other js files). Navigation is built from Auth.getNavigation()
 * so each role only sees its own menu.
 */
const App = {
    ICONS: { dashboard: '🏠', students: '🎓', teachers: '👩‍🏫', staff: '🧑‍💼', classes: '🏫', subjects: '📚', routine: '🗓️', attendance: '✅', exams: '📝', results: '🏆', fees: '💳', library: '📖', notices: '📢', assignments: '📋', reports: '📊', settings: '⚙️', users: '🔐', profile: '👤' },
    _bound: false,
    _token: 0,

    init() {
        this.applyTheme();
        this.applyBranding();
        this.bindOnce();
        if (Store.isBlocked()) UI.toast('Your browser is blocking local storage, so changes will be lost when you refresh or close this page.', 'warning', 9000);
        if (!Auth.isLoggedIn()) { this.showLogin(); return; }
        this.start();
    },

    bindOnce() {
        if (this._bound) return;
        this._bound = true;
        window.addEventListener('hashchange', () => this.route());
        document.getElementById('logout-btn').addEventListener('click', () => this.logout());
        const demo = document.querySelector('.demo-accounts');
        if (demo) demo.addEventListener('click', (e) => { // click a demo account to fill the login form
            const row = e.target.closest('.demo-account');
            if (!row) return;
            const [mail, pass] = row.querySelector('code').textContent.split('/').map(t => t.trim());
            document.getElementById('email').value = mail;
            document.getElementById('password').value = pass;
            document.getElementById('password').focus();
        });
        document.getElementById('theme-toggle').addEventListener('click', () => this.toggleTheme());
        document.getElementById('menu-toggle').addEventListener('click', () => this.toggleMenu());
        document.getElementById('sidebar-backdrop').addEventListener('click', () => this.closeMenu());
        document.addEventListener('keydown', (e) => { // Esc closes the top-most dialog
            if (e.key !== 'Escape') return;
            const overlays = document.querySelectorAll('.modal-overlay');
            const top = overlays[overlays.length - 1];
            if (top) { const x = top.querySelector('.modal-close'); if (x) x.click(); else top.remove(); }
            this.closeMenu();
        });
    },

    showLogin() {
        document.getElementById('login-screen').classList.add('active');
        document.getElementById('main-app').classList.add('hidden');
    },

    start() {
        document.getElementById('login-screen').classList.remove('active');
        document.getElementById('main-app').classList.remove('hidden');
        this.applyBranding();
        this.renderNav();
        this.route();
    },

    /* ---------- Theme & branding ---------- */
    applyTheme() { document.documentElement.setAttribute('data-theme', Store.get('theme', 'light')); },
    toggleTheme() {
        const next = Store.get('theme', 'light') === 'light' ? 'dark' : 'light';
        Store.set('theme', next);
        Settings.save({ theme: next });
        this.applyTheme();
        UI.toast(`Switched to ${next} mode`, 'info', 1800);
    },
    applyBranding() {
        const s = Settings.get();
        ['login-brand', 'login-title'].forEach(id => { const el = document.getElementById(id); if (el) el.textContent = s.schoolName || 'School Management System'; });
        const name = document.getElementById('brand-name');
        if (name) { name.textContent = s.schoolName || 'School'; name.title = s.schoolName || ''; }
        const logo = document.querySelector('.school-logo-small');
        if (logo && s.logo) { logo.innerHTML = `<img src="${esc(s.logo)}" alt="" style="width:100%;height:100%;object-fit:contain;border-radius:6px">`; logo.style.background = 'transparent'; }
        else if (logo && logo.querySelector('img')) { logo.style.background = ''; logo.innerHTML = '<span aria-hidden="true">🎓</span>'; }
    },

    /* ---------- Navigation ---------- */
    renderNav() {
        const nav = document.getElementById('nav-menu');
        nav.setAttribute('aria-label', 'Main navigation');
        nav.innerHTML = Auth.getNavigation().map(item =>
            `<a class="nav-item" href="#/${item.id}" data-nav="${item.id}"><span aria-hidden="true">${this.ICONS[item.id] || '•'}</span><span class="nav-item-title">${esc(item.label)}</span></a>`).join('');
        const user = Auth.getCurrentUser();
        if (user) {
            document.getElementById('user-name').textContent = user.name;
            document.getElementById('user-role').textContent = Auth.getRoleDisplayName(user.role);
            document.querySelector('.user-avatar').textContent = user.avatar;
        }
    },

    markActive(navId) {
        document.querySelectorAll('.nav-item').forEach(a => {
            const on = a.dataset.nav === navId;
            a.classList.toggle('active', on);
            if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
        });
    },

    toggleMenu() { const open = document.getElementById('sidebar').classList.toggle('mobile-open'); document.body.classList.toggle('menu-open', open); },
    closeMenu() { document.getElementById('sidebar').classList.remove('mobile-open'); document.body.classList.remove('menu-open'); },

    /* ---------- Router ---------- */
    async route() {
        if (!Auth.isLoggedIn()) return;
        const [page, ...rest] = (location.hash.replace(/^#\/?/, '') || 'dashboard').split('/');
        const param = rest.join('/') || null;
        const def = Pages[page];
        const content = document.getElementById('content');
        const token = ++this._token;

        if (!def) {
            content.innerHTML = '<div class="card"><div class="empty-state"><div class="empty-state-icon">🧭</div><div class="empty-state-title">Page not found</div><a class="btn btn-primary" href="#/dashboard">Go to dashboard</a></div></div>';
            return;
        }
        const navId = def.nav || page;
        if (!Auth.getNavigation().some(n => n.id === navId)) {
            UI.toast('You do not have access to that page.', 'error');
            location.hash = '#/dashboard';
            return;
        }

        document.getElementById('page-title').textContent = def.title;
        document.title = `${def.title} - ${Settings.get().schoolName || 'School Management System'}`;
        this.markActive(navId);
        this.closeMenu();
        content.innerHTML = '<div class="page-loading"><div class="loading-spinner" role="status" aria-label="Loading page"></div></div>';
        await new Promise(resolve => setTimeout(resolve, 60));
        if (token !== this._token) return; // user navigated again meanwhile

        try {
            content.innerHTML = def.render(param);
            if (def.init) def.init(param);
        } catch (err) {
            console.error(err);
            content.innerHTML = `<div class="card"><div class="empty-state error-state"><div class="empty-state-icon">⚠️</div><div class="empty-state-title">This page could not be displayed</div>
                <div class="empty-state-description">${esc(err.message)}</div><button type="button" class="btn btn-primary" onclick="App.route()">Try again</button></div></div>`;
        }
        window.scrollTo(0, 0);
    },

    async logout() {
        if (!(await Modal.confirm('Do you want to log out?', { title: 'Log out', confirmText: 'Log out', danger: false }))) return;
        Auth.logout();
        location.hash = '';
        location.reload();
    }
};

// Called by the login form (auth.js) after a successful login
function showApp() { document.getElementById('login-screen').classList.remove('active'); document.getElementById('main-app').classList.remove('hidden'); }
function initializeApp() { location.hash = '#/dashboard'; App.start(); }

document.addEventListener('DOMContentLoaded', () => App.init());

console.log('App module initialized');
