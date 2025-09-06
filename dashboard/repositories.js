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

async function loadRepositories() {
    try {
        const response = await fetch('/management/api/repositories', {
            credentials: 'include'
        });
        
        if (response.ok) {
            const data = await response.json();
            renderRepositories(data.repositories || []);
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
    try {
        await fetch('/management/api/repositories', {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ url: repoUrl }),
            credentials: 'include'
        });
        loadRepositories();
    } catch (err) {
        console.error('Failed to remove repository:', err);
    }
}

async function addRepository() {
    const repoName = document.getElementById('repoName').value;
    const repoUrl = document.getElementById('repoUrl').value;
    try {
        await fetch('/management/api/repositories', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ name: repoName, url: repoUrl }),
            credentials: 'include'
        });
        loadRepositories();
        hideModal('repoModal');
    } catch (err) {
        console.error('Failed to add repository:', err);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    loadRepositories();

    document.getElementById('addRepoBtn')?.addEventListener('click', () => {
        showModal('repoModal');
    });

    document.getElementById('cancelRepo')?.addEventListener('click', () => {
        hideModal('repoModal');
    });

    document.getElementById('repoForm')?.addEventListener('submit', (e) => {
        e.preventDefault();
        addRepository();
    });
});
