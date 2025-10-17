function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

function getFileIcon(fileName) {
    const extension = (fileName || '').split('.').pop().toLowerCase();
    const iconMap = {
        'pdf': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path fill-rule="evenodd" d="M5.625 1.5c-1.036 0-1.875.84-1.875 1.875v17.25c0 1.035.84 1.875 1.875 1.875h12.75c1.035 0 1.875-.84 1.875-1.875V12.75A3.75 3.75 0 0016.5 9h-1.875a.375.375 0 01-.375-.375V6.75A3.75 3.75 0 009 3H5.625zM12.75 12.75a.75.75 0 00-1.5 0v2.25H9a.75.75 0 000 1.5h2.25v2.25a.75.75 0 001.5 0v-2.25H15a.75.75 0 000-1.5h-2.25V12.75zM15 3.75a.75.75 0 00-.75-.75h-1.5a.75.75 0 000 1.5h1.5a.75.75 0 00.75-.75z" clip-rule="evenodd" /></svg>',
        'doc': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path fill-rule="evenodd" d="M5.625 1.5c-1.036 0-1.875.84-1.875 1.875v17.25c0 1.035.84 1.875 1.875 1.875h12.75c1.035 0 1.875-.84 1.875-1.875V12.75A3.75 3.75 0 0016.5 9h-1.875a.375.375 0 01-.375-.375V6.75A3.75 3.75 0 009 3H5.625zM12.75 12.75a.75.75 0 00-1.5 0v2.25H9a.75.75 0 000 1.5h2.25v2.25a.75.75 0 001.5 0v-2.25H15a.75.75 0 000-1.5h-2.25V12.75zM15 3.75a.75.75 0 00-.75-.75h-1.5a.75.75 0 000 1.5h1.5a.75.75 0 00.75-.75z" clip-rule="evenodd" /></svg>',
        'docx': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path fill-rule="evenodd" d="M5.625 1.5c-1.036 0-1.875.84-1.875 1.875v17.25c0 1.035.84 1.875 1.875 1.875h12.75c1.035 0 1.875-.84 1.875-1.875V12.75A3.75 3.75 0 0016.5 9h-1.875a.375.375 0 01-.375-.375V6.75A3.75 3.75 0 009 3H5.625zM12.75 12.75a.75.75 0 00-1.5 0v2.25H9a.75.75 0 000 1.5h2.25v2.25a.75.75 0 001.5 0v-2.25H15a.75.75 0 000-1.5h-2.25V12.75zM15 3.75a.75.75 0 00-.75-.75h-1.5a.75.75 0 000 1.5h1.5a.75.75 0 00.75-.75z" clip-rule="evenodd" /></svg>',
        'zip': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path fill-rule="evenodd" d="M2.25 2.25a.75.75 0 000 1.5h.141a2.252 2.252 0 011.984 1.556l.01.035.01.034.008.027.01.035.008.027.006.02.008.027.006.02.005.015.008.026.004.013.005.014.004.01.004.01.004.01.003.008.003.008.003.007.003.006.001.004c.001.003.002.005.003.008l.003.007.001.004.002.005.002.004.001.002.001.002h14.092l.001-.002.001-.002.002-.004.002-.005.001-.004.003-.007c.001-.003.002-.005.003-.008l.001-.004.003-.006.003-.007.003-.008.004-.01.003-.008.004-.01.004-.01.005-.014.004-.013.008-.026.005-.015.006-.02.008-.027.006-.02.01-.035.008-.027.01-.034.01-.035a2.252 2.252 0 011.984-1.556h.141a.75.75 0 000-1.5H2.25zM3.003 9.119l.003-.008.004-.01.005-.012.005-.012.007-.017.005-.012.007-.017.008-.018.007-.015.008-.018.008-.017.008-.016.008-.015.008-.014.008-.012.008-.012.008-.01.008-.01.007-.008.007-.007.007-.006.006-.005.005-.004.004-.003.003-.002.002-.001h17.982l.002.001.003.002.004.003.005.004.006.005.007.006.007.007.007.008.008.01.008.01.008.012.008.012.008.014.008.015.008.016.008.017.008.018.007.015.008.018.007.017.005.012.007.017.005.012.004.01.003.008.001.004V19.5a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 19.5V9.122l.001-.002.002-.001z" clip-rule="evenodd" /></svg>',
        'default': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor"><path d="M5.25 3.75A2.25 2.25 0 003 6v12a2.25 2.25 0 002.25 2.25h13.5A2.25 2.25 0 0021 18V6a2.25 2.25 0 00-2.25-2.25H5.25zm.75 13.5a.75.75 0 000 1.5h12a.75.75 0 000-1.5H6zm0-3a.75.75 0 000 1.5h12a.75.75 0 000-1.5H6zm0-3a.75.75 0 000 1.5h12a.75.75 0 000-1.5H6z" /></svg>'
    };
    const icon = iconMap[extension] || iconMap['default'];
    return `<div class="wa-file-icon">${icon}</div>`;
}

