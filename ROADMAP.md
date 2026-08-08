# Roadmap

Work that is understood but not built. Each item lists what it would take and,
where one exists, the open question that has to be answered before it can start
— several of these are blocked on a decision rather than on effort.

This is a personal tool that solves my own problem well. Nothing here is a
commitment; it's a record of where the edges are and what I'd weigh in moving
them.

## 1. Statically linked FFmpeg

**Status:** blocked on a licensing decision, not on effort.

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

Three ways out, none free:

| Option                                                                                           | Cost                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Build static FFmpeg LGPL-only — drop `libx264`/`libx265`, encode via VideoToolbox alone          | Loses the CPU encoders, which are the default path and the entire Compressed/High Quality distinction. A large functional regression to solve a licensing problem. |
| Ship GPL and comply — publish the FFmpeg build recipe and sources, relicense the app accordingly | Legally clean and keeps every codec. Means moving off MIT, which is a real decision for a portfolio repo.                                                          |
| Don't distribute binaries; stay build-from-source                                                | Free, and what the project does today. Costs the "download and run" story.                                                                                         |

Until this is settled, releases stay source-only. That is why the v1.0.0 release
has no `.app` attached.

## 2. Code signing and notarization

**Status:** depends on item 1.

Without an Apple Developer signature, Gatekeeper blocks the packaged app on any
machine that didn't build it. Requires a paid Apple Developer account, and the
signing and notarization steps in the packaging script.

Deliberately sequenced after item 1: there is no value in signing a build that
still can't run on a machine without matching Homebrew FFmpeg.

## 3. Intel and universal builds

**Status:** needs hardware to verify.

Packaging is hardcoded to `--arch=arm64` and the README claims Apple Silicon
only. The hardware path uses `h264_videotoolbox`, which is not actually
Apple-Silicon-exclusive — VideoToolbox exists on Intel Macs too — so the real
constraint may be narrower than documented. Producing a universal build is
mostly a packaging change plus a universal FFmpeg.

What's missing is an Intel Mac to confirm the encoder path and the CPU fallback
behave. I'd rather document the limit honestly than claim support I haven't
tested.

## 4. Transcoding integration tests

**Status:** tractable; the most likely next thing built.

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

## 5. Windows and Linux support

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
