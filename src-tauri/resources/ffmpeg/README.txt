Optional decoder for WMA and ATRAC (.wma / .at3 / .at9 / .oma / .aa3) playback.

DSD (.dsf) files play with no extra tools — the launcher decodes them itself.
WMA and ATRAC, however, need ffmpeg. To enable them:

  1. Download a static ffmpeg build for your platform
     (Windows: https://www.gyan.dev/ffmpeg/builds/ — the "essentials" build).
  2. Copy ffmpeg.exe (Windows) or ffmpeg (macOS/Linux) into THIS folder,
     next to this README.

That's it. When the Music Player hits a WMA/ATRAC track it can't play
natively, it transcodes it on the fly with this binary and plays the result.
An ffmpeg already on your system PATH is used automatically if this folder
is empty.
