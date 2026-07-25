import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DrawingUtils,
  FilesetResolver,
  PoseLandmarker,
} from '@mediapipe/tasks-vision';
import * as cocoSsd from '@tensorflow-models/coco-ssd';
import * as tf from '@tensorflow/tfjs';
import {
  areFrameLandmarksUsable,
  areLandmarksUsable,
  getAngle,
  getDistance,
  getMidpoint,
  getTiltAngle,
  isUsableLandmark,
} from './lib/geometry.js';
import {
  HITS_PER_DINK_REVIEW,
  createDinkReview,
  createSessionDinkReview,
  getDinkContactUpdate,
} from './lib/dinkReview.js';
import { createPoseHitRecorder, buildSessionComposite } from './lib/avatar/index.js';
import AverageDinkAvatarPanel from './components/AverageDinkAvatarPanel.jsx';

const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task';
const DEBUG_LANDMARKS = [
  { index: 0, name: 'Nose' },
  { index: 11, name: 'Left Shoulder' },
  { index: 12, name: 'Right Shoulder' },
  { index: 13, name: 'Left Elbow' },
  { index: 14, name: 'Right Elbow' },
  { index: 15, name: 'Left Wrist' },
  { index: 16, name: 'Right Wrist' },
  { index: 23, name: 'Left Hip' },
  { index: 24, name: 'Right Hip' },
  { index: 25, name: 'Left Knee' },
  { index: 26, name: 'Right Knee' },
  { index: 27, name: 'Left Ankle' },
  { index: 28, name: 'Right Ankle' },
  { index: 31, name: 'Left Foot Index' },
  { index: 32, name: 'Right Foot Index' },
];
const FULL_BODY_MESSAGE = 'Needs full body in frame';
const COACH_UPDATE_INTERVAL_MS = 600;
const LANDMARK_SMOOTHING_ALPHA = 0.22;
const MOTION_HISTORY_SIZE = 60;
const SWING_VELOCITY_THRESHOLD = 1.25;
const SWING_HOLD_MS = 1000;
const VOICE_REVIEW_ENDPOINT = import.meta.env.VITE_TTS_ENDPOINT || '/api/voice-review';
const BALL_DETECTION_MIN_SCORE = 0.25;
const COCO_BALL_DETECTION_INTERVAL_MS = 500;
const COLOR_TRACKER_INTERVAL_MS = 75;
const BALL_TRACK_HOLD_MS = 450;
const BALL_HISTORY_SIZE = 60;
const BALL_STATIONARY_SPEED = 0.05;
const BALL_TRAIL_HOLD_MS = 1200;
const COLOR_TRACKER_WIDTH = 320;
const COLOR_TRACKER_HEIGHT = 180;
const COLOR_TRACKER_MIN_PIXELS = 3;
const COLOR_TRACKER_MAX_AREA_RATIO = 0.02;
const COLOR_TRACKER_MAX_DIMENSION_RATIO = 0.18;
const PADDLE_TRACKER_WIDTH = 240;
const PADDLE_TRACKER_HEIGHT = 135;
const PADDLE_TRACKER_MIN_PIXELS = 12;
const PADDLE_RADIUS_SCALE = 1.6;
const PADDLE_RADIUS_MIN = 0.08;
const PADDLE_RADIUS_MAX = 0.28;
const PADDLE_MAX_FOREARM_RATIO = 1.35;
const PADDLE_MAX_SEARCH_AREA_RATIO = 0.38;
const INITIAL_BALL_DEBUG = {
  status: 'Loading ball detector...',
  detected: false,
  x: null,
  y: null,
  size: null,
  confidence: null,
  speed: null,
  direction: 'stationary',
  framesTracked: 0,
  fps: null,
  source: 'None',
  colorTrackerStatus: 'Waiting',
  colorPixels: 0,
  colorBlobPixels: 0,
  colorHue: null,
  colorSaturation: null,
};
const INITIAL_PADDLE_DEBUG = {
  status: 'Needs paddle calibration',
  detected: false,
  x: null,
  y: null,
  confidence: null,
  source: 'None',
  orientation: 'not available',
  selectedArm: 'My Right',
  searchRadius: null,
  colorPixels: 0,
  colorBlobPixels: 0,
};
const INITIAL_PIXEL_SAMPLE = {
  hasSample: false,
  x: null,
  y: null,
  red: null,
  green: null,
  blue: null,
  hue: null,
  saturation: null,
  value: null,
  isColorMatch: false,
};
const INITIAL_COLOR_PROFILE = {
  calibrated: false,
  sampleCount: 0,
  hueMin: 35,
  hueMax: 105,
  saturationMin: 0.22,
  valueMin: 0.38,
};
const INITIAL_SAMPLE_BOX = {
  isDragging: false,
  startX: 0,
  startY: 0,
  currentX: 0,
  currentY: 0,
};

const LANDMARK_INDEX = {
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28,
};
const READY_POSITION_GATE = [
  LANDMARK_INDEX.leftShoulder,
  LANDMARK_INDEX.rightShoulder,
  LANDMARK_INDEX.leftHip,
  LANDMARK_INDEX.rightHip,
  LANDMARK_INDEX.leftKnee,
  LANDMARK_INDEX.rightKnee,
  LANDMARK_INDEX.leftAnkle,
  LANDMARK_INDEX.rightAnkle,
];
const LEFT_ARM_GATE = [
  LANDMARK_INDEX.leftShoulder,
  LANDMARK_INDEX.leftElbow,
  LANDMARK_INDEX.leftWrist,
];
const RIGHT_ARM_GATE = [
  LANDMARK_INDEX.rightShoulder,
  LANDMARK_INDEX.rightElbow,
  LANDMARK_INDEX.rightWrist,
];

function formatLandmarkValue(value, fallback = '-') {
  return typeof value === 'number' ? value.toFixed(3) : fallback;
}

function formatAngle(value) {
  return typeof value === 'number' ? `${value.toFixed(1)}°` : FULL_BODY_MESSAGE;
}

function formatRatio(value) {
  return typeof value === 'number' ? `${value.toFixed(2)}x` : FULL_BODY_MESSAGE;
}

function formatVelocity(value) {
  return typeof value === 'number' ? `${value.toFixed(3)} / sec` : '-';
}

function formatDebugNumber(value, digits = 3) {
  return typeof value === 'number' ? value.toFixed(digits) : '-';
}

function formatRgbValue(value) {
  return typeof value === 'number' ? Math.round(value) : '-';
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function getVideoSamplePoint(event, video, bounds) {
  const displayX = event.clientX - bounds.left;
  const displayY = event.clientY - bounds.top;
  const videoAspect = video.videoWidth / video.videoHeight;
  const frameAspect = bounds.width / bounds.height;
  let visibleWidth = bounds.width;
  let visibleHeight = bounds.height;
  let offsetX = 0;
  let offsetY = 0;

  if (frameAspect > videoAspect) {
    visibleWidth = bounds.height * videoAspect;
    offsetX = (bounds.width - visibleWidth) / 2;
  } else {
    visibleHeight = bounds.width / videoAspect;
    offsetY = (bounds.height - visibleHeight) / 2;
  }

  const normalizedDisplayX = (displayX - offsetX) / visibleWidth;
  const normalizedDisplayY = (displayY - offsetY) / visibleHeight;

  if (
    normalizedDisplayX < 0 ||
    normalizedDisplayX > 1 ||
    normalizedDisplayY < 0 ||
    normalizedDisplayY > 1
  ) {
    return null;
  }

  return {
    displayX,
    displayY,
    videoX: Math.round((1 - normalizedDisplayX) * (video.videoWidth - 1)),
    videoY: Math.round(normalizedDisplayY * (video.videoHeight - 1)),
  };
}

function getPercentile(sortedValues, percentile) {
  if (!sortedValues.length) {
    return null;
  }

  const index = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.floor((sortedValues.length - 1) * percentile)),
  );

  return sortedValues[index];
}

function getLandmarkFrameStatus(landmark) {
  if (!landmark) {
    return 'not detected';
  }

  const isInFrame =
    landmark.x >= 0 && landmark.x <= 1 && landmark.y >= 0 && landmark.y <= 1;

  return isInFrame ? 'in frame' : 'estimated/out of frame';
}

function smoothLandmarks(previousLandmarks, nextLandmarks) {
  if (!nextLandmarks.length) {
    return [];
  }

  return nextLandmarks.map((nextLandmark, index) => {
    const previousLandmark = previousLandmarks[index];

    if (!previousLandmark || !nextLandmark) {
      return nextLandmark;
    }

    return {
      ...nextLandmark,
      x:
        previousLandmark.x +
        (nextLandmark.x - previousLandmark.x) * LANDMARK_SMOOTHING_ALPHA,
      y:
        previousLandmark.y +
        (nextLandmark.y - previousLandmark.y) * LANDMARK_SMOOTHING_ALPHA,
      z:
        Number.isFinite(previousLandmark.z) && Number.isFinite(nextLandmark.z)
          ? previousLandmark.z +
            (nextLandmark.z - previousLandmark.z) * LANDMARK_SMOOTHING_ALPHA
          : nextLandmark.z,
    };
  });
}

function addMotionFrame(history, landmarks, timestamp) {
  if (!landmarks.length) {
    return history;
  }

  return [...history, { landmarks, timestamp }].slice(-MOTION_HISTORY_SIZE);
}

function getTorsoLean(landmarks) {
  const leftShoulder = landmarks[LANDMARK_INDEX.leftShoulder];
  const rightShoulder = landmarks[LANDMARK_INDEX.rightShoulder];
  const leftHip = landmarks[LANDMARK_INDEX.leftHip];
  const rightHip = landmarks[LANDMARK_INDEX.rightHip];

  if (!areLandmarksUsable([leftShoulder, rightShoulder, leftHip, rightHip])) {
    return null;
  }

  const shoulderMidpoint = getMidpoint(leftShoulder, rightShoulder);
  const hipMidpoint = getMidpoint(leftHip, rightHip);
  const torsoHeight = Math.abs(hipMidpoint.y - shoulderMidpoint.y);

  if (torsoHeight === 0) {
    return null;
  }

  return (shoulderMidpoint.x - hipMidpoint.x) / torsoHeight;
}

function getWristHeightStatus(landmarks) {
  const leftShoulder = landmarks[LANDMARK_INDEX.leftShoulder];
  const rightShoulder = landmarks[LANDMARK_INDEX.rightShoulder];
  const leftHip = landmarks[LANDMARK_INDEX.leftHip];
  const rightHip = landmarks[LANDMARK_INDEX.rightHip];
  const leftWrist = landmarks[LANDMARK_INDEX.leftWrist];
  const rightWrist = landmarks[LANDMARK_INDEX.rightWrist];

  if (
    !areLandmarksUsable([
      leftShoulder,
      rightShoulder,
      leftHip,
      rightHip,
      leftWrist,
      rightWrist,
    ])
  ) {
    return FULL_BODY_MESSAGE;
  }

  const shoulderMidpoint = getMidpoint(leftShoulder, rightShoulder);
  const hipMidpoint = getMidpoint(leftHip, rightHip);
  const averageWristY = (leftWrist.y + rightWrist.y) / 2;

  if (averageWristY > hipMidpoint.y) {
    return 'below hips';
  }

  if (averageWristY < shoulderMidpoint.y) {
    return 'above shoulders';
  }

  return 'between hips and shoulders';
}

function getMotionFps(history) {
  if (history.length < 2) {
    return null;
  }

  const firstFrame = history[0];
  const lastFrame = history[history.length - 1];
  const durationSeconds = (lastFrame.timestamp - firstFrame.timestamp) / 1000;

  if (durationSeconds <= 0) {
    return null;
  }

  return (history.length - 1) / durationSeconds;
}

function getLandmarkVelocity(history, landmarkIndex) {
  const usableFrames = history
    .filter((frame) => isUsableLandmark(frame.landmarks[landmarkIndex]))
    .slice(-2);

  if (usableFrames.length < 2) {
    return null;
  }

  const [previousFrame, currentFrame] = usableFrames;
  const deltaSeconds = (currentFrame.timestamp - previousFrame.timestamp) / 1000;

  if (deltaSeconds <= 0) {
    return null;
  }

  return (
    getDistance(
      previousFrame.landmarks[landmarkIndex],
      currentFrame.landmarks[landmarkIndex],
    ) / deltaSeconds
  );
}

