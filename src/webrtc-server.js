const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const webrtcpoint = require('./bind');

const PUBLIC_KEY = crypto.randomBytes(32); // Securely generate a 32-byte key
const IV = crypto.randomBytes(16); // Securely generate an initialization vector

/**
 * Utility function for validating and sanitizing input.
 * @param {string} input - The input to validate and sanitize.
 * @returns {string} - The sanitized input.
 * @throws {Error} - If the input is not a string.
 */
const validateAndSanitize = (input) => {
  if (typeof input !== 'string') {
    throw new Error('Invalid input type: expected a string');
  }
  return input.trim();
};

/**
 * Encrypts the SDP using AES-256-CBC.
 * @param {string} sdp - The SDP to encrypt.
 * @param {Buffer} [key=PUBLIC_KEY] - The encryption key.
 * @returns {string} - The encrypted SDP.
 */
const encryptSDP = (sdp, key = PUBLIC_KEY) => {
  const cipher = crypto.createCipheriv('aes-256-cbc', key, IV);
  let encrypted = cipher.update(sdp, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return encrypted;
};

/**
 * Decrypts the SDP using AES-256-CBC.
 * @param {string} encryptedSdp - The encrypted SDP.
 * @param {Buffer} [key=PUBLIC_KEY] - The decryption key.
 * @returns {string} - The decrypted SDP.
 */
const decryptSDP = (encryptedSdp, key = PUBLIC_KEY) => {
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, IV);
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
  let rtpmapLine = `a=rtpmap:${codecId} ${codecName}`;
  if (fmtpLine) rtpmapLine += `\na=fmtp:${codecId} ${fmtpLine}`;
  return sdp.replace(/m=video .+\r\n/, `m=video ${rtpmapLine}\r\n`);
};

/**
 * Generates a unique room ID.
 * @returns {string} - The generated room ID.
 */
const generateRoomId = () => uuidv4();

/**
 * Event Target class for handling custom events.
 */
class RTCEventTarget extends EventEmitter {}

/**
 * RTCDataChannel class.
 */
class RTCDataChannel extends RTCEventTarget {
  /**
   * Creates an RTCDataChannel instance.
   * @param {string} label - The label for the data channel.
   * @param {Object} options - The options for the data channel.
   */
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

  /**
   * Creates an event handler for the specified event type.
   * @param {string} eventType - The type of event to handle.
   * @returns {Function} - The event handler function.
   */
  _createEventHandler(eventType) {
    return (...args) => this.emit(eventType, ...args);
  }

  /**
   * Sends data over the data channel.
   * @param {any} data - The data to send.
   */
  send(data) {
    this._dc.send(data);
  }

  /**
   * Closes the data channel.
   */
  close() {
    this._dc.close();
  }
}

/**
 * RTCIceCandidate implementation with IP filtering.
 */
class RTCIceCandidate {
  /**
   * Creates an RTCIceCandidate instance.
   * @param {Object} candidateInitDict - The candidate initialization dictionary.
   */
  constructor(candidateInitDict) {
    const sanitizedCandidate = RTCIceCandidate.sanitizeCandidate(candidateInitDict.candidate);
    [
      'candidate', 'sdpMid', 'sdpMLineIndex', 'foundation', 'component', 'priority',
      'address', 'protocol', 'port', 'type', 'tcpType', 'relatedAddress', 'relatedPort', 'usernameFragment'
    ].forEach(property => {
      this[property] = candidateInitDict[property] || null;
    });
  }

  /**
   * Sanitizes the candidate string by removing IP addresses.
   * @param {string} candidate - The candidate string to sanitize.
   * @returns {string} - The sanitized candidate string.
   */
  static sanitizeCandidate(candidate) {
    return candidate.replace(/a=candidate:\d+ \d+ udp \d+ \d+\.\d+\.\d+\.\d+ \d+ typ host/g, '');
  }
}

/**
 * SFUManager class for managing multiple participants and media streams.
 */
class SFUManager extends RTCEventTarget {
  /**
   * Creates an SFUManager instance.
   */
  constructor() {
    super();
    this.participants = new Map();
    this.mixedStreams = new Map();
  }

