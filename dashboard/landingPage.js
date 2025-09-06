async function checkDefaultPassword() { /* removed in API Key mode */ }

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
        if (document.getElementById('statUnauthorized')) {
            document.getElementById('statUnauthorized').textContent = data.unauthorizedRequests ?? 0;
        }
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

    // Quick logs
    document.getElementById('showLogsBtn')?.addEventListener('click', async () => {
        const lines = Number(document.getElementById('lastLines').value || 200);
        const res = await fetch(`/management/api/logs?lines=${lines}`, { credentials: 'include' });
        const text = await res.text();
        document.getElementById('lastLogs').textContent = text || '(no logs)';
    });
    document.getElementById('downloadTodayBtn')?.addEventListener('click', async () => {
        const today = new Date().toISOString().slice(0,10);
        const res = await fetch(`/management/api/logs/download?date=${today}`, { credentials: 'include' });
        const blob = new Blob([await res.text()], { type: 'text/plain' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `p-cloud-${today}.log`;
        a.click();
    });
}

document.addEventListener('DOMContentLoaded', () => {
    checkDefaultPassword();
    loadOverviewStats();
    setupEventListeners();
    // Animate stat values
    const animate = (el, to) => {
        const target = Number(String(to).replace(/[^\d]/g, '')) || 0;
        let current = 0;
        const step = Math.max(1, Math.floor(target / 40));
        const interval = setInterval(() => {
            current += step;
            if (current >= target) { current = target; clearInterval(interval); }
            if (el.id === 'statErrors') el.textContent = String(to);
            else el.textContent = current;
        }, 20);
    };
    setTimeout(() => {
        const a = document.getElementById('statAgents');
        const r = document.getElementById('statRequests');
        const e = document.getElementById('statErrors');
        const u = document.getElementById('statUptime');
        if (a && r && e && u) {
            animate(a, a.textContent);
            animate(r, r.textContent);
        }
    }, 300);
});