function getGatedLandmarkVelocity(history, gateIndexes, velocityIndex) {
  const usableFrames = history
    .filter((frame) => areFrameLandmarksUsable(frame.landmarks, gateIndexes))
    .slice(-2);

  if (usableFrames.length < 2) {
    return null;
  }

  const [previousFrame, currentFrame] = usableFrames;
  const deltaSeconds = (currentFrame.timestamp - previousFrame.timestamp) / 1000;

  if (deltaSeconds <= 0) {
    return null;
  }

  return (
    getDistance(
      previousFrame.landmarks[velocityIndex],
      currentFrame.landmarks[velocityIndex],
    ) / deltaSeconds
  );
}

function getMotionMetrics(history) {
  const motionSnapshot = getMotionSnapshot(history);

  return [
    {
      label: 'Frames stored',
      value: `${motionSnapshot.framesStored} / ${MOTION_HISTORY_SIZE}`,
    },
    {
      label: 'Current FPS estimate',
      value:
        typeof motionSnapshot.fps === 'number'
          ? motionSnapshot.fps.toFixed(1)
          : '-',
    },
    {
      label: 'Left wrist velocity',
      value: formatVelocity(motionSnapshot.leftWristVelocity),
    },
    {
      label: 'Right wrist velocity',
      value: formatVelocity(motionSnapshot.rightWristVelocity),
    },
    {
      label: 'Left ankle velocity',
      value: formatVelocity(motionSnapshot.leftAnkleVelocity),
    },
    {
      label: 'Right ankle velocity',
      value: formatVelocity(motionSnapshot.rightAnkleVelocity),
    },
  ];
}

function getMotionSnapshot(history) {
  const latestFrame = history[history.length - 1];
  const latestLandmarks = latestFrame?.landmarks ?? [];

  return {
    framesStored: history.length,
    fps: getMotionFps(history),
    isLeftArmVisible: areFrameLandmarksUsable(latestLandmarks, LEFT_ARM_GATE),
    isRightArmVisible: areFrameLandmarksUsable(latestLandmarks, RIGHT_ARM_GATE),
    leftWristVelocity: getGatedLandmarkVelocity(
      history,
      LEFT_ARM_GATE,
      LANDMARK_INDEX.leftWrist,
    ),
    rightWristVelocity: getGatedLandmarkVelocity(
      history,
      RIGHT_ARM_GATE,
      LANDMARK_INDEX.rightWrist,
    ),
    leftAnkleVelocity: getLandmarkVelocity(history, LANDMARK_INDEX.leftAnkle),
    rightAnkleVelocity: getLandmarkVelocity(history, LANDMARK_INDEX.rightAnkle),
  };
}

function addBallFrame(history, ball, timestamp, source) {
  if (!ball) {
    return history;
  }

  return [
    ...history,
    {
      timestamp,
      x: ball.normalizedX,
      y: ball.normalizedY,
      source,
      confidence: ball.confidence,
      size: ball.normalizedSize,
      bbox: ball.bbox,
      centerX: ball.centerX,
      centerY: ball.centerY,
    },
  ].slice(-BALL_HISTORY_SIZE);
}

function getBallMotionSnapshot(history) {
  const recentFrames = history.slice(-5);

  if (recentFrames.length < 2) {
    return {
      speed: null,
      horizontalDirection: 'stationary',
      verticalDirection: 'stationary',
      direction: 'stationary',
      framesTracked: history.length,
    };
  }

  const firstFrame = recentFrames[0];
  const lastFrame = recentFrames[recentFrames.length - 1];
  const deltaSeconds = (lastFrame.timestamp - firstFrame.timestamp) / 1000;

  if (deltaSeconds <= 0) {
    return {
      speed: null,
      horizontalDirection: 'stationary',
      verticalDirection: 'stationary',
      direction: 'stationary',
      framesTracked: history.length,
    };
  }

  const deltaX = lastFrame.x - firstFrame.x;
  const deltaY = lastFrame.y - firstFrame.y;
  const horizontalSpeed = deltaX / deltaSeconds;
  const verticalSpeed = deltaY / deltaSeconds;
  const speed = Math.hypot(deltaX, deltaY) / deltaSeconds;
  const horizontalDirection =
    Math.abs(horizontalSpeed) < BALL_STATIONARY_SPEED
      ? 'stationary'
      : horizontalSpeed > 0
        ? 'right'
        : 'left';
  const verticalDirection =
    Math.abs(verticalSpeed) < BALL_STATIONARY_SPEED
      ? 'stationary'
      : verticalSpeed > 0
        ? 'down'
        : 'up';

  let direction = 'stationary';

  if (horizontalDirection !== 'stationary' && verticalDirection !== 'stationary') {
    direction = `${verticalDirection}-${horizontalDirection}`;
  } else if (horizontalDirection !== 'stationary') {
    direction = horizontalDirection;
  } else if (verticalDirection !== 'stationary') {
    direction = verticalDirection;
  }

  return {
    speed,
    horizontalDirection,
    verticalDirection,
    direction,
    framesTracked: history.length,
  };
}

function getLatestBallVelocity(history) {
  const latestFrame = history[history.length - 1];
  const previousFrame = history[history.length - 2];

  if (!latestFrame || !previousFrame) {
    return null;
  }

  const deltaSeconds = (latestFrame.timestamp - previousFrame.timestamp) / 1000;

  if (deltaSeconds <= 0) {
    return null;
  }

  const x = (latestFrame.x - previousFrame.x) / deltaSeconds;
  const y = (latestFrame.y - previousFrame.y) / deltaSeconds;

  return { x, y, speed: Math.hypot(x, y) };
}

function getActionDetection(motionSnapshot, heldSwing) {
  if (!motionSnapshot.isLeftArmVisible && !motionSnapshot.isRightArmVisible) {
    return {
      currentAction: 'Need Arm In Frame',
      dominantSide: '-',
      peakWristVelocity: null,
      message:
        'Step back or adjust the camera so DinkAI can see your shoulder, elbow, and wrist.',
    };
  }

  const leftVelocity = motionSnapshot.leftWristVelocity ?? 0;
  const rightVelocity = motionSnapshot.rightWristVelocity ?? 0;
  const peakWristVelocity = Math.max(leftVelocity, rightVelocity);
  const dominantSide = leftVelocity >= rightVelocity ? 'Left' : 'Right';
  const hasCurrentSwing = peakWristVelocity >= SWING_VELOCITY_THRESHOLD;
  const hasHeldSwing = Boolean(heldSwing);
  const isSwingDetected = hasCurrentSwing || hasHeldSwing;
  const displayedPeakVelocity =
    hasHeldSwing && heldSwing.peakVelocity > peakWristVelocity
      ? heldSwing.peakVelocity
      : peakWristVelocity;
  const displayedSide =
    hasHeldSwing && heldSwing.peakVelocity > peakWristVelocity
      ? heldSwing.dominantSide
      : dominantSide;

  return {
    currentAction: isSwingDetected ? 'Swing Detected' : 'No Action',
    dominantSide: isSwingDetected ? displayedSide : '-',
    peakWristVelocity: isSwingDetected ? displayedPeakVelocity : peakWristVelocity,
    message: isSwingDetected
      ? 'Fast wrist movement detected. DinkAI thinks you made a swing or paddle action.'
      : 'Waiting for paddle movement.',
  };
}

function getBestBallPrediction(predictions, video) {
  const ballPrediction = predictions
    .filter((prediction) => prediction.class === 'sports ball')
    .sort((predictionA, predictionB) => predictionB.score - predictionA.score)[0];

  if (!ballPrediction) {
    return null;
  }

  const [x, y, width, height] = ballPrediction.bbox;
  const centerX = x + width / 2;
  const centerY = y + height / 2;

  return {
    bbox: ballPrediction.bbox,
    centerX,
    centerY,
    normalizedX: centerX / video.videoWidth,
    normalizedY: centerY / video.videoHeight,
    normalizedSize: Math.max(width, height) / Math.max(video.videoWidth, video.videoHeight),
    confidence: ballPrediction.score,
    source: 'COCO-SSD',
  };
}

function rgbToHsv(red, green, blue) {
  const normalizedRed = red / 255;
  const normalizedGreen = green / 255;
  const normalizedBlue = blue / 255;
  const max = Math.max(normalizedRed, normalizedGreen, normalizedBlue);
  const min = Math.min(normalizedRed, normalizedGreen, normalizedBlue);
  const delta = max - min;
  let hue = 0;

  if (delta !== 0) {
    if (max === normalizedRed) {
      hue = 60 * (((normalizedGreen - normalizedBlue) / delta) % 6);
    } else if (max === normalizedGreen) {
      hue = 60 * ((normalizedBlue - normalizedRed) / delta + 2);
    } else {
      hue = 60 * ((normalizedRed - normalizedGreen) / delta + 4);
    }
  }

  if (hue < 0) {
    hue += 360;
  }

  return {
    hue,
    saturation: max === 0 ? 0 : delta / max,
    value: max,
  };
}

function isPickleballColoredPixel(red, green, blue, colorProfile = INITIAL_COLOR_PROFILE) {
  const { hue, saturation, value } = rgbToHsv(red, green, blue);
  const isYellowToGreen = hue >= colorProfile.hueMin && hue <= colorProfile.hueMax;
  const isBrightEnough = value >= colorProfile.valueMin;
  const isSaturatedEnough = saturation >= colorProfile.saturationMin;

  return isYellowToGreen && isBrightEnough && isSaturatedEnough;
}

function getColorProfileFromVideoRegion(video, canvas, pointA, pointB, anchorPoint) {
  const context = canvas.getContext('2d', { willReadFrequently: true });

  if (!context) {
    return null;
  }

  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  context.drawImage(video, 0, 0, canvas.width, canvas.height);

  const minX = Math.max(0, Math.min(pointA.videoX, pointB.videoX));
  const minY = Math.max(0, Math.min(pointA.videoY, pointB.videoY));
  const maxX = Math.min(video.videoWidth - 1, Math.max(pointA.videoX, pointB.videoX));
  const maxY = Math.min(video.videoHeight - 1, Math.max(pointA.videoY, pointB.videoY));
  const width = maxX - minX + 1;
  const height = maxY - minY + 1;

  if (width < 3 || height < 3) {
    return null;
  }

  const imageData = context.getImageData(minX, minY, width, height);
  const hueValues = [];
  const saturationValues = [];
  const valueValues = [];
  const [anchorRed, anchorGreen, anchorBlue] = context.getImageData(
    anchorPoint.videoX,
    anchorPoint.videoY,
    1,
    1,
  ).data;
  const anchorHsv = rgbToHsv(anchorRed, anchorGreen, anchorBlue);

  for (let index = 0; index < imageData.data.length; index += 4) {
    const red = imageData.data[index];
    const green = imageData.data[index + 1];
    const blue = imageData.data[index + 2];
    const hsv = rgbToHsv(red, green, blue);

    const isNearAnchorHue = Math.abs(hsv.hue - anchorHsv.hue) <= 35;

    if (
      isNearAnchorHue &&
      hsv.saturation >= Math.max(0.08, anchorHsv.saturation - 0.28) &&
      hsv.value >= Math.max(0.12, anchorHsv.value - 0.35)
    ) {
      hueValues.push(hsv.hue);
      saturationValues.push(hsv.saturation);
      valueValues.push(hsv.value);
    }
  }

  if (hueValues.length < 8) {
    return null;
  }

  hueValues.sort((a, b) => a - b);
  saturationValues.sort((a, b) => a - b);
  valueValues.sort((a, b) => a - b);

  const hueMin = Math.max(
    0,
    Math.min(anchorHsv.hue - 25, getPercentile(hueValues, 0.12) - 10),
  );
  const hueMax = Math.min(
    360,
    Math.max(anchorHsv.hue + 25, getPercentile(hueValues, 0.88) + 10),
  );
  const saturationMin = Math.max(0.05, getPercentile(saturationValues, 0.15) - 0.08);
  const valueMin = Math.max(0.08, getPercentile(valueValues, 0.12) - 0.12);

  return {
    calibrated: true,
    sampleCount: hueValues.length,
    hueMin,
    hueMax,
    saturationMin,
    valueMin,
  };
}

