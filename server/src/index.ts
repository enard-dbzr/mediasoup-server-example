/**
 * @module index
 * This module sets up the Socket.IO server and initializes the mediasoup components
 * necessary for media transport.
 * It also handles all socket events related to media transport.
 * @see {@link https://mediasoup.org/}
 * @see {@link https://socket.io/}
 */

import express from "express";
import http from "http";
import {Server} from "socket.io";
import cors from "cors";
import mediasoup from "mediasoup";
import {Ffmpeg} from "./ffmpeg.js";
import {getPort} from "./port.js";
import {v4 as uuid4} from "uuid";
import {Connection} from "./connection.js";


const app = express();
const port = 4000;
const server = http.createServer(app);
const connections = new Map()

app.use(
    cors({
        origin: "*",
        credentials: true,
    })
);

/**
 * Create a new instance of the Socket.IO server.
 */
const io = new Server(server, {
    cors: {
        origin: "*",
        credentials: true,
    },
});

/**
 * Namespace under which all mediasoup related socket events and data will be handled.
 * This helps in organizing socket events, making the codebase scalable and manageable.
 */
const peers = io.of("/");


/**
 * A mediasoup worker; it handles the media layer by managing Router instances.
 * @description It's crucial for the operation of the mediasoup server.
 */
let worker: mediasoup.types.Worker<mediasoup.types.AppData>;

/**
 * Asynchronously creates and initializes a mediasoup Worker.
 * A Worker is necessary for handling the low-level operations of media routing.
 *
 * @returns A Promise that resolves to a mediasoup Worker instance.
 */
const createWorker = async (): Promise<
    mediasoup.types.Worker<mediasoup.types.AppData>
> => {
    const newWorker = await mediasoup.createWorker({
        rtcMinPort: 2000, // Minimum port number for RTC traffic
        rtcMaxPort: 2020, // Maximum port number for RTC traffic
    });

    console.log(`Worker process ID ${newWorker.pid}`);

    /**
     * Event handler for the 'died' event on the worker.
     * This is crucial for handling failures in the media handling layer and ensuring system stability.
     */
    newWorker.on("died", (error) => {
        console.error("mediasoup worker has died");
        // Gracefully shut down the process to allow for recovery or troubleshooting.
        setTimeout(() => {
            process.exit();
        }, 2000);
    });

    return newWorker;
};

// Create and initialize the mediasoup Worker.
worker = await createWorker();

/**
 * The media codecs configuration array.
 * Each object in this array provides configuration for a specific audio or video codec.
 */
const mediaCodecs: mediasoup.types.RtpCodecCapability[] = [
    {
        kind: 'video',
        mimeType: 'video/VP8',
        clockRate: 90000,
        parameters: {
            'x-google-start-bitrate': 1000
        }
    },
    {
        kind: 'video',
        mimeType: 'video/VP9',
        clockRate: 90000,
        parameters: {
            'profile-id': 2,
            'x-google-start-bitrate': 1000
        }
    },
    {
        kind: 'video',
        mimeType: 'video/H264',
        clockRate: 90000,
        parameters: {
            'packetization-mode': 1,
            'profile-level-id': '42e01f',
            'level-asymmetry-allowed': 1,
            'x-google-start-bitrate': 1000
        },
        rtcpFeedback: [
            // Example values
            {type: "nack"},
            {type: "nack", parameter: "pli"},
        ],
    }
];

/**
 * Event handler for new peer connections.
 * This function sets up all necessary event handlers and transports for a connected peer.
 *
 * @param socket - The socket object representing the connected peer.
 */
