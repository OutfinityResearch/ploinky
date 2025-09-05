async function checkAuthentication() {
    try {
        const response = await fetch('/management/api/check-auth', {
            credentials: 'include'
        });
        if (!response.ok) {
            window.location.href = '/management/login.html';
        }
    } catch (err) {
        console.error('Authentication check failed:', err);
        window.location.href = '/management/login.html';
    }
}

async function handleLogout() {
    try {
        await fetch('/management/logout', {
            method: 'POST',
            credentials: 'include'
        });
    } catch (err) {
        console.error('Logout error:', err);
    }
    window.location.href = '/management/login.html';
}

document.addEventListener('DOMContentLoaded', () => {
    checkAuthentication();

    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', handleLogout);
    }
});
