async function checkDefaultPassword() {
    try {
        // This endpoint needs to be created on the server
        const response = await fetch('/management/api/is-default-password', { credentials: 'include' });
        if (response.ok) {
            const { isDefault } = await response.json();
            if (isDefault) {
                document.getElementById('password-notification').style.display = 'block';
            }
        }
    } catch (err) {
        console.error('Error checking default password:', err);
    }
}

async function loadOverviewStats() {
    try {
        const res = await fetch('/management/api/overview', { credentials: 'include' });
        if (!res.ok) return;
        const data = await res.json();
        document.getElementById('statAgents').textContent = data.activeAgents ?? 0;
        document.getElementById('statRequests').textContent = data.totalRequests ?? 0;
        document.getElementById('statErrors').textContent = data.errorRate ?? '0%';
        // Format uptime h m
        const ms = Number(data.uptime || 0);
        const hours = Math.floor(ms / 3600000);
        const minutes = Math.floor((ms % 3600000) / 60000);
        document.getElementById('statUptime').textContent = `${hours}h ${minutes}m`;
    } catch (e) {
        console.error('Failed to load overview stats', e);
    }
}

function setupEventListeners() {
    document.querySelector('.delete-notification')?.addEventListener('click', () => {
        document.getElementById('password-notification').style.display = 'none';
    });

    document.getElementById('changePasswordLink')?.addEventListener('click', (e) => {
        e.preventDefault();
        document.getElementById('passwordModal').style.display = 'flex';
    });

    document.getElementById('cancelPasswordChange')?.addEventListener('click', () => {
        document.getElementById('passwordModal').style.display = 'none';
    });

    document.getElementById('passwordForm')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const currentPassword = document.getElementById('currentPassword').value;
        const newPassword = document.getElementById('newPassword').value;
        const confirmPassword = document.getElementById('confirmPassword').value;
        const errorDiv = document.getElementById('passwordError');
        errorDiv.textContent = '';

        if (newPassword !== confirmPassword) {
            errorDiv.textContent = 'New passwords do not match.';
            return;
        }

        try {
            // This endpoint needs to be created on the server
            const response = await fetch('/management/api/change-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ currentPassword, newPassword }),
                credentials: 'include'
            });

            if (response.ok) {
                document.getElementById('passwordModal').style.display = 'none';
                alert('Password changed successfully!');
            } else {
                const { error } = await response.json();
                errorDiv.textContent = error || 'Failed to change password.';
            }
        } catch (err) {
            errorDiv.textContent = 'An error occurred.';
        }
    });
}

document.addEventListener('DOMContentLoaded', () => {
    checkDefaultPassword();
    loadOverviewStats();
    setupEventListeners();
});
