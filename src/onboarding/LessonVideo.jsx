import { useEffect, useRef } from 'react';

export default function LessonVideo({ section }) {
  const videoRef = useRef(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    // Try with sound first; browsers that block unmuted autoplay reject the
    // promise, so fall back to muted rather than leaving the video frozen.
    video.play().catch(() => {
      video.muted = true;
      video.play().catch(() => {});
    });
  }, [section.videoSrc]);

  return (
    <div className="relative w-full aspect-video rounded-2xl overflow-hidden bg-black shadow-sm">
      <video
        key={section.videoSrc}
        ref={videoRef}
        className="w-full h-full object-contain transform-none"
        src={section.videoSrc}
        playsInline
        controls={false}
        disablePictureInPicture
        aria-label={section.title}
      />
    </div>
  );
}
