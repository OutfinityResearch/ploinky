import {
    formatBytes,
    getFileIcon,
    canvasToBlob,
    openCameraInputFallback,
    loadQrLib,
} from './fileHelpers.js';

function createCameraOverlay({ composer }) {
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
        return null;
    }

    const overlay = document.createElement('div');
    overlay.className = 'wa-camera-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-hidden', 'true');
    overlay.innerHTML = `
        <div class="wa-camera-dialog">
            <div class="wa-camera-mode-toggle" role="tablist">
                <button type="button" class="wa-camera-mode active" data-camera-mode="photo" role="tab" aria-selected="true">Photo</button>
                <button type="button" class="wa-camera-mode" data-camera-mode="scan" role="tab" aria-selected="false">Scan QR</button>
            </div>
            <div class="wa-camera-view">
                <video class="wa-camera-video" autoplay playsinline></video>
                <img class="wa-camera-preview" alt="Captured photo preview" hidden />
            </div>
            <div class="wa-camera-footer">
                <div class="wa-camera-error" role="status" aria-live="polite"></div>
                <div class="wa-camera-scan-status" aria-live="polite" hidden></div>
                <div class="wa-camera-actions">
                    <button type="button" class="wa-camera-btn wa-camera-btn-primary" data-action="capture">Capture</button>
                    <button type="button" class="wa-camera-btn" data-action="retake" hidden>Retake</button>
                    <button type="button" class="wa-camera-btn wa-camera-btn-primary" data-action="use" hidden>Use photo</button>
                    <button type="button" class="wa-camera-btn" data-action="cancel">Close</button>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    const video = overlay.querySelector('.wa-camera-video');
    const preview = overlay.querySelector('.wa-camera-preview');
    const modeButtons = Array.from(overlay.querySelectorAll('[data-camera-mode]'));
    const captureBtn = overlay.querySelector('[data-action="capture"]');
    const retakeBtn = overlay.querySelector('[data-action="retake"]');
    const useBtn = overlay.querySelector('[data-action="use"]');
    const cancelBtn = overlay.querySelector('[data-action="cancel"]');
    const errorEl = overlay.querySelector('.wa-camera-error');
    const scanStatusEl = overlay.querySelector('.wa-camera-scan-status');

    const canvas = document.createElement('canvas');
    const captureCtx = canvas.getContext('2d');
    const scanCanvas = document.createElement('canvas');
    const scanCtx = scanCanvas.getContext('2d');

    let stream = null;
    let resolver = null;
    let rejecter = null;
    let active = false;
    let objectUrl = null;
    let capturedBlob = null;
    let selectedMode = 'photo';
    let defaultMode = 'photo';
    let scanning = false;
    let scanAnimation = null;

    function setError(message) {
        if (!errorEl) {
            return;
        }
        errorEl.textContent = message || '';
        errorEl.hidden = !message;
    }

    function setModeButtons(mode) {
        modeButtons.forEach((btn) => {
            const isActive = btn.dataset.cameraMode === mode;
            btn.classList.toggle('active', isActive);
            btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
        });
    }

    function stopScan(resetStatus = false) {
        if (scanAnimation !== null) {
            cancelAnimationFrame(scanAnimation);
            scanAnimation = null;
        }
        scanning = false;
        if (resetStatus && scanStatusEl) {
            scanStatusEl.textContent = '';
            scanStatusEl.hidden = true;
        }
    }

    function stopStream() {
        if (stream) {
            const tracks = stream.getTracks ? stream.getTracks() : [];
            tracks.forEach((track) => {
                try {
                    track.stop();
                } catch (_) {
                    // Ignore stop failures
                }
            });
        }
        stream = null;
        if (video) {
            video.srcObject = null;
        }
    }

    function resetPreview() {
        if (preview) {
            preview.hidden = true;
            preview.src = '';
        }
        if (video) {
            video.hidden = false;
        }
        capturedBlob = null;
        if (objectUrl) {
            URL.revokeObjectURL(objectUrl);
            objectUrl = null;
        }
    }

    function resetUi() {
        stopScan(true);
        resetPreview();
        if (captureBtn) {
            captureBtn.hidden = false;
            captureBtn.disabled = true;
        }
        if (retakeBtn) {
            retakeBtn.hidden = true;
        }
        if (useBtn) {
            useBtn.hidden = true;
        }
        if (scanStatusEl) {
            scanStatusEl.textContent = '';
            scanStatusEl.hidden = true;
        }
        setError('');
    }

    function cleanup() {
        active = false;
        document.removeEventListener('keydown', handleKeydown, true);
        overlay.classList.remove('show');
        overlay.setAttribute('aria-hidden', 'true');
        stopScan(true);
        stopStream();
        resetUi();
        resolver = null;
        rejecter = null;
    }

    function resolveWith(value) {
        defaultMode = selectedMode;
        const resolveFn = resolver;
        cleanup();
        if (resolveFn) {
            resolveFn(value);
        }
    }

    function rejectWith(error) {
        defaultMode = selectedMode;
        const rejectFn = rejecter;
        cleanup();
        if (rejectFn) {
            rejectFn(error);
        }
    }

    async function beginStream() {
        try {
            stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    facingMode: { ideal: 'environment' },
                    width: { ideal: 1280 },
                    height: { ideal: 720 }
                },
                audio: false
            });
            if (video) {
                video.srcObject = stream;
                await video.play().catch(() => {});
                if (selectedMode === 'photo' && captureBtn) {
                    captureBtn.disabled = false;
                    captureBtn.focus();
                }
            }
        } catch (error) {
            setError('Unable to access camera. Check permissions and try again.');
            throw error;
        }
    }

    async function startScanLoop() {
        if (scanning) {
            return;
        }
        if (!scanCtx) {
            setError('QR scanning unavailable in this browser.');
            return;
        }
        scanning = true;
        if (scanStatusEl) {
            scanStatusEl.hidden = false;
            scanStatusEl.textContent = stream ? 'Point the camera at a QR code.' : 'Starting camera…';
        }
        try {
            const qrLib = await loadQrLib();
            const run = () => {
                if (!scanning) {
                    return;
                }
                if (!video || !video.videoWidth || !video.videoHeight) {
                    if (scanStatusEl) {
                        scanStatusEl.textContent = 'Starting camera…';
                    }
                    scanAnimation = requestAnimationFrame(run);
                    return;
                }
                const width = video.videoWidth;
                const height = video.videoHeight;
                if (scanCanvas.width !== width) {
                    scanCanvas.width = width;
                }
                if (scanCanvas.height !== height) {
                    scanCanvas.height = height;
                }
                try {
                    scanCtx.drawImage(video, 0, 0, width, height);
                    const imageData = scanCtx.getImageData(0, 0, width, height);
                    const decoded = qrLib.decodeQR(imageData, { cropToSquare: true });
                    if (decoded) {
                        handleScanSuccess(String(decoded));
                        return;
                    }
                } catch (_) {
                    // decode errors are expected until a QR code is found
                }
                if (scanStatusEl) {
                    scanStatusEl.textContent = 'Point the camera at a QR code.';
                }
                scanAnimation = requestAnimationFrame(run);
            };
            scanAnimation = requestAnimationFrame(run);
        } catch (error) {
            scanning = false;
            if (scanStatusEl) {
                scanStatusEl.hidden = true;
            }
            setError(error.message || 'Unable to start QR scanning.');
        }
    }

    async function captureFrame() {
        if (selectedMode !== 'photo') {
            return;
        }
        if (!video || !stream) {
            setError('Camera is not ready.');
            return;
        }
        if (!captureCtx) {
            setError('Unable to prepare capture buffer.');
            return;
        }
        const width = video.videoWidth;
        const height = video.videoHeight;
        if (!width || !height) {
            setError('Camera is still initializing. Please try again.');
            return;
        }
        canvas.width = width;
        canvas.height = height;
        captureCtx.drawImage(video, 0, 0, width, height);
        try {
            capturedBlob = await canvasToBlob(canvas);
            if (objectUrl) {
                URL.revokeObjectURL(objectUrl);
            }
            objectUrl = URL.createObjectURL(capturedBlob);
            if (preview) {
                preview.src = objectUrl;
                preview.hidden = false;
            }
            if (video) {
                video.hidden = true;
            }
            if (captureBtn) {
                captureBtn.hidden = true;
            }
            if (retakeBtn) {
                retakeBtn.hidden = false;
            }
            if (useBtn) {
                useBtn.hidden = false;
            }
            setError('');
        } catch (error) {
            setError('Failed to capture photo. Please try again.');
            capturedBlob = null;
        }
    }

    function handleRetake() {
        if (selectedMode !== 'photo') {
            return;
        }
        resetPreview();
        if (video) {
            video.hidden = false;
            video.play().catch(() => {});
        }
        if (captureBtn) {
            captureBtn.hidden = false;
            captureBtn.disabled = false;
        }
        if (retakeBtn) {
            retakeBtn.hidden = true;
        }
        if (useBtn) {
            useBtn.hidden = true;
        }
        setError('');
    }

    async function handleUse() {
        if (selectedMode !== 'photo') {
            return;
        }
        if (!capturedBlob) {
            setError('No photo captured yet.');
            return;
        }
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const fileName = `camera-${timestamp}.jpg`;
        const file = new File([capturedBlob], fileName, { type: capturedBlob.type || 'image/jpeg' });
        resolveWith(file);
    }

    function handleScanSuccess(rawValue) {
        stopScan(false);
        const decoded = String(rawValue || '').trim();
        if (!decoded) {
            if (scanStatusEl) {
                scanStatusEl.textContent = 'QR code is empty.';
            }
            return;
        }
        if (scanStatusEl) {
            scanStatusEl.textContent = `Found: ${decoded}`;
        }

        if (composer && typeof composer.setValue === 'function' && typeof composer.submit === 'function') {
            try {
                const escaped = decoded.replace(/["]/g, '\\"');
                composer.setValue(`scanned "${escaped}"`);
                composer.submit();
            } catch (error) {
                setError('Failed to send scanned code.');
                return;
            }
        }
        resolveWith(null);
    }

    function handleCancel() {
        resolveWith(null);
    }

    function handleKeydown(event) {
        if (event.key === 'Escape') {
            event.preventDefault();
            handleCancel();
        }
    }

    function switchMode(mode, { force = false } = {}) {
        if (mode !== 'scan' && mode !== 'photo') {
            mode = 'photo';
        }
        if (selectedMode === mode && !force) {
            if (mode === 'scan' && !scanning) {
                startScanLoop();
            }
            return;
        }
        selectedMode = mode;
        setModeButtons(mode);
        setError('');
        if (mode === 'photo') {
            stopScan(true);
            if (captureBtn) {
                captureBtn.hidden = false;
                captureBtn.disabled = !stream;
            }
            if (!capturedBlob) {
                if (preview) preview.hidden = true;
                if (video) video.hidden = false;
                if (retakeBtn) retakeBtn.hidden = true;
                if (useBtn) useBtn.hidden = true;
            } else {
                if (preview) preview.hidden = false;
                if (video) video.hidden = true;
                if (retakeBtn) retakeBtn.hidden = false;
                if (useBtn) useBtn.hidden = false;
            }
            if (scanStatusEl) {
                scanStatusEl.textContent = '';
                scanStatusEl.hidden = true;
            }
        } else {
            resetPreview();
            if (captureBtn) {
                captureBtn.hidden = true;
                captureBtn.disabled = true;
            }
            if (retakeBtn) {
                retakeBtn.hidden = true;
            }
            if (useBtn) {
                useBtn.hidden = true;
            }
            if (video) {
                video.hidden = false;
            }
            if (scanStatusEl) {
                scanStatusEl.hidden = false;
                scanStatusEl.textContent = stream ? 'Point the camera at a QR code.' : 'Starting camera…';
            }
            startScanLoop();
        }
    }

    captureBtn?.addEventListener('click', () => {
        captureFrame();
    });

    retakeBtn?.addEventListener('click', () => {
        handleRetake();
    });

    useBtn?.addEventListener('click', () => {
        handleUse();
    });

    cancelBtn?.addEventListener('click', () => {
        handleCancel();
    });

    modeButtons.forEach((btn) => {
        btn.addEventListener('click', () => {
            const mode = btn.dataset.cameraMode === 'scan' ? 'scan' : 'photo';
            defaultMode = mode;
            switchMode(mode, { force: true });
        });
    });

    return {
        open() {
            if (active) {
                return Promise.resolve(null);
            }
            active = true;
            overlay.classList.add('show');
            overlay.removeAttribute('aria-hidden');
            resetUi();
            selectedMode = defaultMode;
            setModeButtons(selectedMode);
            switchMode(selectedMode, { force: true });
            document.addEventListener('keydown', handleKeydown, true);
            return new Promise((resolve, reject) => {
                resolver = resolve;
                rejecter = reject;
                beginStream()
                    .then(() => {
                        if (selectedMode === 'photo' && captureBtn) {
                            captureBtn.disabled = false;
                        }
                    })
                    .catch((error) => {
                        rejectWith(error);
                    });
            });
        }
    };
}

export function createUploader({
    attachmentBtn,
    attachmentMenu,
    uploadFileBtn,
    cameraActionBtn,
    fileUploadInput,
    filePreviewContainer,
    attachmentContainer
}, { composer }) {

    let selectedFile = null;
    let selectedFilePreviewDataUrl = null;
    let selectedFileIsImage = false;
    let cameraOverlay;

    function toggleMenu(e) {
        e.stopPropagation();
        attachmentMenu.classList.toggle('show');
    }

    function openFilePicker() {
        fileUploadInput.click();
        attachmentMenu.classList.remove('show');
    }

    function selectFile(file) {
        if (!file) {
            return;
        }
        selectedFile = file;
        selectedFileIsImage = (file.type || '').startsWith('image/');
        selectedFilePreviewDataUrl = null;
        displayFilePreview(file);
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
                selectedFilePreviewDataUrl = typeof e.target?.result === 'string' ? e.target.result : null;
                const previewImg = item.querySelector('#filePreviewImage');
                if (previewImg && selectedFilePreviewDataUrl) {
                    previewImg.src = selectedFilePreviewDataUrl;
                }
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

        selectFile(file);
        fileUploadInput.value = ''; // Reset for next selection
    }
    
    function getCameraOverlay() {
        if (cameraOverlay === undefined) {
            cameraOverlay = createCameraOverlay({ composer });
        }
        return cameraOverlay;
    }

    async function handleCameraClick(event) {
        event.preventDefault();
        event.stopPropagation();
        attachmentMenu.classList.remove('show');

        const overlay = getCameraOverlay();
        if (overlay) {
            try {
                const file = await overlay.open();
                if (file instanceof File) {
                    selectFile(file);
                }
                return;
            } catch (error) {
                console.warn('Camera capture failed, falling back to file input', error);
            }
        }
        const fallbackFile = await openCameraInputFallback();
        if (fallbackFile) {
            selectFile(fallbackFile);
        }
    }

    function clearFile() {
        selectedFile = null;
        selectedFilePreviewDataUrl = null;
        selectedFileIsImage = false;
        filePreviewContainer.innerHTML = '';
        filePreviewContainer.classList.remove('show');
        composer.autoResize();
    }

    attachmentBtn.addEventListener('click', toggleMenu);
    uploadFileBtn.addEventListener('click', openFilePicker);
    fileUploadInput.addEventListener('change', handleFileSelection);
    cameraActionBtn?.addEventListener('click', handleCameraClick);
    
    document.addEventListener('click', (e) => {
        if (attachmentMenu.classList.contains('show') && !attachmentContainer.contains(e.target)) {
            attachmentMenu.classList.remove('show');
        }
    });

    return {
        getSelectedFile: () => {
            if (!selectedFile) {
                return null;
            }
            let previewUrl = null;
            let revokePreview = null;
            if (selectedFileIsImage) {
                if (selectedFilePreviewDataUrl) {
                    previewUrl = selectedFilePreviewDataUrl;
                } else {
                    previewUrl = URL.createObjectURL(selectedFile);
                    revokePreview = () => {
                        try {
                            URL.revokeObjectURL(previewUrl);
                        } catch (_) {
                            // Ignore revoke failures
                        }
                    };
                }
            }
            return {
                file: selectedFile,
                previewUrl,
                previewNeedsRevoke: typeof revokePreview === 'function',
                revokePreview,
                isImage: selectedFileIsImage
            };
        },
        clearFile,
    };
}
