# Making the human-like tutors, step by step

For a brand-new computer and a first-time artist. One action per step.
Nothing to type.

## Before you start

If you do not have a computer that meets the line below, do not buy one
or rent one for this: pay an artist per character instead. The job post
to paste is docs/ARTIST-BRIEF.md, and acceptance is Parts E and F of this
guide, which run on any laptop.

Your computer needs a proper graphics card, 32 GB of memory and 150 GB
of free space. If it is a normal office laptop, do steps 1 to 10 on a
gaming or design computer and the rest on any machine.

## Part A: set up the computer (two hours, mostly waiting for downloads)

1. Go to **epicgames.com**, download the **Epic Games Launcher**, and open an
   account with your email.
2. Open the launcher. Click **Unreal Engine** on the left, then **Library**,
   then the **+** next to "Engine versions", then **Install**. Pick the
   newest version it offers. This is about 50 GB; leave it downloading.
3. In the launcher, click **Fab**. Search **MetaHuman**. Click **Add to
   library**, then **Install to Engine**. (If Fab does not show it, skip this;
   newer engines already include it.)
4. Go to **blender.org**, click **Download**, install Blender with the default
   choices.
5. Go to **github.com/dingbapeter/ai-tutor**, click the green **Code**
   button, then **Download ZIP**. Unzip it somewhere easy, like your
   Desktop. You will use one folder inside it: `tools` → `avatar`.

## Part B: make the face (Unreal Engine)

6. Open Unreal Engine from the launcher. Choose **Games** → **Blank** →
   name it `DingbaTutors` → **Create**.
7. If MetaHuman is not already on: **Edit** → **Plugins** → search
   "MetaHuman" → tick it → restart when asked.
8. Click the **MetaHuman** button in the top toolbar (or **Window** →
   **MetaHuman**). This opens MetaHuman Creator.
9. Build the face to match one of the 13 tutor portraits from the handoff
   pack. Front view first, then the side. Choose skin, eyes, hair and
   teeth here. Save it as the tutor's name, for example `Amara`.

## Part C: get the file out of Unreal

10. The website needs the face's 52 expression controls, which MetaHuman
    does not export on its own. In the launcher, go to **Fab**, search
    **MetaHuman to glTF** (by Holotype), **Add to library**, **Install to
    Engine**, restart Unreal. Then right-click your MetaHuman in the
    Content Browser and choose the **Export glTF** option it added. Save
    the file as `amara.glb` on your Desktop.

    If that plugin is not available, the fallback is a free tool called
    **BlendShapeExporterV2** on GitHub; its page has its own instructions,
    and it ends with you exporting the face as `amara.fbx`.

## Part D: tidy the file (one drag)

11. Open the unzipped folder from step 5 and go into `tools` → `avatar`.
12. Drag your `amara.glb` (or `amara.fbx`) onto the file called
    **Tidy character** (`.bat` on Windows, `.command` on Mac). A black
    window runs for a minute and says "Done". A new file appears next to
    yours: `amara-tidy.glb`. That is the one you use from now on.

    If the window says Blender was not found, do step 4 again.

## Part E: check it and watch it come alive (in your browser)

13. Open **dingba.ai/studio** in Chrome, Edge or Safari.
14. Drag `amara-tidy.glb` onto the page. Nothing is uploaded; the check
    happens on your computer.
15. Read the list on the right. Green ticks are fine. Red lines say in
    plain words what to fix. Tick **Work in progress** if you just want to
    look at an unfinished character.
16. Press **Say it** and watch the mouth move on the words. Click each
    mood. Press **Walk through every slider** and watch all 52 controls
    move one at a time; one that pulls the wrong part of the face is
    caught here, so go back to step 9 for that control.
17. When the heading says **Ready**, press **Copy report**.

## Part F: send it

18. Send `amara-tidy.glb` and the copied report here, in this chat. I put
    it live, and Amara appears in every lesson. Repeat from step 9 for
    each of the other twelve tutors.

## If something goes wrong

- Unreal will not open or keeps crashing: the computer is below the
  "Before you start" line. Only Parts B and C need the big computer.
- The Studio says "not a glTF binary": you dragged the wrong file.
  Use the `-tidy.glb` one from step 12.
- "essential sliders missing": the export left out the 52 controls. Go
  back to step 10 and use one of the two tools there.
- The character shows but is grey: do step 12; the tidy step packs the
  textures in.
- Anything else: send the Studio report here and I will tell you what
  it means.
