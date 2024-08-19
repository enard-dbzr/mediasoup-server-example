import asyncio
from asyncio import Event
from typing import Optional
from datetime import datetime

import socketio
from aiortc.contrib.media import MediaPlayer
from pymediasoup import Device, AiortcHandler
from pymediasoup.models.transport import DtlsParameters
from pymediasoup.rtp_parameters import RtpCapabilities, RtpParameters
from pymediasoup.transport import Transport

from src.peer import Peer


class User:
    def __init__(self, file_name):
        self.sio = socketio.AsyncClient()

        self.session_id = None

        self.player = MediaPlayer(file_name)
        self.track = self.player.video

        self.connection_success_event = Event()
        self.router_rtp_capabilities: Optional[RtpCapabilities] = None
        self.device: Optional[Device] = None
        self.producer_transport: Optional[Transport] = None

        self.track_ended_event = Event()

    async def async_task(self):
        print("connecting to server")
        await self.sio.connect("http://localhost:4000")
        print("connected to server")

        self.setup_socket_handlers()

        await self.connection_success_event.wait()

        self.router_rtp_capabilities = await self.get_router_rtp_capabilities()
        self.device = await self.create_device()

        self.producer_transport = await self.create_send_transport()

        await self.connect_send_transport()

        await self.start_record()

        await self.track_ended_event.wait()

        result = await self.stop_record()

        with open(f'imgs/first_image{datetime.now()}.jpg', "wb") as f:
            f.write(result["firstImage"])
        with open(f'imgs/last_image{datetime.now()}.jpg', "wb") as f:
            f.write(result["lastImage"])

        await asyncio.sleep(2)

        await self.sio.shutdown()

    def setup_socket_handlers(self):
        @self.sio.on("connection-success")
        async def conn_handler(data):
            print("connection success", data)
            # self.peer = Peer(data["sessionId"], self.device)
            self.connection_success_event.set()

    async def get_router_rtp_capabilities(self):
        message = await self.sio.call("getRouterRtpCapabilities")
        self.session_id = message["sessionId"]
        result = RtpCapabilities(**message["routerRtpCapabilities"])
        print("Got rtp capabilities:", result)

        return result

    async def create_device(self):
        device = Device(AiortcHandler.createFactory([self.track]))
        await device.load(self.router_rtp_capabilities)
        return device

    async def create_send_transport(self):
        params = await self.sio.call("createTransport", {"sender": True, "sessionId": self.session_id})

        transport = self.device.createSendTransport(**params["params"], sctpParameters=None)

        @transport.on('connect')
        async def on_connect(dtls_parameters: DtlsParameters):
            print("connect producer transport with dtls:", dtls_parameters)
            await self.sio.emit("connectProducerTransport",
                                {"dtlsParameters": dtls_parameters.dict(), "sessionId": self.session_id})

        @transport.on('produce')
        async def on_produce(kind: str, rtp_parameters: RtpParameters, loc):
            print("start producing", kind)
            res = await self.sio.call("transport-produce",
                                      {"kind": kind, "rtpParameters": rtp_parameters.dict(),
                                       "sessionId": self.session_id}, )
            print("got producer:", res)
            return res["id"]

        return transport

    async def connect_send_transport(self):
        local_producer = await self.producer_transport.produce(self.track)

        @local_producer.on("trackended")
        def track_ended_handler():
            print("track ended")
            self.track_ended_event.set()

        @local_producer.on("transportclose")
        def transport_close_handler():
            print("transport close")

    async def start_record(self):
        await self.sio.emit("start-record", {"sessionId": self.session_id})

    async def stop_record(self):
        print("stop record")
        return await self.sio.call("stop-record", {"sessionId": self.session_id})


async def task(path):
    user = User(path)
    await user.async_task()


async def main():
    await asyncio.gather(task("video/test.webm"), task("video/video.webm"))


if __name__ == '__main__':
    asyncio.run(main())
