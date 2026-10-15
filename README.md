# School Management System (frontend only)
Pure HTML + CSS + vanilla JavaScript. Open `index.html` in a browser.

Default accounts (click one on the login page to auto-fill):
- Admin: admin@school.com / admin123
- Teacher: teacher@school.com / teacher123
- Student: student@school.com / student123
- Parent: parent@school.com / parent123

Logins for new people - the admin types every login ID and password (nothing is auto-generated):
- Add Teacher -> Login ID + password fields in the form
- Add Student -> Student login + a separate Parent login (parent sees only that student's data)
- "Logins" / "Login" button on Students / Teachers page; all accounts editable in "Users & Logins".

Library returns: students and teachers see their own books under Library > My borrowing and press
"Request return". The admin sees an alert on the Dashboard (or Library > Issue / return & history)
and presses "Accept return" (or "Decline").

Frontend-only demo authentication - NOT suitable for production security.
Data is stored in localStorage (Settings > Data tools: backup / restore / reset).
