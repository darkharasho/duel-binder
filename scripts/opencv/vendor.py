"""Copies the trimmed opencv.js into the repo, with the UMD wrapper returning the module object."""
import sys
src, dst = sys.argv[1], sys.argv[2]
s = open(src).read()
old = """  if (typeof Module === 'undefined')
    Module = {};
  return cv(Module);"""
new = """  // Duel Binder: Emscripten 4's factory returns a promise; hand back the module object itself
  // (its exports and onRuntimeInitialized land on it), as the packaged OpenCV.js did.
  var Module = {};
  cv(Module);
  return Module;"""
assert s.count(old) == 1, 'wrapper tail not found'
s = s.replace(old, new)
header = "/* OpenCV.js 4.12.0, core + imgproc only. Built by scripts/opencv/build.sh; see scripts/opencv/README.md. */\n"
open(dst, 'w').write(header + s)
print(len(s))
