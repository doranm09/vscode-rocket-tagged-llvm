# vscode-rocket-tagged-llvm

VS Code extension for developing tagged RISC-V programs for Rocket and producing an FSM sideband stream artifact consumable by a hardware checker.

## What this gives you

- `Rocket Tagged: Build Current File`
  - Compiles active file to `*.tagged.s` and `*.o`
- `Rocket Tagged: Check FSM Tags`
  - Validates asm `TAG:<STATE>` markers against policy
- `Rocket Tagged: Build + Check`
  - Build + asm-marker check
- `Rocket Tagged: Build + Emit FSM Sideband`
  - Extracts `.fsm_trace` stream from object
- `Rocket Tagged: Build + Check FSM Sideband`
  - Validates extracted sideband stream against policy
- `Rocket Tagged: Package Deployment Bundle`
  - Build + sideband check + ELF link + deployment bundle packaging
- `Rocket Tagged: Package SD Card Layout`
  - Build + sideband check + bundle + SD-card staging layout packaging

## Repository layout

- `src/extension.ts`: VS Code commands and build/packaging orchestration
- `runtime/fsm-check.py`: checker for asm markers or sideband binary stream
- `runtime/fsm_trace.h`: C macros to emit sideband IDs in `.fsm_trace`
- `runtime/default-fsm-policy.json`: fallback FSM policy with state-ID map
- `examples/fsm_sideband_demo.c`: sideband-enabled source example
- `examples/README.md`: runnable smoke tests
- `TAGGING_PROCESS.md`: detailed architecture and workflow

## Prerequisites

- VS Code 1.86+
- Node.js 20+
- LLVM/clang with RISC-V target support
- Python 3
- `objcopy` (default configured for `riscv64-unknown-elf-objcopy`)

## Build extension locally

```bash
cd ~/git/vscode-rocket-tagged-llvm
npm install
npm run compile
```

Open this folder in VS Code and press `F5` for Extension Development Host.

## Recommended workspace settings

```json
{
  "rocketTagged.llvmBinDir": "/usr/bin",
  "rocketTagged.objcopyPath": "riscv64-unknown-elf-objcopy",
  "rocketTagged.sidebandSection": ".fsm_trace",
  "rocketTagged.targetTriple": "riscv64-unknown-elf",
  "rocketTagged.riscvArch": "rv64gc_zicsr_zifencei",
  "rocketTagged.riscvAbi": "lp64d",
  "rocketTagged.outputDir": "${workspaceFolder}/build/tagged",
  "rocketTagged.fsmPolicyPath": "${workspaceFolder}/fsm-policy.json",
  "rocketTagged.linkerPath": "",
  "rocketTagged.linkArgs": ["-nostdlib", "-Wl,-e,main", "-Wl,-Ttext=0x80000000"],
  "rocketTagged.bundleOutputDir": "${workspaceFolder}/build/tagged/deploy",
  "rocketTagged.bundleCreateZip": true,
  "rocketTagged.sdLayoutOutputDir": "${workspaceFolder}/build/tagged/sdcard",
  "rocketTagged.sdPayloadFilename": "payload.elf",
  "rocketTagged.sdSidebandFilename": "fsm_trace.bin",
  "rocketTagged.sdPolicyFilename": "fsm_policy.json",
  "rocketTagged.sdManifestFilename": "fsm_bundle.json",
  "rocketTagged.sdBootScriptFilename": "boot.cmd.txt",
  "rocketTagged.sdLayoutCreateZip": true,
  "rocketTagged.payloadLoadAddress": "0x80000000",
  "rocketTagged.sidebandLoadAddress": "0x88000000"
}
```

## Deployment bundle outputs

For source `foo.c`, the package command emits:

- Bundle directory: `build/tagged/deploy/foo/`
- Optional zip archive: `build/tagged/deploy/foo.zip`

Bundle content:

- `foo.tagged.s`
- `foo.o`
- `foo.elf`
- `foo.fsm_trace.bin`
- `foo.fsm_trace.hex`
- `foo.fsm_trace.json`
- policy JSON used for checking
- `bundle.json` (manifest with addresses, hashes, sideband words)

Use this bundle as the handoff artifact for boot/SD integration scripts.

## SD card layout outputs

For source `foo.c`, SD layout command emits:

- Staging directory: `build/tagged/sdcard/foo/`
- Optional zip archive: `build/tagged/sdcard/foo.zip`

Staging content includes:

- `payload.elf` (configurable name)
- `fsm_trace.bin` (configurable name)
- `fsm_policy.json` (configurable name)
- `fsm_bundle.json` (copied bundle manifest)
- `boot.cmd.txt` (example U-Boot script)
- `README.txt`
- `sd_layout_manifest.json` (hashes and metadata)

This is a staging layout, not a flashed card image. It is intended to be copied onto the SD boot partition or consumed by your SD imaging scripts.

## Smoke tests

See `examples/README.md` for asm and sideband command-line tests.
