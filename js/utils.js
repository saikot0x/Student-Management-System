/**
 * utils.js - Small shared helpers
 *  UI.toast(message, type)  - show a notification (success | error | warning | info)
 *  StringUtils.isValidEmail - simple e-mail check
 */
const UI = {
    toast(message, type = 'info', duration = 3000) {
        const container = document.getElementById('toast-container');
        if (!container) return;
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
        toast.textContent = message;
        container.appendChild(toast);
        setTimeout(() => {
            toast.classList.add('removing');
            setTimeout(() => toast.remove(), 300);
        }, duration);
    }
};

const StringUtils = {
    isValidEmail(email) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email); }
};

console.log('Utils module initialized');
