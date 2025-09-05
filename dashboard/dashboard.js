// Ploinky Cloud Dashboard JavaScript

class Dashboard {
    constructor() {
        this.client = new PloinkyClient(window.location.origin);
        this.currentView = 'overview';
        this.isAuthenticated = false;
        this.config = {};
        this.metrics = {};
        
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.checkAuthentication();
    }

    setupEventListeners() {
        // Navigation
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const view = e.target.dataset.view;
                if (view) {
                    this.switchView(view);
                }
            });
        });

        // Login
        document.getElementById('loginForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleLogin();
        });

        document.getElementById('logoutBtn').addEventListener('click', () => {
            this.handleLogout();
        });

        // Deployments
        document.getElementById('newDeploymentBtn')?.addEventListener('click', () => {
            this.showDeploymentModal();
        });

        document.getElementById('deploymentForm')?.addEventListener('submit', (e) => {
            e.preventDefault();
            this.createDeployment();
        });

        document.getElementById('cancelDeployment')?.addEventListener('click', () => {
            this.hideModal('deploymentModal');
        });

        // Repositories
        document.getElementById('addRepoBtn')?.addEventListener('click', () => {
            this.showRepoModal();
        });

        document.getElementById('repoForm')?.addEventListener('submit', (e) => {
            e.preventDefault();
            this.addRepository();
        });

        document.getElementById('cancelRepo')?.addEventListener('click', () => {
            this.hideModal('repoModal');
        });

        // Configuration
        document.getElementById('configForm')?.addEventListener('submit', (e) => {
            e.preventDefault();
            this.saveConfiguration();
        });

        document.getElementById('addDomainBtn')?.addEventListener('click', () => {
            this.addDomainInput();
        });

        // Metrics
        document.getElementById('refreshMetrics')?.addEventListener('click', () => {
            this.loadMetrics();
        });
    }

    async checkAuthentication() {
        try {
            const response = await fetch('/management/check-auth', {
                credentials: 'include'
            });
            
            if (response.ok) {
                this.isAuthenticated = true;
                this.showView('overview');
                this.loadDashboard();
            } else {
                this.showView('login');
            }
        } catch (err) {
            this.showView('login');
        }
    }

    async handleLogin() {
        const password = document.getElementById('adminPassword').value;
        
        try {
            const response = await fetch('/management/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ password }),
                credentials: 'include'
            });

            if (response.ok) {
                this.isAuthenticated = true;
                document.getElementById('loginError').textContent = '';
                this.showView('overview');
                this.loadDashboard();
            } else {
                document.getElementById('loginError').textContent = 'Invalid password';
            }
        } catch (err) {
            document.getElementById('loginError').textContent = 'Login failed';
        }
    }

    async handleLogout() {
        try {
            await fetch('/management/logout', {
                method: 'POST',
                credentials: 'include'
            });
        } catch (err) {
            console.error('Logout error:', err);
        }
        
        this.isAuthenticated = false;
        this.showView('login');
    }

    switchView(viewName) {
        if (!this.isAuthenticated && viewName !== 'login') {
            return;
        }

        this.currentView = viewName;
        
        // Update navigation
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.view === viewName);
        });

        // Show/hide views
        document.querySelectorAll('.view').forEach(view => {
            view.style.display = 'none';
        });
        
        const viewElement = document.getElementById(`${viewName}View`);
        if (viewElement) {
            viewElement.style.display = 'block';
            this.loadViewData(viewName);
        }
    }

    showView(viewName) {
        document.querySelectorAll('.view').forEach(view => {
            view.style.display = 'none';
        });
        
        const viewElement = document.getElementById(`${viewName}View`);
        if (viewElement) {
            viewElement.style.display = 'block';
        }
    }

    async loadViewData(viewName) {
        switch (viewName) {
            case 'overview':
                await this.loadOverview();
                break;
            case 'deployments':
                await this.loadDeployments();
                break;
            case 'agents':
                await this.loadAgents();
                break;
            case 'metrics':
                await this.loadMetrics();
                break;
            case 'config':
                await this.loadConfiguration();
                break;
        }
    }

    async loadDashboard() {
        await this.loadOverview();
    }

    async loadOverview() {
        try {
            const response = await fetch('/management/api/overview', {
                credentials: 'include'
            });
            
            if (response.ok) {
                const data = await response.json();
                
                document.getElementById('totalRequests').textContent = data.totalRequests || 0;
                document.getElementById('activeAgents').textContent = data.activeAgents || 0;
                document.getElementById('errorRate').textContent = data.errorRate || '0%';
                document.getElementById('uptime').textContent = this.formatUptime(data.uptime);
                
                this.updateRecentActivity(data.recentActivity || []);
            }
        } catch (err) {
            console.error('Failed to load overview:', err);
        }
    }

    async loadDeployments() {
        try {
            const response = await fetch('/management/api/deployments', {
                credentials: 'include'
            });
            
            if (response.ok) {
                const deployments = await response.json();
                this.renderDeployments(deployments);
            }
        } catch (err) {
            console.error('Failed to load deployments:', err);
        }
    }

    renderDeployments(deployments) {
        const tbody = document.getElementById('deploymentsTable');
        tbody.innerHTML = '';
        
        deployments.forEach(deployment => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${deployment.domain}</td>
                <td>${deployment.path}</td>
                <td>${deployment.agent}</td>
                <td><span class="status ${deployment.status}">${deployment.status}</span></td>
                <td>
                    <button class="btn-success" onclick="dashboard.startAgent('${deployment.name}')">Start</button>
                    <button class="btn-danger" onclick="dashboard.stopAgent('${deployment.name}')">Stop</button>
                    <button class="btn-danger" onclick="dashboard.removeDeployment('${deployment.domain}', '${deployment.path}')">Remove</button>
                </td>
            `;
            tbody.appendChild(row);
        });
    }

    async loadAgents() {
        try {
            const response = await fetch('/management/api/repositories', {
                credentials: 'include'
            });
            
            if (response.ok) {
                const repos = await response.json();
                this.renderRepositories(repos);
            }
        } catch (err) {
            console.error('Failed to load repositories:', err);
        }
    }

    renderRepositories(repos) {
        const container = document.getElementById('repositories');
        container.innerHTML = '';
        
        repos.forEach(repo => {
            const repoDiv = document.createElement('div');
            repoDiv.className = 'repo-item';
            repoDiv.innerHTML = `
                <h4>${repo.name}</h4>
                <p>${repo.url}</p>
                <button onclick="dashboard.removeRepository('${repo.url}')">Remove</button>
            `;
            container.appendChild(repoDiv);
        });
    }

    async loadMetrics() {
        try {
            const timeRange = document.getElementById('timeRange').value;
            const response = await fetch(`/management/api/metrics?range=${timeRange}`, {
                credentials: 'include'
            });
            
            if (response.ok) {
                const metrics = await response.json();
                this.renderMetrics(metrics);
            }
        } catch (err) {
            console.error('Failed to load metrics:', err);
        }
    }

    renderMetrics(metrics) {
        // Render agent metrics table
        const tbody = document.getElementById('agentMetricsTable');
        tbody.innerHTML = '';
        
        if (metrics.agents) {
            Object.entries(metrics.agents).forEach(([agent, data]) => {
                const row = document.createElement('tr');
                row.innerHTML = `
                    <td>${agent}</td>
                    <td>${data.count}</td>
                    <td>${data.avgDuration}ms</td>
                    <td>${data.errorRate}</td>
                `;
                tbody.appendChild(row);
            });
        }
    }

    async loadConfiguration() {
        try {
            const response = await fetch('/management/api/config', {
                credentials: 'include'
            });
            
            if (response.ok) {
                this.config = await response.json();
                this.renderConfiguration();
            }
        } catch (err) {
            console.error('Failed to load configuration:', err);
        }
    }

    renderConfiguration() {
        document.getElementById('configPort').value = this.config.settings?.port || 8000;
        document.getElementById('configWorkers').value = this.config.settings?.workersCount || 'auto';
        document.getElementById('metricsRetention').value = this.config.settings?.metricsRetention || 7;
        
        this.renderDomainsList();
    }

    renderDomainsList() {
        const container = document.getElementById('domainsList');
        container.innerHTML = '';
        
        if (this.config.domains) {
            this.config.domains.forEach(domain => {
                const domainDiv = document.createElement('div');
                domainDiv.innerHTML = `
                    <input type="text" value="${domain.name}" data-domain="${domain.name}">
                    <button type="button" onclick="dashboard.removeDomain('${domain.name}')">Remove</button>
                `;
                container.appendChild(domainDiv);
            });
        }
    }

    updateRecentActivity(activities) {
        const container = document.getElementById('recentActivity');
        container.innerHTML = '';
        
        activities.forEach(activity => {
            const item = document.createElement('div');
            item.className = 'activity-item';
            item.textContent = `${activity.timestamp}: ${activity.message}`;
            container.appendChild(item);
        });
    }

    formatUptime(milliseconds) {
        const hours = Math.floor(milliseconds / 3600000);
        const minutes = Math.floor((milliseconds % 3600000) / 60000);
        
        if (hours > 24) {
            const days = Math.floor(hours / 24);
            return `${days}d ${hours % 24}h`;
        }
        
        return `${hours}h ${minutes}m`;
    }

    showModal(modalId) {
        document.getElementById(modalId).style.display = 'flex';
    }

    hideModal(modalId) {
        document.getElementById(modalId).style.display = 'none';
    }

    showDeploymentModal() {
        // Load domains and agents for selection
        this.loadDeploymentOptions();
        this.showModal('deploymentModal');
    }

    showRepoModal() {
        this.showModal('repoModal');
    }

    async loadDeploymentOptions() {
        // This would load available domains and agents
        // For now, using placeholder data
        const domainSelect = document.getElementById('domainSelect');
        domainSelect.innerHTML = '<option value="">Select Domain</option>';
        
        if (this.config.domains) {
            this.config.domains.forEach(domain => {
                const option = document.createElement('option');
                option.value = domain.name;
                option.textContent = domain.name;
                domainSelect.appendChild(option);
            });
        }
    }

    // API Methods
    async startAgent(agentName) {
        try {
            await fetch(`/management/api/agents/${agentName}/start`, {
                method: 'POST',
                credentials: 'include'
            });
            this.loadDeployments();
        } catch (err) {
            console.error('Failed to start agent:', err);
        }
    }

    async stopAgent(agentName) {
        try {
            await fetch(`/management/api/agents/${agentName}/stop`, {
                method: 'POST',
                credentials: 'include'
            });
            this.loadDeployments();
        } catch (err) {
            console.error('Failed to stop agent:', err);
        }
    }

    async removeDeployment(domain, path) {
        if (!confirm('Are you sure you want to remove this deployment?')) {
            return;
        }
        
        try {
            await fetch('/management/api/deployments', {
                method: 'DELETE',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ domain, path }),
                credentials: 'include'
            });
            this.loadDeployments();
        } catch (err) {
            console.error('Failed to remove deployment:', err);
        }
    }
}

// Initialize dashboard when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.dashboard = new Dashboard();
});