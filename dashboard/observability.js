// Chart instances
let requestPieChart = null;
let statusChart = null;
let trendsChart = null;

// Tab functionality
function initTabs() {
    const tabButtons = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');
    
    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            const targetTab = button.dataset.tab;
            
            // Update buttons
            tabButtons.forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');
            
            // Update content
            tabContents.forEach(content => content.classList.remove('active'));
            document.getElementById(`${targetTab}-tab`).classList.add('active');
            
            // Load data when switching tabs
            if (targetTab === 'logs') {
                loadLogs();
            } else if (targetTab === 'performance') {
                loadMetrics();
            }
        });
    });
}

// Logs functionality
async function loadLogs() {
    try {
        const lines = document.getElementById('logLines').value || 100;
        const response = await fetch(`/management/api/logs?lines=${lines}`, {
            credentials: 'include'
        });
        
        if (response.ok) {
            const text = await response.text();
            const logContent = document.getElementById('logContent');
            
            if (text && text.trim()) {
                // Parse and format JSON logs if possible
                const formattedLogs = formatLogs(text);
                logContent.textContent = formattedLogs;
            } else {
                logContent.textContent = 'No logs available';
            }
            
            // Scroll to bottom of logs
            const logViewer = document.querySelector('.log-viewer');
            logViewer.scrollTop = logViewer.scrollHeight;
        } else {
            document.getElementById('logContent').textContent = 'Failed to load logs';
        }
    } catch (err) {
        console.error('Error loading logs:', err);
        document.getElementById('logContent').textContent = 'Error loading logs: ' + err.message;
    }
}

function formatLogs(text) {
    const lines = text.split('\n');
    const formatted = [];
    
    lines.forEach(line => {
        if (!line.trim()) return;
        
        try {
            // Try to parse as JSON
            const log = JSON.parse(line);
            const timestamp = log.ts ? new Date(log.ts).toLocaleString() : '';
            const level = (log.level || 'info').toUpperCase();
            const message = log.message || '';
            
            formatted.push(`[${timestamp}] [${level}] ${message}`);
            
            // Add additional meta information if present
            Object.keys(log).forEach(key => {
                if (!['ts', 'level', 'message'].includes(key)) {
                    formatted.push(`  ${key}: ${JSON.stringify(log[key])}`);
                }
            });
        } catch (e) {
            // If not JSON, add as is
            formatted.push(line);
        }
    });
    
    return formatted.join('\n');
}

