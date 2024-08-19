import * as child_process from "node:child_process";
import {EventEmitter} from "node:events"
import {createSdpText} from "./sdp.js";
import {convertStringToStream} from "./utils.js";
import sharp from "sharp";
import {Transform} from "stream";
import * as fs from "node:fs";

const RECORD_FILE_LOCATION_PATH = process.env.RECORD_FILE_LOCATION_PATH || './files';

class FrameProcessor extends Transform {
    constructor(width, height, options) {
        super(options);

        this.fame_width = width;
        this.frame_height = height;

        this.frame_size = width * height * 3

        this.firstFrame = undefined;
        this.lastFrame = undefined;

        this.framesCount = 0

        this.buffer = Buffer.alloc(0);
    }

    async _transform(chunk, encoding, callback) {
        // console.log("chunk with len", chunk.length);

        this.buffer = Buffer.concat([this.buffer, chunk]);

        while (this.buffer.length >= this.frame_size) {
            this.framesCount++;
            console.log("parsed frame", this.framesCount);
            const frame = this.buffer.subarray(0, this.frame_size);
            this.buffer = this.buffer.subarray(this.frame_size);

            if (this.firstFrame === undefined) {
                this.firstFrame = frame;
                console.log(this.firstFrame.length, this.frame_size);
            }

            this.lastFrame = frame;
        }

        callback();
    }

    async getResult() {
        let firstImage;
        if (this.firstFrame !== undefined) {
            firstImage = await sharp(this.firstFrame,
                {raw: {width: this.fame_width, height: this.frame_height, channels: 3}})
                .jpeg()
                .toBuffer();

        } else {
            console.log("NO FRAME");
        }

        let lastImage;
        if (this.lastFrame !== undefined) {
            lastImage = await sharp(this.lastFrame,
                {raw: {width: this.fame_width, height: this.frame_height, channels: 3}})
                .jpeg()
                .toBuffer();
        }

        const framesCount = this.framesCount;

        return {firstImage, lastImage, framesCount}
    }
}

export class Ffmpeg {
    constructor(rtpParameters, duration) {
        this._rtpParameters = rtpParameters;
        this._duration = duration.toString();
        this._videoProcess = undefined;
        this._observer = new EventEmitter();
        this._frameProcessor = undefined;
        this._sdpString = createSdpText(this._rtpParameters);
        this._sdpStream = convertStringToStream(this._sdpString);

        this._frameProcessor = new FrameProcessor(640, 480);

        // this._waitFrameProcessor = new Promise((resolve) => {
        //     this._observer.once('frameProcessorStarted', resolve);
        // });

        this._waitFrameProcessor = new Promise((resolve) => {
            this._frameProcessor.on('finish', resolve);
        });

        this._waitEnd = new Promise((resolve) => {
            this._observer.once('processEnd', resolve);
        });
    }

    async start() {
        console.log("SPAWNING")
        this._videoProcess = child_process.spawn('ffmpeg', this._commandArgs);

        this._videoProcess.stderr.setEncoding('utf-8');

        this._videoProcess.stderr.on('data', data => {
            console.log('ffmpeg::process::data [data:%o]', data);

            // if (this._frameProcessor === undefined) {
            //     const frameSizeMatch = data.match(/Stream.*Video.* (\d{2,4})x(\d{2,4})/);
            //     if (frameSizeMatch) {
            //         const width = parseInt(frameSizeMatch[1], 10);
            //         const height = parseInt(frameSizeMatch[2], 10);
            //         console.log(`Got stream frame size: ${width}x${height}`);
            //
            //         this._frameProcessor = new FrameProcessor(width, height);
            //
            //         this._videoProcess.stdout.pipe(this._frameProcessor);
            //
            //         this._observer.emit("frameProcessorStarted");
            //     }
            // }
        });

        this._videoProcess.stdout.pipe(this._frameProcessor);

        this._videoProcess.on('close', (code) => {
            console.log(`Process closed with code ${code}`);
            this._observer.emit("processEnd")
            this._videoProcess = undefined;
        });

        this._sdpStream.pipe(this._videoProcess.stdin);

        this._sdpStream.on('end', () => {
            console.log('Input stream ended, closing FFmpeg stdin');
            this._videoProcess.stdin.end();
        });
    }

    kill() {
        console.log(this._videoProcess?.kill("SIGINT"));
        // console.log('kill() [pid:%d]', this._videoProcess?.pid);
        // console.log("stopping process")
        // if (this._videoProcess) {
        //     this._videoProcess.stderr.destroy();
        //     this._videoProcess.stdout.destroy();
        //
        //     this._videoProcess.kill();
        // }
    }

    async getResult() {
        await this._waitFrameProcessor;
        // await this._waitEnd;
        console.log("RESULTT");
        return await this._frameProcessor.getResult();
    }

    get _commandArgs() {
        const uniquePort = 5004;
        return [
            '-loglevel', 'debug',
            '-protocol_whitelist', 'pipe,udp,rtp',
            '-fflags', '+genpts',
            '-t', this._duration,
            '-f', 'sdp',
            '-i', 'pipe:0',
            '-map', '0:v:0',
            '-c:v', 'copy',
            `${RECORD_FILE_LOCATION_PATH}/${this._rtpParameters.fileName}.webm`,
            // '-vf', 'fps=30',
            // '-f', 'image2pipe',
            '-f', 'rawvideo',
            '-vcodec', 'rawvideo',
            '-pix_fmt', 'rgb24',
            'pipe:1',
            '-an',
            '-sn'
        ];
    }
}
