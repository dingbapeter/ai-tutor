"""
Makes a stand-in for a scanned head, so the rigger can be proven with no
real face and no face model: one closed, textured, egg-shaped statue on a
pair of shoulders, and a file saying where its features would be.

  blender -b -P tools/avatar/rig/make-test-scan.py -- --out scan.glb --points points.json

The points use the same landmark numbers the face reader gives, placed on
the surface by dropping a ray from in front, exactly as the rigger places
real ones. It is nobody's face; it has a face's proportions.
"""
import json
import math
import sys

import bmesh
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
arg = {argv[i].lstrip("-"): argv[i + 1] for i in range(0, len(argv) - 1, 2)}

IOD = 0.064  # metres between the eyes
EYES_Z = 0.42  # height of the eye line

bpy.ops.wm.read_factory_settings(use_empty=True)
bm = bmesh.new()
bmesh.ops.create_uvsphere(bm, u_segments=220, v_segments=140, radius=1.0, calc_uvs=True)
for v in bm.verts:
    v.co = Vector((v.co.x * 0.094, v.co.y * 0.105, EYES_Z - 0.3 * IOD + v.co.z * 0.128))
# Shoulders: a wide flattened drum under the head, part of the same statue.
drum = bmesh.ops.create_cone(bm, cap_ends=True, segments=64, radius1=0.2, radius2=0.07, depth=0.26, calc_uvs=True)
for v in drum["verts"]:
    v.co = Vector((v.co.x, v.co.y * 0.55, v.co.z + 0.16))
bmesh.ops.triangulate(bm, faces=bm.faces)
mesh = bpy.data.meshes.new("Scan")
bm.to_mesh(mesh)
bm.free()
obj = bpy.data.objects.new("Scan", mesh)
bpy.context.scene.collection.objects.link(obj)

# A texture, packed, as a scan has.
img = bpy.data.images.new("skin", 256, 256)
img.generated_color = (0.72, 0.5, 0.4, 1)
img.pack()
mat = bpy.data.materials.new("skin")
mat.use_nodes = True
tex = mat.node_tree.nodes.new("ShaderNodeTexImage")
tex.image = img
mat.node_tree.links.new(tex.outputs["Color"], mat.node_tree.nodes["Principled BSDF"].inputs["Base Color"])
mesh.materials.append(mat)

# Where the features are, in units of the distance between the eyes: x to the person's left, y up from the eye line.
P = {
    468: (-0.5, 0.0), 473: (0.5, 0.0), 10: (0.0, 1.3), 152: (0.0, -1.9), 1: (0.0, -0.55), 2: (0.0, -0.72),
    61: (-0.42, -1.15), 291: (0.42, -1.15), 234: (-1.15, -0.2), 454: (1.15, -0.2), 172: (-0.95, -1.3), 397: (0.95, -1.3),
    205: (-0.65, -0.75), 425: (0.65, -0.75), 50: (-0.78, -0.35), 280: (0.78, -0.35), 129: (-0.3, -0.66), 358: (0.3, -0.66),
}


def arc(indexes, x0, x1, y_ends, y_mid):
    for k, i in enumerate(indexes):
        t = k / (len(indexes) - 1)
        P[i] = (x0 + (x1 - x0) * t, y_ends + (y_mid - y_ends) * math.sin(math.pi * t))


arc([61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291], -0.42, 0.42, -1.15, -1.03)  # outer upper lip
arc([61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291], -0.42, 0.42, -1.15, -1.31)  # outer lower lip
arc([78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308], -0.38, 0.38, -1.15, -1.145)  # inner upper lip
arc([78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308], -0.38, 0.38, -1.15, -1.155)  # inner lower lip
arc([33, 246, 161, 160, 159, 158, 157, 173, 133], -0.76, -0.24, 0.0, 0.1)  # right eye, upper lid
arc([33, 7, 163, 144, 145, 153, 154, 155, 133], -0.76, -0.24, 0.0, -0.07)  # right eye, lower lid
arc([362, 398, 384, 385, 386, 387, 388, 466, 263], 0.24, 0.76, 0.0, 0.1)  # left eye, upper lid
arc([362, 382, 381, 380, 374, 373, 390, 249, 263], 0.24, 0.76, 0.0, -0.07)  # left eye, lower lid
arc([70, 63, 105, 66, 107], -0.85, -0.2, 0.33, 0.42)  # right brow
arc([336, 296, 334, 293, 300], 0.2, 0.85, 0.33, 0.42)  # left brow

bpy.context.view_layer.update()
tree = BVHTree.FromObject(obj, bpy.context.evaluated_depsgraph_get())
points = [None] * 478
for i, (x, y) in P.items():
    hit, _, _, _ = tree.ray_cast(Vector((x * IOD, -2.0, EYES_Z + y * IOD)), Vector((0, 1, 0)))
    if hit is None:
        raise SystemExit(f"test scan: landmark {i} missed the surface")
    points[i] = list(hit)

json.dump({"points": points, "rest_smile": 0.0}, open(arg["points"], "w"))
bpy.ops.object.select_all(action="SELECT")
bpy.ops.export_scene.gltf(filepath=arg["out"], export_format="GLB", export_image_format="JPEG")
print(f"test scan: {len(mesh.polygons):,} triangles, {sum(1 for p in points if p)} landmarks placed")
