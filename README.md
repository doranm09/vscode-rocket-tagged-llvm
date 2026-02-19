# vscode-rocket-tagged-llvm

VS Code extension scaffold for developing LLVM-based tagged programs that target Rocket-style RISC-V cores and validating tag transitions against an FSM policy.

## What this gives you

- `Rocket Tagged: Build Current File`
  - Compiles active file to RISC-V assembly (`.tagged.s`) and object (`.o`) using `clang`
- `Rocket Tagged: Check FSM Tags`
  - Rebuilds then validates emitted `TAG:<STATE>` markers in assembly against an FSM policy JSON
- `Rocket Tagged: Build + Check`
  - Combined command for fast iteration

## Repository layout

- `src/extension.ts`: VS Code command logic
- `runtime/fsm-check.py`: assembly tag transition checker
- `runtime/default-fsm-policy.json`: fallback FSM policy
- `examples/hello_tagged.c`: minimal tagged sample

## Prerequisites

- VS Code 1.86+
- Node.js 20+
- LLVM/clang with RISC-V target support
- Python 3

## Build extension locally

```bash
cd tools/vscode-rocket-tagged-llvm
npm install
npm run compile
```

Open this folder in VS Code and press `F5` to run an Extension Development Host.

## Recommended workspace settings

```json
{
  "rocketTagged.llvmBinDir": "/usr/bin",
  "rocketTagged.targetTriple": "riscv64-unknown-elf",
  "rocketTagged.riscvArch": "rv64gc_zicsr_zifencei",
  "rocketTagged.riscvAbi": "lp64d",
  "rocketTagged.outputDir": "${workspaceFolder}/build/tagged",
  "rocketTagged.fsmPolicyPath": "${workspaceFolder}/fsm-policy.json"
}
```

## Smoke test

From this plugin folder:

```bash
clang -target riscv64-unknown-elf -march=rv64gc_zicsr_zifencei -mabi=lp64d -ffreestanding -fno-builtin -O2 -S examples/hello_tagged.c -o /tmp/hello_tagged.s
python3 runtime/fsm-check.py --asm /tmp/hello_tagged.s --policy runtime/default-fsm-policy.json
```

Expected output:

- `FSM CHECK PASS`

## Notes for custom LLVM tag pass

If you have a custom LLVM pass plugin (for instruction tagging instrumentation), set:

- `rocketTagged.passPluginPath`: absolute path to your pass `.so`

The extension will add `-fpass-plugin=<path>` to clang invocations.
