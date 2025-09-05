let requestChartInstance = null;

function renderAgentTable(agentsMetrics) {
    const tbody = document.getElementById('agentMetricsTable');
    tbody.innerHTML = '';

    if (agentsMetrics && Object.keys(agentsMetrics).length > 0) {
        Object.entries(agentsMetrics).forEach(([agent, data]) => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${agent}</td>
                <td>${data.count ?? 0}</td>
                <td>${data.avgDuration ?? '-'}${data.avgDuration ? 'ms' : ''}</td>
                <td>${data.errorRate ?? '-'}</td>
            `;
            tbody.appendChild(row);
        });
    } else {
        tbody.innerHTML = '<tr><td colspan="4">No agent metrics available.</td></tr>';
    }
}

function renderCharts(summary) {
    const ctx = document.getElementById('requestChart').getContext('2d');
    const totalRequests = Number(summary.totalRequests || 0);
    const errorRateStr = String(summary.errorRate || '0%');
    const errorRate = parseFloat(errorRateStr.replace('%', '')) || 0;
    const errorCount = Math.round(totalRequests * (errorRate / 100));
    const successCount = Math.max(totalRequests - errorCount, 0);

    if (requestChartInstance) {
        requestChartInstance.destroy();
    }

    requestChartInstance = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Success', 'Errors'],
            datasets: [{
                data: [successCount, errorCount],
                backgroundColor: ['#7ed321', '#e94b3c'],
                borderWidth: 0
            }]
        },
        options: {
            plugins: {
                legend: { position: 'bottom' }
            }
        }
    });
}

async function fetchOverview() {
    const res = await fetch('/management/api/overview', { credentials: 'include' });
    if (!res.ok) throw new Error('overview failed');
    return res.json();
}

async function fetchMetrics(range) {
    // Try metrics endpoint if available; fall back to overview-only
    const res = await fetch(`/management/api/metrics?range=${range}`, { credentials: 'include' });
    if (res.ok) return res.json();
    return null;
}

async function loadMetrics() {
    try {
        const timeRange = document.getElementById('timeRange').value;
        const [summary, metrics] = await Promise.all([
            fetchOverview(),
            fetchMetrics(timeRange)
        ]);

        // Charts from summary
        renderCharts(summary);

        // Agent table from metrics if available
        renderAgentTable(metrics && metrics.agents ? metrics.agents : null);
    } catch (err) {
        console.error('Failed to load metrics:', err);
        renderAgentTable(null);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    loadMetrics();
    document.getElementById('refreshMetrics')?.addEventListener('click', loadMetrics);
});
