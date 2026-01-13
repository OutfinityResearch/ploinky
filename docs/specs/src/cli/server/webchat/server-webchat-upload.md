# cli/server/webchat/upload.js - WebChat File Upload

## Overview

Client-side file upload module for WebChat. Manages file selection, preview display, camera capture with QR code scanning support, and attachment handling. Supports multiple file selection with preview thumbnails.

## Source File

`cli/server/webchat/upload.js`

## Dependencies

```javascript
import {
    formatBytes,
    getFileIcon,
    canvasToBlob,
    openCameraInputFallback,
    loadQrLib,
} from './fileHelpers.js';
```

## Internal Functions

### createCameraOverlay(options)

**Purpose**: Creates camera overlay for photo capture and QR scanning

**Parameters**:
- `options` (Object):
  - `composer` (Object): Composer module for QR code insertion

**Returns**: (Object|null) Camera overlay API or null if unsupported

**Return Structure**:
```javascript
{
    open: Function  // Opens camera dialog, returns Promise<File|null>
}
```

**Implementation Features**:
- Photo capture mode with preview
- QR code scanning mode
- Camera stream management
- Mode switching (photo/scan)
- Error handling with user feedback

**Camera Stream Configuration**:
```javascript
stream = await navigator.mediaDevices.getUserMedia({
    video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1280 },
        height: { ideal: 720 }
    },
    audio: false
});
```

**QR Scanning Loop**:
```javascript
async function startScanLoop() {
    if (scanning) return;
    scanning = true;
    const qrLib = await loadQrLib();
    const run = () => {
        if (!scanning) return;
        if (!video || !video.videoWidth || !video.videoHeight) {
            scanAnimation = requestAnimationFrame(run);
            return;
        }
        scanCtx.drawImage(video, 0, 0, width, height);
        const imageData = scanCtx.getImageData(0, 0, width, height);
        const decoded = qrLib.decodeQR(imageData, { cropToSquare: true });
        if (decoded) {
            handleScanSuccess(String(decoded));
            return;
        }
        scanAnimation = requestAnimationFrame(run);
    };
    scanAnimation = requestAnimationFrame(run);
}
```

## Public API

### createUploader(elements, options)

**Purpose**: Creates file uploader module

**Parameters**:
- `elements` (Object):
  - `attachmentBtn` (HTMLElement): Attachment button
  - `attachmentMenu` (HTMLElement): Attachment menu
  - `uploadFileBtn` (HTMLElement): Upload file button
  - `cameraActionBtn` (HTMLElement): Camera button
  - `fileUploadInput` (HTMLInputElement): File input
  - `filePreviewContainer` (HTMLElement): Preview container
  - `attachmentContainer` (HTMLElement): Menu container
- `options` (Object):
  - `composer` (Object): Composer module

**Returns**: (Object) Uploader API

**Return Structure**:
```javascript
{
    getSelectedFiles: Function,  // Returns array of selected files
    clearFile: Function,         // Alias for clearFiles
    clearFiles: Function         // Clears all selections
}
```

## Module State

```javascript
const selections = [];  // Array of file selections
let cameraOverlay;      // Camera overlay instance (lazy loaded)
```

## Selection Structure

```javascript
{
    id: string,              // Unique identifier
    file: File,              // File object
    isImage: boolean,        // Is image file
    previewDataUrl: string,  // Data URL for preview
    domItem: HTMLElement     // DOM preview element
}
```

## Internal Functions

### toggleMenu(e)

**Purpose**: Toggles attachment menu visibility

**Implementation**:
```javascript
function toggleMenu(e) {
    e.stopPropagation();
    attachmentMenu.classList.toggle('show');
}
```

### openFilePicker()

**Purpose**: Opens system file picker

**Implementation**:
```javascript
function openFilePicker() {
    fileUploadInput.click();
    attachmentMenu.classList.remove('show');
    refocusComposer();
}
```

### updatePreviewVisibility()

**Purpose**: Updates preview container visibility

**Implementation**:
```javascript
function updatePreviewVisibility() {
    if (selections.length > 0) {
        filePreviewContainer.classList.add('show');
    } else {
        filePreviewContainer.classList.remove('show');
        filePreviewContainer.innerHTML = '';
    }
    composer.autoResize();
    refocusComposer();
}
```

### createSelectionPreview(selection)

**Purpose**: Creates DOM preview for file selection

**Parameters**:
- `selection` (Object): Selection object

