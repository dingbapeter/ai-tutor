"""
Turns a scanned head (one textured statue, as an image-to-3D tool or a
scanner delivers it) into a Dingba tutor: bones, skin weights and the 52
ARKit face controls, built on the scan's own surface so the likeness and
the texture are untouched.

It runs in three steps, driven by rig-scan.mjs, because a face model in a
browser reads the pictures in between:

  front   render the scan from the front, so the face model can find it
  build   lift the face landmarks onto the surface, shrink the mesh with
          the face kept dense, cut the lips apart, add the inside of the
          mouth, the skeleton and every control, and export the .glb
  judge   render the finished head with each control on, one by one, so
          the face model can say whether it sees what the control claims

No template head and no trained model are involved in the rigging itself:
every control is a displacement worked out from where this face's own
features are. Blender 4.0 or newer; CPU only.
"""
import json
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

# ------------------------------------------------------------------ small tools


def log(msg):
    print(f"rig: {msg}", flush=True)


def args_after_dashes():
    argv = sys.argv
    return argv[argv.index("--") + 1:] if "--" in argv else []


def smooth(t):
    """1 at t = 0, 0 at t >= 1, flat at both ends."""
    if t <= 0:
        return 1.0
    if t >= 1:
        return 0.0
    return (1 - t * t) ** 2


def step(a, b, x):
    """0 below a, 1 above b, smooth between (a may exceed b for a falling edge)."""
    if a == b:
        return 1.0 if x >= a else 0.0
    t = min(1.0, max(0.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


# ------------------------------------------------------------------ scene


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_scan(path):
    ext = os.path.splitext(path)[1].lower()
    if ext in (".glb", ".gltf"):
        bpy.ops.import_scene.gltf(filepath=path)
    elif ext == ".fbx":
        bpy.ops.import_scene.fbx(filepath=path)
    elif ext == ".obj":
        bpy.ops.wm.obj_import(filepath=path)
    else:
        raise SystemExit(f"rig: cannot read {ext} files")
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    if not meshes:
        raise SystemExit("rig: no mesh in that file")
    bpy.ops.object.select_all(action="DESELECT")
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    # Unparent and bake the transform, so world space is mesh space from here on.
    world = obj.matrix_world.copy()
    obj.parent = None
    obj.matrix_world = world
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    for o in list(bpy.data.objects):
        if o is not obj:
            bpy.data.objects.remove(o, do_unlink=True)
    obj.name = "Scan"
    return obj


def bounds(obj):
    xs = [v.co.x for v in obj.data.vertices]
    ys = [v.co.y for v in obj.data.vertices]
    zs = [v.co.z for v in obj.data.vertices]
    return Vector((min(xs), min(ys), min(zs))), Vector((max(xs), max(ys), max(zs)))


def front_camera(obj, width=720, height=960):
    """A camera in front of the face (the scan looks down -Y), framing the head and shoulders."""
    lo, hi = bounds(obj)
    tall = hi.z - lo.z
    target = Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, hi.z - 0.36 * tall))
    cam_data = bpy.data.cameras.new("front")
    cam_data.lens = 85
    cam_data.sensor_fit = "VERTICAL"
    cam = bpy.data.objects.new("front", cam_data)
    bpy.context.scene.collection.objects.link(cam)
    # Far enough that 72% of the scan's height fills the frame.
    need = 0.72 * tall
    dist = (need / 2) / math.tan(cam_data.angle_y / 2) if cam_data.angle_y else 3 * tall
    cam.location = target + Vector((0, -dist, 0))
    cam.rotation_euler = (target - cam.location).to_track_quat("-Z", "Y").to_euler()
    sc = bpy.context.scene
    sc.camera = cam
    sc.render.resolution_x, sc.render.resolution_y = width, height
    sc.render.resolution_percentage = 100
    return cam, {"location": list(cam.location), "target": list(target), "lens": 85, "width": width, "height": height}


def light_and_engine(samples=16):
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.samples = samples
    sc.cycles.device = "CPU"
    sc.cycles.use_denoising = False
    sc.render.image_settings.file_format = "PNG"
    sc.world = bpy.data.worlds.new("w")
    sc.world.use_nodes = True
    bg = sc.world.node_tree.nodes["Background"]
    bg.inputs[0].default_value = (0.9, 0.9, 0.92, 1)
    bg.inputs[1].default_value = 0.75
    lo, hi = bounds(next(o for o in bpy.data.objects if o.type == "MESH"))
    tall = hi.z - lo.z
    for name, (x, y, z), energy in (("key", (0.9, -1.7, 1.15), 150), ("fill", (-1.3, -1.4, 0.8), 60)):
        light = bpy.data.objects.new(name, bpy.data.lights.new(name, "AREA"))
        light.data.energy = energy * tall * tall
        light.data.size = 2.2 * tall
        sc.collection.objects.link(light)
        light.location = Vector((x * tall, y * tall, lo.z + z * tall))
        light.rotation_euler = (Vector((0, 0, lo.z + 0.65 * tall)) - light.location).to_track_quat("-Z", "Y").to_euler()


def render(path):
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


# ------------------------------------------------------------------ step: front


def step_front(a):
    reset()
    obj = import_scan(a["in"])
    tris = sum(len(p.vertices) - 2 for p in obj.data.polygons)
    lo, hi = bounds(obj)
    log(f"scan: {tris:,} triangles, {hi.x - lo.x:.2f} wide by {hi.z - lo.z:.2f} tall")
    _, cam = front_camera(obj)
    light_and_engine(20)
    render(a["png"])
    json.dump({"camera": cam, "triangles": tris}, open(a["state"], "w"))
    log(f"front view written: {a['png']}")


# ------------------------------------------------------------------ the face, in its own frame

# MediaPipe face mesh landmark numbers. "Right" and "left" are the person's own.
LM = {
    "eye_r": 468, "eye_l": 473, "forehead": 10, "chin": 152, "nose_tip": 1, "nose_base": 2,
    "corner_r": 61, "corner_l": 291, "side_r": 234, "side_l": 454, "jaw_r": 172, "jaw_l": 397,
    "cheek_r": 205, "cheek_l": 425, "cheekbone_r": 50, "cheekbone_l": 280, "nostril_r": 129, "nostril_l": 358,
}
LIP_OUT_UP = [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291]
LIP_OUT_LO = [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291]
LIP_IN_UP = [78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308]
LIP_IN_LO = [78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308]
EYE_R_UP = [33, 246, 161, 160, 159, 158, 157, 173, 133]
EYE_R_LO = [33, 7, 163, 144, 145, 153, 154, 155, 133]
EYE_L_UP = [362, 398, 384, 385, 386, 387, 388, 466, 263]
EYE_L_LO = [362, 382, 381, 380, 374, 373, 390, 249, 263]
BROW_R = [70, 63, 105, 66, 107]
BROW_L = [336, 296, 334, 293, 300]


