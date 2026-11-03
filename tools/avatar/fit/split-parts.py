"""Split a one-piece scanned bust into head, hair and clothes by texture colour and height."""
import bpy, bmesh, sys, os, math
src, out = sys.argv[-2], sys.argv[-1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
obj = next(o for o in bpy.data.objects if o.type == "MESH")
mesh = obj.data
mat = mesh.materials[0]
tex = next(n for n in mat.node_tree.nodes if n.type == "TEX_IMAGE" and "basecolor" in (n.image.name if n.image else ""))
img = tex.image
W, H = img.size
px = list(img.pixels)  # RGBA floats, bottom-up rows
uv = mesh.uv_layers.active.data
zs = [v.co.z for v in mesh.vertices]
zmin, zmax = min(zs), max(zs)
print("META height", round(zmin,3), round(zmax,3))

def sample(u, v):
    x = min(W-1, max(0, int(u * W))); y = min(H-1, max(0, int(v * H)))
    i = 4 * (y * W + x); return px[i], px[i+1], px[i+2]

labels = []
for poly in mesh.polygons:
    us = vs = 0.0
    for li in poly.loop_indices:
        us += uv[li].uv.x; vs += uv[li].uv.y
    n = len(poly.loop_indices); r, g, b = sample(us/n, vs/n)
    lum = 0.299*r + 0.587*g + 0.114*b
    sat = (max(r,g,b) - min(r,g,b)) / (max(r,g,b) + 1e-6)
    z = sum(mesh.vertices[v].co.z for v in poly.vertices) / len(poly.vertices)
    dark = lum < 0.22 and sat < 0.35
    labels.append("hair" if dark and z > zmin + 0.55*(zmax-zmin) else ("clothes" if dark else "head"))
counts = {k: labels.count(k) for k in ("head","hair","clothes")}
print("META faces", counts)
# Smooth the labels: a face takes the majority of its neighbours (two passes).
bm = bmesh.new(); bm.from_mesh(mesh); bm.faces.ensure_lookup_table()
for _ in range(2):
    new = labels[:]
    for f in bm.faces:
        nb = [labels[g.index] for e in f.edges for g in e.link_faces if g is not f]
        if nb:
            best = max(set(nb), key=nb.count)
            if nb.count(best) > len(nb) * 0.6: new[f.index] = best
    labels = new
bm.free()
counts = {k: labels.count(k) for k in ("head","hair","clothes")}
print("META faces_smoothed", counts)
# Assign one material slot per part, then separate by material.
for name in ("hair", "clothes"):
    m = mat.copy(); m.name = f"{mat.name}_{name}"; mesh.materials.append(m)
slot = {"head": 0, "hair": 1, "clothes": 2}
for poly, lab in zip(mesh.polygons, labels): poly.material_index = slot[lab]
bpy.context.view_layer.objects.active = obj; obj.select_set(True)
bpy.ops.object.mode_set(mode="EDIT"); bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.mesh.separate(type="MATERIAL"); bpy.ops.object.mode_set(mode="OBJECT")
for o in bpy.data.objects:
    if o.type != "MESH": continue
    mi = o.data.polygons[0].material_index if o.data.polygons else 0
    name = {0: "Head", 1: "Hair", 2: "Clothes"}.get(o.data.materials[mi].name.split("_")[-1] == "hair" and 1 or (o.data.materials[mi].name.split("_")[-1] == "clothes" and 2 or 0))
    o.name = name; o.data.name = name
    print("META part", name, sum(len(p.vertices)-2 for p in o.data.polygons), "triangles")
bpy.ops.object.select_all(action="SELECT")
bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", export_image_format="JPEG", export_jpeg_quality=85)
