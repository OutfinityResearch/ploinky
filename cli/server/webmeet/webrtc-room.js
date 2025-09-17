(() => {
  // WebRTC Room Connection Module
  const WebRTCRoom = {
    peers: new Map(),
    micStream: null,
    liveTargets: [],
    isPaused: false,
    originalAudioTrack: null,

    async startMic() {
      if (this.micStream) return this.micStream;
      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false
      });
      return this.micStream;
    },

    stopMic() {
      // Stop STT if it's running
      if (window.webMeetAudio?.recognition) {
        try {
          window.webMeetAudio.recognition.stop();
        } catch(_) {}
        window.webMeetAudio.recognition = null;
      }

      // Stop microphone stream
      if (this.micStream) {
        this.micStream.getTracks().forEach(track => {
          try {
            track.stop();
          } catch(_) {}
        });
        this.micStream = null;
      }

      // Close all peer connections
      for (const pc of this.peers.values()) {
        try {
          pc.close();
        } catch(_) {}
      }
      this.peers.clear();
    },

    async goLive() {
      try {
        // Make sure microphone is started
        if (!this.micStream) {
          await this.startMic();
        }

        // Connect to all targets
        console.log('Going live, connecting to targets:', this.liveTargets);
        for (const targetId of (this.liveTargets || [])) {
          console.log('Connecting to peer:', targetId);
          await this.connectToPeer(targetId);
        }

        if (!this.liveTargets || this.liveTargets.length === 0) {
          console.log('No other participants to broadcast to');
        }
      } catch(e) {
        console.error('Error going live:', e);
        throw e;
      }
    },

    async connectToPeer(peerId) {
      if (this.peers.has(peerId)) {
        console.log('Already connected to peer:', peerId);
        return this.peers.get(peerId);
      }

      console.log('Creating new connection to peer:', peerId);

      const pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
      });

      this.peers.set(peerId, pc);

      // Add microphone tracks to the connection
      if (this.micStream) {
        console.log('Adding mic tracks to peer connection');
        this.micStream.getTracks().forEach(track => {
          pc.addTrack(track, this.micStream);
        });
      } else {
        console.warn('No microphone stream available for peer connection');
      }

      pc.onicecandidate = (e) => {
        if (e.candidate) {
          console.log('Sending ICE candidate to:', peerId);
          if (window.webMeetClient) {
            window.webMeetClient.postAction({
              type: 'signal',
              target: peerId,
              payload: { type: 'ice', candidate: e.candidate }
            });
          }
        }
      };

      pc.ontrack = (e) => {
        console.log('Received remote track from:', peerId);
        this.attachRemoteAudio(peerId, e.streams[0]);
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      console.log('Sending offer to:', peerId);
      if (window.webMeetClient) {
        await window.webMeetClient.postAction({
          type: 'signal',
          target: peerId,
          payload: { type: 'offer', sdp: pc.localDescription }
        });
      }

      return pc;
    },

    async onSignal(from, payload) {
      console.log('Received signal from:', from, 'type:', payload.type);

      let pc = this.peers.get(from);

      if (!pc) {
        console.log('Creating new peer connection for incoming signal from:', from);
        pc = new RTCPeerConnection({
          iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
        });

        this.peers.set(from, pc);

        pc.onicecandidate = (e) => {
          if (e.candidate) {
            console.log('Sending ICE candidate back to:', from);
            if (window.webMeetClient) {
              window.webMeetClient.postAction({
                type: 'signal',
                target: from,
                payload: { type: 'ice', candidate: e.candidate }
              });
            }
          }
        };

        pc.ontrack = (e) => {
          console.log('Received remote audio track from:', from);
          this.attachRemoteAudio(from, e.streams[0]);
        };

        if (this.micStream) {
          console.log('Adding mic tracks for incoming connection');
          this.micStream.getTracks().forEach(track => {
            pc.addTrack(track, this.micStream);
          });
        }
      }

      if (payload.type === 'offer') {
        console.log('Processing offer from:', from);
        await pc.setRemoteDescription(payload.sdp);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        console.log('Sending answer to:', from);
        if (window.webMeetClient) {
          await window.webMeetClient.postAction({
            type: 'signal',
            target: from,
            payload: { type: 'answer', sdp: pc.localDescription }
          });
        }
      } else if (payload.type === 'answer') {
        console.log('Processing answer from:', from);
        await pc.setRemoteDescription(payload.sdp);
      } else if (payload.type === 'ice') {
        try {
          console.log('Adding ICE candidate from:', from);
          await pc.addIceCandidate(payload.candidate);
        } catch(e) {
          console.error('Error adding ICE candidate:', e);
        }
      }
    },

    attachRemoteAudio(peerId, stream) {
      let audioElement = document.getElementById('audio_' + peerId);

      if (!audioElement) {
        audioElement = document.createElement('audio');
        audioElement.id = 'audio_' + peerId;
        audioElement.autoplay = true;
        audioElement.playsInline = true;
        audioElement.muted = window.webMeetClient?.isDeafened || false;
        document.body.appendChild(audioElement);
      }

      audioElement.srcObject = stream;
    },

    setLiveTargets(targets) {
      this.liveTargets = targets || [];
    },

    muteAllRemoteAudio(muted) {
      document.querySelectorAll('audio').forEach(audio => {
        audio.muted = muted;
      });
    },

    pauseBroadcast() {
      if (!this.micStream || this.isPaused) return;

      // Save the original track
      const audioTracks = this.micStream.getAudioTracks();
      if (audioTracks.length > 0) {
        this.originalAudioTrack = audioTracks[0];
        // Mute the track
        this.originalAudioTrack.enabled = false;
        this.isPaused = true;
      }
    },

    resumeBroadcast() {
      if (!this.isPaused || !this.originalAudioTrack) return;

      // Unmute the track
      this.originalAudioTrack.enabled = true;
      this.isPaused = false;
    }
  };

  // Export to global scope
  window.webMeetWebRTC = WebRTCRoom;
})();