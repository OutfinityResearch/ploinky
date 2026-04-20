async function includePartials() {
    const includeNodes = Array.from(document.querySelectorAll('[data-include]'));
    await Promise.all(includeNodes.map(async (node) => {
        const target = node.getAttribute('data-include');
        if (!target) {
            return;
        }
        const response = await fetch(target);
        if (!response.ok) {
            throw new Error(`Failed to load partial: ${target}`);
        }
        node.outerHTML = await response.text();
    }));
}

function markActivePage() {
    const currentPage = document.body.dataset.page || '';
    if (!currentPage) {
        return;
    }
    const active = document.querySelector(`.site-nav a[data-page="${currentPage}"]`);
    if (active) {
        active.setAttribute('aria-current', 'page');
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    try {
        await includePartials();
        markActivePage();
    } catch (error) {
        console.error(error);
    }
});