  /**
   * Adds a participant to the SFU.
   * @param {string} participantId - The ID of the participant.
   * @param {RTCPeerConnection} peerConnection - The peer connection of the participant.
   */
  addParticipant(participantId, peerConnection) {
    this.participants.set(participantId, peerConnection);
    peerConnection.ontrack = (event) => this.handleTrack(participantId, event);
  }

  /**
   * Removes a participant from the SFU.
   * @param {string} participantId - The ID of the participant.
   */
  removeParticipant(participantId) {
    if (this.participants.has(participantId)) {
      this.participants.get(participantId).close();
      this.participants.delete(participantId);
    }
  }

  /**
   * Handles a track event from a participant.
   * @param {string} participantId - The ID of the participant.
   * @param {RTCTrackEvent} event - The track event.
   */
  handleTrack(participantId, event) {
    const stream = event.streams[0];
    if (!this.mixedStreams.has(stream.id)) {
      const mixedStream = new MediaStream();
      this.mixedStreams.set(stream.id, mixedStream);
    }
    const mixedStream = this.mixedStreams.get(stream.id);
    mixedStream.addTrack(event.track);

    this.participants.forEach((pc, id) => {
      if (id !== participantId) {
        pc.addTrack(event.track, mixedStream);
      }
    });
  }

  /**
   * Broadcasts a stream to all participants.
   * @param {MediaStream} stream - The stream to broadcast.
   */
  broadcastStream(stream) {
    this.participants.forEach((pc) => {
      stream.getTracks().forEach((track) => {
        pc.addTrack(track, stream);
      });
    });
  }

  /**
   * Enables simulcast for a track.
   * @param {RTCPeerConnection} pc - The peer connection.
   * @param {MediaStreamTrack} track - The track to enable simulcast for.
   */
  enableSimulcast(pc, track) {
    const sender = pc.addTrack(track);
    const params = sender.getParameters();
    if (!params.encodings) {
      params.encodings = [{}];
    }
    params.encodings = [
      { rid: 'f', maxBitrate: 500000 }, // Full resolution
      { rid: 'h', maxBitrate: 200000, scaleResolutionDownBy: 2.0 }, // Half resolution
      { rid: 'q', maxBitrate: 100000, scaleResolutionDownBy: 4.0 } // Quarter resolution
    ];
    sender.setParameters(params);
  }

  /**
   * Enables SVC for a track.
   * @param {RTCPeerConnection} pc - The peer connection.
   * @param {MediaStreamTrack} track - The track to enable SVC for.
   */
  enableSVC(pc, track) {
    const sender = pc.addTrack(track);
    const params = sender.getParameters();
    if (!params.encodings) {
      params.encodings = [{}];
    }
    params.encodings[0].scalabilityMode = 'L3T3_KEY'; // 3 temporal layers, 3 spatial layers
    sender.setParameters(params);
  }

  /**
   * Adjusts the bitrate based on available bandwidth.
   * @param {RTCPeerConnection} pc - The peer connection.
   * @param {number} availableBandwidth - The available bandwidth.
   */
  adjustBitrate(pc, availableBandwidth) {
    pc.getSenders().forEach((sender) => {
      const params = sender.getParameters();
      if (params.encodings) {
        params.encodings.forEach((encoding) => {
          encoding.maxBitrate = Math.min(availableBandwidth, encoding.maxBitrate || availableBandwidth);
        });
        sender.setParameters(params);
      }
    });
  }

  /**
   * Monitors network conditions and adjusts bitrate accordingly.
   * @param {RTCPeerConnection} pc - The peer connection.
   */
  monitorNetworkConditions(pc) {
    setInterval(async () => {
      const stats = await pc.getStats();
      stats.forEach((report) => {
        if (report.type === 'outbound-rtp' && !report.isRemote) {
          const availableBandwidth = this.estimateAvailableBandwidth(report);
          this.adjustBitrate(pc, availableBandwidth);
        }
      });
    }, 5000);
  }

  /**
   * Estimates the available bandwidth based on RTP statistics.
   * @param {RTCStatsReport} report - The RTP statistics report.
   * @returns {number} - The estimated available bandwidth in bits per second.
   */
  estimateAvailableBandwidth(report) {
    const packetLossRate = report.packetsLost / report.packetsSent;
    const rtt = report.roundTripTime;
    const jitter = report.jitter;
    const throughput = (report.bytesSent * 8) / report.timestamp; // bits per second

    // Adjust bandwidth estimation based on network conditions
    let availableBandwidth = throughput;
    if (packetLossRate > 0.05) {
      availableBandwidth *= 0.75;
    }
    if (rtt > 300) {
      availableBandwidth *= 0.85;
    }
    if (jitter > 100) {
      availableBandwidth *= 0.9;
    }

    return availableBandwidth;
  }
}

