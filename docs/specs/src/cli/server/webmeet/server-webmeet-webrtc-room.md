# cli/server/webmeet/webrtc-room.js - WebMeet WebRTC Room

## Overview

Client-side WebRTC module for WebMeet. Manages peer connections, microphone/camera/screen sharing, ICE signaling, and audio broadcast control. Uses STUN for NAT traversal.

## Source File

`cli/server/webmeet/webrtc-room.js`

## Module State

```javascript
const WebRTCRoom = {
    peers: new Map(),           // peerId -> RTCPeerConnection
    micStream: null,            // Local microphone stream
    liveTargets: [],            // Target peer IDs for broadcast
    isPaused: false,            // Broadcast paused
    originalAudioTrack: null,   // Saved audio track for pause/resume
    isBroadcasting: false,      // Currently broadcasting
    cameraTrack: null,          // Local camera track
    cameraSenders: new Map(),   // peerId -> RTCRtpSender
    screenTrack: null,          // Local screen track
    screenSenders: new Map(),   // peerId -> RTCRtpSender
    initiatedPeers: new Set()   // Peers we initiated connection to
};
```

## RTC Configuration

```javascript
const rtcConfig = {
    iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
};
```

## Public API

### startMic()

**Purpose**: Starts microphone stream

**Returns**: (Promise<MediaStream>) Microphone stream

```javascript
async startMic() {
    if (this.micStream) return this.micStream;
    this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false
    });
    return this.micStream;
}
```

### stopMic()

**Purpose**: Stops all streams and closes peers

```javascript
stopMic() {
    // Stop STT
    window.WebMeetMedia?.stopRecognition?.();

    // Stop microphone tracks
    if (this.micStream) {
        this.micStream.getTracks().forEach(track => track.stop());
        this.micStream = null;
    }

    // Close all peer connections
    for (const pc of this.peers.values()) {
        pc.close();
    }
    for (const peerId of this.peers.keys()) {
        window.WebMeetMedia?.handlePeerClosed(peerId);
    }
    this.peers.clear();
    this.initiatedPeers.clear();
    this.isBroadcasting = false;

    // Clear camera/screen
    this.cameraSenders.clear();
    this.screenSenders.clear();
    if (this.cameraTrack) this.cameraTrack.stop();
    this.cameraTrack = null;
    if (this.screenTrack) this.screenTrack.stop();
    this.screenTrack = null;

    // Remove audio elements
    document.querySelectorAll('audio[id^="audio_"]').forEach(el => {
        el.srcObject = null;
        el.remove();
    });
}
```

### goLive()

**Purpose**: Starts broadcasting to all targets

```javascript
async goLive() {
    if (!this.micStream) {
        await this.startMic();
    }

    for (const targetId of (this.liveTargets || [])) {
        await this.connectToPeer(targetId);
    }

    this.isBroadcasting = true;
}
```

### connectToPeer(peerId)

**Purpose**: Creates peer connection and sends offer

**Returns**: (Promise<RTCPeerConnection>) Peer connection

```javascript
async connectToPeer(peerId) {
    if (this.peers.has(peerId)) {
        return this.peers.get(peerId);
    }

    const pc = new RTCPeerConnection(rtcConfig);
    this.peers.set(peerId, pc);
    this.initiatedPeers.add(peerId);

    // Add microphone tracks
    if (this.micStream) {
        this.micStream.getAudioTracks().forEach(track => {
            pc.addTrack(track, this.micStream);
        });
        // Add camera if active
        if (this.cameraTrack) {
            const sender = pc.addTrack(this.cameraTrack, this.micStream);
            this.cameraSenders.set(peerId, sender);
        }
    }

    // ICE candidate handler
    pc.onicecandidate = (e) => {
        if (e.candidate) {
            window.webMeetClient.postAction({
                type: 'signal',
                target: peerId,
                payload: { type: 'ice', candidate: e.candidate }
            });
        }
    };

    // Remote track handler
    pc.ontrack = (e) => {
        this.attachRemoteStream(peerId, e.streams[0]);
    };

    // Create and send offer
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await window.webMeetClient.postAction({
        type: 'signal',
        target: peerId,
        payload: { type: 'offer', sdp: pc.localDescription }
    });

    return pc;
}
```

### onSignal(from, payload)

