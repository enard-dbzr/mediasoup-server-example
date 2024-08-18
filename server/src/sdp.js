import {getCodecInfoFromRtpParameters} from "./utils.js";

// File to create SDP text from mediasoup RTP Parameters
export const createSdpText = (rtpParameters) => {
  const { video, audio } = rtpParameters;
  
  // Video codec info
  const videoCodecInfo = getCodecInfoFromRtpParameters('video', video.rtpParameters);

  // Audio codec info
  // const audioCodecInfo = getCodecInfoFromRtpParameters('audio', audio.rtpParameters);

  return `v=0
  o=- 0 0 IN IP4 127.0.0.1
  s=FFmpeg
  c=IN IP4 127.0.0.1
  t=0 0
  m=video ${video.remoteRtpPort} RTP/AVP ${videoCodecInfo.payloadType} 
  a=rtpmap:${videoCodecInfo.payloadType} ${videoCodecInfo.codecName}/${videoCodecInfo.clockRate}
  a=sendonly
  `;
};