**Implementation**:
```javascript
function createSelectionPreview(selection) {
    const { file, isImage } = selection;
    const item = document.createElement('div');
    item.className = 'wa-file-preview-item';
    item.dataset.selectionId = selection.id;

    let thumbnailHTML = '';
    if (isImage) {
        thumbnailHTML = '<div class="wa-file-preview-thumbnail"><img src="" alt="Preview"></div>';
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
            selection.previewDataUrl = e.target?.result || null;
            const previewImg = item.querySelector('img');
            if (previewImg && selection.previewDataUrl) {
                previewImg.src = selection.previewDataUrl;
            }
        };
        reader.readAsDataURL(file);
    }

    item.querySelector('.wa-file-preview-remove').onclick = (e) => {
        e.stopPropagation();
        removeSelection(selection.id);
    };

    selection.domItem = item;
    filePreviewContainer.appendChild(item);
}
```

### addSelection(file)

**Purpose**: Adds file to selection list

**Parameters**:
- `file` (File): File to add

**Implementation**:
```javascript
function addSelection(file) {
    if (!file) return;
    const selection = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        file,
        isImage: (file.type || '').startsWith('image/'),
        previewDataUrl: null,
        domItem: null
    };
    selections.push(selection);
    createSelectionPreview(selection);
    updatePreviewVisibility();
}
```

### removeSelection(id)

**Purpose**: Removes selection by ID

**Parameters**:
- `id` (string): Selection ID

**Implementation**:
```javascript
function removeSelection(id) {
    const index = selections.findIndex((sel) => sel.id === id);
    if (index === -1) return;
    const [removed] = selections.splice(index, 1);
    if (removed?.domItem && removed.domItem.parentNode === filePreviewContainer) {
        filePreviewContainer.removeChild(removed.domItem);
    }
    updatePreviewVisibility();
    if (selections.length === 0) {
        fileUploadInput.value = '';
    }
    refocusComposer();
}
```

### handleCameraClick(event)

**Purpose**: Handles camera button click

**Implementation**:
```javascript
async function handleCameraClick(event) {
    event.preventDefault();
    event.stopPropagation();
    attachmentMenu.classList.remove('show');

    try {
        const overlay = getCameraOverlay();
        if (overlay) {
            try {
                const file = await overlay.open();
                if (file instanceof File) {
                    addSelection(file);
                }
                return;
            } catch (error) {
                console.warn('Camera capture failed, falling back to file input', error);
            }
        }
        const fallbackFile = await openCameraInputFallback();
        if (fallbackFile) {
            addSelection(fallbackFile);
        }
    } finally {
        refocusComposer();
    }
}
```

## Public Methods

### getSelectedFiles()

**Purpose**: Returns array of selected files with metadata

**Returns**: (Array) File payload objects

**Return Item Structure**:
```javascript
{
    file: File,                // File object
    previewUrl: string|null,   // Preview URL
    previewNeedsRevoke: boolean, // Whether URL needs revoking
    revokePreview: Function|null, // Revoke function
    isImage: boolean           // Is image file
}
```

### clearFiles()

**Purpose**: Clears all file selections

**Implementation**:
```javascript
function clearFiles() {
    while (selections.length) {
        const selection = selections.pop();
        if (selection?.domItem && selection.domItem.parentNode === filePreviewContainer) {
            filePreviewContainer.removeChild(selection.domItem);
        }
    }
    fileUploadInput.value = '';
    filePreviewContainer.innerHTML = '';
    filePreviewContainer.classList.remove('show');
    updatePreviewVisibility();
}
```

## Event Handlers

```javascript
attachmentBtn.addEventListener('click', toggleMenu);
uploadFileBtn.addEventListener('click', openFilePicker);
fileUploadInput.addEventListener('change', handleFileSelection);
cameraActionBtn?.addEventListener('click', handleCameraClick);

// Close menu on outside click
document.addEventListener('click', (e) => {
    if (attachmentMenu.classList.contains('show') && !attachmentContainer.contains(e.target)) {
        attachmentMenu.classList.remove('show');
    }
});
```

## Camera Modes

| Mode | Description |
|------|-------------|
| `photo` | Capture photo from camera |
| `scan` | Scan QR code and insert into composer |

## Export

```javascript
export function createUploader(elements, options) { ... }
```

## Usage Example

```javascript
import { createUploader } from './upload.js';

const uploader = createUploader({
    attachmentBtn: document.getElementById('attachmentBtn'),
    attachmentMenu: document.getElementById('attachmentMenu'),
    uploadFileBtn: document.getElementById('uploadFileBtn'),
    cameraActionBtn: document.getElementById('cameraActionBtn'),
    fileUploadInput: document.getElementById('fileUploadInput'),
    filePreviewContainer: document.getElementById('filePreviewContainer'),
    attachmentContainer: document.querySelector('.wa-attachment-container')
}, { composer });

// Get selected files for upload
const files = uploader.getSelectedFiles();
if (files.length) {
    network.sendAttachments(files, caption);
    uploader.clearFiles();
}
```

## Related Modules

- [server-webchat-index.md](./server-webchat-index.md) - Main entry point
- [server-webchat-network.md](./server-webchat-network.md) - File upload
- [server-webchat-file-helpers.md](./server-webchat-file-helpers.md) - File utilities

