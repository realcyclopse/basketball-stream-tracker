import { useState, useCallback, useRef, useEffect } from 'react';

interface UseVideoSyncResult {
  currentFrame: number;
  isPlaying: boolean;
  play: () => void;
  pause: () => void;
  togglePlay: () => void;
  stepForward: () => void;
  stepBackward: () => void;
  setPlaybackRate: (rate: number) => void;
  seekToFrame: (frame: number) => void;
  playbackRate: number;
  duration: number;
}

export function useVideoSync(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  fps: number,
  totalFrames: number,
  fallbackMode: boolean = false
): UseVideoSyncResult {
  const [currentFrame, setCurrentFrame] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackRate, setPlaybackRateState] = useState(1);
  const [duration, setDuration] = useState(totalFrames / (fps || 30));

  const rafRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);
  const frameAccumulatorRef = useRef<number>(0);

  // Sync frame from native video element
  // `mediaTime` is the exact presentation time of the frame on screen
  // (requestVideoFrameCallback); currentTime is the fallback.
  const updateFrameFromVideo = useCallback((mediaTime?: number) => {
    const video = videoRef.current;
    if (!video || fallbackMode) return;
    const time = typeof mediaTime === 'number' ? mediaTime : video.currentTime;
    const frame = Math.min(Math.floor(time * fps + 0.01), totalFrames - 1);
    setCurrentFrame(Math.max(0, frame));
  }, [videoRef, fps, totalFrames, fallbackMode]);

  // Fallback animation timer for synthetic mode (when no mp4 is present)
  useEffect(() => {
    if (!fallbackMode) return;

    let animId: number;
    lastTimeRef.current = performance.now();

    const loop = (time: number) => {
      const dt = (time - lastTimeRef.current) / 1000.0;
      lastTimeRef.current = time;

      if (isPlaying) {
        frameAccumulatorRef.current += dt * fps * playbackRate;
        if (frameAccumulatorRef.current >= 1.0) {
          const advance = Math.floor(frameAccumulatorRef.current);
          frameAccumulatorRef.current -= advance;
          setCurrentFrame((prev) => (prev + advance) % totalFrames);
        }
      }

      animId = requestAnimationFrame(loop);
    };

    animId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animId);
  }, [fallbackMode, isPlaying, fps, playbackRate, totalFrames]);

  // Native video event listeners
  useEffect(() => {
    const video = videoRef.current;
    if (!video || fallbackMode) return;

    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onLoadedMetadata = () => {
      setDuration(video.duration || totalFrames / fps);
    };
    const onTimeUpdate = () => updateFrameFromVideo();
    const onEnded = () => setIsPlaying(false);
    const onSeeked = () => updateFrameFromVideo();

    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('loadedmetadata', onLoadedMetadata);
    video.addEventListener('timeupdate', onTimeUpdate);
    video.addEventListener('seeked', onSeeked);
    video.addEventListener('ended', onEnded);

    // requestVideoFrameCallback support
    let rvfcActive = true;
    if ('requestVideoFrameCallback' in video) {
      const rvfcLoop = (_now: number, frameInfo?: { mediaTime: number }) => {
        if (!rvfcActive) return;
        updateFrameFromVideo(frameInfo?.mediaTime);
        (video as any).requestVideoFrameCallback(rvfcLoop);
      };
      (video as any).requestVideoFrameCallback(rvfcLoop);
      updateFrameFromVideo();
    } else {
      const rAfLoop = () => {
        updateFrameFromVideo();
        rafRef.current = requestAnimationFrame(rAfLoop);
      };
      rafRef.current = requestAnimationFrame(rAfLoop);
    }

    return () => {
      rvfcActive = false;
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('loadedmetadata', onLoadedMetadata);
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('ended', onEnded);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [videoRef, fallbackMode, updateFrameFromVideo, totalFrames, fps]);

  const play = useCallback(() => {
    if (fallbackMode) {
      setIsPlaying(true);
      lastTimeRef.current = performance.now();
    } else {
      videoRef.current?.play().catch(() => {});
    }
  }, [fallbackMode, videoRef]);

  const pause = useCallback(() => {
    if (fallbackMode) {
      setIsPlaying(false);
    } else {
      videoRef.current?.pause();
    }
  }, [fallbackMode, videoRef]);

  const togglePlay = useCallback(() => {
    if (fallbackMode) {
      setIsPlaying((prev) => !prev);
      lastTimeRef.current = performance.now();
    } else {
      const video = videoRef.current;
      if (!video) return;
      if (video.paused) {
        video.play().catch(() => {});
      } else {
        video.pause();
      }
    }
  }, [fallbackMode, videoRef]);

  // Seeks to the middle of the frame so rounding never lands on a neighbour.
  const seekToFrame = useCallback(
    (frame: number) => {
      const clamped = Math.max(0, Math.min(frame, totalFrames - 1));
      setCurrentFrame(clamped);
      if (!fallbackMode && videoRef.current) {
        videoRef.current.currentTime = (clamped + 0.5) / fps;
      }
    },
    [fallbackMode, videoRef, fps, totalFrames]
  );

  const stepForward = useCallback(() => {
    if (fallbackMode) {
      setIsPlaying(false);
      setCurrentFrame((prev) => (prev + 1) % totalFrames);
    } else {
      const video = videoRef.current;
      if (!video) return;
      video.pause();
      seekToFrame(Math.floor(video.currentTime * fps + 0.01) + 1);
    }
  }, [fallbackMode, videoRef, fps, totalFrames, seekToFrame]);

  const stepBackward = useCallback(() => {
    if (fallbackMode) {
      setIsPlaying(false);
      setCurrentFrame((prev) => (prev - 1 + totalFrames) % totalFrames);
    } else {
      const video = videoRef.current;
      if (!video) return;
      video.pause();
      seekToFrame(Math.floor(video.currentTime * fps + 0.01) - 1);
    }
  }, [fallbackMode, videoRef, fps, totalFrames, seekToFrame]);

  const setPlaybackRate = useCallback(
    (rate: number) => {
      setPlaybackRateState(rate);
      if (!fallbackMode && videoRef.current) {
        videoRef.current.playbackRate = rate;
      }
    },
    [fallbackMode, videoRef]
  );

  return {
    currentFrame,
    isPlaying,
    play,
    pause,
    togglePlay,
    stepForward,
    stepBackward,
    setPlaybackRate,
    seekToFrame,
    playbackRate,
    duration: fallbackMode ? totalFrames / fps : duration,
  };
}
