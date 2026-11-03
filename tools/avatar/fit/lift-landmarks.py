"""Lift the 2D landmarks found on the front render onto the 3D scan by ray casting through the same camera."""
import bpy, json, sys, os, math, mathutils
src, lm_path, out = sys.argv[-3], sys.argv[-2], sys.argv[-1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
head = bpy.data.objects["Head"]
sc = bpy.context.scene
sc.render.resolution_x, sc.render.resolution_y = 600, 800
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("c")); sc.collection.objects.link(cam); sc.camera = cam; cam.data.lens = 85
cam.location = (0, -2.1, 0.5); d = mathutils.Vector((0, 0, 0.5)) - cam.location; cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
bpy.context.view_layer.update()
from bpy_extras.object_utils import world_to_camera_view
lm = json.load(open(lm_path))["front"]
# Camera frame in world space for ray directions.
frame = [cam.matrix_world @ v for v in cam.data.view_frame(scene=sc)]
origin = cam.matrix_world.translation
tl, tr, br, bl = frame[3], frame[0], frame[1], frame[2]  # view_frame order: right-top, right-bottom, left-bottom, left-top
# Sort by position to be safe.
xs = sorted(frame, key=lambda v: v.x); 
left = sorted(xs[:2], key=lambda v: v.z); right = sorted(xs[2:], key=lambda v: v.z)
bl, tl = left; br, tr = right
pts = []; miss = 0
inv = head.matrix_world.inverted()
for (u, v, _) in lm["points"]:
    p = tl + (tr - tl) * u + (bl - tl) * v
    direction = (p - origin).normalized()
    ok, loc, nrm, idx = head.ray_cast(inv @ origin, (inv.to_3x3() @ direction).normalized())
    if ok: pts.append([round(c, 5) for c in (head.matrix_world @ loc)])
    else: pts.append(None); miss += 1
print("META landmarks3d", len(pts) - miss, "hit,", miss, "missed")
json.dump({"points": pts, "camera": {"lens": 85, "location": [0, -2.1, 0.5], "look_at": [0, 0, 0.5], "resolution": [600, 800]}}, open(out, "w"))
# A check render: small spheres on the lifted points.
mat = bpy.data.materials.new("dot"); mat.use_nodes = True; mat.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.1, 0.8, 0.2, 1)
for o in bpy.data.objects:
    if o.type == "MESH" and o.name != "Head": o.hide_render = True
for p in pts:
    if p is None: continue
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=0.0025, location=p)
    bpy.context.active_object.data.materials.append(mat)
sc.render.engine = "CYCLES"; sc.cycles.samples = 16; sc.cycles.device = "CPU"; sc.cycles.use_denoising = False
sc.world = bpy.data.worlds.new("w"); sc.world.use_nodes = True; sc.world.node_tree.nodes["Background"].inputs[0].default_value = (0.92, 0.92, 0.95, 1)
light = bpy.data.objects.new("key", bpy.data.lights.new("k", "AREA")); light.data.energy = 400; light.data.size = 2; sc.collection.objects.link(light); light.location = (1.2, -1.5, 1.6); light.rotation_euler = (math.radians(60), 0, math.radians(35))
for name, (x, y) in {"front": (0, -2.1), "quarter": (1.3, -1.65)}.items():
    cam.location = (x, y, 0.5); d = mathutils.Vector((0, 0, 0.5)) - cam.location; cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    sc.render.filepath = os.path.join(os.path.dirname(out), f"landmarks-{name}.png"); bpy.ops.render.render(write_still=True)