function findColorBlobs(mask, width, height, hueValues, saturationValues) {
  const visited = new Uint8Array(mask.length);
  const blobs = [];
  const queue = [];

  for (let startIndex = 0; startIndex < mask.length; startIndex += 1) {
    if (!mask[startIndex] || visited[startIndex]) {
      continue;
    }

    let pixelCount = 0;
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    let hueTotal = 0;
    let saturationTotal = 0;

    queue.length = 0;
    queue.push(startIndex);
    visited[startIndex] = 1;

    while (queue.length) {
      const index = queue.pop();
      const x = index % width;
      const y = Math.floor(index / width);

      pixelCount += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      hueTotal += hueValues[index];
      saturationTotal += saturationValues[index];

      const neighbors = [
        index - 1,
        index + 1,
        index - width,
        index + width,
      ];

      for (const neighborIndex of neighbors) {
        const neighborX = neighborIndex % width;
        const isHorizontalWrap =
          (neighborIndex === index - 1 && neighborX === width - 1) ||
          (neighborIndex === index + 1 && neighborX === 0);

        if (
          neighborIndex < 0 ||
          neighborIndex >= mask.length ||
          isHorizontalWrap ||
          visited[neighborIndex] ||
          !mask[neighborIndex]
        ) {
          continue;
        }

        visited[neighborIndex] = 1;
        queue.push(neighborIndex);
      }
    }

    blobs.push({
      pixelCount,
      minX,
      minY,
      maxX,
      maxY,
      averageHue: hueTotal / pixelCount,
      averageSaturation: saturationTotal / pixelCount,
    });
  }

  return blobs;
}

function findLargestColorBlob(mask, width, height, hueValues, saturationValues) {
  return findColorBlobs(mask, width, height, hueValues, saturationValues)
    .sort((blobA, blobB) => blobB.pixelCount - blobA.pixelCount)[0] ?? null;
}

function getColorTrackedBall(
  video,
  canvas,
  colorProfile = INITIAL_COLOR_PROFILE,
  previousBall = null,
) {
  if (!canvas) {
    return {
      ball: null,
      diagnostics: {
        status: 'Tracker canvas unavailable',
        colorPixels: 0,
        colorBlobPixels: 0,
        colorHue: null,
        colorSaturation: null,
      },
    };
  }

  const context = canvas.getContext('2d', { willReadFrequently: true });

  if (!context) {
    return {
      ball: null,
      diagnostics: {
        status: 'Tracker canvas unavailable',
        colorPixels: 0,
        colorBlobPixels: 0,
        colorHue: null,
        colorSaturation: null,
      },
    };
  }

  canvas.width = COLOR_TRACKER_WIDTH;
  canvas.height = COLOR_TRACKER_HEIGHT;
  context.drawImage(video, 0, 0, canvas.width, canvas.height);

  const frame = context.getImageData(0, 0, canvas.width, canvas.height);
  const mask = new Uint8Array(canvas.width * canvas.height);
  const hueValues = new Float32Array(mask.length);
  const saturationValues = new Float32Array(mask.length);
  let colorPixels = 0;

  for (let pixelIndex = 0; pixelIndex < mask.length; pixelIndex += 1) {
    const dataIndex = pixelIndex * 4;
    const red = frame.data[dataIndex];
    const green = frame.data[dataIndex + 1];
    const blue = frame.data[dataIndex + 2];
    const hsv = rgbToHsv(red, green, blue);

    hueValues[pixelIndex] = hsv.hue;
    saturationValues[pixelIndex] = hsv.saturation;
    const isMatch = isPickleballColoredPixel(red, green, blue, colorProfile);
    mask[pixelIndex] = isMatch ? 1 : 0;
    if (isMatch) {
      colorPixels += 1;
    }
  }

  const blobs = findColorBlobs(
    mask,
    canvas.width,
    canvas.height,
    hueValues,
    saturationValues,
  );
  const largestBlob = blobs
    .slice()
    .sort((blobA, blobB) => blobB.pixelCount - blobA.pixelCount)[0] ?? null;
  const eligibleBlobs = blobs.filter((candidate) => {
    const candidateWidth = candidate.maxX - candidate.minX + 1;
    const candidateHeight = candidate.maxY - candidate.minY + 1;
    const candidateFillRatio = candidate.pixelCount / (candidateWidth * candidateHeight);

    return (
      candidate.pixelCount >= COLOR_TRACKER_MIN_PIXELS &&
      candidate.pixelCount <= mask.length * COLOR_TRACKER_MAX_AREA_RATIO &&
      Math.max(candidateWidth, candidateHeight) <=
        Math.max(canvas.width, canvas.height) * COLOR_TRACKER_MAX_DIMENSION_RATIO &&
      candidateFillRatio >= 0.06
    );
  });
  const previousIsUsable =
    previousBall &&
    Number.isFinite(previousBall.normalizedX) &&
    Number.isFinite(previousBall.normalizedY);
  const blob = eligibleBlobs.sort((blobA, blobB) => {
    if (!previousIsUsable) {
      return blobB.pixelCount - blobA.pixelCount;
    }

    const getDistanceFromPrevious = (candidate) => {
      const centerX = (candidate.minX + candidate.maxX + 1) / (2 * canvas.width);
      const centerY = (candidate.minY + candidate.maxY + 1) / (2 * canvas.height);
      return Math.hypot(
        centerX - previousBall.normalizedX,
        centerY - previousBall.normalizedY,
      );
    };

    return getDistanceFromPrevious(blobA) - getDistanceFromPrevious(blobB);
  })[0] ?? null;

  if (!blob) {
    return {
      ball: null,
      diagnostics: {
        status: colorPixels > 0 ? 'No ball-sized color blob' : 'No matching color',
        colorPixels,
        colorBlobPixels: largestBlob?.pixelCount ?? 0,
        colorHue: largestBlob?.averageHue ?? null,
        colorSaturation: largestBlob?.averageSaturation ?? null,
      },
    };
  }

  const blobWidth = blob.maxX - blob.minX + 1;
  const blobHeight = blob.maxY - blob.minY + 1;
  const fillRatio = blob.pixelCount / (blobWidth * blobHeight);

  const scaleX = video.videoWidth / canvas.width;
  const scaleY = video.videoHeight / canvas.height;
  const x = blob.minX * scaleX;
  const y = blob.minY * scaleY;
  const width = blobWidth * scaleX;
  const height = blobHeight * scaleY;
  const centerX = x + width / 2;
  const centerY = y + height / 2;
  const approximateAreaRatio = blob.pixelCount / mask.length;
  const confidence = Math.min(0.99, 0.35 + fillRatio * 0.35 + approximateAreaRatio * 18);

  return {
    ball: {
      bbox: [x, y, width, height],
      centerX,
      centerY,
      normalizedX: centerX / video.videoWidth,
      normalizedY: centerY / video.videoHeight,
      normalizedSize: Math.max(width, height) / Math.max(video.videoWidth, video.videoHeight),
      confidence,
      source: 'Color Tracker',
    },
    diagnostics: {
      status: 'Tracking color blob',
      colorPixels,
      colorBlobPixels: blob.pixelCount,
      colorHue: blob.averageHue,
      colorSaturation: blob.averageSaturation,
    },
  };
}

function getPaddleArmLandmarks(landmarks, paddleHoldingArm) {
  const isRightArm = paddleHoldingArm === 'right';

  return {
    label: isRightArm ? 'My Right' : 'My Left',
    gate: isRightArm ? RIGHT_ARM_GATE : LEFT_ARM_GATE,
    shoulder: landmarks[isRightArm ? LANDMARK_INDEX.rightShoulder : LANDMARK_INDEX.leftShoulder],
    elbow: landmarks[isRightArm ? LANDMARK_INDEX.rightElbow : LANDMARK_INDEX.leftElbow],
    wrist: landmarks[isRightArm ? LANDMARK_INDEX.rightWrist : LANDMARK_INDEX.leftWrist],
  };
}

function getPaddleOrientation(blob) {
  const width = blob.maxX - blob.minX + 1;
  const height = blob.maxY - blob.minY + 1;

  if (width < 3 || height < 3) {
    return 'not available';
  }

  const ratio = width / height;

  if (ratio > 1.25) {
    return 'horizontal';
  }

  if (ratio < 0.8) {
    return 'vertical';
  }

  return 'not available';
}

function getTrackedPaddle(
  video,
  canvas,
  landmarks,
  paddleHoldingArm,
  colorProfile,
) {
  const selectedArm = getPaddleArmLandmarks(landmarks, paddleHoldingArm);

  if (!colorProfile.calibrated) {
    return {
      paddle: null,
      searchArea: null,
      diagnostics: {
        status: 'Needs paddle calibration',
        selectedArm: selectedArm.label,
        searchRadius: null,
        colorPixels: 0,
        colorBlobPixels: 0,
      },
    };
  }

  if (!canvas) {
    return {
      paddle: null,
      searchArea: null,
      diagnostics: {
        status: 'Tracker canvas unavailable',
        selectedArm: selectedArm.label,
        searchRadius: null,
        colorPixels: 0,
        colorBlobPixels: 0,
      },
    };
  }

  if (!areLandmarksUsable([selectedArm.shoulder, selectedArm.elbow, selectedArm.wrist])) {
    return {
      paddle: null,
      searchArea: null,
      diagnostics: {
        status: 'Need selected arm in frame',
        selectedArm: selectedArm.label,
        searchRadius: null,
        colorPixels: 0,
        colorBlobPixels: 0,
      },
    };
  }

  const context = canvas.getContext('2d', { willReadFrequently: true });

  if (!context) {
    return {
      paddle: null,
      searchArea: null,
      diagnostics: {
        status: 'Tracker canvas unavailable',
        selectedArm: selectedArm.label,
        searchRadius: null,
        colorPixels: 0,
        colorBlobPixels: 0,
      },
    };
  }

  const forearmLength = getDistance(selectedArm.elbow, selectedArm.wrist);
  const searchRadius = clamp(
    forearmLength * PADDLE_RADIUS_SCALE,
    PADDLE_RADIUS_MIN,
    PADDLE_RADIUS_MAX,
  );

  canvas.width = PADDLE_TRACKER_WIDTH;
  canvas.height = PADDLE_TRACKER_HEIGHT;
  context.drawImage(video, 0, 0, canvas.width, canvas.height);

  const wristX = selectedArm.wrist.x * canvas.width;
  const wristY = selectedArm.wrist.y * canvas.height;
  const forearmPixels = forearmLength * Math.max(canvas.width, canvas.height);
  const radiusPixels = searchRadius * Math.max(canvas.width, canvas.height);
  const radiusSquared = radiusPixels * radiusPixels;
  const frame = context.getImageData(0, 0, canvas.width, canvas.height);
  const mask = new Uint8Array(canvas.width * canvas.height);
  const hueValues = new Float32Array(mask.length);
  const saturationValues = new Float32Array(mask.length);
  let colorPixels = 0;

  for (let pixelIndex = 0; pixelIndex < mask.length; pixelIndex += 1) {
    const x = pixelIndex % canvas.width;
    const y = Math.floor(pixelIndex / canvas.width);
    const distanceFromWristSquared =
      (x - wristX) * (x - wristX) + (y - wristY) * (y - wristY);

    if (distanceFromWristSquared > radiusSquared) {
      continue;
    }

    const dataIndex = pixelIndex * 4;
    const red = frame.data[dataIndex];
    const green = frame.data[dataIndex + 1];
    const blue = frame.data[dataIndex + 2];
    const hsv = rgbToHsv(red, green, blue);

    hueValues[pixelIndex] = hsv.hue;
    saturationValues[pixelIndex] = hsv.saturation;

    if (isPickleballColoredPixel(red, green, blue, colorProfile)) {
      mask[pixelIndex] = 1;
      colorPixels += 1;
    }
  }

  const blob = findLargestColorBlob(
    mask,
    canvas.width,
    canvas.height,
    hueValues,
    saturationValues,
  );
  const searchArea = {
    centerX: selectedArm.wrist.x * video.videoWidth,
    centerY: selectedArm.wrist.y * video.videoHeight,
    radius: searchRadius * Math.max(video.videoWidth, video.videoHeight),
  };

  if (!blob || blob.pixelCount < PADDLE_TRACKER_MIN_PIXELS) {
    return {
      paddle: null,
      searchArea,
      diagnostics: {
        status: colorPixels > 0 ? 'Paddle color match too small' : 'No paddle color in wrist area',
        selectedArm: selectedArm.label,
        searchRadius,
        colorPixels,
        colorBlobPixels: blob?.pixelCount ?? 0,
      },
    };
  }

  const blobWidth = blob.maxX - blob.minX + 1;
  const blobHeight = blob.maxY - blob.minY + 1;
  const fillRatio = blob.pixelCount / (blobWidth * blobHeight);
  const maxBlobDimension = forearmPixels * PADDLE_MAX_FOREARM_RATIO;
  const searchAreaPixels = Math.PI * radiusPixels * radiusPixels;
  const blobArea = blobWidth * blobHeight;

  if (fillRatio < 0.04) {
    return {
      paddle: null,
      searchArea,
      diagnostics: {
        status: 'Paddle blob too sparse',
        selectedArm: selectedArm.label,
        searchRadius,
        colorPixels,
        colorBlobPixels: blob.pixelCount,
      },
    };
  }

  if (
    blobWidth > maxBlobDimension ||
    blobHeight > maxBlobDimension ||
    blobArea > searchAreaPixels * PADDLE_MAX_SEARCH_AREA_RATIO
  ) {
    return {
      paddle: null,
      searchArea,
      diagnostics: {
        status: 'Paddle blob too large',
        selectedArm: selectedArm.label,
        searchRadius,
        colorPixels,
        colorBlobPixels: blob.pixelCount,
      },
    };
  }

  const scaleX = video.videoWidth / canvas.width;
  const scaleY = video.videoHeight / canvas.height;
  const x = blob.minX * scaleX;
  const y = blob.minY * scaleY;
  const width = blobWidth * scaleX;
  const height = blobHeight * scaleY;
  const centerX = x + width / 2;
  const centerY = y + height / 2;
  const distanceFromWrist =
    Math.hypot(centerX - searchArea.centerX, centerY - searchArea.centerY) /
    Math.max(searchArea.radius, 1);
  const confidence = Math.min(
    0.99,
    0.3 + fillRatio * 0.35 + Math.min(0.25, blob.pixelCount / 800) + (1 - distanceFromWrist) * 0.12,
  );

  return {
    paddle: {
      bbox: [x, y, width, height],
      centerX,
      centerY,
      normalizedX: centerX / video.videoWidth,
      normalizedY: centerY / video.videoHeight,
      confidence,
      source: 'Color Tracker',
      orientation: getPaddleOrientation(blob),
    },
    searchArea,
    diagnostics: {
      status: 'Tracking paddle color',
      selectedArm: selectedArm.label,
      searchRadius,
      colorPixels,
      colorBlobPixels: blob.pixelCount,
    },
  };
}

