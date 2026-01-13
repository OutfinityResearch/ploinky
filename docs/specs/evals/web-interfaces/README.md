# Web Interface Evaluations

## Overview

Evaluation scenarios for Ploinky browser-based interfaces. Tests cover WebTTY terminal sessions, WebChat messaging and voice, WebMeet video conferencing, and Dashboard monitoring.

## Scenarios

### WebTTY Terminal

#### webtty-connect
Verify terminal connection establishment.

**Steps**:
1. Start agent with WebTTY enabled
2. Navigate to WebTTY URL
3. Verify terminal renders
4. Test keyboard input

**Expected**: Interactive terminal session

---

#### webtty-resize
Verify terminal resize handling.

**Steps**:
1. Connect to WebTTY
2. Resize browser window
3. Verify terminal adjusts
4. Check text reflow

**Expected**: Terminal resizes without corruption

---

#### webtty-disconnect
Verify clean disconnect handling.

**Steps**:
1. Connect to WebTTY
2. Close browser tab
3. Verify server cleanup
4. Reconnect successfully

**Expected**: Clean state, reconnection works

### WebChat

#### webchat-message-send
Verify message sending.

**Steps**:
1. Open WebChat interface
2. Type message in input
3. Press send
4. Verify message appears

**Expected**: Message sent and displayed

---

#### webchat-voice-input
Verify voice input (STT).

**Steps**:
1. Click microphone button
2. Speak message
3. Verify transcription
4. Send transcribed message

**Expected**: Speech transcribed accurately

---

#### webchat-voice-output
Verify voice output (TTS).

**Steps**:
1. Receive message
2. Click speak button
3. Verify audio plays
4. Check voice selection

**Expected**: Message spoken with selected voice

---

#### webchat-file-upload
Verify file upload.

**Steps**:
1. Click upload button
2. Select file
3. Verify upload progress
4. Confirm file sent

**Expected**: File uploaded and accessible

### WebMeet

#### webmeet-join
Verify meeting join flow.

**Steps**:
1. Navigate to meeting URL
2. Enter token/email
3. Verify authentication
4. Join meeting room

**Expected**: User joins meeting

---

#### webmeet-audio
Verify audio broadcast.

**Steps**:
1. Join meeting
2. Unmute microphone
3. Speak
4. Verify others hear audio

**Expected**: Audio transmitted to participants

---

#### webmeet-video
Verify video broadcast.

**Steps**:
1. Join meeting
2. Enable camera
3. Verify video preview
4. Confirm others see video

**Expected**: Video visible to participants

---

#### webmeet-screenshare
Verify screen sharing.

**Steps**:
1. Join meeting
2. Start screen share
3. Select window/screen
4. Verify share visible

**Expected**: Screen shared to participants

---

#### webmeet-chat
Verify in-meeting chat.

**Steps**:
1. Join meeting
2. Send chat message
3. Verify message appears
4. Check all participants receive

**Expected**: Chat messages delivered

### Dashboard

#### dashboard-status
Verify agent status display.

**Steps**:
1. Open dashboard
2. Verify agent list
3. Check status indicators
4. Confirm real-time updates

**Expected**: Accurate, live status

---

#### dashboard-logs
Verify log viewing.

**Steps**:
1. Open dashboard
2. Select agent
3. View logs
4. Verify log streaming

**Expected**: Logs displayed in real-time

---

#### dashboard-actions
Verify agent control actions.

**Steps**:
1. Open dashboard
2. Select agent
3. Click start/stop
4. Verify action executed

**Expected**: Actions take effect

## Test Matrix

| Scenario | Priority | Automation |
|----------|----------|------------|
| webtty-connect | P0 | Manual |
| webtty-resize | P2 | Manual |
| webtty-disconnect | P1 | Manual |
| webchat-message-send | P0 | Manual |
| webchat-voice-input | P1 | Manual |
| webchat-voice-output | P1 | Manual |
| webchat-file-upload | P2 | Manual |
| webmeet-join | P0 | Manual |
| webmeet-audio | P0 | Manual |
| webmeet-video | P1 | Manual |
| webmeet-screenshare | P2 | Manual |
| webmeet-chat | P1 | Manual |
| dashboard-status | P1 | Manual |
| dashboard-logs | P2 | Manual |
| dashboard-actions | P1 | Manual |

## Browser Requirements

| Interface | Chrome | Firefox | Safari | Edge |
|-----------|--------|---------|--------|------|
| WebTTY | Yes | Yes | Yes | Yes |
| WebChat | Yes | Yes | Yes* | Yes |
| WebMeet | Yes | Yes | Limited | Yes |
| Dashboard | Yes | Yes | Yes | Yes |

*Safari: Web Speech API limitations

## Related Specifications

- [../../DS/DS06-web-interfaces.md](../../DS/DS06-web-interfaces.md) - Web Interfaces
- [../../src/cli/server/webchat/](../../src/cli/server/webchat/) - WebChat docs
- [../../src/cli/server/webmeet/](../../src/cli/server/webmeet/) - WebMeet docs
- [../../src/cli/server/webtty/](../../src/cli/server/webtty/) - WebTTY docs
