"""
Turn a raw character export into a Dingba tutor file.

What comes out of Unreal (a MetaHuman) or any DCC is close to the contract
but never exactly it: several levels of detail, a whole body, bones named
the tool's way, 8K textures, centimetres, and face sliders named with a
prefix. This script takes that and writes one .glb that passes
tools/avatar/validate-glb.ts, with no hand work in between:

  blender -b -P tools/avatar/prepare-character.py -- --in face.fbx --out amara.glb
      [--cut-at spine_03] [--texture-max 2048] [--jpeg] [--no-cut]

What it does, in order:
  1. imports FBX, glTF or OBJ;
  2. drops every level of detail but the highest (LOD0 or unsuffixed);
  3. brings centimetres to metres if the figure is taller than three metres;
  4. cuts the body to a bust below the named bone (default spine_03), so
     only meshes without face sliders are cut; the face is never touched;
  5. renames bones to the contract (Hips, Spine, Neck, Head, LeftEye,
     RightEye), from MetaHuman, Mixamo and common Blender names;
  6. renames face sliders to the exact ARKit names, whatever prefix or
     casing the tool used, and viseme sliders to viseme_xx;
  7. zeroes every slider and clears the pose, so the file is neutral;
  8. shrinks textures above the limit and packs them into the file;
  9. exports one .glb, +Y up, with morph targets, skin and materials.

Blender 4.0 or newer. Nothing else to install.
"""

import argparse
import math
import os
import re
import sys

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

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
VISEMES = ["sil", "PP", "FF", "TH", "DD", "kk", "CH", "SS", "nn", "RR", "aa", "E", "ih", "oh", "ou"]

# The contract's bone names, and what the common tools call them.
BONES = {
    "Hips": ["hips", "pelvis", "mixamorig:hips", "root", "hip"],
    "Spine": ["spine", "spine_01", "spine1", "mixamorig:spine", "spine01"],
    "Neck": ["neck", "neck_01", "neck1", "mixamorig:neck", "neck01"],
    "Head": ["head", "mixamorig:head", "head_01"],
    "LeftEye": ["lefteye", "facial_l_eye", "eye_l", "l_eye", "eyeleft", "mixamorig:lefteye", "eye.l", "leye", "eyel"],
    "RightEye": ["righteye", "facial_r_eye", "eye_r", "r_eye", "eyeright", "mixamorig:righteye", "eye.r", "reye", "eyer"],
}


def log(msg):
    print(f"prepare: {msg}")


def norm(name):
    return re.sub(r"[._\-:\s]", "", name.lower())


def args_after_dashes():
    argv = sys.argv
    return argv[argv.index("--") + 1:] if "--" in argv else []


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_file(path):
    ext = os.path.splitext(path)[1].lower()
    if ext == ".fbx":
        bpy.ops.import_scene.fbx(filepath=path, use_anim=False, ignore_leaf_bones=True, automatic_bone_orientation=False)
    elif ext in (".glb", ".gltf"):
        bpy.ops.import_scene.gltf(filepath=path)
    elif ext == ".obj":
        bpy.ops.wm.obj_import(filepath=path)
    else:
        raise SystemExit(f"prepare: cannot import {ext} files (FBX, glTF or OBJ)")


def meshes():
    return [o for o in bpy.data.objects if o.type == "MESH"]


def armatures():
    return [o for o in bpy.data.objects if o.type == "ARMATURE"]


def has_sliders(obj):
    return bool(obj.data.shape_keys and len(obj.data.shape_keys.key_blocks) > 1)


def drop_lower_lods():
    dropped = []
    for o in list(bpy.data.objects):
        m = re.search(r"lod[_\s]?(\d+)", o.name, re.I)
        if m and int(m.group(1)) > 0:
            dropped.append(o.name)
            bpy.data.objects.remove(o, do_unlink=True)
    if dropped:
        log(f"dropped {len(dropped)} lower level-of-detail object(s): {', '.join(dropped[:6])}{'…' if len(dropped) > 6 else ''}")


def apply_transforms():
    bpy.ops.object.select_all(action="DESELECT")
    for o in bpy.data.objects:
        if o.type in ("MESH", "ARMATURE", "EMPTY"):
            # Two eyes often share one mesh; a shared mesh cannot take a
            # transform, so each object gets its own copy first.
            if o.type == "MESH" and o.data.users > 1:
                o.data = o.data.copy()
            o.select_set(True)
    if bpy.context.selected_objects:
        bpy.context.view_layer.objects.active = bpy.context.selected_objects[0]
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    bpy.ops.object.select_all(action="DESELECT")


def figure_height():
    zs = []
    for o in meshes():
        for v in o.bound_box:
            zs.append((o.matrix_world @ Vector(v)).z)
    return (max(zs) - min(zs)) if zs else 0.0


def to_metres():
    h = figure_height()
    if h > 3.0:
        log(f"figure is {h:.0f} units tall: treating as centimetres, scaling to metres")
        for o in bpy.data.objects:
            if o.parent is None:
                o.scale = o.scale * 0.01
        apply_transforms()
    else:
        log(f"figure is {h:.2f} metres tall")


def bone_world_z(name):
    want = norm(name)
    for arm in armatures():
        for b in arm.data.bones:
            if norm(b.name) == want:
                return (arm.matrix_world @ b.head_local).z
    return None


