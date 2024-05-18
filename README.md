### WRP (WebRTC Relay Point)

The `WRP` (WebRTC Relay Point) module is a comprehensive Node.js package designed to facilitate WebRTC connections between clients. It provides a robust set of functionalities to manage peer connections, handle data channels, and ensure secure and reliable media streaming. This module abstracts the complexities of WebRTC and provides a simplified interface for developers to build WebRTC-based applications.

#### Key Features
1. **Peer Connection Management**: Simplified creation and management of RTCPeerConnections.
2. **Data Channels**: Easy-to-use data channels for sending and receiving arbitrary data.
3. **ICE Candidate Handling**: Efficient handling of ICE candidates with IP filtering.
4. **Media Device Access**: Access to user media devices for audio and video streams.
5. **Encryption and Decryption**: Secure SDP encryption and decryption using AES-256-CBC.
6. **Preferred Codec Setting**: Ability to set preferred codecs in SDP.
7. **Event Handling**: Comprehensive event handling for various WebRTC events.
8. **Nonstandard WebRTC Interfaces**: Additional functionalities like video and audio sinks and sources.

### Security Measures
- **HTTPS Requirement**: WebRTC requires a secure context, which means the application must be served over HTTPS. This module ensures all interactions occur over a secure connection, preventing man-in-the-middle attacks.
- **SDP Encryption**: By default, SDP is encrypted using a predefined key (`badnintendo`). This can be customized as needed, ensuring the signaling data remains confidential.
- **ICE Candidate Filtering**: Sanitization of ICE candidates to prevent IP leakage and enhance privacy.
- **STUN/TURN Servers**: Proper configuration of STUN/TURN servers to handle NAT traversal, ensuring reliable connectivity even in restrictive network environments.

### Usage Guide

# WRP (WebRTC Relay Point) - Comprehensive WebRTC Module

## Introduction

WRP (WebRTC Relay Point) is a Node.js package designed to facilitate WebRTC connections between clients. It simplifies the management of peer connections, data channels, and media streams, providing a secure and efficient solution for WebRTC-based applications.

### Key Features
- Peer Connection Management
- Data Channels
- ICE Candidate Handling
- Media Device Access
- SDP Encryption and Decryption
- Preferred Codec Setting
- Comprehensive Event Handling
- Nonstandard WebRTC Interfaces

## Installation

```sh
npm install wrp
```

## Usage

### Importing the Module

```javascript
const {
  RTCDataChannel,
  RTCIceCandidate,
  RTCPeerConnection,
  RTCError,
  RTCPeerConnectionIceErrorEvent,
  mediaDevices,
  nonstandard,
  encryptSDP,
  decryptSDP,
  setPreferredCodec,
  generateRoomId
} = require('wrp');
```

### Creating a Peer Connection

```javascript
const wrp = new RTCPeerConnection({
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' }
  ],
  iceCandidatePoolSize: 12
});

wrp.on('icecandidate', ({ candidate }) => {
  if (candidate) {
    console.log('New ICE candidate:', candidate);
  } else {
    console.log('All ICE candidates have been sent');
  }
});

wrp.on('track', (event) => {
  // Handle track event
});
```

### Creating an Offer

```javascript
async function createOffer() {
  const offer = await wrp.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
  await wrp.setLocalDescription(offer);
  console.log('Local description set:', wrp.localDescription);
}
createOffer();
```

### Setting Remote Description

```javascript
async function setRemoteDesc(remoteDesc) {
  await wrp.setRemoteDescription(new RTCSessionDescription(remoteDesc));
}
```

### Adding ICE Candidate

```javascript
async function addIceCandidate(candidate) {
  await wrp.addIceCandidate(new RTCIceCandidate(candidate));
}
```

### Creating a Data Channel

```javascript
const dataChannel = wrp.createDataChannel('chat');

dataChannel.on('open', () => {
  console.log('Data channel is open');
});

dataChannel.on('message', (event) => {
  console.log('Message received:', event.data);
});

dataChannel.send('Hello, World!');
```

### Encrypting and Decrypting SDP

```javascript
const sdp = 'example sdp';
const encryptedSDP = encryptSDP(sdp);
const decryptedSDP = decryptSDP(encryptedSDP);
console.log('Encrypted SDP:', encryptedSDP);
console.log('Decrypted SDP:', decryptedSDP);
```

### Media Device Access

```javascript
async function getUserMedia() {
  const stream = await mediaDevices.getUserMedia({ video: true, audio: true });
  stream.getTracks().forEach(track => wrp.addTrack(track, stream));
}

async function getUserMediaAudioOnly() {
  const stream = await mediaDevices.getUserMediaAudioOnly();
  stream.getTracks().forEach(track => wrp.addTrack(track, stream));
}

async function getUserMediaVideoOnly() {
  const stream = await mediaDevices.getUserMediaVideoOnly();
  stream.getTracks().forEach(track => wrp.addTrack(track, stream));
}
```

## Security Considerations

- **HTTPS**: WebRTC requires secure connections. Ensure your application is served over HTTPS.
- **SDP Encryption**: The SDP is encrypted using AES-256-CBC to protect signaling data.
- **ICE Candidate Filtering**: Sanitization of ICE candidates to prevent IP leakage.
- **STUN/TURN Servers**: Properly configured STUN/TURN servers ensure reliable connectivity.

## Nonstandard Interfaces

- **RTCAudioSink**: Handle audio data.
- **RTCAudioSource**: Provide audio data.
- **RTCVideoSink**: Handle video data.
- **RTCVideoSource**: Provide video data.
- **i420ToRgba / rgbaToI420**: Convert between video formats.

## Conclusion

WRP (WebRTC Relay Point) provides a robust and secure solution for managing WebRTC connections in Node.js applications. By simplifying the complexities of WebRTC, it allows developers to focus on building rich, real-time communication features.

```
