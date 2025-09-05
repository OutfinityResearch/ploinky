function renderDeployments(deployments) {
    const tbody = document.getElementById('deploymentsTable');
    tbody.innerHTML = '';
    
    if (!deployments || deployments.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5">No deployments found.</td></tr>';
        return;
    }

    deployments.forEach(deployment => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${deployment.domain}</td>
            <td>${deployment.path}</td>
            <td>${deployment.agent}</td>
            <td><span class="status ${deployment.status}">${deployment.status}</span></td>
            <td>
                <button class="btn-success" onclick="startAgent('${deployment.name}')">Start</button>
                <button class="btn-danger" onclick="stopAgent('${deployment.name}')">Stop</button>
                <button class="btn-danger" onclick="removeDeployment('${deployment.domain}', '${deployment.path}')">Remove</button>
            </td>
        `;
        tbody.appendChild(row);
    });
}

async function loadDeployments() {
    try {
        const response = await fetch('/management/api/deployments', {
            credentials: 'include'
        });
        
        if (response.ok) {
            const deployments = await response.json();
            renderDeployments(deployments);
        } else {
            console.error('Failed to load deployments.');
        }
    } catch (err) {
        console.error('Failed to load deployments:', err);
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
        await fetch(`/management/api/agents/${agentName}/start`, {
            method: 'POST',
            credentials: 'include'
        });
        loadDeployments();
    } catch (err) {
        console.error('Failed to start agent:', err);
    }
}

async function stopAgent(agentName) {
    try {
        await fetch(`/management/api/agents/${agentName}/stop`, {
            method: 'POST',
            credentials: 'include'
        });
        loadDeployments();
    } catch (err) {
        console.error('Failed to stop agent:', err);
    }
}

async function removeDeployment(domain, path) {
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
        loadDeployments();
    } catch (err) {
        console.error('Failed to remove deployment:', err);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    loadDeployments();

    document.getElementById('newDeploymentBtn')?.addEventListener('click', () => {
        // TODO: Load options for modal
        showModal('deploymentModal');
    });

    document.getElementById('cancelDeployment')?.addEventListener('click', () => {
        hideModal('deploymentModal');
    });

    document.getElementById('deploymentForm')?.addEventListener('submit', (e) => {
        e.preventDefault();
        // TODO: Implement createDeployment
        console.log('Creating deployment...');
        hideModal('deploymentModal');
    });
});
