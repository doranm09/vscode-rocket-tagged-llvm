# Examples

This folder gives you a minimal pass/fail demo for the FSM checker.

## Quick checker demo (no compiler required)

From repo root:

```bash
python3 runtime/fsm-check.py --asm examples/demo_pass.s --policy runtime/default-fsm-policy.json
python3 runtime/fsm-check.py --asm examples/demo_fail.s --policy runtime/default-fsm-policy.json
```

Expected:

- `demo_pass.s`: `FSM CHECK PASS`
- `demo_fail.s`: `FSM CHECK FAIL` (illegal `BOOT -> RUN` transition)

## Source-level example

`hello_tagged.c` shows how tags are authored in C:

```c
#define TAG(name) __asm__ volatile("# TAG:" #name)
```

If `clang` is available, build and check:

```bash
clang -target riscv64-unknown-elf -march=rv64gc_zicsr_zifencei -mabi=lp64d -ffreestanding -fno-builtin -O2 -S examples/hello_tagged.c -o /tmp/hello_tagged.s
python3 runtime/fsm-check.py --asm /tmp/hello_tagged.s --policy runtime/default-fsm-policy.json
```