class Face:
    """
    Where this face's features are, in a frame of its own: the origin
    between the eyes, x towards the person's left, y up, z out of the face,
    and one unit the distance between the eyes. Every control is written in
    these units, so the same numbers suit a child's head and an adult's.
    """

    def __init__(self, points):
        self.world = {i: Vector(p) for i, p in enumerate(points) if p is not None}
        need = [LM[k] for k in ("eye_r", "eye_l", "forehead", "chin")]
        missing = [i for i in need if i not in self.world]
        if missing:
            raise SystemExit(f"rig: the face reader could not place landmarks {missing} on the surface")
        er, el = self.world[LM["eye_r"]], self.world[LM["eye_l"]]
        self.origin = (er + el) / 2
        self.iod = (el - er).length
        self.x = (el - er).normalized()
        up = (self.world[LM["forehead"]] - self.world[LM["chin"]]).normalized()
        self.z = self.x.cross(up).normalized()
        self.y = self.z.cross(self.x).normalized()

    def to_face(self, p):
        d = p - self.origin
        return Vector((d.dot(self.x), d.dot(self.y), d.dot(self.z))) / self.iod

    def to_world(self, q):
        return self.origin + (self.x * q.x + self.y * q.y + self.z * q.z) * self.iod

    def dir_world(self, d):
        """A displacement in face units, as a world vector."""
        return (self.x * d.x + self.y * d.y + self.z * d.z) * self.iod

    def at(self, name_or_index):
        i = LM[name_or_index] if isinstance(name_or_index, str) else name_or_index
        return self.to_face(self.world[i]) if i in self.world else None

    def line(self, indexes):
        return [self.at(i) for i in indexes if i in self.world]


def lift_landmarks(obj, cam, landmarks):
    """Each landmark is a point in the picture; a ray through it finds the point on the surface."""
    sc = bpy.context.scene
    bpy.context.view_layer.update()
    frame = [cam.matrix_world @ v for v in cam.data.view_frame(scene=sc)]
    by_x = sorted(frame, key=lambda v: v.x)
    (bl, tl), (br, tr) = sorted(by_x[:2], key=lambda v: v.z), sorted(by_x[2:], key=lambda v: v.z)
    origin = cam.matrix_world.translation
    depsgraph = bpy.context.evaluated_depsgraph_get()
    tree = BVHTree.FromObject(obj, depsgraph)
    out = []
    for u, v, _ in landmarks:
        p = tl + (tr - tl) * u + (bl - tl) * v
        hit, _, _, _ = tree.ray_cast(origin, (p - origin).normalized())
        out.append(list(hit) if hit else None)
    return out


def triangles(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


def face_weight(face, p):
    """1 on the face, falling to 0 around the hairline, the ears and under the chin."""
    q = face.to_face(p)
    chin = face.at("chin")
    top = face.at("forehead")
    # An ellipse from just under the chin to just over the forehead, ear to ear, and nothing behind the ears.
    cy = (chin.y + top.y) / 2
    ry = (top.y - chin.y) / 2 + 0.25
    rx = max(abs(face.at("side_r").x), abs(face.at("side_l").x)) + 0.1
    r = math.sqrt((q.x / rx) ** 2 + ((q.y - cy) / ry) ** 2)
    behind = min(face.at("side_r").z, face.at("side_l").z) - 0.25
    return step(1.15, 0.9, r) * step(behind - 0.3, behind, q.z)


def shrink(obj, face, total, face_share):
    """
    Brings the scan down to `total` triangles with the face kept dense: a
    mouth has to open and an eyelid close, and braids need no such care.
    Done in two passes over one mesh (never split, so no seam can open):
    first everything but the face, then the face.
    """
    import numpy as np

    me = obj.data
    bm = bmesh.new()
    bm.from_mesh(me)
    before = len(bm.verts)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bm.to_mesh(me)
    bm.free()
    me.update()
    log(f"joined loose triangles at their seams: {before:,} to {len(me.vertices):,} vertices")

    def paint(name, value_of):
        g = obj.vertex_groups.get(name) or obj.vertex_groups.new(name=name)
        for v in me.vertices:
            g.add([v.index], value_of(face_weight(face, v.co)), "REPLACE")
        return g

    def face_tris():
        return sum(1 for p in me.polygons if face_weight(face, p.center) > 0.5)

    def decimate(group, ratio):
        mod = obj.modifiers.new("shrink", "DECIMATE")
        mod.ratio = ratio
        mod.use_collapse_triangulate = True
        mod.vertex_group = group
        mod.vertex_group_factor = 1.0
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier="shrink")

    if triangles(obj) <= total:
        log(f"already {triangles(obj):,} triangles, under the {total:,} asked for: left as it is")
        return
    want_face = int(total * face_share)
    want_rest = total - want_face
    start_face = face_tris()
    start_rest = triangles(obj) - start_face
    log(f"before: {start_face:,} triangles on the face, {start_rest:,} elsewhere")
    # The modifier's ratio is of the whole mesh, and its vertex group steers where the
    # cuts fall, not exactly how many: so close in on each target, measuring as we go.
    for group, value_of, want, count in (
        ("rig_rest", lambda w: 1 - w, want_rest, lambda: triangles(obj) - face_tris()),
        ("rig_face", lambda w: w, want_face, face_tris),
    ):
        for _ in range(6):
            have = count()
            if have <= want * 1.06:
                break
            paint(group, value_of)
            all_now = triangles(obj)
            # Remove the surplus of this part, as a share of the whole mesh.
            ratio = max(0.02, min(0.98, (all_now - (have - want)) / all_now))
            decimate(group, ratio)
            log(f"  {group}: {have:,} to {count():,} (wanted {want:,}); whole mesh {triangles(obj):,}")
    for name in ("rig_rest", "rig_face"):
        g = obj.vertex_groups.get(name)
        if g:
            obj.vertex_groups.remove(g)
    log(f"after: {face_tris():,} triangles on the face, {triangles(obj) - face_tris():,} elsewhere, {triangles(obj):,} in all")


