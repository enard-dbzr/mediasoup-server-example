

export class Connection {
  constructor (sessionId) {
    this.sessionId = sessionId;
    this.producerTransport = undefined;

    /**
     * A mediasoup producer; it represents an audio or video source being routed through the server.
     * It's critical fpeer.addTransport(producerTransport);or managing the sending of media data to consumers.
     */
    this.producer = undefined;

    /**
     * A mediasoup consumer; it represents an audio or video sink being routed through the server.
     * It's critical for managing the reception of media data from producers.
     */
    this.consumer = undefined;
    this.process = undefined;
  }
}
