#!/bin/bash
# Builds vendor/opencv/opencv.js: OpenCV.js 4.12.0 with only core + imgproc and the functions in
# duel-binder.config.py, in the emsdk 4.0.20 container. Usage (from the repo root):
#
#   bash scripts/opencv/build.sh            # needs podman (or docker: CONTAINER=docker)
#
# It downloads the OpenCV source into $WORK (default ~/opencv-js-build), builds there, and copies
# the result into vendor/opencv/opencv.js with the module wrapper patched (see vendor.py).
set -euo pipefail
REPO=$(pwd)
WORK=${WORK:-$HOME/opencv-js-build}
CONTAINER=${CONTAINER:-podman}
mkdir -p "$WORK"
if [ ! -d "$WORK/opencv-4.12.0" ]; then
  curl -sL https://github.com/opencv/opencv/archive/refs/tags/4.12.0.tar.gz | tar -xz -C "$WORK"
  # Emscripten 4 removed this link setting; OpenCV 4.12 still passes it.
  sed -i 's/ -s DEMANGLE_SUPPORT=1//' "$WORK/opencv-4.12.0/modules/js/CMakeLists.txt"
fi
cp "$REPO/scripts/opencv/duel-binder.config.py" "$WORK/"
"$CONTAINER" run --rm --userns=keep-id -v "$WORK:/src:Z" docker.io/emscripten/emsdk:4.0.20 \
  emcmake python3 /src/opencv-4.12.0/platforms/js/build_js.py /src/build_js \
  --config /src/duel-binder.config.py \
  --cmake_option=-DCMAKE_CXX_STANDARD=17 \
  --cmake_option=-DBUILD_opencv_calib3d=OFF \
  --cmake_option=-DBUILD_opencv_dnn=OFF \
  --cmake_option=-DBUILD_opencv_features2d=OFF \
  --cmake_option=-DBUILD_opencv_flann=OFF \
  --cmake_option=-DBUILD_opencv_photo=OFF \
  --cmake_option=-DBUILD_opencv_objdetect=OFF \
  --cmake_option=-DBUILD_opencv_video=OFF \
  --cmake_option=-DBUILD_TESTS=OFF \
  --cmake_option=-DBUILD_PERF_TESTS=OFF \
  --cmake_option=-DBUILD_EXAMPLES=OFF \
  --build_flags="-s EXPORTED_RUNTIME_METHODS=['HEAPU8']"
python3 "$REPO/scripts/opencv/vendor.py" "$WORK/build_js/bin/opencv.js" "$REPO/vendor/opencv/opencv.js"
ls -la "$REPO/vendor/opencv/opencv.js"
