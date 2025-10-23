export const DEFAULT_VOICE = 'alloy';

export const VOICE_OPTIONS = [
    { value: 'alloy', label: 'Alloy (general purpose)' },
    { value: 'aria', label: 'Aria (American English)' },
    { value: 'verse', label: 'Verse (narration)' },
    { value: 'sol', label: 'Sol (bright tone)' },
    { value: 'luna', label: 'Luna (warm tone)' }
];

export function normalizeVoiceChoice(voice) {
    const token = (voice || '').trim().toLowerCase();
    if (!token) {
        return DEFAULT_VOICE;
    }
    return VOICE_OPTIONS.some((option) => option.value === token) ? token : DEFAULT_VOICE;
}