function drawBallDetection(context, ball) {
  if (!ball) {
    return;
  }

  const [x, y, width, height] = ball.bbox;
  const radius = Math.max(width, height) / 2;

  context.save();
  context.strokeStyle = '#ffd166';
  context.fillStyle = 'rgba(255, 209, 102, 0.2)';
  context.lineWidth = 4;
  context.beginPath();
  context.arc(ball.centerX, ball.centerY, radius, 0, 2 * Math.PI);
  context.stroke();
  context.fill();
  context.strokeRect(x, y, width, height);
  context.restore();
}

function drawBallTrail(context, history, now) {
  const latestFrame = history[history.length - 1];

  if (!latestFrame || now - latestFrame.timestamp > BALL_TRAIL_HOLD_MS) {
    return;
  }

  const trailFrames = history.slice(-18);

  if (trailFrames.length < 2) {
    return;
  }

  context.save();
  context.lineWidth = 3;
  context.lineCap = 'round';
  context.lineJoin = 'round';

  for (let index = 1; index < trailFrames.length; index += 1) {
    const previousFrame = trailFrames[index - 1];
    const currentFrame = trailFrames[index];
    const alpha = index / trailFrames.length;

    context.strokeStyle = `rgba(255, 209, 102, ${0.18 + alpha * 0.55})`;
    context.beginPath();
    context.moveTo(previousFrame.centerX, previousFrame.centerY);
    context.lineTo(currentFrame.centerX, currentFrame.centerY);
    context.stroke();
  }

  for (let index = 0; index < trailFrames.length; index += 1) {
    const frame = trailFrames[index];
    const alpha = (index + 1) / trailFrames.length;

    context.fillStyle = `rgba(255, 209, 102, ${0.25 + alpha * 0.45})`;
    context.beginPath();
    context.arc(frame.centerX, frame.centerY, 3 + alpha * 3, 0, 2 * Math.PI);
    context.fill();
  }

  context.restore();
}

function drawPaddleDetection(context, paddle, searchArea) {
  context.save();

  if (searchArea) {
    context.strokeStyle = 'rgba(178, 123, 255, 0.55)';
    context.lineWidth = 2;
    context.setLineDash([8, 8]);
    context.beginPath();
    context.arc(searchArea.centerX, searchArea.centerY, searchArea.radius, 0, 2 * Math.PI);
    context.stroke();
    context.setLineDash([]);
  }

  if (paddle) {
    const [x, y, width, height] = paddle.bbox;

    context.strokeStyle = '#b27bff';
    context.fillStyle = 'rgba(178, 123, 255, 0.18)';
    context.lineWidth = 4;
    context.strokeRect(x, y, width, height);
    context.fillRect(x, y, width, height);
    context.beginPath();
    context.arc(paddle.centerX, paddle.centerY, 6, 0, 2 * Math.PI);
    context.fillStyle = '#ffffff';
    context.fill();
  }

  context.restore();
}

function getPostureMeasurements(landmarks) {
  const leftShoulder = landmarks[LANDMARK_INDEX.leftShoulder];
  const rightShoulder = landmarks[LANDMARK_INDEX.rightShoulder];
  const leftElbow = landmarks[LANDMARK_INDEX.leftElbow];
  const rightElbow = landmarks[LANDMARK_INDEX.rightElbow];
  const leftWrist = landmarks[LANDMARK_INDEX.leftWrist];
  const rightWrist = landmarks[LANDMARK_INDEX.rightWrist];
  const leftHip = landmarks[LANDMARK_INDEX.leftHip];
  const rightHip = landmarks[LANDMARK_INDEX.rightHip];
  const leftKnee = landmarks[LANDMARK_INDEX.leftKnee];
  const rightKnee = landmarks[LANDMARK_INDEX.rightKnee];
  const leftAnkle = landmarks[LANDMARK_INDEX.leftAnkle];
  const rightAnkle = landmarks[LANDMARK_INDEX.rightAnkle];

  const ankleWidth = getDistance(leftAnkle, rightAnkle);
  const hipWidth = getDistance(leftHip, rightHip);
  const shoulderWidth = getDistance(leftShoulder, rightShoulder);
  const feetToHipRatio =
    ankleWidth && hipWidth && hipWidth !== 0 ? ankleWidth / hipWidth : null;
  const feetToShoulderRatio =
    ankleWidth && shoulderWidth && shoulderWidth !== 0
      ? ankleWidth / shoulderWidth
      : null;

  return {
    leftKneeAngle: getAngle(leftHip, leftKnee, leftAnkle),
    rightKneeAngle: getAngle(rightHip, rightKnee, rightAnkle),
    leftElbowAngle: getAngle(leftShoulder, leftElbow, leftWrist),
    rightElbowAngle: getAngle(rightShoulder, rightElbow, rightWrist),
    feetToHipRatio,
    feetToShoulderRatio,
    shoulderTilt: getTiltAngle(leftShoulder, rightShoulder),
    hipTilt: getTiltAngle(leftHip, rightHip),
    torsoLean: getTorsoLean(landmarks),
    wristHeightStatus: getWristHeightStatus(landmarks),
  };
}

function getDerivedMetrics(measurements) {
  return [
    {
      metric: 'Left Knee Angle',
      value: formatAngle(measurements.leftKneeAngle),
      why: 'Knee angles show whether player is upright or athletic.',
    },
    {
      metric: 'Right Knee Angle',
      value: formatAngle(measurements.rightKneeAngle),
      why: 'Knee angles show whether player is upright or athletic.',
    },
    {
      metric: 'Left Elbow Angle',
      value: formatAngle(measurements.leftElbowAngle),
      why: 'Elbow angles help approximate paddle/arm readiness.',
    },
    {
      metric: 'Right Elbow Angle',
      value: formatAngle(measurements.rightElbowAngle),
      why: 'Elbow angles help approximate paddle/arm readiness.',
    },
    {
      metric: 'Feet-to-Hip Width Ratio',
      value: formatRatio(measurements.feetToHipRatio),
      why: 'Width ratios show stance width.',
    },
    {
      metric: 'Feet-to-Shoulder Width Ratio',
      value: formatRatio(measurements.feetToShoulderRatio),
      why: 'Width ratios show stance width.',
    },
    {
      metric: 'Shoulder Tilt',
      value: formatAngle(measurements.shoulderTilt),
      why: 'Shoulder/hip tilt shows balance.',
    },
    {
      metric: 'Hip Tilt',
      value: formatAngle(measurements.hipTilt),
      why: 'Shoulder/hip tilt shows balance.',
    },
    {
      metric: 'Torso Lean',
      value:
        typeof measurements.torsoLean === 'number'
          ? measurements.torsoLean.toFixed(2)
          : FULL_BODY_MESSAGE,
      why: 'Torso lean shows posture.',
    },
    {
      metric: 'Wrist Height Status',
      value: measurements.wristHeightStatus,
      why: 'Wrist height helps approximate paddle-up position.',
    },
  ];
}

function getReadyPositionAnalysis(landmarks, measurements) {
  const hasFullBody = READY_POSITION_GATE.every((index) =>
    isUsableLandmark(landmarks[index]),
  );

  if (!hasFullBody) {
    return {
      status: 'Need Full Body In Frame',
      score: null,
      tips: ['Step back so DinkAI can see your shoulders, hips, knees, and feet.'],
      subscores: [
        { label: 'Lower Body Engagement', value: null, max: 35 },
        { label: 'Stance Width', value: null, max: 25 },
        { label: 'Paddle/Hand Readiness', value: null, max: 25 },
        { label: 'Balance', value: null, max: 15 },
      ],
    };
  }

  const tips = [];
  const averageKneeAngle =
    (measurements.leftKneeAngle + measurements.rightKneeAngle) / 2;
  let lowerBodyScore = 0;

  if (averageKneeAngle >= 145 && averageKneeAngle <= 168) {
    lowerBodyScore = 35;
    tips.push({ priority: 6, text: 'Good knee bend.' });
  } else if (averageKneeAngle > 168 && averageKneeAngle <= 172) {
    lowerBodyScore = 24;
    tips.push({ priority: 2, text: 'Slightly bend your knees more.' });
  } else if (averageKneeAngle > 172) {
    lowerBodyScore = 10;
    tips.push({
      priority: 1,
      text: 'Bend your knees more to get into an athletic pickleball stance.',
    });
  } else if (averageKneeAngle >= 135 && averageKneeAngle < 145) {
    lowerBodyScore = 24;
    tips.push({ priority: 6, text: 'Good knee bend.' });
  } else {
    lowerBodyScore = 10;
    tips.push({
      priority: 6,
      text: 'You may be too low. Stay athletic, not collapsed.',
    });
  }

  let stanceScore = 0;

  if (
    measurements.feetToHipRatio >= 1.4 &&
    measurements.feetToHipRatio <= 2.4 &&
    measurements.feetToShoulderRatio >= 0.9 &&
    measurements.feetToShoulderRatio <= 1.5
  ) {
    stanceScore = 25;
    tips.push({ priority: 7, text: 'Good stance width.' });
  } else if (measurements.feetToHipRatio < 1.3) {
    stanceScore = 8;
    tips.push({ priority: 3, text: 'Widen your stance for better balance.' });
  } else if (measurements.feetToHipRatio > 2.7) {
    stanceScore = 8;
    tips.push({
      priority: 3,
      text: 'Your stance may be too wide. Stay balanced but mobile.',
    });
  } else {
    stanceScore = 17;
    tips.push({ priority: 7, text: 'Good stance width.' });
  }

  let handScore = 0;

  if (measurements.wristHeightStatus === 'between hips and shoulders') {
    handScore = 25;
    tips.push({ priority: 8, text: 'Good hand position.' });
  } else if (measurements.wristHeightStatus === 'below hips') {
    handScore = 7;
    tips.push({
      priority: 4,
      text: 'Keep your paddle up in front of your body.',
    });
  } else if (measurements.wristHeightStatus === 'above shoulders') {
    handScore = 16;
    tips.push({
      priority: 8,
      text: 'Hands may be too high. Keep paddle relaxed around waist to chest height.',
    });
  } else {
    handScore = 0;
    tips.push({
      priority: 4,
      text: 'Keep your hands visible so DinkAI can check paddle readiness.',
    });
  }

  let balanceScore = 0;
  const maxTilt = Math.max(measurements.shoulderTilt, measurements.hipTilt);

  if (maxTilt < 8) {
    balanceScore = 15;
    tips.push({ priority: 9, text: 'Good balance.' });
  } else if (maxTilt <= 12) {
    balanceScore = 9;
    tips.push({
      priority: 5,
      text: 'Try to keep your shoulders and hips more level.',
    });
  } else {
    balanceScore = 4;
    tips.push({
      priority: 5,
      text: 'Stay centered. You appear to be leaning to one side.',
    });
  }

  const score = Math.round(
    lowerBodyScore + stanceScore + handScore + balanceScore,
  );
  const status =
    score >= 85
      ? 'Strong Ready Position'
      : score >= 65
        ? 'Good Base, Needs Adjustment'
        : 'Not Ready';

  return {
    status,
    score,
    tips: tips
      .sort((tipA, tipB) => tipA.priority - tipB.priority)
      .slice(0, 3)
      .map((tip) => tip.text),
    subscores: [
      { label: 'Lower Body Engagement', value: lowerBodyScore, max: 35 },
      { label: 'Stance Width', value: stanceScore, max: 25 },
      { label: 'Paddle/Hand Readiness', value: handScore, max: 25 },
      { label: 'Balance', value: balanceScore, max: 15 },
    ],
  };
}

