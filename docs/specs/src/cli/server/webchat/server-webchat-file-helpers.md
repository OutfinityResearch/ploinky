# cli/server/webchat/fileHelpers.js - WebChat File Helpers

## Overview

Client-side utility functions for file handling in WebChat. Provides byte formatting, file type icons, canvas-to-blob conversion, camera input fallback, and QR library loading.

## Source File

`cli/server/webchat/fileHelpers.js`

## Public API

### formatBytes(bytes, decimals)

**Purpose**: Formats byte count as human-readable string

**Parameters**:
- `bytes` (number): Byte count
- `decimals` (number): Decimal places (default: 2)

**Returns**: (string) Formatted string (e.g., "1.5 MB")

**Implementation**:
```javascript
export function formatBytes(bytes, decimals = 2) {
    const value = Number(bytes) || 0;
    if (value === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(value) / Math.log(k));
    const normalized = Number((value / Math.pow(k, i)).toFixed(dm));
    return `${normalized} ${sizes[i]}`;
}
```

### getFileIcon(fileName)

**Purpose**: Returns SVG icon markup for file type

**Parameters**:
- `fileName` (string): File name with extension

**Returns**: (string) HTML string with icon

**Supported Extensions**:
- `pdf` - PDF document icon
- `doc`, `docx` - Word document icon
- `zip` - Archive icon
- Default - Generic file icon

**Implementation**:
```javascript
const ICON_MAP = {
    'pdf': '<svg>...</svg>',
    'doc': '<svg>...</svg>',
    'docx': '<svg>...</svg>',
    'zip': '<svg>...</svg>',
    'default': '<svg>...</svg>'
};

export function getFileIcon(fileName) {
    const extension = (fileName || '').split('.').pop().toLowerCase();
    const icon = ICON_MAP[extension] || ICON_MAP.default;
    return `<div class="wa-file-icon">${icon}</div>`;
}
```

### canvasToBlob(canvas, type, quality)

**Purpose**: Converts canvas to Blob (promisified)

**Parameters**:
- `canvas` (HTMLCanvasElement): Source canvas
- `type` (string): MIME type (default: 'image/jpeg')
- `quality` (number): Compression quality (default: 0.92)

**Returns**: (Promise<Blob>) Blob promise

**Implementation**:
```javascript
export function canvasToBlob(canvas, type = 'image/jpeg', quality = 0.92) {
    return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
            if (blob) {
                resolve(blob);
            } else {
                reject(new Error('Failed to capture image'));
            }
        }, type, quality);
    });
}
```

### openCameraInputFallback()

**Purpose**: Opens system camera input as fallback

**Returns**: (Promise<File|null>) Captured file or null

**Implementation**:
```javascript
export function openCameraInputFallback() {
    return new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.capture = 'environment';
        input.style.display = 'none';
        document.body.appendChild(input);

        const cleanup = () => {
            if (document.body.contains(input)) {
                document.body.removeChild(input);
            }
        };

        let settled = false;
        const finish = (file) => {
            if (settled) return;
            settled = true;
            cleanup();
            resolve(file || null);
        };

        input.addEventListener('change', () => {
            const file = input.files && input.files[0] ? input.files[0] : null;
            finish(file);
        }, { once: true });

        input.addEventListener('cancel', () => {
            finish(null);
        }, { once: true });

        input.click();
    });
}
```

### loadQrLib()

**Purpose**: Lazy loads QR code library

**Returns**: (Promise<Object>) QR library with `decodeQR` method

**Implementation**:
```javascript
let qrLibPromise = null;

export function loadQrLib() {
    // Return cached instance if available
    if (window.qr && typeof window.qr.decodeQR === 'function') {
        return Promise.resolve(window.qr);
    }

    // Return pending promise if loading
    if (qrLibPromise) {
        return qrLibPromise;
    }

    // Load library from script
    qrLibPromise = new Promise((resolve, reject) => {
        const base = typeof window.__WEBCHAT_ASSET_BASE__ === 'string'
            ? window.__WEBCHAT_ASSET_BASE__
            : '';
        const normalized = base.endsWith('/') ? base.slice(0, -1) : base;

        const script = document.createElement('script');
        script.src = `${normalized}/qrLib/qr.min.js`;
        script.async = true;

        script.onload = () => {
            script.remove();
            if (window.qr && typeof window.qr.decodeQR === 'function') {
                resolve(window.qr);
            } else {
                reject(new Error('QR library unavailable'));
            }
        };

        script.onerror = () => {
            script.remove();
            reject(new Error('Failed to load QR library'));
        };

        document.head.appendChild(script);
    }).catch((error) => {
        qrLibPromise = null;  // Allow retry
        throw error;
    });

    return qrLibPromise;
}
```

## File Size Units

| Unit | Size |
|------|------|
| Bytes | 1 |
| KB | 1,024 |
| MB | 1,048,576 |
| GB | 1,073,741,824 |
| TB | 1,099,511,627,776 |

## QR Library API

The loaded QR library provides:

```javascript
window.qr.decodeQR(imageData, options)
```

**Parameters**:
- `imageData` (ImageData): Canvas image data
- `options` (Object):
  - `cropToSquare` (boolean): Crop to square before scanning

**Returns**: (string|null) Decoded QR content or null

## Exports

```javascript
export {
    formatBytes,
    getFileIcon,
    canvasToBlob,
    openCameraInputFallback,
    loadQrLib
};
```

## Usage Example

```javascript
import {
    formatBytes,
    getFileIcon,
    canvasToBlob,
    openCameraInputFallback,
    loadQrLib
} from './fileHelpers.js';

// Format file size
const sizeText = formatBytes(1536000);  // "1.46 MB"

// Get file icon
const iconHtml = getFileIcon('document.pdf');

// Capture canvas to blob
const blob = await canvasToBlob(canvas, 'image/png', 1.0);

// Open camera fallback
const photo = await openCameraInputFallback();
if (photo) {
    console.log('Captured:', photo.name);
}

// Load and use QR library
const qrLib = await loadQrLib();
const imageData = ctx.getImageData(0, 0, width, height);
const decoded = qrLib.decodeQR(imageData, { cropToSquare: true });
if (decoded) {
    console.log('QR content:', decoded);
}
```

## Related Modules

- [server-webchat-upload.md](./server-webchat-upload.md) - File upload
- [server-webchat-messages.md](./server-webchat-messages.md) - Attachment display

