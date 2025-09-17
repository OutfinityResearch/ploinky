(() => {
  // Audio, TTS, and STT Service Module
  const AudioService = {
    // STT state
    recognition: null,
    sttLang: localStorage.getItem('vc_stt_lang') || 'en-US',
    finalTranscript: '',

    // Initialize audio service
    init() {
      this.populateLanguageSelectors();
      this.attachLanguageHandlers();
    },

    // Text-to-Speech functionality
    speak(text, language) {
      try {
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = language || this.sttLang || 'en-US';
        speechSynthesis.speak(utterance);
      } catch(e) {
        console.error('TTS error:', e);
      }
    },

    // Speech-to-Text functionality
    startSTT(outputElement) {
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

      if (!SR) {
        if (outputElement) {
          outputElement.value = 'Speech Recognition API not supported in this browser.';
        }
        return;
      }

      // Always start fresh
      this.finalTranscript = '';
      this.recognition = new SR();

      // Get current language from speak language selector if available
      const speakLangEl = document.getElementById('speakLang');
      const currentLang = speakLangEl?.value || this.sttLang || 'en-US';

      this.recognition.lang = currentLang;
      this.recognition.continuous = true;
      this.recognition.interimResults = true;

      this.recognition.onresult = (event) => {
        let interim_transcript = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const transcriptPart = event.results[i][0].transcript;

          if (event.results[i].isFinal) {
            this.finalTranscript += transcriptPart;

            // Check for "stop" command
            if (/stop/i.test(transcriptPart.trim())) {
              const stopBtn = document.getElementById('speakStop');
              if (stopBtn) {
                try {
                  stopBtn.click();
                } catch(_) {}
              }
            }
          } else {
            interim_transcript += transcriptPart;
          }
        }

        if (outputElement) {
          outputElement.value = this.finalTranscript + interim_transcript;
        }
      };

      this.recognition.onend = () => {
        // Recognition ended - don't persist old transcript
      };

      this.recognition.onerror = (e) => {
        if (outputElement) {
          outputElement.value += `\n\n[STT Error: ${e.error}]`;
        }
      };

      try {
        this.recognition.start();
      } catch(e) {
        alert(`Could not start STT: ${e.message}`);
      }
    },

    stopSTT() {
      if (this.recognition) {
        try {
          this.recognition.stop();
        } catch(_) {}
        this.recognition = null;
      }
    },

    // Language management
    populateLanguageSelectors() {
      try {
        const fillLangs = () => {
          const voices = (window.speechSynthesis?.getVoices?.() || []);
          const voiceLangs = voices.map(v => v.lang).filter(Boolean);

          // Common languages
          const common = [
            'en-US', 'en-GB', 'ro-RO', 'fr-FR', 'de-DE', 'es-ES',
            'it-IT', 'pt-PT', 'pt-BR', 'nl-NL', 'pl-PL', 'tr-TR',
            'ru-RU', 'zh-CN', 'ja-JP', 'ko-KR'
          ];

          const allLangs = Array.from(new Set([...voiceLangs, ...common]));

          // Sort with English variants first
          const langs = allLangs.sort((a, b) => {
            if (a.startsWith('en-') && !b.startsWith('en-')) return -1;
            if (!a.startsWith('en-') && b.startsWith('en-')) return 1;
            return a.localeCompare(b);
          });

          const speakLang = document.getElementById('speakLang');
          const prepLang = document.getElementById('prepLang');

          // Clear existing options
          if (speakLang) speakLang.innerHTML = '';
          if (prepLang) prepLang.innerHTML = '';

          langs.forEach(code => {
            const opt = document.createElement('option');
            opt.value = code;
            opt.textContent = code;

            if (code === this.sttLang) {
              opt.selected = true;
            }

            if (speakLang) {
              speakLang.appendChild(opt.cloneNode(true));
            }
            if (prepLang) {
              prepLang.appendChild(opt);
            }
          });
        };

        fillLangs();
        window.speechSynthesis?.addEventListener?.('voiceschanged', fillLangs);
      } catch(_) {}
    },

    attachLanguageHandlers() {
      const langChangeHandler = (e) => {
        this.sttLang = e.target.value || 'en-US';
        localStorage.setItem('vc_stt_lang', this.sttLang);

        // Keep selectors in sync
        const otherSelect = e.target.id === 'speakLang' ?
                          document.getElementById('prepLang') :
                          document.getElementById('speakLang');
        if (otherSelect) {
          otherSelect.value = this.sttLang;
        }
      };

      const speakLang = document.getElementById('speakLang');
      const prepLang = document.getElementById('prepLang');

      if (speakLang) {
        speakLang.addEventListener('change', langChangeHandler);
      }
      if (prepLang) {
        prepLang.addEventListener('change', langChangeHandler);
      }
    },

    // Helper to get current language
    getCurrentLanguage() {
      const speakLang = document.getElementById('speakLang');
      const prepLang = document.getElementById('prepLang');
      return speakLang?.value || prepLang?.value || this.sttLang || 'en-US';
    },

    // Create TTS button for a message bubble
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