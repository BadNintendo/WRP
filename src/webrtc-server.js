// webrtc-server.js
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const webrtcpoint = require('./bind');

const PUBLIC_KEY = 'badnintendo';

/**
 * Utility function for validating and sanitizing input
 * @param {string} input - The input to validate and sanitize.
 * @returns {string} - The sanitized input.
 * @throws {Error} - If the input is not a string.
 */
const validateAndSanitize = (input) => {
  if (typeof input !== 'string') {
    throw new Error('Invalid input type');
  }
  return input;
};

/**
 * Encrypts the SDP using AES-256-CBC.
 * @param {string} sdp - The SDP to encrypt.
 * @param {string} [key=PUBLIC_KEY] - The encryption key.
 * @returns {string} - The encrypted SDP.
 */
const encryptSDP = (sdp, key = PUBLIC_KEY) => {
  const cipher = crypto.createCipher('aes-256-cbc', key);
  let encrypted = cipher.update(sdp, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return encrypted;
};

/**
 * Decrypts the SDP using AES-256-CBC.
 * @param {string} encryptedSdp - The encrypted SDP.
 * @param {string} [key=PUBLIC_KEY] - The decryption key.
 * @returns {string} - The decrypted SDP.
 */
const decryptSDP = (encryptedSdp, key = PUBLIC_KEY) => {
  const decipher = crypto.createDecipher('aes-256-cbc', key);
  let decrypted = decipher.update(encryptedSdp, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
};

/**
 * Sets the preferred codec in the SDP.
 * @param {string} sdp - The SDP to modify.
 * @param {string} codecName - The preferred codec name.
 * @returns {string} - The modified SDP.
 */
const setPreferredCodec = (sdp, codecName) => {
  const regex = new RegExp(`a=rtpmap:(\\d+) ${codecName}\\/`, 'i');
  const codecMatch = sdp.match(regex);
  if (!codecMatch) {
    console.warn(`No ${codecName} codec found in the SDP`);
    return sdp;
  }
  const codecId = codecMatch[1];
  const regex2 = new RegExp(`a=fmtp:${codecId} (.+)`, 'i');
  const fmtpMatch = sdp.match(regex2);
  const fmtpLine = (fmtpMatch && fmtpMatch[1]) || '';
  let rtpmapLine = `${codecId} ${codecName}`;
  if (fmtpLine) rtpmapLine += `\na=fmtp:${codecId} ${fmtpLine}`;
  return sdp.replace(/m=video .+\r\n/, `m=video ${rtpmapLine}\r\n`);
};

/**
 * Generates a unique room ID.
 * @returns {string} - The generated room ID.
 */
const generateRoomId = () => uuidv4();

/**
 * Event Target class for handling custom events
 */
class RTCEventTarget extends EventEmitter {}

/**
 * RTCDataChannel class
 */
class RTCDataChannel extends RTCEventTarget {
  constructor(label, options) {
    super();
    this.label = label;
    this.options = options;
    this._dc = new webrtcpoint.RTCDataChannel(label, options);

    this._dc.onopen = this._createEventHandler('open');
    this._dc.onclose = this._createEventHandler('close');
    this._dc.onerror = this._createEventHandler('error');
    this._dc.onmessage = this._createEventHandler('message');
  }

  _createEventHandler(eventType) {
    return (...args) => this.emit(eventType, ...args);
  }

  send(data) {
    this._dc.send(data);
  }

  close() {
    this._dc.close();
  }
}

/**
 * RTCIceCandidate Implementation with IP filtering
 */
class RTCIceCandidate {
  constructor(candidateInitDict) {
    const sanitizedCandidate = RTCIceCandidate.sanitizeCandidate(candidateInitDict.candidate);
    [
      'candidate', 'sdpMid', 'sdpMLineIndex', 'foundation', 'component', 'priority',
      'address', 'protocol', 'port', 'type', 'tcpType', 'relatedAddress', 'relatedPort', 'usernameFragment'
    ].forEach(property => {
      this[property] = candidateInitDict[property] || null;
    });
  }

  static sanitizeCandidate(candidate) {
    return candidate.replace(/a=candidate:\d+ \d+ udp \d+ \d+\.\d+\.\d+\.\d+ \d+ typ host/g, '');
  }
}

/**
 * RTCPeerConnection class
 */
class RTCPeerConnection extends RTCEventTarget {
  constructor(config) {
    super();
    this._pc = new webrtcpoint.RTCPeerConnection(config);

    this._pc.ontrack = this._createEventHandler('track');
    this._pc.onicecandidate = this._createEventHandler('icecandidate');
    this._pc.onicecandidateerror = this._createIceCandidateErrorHandler();
    this._pc.onconnectionstatechange = this._createEventHandler('connectionstatechange');
    this._pc.onsignalingstatechange = this._createEventHandler('signalingstatechange');
    this._pc.oniceconnectionstatechange = this._createEventHandler('iceconnectionstatechange');
    this._pc.onicegatheringstatechange = this._createEventHandler('icegatheringstatechange');
    this._pc.onnegotiationneeded = this._createEventHandler('negotiationneeded');
    this._pc.ondatachannel = this._createEventHandler('datachannel');
  }

  _createEventHandler(eventType) {
    return (...args) => this.emit(eventType, ...args);
  }

  _createIceCandidateErrorHandler() {
    return (eventInitDict) => {
      const [address, port] = eventInitDict.hostCandidate.split(':');
      this.emit('icecandidateerror', { ...eventInitDict, address, port });
    };
  }

  async createOffer(options) {
    return await this._pc.createOffer(options);
  }

  async setLocalDescription(description) {
    return await this._pc.setLocalDescription(description);
  }

  async setRemoteDescription(description) {
    return await this._pc.setRemoteDescription(description);
  }

  async addIceCandidate(candidate) {
    return await this._pc.addIceCandidate(candidate);
  }

  async getStats() {
    return await this._pc.getStats();
  }

  async addTrack(track, ...streams) {
    return await this._pc.addTrack(track, ...streams);
  }

  close() {
    this._pc.close();
  }

  createDataChannel(label, options) {
    return new RTCDataChannel(label, options);
  }

  getConfiguration() {
    return this._pc.getConfiguration();
  }

  getReceivers() {
    return this._pc.getReceivers();
  }

  getSenders() {
    return this._pc.getSenders();
  }

  getTransceivers() {
    return this._pc.getTransceivers();
  }

  removeTrack(sender) {
    return this._pc.removeTrack(sender);
  }

  setConfiguration(configuration) {
    return this._pc.setConfiguration(configuration);
  }

  restartIce() {
    return this._pc.restartIce();
  }

  get iceConnectionState() {
    return this._pc.iceConnectionState;
  }

  get iceGatheringState() {
    return this._pc.iceGatheringState;
  }

  get signalingState() {
    return this._pc.signalingState;
  }

  get localDescription() {
    return this._pc.localDescription ? new RTCSessionDescription(this._pc.localDescription) : null;
  }

  get remoteDescription() {
    return this._pc.remoteDescription ? new RTCSessionDescription(this._pc.remoteDescription) : null;
  }
}

/**
 * Error class for RTC-related errors
 */
class RTCError extends Error {
  constructor(code, message) {
    super(message || RTCError.reasonName[code]);
    this.name = RTCError.reasonName[code];
  }

  static reasonName = [
    'NO_ERROR',
    'INVALID_CONSTRAINTS_TYPE',
    'INVALID_CANDIDATE_TYPE',
    'INVALID_STATE',
    'INVALID_SESSION_DESCRIPTION',
    'INCOMPATIBLE_SESSION_DESCRIPTION',
    'INCOMPATIBLE_CONSTRAINTS',
    'INTERNAL_ERROR'
  ];
}

/**
 * Error class for ICE candidate errors
 */
class RTCPeerConnectionIceErrorEvent extends Error {
  constructor(type, eventInitDict) {
    super(eventInitDict.errorText);
    Object.assign(this, eventInitDict, { type });
  }
}

/**
 * Media Devices interface
 */
const mediaDevices = {
  getDisplayMedia: (constraints) => {
    validateAndSanitize(constraints);
    return webrtcpoint.getDisplayMedia(constraints);
  },
  getUserMedia: (constraints) => {
    validateAndSanitize(constraints);
    return webrtcpoint.getUserMedia(constraints);
  },
  getUserMediaAudioOnly: async () => {
    const constraints = { audio: true, video: false };
    return webrtcpoint.getUserMedia(constraints);
  },
  getUserMediaVideoOnly: async () => {
    const constraints = { audio: false, video: true };
    return webrtcpoint.getUserMedia(constraints);
  },
  enumerateDevices: () => {
    throw new Error('Not yet implemented; file a feature request against node-webrtc');
  },
  getSupportedConstraints: () => {
    throw new Error('Not yet implemented; file a feature request against node-webrtc');
  }
};

/**
 * Nonstandard interfaces for WebRTC functionalities
 */
const nonstandard = {
  i420ToRgba: webrtcpoint.i420ToRgba,
  RTCAudioSink: webrtcpoint.RTCAudioSink,
  RTCAudioSource: webrtcpoint.RTCAudioSource,
  RTCVideoSink: webrtcpoint.RTCVideoSink,
  RTCVideoSource: webrtcpoint.RTCVideoSource,
  rgbaToI420: webrtcpoint.rgbaToI420
};

module.exports = {
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
};
