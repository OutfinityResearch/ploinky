function renderRepositories(repos) {
    const container = document.getElementById('repositories');
    container.innerHTML = '';

    if (!repos || repos.length === 0) {
        container.innerHTML = '<p>No repositories found.</p>';
        return;
    }
    
    repos.forEach(repo => {
        const repoDiv = document.createElement('div');
        repoDiv.className = 'repo-item';
        repoDiv.innerHTML = `
            <h4>${repo.name}</h4>
            <p>${repo.url}</p>
            <button class="btn-danger" onclick="removeRepository('${repo.url}')">Remove</button>
        `;
        container.appendChild(repoDiv);
    });
}

async function loadAgents() {
    try {
        const response = await fetch('/management/api/repositories', {
            credentials: 'include'
        });
        
        if (response.ok) {
            const repos = await response.json();
            renderRepositories(repos);
        } else {
            console.error('Failed to load repositories.');
        }
    } catch (err) {
        console.error('Failed to load repositories:', err);
    }
}

// Modal handling
function showModal(modalId) {
    document.getElementById(modalId).style.display = 'flex';
}

function hideModal(modalId) {
    document.getElementById(modalId).style.display = 'none';
}

async function removeRepository(repoUrl) {
    if (!confirm('Are you sure you want to remove this repository?')) {
        return;
    }
    // TODO: Implement API call to remove repository
    console.log('Removing repository:', repoUrl);
}

document.addEventListener('DOMContentLoaded', () => {
    loadAgents();

    document.getElementById('addRepoBtn')?.addEventListener('click', () => {
        showModal('repoModal');
    });

    document.getElementById('cancelRepo')?.addEventListener('click', () => {
        hideModal('repoModal');
    });

    document.getElementById('repoForm')?.addEventListener('submit', (e) => {
        e.preventDefault();
        // TODO: Implement addRepository
        console.log('Adding repository...');
        hideModal('repoModal');
    });
});
