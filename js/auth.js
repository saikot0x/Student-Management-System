/**
 * Authentication Module - Login and user management
 */

const Auth = {
    // Demo users database
    DEMO_USERS: [
        {
            id: 'admin-1',
            email: 'admin@school.com',
            password: 'admin123',
            name: 'Admin User',
            role: 'admin',
            avatar: 'A'
        },
        {
            id: 'teacher-1',
            email: 'teacher@school.com',
            password: 'teacher123',
            name: 'John Carter',
            role: 'teacher',
            avatar: 'JC'
        },
        {
            id: 'student-1',
            email: 'student@school.com',
            password: 'student123',
            name: 'Alice Johnson',
            role: 'student',
            avatar: 'AJ'
        },
        {
            id: 'parent-1',
            email: 'parent@school.com',
            password: 'parent123',
            name: 'Robert Johnson',
            role: 'parent',
            avatar: 'RJ'
        }
    ],

    // Role-based permissions
    PERMISSIONS: {
        admin: ['manage_students', 'manage_teachers', 'manage_staff', 'manage_classes', 'manage_attendance', 'manage_exams', 'manage_fees', 'manage_library', 'manage_notices', 'manage_settings', 'view_reports'],
        teacher: ['view_students', 'manage_attendance', 'manage_exams', 'view_fees', 'manage_assignments', 'view_reports'],
        student: ['view_profile', 'view_attendance', 'view_marks', 'view_fees', 'view_library', 'view_assignments'],
        parent: ['view_child_profile', 'view_child_attendance', 'view_child_marks', 'view_child_fees']
    },

    // Role-based navigation
    ROLE_NAVIGATION: {
        admin: [
            { id: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
            { id: 'students', label: 'Students', icon: 'people' },
            { id: 'teachers', label: 'Teachers', icon: 'person' },
            { id: 'staff', label: 'Staff', icon: 'person_outline' },
            { id: 'classes', label: 'Classes', icon: 'class' },
            { id: 'subjects', label: 'Subjects', icon: 'book' },
            { id: 'routine', label: 'Timetable', icon: 'schedule' },
            { id: 'attendance', label: 'Attendance', icon: 'check_circle' },
            { id: 'exams', label: 'Exams', icon: 'assignment' },
            { id: 'results', label: 'Results', icon: 'grade' },
            { id: 'fees', label: 'Fees', icon: 'payment' },
            { id: 'library', label: 'Library', icon: 'library_books' },
            { id: 'notices', label: 'Notices', icon: 'notifications' },
            { id: 'assignments', label: 'Assignments', icon: 'description' },
            { id: 'reports', label: 'Reports', icon: 'insert_chart' },
            { id: 'users', label: 'Users & Logins', icon: 'lock' },
            { id: 'settings', label: 'Settings', icon: 'settings' }
        ],
        teacher: [
            { id: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
            { id: 'students', label: 'Students', icon: 'people' },
            { id: 'routine', label: 'Timetable', icon: 'schedule' },
            { id: 'attendance', label: 'Attendance', icon: 'check_circle' },
            { id: 'exams', label: 'Exams', icon: 'assignment' },
            { id: 'results', label: 'Results', icon: 'grade' },
            { id: 'assignments', label: 'Assignments', icon: 'description' },
            { id: 'library', label: 'Library', icon: 'library_books' },
            { id: 'notices', label: 'Notices', icon: 'notifications' }
        ],
        student: [
            { id: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
            { id: 'profile', label: 'My Profile', icon: 'person' },
            { id: 'routine', label: 'Timetable', icon: 'schedule' },
            { id: 'attendance', label: 'Attendance', icon: 'check_circle' },
            { id: 'results', label: 'Results', icon: 'grade' },
            { id: 'fees', label: 'Fees', icon: 'payment' },
            { id: 'assignments', label: 'Assignments', icon: 'description' },
            { id: 'library', label: 'Library', icon: 'library_books' },
            { id: 'notices', label: 'Notices', icon: 'notifications' }
        ],
        parent: [
            { id: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
            { id: 'profile', label: "Child's Profile", icon: 'person' },
            { id: 'routine', label: 'Timetable', icon: 'schedule' },
            { id: 'attendance', label: "Child's Attendance", icon: 'check_circle' },
            { id: 'results', label: "Child's Results", icon: 'grade' },
            { id: 'fees', label: "Child's Fees", icon: 'payment' },
            { id: 'notices', label: 'Notices', icon: 'notifications' }
        ]
    },

    /**
     * Login user
     * @param {string} email - User email
     * @param {string} password - User password
     * @returns {object} User object if successful
     */
    findUser(email, password) {
        const list = typeof DB !== 'undefined' && DB.all('users').length ? DB.all('users') : this.DEMO_USERS;
        return list.find(u => String(u.email).toLowerCase() === String(email).toLowerCase() && u.password === password) || null;
    },

    sessionFor(u) {
        const avatar = String(u.name).split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
        return { id: u.id, email: u.email, name: u.name, role: u.role, avatar, studentId: u.studentId || null, teacherId: u.teacherId || null };
    },

    login(email, password) {
        const user = this.findUser(email, password);
        
        if (user) {
            // Store session
            Store.set('currentUser', this.sessionFor(user));
            Store.set('isLoggedIn', true);
            return user;
        }
        
        return null;
    },

    /**
     * Logout user
     */
    logout() {
        Store.remove('currentUser');
        Store.set('isLoggedIn', false);
    },

    /**
     * Get current user
     * @returns {object} Current user object
     */
    getCurrentUser() {
        return Store.get('currentUser', null);
    },

    /**
     * Check if user is logged in
     * @returns {boolean} Whether user is logged in
     */
    isLoggedIn() {
        return Store.get('isLoggedIn', false);
    },

    /**
     * Get user permissions
     * @returns {array} Array of permissions
     */
    getPermissions() {
        const user = this.getCurrentUser();
        if (!user) return [];
        return this.PERMISSIONS[user.role] || [];
    },

    /**
     * Check if user has permission
     * @param {string} permission - Permission to check
     * @returns {boolean} Whether user has permission
     */
    hasPermission(permission) {
        return this.getPermissions().includes(permission);
    },

    /**
     * Get user role
     * @returns {string} User role
     */
    getRole() {
        const user = this.getCurrentUser();
        return user ? user.role : null;
    },

    /**
     * Get navigation menu for current user
     * @returns {array} Navigation items
     */
    getNavigation() {
        const role = this.getRole();
        return this.ROLE_NAVIGATION[role] || [];
    },

    /**
     * Get role display name
     * @param {string} role - Role code
     * @returns {string} Role display name
     */
    getRoleDisplayName(role) {
        const roleNames = {
            admin: 'Administrator',
            teacher: 'Teacher',
            student: 'Student',
            parent: 'Parent'
        };
        return roleNames[role] || role;
    },

    /**
     * Check if user is admin
     * @returns {boolean} Whether user is admin
     */
    isAdmin() {
        return this.getRole() === 'admin';
    },

    /**
     * Check if user is teacher
     * @returns {boolean} Whether user is teacher
     */
    isTeacher() {
        return this.getRole() === 'teacher';
    },

    /**
     * Check if user is student
     * @returns {boolean} Whether user is student
     */
    isStudent() {
        return this.getRole() === 'student';
    },

    /**
     * Check if user is parent
     * @returns {boolean} Whether user is parent
     */
    isParent() {
        return this.getRole() === 'parent';
    },
};

// Setup login form handler
document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('login-form');
    if (loginForm) {
        loginForm.addEventListener('submit', (e) => {
            e.preventDefault();
            
            const email = document.getElementById('email').value.trim();
            const password = document.getElementById('password').value.trim();
            const errorElement = document.getElementById('login-error');

            if (!email || !password) {
                errorElement.textContent = 'Please enter both email and password';
                errorElement.classList.add('show');
                return;
            }

            const user = Auth.login(email, password);
            
            if (user) {
                errorElement.classList.remove('show');
                // Redirect to app
                showApp();
                initializeApp();
            } else {
                errorElement.textContent = 'Invalid email or password';
                errorElement.classList.add('show');
            }
        });
    }
});

console.log('Auth module initialized');