# ------------------------------------------------------------------ the mouth: lips cut apart, and something behind them

PART_SKIN, PART_CAVITY, PART_TEETH_UP, PART_TEETH_LOW, PART_TONGUE, PART_CAVITY_LOW = 0, 1, 2, 3, 4, 5


def seam_of(face):
    """The line where the lips meet, as height against x, from the inner lip landmarks."""
    import numpy as np

    pts = []
    for up, lo in zip(LIP_IN_UP, LIP_IN_LO):
        a, b = face.at(up), face.at(lo)
        if a is not None and b is not None:
            pts.append((a + b) / 2)
    pts.sort(key=lambda q: q.x)
    xs = np.array([q.x for q in pts])
    return xs, np.array([q.y for q in pts]), np.array([q.z for q in pts])


def cut_lips(obj, face):
    """
    A scan's mouth is a painted line on one closed surface. To open, the
    lips have to be two edges. The surface is cut along the line where the
    lips meet, from just inside one corner to just inside the other, with
    no gap: at rest the cut is invisible, and it opens only when a control
    moves the lower lip away.
    """
    import numpy as np

    xs, ys, zs = seam_of(face)
    seam = lambda x: float(np.interp(x, xs, ys))
    x0, x1 = xs[0] + 0.03, xs[-1] - 0.03
    lip_z = float(zs.mean())

    me = obj.data
    bm = bmesh.new()
    bm.from_mesh(me)
    side = bm.verts.layers.int.new("rig_side")
    bm.verts.layers.int.new("rig_part")

    def near(q):
        return x0 - 0.15 < q.x < x1 + 0.15 and abs(q.y - seam(q.x)) < 0.3 and q.z > lip_z - 0.45

    faces = [f for f in bm.faces if all(near(face.to_face(v.co)) for v in f.verts)]
    region = {v for f in faces for v in f.verts}
    # Straighten the lip line into a flat plane, cut along the plane, bend it back.
    for v in region:
        v.co -= face.y * (face.iod * seam(face.to_face(v.co).x))
    edges = {e for f in faces for e in f.edges}
    cut = bmesh.ops.bisect_plane(
        bm, geom=list(region) + list(edges) + faces, dist=face.iod * 1e-5, plane_co=face.origin, plane_no=face.y, clear_inner=False, clear_outer=False
    )["geom_cut"]
    new_verts = {g for g in cut if isinstance(g, bmesh.types.BMVert)}
    for v in region | new_verts:
        v.co += face.y * (face.iod * seam(face.to_face(v.co).x))
    slit = [e for e in cut if isinstance(e, bmesh.types.BMEdge) and all(x0 <= face.to_face(v.co).x <= x1 for v in e.verts)]
    if len(slit) < 6:
        bm.free()
        raise SystemExit("rig: the line between the lips could not be found on the surface")
    bmesh.ops.split_edges(bm, edges=slit)
    # Each point on the cut is now two: one belongs to the upper lip, one to the lower.
    rims = 0
    for v in bm.verts:
        if not v.is_boundary:
            continue
        q = face.to_face(v.co)
        if not (x0 - 1e-4 <= q.x <= x1 + 1e-4) or abs(q.y - seam(q.x)) > 2e-3 or q.z < lip_z - 0.45:
            continue
        above = sum(1 if face.to_face(f.calc_center_median()).y > seam(face.to_face(f.calc_center_median()).x) else -1 for f in v.link_faces)
        v[side] = 1 if above > 0 else -1
        rims += 1
    bm.to_mesh(me)
    bm.free()
    me.update()
    log(f"lips cut apart along {len(slit)} edges ({rims} points on the two lip edges)")
    return {"x0": x0, "x1": x1, "lip_z": lip_z}


def flat_material(name, colour, rough=0.5):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*colour, 1)
    bsdf.inputs["Roughness"].default_value = rough
    return m


def add_mouth_inside(obj, face, mouth):
    """
    What shows when the lips part: a dark hollow, two rows of teeth and a
    tongue. Plain shapes in plain colours, sized from this face's own
    mouth. At lesson size they read as a mouth; they are not dentistry.
    """
    import numpy as np

    xs, ys, zs = seam_of(face)
    seam = lambda x: float(np.interp(x, xs, ys))
    half = (mouth["x1"] - mouth["x0"]) / 2
    mid = (mouth["x1"] + mouth["x0"]) / 2
    z_front = mouth["lip_z"]

    me = obj.data
    slots = {}
    for key, name, colour, rough in (
        (PART_CAVITY, "MouthInside", (0.045, 0.012, 0.014), 0.9),
        (PART_TEETH_UP, "Teeth", (0.86, 0.84, 0.78), 0.25),
        (PART_TONGUE, "Tongue", (0.52, 0.2, 0.22), 0.45),
    ):
        me.materials.append(flat_material(name, colour, rough))
        slots[key] = len(me.materials) - 1
    slots[PART_TEETH_LOW] = slots[PART_TEETH_UP]
    slots[PART_CAVITY_LOW] = slots[PART_CAVITY]

    bm = bmesh.new()
    bm.from_mesh(me)
    part = bm.verts.layers.int["rig_part"]

    def sheet(kind, rows, cols, at, flip=False):
        """A grid of points from at(u, v), u and v from 0 to 1, as quads."""
        grid = [[None] * (cols + 1) for _ in range(rows + 1)]
        for r in range(rows + 1):
            for c in range(cols + 1):
                v = bm.verts.new(face.to_world(at(c / cols, r / rows)))
                v[part] = kind
                grid[r][c] = v
        for r in range(rows):
            for c in range(cols):
                quad = [grid[r][c], grid[r][c + 1], grid[r + 1][c + 1], grid[r + 1][c]]
                f = bm.faces.new(quad[::-1] if flip else quad)
                f.material_index = slots[kind]
                f.smooth = True

    # How far back the lips sit at each point across the mouth: the corners are set back from the middle.
    rim = lambda x: float(np.interp(x, xs, zs))

    # The hollow: a small dark pocket just behind the lips, small enough to stay inside the
    # face at rest. Its lower half follows the jaw, so it opens with the mouth like a purse.
    def hollow(u, v):
        theta = math.pi * u  # corner to corner across the back
        phi = math.pi * (v - 0.5)  # bottom to top
        x = mid - 0.97 * half * math.cos(theta) * math.cos(phi)
        return Vector((x, seam(x) + 0.17 * math.sin(phi), rim(x) - 0.075 - 0.5 * math.sin(theta) * math.cos(phi)))

    before = len(bm.verts)
    sheet(PART_CAVITY, 8, 14, hollow, flip=True)
    bm.verts.ensure_lookup_table()
    for v in bm.verts[before:]:
        q = face.to_face(v.co)
        if q.y < seam(q.x) - 0.01:
            v[part] = PART_CAVITY_LOW

    # Teeth: ten to a row, each its own small rounded tile with a sliver of the dark hollow
    # showing between, which is what makes a white band read as teeth.
    def row(kind, depth, top, bottom):
        count = 10
        for k in range(count):
            a0, a1 = k / count + 0.012, (k + 1) / count - 0.012
            def tile(u, v, a0=a0, a1=a1):
                t = a0 + (a1 - a0) * u
                x = mid + (2 * t - 1) * 0.74 * half
                bend = ((2 * t - 1) ** 2) * 0.24
                bulge = 0.012 * math.sin(math.pi * u)
                return Vector((x, seam(x) + top + (bottom - top) * v, rim(mid) - depth - bend + bulge))
            sheet(kind, 2, 2, tile)

    # Upper teeth hang behind the upper lip; lower teeth stand behind the lower lip and move with the jaw.
    row(PART_TEETH_UP, 0.09, 0.14, -0.04)
    row(PART_TEETH_LOW, 0.11, -0.05, -0.2)

    # The tongue: a flattened mound on the floor of the mouth.
    def tongue(u, v):
        theta = math.pi * u
        phi = math.pi * v
        return Vector((
            mid - 0.5 * half * math.cos(theta) * math.sin(phi),
            seam(mid) - 0.13 + 0.045 * math.sin(theta) * math.sin(phi),
            rim(mid) - 0.16 - 0.2 + 0.2 * math.cos(phi),
        ))

    sheet(PART_TONGUE, 8, 10, tongue)
    bm.to_mesh(me)
    bm.free()
    me.update()
    log("inside of the mouth added: hollow, upper and lower teeth, tongue")


