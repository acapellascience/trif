# The model on this iPhone

The More chat's "On this iPhone" engine (Tim, 11-16): a small model running on the phone itself, free and private,
for style mods (and boxed mods on 6 GB phones, experimental). The app's side: TrifProbe/LocalLlama.swift (llama.cpp),
LocalPrompt.swift (what the model is told, the grammar, the reply as a mod), LocalModels.swift (the models, their
downloads, the engine).

## What the research found (11-16, on a Mac with llama.cpp b12428)

12 tasks on four saved pages (research/outlines: Wikipedia, Hacker News, the Guardian, a test feed), 9 style and 3
boxed, each scored by applying the mod in headless Chrome and checking the page (research/scripts/score.js). The
summaries are in research/results.

- Prompt: a short guide of its own (local-guide.txt, the research's guide-local2), never the 16.7 KB desktop guide,
  whose x.com examples small models copy.
- Style mods as JSON under a schema, the header written by TRIF ("local2json"): MiniCPM5-2B did 7 of 9 style tasks,
  Qwen3.5-2B fewer but reads prompts about twice as fast, Qwen3.5-4B 7 of 9.
- Whole files under a grammar ("local2gbnf"): only Qwen3.5-4B is any good at boxed mods (2 of 3; 9 of 12 in all).
- So: 4 GB phones (the SE): MiniCPM5-2B (suggested) or Qwen3.5-2B, style mods only. 6 GB and up: Qwen3.5-4B,
  style and boxed. All Apache-2.0 (LFM3 left out: its licence caps revenue).

| Model | File | Size | SHA-256 |
|---|---|---|---|
| MiniCPM5 2B | openbmb/MiniCPM5-2B-GGUF · MiniCPM5-2B-Q4_K_M.gguf | 1,561,318,368 | ec2d5801…602fd |
| Qwen3.5 2B | unsloth/Qwen3.5-2B-GGUF · Qwen3.5-2B-Q4_K_M.gguf | 1,280,835,840 | aaf42c8b…99223 |
| Qwen3.5 4B | unsloth/Qwen3.5-4B-GGUF · Qwen3.5-4B-Q4_K_M.gguf | 2,740,937,888 | 00fe7986…a11a4 |

(Qwen publishes no GGUF of its own for 3.5; unsloth's are the files the research measured. Full hashes in
LocalModels.swift, checked after every download.)

## How the app runs it

- llama.cpp's own XCFramework, release b12428, from its GitHub releases: `mobile/browser-probe/fetch-llama.sh` puts it
  in mobile/browser-probe/Vendor (not in git), checked against its SHA-256. It has device and macOS slices, no
  Simulator slice, so a Simulator build leaves the model out (the engine says so; the stand-in is offered there).
  A device build links it and copies it into the app (the project's "Embed llama.framework (devices)" script).
- Weights read from disk as needed (mmap), a 4k context on 4 GB phones and 6k above, the KV cache in q8_0.
- The system prompt is read once per model and saved (llama_state_seq_save_file, in Caches); every later request
  restores it (about 10 ms on a Mac, against about 2 s to read it) and reads only the page and the request.
- Generation under a GBNF grammar: the research's JSON schema (LocalPrompt.styleGrammar), or a whole file with its
  header's shape and @match fixed (fileGrammar). TRIF then writes the header (style JSON), makes the research's
  repairs (a filter's "a|b" words as a pattern; a boxed `text()` as `text`), and the mod goes to Add this mod?, with
  its usual checks. Every reply ends with Not right? Ask Claude: the same request in Claude's chat, with the page.
- The model is loaded when a request comes and let go when the robot view closes or memory runs low.
- Downloads: only when asked (the size and free space shown first), in a background URLSession, resumable, checked
  against the SHA-256, into Application Support/models, left out of backups. (11-16, after Tim couldn't tell whether
  one was moving, and a first try did nothing:) a bar with MB done, speed and time left in Settings and over the More
  chat; a stall said as one instead of a frozen speed; a note and, with the app away, a notification when it ends; the
  app delegate's handleEventsForBackgroundURLSession makes the session again and attaches its downloads; a download
  iOS cancelled (the app swiped away) shows as paused with why and resumes where it was (its resume data kept in
  Caches); one with nothing after 15 s is said, and after 45 s started again once; the diagnostics get the start
  (asked for, refused, started, the first bytes with their HTTP status and host), every 10%, stalls, pauses, resumes,
  the end and why it failed.
- Measured each time, for the diagnostics ("local model"): load time, the system prompt restored or read, prompt and
  generation tokens per second, memory left before and after (os_proc_available_memory). The SE's numbers will come
  from Tim's phone.

## On a Mac

    mobile/browser-probe/fetch-llama.sh
    mobile/local-model/harness.sh <model.gguf> <wikipedia|hn|guardian|testfeed> <styleJSON|file> "<what I want>" [runs]

The harness compiles the app's LocalLlama.swift and LocalPrompt.swift against the framework's macOS slice. On an M-series
Mac (11-16): Qwen3.5-2B read 317 prompt tokens at about 510 tok/s and wrote at about 30 tok/s, the system prompt read in
2 s once and restored in 10 ms after; MiniCPM5-2B about 370 and 30 tok/s. Both gave valid mods for the HN filter and
Wikipedia link-colour tasks.
