/**
 * Geometry helpers for normalized MediaPipe landmarks.
 * Values outside the [0, 1] camera frame are deliberately rejected so the
 * coaching UI does not score inferred off-camera joints as observed data.
 */
export function isUsableLandmark(point) {
  return (
    Boolean(point) &&
    Number.isFinite(point.x) &&
    Number.isFinite(point.y) &&
    point.x >= 0 &&
    point.x <= 1 &&
    point.y >= 0 &&
    point.y <= 1
  );
}

export function areLandmarksUsable(points) {
  return points.every(isUsableLandmark);
}

export function areFrameLandmarksUsable(landmarks, indexes) {
  return indexes.every((index) => isUsableLandmark(landmarks[index]));
}

export function getDistance(pointA, pointB) {
  if (!areLandmarksUsable([pointA, pointB])) {
    return null;
  }

  return Math.hypot(pointA.x - pointB.x, pointA.y - pointB.y);
}

export function getMidpoint(pointA, pointB) {
  if (!areLandmarksUsable([pointA, pointB])) {
    return null;
  }

  return {
    x: (pointA.x + pointB.x) / 2,
    y: (pointA.y + pointB.y) / 2,
    z:
      Number.isFinite(pointA.z) && Number.isFinite(pointB.z)
        ? (pointA.z + pointB.z) / 2
        : 0,
  };
}

export function getAngle(pointA, pointB, pointC) {
  if (!areLandmarksUsable([pointA, pointB, pointC])) {
    return null;
  }

  const vectorA = { x: pointA.x - pointB.x, y: pointA.y - pointB.y };
  const vectorC = { x: pointC.x - pointB.x, y: pointC.y - pointB.y };
  const magnitudeA = Math.hypot(vectorA.x, vectorA.y);
  const magnitudeC = Math.hypot(vectorC.x, vectorC.y);

  if (magnitudeA === 0 || magnitudeC === 0) {
    return null;
  }

  const cosine =
    (vectorA.x * vectorC.x + vectorA.y * vectorC.y) /
    (magnitudeA * magnitudeC);

  return (Math.acos(Math.max(-1, Math.min(1, cosine))) * 180) / Math.PI;
}

export function getTiltAngle(leftPoint, rightPoint) {
  if (!areLandmarksUsable([leftPoint, rightPoint])) {
    return null;
  }

  const deltaX = rightPoint.x - leftPoint.x;
  const deltaY = rightPoint.y - leftPoint.y;

  if (deltaX === 0) {
    return 90;
  }

  const absoluteAngle = Math.abs((Math.atan2(deltaY, deltaX) * 180) / Math.PI);
  return absoluteAngle > 90 ? 180 - absoluteAngle : absoluteAngle;
}