# ------------------------------------------------------------------ the skeleton

BONES = ("Hips", "Spine", "Neck", "Head", "LeftEye", "RightEye")
EYE_RADIUS = 0.19  # of the distance between the eyes


def eye_centres(face):
    back = Vector((0, 0, -EYE_RADIUS * 0.9))
    return {"LeftEye": face.at("eye_l") + back, "RightEye": face.at("eye_r") + back}


def add_skeleton(obj, face):
    """
    Six bones, each standing straight up and unrolled, so that in the
    exported file every one of them rests with no rotation of its own: the
    engine turns the head and the eyes by setting their rotation outright.
    """
    lo, hi = bounds(obj)
    chin = face.at("chin")
    pivot = face.to_world(Vector((0, (face.at("jaw_r").y + face.at("jaw_l").y) / 2 + 0.15, min(face.at("side_r").z, face.at("side_l").z) - 0.2)))
    neck = face.to_world(Vector((0, chin.y - 0.8, face.to_face(pivot).z - 0.1)))
    base_z = lo.z
    spine_z = base_z + (neck.z - base_z) * 0.45
    eyes = {k: face.to_world(v) for k, v in eye_centres(face).items()}
    top = hi.z

    arm_data = bpy.data.armatures.new("Skeleton")
    arm = bpy.data.objects.new("Skeleton", arm_data)
    bpy.context.scene.collection.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    up = Vector((0, 0, 1))

    def bone(name, head, length, parent=None):
        b = arm_data.edit_bones.new(name)
        b.head = head
        b.tail = head + up * length
        b.roll = 0
        if parent:
            b.parent = arm_data.edit_bones[parent]
        return b

    centre = Vector((neck.x, neck.y, 0))
    bone("Hips", Vector((centre.x, centre.y, base_z)), spine_z - base_z)
    bone("Spine", Vector((centre.x, centre.y, spine_z)), neck.z - spine_z, "Hips")
    bone("Neck", neck, max(1e-3, pivot.z - neck.z), "Spine")
    bone("Head", pivot, max(1e-3, top - pivot.z), "Neck")
    for name in ("LeftEye", "RightEye"):
        bone(name, eyes[name], face.iod * 0.3, "Head")
    bpy.ops.object.mode_set(mode="OBJECT")
    obj.parent = arm
    mod = obj.modifiers.new("Skeleton", "ARMATURE")
    mod.object = arm
    return arm


# ------------------------------------------------------------------ the controls

ARKIT = [
    "browDownLeft", "browDownRight", "browInnerUp", "browOuterUpLeft", "browOuterUpRight",
    "cheekPuff", "cheekSquintLeft", "cheekSquintRight",
    "eyeBlinkLeft", "eyeBlinkRight", "eyeLookDownLeft", "eyeLookDownRight", "eyeLookInLeft", "eyeLookInRight",
    "eyeLookOutLeft", "eyeLookOutRight", "eyeLookUpLeft", "eyeLookUpRight", "eyeSquintLeft", "eyeSquintRight",
    "eyeWideLeft", "eyeWideRight",
    "jawForward", "jawLeft", "jawOpen", "jawRight",
    "mouthClose", "mouthDimpleLeft", "mouthDimpleRight", "mouthFrownLeft", "mouthFrownRight", "mouthFunnel",
    "mouthLeft", "mouthLowerDownLeft", "mouthLowerDownRight", "mouthPressLeft", "mouthPressRight", "mouthPucker",
    "mouthRight", "mouthRollLower", "mouthRollUpper", "mouthShrugLower", "mouthShrugUpper",
    "mouthSmileLeft", "mouthSmileRight", "mouthStretchLeft", "mouthStretchRight", "mouthUpperUpLeft", "mouthUpperUpRight",
    "noseSneerLeft", "noseSneerRight", "tongueOut",
]


