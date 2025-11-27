const MAX_TEXTAREA_HEIGHT_PX = 72;
const INITIAL_FOCUS_DELAY_MS = 120;

export function createComposer({ cmdInput, sendBtn }, { purgeTriggerRe }) {
    let onSend = null;
    let onPurge = null;

    function focusAfterAction() {
        if (!cmdInput) {
            return;
        }
        setTimeout(() => {
            focusInput();
        }, 0);
    }

    function focusInput() {
        if (!cmdInput) {
            return;
        }
        if (document.activeElement === cmdInput) {
            return;
        }
        try {
            cmdInput.focus({ preventScroll: true });
        } catch (_) {
            cmdInput.focus();
        }
        const pos = cmdInput.value.length;
        try {
            cmdInput.setSelectionRange(pos, pos);
        } catch (_) {
            // Ignore selection issues
        }
    }

    function autoResize() {
        if (!cmdInput) {
            return;
        }
        try {
            cmdInput.style.height = 'auto';
            const next = Math.min(MAX_TEXTAREA_HEIGHT_PX, Math.max(22, cmdInput.scrollHeight));
            cmdInput.style.height = `${next}px`;
        } catch (_) {
            // ignore
        }
    }

    function clear() {
        if (!cmdInput) {
            return;
        }
        cmdInput.value = '';
        autoResize();
        focusAfterAction();
    }

    function purge(options = {}) {
        const { resetVoice = false } = options;
        clear();
        if (typeof onPurge === 'function') {
            onPurge({ resetVoice });
        }
    }

    function submit() {
        if (!cmdInput) {
            return false;
        }
        const value = cmdInput.value;
        if (purgeTriggerRe.test(value)) {
            purge();
            return false;
        }

        const result = typeof onSend === 'function' ? onSend(value) : true;

        if (result !== false) {
            clear();
            return true;
        }
        focusAfterAction();
        return false;
    }

    function appendVoiceText(addition) {
        if (!cmdInput || !addition) {
            return;
        }
        const current = cmdInput.value;
        let insert = addition;
        const additionHasLeadingSpace = /^\s/.test(insert);
        const additionStartsPunct = /^[.,!?;:]/.test(insert);
        if (!additionHasLeadingSpace && current && !/\s$/.test(current) && !additionStartsPunct) {
            insert = ` ${insert}`;
        }
        const selStart = cmdInput.selectionStart;
        const selEnd = cmdInput.selectionEnd;
        const hadFocus = document.activeElement === cmdInput;
        const prevScroll = cmdInput.scrollTop;
        cmdInput.value = current + insert;
        if (hadFocus) {
            if (selStart !== current.length || selEnd !== current.length) {
                cmdInput.setSelectionRange(selStart, selEnd);
            } else {
                const pos = cmdInput.value.length;
                cmdInput.setSelectionRange(pos, pos);
            }
        }
        cmdInput.scrollTop = prevScroll;
        autoResize();
        if (purgeTriggerRe.test(cmdInput.value)) {
            purge({ resetVoice: true });
        }
    }

    function setValue(value) {
        if (!cmdInput) {
            return;
        }
        cmdInput.value = value;
        autoResize();
    }

    const getValue = () => (cmdInput ? cmdInput.value : '');

    if (cmdInput) {
        setTimeout(autoResize, 0);
        const scheduleInitialFocus = () => {
            setTimeout(() => {
                focusInput();
            }, INITIAL_FOCUS_DELAY_MS);
        };
        scheduleInitialFocus();
        window.addEventListener('pageshow', scheduleInitialFocus);
        cmdInput.addEventListener('input', () => {
            autoResize();
            if (purgeTriggerRe.test(cmdInput.value)) {
                purge();
            }
        });
        cmdInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                submit();
            }
        });
    }

    if (sendBtn) {
        sendBtn.onclick = () => submit();
    }

    return {
        submit,
        clear,
        purge,
        appendVoiceText,
        setValue,
        getValue,
        autoResize,
        focus: focusInput,
        setSendHandler: (handler) => {
            onSend = typeof handler === 'function' ? handler : null;
        },
        setPurgeHandler: (handler) => {
            onPurge = typeof handler === 'function' ? handler : null;
        }
    };
}
