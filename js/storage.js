/**
 * storage.js - Everything the app saves goes through Store (localStorage with a safe fallback).
 * If the browser blocks localStorage (some private modes), data is kept in memory for the session only.
 */
const Store = {
    PREFIX: 'SMS_',
    _mem: {},
    _blocked: false,

    isBlocked() { return this._blocked; },

    _read(key) {
        if (!this._blocked) {
            try { return localStorage.getItem(this.PREFIX + key); } catch (e) { this._blocked = true; }
        }
        return key in this._mem ? this._mem[key] : null;
    },

    _write(key, text) {
        if (!this._blocked) {
            try { localStorage.setItem(this.PREFIX + key, text); return true; } catch (e) {
                const full = e && (e.name === 'QuotaExceededError' || e.code === 22 || e.code === 1014);
                if (full) return false; // storage is full: report the failure
                this._blocked = true;   // storage is not allowed: keep data in memory instead
            }
        }
        this._mem[key] = text;
        return true;
    },

    get(key, defaultValue = null) {
        try { const raw = this._read(key); return raw === null ? defaultValue : JSON.parse(raw); } catch (e) { return defaultValue; }
    },
    set(key, value) { try { return this._write(key, JSON.stringify(value)); } catch (e) { return false; } },
    has(key) { return this._read(key) !== null; },
    remove(key) {
        delete this._mem[key];
        if (!this._blocked) { try { localStorage.removeItem(this.PREFIX + key); } catch (e) { this._blocked = true; } }
    },
    getAllKeys() {
        const keys = new Set(Object.keys(this._mem));
        if (!this._blocked) {
            try {
                for (let i = 0; i < localStorage.length; i++) {
                    const k = localStorage.key(i);
                    if (k && k.startsWith(this.PREFIX)) keys.add(k.substring(this.PREFIX.length));
                }
            } catch (e) { this._blocked = true; }
        }
        return [...keys];
    }
};

// Probe once at start-up so Store.isBlocked() is correct before the app shows anything
try { localStorage.setItem('__probe', '1'); localStorage.removeItem('__probe'); } catch (e) { Store._blocked = true; }

// Default school settings (replaced by the demo data on first launch)
if (!Store.has('settings')) {
    Store.set('settings', {
        schoolName: 'Global School', schoolAddress: '123 Education Street, City, Country', schoolPhone: '+1-800-SCHOOL',
        schoolEmail: 'info@school.com', currency: '$', academicSession: String(new Date().getFullYear()), theme: 'light'
    });
}
if (!Store.has('theme')) Store.set('theme', (Store.get('settings', {}).theme) || 'light');

console.log('Store module initialized');
