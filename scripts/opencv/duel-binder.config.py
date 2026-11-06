# Duel Binder's OpenCV.js: only what src/renderer/src/features/scan/vision, the scan tests and
# scripts/scan call. Mat, MatVector, Rect, Size, Point and Scalar come from core_bindings.cpp.

core = {
    '': ['bitwise_or', 'flip', 'split'],
}

imgproc = {
    '': [
        'approxPolyDP',
        'arcLength',
        'Canny',
        'contourArea',
        'convexHull',
        'dilate',
        'findContours',
        'GaussianBlur',
        'getPerspectiveTransform',
        'HoughLinesP',
        'line',
        'putText',
        'resize',
        'Sobel',
        'warpPerspective',
    ],
}

white_list = makeWhiteList([core, imgproc])
