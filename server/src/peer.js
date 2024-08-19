

export class Peer {
  constructor (sessionId) {
    this.sessionId = sessionId;
    this.producerTransport = undefined;
    this.producer = undefined;
    this.consumer = undefined;
    this.process = undefined;
    this.remotePorts = [];
    this.socket = undefined;
    this.rtpTransport = undefined;
  }
}