def cut_to_bust(bone_name):
    z = bone_world_z(bone_name)
    if z is None:
        log(f"no bone named {bone_name}: the body is left whole (use --cut-at to name the chest bone, or --no-cut)")
        return
    cut = 0
    for o in meshes():
        if has_sliders(o):
            continue  # the face is never cut
        lo = min((o.matrix_world @ Vector(v)).z for v in o.bound_box)
        if lo >= z:
            continue
        bpy.ops.object.select_all(action="DESELECT")
        o.select_set(True)
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        local_z = (o.matrix_world.inverted() @ Vector((0, 0, z))).z
        bpy.ops.mesh.bisect(plane_co=(0, 0, local_z), plane_no=(0, 0, 1), clear_inner=True, use_fill=False)
        bpy.ops.object.mode_set(mode="OBJECT")
        cut += 1
    log(f"cut {cut} body mesh(es) to a bust below {bone_name}")


def rename_bones():
    renamed = []
    for arm in armatures():
        for want, aliases in BONES.items():
            if any(b.name == want for b in arm.data.bones):
                continue
            for b in arm.data.bones:
                if norm(b.name) in [norm(a) for a in aliases]:
                    renamed.append(f"{b.name} → {want}")
                    b.name = want
                    break
    bone_names = {b.name for arm in armatures() for b in arm.data.bones}
    for o in bpy.data.objects:
        if o.type not in ("EMPTY", "MESH"):
            continue
        for want, aliases in BONES.items():
            if o.name == want and want in bone_names:
                # A mesh and a bone with the same name would be two nodes
                # called Head; the bone is the one that moves, so the mesh
                # steps aside.
                renamed.append(f"{o.name} (mesh) → {want}Mesh")
                o.name = f"{want}Mesh"
            elif o.name != want and norm(o.name) in [norm(a) for a in aliases] and want not in bone_names and not any(x.name == want for x in bpy.data.objects):
                # Empties and plain objects used as eye pivots, when there is no armature.
                renamed.append(f"{o.name} → {want}")
                o.name = want
    if renamed:
        log(f"renamed bones: {', '.join(renamed)}")


def arkit_name(raw):
    """The exact ARKit or viseme name a slider means, or None."""
    n = norm(raw)
    for want in ARKIT:
        w = norm(want)
        if n == w or n.endswith(w) and len(n) - len(w) <= 24:
            return want
    for v in VISEMES:
        for form in (f"viseme_{v}", f"v_{v}", v):
            if n == norm(form) or n.endswith(norm(f"viseme{v}")):
                return f"viseme_{v}"
    return None


def rename_sliders():
    total, renamed, unknown = 0, 0, []
    for o in meshes():
        if not has_sliders(o):
            continue
        taken = set()
        for kb in o.data.shape_keys.key_blocks[1:]:
            total += 1
            want = arkit_name(kb.name)
            if want and want not in taken:
                if kb.name != want:
                    renamed += 1
                kb.name = want
                taken.add(want)
            elif not want:
                unknown.append(kb.name)
    log(f"sliders: {total} found, {renamed} renamed to the exact ARKit name, {len(unknown)} unknown{': ' + ', '.join(unknown[:8]) if unknown else ''}")


def neutralise():
    for o in meshes():
        if has_sliders(o):
            for kb in o.data.shape_keys.key_blocks:
                kb.value = 0.0
    for arm in armatures():
        for pb in arm.pose.bones:
            pb.matrix_basis.identity()


def shrink_textures(limit):
    shrunk = 0
    for img in bpy.data.images:
        if img.users == 0 or img.size[0] == 0:
            continue
        w, h = img.size
        if max(w, h) > limit:
            s = limit / max(w, h)
            img.scale(max(1, int(w * s)), max(1, int(h * s)))
            shrunk += 1
        try:
            img.pack()
        except RuntimeError:
            pass
    log(f"textures: {shrunk} shrunk to {limit} px or under, all packed into the file")


def export(path, jpeg):
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
        export_jpeg_quality=85,
        export_extras=True,
        use_selection=True,
    )
    mb = os.path.getsize(path) / (1024 * 1024)
    log(f"wrote {path} ({mb:.2f} MB)")


def main():
    p = argparse.ArgumentParser(prog="prepare-character.py")
    p.add_argument("--in", dest="src", required=True, help="FBX, glTF or OBJ from Unreal, Blender or any DCC")
    p.add_argument("--out", dest="dst", required=True, help="the .glb to write")
    p.add_argument("--cut-at", default="spine_03", help="bone below which the body is removed (default spine_03)")
    p.add_argument("--no-cut", action="store_true", help="keep the whole body")
    p.add_argument("--texture-max", type=int, default=2048)
    p.add_argument("--jpeg", action="store_true", help="store textures as JPEG (smaller; no transparency)")
    a = p.parse_args(args_after_dashes())

    reset_scene()
    import_file(os.path.abspath(a.src))
    log(f"imported {a.src}: {len(meshes())} mesh(es), {len(armatures())} armature(s)")
    drop_lower_lods()
    apply_transforms()
    to_metres()
    rename_bones()
    if not a.no_cut:
        cut_to_bust(a.cut_at)
    rename_sliders()
    neutralise()
    shrink_textures(a.texture_max)
    export(os.path.abspath(a.dst), a.jpeg)
    log("done; now check it: node tools/avatar/validate-glb.ts " + a.dst)


if __name__ == "__main__":
    main()