class Fields:
    """
    Everything the controls are made from, worked out once over all the
    vertices at a time: where each vertex is on the face, which lip it
    belongs to, how much it follows the jaw, where it sits in an eye.
    """

    def __init__(self, obj, face, mouth):
        import numpy as np

        self.np = np
        self.face = face
        me = obj.data
        n = len(me.vertices)
        co = np.empty(n * 3)
        me.vertices.foreach_get("co", co)
        self.world = co.reshape(n, 3)
        o = np.array(face.origin)
        axes = np.array([face.x, face.y, face.z])
        self.axes = axes
        self.q = (self.world - o) @ axes.T / face.iod
        self.x, self.y, self.z = self.q[:, 0], self.q[:, 1], self.q[:, 2]
        self.n = n
        part = np.zeros(n, dtype=np.int32)
        side = np.zeros(n, dtype=np.int32)
        me.attributes["rig_part"].data.foreach_get("value", part)
        me.attributes["rig_side"].data.foreach_get("value", side)
        self.part, self.side = part, side
        self.skin = part == PART_SKIN

        pt = lambda name: np.array(face.at(name))
        self.pt = pt
        chin, top = pt("chin"), pt("forehead")
        side_r, side_l = pt("side_r"), pt("side_l")
        # On the face at all: inside the oval, in front of the ears, and skin.
        cy, ry = (chin[1] + top[1]) / 2, (top[1] - chin[1]) / 2 + 0.25
        rx = max(abs(side_r[0]), abs(side_l[0])) + 0.1
        r = np.sqrt((self.x / rx) ** 2 + ((self.y - cy) / ry) ** 2)
        behind = min(side_r[2], side_l[2]) - 0.25
        self.on_face = self.sstep(1.15, 0.9, r) * self.sstep(behind - 0.3, behind, self.z) * self.skin

        # The mouth.
        xs, ys, zs = seam_of(face)
        self.seam = np.interp(self.x, xs, ys)
        self.x0, self.x1 = mouth["x0"], mouth["x1"]
        self.mid = (self.x0 + self.x1) / 2
        self.half = (self.x1 - self.x0) / 2
        self.lip_z = mouth["lip_z"]
        self.mouth_c = np.array([self.mid, float(np.interp(self.mid, xs, ys)), self.lip_z])
        self.corner_r, self.corner_l = pt("corner_r"), pt("corner_l")
        dy = self.y - self.seam
        self.above = ((dy > 0) | (side > 0)) & (side >= 0)
        self.below = ~self.above
        # Across the mouth: 1 between the corners, fading a little way beyond them.
        self.across = self.sstep(self.half + 0.3, self.half, np.abs(self.x - self.mid))
        near_front = self.sstep(self.lip_z - 0.7, self.lip_z - 0.35, self.z)
        self.upper_lip = self.above * self.across * self.bell(dy / 0.42) * near_front * self.skin
        self.lower_lip = self.below * self.across * self.bell(dy / 0.5) * near_front * self.skin
        # The lips proper, the red part, a narrower band than the whole lip area.
        self.upper_red = self.above * self.across * self.bell(dy / 0.2) * near_front * self.skin
        self.lower_red = self.below * self.across * self.bell(dy / 0.24) * near_front * self.skin

        # The jaw: everything under a line from one hinge, through the mouth, to the other.
        hinge_y = (side_r[1] + side_l[1]) / 2 - 0.1
        hinge_z = (side_r[2] + side_l[2]) / 2 - 0.05
        self.hinge = np.array([0.0, hinge_y, hinge_z])
        line_x = np.array([side_r[0], self.x0, self.x1, side_l[0]])
        line_y = np.array([hinge_y, float(np.interp(self.x0, xs, ys)), float(np.interp(self.x1, xs, ys)), hinge_y])
        line = np.interp(self.x, line_x, line_y)
        under = line - self.y
        inside = (self.x > self.x0) & (self.x < self.x1)
        # Between the corners the lips are cut, so the lower lip follows the jaw fully right up
        # to its edge; outside them the cheek has to blend from moving to still.
        soft = self.sstep(-0.05, 0.4, under)
        hard = np.where(self.below, self.sstep(0.0, 0.06, under), 0.0)
        hard = np.where(side < 0, 1.0, hard)
        blend = self.sstep(self.half, self.half - 0.12, np.abs(self.x - self.mid))
        jaw = np.where(inside, blend * hard + (1 - blend) * soft, soft)
        jaw = np.where(self.above & inside, jaw * (1 - blend), jaw)
        # The throat under the chin and everything behind the ears stays still.
        jaw *= self.sstep(chin[1] - 0.75, chin[1] - 0.15, self.y)
        jaw *= self.sstep(behind - 0.2, behind + 0.25, self.z)
        jaw *= self.sstep(rx + 0.25, rx - 0.05, np.abs(self.x))
        self.jaw = np.where(self.skin, jaw, 0.0)
        self.jaw = np.where((part == PART_TEETH_LOW) | (part == PART_TONGUE) | (part == PART_CAVITY_LOW), 1.0, self.jaw)

        # The eyes.
        self.eyes = {}
        centres = eye_centres(face)
        for name, up, lo in (("Right", EYE_R_UP, EYE_R_LO), ("Left", EYE_L_UP, EYE_L_LO)):
            U = sorted(face.line(up), key=lambda p: p.x)
            L = sorted(face.line(lo), key=lambda p: p.x)
            ux, uy, uz = (np.array([getattr(p, k) for p in U]) for k in "xyz")
            lx, ly, lz = (np.array([getattr(p, k) for p in L]) for k in "xyz")
            ex0, ex1 = ux[0], ux[-1]
            Uy, Uz = np.interp(self.x, ux, uy), np.interp(self.x, ux, uz)
            Ly, Lz = np.interp(self.x, lx, ly), np.interp(self.x, lx, lz)
            gap = np.maximum(Uy - Ly, 1e-4)
            h = (self.y - Ly) / gap
            u = (self.x - ex0) / (ex1 - ex0)
            span = (u > 0) & (u < 1)
            ez = (uz.mean() + lz.mean()) / 2
            near = self.sstep(0.45, 0.25, np.abs(self.z - ez)) * self.skin
            full = float((uy - np.interp(ux, lx, ly)).max())
            c = np.array(centres[name + "Eye"])
            # How much a vertex is "the eyeball": 1 in the middle of the opening, 0 at the lids.
            ball = np.where(span, self.sstep(0.0, 0.3, np.minimum(h, 1 - h)) * self.sstep(0.0, 0.12, np.minimum(u, 1 - u)), 0.0) * near
            self.eyes[name] = dict(Uy=Uy, Uz=Uz, Ly=Ly, Lz=Lz, gap=gap, h=h, u=u, span=span, near=near, full=full, centre=c, ball=ball, x0=ex0, x1=ex1)

    # -- shapes of influence

    def sstep(self, a, b, x):
        np = self.np
        t = np.clip((x - a) / (b - a), 0.0, 1.0)
        return t * t * (3 - 2 * t)

    def bell(self, t):
        """1 at 0, falling smoothly to 0 at |t| = 1."""
        np = self.np
        t = np.clip(np.abs(t), 0.0, 1.0)
        return (1 - t * t) ** 2

    def around(self, centre, radius):
        np = self.np
        d = np.linalg.norm(self.q - np.asarray(centre), axis=1)
        return self.bell(d / radius) * self.on_face

    def along(self, points, radius):
        """Nearness to a line through the given points."""
        np = self.np
        best = np.full(self.n, 1e9)
        P = [np.array(p) for p in points]
        for a, b in zip(P[:-1], P[1:]):
            ab = b - a
            t = np.clip(((self.q - a) @ ab) / max(1e-9, ab @ ab), 0.0, 1.0)
            best = np.minimum(best, np.linalg.norm(self.q - (a + t[:, None] * ab), axis=1))
        return self.bell(best / radius) * self.on_face

    def move(self, weight, vec):
        return weight[:, None] * self.np.asarray(vec, dtype=float)[None, :]

    def swing(self, weight, pivot, degrees, axis):
        """Turn the weighted vertices about an axis through a pivot. axis 0 nods (chin down is positive), 1 turns."""
        np = self.np
        a = math.radians(degrees)
        rel = self.q - np.asarray(pivot)
        out = rel.copy()
        c, s = math.cos(a), math.sin(a)
        if axis == 0:
            out[:, 1] = rel[:, 1] * c - rel[:, 2] * s
            out[:, 2] = rel[:, 1] * s + rel[:, 2] * c
        else:
            out[:, 0] = rel[:, 0] * c + rel[:, 2] * s
            out[:, 2] = -rel[:, 0] * s + rel[:, 2] * c
        return (out - rel) * weight[:, None]


