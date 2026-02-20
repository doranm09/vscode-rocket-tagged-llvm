# vscode-rocket-tagged-llvm

VS Code extension for developing tagged RISC-V programs for Rocket and producing an FSM sideband stream artifact that can be consumed by a hardware checker.

## What this gives you

- `Rocket Tagged: Build Current File`
  - Compiles active file to RISC-V assembly (`.tagged.s`) and object (`.o`) using `clang`
- `Rocket Tagged: Check FSM Tags`
  - Runs policy check on asm markers (`TAG:<STATE>`)
- `Rocket Tagged: Build + Check`
  - Build + asm-marker check
- `Rocket Tagged: Build + Emit FSM Sideband`
  - Extracts `.fsm_trace` from object and emits sideband artifacts (`.bin`, `.hex`, `.json`)
- `Rocket Tagged: Build + Check FSM Sideband`
  - Build, emit sideband stream, and validate it against the FSM policy

## Repository layout

- `src/extension.ts`: VS Code command logic
- `runtime/fsm-check.py`: FSM checker for asm markers or sideband binary stream
- `runtime/fsm_trace.h`: macros to emit hardware-consumable sideband IDs
- `runtime/default-fsm-policy.json`: fallback FSM policy with state-to-ID mapping
- `examples/fsm_sideband_demo.c`: sideband-enabled source example
- `examples/README.md`: runnable examples
- `TAGGING_PROCESS.md`: detailed tagging pipeline and design notes

## Prerequisites

- VS Code 1.86+
- Node.js 20+
- LLVM/clang with RISC-V target support
- Python 3
- `objcopy` (recommended: `riscv64-unknown-elf-objcopy`)

## Build extension locally

```bash
cd ~/git/vscode-rocket-tagged-llvm
npm install
npm run compile
```

Open this folder in VS Code and press `F5` to launch an Extension Development Host.

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
  "rocketTagged.fsmPolicyPath": "${workspaceFolder}/fsm-policy.json"
}
```

## Sideband artifact outputs

For `foo.c`, sideband commands emit:

- `build/tagged/foo.fsm_trace.bin`: raw little-endian 32-bit ID stream
- `build/tagged/foo.fsm_trace.hex`: one hex ID per line
- `build/tagged/foo.fsm_trace.json`: manifest with parsed IDs

These are generated from the ELF section configured by `rocketTagged.sidebandSection`.

## Quick checker smoke tests

From repo root:

```bash
python3 runtime/fsm-check.py --asm examples/demo_pass.s --policy runtime/default-fsm-policy.json
python3 runtime/fsm-check.py --asm examples/demo_fail.s --policy runtime/default-fsm-policy.json
```

See `examples/README.md` for sideband-specific smoke tests.

## Notes for custom LLVM tag pass

If you have a custom LLVM pass plugin (for instrumentation/tagging), set:

- `rocketTagged.passPluginPath`: absolute path to your pass `.so`

The extension adds `-fpass-plugin=<path>` to `clang` invocations.
