"""
A stand-in for what Unreal hands over, built from the licence-free test
head, so the preparation script can be proven without a real MetaHuman:

  - bones named the MetaHuman way (pelvis, spine_01, spine_03, neck_01,
    head, FACIAL_L_Eye, FACIAL_R_Eye);
  - two lower levels of detail that must be dropped;
  - a body mesh reaching to the floor that must be cut to a bust;
  - a 4096 px texture that must be shrunk;
  - sliders with the Unreal prefix and casing (CTRL_expressions_JawOpen);
  - the whole thing in centimetres.

  blender -b -P tools/avatar/make-fake-export.py -- --out fake-unreal.fbx
"""

import argparse
import os
import sys

import bpy


def args_after_dashes():
    argv = sys.argv
    return argv[argv.index("--") + 1:] if "--" in argv else []


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--head", default=os.path.join(os.path.dirname(__file__), "..", "..", "apps", "web", "test", "fixtures", "test-head.glb"))
    p.add_argument("--out", required=True)
    a = p.parse_args(args_after_dashes())

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.abspath(a.head))

    face = next(o for o in bpy.data.objects if o.type == "MESH" and o.data.shape_keys)
    face.name = "m_med_nrw_head_LOD0"
    # The eye balls, named as a tool would, beside the eye bones below.
    for o in bpy.data.objects:
        if o.type == "MESH" and o.name in ("LeftEye", "RightEye"):
            o.name = "eyeLeft" if o.name == "LeftEye" else "eyeRight"

    # Sliders named the Unreal way.
    for kb in face.data.shape_keys.key_blocks[1:]:
        kb.name = "CTRL_expressions_" + kb.name[0].upper() + kb.name[1:]

    # An armature named the MetaHuman way, with the face and body skinned to it.
    arm_data = bpy.data.armatures.new("root")
    arm = bpy.data.objects.new("root", arm_data)
    bpy.context.scene.collection.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    chain = [("pelvis", 0.0, 0.1), ("spine_01", 0.1, 0.3), ("spine_03", 0.3, 0.6), ("neck_01", 0.6, 0.75), ("head", 0.75, 1.0)]
    prev = None
    for name, z0, z1 in chain:
        b = arm_data.edit_bones.new(name)
        b.head = (0, 0, z0)
        b.tail = (0, 0, z1)
        if prev:
            b.parent = prev
        prev = b
    for name, x in (("FACIAL_L_Eye", -0.03), ("FACIAL_R_Eye", 0.03)):
        e = arm_data.edit_bones.new(name)
        e.head = (x, -0.05, 0.9)
        e.tail = (x, -0.08, 0.9)
        e.parent = prev
    bpy.ops.object.mode_set(mode="OBJECT")

    # The head sits on top of the neck; eye pivots that came with the glb go.
    for o in list(bpy.data.objects):
        if o.type == "EMPTY" or (o.type == "ARMATURE" and o is not arm):
            bpy.data.objects.remove(o, do_unlink=True)
    face.parent = arm
    face.location = (0, 0, 0.88)
    face.scale = (0.12, 0.12, 0.12)
    mod = face.modifiers.new("skin", "ARMATURE")
    mod.object = arm
    vg = face.vertex_groups.new(name="head")
    vg.add(range(len(face.data.vertices)), 1.0, "REPLACE")

    # A body down to the floor, skinned to the spine.
    bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=0.18, depth=0.8, location=(0, 0, 0.4))
    body = bpy.context.active_object
    body.name = "m_med_nrw_body_LOD0"
    body.parent = arm
    bm = body.modifiers.new("skin", "ARMATURE")
    bm.object = arm
    bg = body.vertex_groups.new(name="spine_01")
    bg.add(range(len(body.data.vertices)), 1.0, "REPLACE")

    # Lower levels of detail, which a real export carries along.
    for lod in (1, 2):
        for src in (face, body):
            dup = src.copy()
            dup.data = src.data.copy()
            dup.name = src.name.replace("LOD0", f"LOD{lod}")
            bpy.context.scene.collection.objects.link(dup)

    # An oversize texture on the face.
    img = bpy.data.images.new("head_albedo", 4096, 4096)
    img.generated_color = (0.8, 0.6, 0.5, 1)
    # On disk, so the FBX can carry it the way a real export does.
    img.filepath_raw = os.path.join(os.path.dirname(os.path.abspath(a.out)), "head_albedo.png")
    img.file_format = "PNG"
    img.save()
    mat = bpy.data.materials.new("head_mat")
    mat.use_nodes = True
    tex = mat.node_tree.nodes.new("ShaderNodeTexImage")
    tex.image = img
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    mat.node_tree.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    face.data.materials.clear()
    face.data.materials.append(mat)

    # Centimetres, as Unreal works in.
    arm.scale = (100, 100, 100)

    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.fbx(filepath=os.path.abspath(a.out), use_selection=True, add_leaf_bones=False, bake_anim=False, path_mode="COPY", embed_textures=True)
    print(f"fake export written: {a.out}")


if __name__ == "__main__":
    main()
