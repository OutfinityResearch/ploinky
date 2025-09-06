function renderVirtualHosts(virtualHosts) {
    const tbody = document.getElementById('virtualHostsTable');
    tbody.innerHTML = '';
    
    if (!virtualHosts || virtualHosts.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5">No virtual hosts found.</td></tr>';
        return;
    }

    virtualHosts.forEach(virtualHost => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${virtualHost.domain}</td>
            <td>${virtualHost.path}</td>
            <td>${virtualHost.agent}</td>
            <td><span class="status ${virtualHost.status}">${virtualHost.status}</span></td>
            <td>
                <button class="btn-success" onclick="startAgent('${virtualHost.name}')">Start</button>
                <button class="btn-danger" onclick="stopAgent('${virtualHost.name}')">Stop</button>
                <button class="btn-danger" onclick="removeVirtualHost('${virtualHost.domain}', '${virtualHost.path}')">Remove</button>
            </td>
        `;
        tbody.appendChild(row);
    });
}

async function loadVirtualHosts() {
    try {
        const response = await fetch('/management/api/virtual-hosts', {
            credentials: 'include'
        });
        
        if (response.ok) {
            const virtualHosts = await response.json();
            renderVirtualHosts(virtualHosts);
        } else {
            console.error('Failed to load virtual hosts.');
        }
    } catch (err) {
        console.error('Failed to load virtual hosts:', err);
    }
}

// Modal handling
function showModal(modalId) {
    document.getElementById(modalId).style.display = 'flex';
}

function hideModal(modalId) {
    document.getElementById(modalId).style.display = 'none';
}

// API Methods
async function startAgent(agentName) {
    try {
        await fetch(`/management/api/virtual-hosts/${agentName}/start`, {
            method: 'POST',
            credentials: 'include'
        });
        loadVirtualHosts();
    } catch (err) {
        console.error('Failed to start agent:', err);
    }
}

async function stopAgent(agentName) {
    try {
        await fetch(`/management/api/virtual-hosts/${agentName}/stop`, {
            method: 'POST',
            credentials: 'include'
        });
        loadVirtualHosts();
    } catch (err) {
        console.error('Failed to stop agent:', err);
    }
}

async function removeVirtualHost(domain, path) {
    if (!confirm('Are you sure you want to remove this virtual host?')) {
        return;
    }
    
    try {
        await fetch('/management/api/virtual-hosts', {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ domain, path }),
            credentials: 'include'
        });
        loadVirtualHosts();
    } catch (err) {
        console.error('Failed to remove virtual host:', err);
    }
}

async function loadRepositories() {
    try {
        const response = await fetch('/management/api/repositories', {
            credentials: 'include'
        });
        if (response.ok) {
            const { repositories } = await response.json();
            const repoSelect = document.getElementById('repositorySelect');
            repoSelect.innerHTML = '<option value="">Select Repository</option>';
            repositories.forEach(repo => {
                const option = document.createElement('option');
                option.value = repo.url;
                option.textContent = repo.name;
                repoSelect.appendChild(option);
            });
        }
    } catch (err) {
        console.error('Failed to load repositories:', err);
    }
}

async function createVirtualHost() {
    const domain = document.getElementById('domainInput').value;
    const path = document.getElementById('deployPath').value;
    const repository = document.getElementById('repositorySelect').value;
    const agent = document.getElementById('agentSelect').value;

    try {
        await fetch('/management/api/virtual-hosts', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ domain, path, repository, agent }),
            credentials: 'include'
        });
        loadVirtualHosts();
        hideModal('virtualHostModal');
    } catch (err) {
        console.error('Failed to create virtual host:', err);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    loadVirtualHosts();

    // Style select placeholders
    const styleSelectPlaceholder = (select) => {
        if (!select.value || select.value === '') {
            select.style.color = 'var(--text-light)';
        } else {
            select.style.color = 'var(--text-color)';
        }
    };

    const repoSelect = document.getElementById('repositorySelect');
    const agentSelect = document.getElementById('agentSelect');
    
    if (repoSelect) {
        styleSelectPlaceholder(repoSelect);
        repoSelect.addEventListener('change', () => styleSelectPlaceholder(repoSelect));
    }
    
    if (agentSelect) {
        styleSelectPlaceholder(agentSelect);
        agentSelect.addEventListener('change', () => styleSelectPlaceholder(agentSelect));
    }

    document.getElementById('newVirtualHostBtn')?.addEventListener('click', () => {
        loadRepositories();
        showModal('virtualHostModal');
        // Reset select styles
        if (repoSelect) styleSelectPlaceholder(repoSelect);
        if (agentSelect) styleSelectPlaceholder(agentSelect);
    });

    document.getElementById('repositorySelect')?.addEventListener('change', async (e) => {
        const repoUrl = e.target.value;
        if (!repoUrl) {
            const agentSelect = document.getElementById('agentSelect');
            agentSelect.innerHTML = '<option value="">Select Agent</option>';
            return;
        }

        try {
            const repoUrlBase64 = btoa(repoUrl);
            const response = await fetch(`/management/api/repositories/${repoUrlBase64}/agents`, {
                credentials: 'include'
            });
            if (response.ok) {
                const { agents } = await response.json();
                const agentSelect = document.getElementById('agentSelect');
                agentSelect.innerHTML = '<option value="">Select Agent</option>';
                agents.forEach(agent => {
                    const option = document.createElement('option');
                    option.value = agent.name;
                    option.textContent = agent.name;
                    agentSelect.appendChild(option);
                });
            }
        } catch (err) {
            console.error('Failed to load agents:', err);
        }
    });

    document.getElementById('cancelVirtualHost')?.addEventListener('click', () => {
        hideModal('virtualHostModal');
    });

    document.getElementById('virtualHostForm')?.addEventListener('submit', (e) => {
        e.preventDefault();
        createVirtualHost();
    });
});
