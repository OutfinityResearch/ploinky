(() => {
  // Demo Display Module
  const DemoManager = {
    demoTimer: null,
    demoIndex: 0,
    demoScript: [],
    chatList: null,
    connected: false,

    init(chatListElement) {
      this.chatList = chatListElement;
    },

    setConnected(isConnected) {
      this.connected = isConnected;
      if (isConnected) {
        this.stopDemo();
      }
    },

    async startDemo() {
      try {
        if (this.connected || this.demoTimer) return;

        const response = await fetch('demo').then(r => r.json()).catch(() => null);
        this.demoScript = (response && response.script) ? response.script : [];

        if (this.chatList) {
          this.chatList.innerHTML = '';
        }

        this.demoIndex = 0;
        this.playNextDemo();
      } catch(_) {}
    },

    playNextDemo() {
      if (this.connected) {
        this.stopDemo();
        return;
      }

      const item = this.demoScript[this.demoIndex % (this.demoScript.length || 1)] || {
        who: 'User',
        text: '...'
      };

      const who = item?.who || 'User';
      const text = item?.text || '';

      this.renderDemoMessage(who, text);

      this.demoIndex++;

      const delay = Math.max(600, Math.min(3000, item?.delayMs || 1200));
      this.demoTimer = setTimeout(() => this.playNextDemo(), delay);
    },

    renderDemoMessage(who, text) {
      if (!this.chatList) return;

      const msgDiv = document.createElement('div');
      // Messages from 'Me' are outgoing, others are incoming
      const isOutgoing = who === 'Me' || who === 'You';
      msgDiv.className = `wa-message ${isOutgoing ? 'out' : 'in'} vc-demo`;

      const bubble = document.createElement('div');
      bubble.className = 'wa-message-bubble';

      // Add special styling for Moderator messages
      if (who === 'Moderator') {
        bubble.classList.add('is-moderator');
      }

      bubble.innerHTML = `
        <div class="wa-message-author"></div>
        <div class="wa-message-text"></div>
        <span class="wa-message-time"></span>
      `;

      msgDiv.appendChild(bubble);

      bubble.querySelector('.wa-message-author').textContent = who;
      bubble.querySelector('.wa-message-text').textContent = text;
      bubble.querySelector('.wa-message-time').textContent = this.formatTime();

      this.chatList.appendChild(msgDiv);
      this.chatList.scrollTop = this.chatList.scrollHeight;
    },

    formatTime() {
      const d = new Date();
      const h = String(d.getHours()).padStart(2, '0');
      const m = String(d.getMinutes()).padStart(2, '0');
      return `${h}:${m}`;
    },

    stopDemo() {
      try {
        if (this.demoTimer) {
          clearTimeout(this.demoTimer);
        }
      } catch(_) {}
      this.demoTimer = null;
    }
  };

  // Export to global scope
  window.webMeetDemo = DemoManager;
})();