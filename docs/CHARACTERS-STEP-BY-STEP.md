# Making a human-like tutor, step by step

For a new computer and a first-time artist. Nothing here needs a
programmer. Follow it top to bottom.

## What you are making

One file per tutor, called `amara.glb` (or `kofi.glb`, and so on). It is
a 3D head and shoulders with 52 small controls on the face that the
website moves to make the tutor talk, smile, blink and look at the
learner. The website checks the file for you and shows the tutor alive
before anyone else sees it.

## The computer

MetaHuman needs a real graphics card. Before installing anything, check:

- Windows 10 or 11, 64-bit (a Mac works for Blender and the Studio but
  not for MetaHuman in Unreal).
- A graphics card from the last few years: NVIDIA RTX 2070 or better, or
  the AMD equivalent.
- 32 GB of memory. 16 GB will struggle.
- 150 GB of free disk space. Unreal Engine alone is about 50 GB.

## Install, in this order (about two hours, mostly downloading)

1. **Epic Games Launcher**, free, from epicgames.com. Make an Epic account
   if you do not have one.
2. In the launcher, **Unreal Engine** tab → Library → the plus sign →
   install the newest 5.x version. Default options are fine.
3. Still in the launcher, go to **Fab** (Epic's store) and add the free
   **MetaHuman** plugin to your library, then install it to the engine
   version you just installed. Newer engines carry MetaHuman Creator
   inside the engine, so if you cannot find it in Fab, it is already
   there: open Unreal, Edit → Plugins, search "MetaHuman", tick it.
4. **Blender**, free, from blender.org. Version 4.0 or newer. Default
   install.
5. Nothing else. The check and the preview run in your web browser.

## Make the character (Unreal Engine)

1. Open Unreal Engine, make a new project (Games → Blank), call it
   `DingbaTutors`.
2. Open MetaHuman Creator from the top toolbar (the MetaHuman icon) or
   from Window → MetaHuman.
3. Build the face to match the portrait of the tutor you are making. The
   13 portraits are in the handoff pack. Work from the front view first,
   then the side. Skin, eyes, hair, teeth: all in Creator.
4. Save the MetaHuman into the project.

## Get the file out of Unreal

The website needs the face's 52 controls as "morph targets" (also called
blend shapes). MetaHuman does not export them by default, so one extra
step is needed. Two free ways, pick one:

- **Holotype's MetaHuman to glTF plugin** on Fab: installs into the
  engine, adds an "Export" button on the MetaHuman, writes a `.glb` with
  the 52 controls already named the right way. This is the easiest.
- **BlendShapeExporterV2** (free on GitHub): bakes the 52 controls into
  the MetaHuman's face, after which you export the face as `.fbx` with
  File → Export (or right-click the face mesh → Asset Actions → Export).

Either way you now have a file: a `.glb`, or a `.fbx`. Menu names move
between versions; if a label here is not exactly what you see, the
nearest one is the right one, and the Studio in the next step will tell
you if anything important is missing.

## Tidy the file (Blender, one command)

A raw export carries things the website does not want: several copies
of the head at lower detail, the whole body, huge textures, and names
the website does not recognise. One command fixes all of it.

1. Put the exported file and a copy of this repository's `tools/avatar`
   folder on the computer. The folder is small; download the repository
   as a zip from GitHub (green "Code" button → Download ZIP) and unzip it.
2. Open a command window in the unzipped folder (in Windows Explorer,
   type `cmd` in the address bar and press Enter).
3. Type this, with your own file name:

```
blender -b -P tools/avatar/prepare-character.py -- --in amara.fbx --out amara.glb
```

If Windows says it cannot find `blender`, use the full path, usually
`"C:\Program Files\Blender Foundation\Blender 4.2\blender.exe"` in place
of `blender`.

It prints what it did: levels of detail dropped, centimetres turned into
metres, the body cut to a bust, bones and controls renamed, textures
shrunk. If the export was already a tidy `.glb` from the Holotype plugin,
you can skip this step and go straight to the Studio.

## Check it and see it alive (the Studio)

1. Open **dingba.ai/studio** in Chrome, Edge or Safari.
2. Drag `amara.glb` onto the page. Nothing is uploaded; the check runs in
   the browser.
3. Read the list. Green ticks are fine. Red lines say exactly what to fix,
   in plain words ("sliders that move nothing: mouthPucker" means that
   control is named but does nothing in Unreal: rebuild it). The
   "work in progress" switch lets you look at a half-finished character.
4. Press **Say it** to hear a stand-in voice and watch the mouth move on
   the words. Try each mood. Press **Walk through every slider** and watch
   each of the 52 controls move on its own; one that pulls the wrong part
   of the face is caught here.
5. When the heading says **Ready**, press **Copy report** and send the
   report and the file to whoever puts it live.

## Put it live

Send the finished `amara.glb` here, in this chat, and I will install it.
Or, on a computer with the repository and Node 22 or newer:

```
node tools/avatar/install-character.ts amara amara.glb
```

It checks the file again, copies it into the website, names it on Amara,
and says what to commit. Deploy the web and API services, and every
lesson with Amara shows her from then on. The other twelve tutors follow
the same path, one file each.

## If something goes wrong

- Unreal will not open or crashes: the graphics card or memory is below
  the list at the top. Blender and the Studio still work on that machine;
  only the MetaHuman step needs the bigger computer.
- The Studio says "not a glTF binary": the export was saved as `.gltf`
  with separate files, or as `.fbx`. Run the Blender command, which
  writes a `.glb`.
- "essential sliders missing": the export did not include the 52
  controls. Go back to the "Get the file out" step and use one of the two
  tools there.
- The character is drawn but looks grey: textures were not embedded. The
  Blender command packs them in.
- Anything else: paste the Studio report into this chat.
