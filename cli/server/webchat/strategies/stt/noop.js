export function initNoopSpeechToText(elements = {}) {
    const {
        sttBtn,
        sttStatus,
        sttEnable
    } = elements;

    if (sttEnable) {
        sttEnable.checked = false;
        sttEnable.disabled = true;
    }
    if (sttBtn) {
        sttBtn.disabled = true;
        sttBtn.setAttribute('aria-disabled', 'true');
    }
    if (sttStatus) {
        sttStatus.textContent = 'Unavailable';
    }

    return {
        isSupported: false,
        resetTranscriptState: () => {},
        stop: () => {}
    };
}
