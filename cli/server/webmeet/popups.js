(() => {
  // Popup/Overlay Manager Module
  const PopupManager = {
    // DOM elements
    elements: {
      prepOverlay: null,
      prepText: null,
      prepSend: null,
      prepCancel: null,
      prepEnableSTT: null,
      prepRecord: null,
      prepStatus: null,
      prepLang: null,
      speakOverlay: null,
      speakText: null,
      speakLang: null,
      speakSend: null,
      speakLive: null,
      speakPause: null,
      speakResume: null,
      speakStop: null,
      speakCancel: null,
      speakTitle: null,
      speakRequestBtn: null
    },

    // State
    prepRecording: false,
    prepRecognition: null,
    prepFinalTranscript: '',

    // Initialize popup elements
    init() {
      this.elements.prepOverlay = document.getElementById('prepOverlay');
      this.elements.prepText = document.getElementById('prepText');
      this.elements.prepSend = document.getElementById('prepSend');
      this.elements.prepCancel = document.getElementById('prepCancel');
      this.elements.prepEnableSTT = document.getElementById('prepEnableSTT');
      this.elements.prepRecord = document.getElementById('prepRecord');
      this.elements.prepStatus = document.getElementById('prepStatus');
      this.elements.prepLang = document.getElementById('prepLang');

      this.elements.speakOverlay = document.getElementById('speakOverlay');
      this.elements.speakText = document.getElementById('speakText');
      this.elements.speakLang = document.getElementById('speakLang');
      this.elements.speakSend = document.getElementById('speakSend');
      this.elements.speakLive = document.getElementById('speakLive');
      this.elements.speakPause = document.getElementById('speakPause');
      this.elements.speakResume = document.getElementById('speakResume');
      this.elements.speakStop = document.getElementById('speakStop');
      this.elements.speakCancel = document.getElementById('speakCancel');
      this.elements.speakTitle = document.getElementById('speakTitle');
      this.elements.speakRequestBtn = document.getElementById('speakRequestBtn');

      this.attachEventHandlers();
    },

    // Attach event handlers
    attachEventHandlers() {
      if (this.elements.prepRecord) {
        this.elements.prepRecord.onclick = () => this.handlePrepRecord();
      }

      if (this.elements.prepCancel) {
        this.elements.prepCancel.onclick = () => this.hidePrepOverlay();
      }

      if (this.elements.prepSend) {
        this.elements.prepSend.onclick = () => this.handlePrepSend();
      }

      if (this.elements.speakSend) {
        this.elements.speakSend.onclick = () => this.handleSpeakSend();
      }

      if (this.elements.speakLive) {
        this.elements.speakLive.onclick = () => this.handleSpeakLive();
      }

      if (this.elements.speakPause) {
        this.elements.speakPause.onclick = () => this.handleSpeakPause();
      }

      if (this.elements.speakResume) {
        this.elements.speakResume.onclick = () => this.handleSpeakResume();
      }

      if (this.elements.speakStop) {
        this.elements.speakStop.onclick = () => this.handleSpeakStop();
      }

      if (this.elements.speakCancel) {
        this.elements.speakCancel.onclick = () => this.handleSpeakCancel();
      }

      if (this.elements.speakRequestBtn) {
        this.elements.speakRequestBtn.onclick = () => this.handleSpeakRequest();
      }
    },

    // Prepare Overlay Methods
    showPrepOverlay() {
      if (this.elements.prepText) this.elements.prepText.value = '';
      if (this.elements.prepOverlay) this.elements.prepOverlay.style.display = 'block';
    },

    hidePrepOverlay() {
      try {
        if (this.prepRecognition) this.prepRecognition.stop();
      } catch(_) {}
      this.prepRecording = false;
      if (this.elements.prepOverlay) this.elements.prepOverlay.style.display = 'none';
    },

    handlePrepRecord() {
      if (!this.prepRecording) {
        this.startPrepRecording();
      } else {
        this.stopPrepRecording();
      }
    },

    startPrepRecording() {
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SR) {
        alert('Speech recognition not supported');
        return;
      }

      if (!this.elements.prepEnableSTT?.checked) return;

      this.prepFinalTranscript = '';
      this.prepRecognition = new SR();

      const currentPrepLang = this.elements.prepLang?.value ||
                             window.webMeetAudio?.sttLang || 'en-US';

      this.prepRecognition.lang = currentPrepLang;
      this.prepRecognition.continuous = true;
      this.prepRecognition.interimResults = true;

      this.prepRecognition.onresult = (event) => {
        let interim_transcript = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            this.prepFinalTranscript += event.results[i][0].transcript + ' ';
          } else {
            interim_transcript += event.results[i][0].transcript;
          }
        }
        if (this.elements.prepText) {
          this.elements.prepText.value = this.prepFinalTranscript + interim_transcript;
        }
      };

      this.prepRecognition.onerror = (e) => {
        if (this.elements.prepStatus) {
          this.elements.prepStatus.textContent = `Error: ${e.error}`;
        }
      };

      this.prepRecognition.onend = () => {
        this.prepRecording = false;
        this.updatePrepRecordButton(false);
      };

      try {
        this.prepRecognition.start();
        this.prepRecording = true;
        this.updatePrepRecordButton(true);
      } catch(e) {
        alert(`Could not start STT: ${e.message}`);
      }
    },

    stopPrepRecording() {
      try {
        if (this.prepRecognition) this.prepRecognition.stop();
      } catch(_) {}
    },

    updatePrepRecordButton(recording) {
      if (!this.elements.prepRecord) return;

      if (recording) {
        this.elements.prepRecord.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12"/></svg>';
        this.elements.prepRecord.title = 'Stop Recording';
        this.elements.prepRecord.classList.add('active', 'danger');
        if (this.elements.prepStatus) {
          this.elements.prepStatus.textContent = 'Listening...';
        }
      } else {
        this.elements.prepRecord.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="8"/></svg>';
        this.elements.prepRecord.title = 'Start Recording';
        this.elements.prepRecord.classList.remove('active', 'danger');
        if (this.elements.prepStatus) {
          this.elements.prepStatus.textContent = 'Ready';
        }
      }
    },

    async handlePrepSend() {
      try {
        if (this.prepRecognition) this.prepRecognition.stop();
      } catch(_) {}
      this.prepRecording = false;

      const text = (this.elements.prepText?.value || '').trim();
      if (text && window.webMeetClient?.joined) {
        // Send message in JSON format
        await window.webMeetClient.postAction({
          from: window.webMeetClient.myEmail,
          to: 'all',
          command: 'broadcast',
          text: text
        });
      }

      this.hidePrepOverlay();
      if (this.elements.prepText) this.elements.prepText.value = '';
      this.prepFinalTranscript = '';
    },

    // Speak Overlay Methods
    showSpeakOverlay(transferredText = '') {
      if (this.elements.speakText) this.elements.speakText.value = transferredText;
      if (this.elements.speakOverlay) this.elements.speakOverlay.style.display = 'block';
    },

    hideSpeakOverlay() {
      if (this.elements.speakOverlay) this.elements.speakOverlay.style.display = 'none';
    },

    async handleSpeakSend() {
      const text = (this.elements.speakText?.value || '').trim();
      if (text && window.webMeetClient) {
        // Send transcript in JSON format
        await window.webMeetClient.postAction({
          from: window.webMeetClient.myEmail,
          to: 'all',
          command: 'broadcast',
          text: text
        });
      }
      if (this.elements.speakText) this.elements.speakText.value = '';
      if (window.webMeetAudio) {
        window.webMeetAudio.finalTranscript = '';
      }
    },

    async handleSpeakLive() {
      if (window.webMeetClient) {
        window.webMeetClient.speakMode = 'live';
      }

      if (this.elements.speakTitle) {
        this.elements.speakTitle.textContent = 'Speak Now - LIVE 🔴';
      }
      if (this.elements.speakLive) {
        this.elements.speakLive.style.display = 'none';
      }
      if (this.elements.speakPause) {
        this.elements.speakPause.style.display = 'flex';
      }
      if (this.elements.speakStop) {
        this.elements.speakStop.style.display = 'flex';
      }

      if (window.webMeetWebRTC) {
        await window.webMeetWebRTC.goLive();
      }
    },

    async handleSpeakPause() {
      // Pause the microphone/broadcast
      if (window.webMeetWebRTC) {
        window.webMeetWebRTC.pauseBroadcast();
      }

      if (this.elements.speakTitle) {
        this.elements.speakTitle.textContent = 'Paused - Click Resume to Continue';
      }
      if (this.elements.speakPause) {
        this.elements.speakPause.style.display = 'none';
      }
      if (this.elements.speakResume) {
        this.elements.speakResume.style.display = 'flex';
      }
    },

    async handleSpeakResume() {
      // Resume broadcasting
      if (window.webMeetWebRTC) {
        window.webMeetWebRTC.resumeBroadcast();
      }

      if (this.elements.speakTitle) {
        this.elements.speakTitle.textContent = 'Speak Now - LIVE 🔴';
      }
      if (this.elements.speakResume) {
        this.elements.speakResume.style.display = 'none';
      }
      if (this.elements.speakPause) {
        this.elements.speakPause.style.display = 'flex';
      }
    },

    async handleSpeakStop() {
      if (window.webMeetClient) {
        window.webMeetClient.speakMode = 'prep';
        // Send endSpeak when stopping live mode
        await window.webMeetClient.postAction({
          from: window.webMeetClient.myEmail,
          to: 'moderator',
          command: 'endSpeak',
          text: ''
        });
      }

      if (window.webMeetWebRTC) {
        window.webMeetWebRTC.stopMic();
      }

      this.resetSpeakUI();
      this.hideSpeakOverlay();
    },

    async handleSpeakCancel() {
      this.hideSpeakOverlay();
      if (window.webMeetClient) {
        // Send endSpeak command to moderator
        await window.webMeetClient.postAction({
          from: window.webMeetClient.myEmail,
          to: 'moderator',
          command: 'endSpeak',
          text: ''
        });
      }
      if (window.webMeetWebRTC) {
        window.webMeetWebRTC.stopMic();
      }
      if (window.webMeetClient) {
        window.webMeetClient.speakMode = 'prep';
      }
      this.resetSpeakUI();
    },

    async handleSpeakRequest() {
      if (window.webMeetClient) {
        await window.webMeetClient.postAction({
          from: window.webMeetClient.myEmail,
          to: 'moderator',
          command: 'wantToSpeak',
          text: ''
        });
      }
      if (this.elements.speakRequestBtn) {
        this.elements.speakRequestBtn.classList.add('active');
      }
    },

    resetSpeakUI() {
      if (this.elements.speakTitle) {
        this.elements.speakTitle.textContent = 'Speak Now';
      }
      if (this.elements.speakLive) {
        this.elements.speakLive.style.display = 'flex';
      }
      if (this.elements.speakPause) {
        this.elements.speakPause.style.display = 'none';
      }
      if (this.elements.speakResume) {
        this.elements.speakResume.style.display = 'none';
      }
      if (this.elements.speakStop) {
        this.elements.speakStop.style.display = 'none';
      }
    },

    // Get text from prepare overlay to transfer to speak overlay
    getPreparedText() {
      if (this.elements.prepOverlay?.style.display === 'block') {
        return this.elements.prepText?.value || '';
      }
      return '';
    }
  };

  // Export to global scope
  window.webMeetPopups = PopupManager;
})();