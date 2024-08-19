from aiortc.contrib.media import MediaPlayer


class Peer:
    def __init__(self, session_id):
        self.session_id = session_id
        self.device = None
        self.producers = []

        self.player = MediaPlayer("video/video.webm")
        self.track = self.player.video
        self.sendTransport = None