export function createUploader({
    attachmentBtn,
    attachmentMenu,
    uploadFileBtn,
    fileUploadInput,
    filePreviewContainer,
    attachmentContainer
}, { composer }) {

    let selectedFile = null;

    function toggleMenu(e) {
        e.stopPropagation();
        attachmentMenu.classList.toggle('show');
    }

    function openFilePicker() {
        fileUploadInput.click();
        attachmentMenu.classList.remove('show');
    }

    function displayFilePreview(file) {
        filePreviewContainer.innerHTML = '';
        const isImage = file.type.startsWith('image/');
        
        const item = document.createElement('div');
        item.className = 'wa-file-preview-item';

        let thumbnailHTML = '';
        if (isImage) {
            thumbnailHTML = `<div class="wa-file-preview-thumbnail"><img id="filePreviewImage" src="" alt="Preview"></div>`;
        } else {
            thumbnailHTML = `<div class="wa-file-preview-thumbnail">${getFileIcon(file.name)}</div>`;
        }

        item.innerHTML = `
            ${thumbnailHTML}
            <div class="wa-file-preview-info">
                <div class="wa-file-preview-name"></div>
                <div class="wa-file-preview-size"></div>
            </div>
            <button class="wa-file-preview-remove" title="Remove file">&times;</button>
        `;

        item.querySelector('.wa-file-preview-name').textContent = file.name;
        item.querySelector('.wa-file-preview-size').textContent = formatBytes(file.size);
        
        if (isImage) {
            const reader = new FileReader();
            reader.onload = (e) => {
                item.querySelector('#filePreviewImage').src = e.target.result;
            };
            reader.readAsDataURL(file);
        }

        item.querySelector('.wa-file-preview-remove').onclick = (e) => {
            e.stopPropagation();
            clearFile();
        };

        filePreviewContainer.appendChild(item);
        filePreviewContainer.classList.add('show');
        composer.autoResize();
    }

    function handleFileSelection(event) {
        const file = event.target.files[0];
        if (!file) return;

        selectedFile = file;
        displayFilePreview(file);
        fileUploadInput.value = ''; // Reset for next selection
    }
    
    function clearFile() {
        selectedFile = null;
        filePreviewContainer.innerHTML = '';
        filePreviewContainer.classList.remove('show');
        composer.autoResize();
    }

    attachmentBtn.addEventListener('click', toggleMenu);
    uploadFileBtn.addEventListener('click', openFilePicker);
    fileUploadInput.addEventListener('change', handleFileSelection);
    
    document.addEventListener('click', (e) => {
        if (attachmentMenu.classList.contains('show') && !attachmentContainer.contains(e.target)) {
            attachmentMenu.classList.remove('show');
        }
    });

    return {
        getSelectedFile: () => selectedFile,
        clearFile,
    };
}