JAW_OPEN_DEGREES = 20.0


def controls(F):
    """The 52 controls, each a displacement of every vertex in face units. Left and right are the person's own."""
    np = F.np
    D = {}
    zero = lambda: np.zeros((F.n, 3))
    sides = (("Left", 1.0, F.corner_l), ("Right", -1.0, F.corner_r))
    half_l = F.sstep(-0.12, 0.12, F.x - F.mid)  # 1 on the person's left of the mouth
    halves = {"Left": half_l, "Right": 1 - half_l}

    # ---- jaw
    jaw_open = F.swing(F.jaw, F.hinge, JAW_OPEN_DEGREES, 0)
    D["jawOpen"] = jaw_open
    D["jawForward"] = F.move(F.jaw, (0, 0, 0.08))
    D["jawLeft"] = F.move(F.jaw, (0.07, 0, 0))
    D["jawRight"] = F.move(F.jaw, (-0.07, 0, 0))

    # ---- lips, both sides at once
    # mouthClose brings the lips back together while the jaw stays open (for m, b, p).
    close = -jaw_open * (F.lower_red + 0.6 * (F.lower_lip - F.lower_red).clip(0))[:, None]
    close += F.move(F.upper_red, (0, -0.035, 0))
    D["mouthClose"] = np.where((F.side < 0)[:, None], -jaw_open, close)
    lips = F.upper_lip + F.lower_lip
    inward = -(F.x - F.mid) / max(F.half, 1e-6)  # towards the middle of the mouth
    funnel = zero()
    funnel[:, 0] = inward * 0.22 * F.half * lips
    funnel[:, 2] = 0.1 * lips
    # Rounded and only just parted: the jaw does the opening for an "oh", and both rows of teeth are not on show.
    funnel[:, 1] = 0.018 * F.upper_red - 0.03 * F.lower_red
    D["mouthFunnel"] = funnel
    pucker = zero()
    pucker[:, 0] = inward * 0.42 * F.half * lips
    pucker[:, 2] = 0.13 * lips
    # A pucker is a closed mouth: the lips stay together.
    D["mouthPucker"] = pucker
    # The teeth and the hollow behind the lips travel with the mouth, or they would show through a cheek.
    inside = (~F.skin).astype(float)
    whole = np.maximum(F.around(F.mouth_c, 0.95), inside)
    D["mouthLeft"] = F.move(whole, (0.1, 0, -0.01))
    D["mouthRight"] = F.move(whole, (-0.1, 0, -0.01))
    D["mouthRollLower"] = F.move(F.lower_red, (0, 0.035, -0.06))
    D["mouthRollUpper"] = F.move(F.upper_red, (0, -0.03, -0.055))
    chin_c = F.pt("chin") + np.array([0, 0.25, 0])
    D["mouthShrugLower"] = F.move(F.lower_lip, (0, 0.06, 0.035)) + F.move(F.around(chin_c, 0.5), (0, 0.04, 0.02))
    # The lower lip rides up with the upper one: a shrug is not an open mouth.
    D["mouthShrugUpper"] = F.move(F.upper_lip, (0, 0.035, 0.025)) + F.move(F.lower_red, (0, 0.035, 0.012))

    # ---- lips and cheeks, one side at a time
    for name, sx, corner in sides:
        half = halves[name]
        at_corner = F.around(corner, 0.6)
        cheek = F.around(F.pt("cheek_l" if name == "Left" else "cheek_r"), 0.75)
        cheekbone = F.around(F.pt("cheekbone_l" if name == "Left" else "cheekbone_r"), 0.6)
        D[f"mouthSmile{name}"] = F.move(at_corner, (sx * 0.13, 0.12, -0.05)) + F.move(cheek, (sx * 0.02, 0.05, 0.03))
        D[f"mouthFrown{name}"] = F.move(at_corner, (sx * 0.03, -0.11, -0.02))
        D[f"mouthDimple{name}"] = F.move(F.around(corner, 0.4), (sx * 0.06, 0.01, -0.06))
        D[f"mouthStretch{name}"] = F.move(at_corner, (sx * 0.13, -0.04, -0.045))
        D[f"mouthPress{name}"] = F.move(F.upper_red * half, (0, -0.02, -0.012)) + F.move(F.lower_red * half, (0, 0.02, -0.012))
        D[f"mouthLowerDown{name}"] = F.move(F.lower_lip * half, (0, -0.085, 0.01))
        D[f"mouthUpperUp{name}"] = F.move(F.upper_lip * half, (0, 0.07, 0.01))
        D[f"cheekSquint{name}"] = F.move(cheekbone, (0, 0.05, 0.015))
        nostril = F.pt("nostril_l" if name == "Left" else "nostril_r")
        above_red = (F.upper_lip - F.upper_red).clip(0)
        D[f"noseSneer{name}"] = F.move(F.around(nostril, 0.35), (0, 0.055, 0.005)) + F.move(above_red * half, (0, 0.025, 0))
    puff = zero()
    for name, sx, _ in sides:
        c = F.around(F.pt("cheek_l" if name == "Left" else "cheek_r"), 0.8)
        puff += F.move(c, (sx * 0.07, 0, 0.06))
    D["cheekPuff"] = puff

    # ---- brows
    brow = {"Left": F.face.line(BROW_L), "Right": F.face.line(BROW_R)}
    inner = {"Left": min(brow["Left"], key=lambda p: abs(p.x)), "Right": min(brow["Right"], key=lambda p: abs(p.x))}
    outer = {"Left": max(brow["Left"], key=lambda p: abs(p.x)), "Right": max(brow["Right"], key=lambda p: abs(p.x))}
    up_in = zero()
    for name, sx, _ in sides:
        line = F.along(brow[name], 0.34)
        D[f"browDown{name}"] = F.move(line, (-sx * 0.025, -0.1, 0.008))
        D[f"browOuterUp{name}"] = F.move(F.around(outer[name], 0.42), (0, 0.075, 0))
        up_in += F.move(F.around(inner[name], 0.42), (0, 0.085, 0))
    D["browInnerUp"] = up_in

    # ---- eyes
    KEEP = 0.06  # how much of the opening is left when the eye is shut
    for name, sx, _ in sides:
        e = F.eyes[name]
        h, gap, span, near = e["h"], e["gap"], e["span"], e["near"]
        between = span & (h >= 0) & (h <= 1)
        lid = span & (h > 1)
        under = span & (h < 0)
        reach = np.clip(e["full"] * 2.2 / gap, 1.5, 12.0)  # the brow, counted in eye openings above the lid
        # Shut: everything in the opening gathers on the lower lid; the upper lid's skin stretches down over it.
        blink = zero()
        ty = e["Ly"] + KEEP * h * gap
        tz = e["Lz"] + (e["Uz"] - e["Lz"]) * KEEP * h + 0.012 * 4 * h * (1 - h)
        blink[:, 1] = np.where(between, ty - F.y, 0.0)
        blink[:, 2] = np.where(between, tz - F.z, 0.0)
        fall = F.bell(((h - 1) / reach).clip(0, 1))
        blink[:, 1] += np.where(lid, -(1 - KEEP) * gap * fall, 0.0)
        blink[:, 2] += np.where(lid, (e["Lz"] - e["Uz"]) * (1 - KEEP) * fall, 0.0)
        blink *= near[:, None]
        D[f"eyeBlink{name}"] = blink
        # Squint: the lower lid comes up a third of the way, the upper lid a little down.
        squint = zero()
        low = np.where(span, F.bell(((h - 0.1) / 1.6).clip(-1, 1)) * (h < 0.6), 0.0)
        squint[:, 1] = 0.3 * gap * low - 0.12 * gap * np.where(span & (h > 0.6), F.bell(((h - 1) / reach).clip(-1, 1)), 0.0)
        D[f"eyeSquint{name}"] = squint * near[:, None]
        # Wide: the upper lid lifts.
        wide = zero()
        wide[:, 1] = 0.3 * gap * np.where(span & (h > 0.55), F.bell(((h - 1) / (reach * 0.8)).clip(-1, 1)), 0.0)
        wide[:, 1] -= 0.08 * gap * np.where(span & (h < 0.3), F.bell((h / 1.2).clip(-1, 1)), 0.0)
        D[f"eyeWide{name}"] = wide * near[:, None]
        # Looking: the eye itself is turned by its bone (the painted eye is weighted to it and
        # slides round the eyeball). These controls are the lids' share: they follow the gaze.
        lids_follow = np.where(span & (h > 0.6), F.bell(((h - 1) / (reach * 0.6)).clip(-1, 1)), 0.0) * near
        rims = np.where(span, F.bell((h - 0.5) / 1.4), 0.0) * near
        D[f"eyeLookUp{name}"] = F.move(lids_follow, (0, 0.04, 0))
        D[f"eyeLookDown{name}"] = D[f"eyeBlink{name}"] * 0.28
        towards_nose = -sx
        D[f"eyeLookIn{name}"] = F.move(rims, (0.012 * towards_nose, 0, 0))
        D[f"eyeLookOut{name}"] = F.move(rims, (-0.012 * towards_nose, 0, 0))

    # ---- tongue
    tongue = (F.part == PART_TONGUE).astype(float)
    tip = F.sstep(F.lip_z - 0.4, F.lip_z - 0.13, F.z) * tongue
    D["tongueOut"] = F.move(tip, (0, -0.02, 0.3)) + F.move(tongue, (0, 0.02, 0.06))

    missing = [n for n in ARKIT if n not in D]
    assert not missing, missing
    return D


