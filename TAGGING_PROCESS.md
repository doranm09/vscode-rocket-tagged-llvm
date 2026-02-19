# Tagging Process Deep Dive

This document describes the current tagging implementation in detail, including:

- how tags are authored in source code
- how tags flow through compilation
- how the FSM checker validates behavior
- how the VS Code commands orchestrate build/check
- what is intentionally not implemented yet
- how to evolve toward a real LLVM + Rocket hardware-enforced tagging flow

## 1) Current design goals

The current implementation is a practical developer loop for early validation:

- Keep tagging syntax simple for firmware/software developers.
- Keep checks deterministic and easy to debug.
- Avoid requiring custom toolchain patches to start.
- Allow future migration to LLVM IR/MC-level instrumentation and hardware tag checks.

The result is a **marker-based tagging workflow**:

1. developer emits symbolic state tags (`TAG(STATE)`),
2. compiler carries those markers into assembly comments,
3. checker extracts marker sequence and validates transitions against JSON FSM policy.

## 2) End-to-end architecture

High-level flow:

1. Source authoring (`examples/hello_tagged.c`)
2. Compilation to assembly/object (`src/extension.ts`)
3. Tag extraction + policy validation (`runtime/fsm-check.py`)
4. VS Code command feedback (success/error)

Main code paths:

- Build orchestration: `src/extension.ts`
- Checker implementation: `runtime/fsm-check.py`
- Default policy: `runtime/default-fsm-policy.json`
- Sample tagged program: `examples/hello_tagged.c`

## 3) Tag authoring model

### 3.1 Marker syntax

In the sample, tags are emitted with:

```c
#define TAG(name) __asm__ volatile("# TAG:" #name)
```

This creates assembly comment lines such as:

```asm
# TAG:BOOT
# TAG:INIT
# TAG:RUN
```

### 3.2 Why comments right now

Comment markers provide:

- no ISA changes,
- no custom assembler requirements,
- straightforward extraction with regex,
- quick iteration while LLVM pass/hardware contract is still evolving.

### 3.3 Naming constraints

The checker recognizes only:

- `TAG:` prefix
- state token matching regex group `[A-Za-z0-9_]+`

Implication:

- states like `BOOT`, `RUN_1`, `X9` are valid,
- states containing hyphens/spaces are not currently recognized.

## 4) Build pipeline details

Build is managed in `src/extension.ts`.

### 4.1 Active file resolution

The extension requires an active editor document and workspace folder:

- fails fast if no active file is open,
- fails if file is outside workspace.

### 4.2 Output naming

Given `foo.c`, outputs are:

- `build/tagged/foo.tagged.s`
- `build/tagged/foo.o`

`build/tagged` is configurable via `rocketTagged.outputDir`.

### 4.3 Compiler invocation

The extension invokes `clang` twice:

1. assembly generation (`-S -o <asm>`)
2. object generation (`-c -o <obj>`)

Base arguments:

- `-target <triple>`
- `-march=<arch>`
- `-mabi=<abi>`
- `-ffreestanding`
- `-fno-builtin`
- `-O2`
- `-g`
- `<source-file>`

Optional arguments:

- `-fpass-plugin=<path>` if `rocketTagged.passPluginPath` is set
- additional user args from `rocketTagged.extraClangArgs`

### 4.4 Process execution behavior

`runProcess(...)` captures stdout/stderr and throws on non-zero exit codes.
The thrown error includes command, exit code, stdout, and stderr for diagnostics.

## 5) FSM policy model

Policy is JSON with keys:

- `start`: required first state (optional)
- `accept`: list of allowed final states (optional)
- `transitions`: adjacency map from state -> allowed next states

Example:

```json
{
  "start": "BOOT",
  "accept": ["RUN", "HALT"],
  "transitions": {
    "BOOT": ["INIT"],
    "INIT": ["RUN", "HALT"],
    "RUN": ["RUN", "HALT"],
    "HALT": []
  }
}
```

Semantics:

- Transition validation is pairwise over observed tag sequence.
- Any pair not present in `transitions[current]` is a violation.
- Missing `start` disables first-state constraint.
- Missing/empty `accept` disables final-state constraint.

