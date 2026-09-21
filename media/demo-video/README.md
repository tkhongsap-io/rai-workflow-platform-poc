# True RAI Review Desk — 30-second product video

[Play/download MP4](true-rai-demo-30s.mp4) · [Poster](poster.jpg) · [Storyboard](storyboard.jpg)

1920×1080, 30 fps, 30.00 seconds, H.264/yuv420p + AAC stereo, fast-start MP4; approximately 5 MB. Landscape social product overview, readable without sound. Original minimal tonal bed and transition cues; no sampled music or third-party footage. No voiceover.

## Creative reference

Cursor's [cloud-agent launch video](https://cursor.com/blog/agent-computer-use), inspected through its official embedded player including fullscreen playback. Uses the product as the subject and demonstrates a completed workflow. Its [web/mobile announcement](https://cursor.com/blog/agent-web) was inspected for product presentation context. No reliable original X post was found, so these are official-site references, not a claim of viewing a particular X post.

This edit uses original True branding, kinetic captions and camera moves over actual screenshots from our local demo. It is an edited motion showcase, not a continuous screen recording. The small UI copy inherits the screenshot resolution; large captions carry the story in a social feed. No claim of real authentication, AI inference, emails, persistence or production deployment.

## Sequence

0–2.4: AI reviews. One clear path.
2.4–5.3: One place. Every review.
5.3–8.7: Nine documents. One clear pack.
8.7–12: Three lanes. In parallel.
12–15.5: Clear feedback. Better evidence.
15.5–19: New version. History intact.
19–21.5: Approved? Not done yet.
21.5–24.5: Resolve every finding.
24.5–28: Desk complete. Evidence retained.
28–30: True RAI Review Desk / Explore the prototype.

## Source and rebuild

Captured 2026-09-21 from http://127.0.0.1:5173/, app commit 8dbd63d. Nine actual UI states under assets/; the video uses eight of them. The correction picker is retained as an alternate shot. Source reference files and app behavior were not edited. True brand working palette uses #E00000/#303C46, with Arial fallback.

Create a Python environment with `pillow`, `numpy`, and `imageio-ffmpeg`, then run:

```sh
python media/demo-video/render.py --preview
python media/demo-video/render.py
```

The renderer currently uses macOS Arial paths and imageio-ffmpeg's bundled encoder. Adjust the two font paths on other platforms. `sound-design.wav`, poster, frame proofs and the MP4 are generated outputs. See verification.json and the dated change review for checks.

## Suggested post copy (draft, not posted)

One pack. Three review lanes. A clear decision.

A 30-second look at the True RAI Review Desk prototype: prepare the evidence, review in parallel, preserve each version and resolve findings before the desk is complete.

Synthetic demo. Human decisions throughout.