async function downloadLogs() {
    try {
        const today = new Date().toISOString().split('T')[0];
        const response = await fetch(`/management/api/logs/download?date=${today}`, {
            credentials: 'include'
        });
        
        if (response.ok) {
            const text = await response.text();
            const blob = new Blob([text], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `ploinky-logs-${today}.log`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } else {
            alert('Failed to download logs');
        }
    } catch (err) {
        console.error('Error downloading logs:', err);
        alert('Error downloading logs');
    }
}

// Performance metrics functionality
async function loadMetrics() {
    try {
        const timeRange = document.getElementById('timeRange').value || '24h';
        const response = await fetch(`/management/api/metrics?range=${timeRange}`, {
            credentials: 'include'
        });
        
        if (response.ok) {
            const data = await response.json();
            updateCharts(data);
            updateStats(data);
        } else {
            console.error('Failed to load metrics');
        }
    } catch (err) {
        console.error('Error loading metrics:', err);
    }
}

function updateCharts(data) {
    // Request distribution pie chart
    const pieCtx = document.getElementById('requestPieChart').getContext('2d');
    
    const totalRequests = data.totalRequests || 0;
    const totalErrors = data.totalErrors || 0;
    const unauthorizedRequests = data.unauthorizedRequests || 0;
    const successRequests = Math.max(0, totalRequests - totalErrors - unauthorizedRequests);
    
    if (requestPieChart) {
        requestPieChart.destroy();
    }
    
    requestPieChart = new Chart(pieCtx, {
        type: 'pie',
        data: {
            labels: ['Success', 'Errors', 'Unauthorized'],
            datasets: [{
                data: [successRequests, totalErrors, unauthorizedRequests],
                backgroundColor: [
                    '#7ed321',  // Success - green
                    '#e94b3c',  // Errors - red
                    '#f5a623'   // Unauthorized - orange
                ],
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: {
                    position: 'bottom'
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const label = context.label || '';
                            const value = context.parsed || 0;
                            const percentage = totalRequests > 0 ? ((value / totalRequests) * 100).toFixed(1) : 0;
                            return `${label}: ${value} (${percentage}%)`;
                        }
                    }
                }
            }
        }
    });
    
    // Status codes bar chart
    const statusCtx = document.getElementById('statusChart').getContext('2d');
    
    const statusCodes = data.statusCodes || {};
    const statusLabels = Object.keys(statusCodes).sort();
    const statusValues = statusLabels.map(code => statusCodes[code] || 0);
    
    if (statusChart) {
        statusChart.destroy();
    }
    
    statusChart = new Chart(statusCtx, {
        type: 'bar',
        data: {
            labels: statusLabels.length > 0 ? statusLabels : ['200', '400', '401', '404', '500'],
            datasets: [{
                label: 'Count',
                data: statusValues.length > 0 ? statusValues : [0, 0, 0, 0, 0],
                backgroundColor: statusLabels.map(code => {
                    if (code.startsWith('2')) return '#7ed321';  // 2xx - green
                    if (code.startsWith('4')) return '#f5a623';  // 4xx - orange
                    if (code.startsWith('5')) return '#e94b3c';  // 5xx - red
                    return '#4a90e2';  // default - blue
                })
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        stepSize: 1
                    }
                }
            },
            plugins: {
                legend: {
                    display: false
                }
            }
        }
    });
    
    // Request trends line chart
    const trendsCtx = document.getElementById('trendsChart').getContext('2d');
    
    const series = data.series || [];
    const trendLabels = series.map(point => {
        const date = new Date(point.timestamp);
        return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
    });
    const trendValues = series.map(point => point.requests || 0);
    
    if (trendsChart) {
        trendsChart.destroy();
    }
    
    trendsChart = new Chart(trendsCtx, {
        type: 'line',
        data: {
            labels: trendLabels.length > 0 ? trendLabels : ['No data'],
            datasets: [{
                label: 'Requests',
                data: trendValues.length > 0 ? trendValues : [0],
                borderColor: '#4a90e2',
                backgroundColor: 'rgba(74, 144, 226, 0.1)',
                tension: 0.3
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            scales: {
                y: {
                    beginAtZero: true
                }
            },
            plugins: {
                legend: {
                    display: false
                }
            }
        }
    });
}

function updateStats(data) {
    const totalRequests = data.totalRequests || 0;
    const totalErrors = data.totalErrors || 0;
    const unauthorizedRequests = data.unauthorizedRequests || 0;
    const successRequests = Math.max(0, totalRequests - totalErrors - unauthorizedRequests);
    
    document.getElementById('totalRequests').textContent = totalRequests.toLocaleString();
    
    const successRate = totalRequests > 0 ? ((successRequests / totalRequests) * 100).toFixed(1) : 0;
    document.getElementById('successRate').textContent = `${successRate}%`;
    
    const avgResponseTime = data.avgResponseTime || 0;
    document.getElementById('avgResponseTime').textContent = `${avgResponseTime}ms`;
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    initTabs();
    
    // Logs tab event listeners
    document.getElementById('refreshLogs')?.addEventListener('click', loadLogs);
    document.getElementById('downloadLogs')?.addEventListener('click', downloadLogs);
    document.getElementById('logLines')?.addEventListener('change', loadLogs);
    
    // Performance tab event listeners
    document.getElementById('refreshMetrics')?.addEventListener('click', loadMetrics);
    document.getElementById('timeRange')?.addEventListener('change', loadMetrics);
    
    // Load initial data
    loadLogs();
});