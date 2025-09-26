(() => {
  // Audio, TTS, and STT Service Module
  const AudioService = {
    sttLang: localStorage.getItem('vc_stt_lang') || 'en-GB',

    init() {
      /* no-op, kept for backward compatibility */
    },

    speak(text, language) {
      try {
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = language || this.sttLang || 'en-GB';
        speechSynthesis.speak(utterance);
      } catch(e) {
        console.error('TTS error:', e);
      }
    },

    getCurrentLanguage() {
      return this.sttLang || 'en-GB';
    },

    createTTSButton(text) {
      const btn = document.createElement('button');
      btn.className = 'wa-tts-btn';
      btn.title = 'Read aloud';
      btn.innerHTML = '🔈';
      btn.onclick = () => {
        this.speak(text, this.getCurrentLanguage());
      };
      return btn;
    }
  };

  // Export to global scope
  window.webMeetAudio = AudioService;
})();