/**
 * RTCPeerConnection class with enhanced capabilities.
 */
class RTCPeerConnection extends RTCEventTarget {
  /**
   * Creates an RTCPeerConnection instance.
   * @param {RTCConfiguration} config - The configuration for the peer connection.
   */
  constructor(config) {
    super();
    this._pc = new webrtcpoint.RTCPeerConnection(config);
    this._sfuManager = new SFUManager();

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

  /**
   * Creates an event handler for the specified event type.
   * @param {string} eventType - The type of event to handle.
   * @returns {Function} - The event handler function.
   */
  _createEventHandler(eventType) {
    return (...args) => this.emit(eventType, ...args);
  }

  /**
   * Creates an error handler for ICE candidate errors.
   * @returns {Function} - The error handler function.
   */
  _createIceCandidateErrorHandler() {
    return (eventInitDict) => {
      const [address, port] = eventInitDict.hostCandidate.split(':');
      this.emit('icecandidateerror', { ...eventInitDict, address, port });
    };
  }

  /**
   * Creates an offer for the peer connection.
   * @param {RTCOfferOptions} [options] - The options for the offer.
   * @returns {Promise<RTCSessionDescriptionInit>} - The created offer.
   */
  async createOffer(options) {
    return await this._pc.createOffer(options);
  }

  /**
   * Sets the local description for the peer connection.
   * @param {RTCSessionDescriptionInit} description - The session description.
   * @returns {Promise<void>}
   */
  async setLocalDescription(description) {
    return await this._pc.setLocalDescription(description);
  }

  /**
   * Sets the remote description for the peer connection.
   * @param {RTCSessionDescriptionInit} description - The session description.
   * @returns {Promise<void>}
   */
  async setRemoteDescription(description) {
    return await this._pc.setRemoteDescription(description);
  }

  /**
   * Adds an ICE candidate to the peer connection.
   * @param {RTCIceCandidateInit} candidate - The ICE candidate.
   * @returns {Promise<void>}
   */
  async addIceCandidate(candidate) {
    return await this._pc.addIceCandidate(candidate);
  }

  /**
   * Gets the statistics for the peer connection.
   * @returns {Promise<RTCStatsReport>} - The statistics report.
   */
  async getStats() {
    return await this._pc.getStats();
  }

  /**
   * Adds a track to the peer connection.
   * @param {MediaStreamTrack} track - The track to add.
   * @param {...MediaStream} streams - The media streams associated with the track.
   * @returns {RTCRtpSender} - The RTP sender.
   */
  async addTrack(track, ...streams) {
    const sender = await this._pc.addTrack(track, ...streams);
    if (streams.length > 0) {
      this._sfuManager.enableSimulcast(this._pc, track);
      this._sfuManager.enableSVC(this._pc, track);
    }
    this._sfuManager.monitorNetworkConditions(this._pc);
    return sender;
  }

  /**
   * Closes the peer connection.
   */
  close() {
    this._pc.close();
  }

  /**
   * Creates a data channel for the peer connection.
   * @param {string} label - The label for the data channel.
   * @param {RTCDataChannelInit} [options] - The options for the data channel.
   * @returns {RTCDataChannel} - The created data channel.
   */
  createDataChannel(label, options) {
    return new RTCDataChannel(label, options);
  }

  /**
   * Gets the configuration of the peer connection.
   * @returns {RTCConfiguration} - The configuration of the peer connection.
   */
  getConfiguration() {
    return this._pc.getConfiguration();
  }

  /**
   * Gets the receivers of the peer connection.
   * @returns {RTCRtpReceiver[]} - The receivers of the peer connection.
   */
  getReceivers() {
    return this._pc.getReceivers();
  }

  /**
   * Gets the senders of the peer connection.
   * @returns {RTCRtpSender[]} - The senders of the peer connection.
   */
  getSenders() {
    return this._pc.getSenders();
  }

  /**
   * Gets the transceivers of the peer connection.
   * @returns {RTCRtpTransceiver[]} - The transceivers of the peer connection.
   */
  getTransceivers() {
    return this._pc.getTransceivers();
  }

  /**
   * Removes a track from the peer connection.
   * @param {RTCRtpSender} sender - The RTP sender associated with the track.
   * @returns {void}
   */
  removeTrack(sender) {
    return this._pc.removeTrack(sender);
  }

  /**
   * Sets the configuration for the peer connection.
   * @param {RTCConfiguration} configuration - The new configuration.
   * @returns {void}
   */
  setConfiguration(configuration) {
    this._pc.setConfiguration(configuration);
  }

  /**
   * Restarts the ICE process for the peer connection.
   * @returns {void}
   */
  restartIce() {
    this._pc.restartIce();
  }

  /**
   * Gets the ICE connection state.
   * @returns {RTCIceConnectionState} - The ICE connection state.
   */
  get iceConnectionState() {
    return this._pc.iceConnectionState;
  }

  /**
   * Gets the ICE gathering state.
   * @returns {RTCIceGatheringState} - The ICE gathering state.
   */
  get iceGatheringState() {
    return this._pc.iceGatheringState;
  }

  /**
   * Gets the signaling state.
   * @returns {RTCSignalingState} - The signaling state.
   */
  get signalingState() {
    return this._pc.signalingState;
  }

  /**
   * Gets the local description.
   * @returns {RTCSessionDescription} - The local description.
   */
  get localDescription() {
    return this._pc.localDescription ? new RTCSessionDescription(this._pc.localDescription) : null;
  }

  /**
   * Gets the remote description.
   * @returns {RTCSessionDescription} - The remote description.
   */
  get remoteDescription() {
    return this._pc.remoteDescription ? new RTCSessionDescription(this._pc.remoteDescription) : null;
  }
}

/**
 * Error class for RTC-related errors.
 */
class RTCError extends Error {
  /**
   * Creates an RTCError instance.
   * @param {number} code - The error code.
   * @param {string} [message] - The error message.
   */
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
 * Error class for ICE candidate errors.
 */
class RTCPeerConnectionIceErrorEvent extends Error {
  /**
   * Creates an RTCPeerConnectionIceErrorEvent instance.
   * @param {string} type - The event type.
   * @param {Object} eventInitDict - The event initialization dictionary.
   */
  constructor(type, eventInitDict) {
    super(eventInitDict.errorText);
    Object.assign(this, eventInitDict, { type });
  }
}

/**
 * Media Devices interface.
 */
const mediaDevices = {
  /**
   * Gets display media.
   * @param {MediaStreamConstraints} constraints - The constraints for the display media.
   * @returns {Promise<MediaStream>} - The display media stream.
   */
  getDisplayMedia: (constraints) => {
    validateAndSanitize(constraints);
    return webrtcpoint.getDisplayMedia(constraints);
  },

  /**
   * Gets user media.
   * @param {MediaStreamConstraints} constraints - The constraints for the user media.
   * @returns {Promise<MediaStream>} - The user media stream.
   */
  getUserMedia: (constraints) => {
    validateAndSanitize(constraints);
    return webrtcpoint.getUserMedia(constraints);
  },

  /**
   * Gets audio-only user media.
   * @returns {Promise<MediaStream>} - The audio-only user media stream.
   */
  getUserMediaAudioOnly: async () => {
    const constraints = { audio: true, video: false };
    return webrtcpoint.getUserMedia(constraints);
  },

  /**
   * Gets video-only user media.
   * @returns {Promise<MediaStream>} - The video-only user media stream.
   */
  getUserMediaVideoOnly: async () => {
    const constraints = { audio: false, video: true };
    return webrtcpoint.getUserMedia(constraints);
  },

  /**
   * Enumerates the available media devices.
   * @throws {Error} - This feature is not yet implemented.
   */
  enumerateDevices: () => {
    throw new Error('Not yet implemented; file a feature request against node-webrtc');
  },

  /**
   * Gets the supported constraints for media devices.
   * @throws {Error} - This feature is not yet implemented.
   */
  getSupportedConstraints: () => {
    throw new Error('Not yet implemented; file a feature request against node-webrtc');
  }
};

/**
 * Nonstandard interfaces for WebRTC functionalities.
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
