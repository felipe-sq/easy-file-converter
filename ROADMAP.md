# Roadmap

Work that is understood but not built. Each item lists what it would take and,
where one exists, the open question that has to be answered before it can start
— several are blocked on a decision rather than on effort. Where a decision has
been made, it's recorded with the reasoning, so a deferral can be told apart
from an oversight.

This is a personal tool that solves my own problem well. Nothing here is a
commitment; it's a record of where the edges are and what I'd weigh in moving
them.

## 1. Statically linked FFmpeg

**Status:** deferred deliberately. Releases stay source-only; see the decision
at the end of this section.

The app shells out to `ffmpeg` and `ffprobe` copied from Homebrew into `bin/`.
Those binaries link dynamically against a version-pinned path:

```
/opt/homebrew/Cellar/ffmpeg/8.1/lib/libavcodec.62.dylib
```

Two consequences. A Homebrew upgrade that moves FFmpeg to a new version breaks
the packaged app even though FFmpeg is still installed. And the app only runs
on a machine that already has that exact version — so there is no meaningful
way to hand someone a working build.

A statically linked FFmpeg fixes both. The blocker is what that build may
contain. The current binaries are configured `--enable-gpl` and include
`libx264` and `libx265`, both GPL. `npm run package-mac` copies `bin/` into the
`.app` (at `Contents/Resources/app.asar.unpacked/bin/`), so **distributing a
packaged build is redistributing GPL-licensed FFmpeg**, with the obligations
that carries. Building it in statically doesn't create that problem, but it
does make it unavoidable rather than incidental.

### Is dropping the GPL codecs viable?

The tempting escape is an LGPL-only static build: drop `libx264`/`libx265` and
encode through VideoToolbox instead. Two things argue against it.

**There is no HEVC hardware path to fall back on.** `converter.js` uses
`libx265` for Compressed mode and `h264_videotoolbox` only in High Quality mode.
`hevc_videotoolbox` exists in the FFmpeg build but the app never calls it. So
going LGPL-only is not a configure-flag change — it means rewriting the default
encoding path against an encoder that isn't wired up yet. That work is item 2.

**The CPU encoder is measurably better.** Rate-matched comparison, 10 s of
1280×720, VideoToolbox given the exact bitrate libx265 produced so quality is
the only variable:

| Encoder                       |      Size | Encode time | Mean SSIM |
| ----------------------------- | --------: | ----------: | --------: |
| `libx265` CRF 26 (current)    | 2,778,558 |      3.22 s |    0.8248 |
| `hevc_videotoolbox` @ 2222 kb | 2,854,638 |      1.00 s |    0.8200 |

libx265 came in 2.7% smaller than the bitrate VideoToolbox was told to hit, at
slightly higher SSIM. Two caveats, both pointing the same way: the source was
synthetic and noise-heavy, which defeats motion prediction and is a **best case
for the hardware encoder**, and SSIM is a rough proxy — this build has no full
libvmaf. On real footage the gap typically widens. Read the direction as solid
and the margin as a floor.

Dropping libx265 would therefore make the "roughly half the size" claim
measurably worse, to solve a licensing problem that isn't currently active.

<details>
<summary>How that was measured</summary>

```bash
# Detailed, moving, grainy source — clean synthetic patterns flatter both encoders.
ffmpeg -f lavfi -i "testsrc2=size=1280x720:rate=30:duration=10" \
  -vf "noise=alls=12:allf=t+u" -c:v ffv1 src.mkv

ffmpeg -i src.mkv -c:v libx265 -crf 26 -tag:v hvc1 -an x265.mp4

# Give VideoToolbox exactly the bitrate libx265 produced, so quality is the only variable.
ffmpeg -i src.mkv -c:v hevc_videotoolbox -b:v 2222k -tag:v hvc1 -an vt.mp4

# Mean SSIM of each encode against the source.
ffmpeg -i x265.mp4 -i src.mkv -lavfi "[0:v][1:v]ssim=stats_file=-" -f null -
```

</details>

### The three options

| Option                                                                                           | Cost                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Build static FFmpeg LGPL-only — drop `libx264`/`libx265`, encode via VideoToolbox alone          | Requires item 2 first, then gives up measurably better compression. Solves a problem the project does not currently have.                               |
| Ship GPL and comply — publish the FFmpeg build recipe and sources, relicense the app accordingly | Legally clean, keeps every codec. Means moving off MIT. On its own it still doesn't produce a runnable download — static linking is a separate problem. |
| Don't distribute binaries; stay build-from-source                                                | Free, and what the project does today. Costs the "download and run" story.                                                                              |