function getSpokenReview(review, sessionReview) {
  if (!review) {
    return 'DinkAI voice reviews are ready. Complete four likely dink contacts to receive a review.';
  }

  const sessionSummary = sessionReview
    ? ` Across ${sessionReview.hitCount} hits, your session average is ${sessionReview.averageScore} and the trend is ${sessionReview.scoreTrend}.`
    : '';

  return `Four-hit dink review number ${review.batchNumber}. Your score is ${review.score} out of 100. ${review.tips
    .slice(0, 2)
    .join(' ')}${sessionSummary}`;
}

function speakWithBrowserVoice(text) {
  if (!('speechSynthesis' in window)) {
    return false;
  }

  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1;
  utterance.pitch = 1;
  window.speechSynthesis.speak(utterance);
  return true;
}

function waitForVideoMetadata(video) {
  if (video.videoWidth && video.videoHeight) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    video.addEventListener('loadedmetadata', resolve, { once: true });
  });
}

async function createPoseLandmarker(vision) {
  const options = {
    baseOptions: {
      modelAssetPath: MODEL_URL,
      delegate: 'GPU',
    },
    runningMode: 'VIDEO',
    numPoses: 1,
  };

  try {
    return await PoseLandmarker.createFromOptions(vision, options);
  } catch (gpuError) {
    console.warn('GPU pose tracking failed, falling back to CPU.', gpuError);
    return PoseLandmarker.createFromOptions(vision, {
      ...options,
      baseOptions: {
        modelAssetPath: MODEL_URL,
        delegate: 'CPU',
      },
    });
  }
}