def weights_for(F, face):
    """How much of each vertex follows each bone."""
    np = F.np
    chin = F.pt("chin")
    head = F.sstep(chin[1] - 0.8, chin[1] - 0.05, F.y)
    # The inside of the mouth is all head.
    head = np.where(F.skin, head, 1.0)
    neck = (1 - head) * F.sstep(chin[1] - 1.6, chin[1] - 0.8, F.y)
    spine = 1 - head - neck
    out = {"Spine": spine, "Neck": neck}
    eye_total = np.zeros(F.n)
    for name in ("Left", "Right"):
        w = F.eyes[name]["ball"] * head
        out[f"{name}Eye"] = w
        eye_total += w
    out["Head"] = head - eye_total
    return out


def relax_for(rest_smile):
    """
    How much of a smile to take out of the resting face. A scan made from
    a smiling portrait has the smile sculpted in, and a tutor who cannot
    stop smiling cannot look concerned. The face reader's own smile score
    for the scan decides: nothing under 0.25, about half of a broad smile.
    """
    if rest_smile is None:
        return 0.0
    return max(0.0, min(0.6, (rest_smile - 0.25) / 0.9))


def rig(obj, face, rest_smile=None):
    import numpy as np

    for p in obj.data.polygons:
        p.use_smooth = True
    mouth = cut_lips(obj, face)
    add_mouth_inside(obj, face, mouth)
    arm = add_skeleton(obj, face)
    F = Fields(obj, face, mouth)

    for name in BONES:
        obj.vertex_groups.new(name=name)
    for name, w in weights_for(F, face).items():
        g = obj.vertex_groups[name]
        for i in np.nonzero(w > 1e-4)[0]:
            g.add([int(i)], float(w[i]), "REPLACE")

    D = controls(F)
    to_world = F.axes * face.iod  # rows are the face axes, in world units
    relax = relax_for(rest_smile)
    rest = F.world
    if relax > 0:
        rest = F.world - relax * ((D["mouthSmileLeft"] + D["mouthSmileRight"]) @ to_world)
        obj.data.vertices.foreach_set("co", rest.ravel())
        obj.data.update()
        log(f"the scan was smiling (the face reader scored it {rest_smile:.2f}); {relax:.2f} of a smile taken out of the resting face")
    obj.shape_key_add(name="Basis", from_mix=False)
    moved = {}
    for name in ARKIT:
        d_world = D[name] @ to_world
        key = obj.shape_key_add(name=name, from_mix=False)
        key.data.foreach_set("co", (rest + d_world).ravel())
        key.value = 0
        moved[name] = int((np.linalg.norm(D[name], axis=1) > 1e-4).sum())
    quiet = [n for n, c in moved.items() if c == 0]
    if quiet:
        raise SystemExit(f"rig: these controls move nothing: {quiet}")
    log(f"52 controls built; the smallest moves {min(moved.values())} vertices ({min(moved, key=moved.get)}), the largest {max(moved.values())}")
    obj.name = "Body"
    obj.data.name = "Body"
    obj["rig_origin"] = list(face.origin)
    obj["rig_iod"] = face.iod
    return arm