**Purpose**: Handles incoming WebRTC signaling

**Payload Types**:
- `offer` - Set remote description, create and send answer
- `answer` - Set remote description
- `ice` - Add ICE candidate

```javascript
async onSignal(from, payload) {
    let pc = this.peers.get(from);

    // Create peer connection if needed
    if (!pc) {
        pc = new RTCPeerConnection(rtcConfig);
        this.peers.set(from, pc);
        // Set up handlers and tracks
    }

    if (payload.type === 'offer') {
        await pc.setRemoteDescription(payload.sdp);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await window.webMeetClient.postAction({
            type: 'signal',
            target: from,
            payload: { type: 'answer', sdp: pc.localDescription }
        });
    } else if (payload.type === 'answer') {
        await pc.setRemoteDescription(payload.sdp);
    } else if (payload.type === 'ice') {
        await pc.addIceCandidate(payload.candidate);
    }
}
```

### attachRemoteStream(peerId, stream)

**Purpose**: Attaches remote stream to audio element

```javascript
attachRemoteStream(peerId, stream) {
    let audioElement = document.getElementById('audio_' + peerId);

    if (!audioElement) {
        audioElement = document.createElement('audio');
        audioElement.id = 'audio_' + peerId;
        audioElement.autoplay = true;
        audioElement.playsInline = true;
        audioElement.muted = window.WebMeetStore?.getState()?.isDeafened;
        document.body.appendChild(audioElement);
    }

    audioElement.srcObject = stream;

    // Handle video tracks
    if (stream?.getVideoTracks?.().length) {
        const kind = identifyStreamKind(stream);
        window.WebMeetMedia?.handleRemoteStream(peerId, stream, kind);
    }
}
```

### setLiveTargets(targets)

**Purpose**: Updates broadcast target list

```javascript
setLiveTargets(targets) {
    this.liveTargets = Array.isArray(targets) ? targets : [];
    const desired = new Set(this.liveTargets);

    // Close connections to non-targets
    const toClose = [];
    for (const peerId of this.initiatedPeers) {
        if (!desired.has(peerId)) {
            toClose.push(peerId);
        }
    }
    toClose.forEach(peerId => {
        this.removePeer(peerId);
        window.WebMeetMedia?.handlePeerClosed(peerId, { skipPeerRemoval: true });
    });

    // Reconnect if broadcasting
    if (this.isBroadcasting && !this.isPaused) {
        this.goLive();
    }
}
```

### pauseBroadcast() / resumeBroadcast()

**Purpose**: Pauses/resumes audio broadcast (mute)

```javascript
pauseBroadcast() {
    if (!this.micStream || this.isPaused) return;
    const audioTracks = this.micStream.getAudioTracks();
    if (audioTracks.length > 0) {
        this.originalAudioTrack = audioTracks[0];
        this.originalAudioTrack.enabled = false;
        this.isPaused = true;
        this.isBroadcasting = false;
    }
}

resumeBroadcast() {
    if (!this.isPaused || !this.originalAudioTrack) return;
    this.originalAudioTrack.enabled = true;
    this.isPaused = false;
    this.isBroadcasting = true;
}
```

### enableCamera(track) / disableCamera()

**Purpose**: Manages camera track across all peers

### enableScreenShare(track) / disableScreenShare()

**Purpose**: Manages screen share track across all peers

### muteAllRemoteAudio(muted)

**Purpose**: Mutes/unmutes all remote audio elements

```javascript
muteAllRemoteAudio(muted) {
    document.querySelectorAll('audio').forEach(audio => {
        audio.muted = muted;
    });
}
```

## Stream Kind Detection

```javascript
function identifyStreamKind(stream) {
    const track = stream?.getVideoTracks?.[0];
    if (!track) return 'camera';
    const settings = track.getSettings ? track.getSettings() : {};
    const label = track.label || '';
    if (settings.displaySurface ||
        /screen|window|display|monitor/i.test(label)) {
        return 'screen';
    }
    return 'camera';
}
```

## Global Export

```javascript
window.webMeetWebRTC = WebRTCRoom;
```

## Related Modules

- [server-webmeet-client.md](./server-webmeet-client.md) - Signaling integration
- [server-webmeet-media.md](./server-webmeet-media.md) - Media coordination

