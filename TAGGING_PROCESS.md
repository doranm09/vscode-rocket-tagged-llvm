# Tagging Process Deep Dive

This document describes the current implementation for FSM-aware Rocket software development in this extension.

The extension now supports two validation paths:

- asm marker path (`TAG:<STATE>` comments)
- hardware-facing sideband path (`.fsm_trace` section extracted to binary stream)

## 1) Design intent

The workflow is designed for incremental bring-up:

1. developers author FSM events in C,
2. compiler emits normal code plus trace metadata,
3. extension extracts sideband stream artifacts,
4. software policy checker validates stream before deployment,
5. the same stream format can be consumed by a hardware FSM checker.

## 2) Authoring model

### 2.1 Sideband emission macros

Use `runtime/fsm_trace.h`:

- `FSM_TRACE_EMIT_ID(tag_id)` emits a 32-bit word into `.fsm_trace`
- `FSM_TAG(state_name, tag_id)` emits both:
  - asm marker comment (`# TAG:<STATE>`)
  - sideband trace word in `.fsm_trace`

Section attributes:

- section name: `.fsm_trace`
- alignment: 4 bytes
- payload unit: 32-bit little-endian integer ID

### 2.2 Example

`examples/fsm_sideband_demo.c` emits IDs:

- `BOOT=1`, `INIT=2`, `RUN=3`, `HALT=4`

Those IDs match `runtime/default-fsm-policy.json`.

## 3) Build pipeline in extension

Primary implementation: `src/extension.ts`.

### 3.1 Compile stage

Each command compiles active source to:

- `*.tagged.s`
- `*.o`

using configured `clang` target/arch/abi settings.

### 3.2 Sideband extraction stage

For sideband commands, extension runs:

- `objcopy --dump-section <section>=<bin> <object>`

Default section is `.fsm_trace`.

Generated artifacts:

- `<base>.fsm_trace.bin` raw 32-bit ID stream
- `<base>.fsm_trace.hex` one ID per line (`0x????????`)
- `<base>.fsm_trace.json` parsed manifest (word count + ID list)

## 4) Policy model

`runtime/default-fsm-policy.json` uses:

- `start`: required initial state
- `accept`: allowed final states
- `transitions`: adjacency map `state -> allowed next states`
- `ids`: mapping `state -> numeric tag ID`

Example:

- `BOOT: 1`
- `INIT: 2`
- `RUN: 3`
- `HALT: 4`

## 5) Checker behavior (`runtime/fsm-check.py`)

Checker accepts exactly one input mode:

- `--asm <file>`
- `--sideband-bin <file>`

and always requires:

- `--policy <file>`

### 5.1 ASM mode

- regex extracts `TAG:([A-Za-z0-9_]+)`
- extracted states are validated against policy transitions

### 5.2 Sideband mode

- binary is parsed as little-endian 32-bit words
- each ID is mapped via policy `ids`
- mapped state sequence is validated the same way as asm mode

### 5.3 Exit codes

- `0`: pass
- `1`: FSM validation failure
- `2`: input/policy/format error

## 6) VS Code commands and expected outputs

- `Rocket Tagged: Build Current File`
  - expected outputs: `.tagged.s`, `.o`
- `Rocket Tagged: Check FSM Tags`
  - validates asm markers against policy
- `Rocket Tagged: Build + Check`
  - same as above in one step
- `Rocket Tagged: Build + Emit FSM Sideband`
  - expected outputs: `.fsm_trace.bin/.hex/.json`
- `Rocket Tagged: Build + Check FSM Sideband`
  - builds, emits sideband, validates sideband sequence
- `Rocket Tagged: Package Deployment Bundle`
  - builds, validates sideband, links `*.elf`, and emits deployment bundle directory/zip

## 7) Hardware integration contract

Current sideband contract expected by hardware checker:

- ordered stream of 32-bit tag IDs
- little-endian word encoding
- semantic mapping supplied by shared policy/ID table

Typical deployment flow:

1. compile workload,
2. extract `.fsm_trace` stream,
3. package payload + sideband into deployment bundle,
4. load stream where hardware FSM checker can consume it,
5. run workload and compare runtime behavior against trace expectations.

The extension currently handles steps 1-3 and local pre-checking.

## 8) Current limitations

- Bundle transport to board image is not automated yet (bundle is generated, integration script is external).
- No runtime host protocol to feed sideband into Rocket checker yet.
- No direct trace synchronization logic (PC/time alignment) in this repo yet.
- No custom ISA encoding in this version; this path is section-based sideband.

## 9) Next steps for full Rocket FSM enforcement

Recommended next milestones:

1. Define Rocket-side sideband ingest interface (memory mapped FIFO, DMA, or ROM init region).
2. Define start/reset synchronization between core and FSM checker.
3. Add SD card/boot image generation command that consumes the deployment bundle.
4. Add on-target trace capture and post-run compare command.
5. Optionally add LLVM pass to auto-instrument tags rather than macro-based manual insertion.
