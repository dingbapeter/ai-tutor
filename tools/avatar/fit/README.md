# Fitting a rigged head to a scan (groundwork)

A scan or an image-to-3D export is a statue: one mesh, no face sliders, no
bones. The route to a tutor that speaks is to fit a template head that
already carries the 52 sliders onto the scan, carry the scan's skin across,
and keep the hair as a solid piece on the head bone. These are the pieces
that need nothing but the scan, written against the first real one and run
by hand. The template fitting itself waits on the template (ICT-FaceKit,
MIT) being in the repo.

Order, after `prepare-character.py` has brought the scan under budget:

1. `blender -b --python tools/avatar/fit/split-parts.py -- in.glb parts.glb`
   splits the one mesh into Head, Hair and Clothes by the base-colour
   texture (dark, unsaturated faces are hair above a height line and
   clothes below) with two passes of neighbour smoothing. Braids hanging
   below the line are still labelled clothes; a connectivity pass is the
   next improvement.
2. Render the front view with the camera in `lift-landmarks.py` (85 mm,
   600 by 800, at (0, -2.1, 0.5) looking at (0, 0, 0.5)), then
   `node tools/avatar/fit/find-landmarks.mjs <dir>` finds the 478 face
   landmarks on `<dir>/front.png` (and quarter, side) with the same
   on-device face model the app ships, against a running local site, and
   writes `<dir>/landmarks.json`. The model's own expression scores come
   with it, which is how a baked-in smile is confirmed (0.72 on the first
   scan).
3. `blender -b --python tools/avatar/fit/lift-landmarks.py -- parts.glb landmarks.json landmarks3d.json`
   casts a ray through each landmark from that camera onto the Head mesh
   and writes the 3D points (474 of 478 hit on the first scan), plus two
   check renders with the points as dots.

What the template step will do with these: solve the template's identity
and expression weights against the 3D landmarks, drop the expression so
the head comes out neutral, wrap the template to the scan surface for the
fine shape, bake the scan's base colour onto the template's UV layout,
parent the Hair piece under Head, and export through the tidy tool.