### Decision: option 3, for now

GPL obligations attach to distribution. They place no constraints on private use
or on anyone building from source, and this repository ships no binaries — so
there is currently nothing to comply with. Option 2 solves a problem the project
doesn't have, at the cost of leaving MIT.

It's also worth being clear about how long the chain to "download and run"
really is. It needs a static FFmpeg **and** a licensing resolution **and** a paid
Apple Developer account **and** notarization. Relicensing alone unlocks nothing:
a downloaded build would still fail on the version-pinned dylib path. That is a
standing cost for a tool whose main user builds it from source.

So v1.0.0 ships source-only, and that is a choice rather than an omission.

## 2. Hardware H.265 via `hevc_videotoolbox`

**Status:** recommended next. Useful on its own, and it keeps item 1's LGPL
option open instead of leaving it blocked on unwritten code.

`hevc_videotoolbox` is present in the FFmpeg build but the app never calls it.
Adding it **alongside** `libx265` rather than in place of it earns three things:

- **Speed.** It ran 3.2× faster than `libx265` in the measurement above (1.00 s
  vs 3.22 s). That matters on the long recordings this tool exists to convert,
  where the current default is CPU-bound.
- **It fixes an asymmetry.** The hardware checkbox is disabled unless High
  Quality is checked (`renderer.js`, `updateHardwareAccelAvailability`), so the
  default Compressed mode can never use the GPU — the one mode most likely to be
  run over a large batch.
- **It preserves an option.** An LGPL-only build is only conceivable once a
  hardware HEVC path exists. Building it now costs nothing in licensing terms
  and removes the blocker, without committing to that direction.

The open question is quality control. `libx265` is driven by CRF 26;
VideoToolbox takes a bitrate or a quality value, so the Compressed profile's
current contract doesn't map across directly and a target would have to be
chosen and checked against real footage. The existing automatic
hardware-to-CPU fallback should cover the new path too.

## 3. Code signing and notarization

**Status:** depends on item 1.

Without an Apple Developer signature, Gatekeeper blocks the packaged app on any
machine that didn't build it. Requires a paid Apple Developer account, and the
signing and notarization steps in the packaging script.

Deliberately sequenced after item 1: there is no value in signing a build that
still can't run on a machine without matching Homebrew FFmpeg.

## 4. Intel and universal builds

**Status:** needs hardware to verify.

Packaging is hardcoded to `--arch=arm64` and the README claims Apple Silicon
only. The hardware path uses `h264_videotoolbox`, which is not actually
Apple-Silicon-exclusive — VideoToolbox exists on Intel Macs too — so the real
constraint may be narrower than documented. Producing a universal build is
mostly a packaging change plus a universal FFmpeg.

What's missing is an Intel Mac to confirm the encoder path and the CPU fallback
behave. I'd rather document the limit honestly than claim support I haven't
tested.

## 5. Transcoding integration tests

**Status:** tractable; the clearest win after item 2.

The current suite is deliberately smoke-level — it verifies that the source
parses and that main, preload, and renderer agree on every IPC channel and
exposed method. It does not encode a single frame.

A real test would synthesize a short clip with FFmpeg's `testsrc` at test time,
run it through the conversion and combine paths, and assert the output's codec
and dimensions with `ffprobe`. No fixture files to commit, and CI can install
FFmpeg from apt.

The known gap: the VideoToolbox hardware path can't be covered this way, since
Linux CI has no VideoToolbox. That path would stay manually verified, and the
test suite should say so rather than imply coverage it doesn't have.

## 6. Windows and Linux support

**Status:** out of scope for now.

The conversion logic is portable — it's FFmpeg arguments. What isn't: the
hardware acceleration path, the binary resolution in `converter.js`, the
packaging target, and the settings file location. Realistically this is a port,
not a flag, and the tool exists to move video onto an iPad from a Mac.

## Smaller things

- Progress comes from fluent-ffmpeg's `info.percent` and is throttled to 500 ms
  in the main process, so a short conversion can finish having shown few or no
  intermediate updates.
- The combine queue is in memory only, so quitting mid-queue loses pending jobs.
- `converter.js` is the largest file in the project and mixes encoder-profile
  selection, remux eligibility, and scaling. It would read better split.
