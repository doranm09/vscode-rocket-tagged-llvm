# Examples

This folder contains both asm-marker and sideband-stream demos.

## 1) Asm marker pass/fail demo (no compiler required)

From repo root:

```bash
python3 runtime/fsm-check.py --asm examples/demo_pass.s --policy runtime/default-fsm-policy.json
python3 runtime/fsm-check.py --asm examples/demo_fail.s --policy runtime/default-fsm-policy.json
```

Expected:

- `demo_pass.s`: `FSM CHECK PASS`
- `demo_fail.s`: `FSM CHECK FAIL` (illegal `BOOT -> RUN` transition)

## 2) Sideband demo from C source

`fsm_sideband_demo.c` uses `runtime/fsm_trace.h` to emit:

- asm markers (`# TAG:<STATE>`) and
- sideband IDs into `.fsm_trace`

Compile and extract sideband:

```bash
clang -target riscv64-unknown-elf -march=rv64gc_zicsr_zifencei -mabi=lp64d -ffreestanding -fno-builtin -O2 -c examples/fsm_sideband_demo.c -o /tmp/fsm_sideband_demo.o
riscv64-unknown-elf-objcopy --dump-section .fsm_trace=/tmp/fsm_sideband_demo.bin /tmp/fsm_sideband_demo.o
```

Check sideband stream:

```bash
python3 runtime/fsm-check.py --sideband-bin /tmp/fsm_sideband_demo.bin --policy runtime/default-fsm-policy.json
```

Expected:

- `FSM CHECK PASS`

## 3) Sideband binary format

- little-endian
- 32-bit words
- each word is a tag ID mapped by policy `ids`

Default mapping (`runtime/default-fsm-policy.json`):

- `BOOT=1`
- `INIT=2`
- `RUN=3`
- `HALT=4`

## 4) Deployment bundle command (in VS Code)

Use Command Palette:

- `Rocket Tagged: Package Deployment Bundle`

It emits:

- `build/tagged/deploy/<source-base>/...` (bundle directory)
- `build/tagged/deploy/<source-base>.zip` (if enabled)

Bundle includes `ELF + sideband + policy + bundle.json` metadata.

## 5) SD card layout command (in VS Code)

Use Command Palette:

- `Rocket Tagged: Package SD Card Layout`

It emits:

- `build/tagged/sdcard/<source-base>/...` (staging directory)
- `build/tagged/sdcard/<source-base>.zip` (if enabled)

This layout is ready to copy onto an SD boot partition, and includes an example boot script (`boot.cmd.txt`).

To convert that staging layout into a flashable `.img` file:

```bash
python3 scripts/create_sd_image.py \
  --layout-dir build/tagged/sdcard/<source-base> \
  --output-image /tmp/<source-base>.img \
  --size-mb 256 \
  --force
```
