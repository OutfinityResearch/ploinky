let currentConfig = {};

function renderConfiguration() {
    document.getElementById('configPort').value = currentConfig.settings?.port || 8000;
    document.getElementById('configWorkers').value = currentConfig.settings?.workersCount || 'auto';
    document.getElementById('metricsRetention').value = currentConfig.settings?.metricsRetention || 7;
    
    renderDomainsList();
}

function renderDomainsList() {
    const container = document.getElementById('domainsList');
    container.innerHTML = '';
    
    if (currentConfig.domains) {
        currentConfig.domains.forEach(domain => {
            const domainDiv = document.createElement('div');
            domainDiv.className = 'domain-item';
            domainDiv.innerHTML = `
                <input type="text" value="${domain.name}" readonly>
                <button type="button" class="btn-danger" onclick="removeDomain('${domain.name}')">Remove</button>
            `;
            container.appendChild(domainDiv);
        });
    }
}

function addDomainInput() {
    const container = document.getElementById('domainsList');
    const domainDiv = document.createElement('div');
    domainDiv.className = 'domain-item';
    domainDiv.innerHTML = `
        <input type="text" placeholder="example.com">
        <button type="button" class="btn-success" onclick="saveNewDomain(this)">Save</button>
    `;
    container.appendChild(domainDiv);
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
    // TODO: Implement save configuration
    console.log('Saving configuration...');
}

async function removeDomain(domainName) {
    // TODO: Implement remove domain
    console.log('Removing domain:', domainName);
}

async function saveNewDomain(button) {
    const input = button.previousElementSibling;
    const domainName = input.value.trim();
    if (domainName) {
        // TODO: Implement add domain
        console.log('Adding domain:', domainName);
    }
}


document.addEventListener('DOMContentLoaded', () => {
    loadConfiguration();

    document.getElementById('configForm')?.addEventListener('submit', (e) => {
        e.preventDefault();
        saveConfiguration();
    });

    document.getElementById('addDomainBtn')?.addEventListener('click', () => {
        addDomainInput();
    });
});
