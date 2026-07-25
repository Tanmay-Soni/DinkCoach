// Single source of truth for the DinkAI onboarding video lesson.
// Source video: https://www.youtube.com/watch?v=5-ty-cyg6sI (dinking fundamentals).
// Clips are pre-cut, self-hosted mp4s (see public/videos/) so playback has no
// YouTube chrome (title card, pause overlay, branding). To re-cut a clip:
//   ffmpeg -i source.mp4 -ss <start> -t <end-start> -c:v libx264 -preset veryfast \
//     -crf 20 -c:a aac -b:a 128k -movflags +faststart public/videos/<slug>.mp4

export const LESSON_SECTIONS = [
  {
    title: 'Ready Position',
    description: 'How to stand and hold your paddle before every shot.',
    videoSrc: '/videos/ready-position.mp4',
  },
  {
    title: 'Gripping the Paddle',
    description: 'The right way to hold the paddle when dinking.',
    videoSrc: '/videos/gripping-the-paddle.mp4',
  },
  {
    title: 'Common Dinking Mistakes',
    description: 'The most common mistakes beginners make, and how to avoid them.',
    videoSrc: '/videos/common-dinking-mistakes.mp4',
  },
  {
    title: 'Pro Dinking Tips',
    description: 'A few simple tips to make your dinks more consistent.',
    videoSrc: '/videos/pro-dinking-tips.mp4',
  },
  {
    title: 'Protect the Castle Drill',
    description: 'A drill you can practice to sharpen your dinking.',
    videoSrc: '/videos/protect-the-castle-drill.mp4',
  },
];