def export_glb(path, jpeg=True):
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        export_yup=True,
        export_apply=False,
        export_animations=False,
        export_skins=True,
        export_morph=True,
        export_morph_normal=False,
        export_morph_tangent=False,
        export_materials="EXPORT",
        export_image_format="JPEG" if jpeg else "AUTO",
        export_jpeg_quality=88,
        export_extras=True,
        use_selection=True,
    )
    log(f"wrote {path} ({os.path.getsize(path) / (1024 * 1024):.2f} MB)")


# ------------------------------------------------------------------ step: build


def step_build(a):
    reset()
    obj = import_scan(a["in"])
    rest_smile = None
    if a.get("points"):
        # Landmarks already on the surface, as a test or another tool supplies them.
        given = json.load(open(a["points"]))
        points = given["points"]
        rest_smile = given.get("rest_smile")
    else:
        cam, _ = front_camera(obj)
        first = next(iter(json.load(open(a["landmarks"])).values()))
        if not first.get("landmarks"):
            raise SystemExit("rig: no face was found in the front view of this scan")
        points = lift_landmarks(obj, cam, first["landmarks"])
        rest_smile = (first["shapes"]["mouthSmileLeft"] + first["shapes"]["mouthSmileRight"]) / 2
    log(f"landmarks: {sum(1 for p in points if p)} of {len(points)} placed on the surface")
    face = Face(points)
    log(f"distance between the eyes: {face.iod:.4f} (the unit every control is written in)")
    shrink(obj, face, int(a.get("triangles", 52000)), float(a.get("face-share", 0.45)))
    if a.get("work"):
        # The slow part is done; keeping it lets the rigging be re-run in seconds.
        json.dump({"points": points, "rest_smile": rest_smile}, open(a["work"] + ".json", "w"))
        bpy.ops.wm.save_as_mainfile(filepath=a["work"])
        log(f"saved {a['work']}")
    finish(obj, face, a, rest_smile)


def finish(obj, face, a, rest_smile):
    for o in list(bpy.data.objects):
        if o.type in ("CAMERA", "LIGHT"):
            bpy.data.objects.remove(o, do_unlink=True)
    if a.get("rest-smile") not in (None, ""):
        rest_smile = float(a["rest-smile"])
    rig(obj, face, rest_smile)
    export_glb(a["out"])
    bpy.ops.wm.save_as_mainfile(filepath=a["out"].rsplit(".", 1)[0] + ".rigged.blend")


def step_rig(a):
    """The rigging alone, from a scan already shrunk and saved by an earlier build."""
    bpy.ops.wm.open_mainfile(filepath=a["work"])
    obj = bpy.data.objects["Scan"]
    saved = json.load(open(a["work"] + ".json"))
    finish(obj, Face(saved["points"]), a, saved.get("rest_smile"))


# ------------------------------------------------------------------ step: judge


def step_judge(a):
    """
    Renders the rigged head at rest and with each control fully on, from
    the front, for the face reader to score and for a person to look at.
    `--only a,b,c` renders just those; `--mix name=0.6,other=1` adds one
    picture of several controls together.
    """
    bpy.ops.wm.open_mainfile(filepath=a["blend"])
    obj = bpy.data.objects["Body"]
    cam, _ = front_camera(obj, int(a.get("width", 480)), int(a.get("height", 640)))
    if a.get("close"):
        # Closer in, on the face alone, for a person judging the mouth and eyes.
        origin, iod = Vector(obj["rig_origin"]), obj["rig_iod"]
        target = origin - Vector((0, 0, 0.55 * iod))
        dist = (4.6 * iod / 2) / math.tan(cam.data.angle_y / 2)
        cam.location = target + Vector((float(a.get("turn", 0)) * dist, -dist, 0)).normalized() * dist
        cam.rotation_euler = (target - cam.location).to_track_quat("-Z", "Y").to_euler()
    light_and_engine(int(a.get("samples", 12)))
    keys = obj.data.shape_keys.key_blocks
    out = a["dir"]
    os.makedirs(out, exist_ok=True)
    names = a["only"].split(",") if a.get("only") else ARKIT
    for k in keys:
        k.slider_min = -1.0
        k.value = 0
    if not a.get("only") or "rest" in names:
        render(os.path.join(out, "rest.png"))
    for name in names:
        if name == "rest":
            continue
        keys[name].value = 1
        render(os.path.join(out, f"{name}.png"))
        keys[name].value = 0
    for i, mix in enumerate(filter(None, a.get("mix", "").split(";"))):
        for pair in mix.split(","):
            k, v = pair.split("=")
            keys[k].value = float(v)
        render(os.path.join(out, f"mix{i}.png"))
        for k in keys:
            k.value = 0
    log(f"rendered into {out}")


if __name__ == "__main__":
    raw = args_after_dashes()
    a = {raw[i].lstrip("-"): raw[i + 1] for i in range(0, len(raw) - 1, 2)}
    which = a.get("step")
    if which == "front":
        step_front(a)
    elif which == "build":
        step_build(a)
    elif which == "rig":
        step_rig(a)
    elif which == "judge":
        step_judge(a)
    else:
        raise SystemExit("rig: --step front | build | judge")