function CoachApp() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const animationFrameRef = useRef(null);
  const streamRef = useRef(null);
  const landmarkerRef = useRef(null);
  const ballDetectorRef = useRef(null);
  const drawingUtilsRef = useRef(null);
  const colorTrackerCanvasRef = useRef(null);
  const paddleTrackerCanvasRef = useRef(null);
  const pixelSamplerCanvasRef = useRef(null);
  const colorProfileRef = useRef(INITIAL_COLOR_PROFILE);
  const paddleColorProfileRef = useRef({ ...INITIAL_COLOR_PROFILE, hueMin: 0, hueMax: 360 });
  const paddleHoldingArmRef = useRef('right');
  const lastVideoTimeRef = useRef(-1);
  const motionHistoryRef = useRef([]);
  const smoothedCoachLandmarksRef = useRef([]);
  const lastCoachUpdateTimeRef = useRef(0);
  const latestBallRef = useRef(null);
  const ballHistoryRef = useRef([]);
  const latestPaddleRef = useRef(null);
  const latestPaddleSearchAreaRef = useRef(null);
  const ballDetectionTimeoutRef = useRef(null);
  const colorBallTrackingTimeoutRef = useRef(null);
  const isBallDetectionStoppedRef = useRef(false);
  const dinkHitBatchRef = useRef([]);
  const dinkReviewHistoryRef = useRef([]);
  const lastDinkHitAtRef = useRef(0);
  const pendingDinkContactRef = useRef(null);
  const lastVoiceReviewRef = useRef(null);
  const voiceAudioRef = useRef(null);
  const voiceAudioUrlRef = useRef(null);
  const poseHitRecorderRef = useRef(null);
  if (poseHitRecorderRef.current === null) {
    poseHitRecorderRef.current = createPoseHitRecorder();
  }
  const [status, setStatus] = useState('Loading pose model...');
  const [error, setError] = useState('');
  const [latestLandmarks, setLatestLandmarks] = useState([]);
  const [coachLandmarks, setCoachLandmarks] = useState([]);
  const [motionHistory, setMotionHistory] = useState([]);
  const [heldSwing, setHeldSwing] = useState(null);
  const [dinkHitBatch, setDinkHitBatch] = useState([]);
  const [latestDinkReview, setLatestDinkReview] = useState(null);
  const [dinkReviewHistory, setDinkReviewHistory] = useState([]);
  const [avatarRepVersion, setAvatarRepVersion] = useState(0);
  const [ballDebug, setBallDebug] = useState(INITIAL_BALL_DEBUG);
  const [paddleDebug, setPaddleDebug] = useState(INITIAL_PADDLE_DEBUG);
  const [pixelSample, setPixelSample] = useState(INITIAL_PIXEL_SAMPLE);
  const [colorProfile, setColorProfile] = useState(INITIAL_COLOR_PROFILE);
  const [paddleColorProfile, setPaddleColorProfile] = useState({
    ...INITIAL_COLOR_PROFILE,
    hueMin: 0,
    hueMax: 360,
  });
  const [calibrationTarget, setCalibrationTarget] = useState('ball');
  const [paddleHoldingArm, setPaddleHoldingArm] = useState('right');
  const [sampleBox, setSampleBox] = useState(INITIAL_SAMPLE_BOX);
  const [voiceReviewsEnabled, setVoiceReviewsEnabled] = useState(true);
  const [voiceStatus, setVoiceStatus] = useState('Voice reviews ready');
  colorProfileRef.current = colorProfile;
  paddleColorProfileRef.current = paddleColorProfile;
  paddleHoldingArmRef.current = paddleHoldingArm;
  const postureMeasurements = useMemo(
    () => getPostureMeasurements(latestLandmarks),
    [latestLandmarks],
  );
  const derivedMetrics = useMemo(
    () => getDerivedMetrics(postureMeasurements),
    [postureMeasurements],
  );
  const coachMeasurements = useMemo(
    () => getPostureMeasurements(coachLandmarks),
    [coachLandmarks],
  );
  const readyPositionAnalysis = useMemo(
    () => getReadyPositionAnalysis(coachLandmarks, coachMeasurements),
    [coachLandmarks, coachMeasurements],
  );
  const motionSnapshot = useMemo(
    () => getMotionSnapshot(motionHistory),
    [motionHistory],
  );
  const motionMetrics = useMemo(
    () => getMotionMetrics(motionHistory),
    [motionHistory],
  );
  const actionDetection = useMemo(
    () => getActionDetection(motionSnapshot, heldSwing),
    [motionSnapshot, heldSwing],
  );
  const sessionDinkReview = useMemo(
    () => createSessionDinkReview(dinkReviewHistory),
    [dinkReviewHistory],
  );
  const sessionComposite = useMemo(
    () =>
      buildSessionComposite(poseHitRecorderRef.current.getReps(), {
        swingSide: paddleHoldingArm,
      }),
    [avatarRepVersion, paddleHoldingArm],
  );

  useEffect(() => {
    const recorder = poseHitRecorderRef.current;
    recorder.setOnReps(() => setAvatarRepVersion((version) => version + 1));
    return () => recorder.setOnReps(null);
  }, []);
  const activeCalibrationProfile =
    calibrationTarget === 'paddle' ? paddleColorProfile : colorProfile;
  const activeCalibrationLabel = calibrationTarget === 'paddle' ? 'Paddle' : 'Ball';

  const playVoiceReview = useCallback(async (text) => {
    voiceAudioRef.current?.pause();
    if (voiceAudioUrlRef.current) {
      URL.revokeObjectURL(voiceAudioUrlRef.current);
      voiceAudioUrlRef.current = null;
    }

    try {
      const response = await fetch(VOICE_REVIEW_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });

      if (!response.ok) {
        throw new Error(`Voice API returned ${response.status}`);
      }

      const audioUrl = URL.createObjectURL(await response.blob());
      const audio = new Audio(audioUrl);
      voiceAudioRef.current = audio;
      voiceAudioUrlRef.current = audioUrl;
      audio.onended = () => {
        if (voiceAudioUrlRef.current === audioUrl) {
          URL.revokeObjectURL(audioUrl);
          voiceAudioUrlRef.current = null;
        }
      };
      await audio.play();
      setVoiceStatus('ElevenLabs voice played');
    } catch (voiceError) {
      console.warn('Voice API unavailable; using the browser voice.', voiceError);
      const usedBrowserVoice = speakWithBrowserVoice(text);
      setVoiceStatus(
        usedBrowserVoice
          ? 'Browser voice played (add ElevenLabs credentials for a natural voice)'
          : 'Voice playback is not supported in this browser',
      );
    }
  }, []);

  const handleVoiceToggle = useCallback(() => {
    setVoiceReviewsEnabled((enabled) => {
      const nextEnabled = !enabled;
      if (!nextEnabled) {
        voiceAudioRef.current?.pause();
        window.speechSynthesis?.cancel();
        setVoiceStatus('Voice reviews paused');
      } else {
        setVoiceStatus('Voice reviews enabled');
      }
      return nextEnabled;
    });
  }, []);

  const handleVoiceTest = useCallback(() => {
    playVoiceReview(getSpokenReview(latestDinkReview, sessionDinkReview));
  }, [latestDinkReview, playVoiceReview, sessionDinkReview]);

  useEffect(() => {
    if (latestDinkReview && lastVoiceReviewRef.current !== latestDinkReview) {
      lastVoiceReviewRef.current = latestDinkReview;
      if (voiceReviewsEnabled) {
        playVoiceReview(getSpokenReview(latestDinkReview, sessionDinkReview));
      }
    }
  }, [latestDinkReview, playVoiceReview, sessionDinkReview, voiceReviewsEnabled]);

  const resetDinkReview = useCallback(() => {
    dinkHitBatchRef.current = [];
    dinkReviewHistoryRef.current = [];
    lastDinkHitAtRef.current = 0;
    pendingDinkContactRef.current = null;
    lastVoiceReviewRef.current = null;
    poseHitRecorderRef.current.reset();
    setDinkHitBatch([]);
    setLatestDinkReview(null);
    setDinkReviewHistory([]);
    setAvatarRepVersion((version) => version + 1);
  }, []);

  const recordDinkHit = useCallback((candidate, landmarks) => {
    poseHitRecorderRef.current.registerHit(candidate.timestamp);
    const measurements = getPostureMeasurements(landmarks);
    const readyPosition = getReadyPositionAnalysis(landmarks, measurements);
    const nextHit = {
      ...candidate,
      readyScore: readyPosition.score,
      wristHeightStatus: measurements.wristHeightStatus,
    };
    const nextBatch = [...dinkHitBatchRef.current, nextHit];

    lastDinkHitAtRef.current = candidate.timestamp;

    if (nextBatch.length === HITS_PER_DINK_REVIEW) {
      const review = createDinkReview(nextBatch);
      const nextReviewHistory = [...dinkReviewHistoryRef.current, review];
      const numberedReview = {
        ...review,
        batchNumber: nextReviewHistory.length,
      };

      dinkReviewHistoryRef.current = nextReviewHistory;
      setDinkReviewHistory(nextReviewHistory);
      setLatestDinkReview(numberedReview);
      dinkHitBatchRef.current = [];
      setDinkHitBatch([]);
      return;
    }

    dinkHitBatchRef.current = nextBatch;
    setDinkHitBatch(nextBatch);
  }, []);
  const samplePixelAtPoint = useCallback((point, profile = colorProfile) => {
    const video = videoRef.current;
    const canvas = pixelSamplerCanvasRef.current;

    if (!video || !canvas || !video.videoWidth || !video.videoHeight) {
      return;
    }

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const context = canvas.getContext('2d', { willReadFrequently: true });

    if (!context) {
      return;
    }

    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const [red, green, blue] = context.getImageData(point.videoX, point.videoY, 1, 1).data;
    const hsv = rgbToHsv(red, green, blue);

    setPixelSample({
      hasSample: true,
      x: point.videoX,
      y: point.videoY,
      red,
      green,
      blue,
      hue: hsv.hue,
      saturation: hsv.saturation,
      value: hsv.value,
      isColorMatch: isPickleballColoredPixel(red, green, blue, profile),
    });
  }, [colorProfile]);

  const handleVideoFramePointerDown = useCallback((event) => {
    const video = videoRef.current;

    if (!video || !video.videoWidth || !video.videoHeight) {
      return;
    }

    const point = getVideoSamplePoint(
      event,
      video,
      event.currentTarget.getBoundingClientRect(),
    );

    if (!point) {
      return;
    }

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setSampleBox({
      isDragging: true,
      startX: point.displayX,
      startY: point.displayY,
      currentX: point.displayX,
      currentY: point.displayY,
      startPoint: point,
      currentPoint: point,
    });
  }, []);

  const handleVideoFramePointerMove = useCallback((event) => {
    const video = videoRef.current;

    if (!sampleBox.isDragging || !video || !video.videoWidth || !video.videoHeight) {
      return;
    }

    const point = getVideoSamplePoint(
      event,
      video,
      event.currentTarget.getBoundingClientRect(),
    );

    if (!point) {
      return;
    }

    event.preventDefault();
    setSampleBox((currentBox) => ({
      ...currentBox,
      currentX: point.displayX,
      currentY: point.displayY,
      currentPoint: point,
    }));
  }, [sampleBox.isDragging]);

  const handleVideoFramePointerUp = useCallback((event) => {
    const video = videoRef.current;
    const canvas = pixelSamplerCanvasRef.current;

    if (!sampleBox.isDragging || !video || !canvas) {
      return;
    }

    event.preventDefault();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    const point = getVideoSamplePoint(
      event,
      video,
      event.currentTarget.getBoundingClientRect(),
    );
    const endPoint = point ?? sampleBox.currentPoint;
    const dragDistance = Math.hypot(
      sampleBox.currentX - sampleBox.startX,
      sampleBox.currentY - sampleBox.startY,
    );

    const activeProfile =
      calibrationTarget === 'paddle' ? paddleColorProfile : colorProfile;

    if (dragDistance < 8) {
      samplePixelAtPoint(sampleBox.startPoint, activeProfile);
    } else {
      const centerPoint = {
        videoX: Math.round((sampleBox.startPoint.videoX + endPoint.videoX) / 2),
        videoY: Math.round((sampleBox.startPoint.videoY + endPoint.videoY) / 2),
      };
      const nextProfile = getColorProfileFromVideoRegion(
        video,
        canvas,
        sampleBox.startPoint,
        endPoint,
        centerPoint,
      );

      if (nextProfile) {
        if (calibrationTarget === 'paddle') {
          setPaddleColorProfile(nextProfile);
        } else {
          setColorProfile(nextProfile);
        }
        samplePixelAtPoint(centerPoint, nextProfile);
      }
    }

    setSampleBox(INITIAL_SAMPLE_BOX);
  }, [calibrationTarget, colorProfile, paddleColorProfile, sampleBox, samplePixelAtPoint]);

  const handleVideoFramePointerCancel = useCallback(() => {
    setSampleBox(INITIAL_SAMPLE_BOX);
  }, []);

  const runColorBallTracking = useCallback(() => {
    const video = videoRef.current;

    if (!video || isBallDetectionStoppedRef.current) {
      return;
    }

    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      const startedAt = performance.now();
      const colorResult = getColorTrackedBall(
        video,
        colorTrackerCanvasRef.current,
        colorProfileRef.current,
        latestBallRef.current,
      );
      const timestamp = performance.now();
      const colorBall = colorResult?.ball ?? null;
      const currentBall = latestBallRef.current;
      const activeBall = colorBall
        ? { ...colorBall, timestamp }
        : currentBall && timestamp - currentBall.timestamp <= BALL_TRACK_HOLD_MS
          ? currentBall
          : null;

      if (colorBall) {
        ballHistoryRef.current = addBallFrame(
          ballHistoryRef.current,
          colorBall,
          timestamp,
          'Color Tracker',
        );
      }

      latestBallRef.current = activeBall;
      const ballMotion = getBallMotionSnapshot(ballHistoryRef.current);

      setBallDebug((currentDebug) => ({
        ...currentDebug,
        status: colorBall
          ? 'Tracking color blob'
          : colorResult?.diagnostics.status ?? 'Color tracker waiting',
        detected: Boolean(activeBall),
        x: activeBall?.normalizedX ?? null,
        y: activeBall?.normalizedY ?? null,
        size: activeBall?.normalizedSize ?? null,
        confidence: activeBall?.confidence ?? null,
        speed: ballMotion.speed,
        direction: ballMotion.direction,
        framesTracked: ballMotion.framesTracked,
        fps: timestamp > startedAt ? 1000 / (timestamp - startedAt) : null,
        source: activeBall?.source ?? 'None',
        colorTrackerStatus: colorResult?.diagnostics.status ?? 'Waiting',
        colorPixels: colorResult?.diagnostics.colorPixels ?? 0,
        colorBlobPixels: colorResult?.diagnostics.colorBlobPixels ?? 0,
        colorHue: colorResult?.diagnostics.colorHue ?? null,
        colorSaturation: colorResult?.diagnostics.colorSaturation ?? null,
      }));
    }

    if (!isBallDetectionStoppedRef.current) {
      colorBallTrackingTimeoutRef.current = window.setTimeout(
        runColorBallTracking,
        COLOR_TRACKER_INTERVAL_MS,
      );
    }
  }, []);

  const runBallDetection = useCallback(async () => {
    const video = videoRef.current;
    const detector = ballDetectorRef.current;

    if (!video || !detector || isBallDetectionStoppedRef.current) {
      return;
    }

    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      try {
        const startedAt = performance.now();
        const predictions = await detector.detect(
          video,
          8,
          BALL_DETECTION_MIN_SCORE,
        );
        const cocoBall = getBestBallPrediction(predictions, video);
        const timestamp = performance.now();

        if (cocoBall) {
          ballHistoryRef.current = addBallFrame(
            ballHistoryRef.current,
            cocoBall,
            timestamp,
            'COCO-SSD',
          );
          latestBallRef.current = { ...cocoBall, timestamp };
        }

        const ballMotion = getBallMotionSnapshot(ballHistoryRef.current);

        setBallDebug((currentDebug) => ({
          ...currentDebug,
          status: cocoBall ? 'COCO-SSD confirmed ball' : currentDebug.status,
          detected: Boolean(latestBallRef.current),
          x: latestBallRef.current?.normalizedX ?? null,
          y: latestBallRef.current?.normalizedY ?? null,
          size: latestBallRef.current?.normalizedSize ?? null,
          confidence: latestBallRef.current?.confidence ?? null,
          speed: ballMotion.speed,
          direction: ballMotion.direction,
          framesTracked: ballMotion.framesTracked,
          fps: timestamp > startedAt ? 1000 / (timestamp - startedAt) : null,
          source: latestBallRef.current?.source ?? 'None',
        }));
      } catch (detectorError) {
        console.error(detectorError);
        setBallDebug((currentDebug) => ({
          ...currentDebug,
          status: 'COCO unavailable; using color tracker',
        }));
      }
    }

    if (!isBallDetectionStoppedRef.current) {
      ballDetectionTimeoutRef.current = window.setTimeout(
        runBallDetection,
        COCO_BALL_DETECTION_INTERVAL_MS,
      );
    }
  }, []);

  const drawPose = useCallback((results) => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');

    if (!video || !canvas || !context || !drawingUtilsRef.current) {
      return;
    }

    if (
      canvas.width !== video.videoWidth ||
      canvas.height !== video.videoHeight
    ) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }

    context.clearRect(0, 0, canvas.width, canvas.height);

    for (const landmarks of results.landmarks ?? []) {
      drawingUtilsRef.current.drawConnectors(
        landmarks,
        PoseLandmarker.POSE_CONNECTIONS,
        { color: '#00f5d4', lineWidth: 4 },
      );
      drawingUtilsRef.current.drawLandmarks(landmarks, {
        color: '#ff4d6d',
        fillColor: '#ffffff',
        lineWidth: 2,
        radius: 5,
      });
    }

    drawBallTrail(context, ballHistoryRef.current, performance.now());
    drawBallDetection(context, latestBallRef.current);
    drawPaddleDetection(
      context,
      latestPaddleRef.current,
      latestPaddleSearchAreaRef.current,
    );
  }, []);

  const predictWebcam = useCallback(() => {
    const video = videoRef.current;
    const landmarker = landmarkerRef.current;

    if (!video || !landmarker) {
      return;
    }

    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      const nowInMs = performance.now();

      if (video.currentTime !== lastVideoTimeRef.current) {
        lastVideoTimeRef.current = video.currentTime;
        const results = landmarker.detectForVideo(video, nowInMs);
        const detectedLandmarks = results.landmarks?.[0] ?? [];

        setLatestLandmarks(detectedLandmarks);
        poseHitRecorderRef.current.pushFrame({ t: nowInMs, kp: detectedLandmarks });
        const paddleResult = getTrackedPaddle(
          video,
          paddleTrackerCanvasRef.current,
          detectedLandmarks,
          paddleHoldingArmRef.current,
          paddleColorProfileRef.current,
        );
        latestPaddleRef.current = paddleResult.paddle
          ? { ...paddleResult.paddle, timestamp: nowInMs }
          : null;
        latestPaddleSearchAreaRef.current = paddleResult.searchArea;
        setPaddleDebug({
          status: paddleResult.diagnostics.status,
          detected: Boolean(paddleResult.paddle),
          x: paddleResult.paddle?.normalizedX ?? null,
          y: paddleResult.paddle?.normalizedY ?? null,
          confidence: paddleResult.paddle?.confidence ?? null,
          source: paddleResult.paddle?.source ?? 'None',
          orientation: paddleResult.paddle?.orientation ?? 'not available',
          selectedArm: paddleResult.diagnostics.selectedArm,
          searchRadius: paddleResult.diagnostics.searchRadius,
          colorPixels: paddleResult.diagnostics.colorPixels,
          colorBlobPixels: paddleResult.diagnostics.colorBlobPixels,
        });
        const nextHistory = addMotionFrame(
          motionHistoryRef.current,
          detectedLandmarks,
          nowInMs,
        );
        motionHistoryRef.current = nextHistory;
        setMotionHistory(nextHistory);
        const nextMotionSnapshot = getMotionSnapshot(nextHistory);
        const leftWristVelocity = nextMotionSnapshot.leftWristVelocity ?? 0;
        const rightWristVelocity = nextMotionSnapshot.rightWristVelocity ?? 0;
        const peakWristVelocity = Math.max(
          leftWristVelocity,
          rightWristVelocity,
        );
        const hasVisibleArm =
          nextMotionSnapshot.isLeftArmVisible ||
          nextMotionSnapshot.isRightArmVisible;

        if (!hasVisibleArm) {
          setHeldSwing(null);
          pendingDinkContactRef.current = null;
        } else if (peakWristVelocity >= SWING_VELOCITY_THRESHOLD) {
          setHeldSwing({
            dominantSide:
              leftWristVelocity >= rightWristVelocity ? 'Left' : 'Right',
            peakVelocity: peakWristVelocity,
            expiresAt: nowInMs + SWING_HOLD_MS,
          });
        } else {
          setHeldSwing((currentSwing) =>
            currentSwing && currentSwing.expiresAt > nowInMs
              ? currentSwing
              : null,
          );
        }

        const dinkContactUpdate = getDinkContactUpdate({
          timestamp: nowInMs,
          lastHitAt: lastDinkHitAtRef.current,
          ball: latestBallRef.current,
          paddle: latestPaddleRef.current,
          ballSpeed: getBallMotionSnapshot(ballHistoryRef.current).speed,
          ballVelocity: getLatestBallVelocity(ballHistoryRef.current),
          pendingContact: pendingDinkContactRef.current,
        });
        pendingDinkContactRef.current = dinkContactUpdate.pendingContact;

        if (dinkContactUpdate.hit) {
          recordDinkHit(
            {
              ...dinkContactUpdate.hit,
              side: leftWristVelocity >= rightWristVelocity ? 'Left' : 'Right',
              wristVelocity: peakWristVelocity,
            },
            detectedLandmarks,
          );
        }
        smoothedCoachLandmarksRef.current = smoothLandmarks(
          smoothedCoachLandmarksRef.current,
          detectedLandmarks,
        );

        if (
          nowInMs - lastCoachUpdateTimeRef.current >=
          COACH_UPDATE_INTERVAL_MS
        ) {
          lastCoachUpdateTimeRef.current = nowInMs;
          setCoachLandmarks(smoothedCoachLandmarksRef.current);
        }

        drawPose(results);
      }
    }

    animationFrameRef.current = window.requestAnimationFrame(predictWebcam);
  }, [drawPose, recordDinkHit]);

  useEffect(() => {
    let isMounted = true;

    async function startPoseTracking() {
      try {
        isBallDetectionStoppedRef.current = false;
        ballHistoryRef.current = [];
        motionHistoryRef.current = [];
        dinkHitBatchRef.current = [];
        dinkReviewHistoryRef.current = [];
        lastDinkHitAtRef.current = 0;
        pendingDinkContactRef.current = null;
        poseHitRecorderRef.current.reset();
        lastVoiceReviewRef.current = null;
        setMotionHistory([]);
        setDinkHitBatch([]);
        setLatestDinkReview(null);
        setDinkReviewHistory([]);
        latestBallRef.current = null;
        latestPaddleRef.current = null;
        latestPaddleSearchAreaRef.current = null;
        const video = videoRef.current;
        const canvas = canvasRef.current;

        if (!video || !canvas) {
          return;
        }

        setStatus('Requesting camera access...');
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: 'user',
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });

        if (!isMounted) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        streamRef.current = stream;
        video.srcObject = stream;
        await waitForVideoMetadata(video);
        await video.play();

        runColorBallTracking();
        setBallDebug((currentDebug) => ({
          ...currentDebug,
          status: 'Loading ball detector...',
        }));
        tf.setBackend('webgl')
          .catch(() => tf.setBackend('cpu'))
          .then(() => tf.ready())
          .then(() => cocoSsd.load({ base: 'lite_mobilenet_v2' }))
          .then((detector) => {
            if (!isMounted) {
              detector.dispose();
              return;
            }

            ballDetectorRef.current = detector;
            setBallDebug((currentDebug) => ({
              ...currentDebug,
              status: 'Ready',
              source: currentDebug.source ?? 'None',
            }));
            runBallDetection();
          })
          .catch((detectorError) => {
            console.error(detectorError);
            setBallDebug((currentDebug) => ({
              ...currentDebug,
              status: 'COCO unavailable; color tracker still active',
            }));
          });

        setStatus('Starting pose tracker...');
        const vision = await FilesetResolver.forVisionTasks(WASM_URL);
        const poseLandmarker = await createPoseLandmarker(vision);

        if (!isMounted) {
          poseLandmarker.close();
          return;
        }

        landmarkerRef.current = poseLandmarker;
        drawingUtilsRef.current = new DrawingUtils(canvas.getContext('2d'));
        setStatus('Tracking pose');
        animationFrameRef.current = window.requestAnimationFrame(predictWebcam);
      } catch (err) {
        console.error(err);
        setError(
          err instanceof Error
            ? err.message
            : 'Unable to start camera or pose tracking.',
        );
        setStatus('Setup failed');
      }
    }

    startPoseTracking();

    return () => {
      isMounted = false;
      if (animationFrameRef.current) {
        window.cancelAnimationFrame(animationFrameRef.current);
      }
      isBallDetectionStoppedRef.current = true;
      if (ballDetectionTimeoutRef.current) {
        window.clearTimeout(ballDetectionTimeoutRef.current);
      }
      if (colorBallTrackingTimeoutRef.current) {
        window.clearTimeout(colorBallTrackingTimeoutRef.current);
      }
      streamRef.current?.getTracks().forEach((track) => track.stop());
      landmarkerRef.current?.close();
      ballDetectorRef.current?.dispose();
      voiceAudioRef.current?.pause();
      window.speechSynthesis?.cancel();
      if (voiceAudioUrlRef.current) {
        URL.revokeObjectURL(voiceAudioUrlRef.current);
      }
    };
  }, [predictWebcam, runBallDetection, runColorBallTracking]);

  return (
    <main className="app">
      <section className="stage" aria-label="DinkAI pose tracking preview">
        <div className="stageHeader">
          <h1>DinkAI</h1>
          <span className={error ? 'status statusError' : 'status'}>
            {error || status}
          </span>
        </div>

        <div
          className="videoFrame"
          onPointerDown={handleVideoFramePointerDown}
          onPointerMove={handleVideoFramePointerMove}
          onPointerUp={handleVideoFramePointerUp}
          onPointerCancel={handleVideoFramePointerCancel}
          aria-label="Webcam feed. Click to inspect a pixel, or drag around the selected calibration target."
        >
          <video ref={videoRef} playsInline muted />
          <canvas ref={canvasRef} />
          <canvas ref={colorTrackerCanvasRef} hidden />
          <canvas ref={paddleTrackerCanvasRef} hidden />
          <canvas ref={pixelSamplerCanvasRef} hidden />
          {sampleBox.isDragging && (
            <div
              className="sampleBox"
              style={{
                left: `${Math.min(sampleBox.startX, sampleBox.currentX)}px`,
                top: `${Math.min(sampleBox.startY, sampleBox.currentY)}px`,
                width: `${Math.abs(sampleBox.currentX - sampleBox.startX)}px`,
                height: `${Math.abs(sampleBox.currentY - sampleBox.startY)}px`,
              }}
            />
          )}
        </div>

        <section className="trackingControls" aria-label="Tracking controls">
          <fieldset>
            <legend>Calibration Target</legend>
            <label>
              <input
                type="radio"
                name="calibrationTarget"
                value="ball"
                checked={calibrationTarget === 'ball'}
                onChange={() => setCalibrationTarget('ball')}
              />
              Ball
            </label>
            <label>
              <input
                type="radio"
                name="calibrationTarget"
                value="paddle"
                checked={calibrationTarget === 'paddle'}
                onChange={() => setCalibrationTarget('paddle')}
              />
              Paddle
            </label>
          </fieldset>

          <fieldset>
            <legend>Paddle Holding Arm</legend>
            <label>
              <input
                type="radio"
                name="paddleHoldingArm"
                value="right"
                checked={paddleHoldingArm === 'right'}
                onChange={() => setPaddleHoldingArm('right')}
              />
              My Right
            </label>
            <label>
              <input
                type="radio"
                name="paddleHoldingArm"
                value="left"
                checked={paddleHoldingArm === 'left'}
                onChange={() => setPaddleHoldingArm('left')}
              />
              My Left
            </label>
          </fieldset>
        </section>

        <section className="dinkReviewPanel" aria-labelledby="dink-review-heading">
          <div className="dinkReviewHeader">
            <div>
              <h2 id="dink-review-heading">Four-Hit Dink Review</h2>
              <p>
                Live tracking continues throughout the rally. DinkAI delivers
                a review after every four likely contacts and keeps a running
                session summary across every completed batch.
              </p>
            </div>
            <button type="button" className="secondaryButton" onClick={resetDinkReview}>
              Reset batch
            </button>
          </div>

          <div className="dinkReviewContent">
            <div className="hitProgress" aria-label={`${dinkHitBatch.length} of 4 hits collected`}>
              <span className="scoreLabel">Next review</span>
              <strong>{dinkHitBatch.length} / {HITS_PER_DINK_REVIEW}</strong>
              <div className="hitDots" aria-hidden="true">
                {Array.from({ length: HITS_PER_DINK_REVIEW }, (_, index) => (
                  <span
                    className={index < dinkHitBatch.length ? 'hitDot hitDotActive' : 'hitDot'}
                    key={index}
                  />
                ))}
              </div>
            </div>

            {latestDinkReview ? (
              <div className="dinkReviewResult" aria-live="polite">
                <div className="reviewScore">
                  <span className="scoreLabel">Batch {latestDinkReview.batchNumber} score</span>
                  <strong>{latestDinkReview.score}</strong>
                  <span className="scoreMax">/ 100</span>
                </div>
                <div className="reviewStats">
                  <span>
                    Ready position: {latestDinkReview.averageReadyScore === null
                      ? 'not visible'
                      : `${Math.round(latestDinkReview.averageReadyScore)} / 100`}
                  </span>
                  <span>
                    Contact spacing: {latestDinkReview.averageContactDistance === null
                      ? '-'
                      : latestDinkReview.averageContactDistance.toFixed(3)}
                  </span>
                  <span>
                    Swing consistency: {latestDinkReview.velocityVariation === null
                      ? '-'
                      : `${Math.round((1 - Math.min(1, latestDinkReview.velocityVariation)) * 100)}%`}
                  </span>
                  <span>
                    Session through {sessionDinkReview.hitCount} hits: {sessionDinkReview.averageScore} / 100
                  </span>
                  <span>Session trend: {sessionDinkReview.scoreTrend}</span>
                </div>
                <div className="reviewTips">
                  <h3>How to improve the next four</h3>
                  <ul>
                    {latestDinkReview.tips.map((tip) => (
                      <li key={tip}>{tip}</li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : (
              <p className="dinkReviewEmpty">
                Waiting for four likely contacts. A hit is counted when a fresh
                ball approaches the calibrated paddle and then travels away
                from it.
              </p>
            )}
          </div>
        </section>

        <AverageDinkAvatarPanel composite={sessionComposite} />

        <section className="coachPanel" aria-labelledby="coach-heading">
          <div className="coachHeader">
            <div>
              <h2 id="coach-heading">Ready Position Coach</h2>
              <p>
                Real-time stance feedback based on knee bend, stance width,
                hand position, and balance.
              </p>
            </div>
            <span className="coachBadge">{readyPositionAnalysis.status}</span>
          </div>

          <div className="coachContent">
            <div className="scoreBlock">
              <span className="scoreLabel">Ready Position Score</span>
              <strong>
                {readyPositionAnalysis.score === null
                  ? '--'
                  : readyPositionAnalysis.score}
              </strong>
              <span className="scoreMax">/ 100</span>
            </div>

            <div className="subscoreList" aria-label="Ready position sub-scores">
              {readyPositionAnalysis.subscores.map(({ label, value, max }) => (
                <div className="subscoreRow" key={label}>
                  <span>{label}</span>
                  <strong>{value === null ? `-- / ${max}` : `${value} / ${max}`}</strong>
                </div>
              ))}
            </div>

            <div className="tipsBox">
              <h3>Tips</h3>
              <ul>
                {readyPositionAnalysis.tips.map((tip) => (
                  <li key={tip}>{tip}</li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section className="metricsPanel" aria-labelledby="metrics-heading">
          <div className="panelTitleRow">
            <h2 id="metrics-heading">Derived Metrics</h2>
          </div>

          <div className="tableWrap">
            <table className="metricsTable">
              <thead>
                <tr>
                  <th scope="col">Metric</th>
                  <th scope="col">Value</th>
                  <th scope="col">Why it matters</th>
                </tr>
              </thead>
              <tbody>
                {derivedMetrics.map(({ metric, value, why }) => {
                  const needsFullBody = value === FULL_BODY_MESSAGE;

                  return (
                    <tr
                      key={metric}
                      className={needsFullBody ? 'needsFullBodyRow' : undefined}
                    >
                      <th scope="row">{metric}</th>
                      <td className="metricValue">{value}</td>
                      <td>{why}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section className="actionPanel" aria-labelledby="action-heading">
          <div className="actionHeader">
            <h2 id="action-heading">Action Detection</h2>
            <span
              className={
                actionDetection.currentAction === 'Swing Detected'
                  ? 'actionBadge actionBadgeActive'
                  : 'actionBadge'
              }
            >
              {actionDetection.currentAction}
            </span>
          </div>

          <div className="actionGrid">
            <div className="actionMetric">
              <span>Dominant moving side</span>
              <strong>{actionDetection.dominantSide}</strong>
            </div>
            <div className="actionMetric">
              <span>Peak wrist velocity</span>
              <strong>{formatVelocity(actionDetection.peakWristVelocity)}</strong>
            </div>
            <p className="actionMessage">{actionDetection.message}</p>
          </div>
        </section>

        <section className="voicePanel" aria-labelledby="voice-heading">
          <div className="actionHeader">
            <div>
              <h2 id="voice-heading">Voice Reviews</h2>
              <p>
                DinkAI speaks each completed {HITS_PER_DINK_REVIEW}-hit review with a running session summary.
              </p>
            </div>
            <span className={voiceReviewsEnabled ? 'actionBadge actionBadgeActive' : 'actionBadge'}>
              Voice: {voiceReviewsEnabled ? 'on' : 'off'}
            </span>
          </div>

          <div className="voiceReviewContent">
            <div className="voiceReviewCount">
              <span>Session score</span>
              <strong>{sessionDinkReview?.averageScore ?? '--'}</strong>
              <small>
                {sessionDinkReview
                  ? `${sessionDinkReview.hitCount} hits reviewed · ${sessionDinkReview.scoreTrend}`
                  : `Next review: ${dinkHitBatch.length} / ${HITS_PER_DINK_REVIEW} hits`}
              </small>
            </div>
            <p className="voiceReviewStatus" aria-live="polite">{voiceStatus}</p>
            <div className="voiceReviewActions">
              <button type="button" onClick={handleVoiceToggle}>
                {voiceReviewsEnabled ? 'Pause voice reviews' : 'Enable voice reviews'}
              </button>
              <button type="button" className="secondaryButton" onClick={handleVoiceTest}>
                Test voice
              </button>
            </div>
          </div>
        </section>

        <section className="paddlePanel" aria-labelledby="paddle-heading">
          <div className="actionHeader">
            <h2 id="paddle-heading">Paddle Tracking</h2>
            <span className={paddleDebug.detected ? 'actionBadge actionBadgeActive' : 'actionBadge'}>
              Paddle detected: {paddleDebug.detected ? 'yes' : 'no'}
            </span>
          </div>

          <div className="motionGrid">
            <div className="motionMetric">
              <span>Detection Source</span>
              <strong>{paddleDebug.source}</strong>
            </div>
            <div className="motionMetric">
              <span>x coordinate</span>
              <strong>{formatDebugNumber(paddleDebug.x)}</strong>
            </div>
            <div className="motionMetric">
              <span>y coordinate</span>
              <strong>{formatDebugNumber(paddleDebug.y)}</strong>
            </div>
            <div className="motionMetric">
              <span>confidence</span>
              <strong>{formatDebugNumber(paddleDebug.confidence)}</strong>
            </div>
            <div className="motionMetric">
              <span>orientation</span>
              <strong>{paddleDebug.orientation}</strong>
            </div>
            <div className="motionMetric">
              <span>selected arm</span>
              <strong>{paddleDebug.selectedArm}</strong>
            </div>
            <div className="motionMetric">
              <span>search radius</span>
              <strong>{formatDebugNumber(paddleDebug.searchRadius)}</strong>
            </div>
            <div className="motionMetric">
              <span>color pixels</span>
              <strong>{paddleDebug.colorPixels}</strong>
            </div>
            <div className="motionMetric">
              <span>largest color blob</span>
              <strong>{paddleDebug.colorBlobPixels}</strong>
            </div>
            <div className="motionMetric motionMetricWide">
              <span>tracker status</span>
              <strong>{paddleDebug.status}</strong>
            </div>
          </div>
        </section>

        <section className="ballPanel" aria-labelledby="ball-heading">
          <div className="actionHeader">
            <h2 id="ball-heading">Ball Tracking</h2>
            <span className={ballDebug.detected ? 'actionBadge actionBadgeActive' : 'actionBadge'}>
              Ball detected: {ballDebug.detected ? 'yes' : 'no'}
            </span>
          </div>

          <div className="motionGrid">
            <div className="motionMetric">
              <span>Detection Source</span>
              <strong>{ballDebug.source}</strong>
            </div>
            <div className="motionMetric">
              <span>x coordinate</span>
              <strong>{formatDebugNumber(ballDebug.x)}</strong>
            </div>
            <div className="motionMetric">
              <span>y coordinate</span>
              <strong>{formatDebugNumber(ballDebug.y)}</strong>
            </div>
            <div className="motionMetric">
              <span>confidence</span>
              <strong>{formatDebugNumber(ballDebug.confidence)}</strong>
            </div>
            <div className="motionMetric">
              <span>speed</span>
              <strong>{formatVelocity(ballDebug.speed)}</strong>
            </div>
            <div className="motionMetric">
              <span>direction</span>
              <strong>{ballDebug.direction}</strong>
            </div>
            <div className="motionMetric">
              <span>frames tracked</span>
              <strong>{ballDebug.framesTracked} / {BALL_HISTORY_SIZE}</strong>
            </div>
            <div className="motionMetric">
              <span>approx. size</span>
              <strong>{formatDebugNumber(ballDebug.size)}</strong>
            </div>
            <div className="motionMetric">
              <span>color pixels</span>
              <strong>{ballDebug.colorPixels}</strong>
            </div>
            <div className="motionMetric">
              <span>largest color blob</span>
              <strong>{ballDebug.colorBlobPixels}</strong>
            </div>
            <div className="motionMetric">
              <span>color tracker status</span>
              <strong>{ballDebug.colorTrackerStatus}</strong>
            </div>
            <div className="motionMetric">
              <span>blob hue</span>
              <strong>{formatDebugNumber(ballDebug.colorHue, 1)}</strong>
            </div>
            <div className="motionMetric">
              <span>blob saturation</span>
              <strong>{formatDebugNumber(ballDebug.colorSaturation, 2)}</strong>
            </div>
            <div className="motionMetric">
              <span>inference FPS</span>
              <strong>{formatDebugNumber(ballDebug.fps, 1)}</strong>
            </div>
            <div className="motionMetric motionMetricWide">
              <span>detector status</span>
              <strong>{ballDebug.status}</strong>
            </div>
          </div>
        </section>

        <section className="pixelPanel" aria-labelledby="pixel-heading">
          <div className="actionHeader">
            <div>
              <h2 id="pixel-heading">Calibration</h2>
              <p>
                Select a target, then drag a tight box over the ball or paddle
                face to tune color tracking.
              </p>
            </div>
            <span
              className={
                activeCalibrationProfile.calibrated || pixelSample.isColorMatch
                  ? 'actionBadge actionBadgeActive'
                  : 'actionBadge'
              }
            >
              {activeCalibrationProfile.calibrated
                ? `${activeCalibrationLabel} profile learned`
                : `Color match: ${pixelSample.isColorMatch ? 'yes' : 'no'}`}
            </span>
          </div>

          <div className="motionGrid">
            <div className="motionMetric">
              <span>active target</span>
              <strong>{activeCalibrationLabel}</strong>
            </div>
            <div className="motionMetric">
              <span>profile samples</span>
              <strong>{activeCalibrationProfile.sampleCount}</strong>
            </div>
            <div className="motionMetric">
              <span>profile hue range</span>
              <strong>
                {activeCalibrationProfile.calibrated
                  ? `${formatDebugNumber(activeCalibrationProfile.hueMin, 1)}-${formatDebugNumber(
                      activeCalibrationProfile.hueMax,
                      1,
                    )}`
                  : 'default'}
              </strong>
            </div>
            <div className="motionMetric">
              <span>profile min S/V</span>
              <strong>
                {activeCalibrationProfile.calibrated
                  ? `${formatDebugNumber(
                      activeCalibrationProfile.saturationMin,
                      2,
                    )} / ${formatDebugNumber(activeCalibrationProfile.valueMin, 2)}`
                  : 'default'}
              </strong>
            </div>
            <div className="motionMetric">
              <span>sample x</span>
              <strong>{formatRgbValue(pixelSample.x)}</strong>
            </div>
            <div className="motionMetric">
              <span>sample y</span>
              <strong>{formatRgbValue(pixelSample.y)}</strong>
            </div>
            <div className="motionMetric">
              <span>RGB</span>
              <strong>
                {pixelSample.hasSample
                  ? `${formatRgbValue(pixelSample.red)}, ${formatRgbValue(
                      pixelSample.green,
                    )}, ${formatRgbValue(pixelSample.blue)}`
                  : '-'}
              </strong>
            </div>
            <div className="motionMetric">
              <span>hue</span>
              <strong>{formatDebugNumber(pixelSample.hue, 1)}</strong>
            </div>
            <div className="motionMetric">
              <span>saturation</span>
              <strong>{formatDebugNumber(pixelSample.saturation, 2)}</strong>
            </div>
            <div className="motionMetric">
              <span>value</span>
              <strong>{formatDebugNumber(pixelSample.value, 2)}</strong>
            </div>
          </div>
        </section>

        <section className="motionPanel" aria-labelledby="motion-heading">
          <div className="panelTitleRow">
            <h2 id="motion-heading">Motion Signals</h2>
          </div>

          <div className="motionGrid">
            {motionMetrics.map(({ label, value }) => (
              <div className="motionMetric" key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
        </section>

        <section
          className="debugPanel"
          aria-labelledby="landmark-debug-heading"
        >
          <div className="debugHeader">
            <h2 id="landmark-debug-heading">Landmark Data</h2>
            <p>
              MediaPipe converts the camera feed into numerical body landmarks.
              DinkAI will use these values to calculate posture, stance, and
              movement feedback.
            </p>
            <p className="debugNote">
              This MediaPipe web model provides x, y, and z for each pose
              landmark. Some full-body points may be inferred even when they are
              outside the camera frame.
            </p>
          </div>

          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Body Point</th>
                  <th scope="col">Index</th>
                  <th scope="col">x</th>
                  <th scope="col">y</th>
                  <th scope="col">z</th>
                  <th scope="col">Frame status</th>
                </tr>
              </thead>
              <tbody>
                {DEBUG_LANDMARKS.map(({ index, name }) => {
                  const landmark = latestLandmarks[index];
                  const frameStatus = getLandmarkFrameStatus(landmark);
                  const isOutOfFrame = frameStatus === 'estimated/out of frame';

                  return (
                    <tr
                      key={index}
                      className={isOutOfFrame ? 'outOfFrameRow' : undefined}
                    >
                      <th scope="row">{name}</th>
                      <td>{index}</td>
                      <td>{formatLandmarkValue(landmark?.x)}</td>
                      <td>{formatLandmarkValue(landmark?.y)}</td>
                      <td>{formatLandmarkValue(landmark?.z)}</td>
                      <td>
                        <span
                          className={
                            isOutOfFrame
                              ? 'frameBadge frameBadgeWarning'
                              : 'frameBadge'
                          }
                        >
                          {frameStatus}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </section>
    </main>
  );
}

export default CoachApp;