peers.on("connection", async (socket) => {
    /**
     * A mediasoup router; it routes RTP (and RTCP) packets between WebRTC transports and others.
     * It's necessary for managing the flow of media data between producers and consumers.
     */
    let router: mediasoup.types.Router<mediasoup.types.AppData>;
    const sessionID = uuid4();
    const peer = new Connection(sessionID);
    connections.set(sessionID, peer);
    console.log("session id", sessionID);

    console.log(`Peer connected: ${socket.id}`);
    socket.emit("connection-success", {socketId: socket.id});

    /**
     * Event handler for peer disconnection.
     * This can be used to clean up resources associated with the peer.
     */
    socket.on("disconnect", () => {
        console.log("Peer disconnected");
    });

    /**
     * Create a router for the peer.
     * A router is required to route media to/from this peer.
     */
    router = await worker.createRouter({
        mediaCodecs: mediaCodecs,
    });

    /**
     * Event handler for fetching router RTP capabilities.
     * RTP capabilities are required for configuring transports and producers/consumers.
     * This function is called when a peer requests the router RTP capabilities.
     * @param {function} callback - A callback function to handle the result of the router RTP capabilities request.
     */
    socket.on("getRouterRtpCapabilities", (callback) => {
        const routerRtpCapabilities = router.rtpCapabilities;
        console.log("Sent router rtp capabilities");
        callback({routerRtpCapabilities, sessionId: peer.sessionId});
    });

    /**
     * Event handler for creating a transport.
     * A transport is required for sending or producing media.
     * This function is called when a peer requests to create a transport.
     * The callback function is used to send the transport parameters to the peer.
     * @param {boolean} data.sender - Indicates whether the transport is for sending or receiving media.
     * @param {function} callback - A callback function to handle the result of the transport creation.
     */
    /**
     * A mediasoup WebRTC transport for sending media.
     * It's essential for establishing a channel for sending media to a peer.
     */
    socket.on("createTransport", async ({sessionId}, callback) => {
        const peer = connections.get(sessionId);
        console.log("aaa", sessionID);
        peer.producerTransport = await createWebRtcTransport(callback);
    });

    /**
     * Event handler for connecting the sending transport.
     * This step is required before the transport can be used to send media.
     * @param {object} data.dtlsParameters - Datagram Transport Layer Security (DTLS) parameters.
     * These parameters are necessary for securing the transport with encryption.
     */
    socket.on("connectProducerTransport", async ({dtlsParameters, sessionId}) => {
        console.log("transport connected successfully", sessionId);
        const peer = connections.get(sessionId);
        const transport = peer.producerTransport;
        await transport.connect({dtlsParameters});
    });

    /**
     * Event handler for producing media.
     * This function sets up a producer for sending media to the peer.
     * A producer represents the source of a single media track (audio or video).
     */

    socket.on("transport-produce", async ({kind, rtpParameters, sessionId}, callback) => {
        const peer = connections.get(sessionId);
        peer.producer = await peer.producerTransport.produce({
            kind,
            rtpParameters,
        });

        peer.producer?.on("transportclose", () => {
            console.log("Producer transport closed");
            peer.producer?.close();
        });

        callback({id: peer.producer?.id});
    });

    const publishProducerRtpStream = async (peer: Connection) => {
        console.log('publishProducerRtpStream()', peer);

        // Create the mediasoup RTP Transport used to send media to the GStreamer process
        const rtpTransportConfig = {
            listenIp: {ip: '0.0.0.0', announcedIp: 'localhost'},
            rtcpMux: true,
            comedia: false
        };

        const rtpTransport = await router.createPlainTransport(rtpTransportConfig);

        // Set the receiver RTP ports
        const remoteRtpPort = await getPort();

        let remoteRtcpPort;
        if (!rtpTransportConfig.rtcpMux) {
            remoteRtcpPort = await getPort();
        }


        // Connect the mediasoup RTP transport to the ports used by GStreamer
        await rtpTransport.connect({
            ip: '127.0.0.1',
            port: remoteRtpPort,
            rtcpPort: remoteRtcpPort
        });

        const codecs = [];
        // Codec passed to the RTP Consumer must match the codec in the Mediasoup router rtpCapabilities
        const routerCodec = router.rtpCapabilities.codecs?.find(
            codec => codec.kind === peer.producer.kind
        )!;

        codecs.push(routerCodec);

        const rtpCapabilities = {
            codecs,
            rtcpFeedback: []
        };

        // Start the consumer paused
        // Once the gstreamer process is ready to consume resume and send a keyframe
        peer.consumer = await rtpTransport.consume({
            producerId: peer.producer.id,
            rtpCapabilities,
            paused: true
        });

        return {
            remoteRtpPort,
            remoteRtcpPort,
            localRtcpPort: rtpTransport.rtcpTuple ? rtpTransport.rtcpTuple.localPort : undefined,
            rtpCapabilities,
            rtpParameters: peer.consumer.rtpParameters
        };
    };

    socket.on("start-record", async ({sessionId}) => {
        console.log("start-record");
        const peer = connections.get(sessionId);
        console.log(peer);
        console.log(connections);
        let recordInfo = {
            video: await publishProducerRtpStream(peer),
            fileName: Date.now().toString()
        };

        peer.process = new Ffmpeg(recordInfo, "2.7");

        await peer.process.start();

        setTimeout(async () => {
            await peer.consumer?.resume();
            await peer.consumer?.requestKeyFrame();
        }, 100);
    });

    socket.on("stop-record", async ({sessionId}, callback) => {
        const peer = connections.get(sessionId);
        peer.consumer.close();
        peer.process.kill();
        console.log("stopping");
        const result = await peer.process.getResult();
        connections.delete(sessionId);

        console.log("got result", result);
        if (typeof callback == 'function') {
            callback(result);

        }
    });

    /**
     * Asynchronously creates a Web Real-Time Communication (WebRTC) transport using mediasoup.
     * A transport is required to send or receive media over the network.
     *
     * @param callback - A callback function to handle the result of the transport creation.
     * @returns A promise that resolves to a mediasoup WebRtcTransport object.
     */
    const createWebRtcTransport = async (
        callback: (arg0: {
            params:
                | {
                /**
                 * A unique identifier generated by mediasoup for the transport.
                 * Necessary for differentiating between multiple transports.
                 */
                id: string;
                /**
                 * Interactive Connectivity Establishment (ICE) parameters.
                 * Necessary for the negotiation of network connections.
                 */
                iceParameters: mediasoup.types.IceParameters;
                /**
                 * Array of ICE candidates.
                 * Necessary for establishing network connectivity through NATs and firewalls.
                 */
                iceCandidates: mediasoup.types.IceCandidate[];
                /**
                 * Datagram Transport Layer Security (DTLS) parameters.
                 * Necessary for securing the transport with encryption.
                 */
                dtlsParameters: mediasoup.types.DtlsParameters;
            }
                | {
                /** Error object if any error occurs during transport creation. */ error: unknown;
            };
        }) => void
    ) => {
        try {
            /**
             * Configuration options for the WebRTC transport.
             * Adjusting these options can help optimize network performance and reliability.
             */
            const webRtcTransportOptions = {
                /**
                 * Array of IP addresses for the transport to listen on.
                 * Necessary for receiving incoming network connections.
                 */
                listenIps: [
                    {
                        ip: "127.0.0.1",
                    },
                ],
                /**
                 * Enables User Datagram Protocol (UDP) for the transport.
                 * UDP is often preferred for real-time media due to its lower latency compared to TCP.
                 */
                enableUdp: true,
                /**
                 * Enables Transmission Control Protocol (TCP) for the transport.
                 * TCP may be used if UDP is blocked or unreliable on the network.
                 */
                enableTcp: true,
                /**
                 * Prefers UDP over TCP for the transport.
                 * Helps ensure lower latency if both protocols are enabled.
                 */
                preferUdp: true,
            };

            /**
             * Creates a WebRTC transport using the specified options.
             * This transport will be used to send or receive media.
             */
            const transport = await router.createWebRtcTransport(
                webRtcTransportOptions
            );

            console.log(`Transport created: ${transport.id}`);

            /**
             * Monitors changes in the DTLS connection state.
             * Closes the transport if the DTLS state becomes closed.
             * This helps ensure resources are freed up when the transport is no longer needed.
             */
            transport.on("dtlsstatechange", (dtlsState) => {
                if (dtlsState === "closed") {
                    transport.close();
                }
            });

            /**
             * Monitors transport closure events.
             * Useful for logging or cleaning up resources related to the transport.
             */
            transport.on("@close", () => {
                console.log("Transport closed");
            });

            /**
             * Invokes the callback with the transport parameters.
             * This allows the caller to retrieve the necessary information for establishing a WebRTC connection.
             */
            callback({
                params: {
                    id: transport.id,
                    iceParameters: transport.iceParameters,
                    iceCandidates: transport.iceCandidates,
                    dtlsParameters: transport.dtlsParameters,
                },
            });

            /** Returns the transport object for further use. */
            return transport;
        } catch (error) {
            console.log(error);
            /**
             * Invokes the callback with error information if an error occurs.
             * Allows the caller to handle the error.
             */
            callback({
                params: {
                    error,
                },
            });
        }
    };
});

/**
 * Starts the HTTP server.
 * This is the main entry point of the application.
 */
server.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});