## 6) Checker algorithm

The checker (`runtime/fsm-check.py`) performs:

1. Parse args (`--asm`, `--policy`)
2. Validate file existence
3. Load policy JSON
4. Extract tags via regex `TAG:([A-Za-z0-9_]+)`
5. Validate:
   - non-empty tag stream
   - first tag equals `start` (if defined)
   - each adjacent pair is legal
   - final tag is in `accept` (if defined)
6. Exit:
   - `0` on pass
   - `1` on policy violation
   - `2` on missing input files

Output on success:

- `FSM CHECK PASS`
- `Tag trace: S0 -> S1 -> ...`

Output on failure:

- `FSM CHECK FAIL`
- one or more bullet-style error lines
- full tag trace for debugging

## 7) VS Code command behavior

Commands:

- `rocketTagged.buildCurrentFile`
- `rocketTagged.checkCurrentFile`
- `rocketTagged.buildAndCheckCurrentFile`

Execution pattern:

- `Build`: compile only.
- `Check`: compile, then check assembly.
- `Build + Check`: compile, then check assembly.

Note: `Check` currently performs a build before checking to ensure the assembly reflects current editor state.

## 8) Configuration contract

Supported settings:

- `rocketTagged.llvmBinDir`
- `rocketTagged.python`
- `rocketTagged.targetTriple`
- `rocketTagged.riscvArch`
- `rocketTagged.riscvAbi`
- `rocketTagged.outputDir`
- `rocketTagged.passPluginPath`
- `rocketTagged.extraClangArgs`
- `rocketTagged.fsmPolicyPath`

Policy resolution behavior:

- If `fsmPolicyPath` exists, use it.
- Otherwise fallback to packaged `runtime/default-fsm-policy.json`.

## 9) Determinism and limitations

### 9.1 Determinism

Checker decisions are deterministic for identical:

- assembly file content
- policy JSON

No runtime nondeterminism is introduced in the checker.

### 9.2 Current limitations

Current version is intentionally lightweight:

- Tags are comments, not architectural metadata.
- No CFG/path-sensitive validation beyond observed linear sequence.
- No per-instruction binary tagging.
- No runtime handshake with Rocket core/FSM hardware.
- No linker stage integration for cross-file tag-flow constraints.

## 10) Roadmap to real LLVM + hardware tags

Recommended migration path:

1. Replace comment markers with explicit frontend intrinsic or annotation.
2. Implement LLVM pass to:
   - attach tag metadata to selected instructions/basic blocks,
   - emit sideband section or custom pseudo-ops.
3. Extend assembler/linker flow to preserve tag stream mapping.
4. Define software-hardware contract:
   - encoding format,
   - memory/register transport path,
   - boot-time initialization protocol.
5. Implement Rocket-side FSM checker consuming encoded tags at runtime.
6. Keep this plugin as developer frontend:
   - build orchestration,
   - local static precheck,
   - optional on-target trace comparison.

## 11) Practical usage pattern

Typical iteration loop:

1. Edit tagged source.
2. Run `Rocket Tagged: Build + Check`.
3. If fail:
   - inspect illegal transition message,
   - inspect tag trace,
   - inspect policy JSON.
4. Fix source ordering or update policy intentionally.
5. Repeat until pass.

This keeps state-machine policy drift visible during normal software development.

## 12) Troubleshooting

Common issues:

- `clang: command not found`:
  - set `rocketTagged.llvmBinDir` correctly.
- `FSM CHECK FAIL: No TAG:<STATE> markers`:
  - ensure tags are emitted and preserved in generated assembly.
- `policy file not found`:
  - set `rocketTagged.fsmPolicyPath` or create workspace policy file.
- Unexpected transition failure:
  - verify exact state spellings (case-sensitive),
  - verify transition adjacency in JSON.

## 13) Security/integrity notes

Because tags are currently comment markers, this mechanism is an engineering validation tool, not a tamper-resistant enforcement system.
Use it for development-time correctness checks until hardware-anchored tagging is implemented.
