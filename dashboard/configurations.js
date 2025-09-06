let currentConfig = {};

function renderConfiguration() {
    document.getElementById('configWorkers').value = currentConfig.settings?.workersCount || 'auto';
    document.getElementById('metricsRetention').value = currentConfig.settings?.metricsRetention || 365;
    document.getElementById('logLevel').value = currentConfig.settings?.logLevel || 'info';
}

async function loadConfiguration() {
    try {
        const response = await fetch('/management/api/config', {
            credentials: 'include'
        });
        if (response.ok) {
            currentConfig = await response.json();
            renderConfiguration();
        } else {
            console.error('Failed to load configuration.');
        }
    } catch (err) {
        console.error('Failed to load configuration:', err);
    }
}

async function saveConfiguration() {
    const settings = {
        workersCount: document.getElementById('configWorkers').value,
        metricsRetention: parseInt(document.getElementById('metricsRetention').value, 10),
        logLevel: document.getElementById('logLevel').value
    };
    try {
        const response = await fetch('/management/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(settings)
        });
        if (!response.ok) throw new Error('Failed');
        alert('Configuration saved');
        loadConfiguration();
    } catch (e) { alert('Failed to save configuration'); }
}

document.addEventListener('DOMContentLoaded', () => {
    loadConfiguration();
    document.getElementById('configForm')?.addEventListener('submit', (e) => {
        e.preventDefault();
        saveConfiguration();
    });
    
});

