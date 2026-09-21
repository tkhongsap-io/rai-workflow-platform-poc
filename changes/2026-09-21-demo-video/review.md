# Video verification

Delivered `media/demo-video/true-rai-demo-30s.mp4`, poster, original captures, encoded contact sheet, renderer and rebuild instructions. Primary inspiration inspected before production: Cursor's official cloud-agent launch video. No footage or music reused from it.

## Checks actually performed

- Render: 900 frames, 30 fps, 30.00 seconds, 1920×1080.
- Format: H.264 High, yuv420p, AAC stereo 48 kHz, MP4 fast-start. File size 4,981,383 bytes.
- Full FFmpeg video/audio decode completed with exit 0; 900 decoded frames confirmed.
- Ten keyframes extracted from the encoded MP4 and visually inspected as a contact sheet, including title, each feature beat and ending.
- Opened in QuickTime Player, played through to the ending, and sought to 12.8s to inspect the feedback close-up.
- Sound-design source peak -21.33 dBFS, zero clipped samples. No voiceover, licensed music or sampled third-party audio. Audio stream decoded successfully; no subjective listening-quality claim.
- First preview corrected: removed empty-card shadow from opening/ending; changed wide-camera anchoring to preserve text starts. Rendered and inspected again after fixes.
- Product content: actual synthetic local app captures. Shows prepare/review/send-back/v2/approval/finding-disposition/complete. Persistent prototype label and review-not-launch disclaimer. No real deployment or backend claim.

## Limits and handoff

This is a polished motion overview composed from captured UI states, not a continuous screen recording or full training tutorial. Source screenshots are 1280×720 JPEG captures; fine UI text softens under zoom. Large editorial captions carry the message on smaller social displays. Landscape version only. No X upload/processing check or publication performed.

The application was not edited. A temporary local capture transfer server was unsuccessful and removed from service; the normal loopback demo server was restored. Capture data was saved through a local editor instead. Branch `codex/demo-video`. Owner subsequently authorized commit, PR and merge to main. Pre-commit verification: all 22 unit/provenance tests passed; `git diff --check` passed; origin/main has no changes beyond the branch base. Application code is unchanged, so the previously recorded browser journey results remain applicable.
