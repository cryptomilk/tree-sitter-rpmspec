# Fuzzing for tree-sitter-rpmspec

This directory contains libFuzzer-based fuzzing infrastructure for testing the
rpmspec and rpmbash parsers. Fuzzing helps detect crashes, hangs, and memory
safety issues in the external scanners and generated parsers.

## Quick Start

```bash
# 1. Clean and configure with fuzzing enabled
rm -rf build
cmake -B build -DENABLE_FUZZING=ON -DPICKY_DEVELOPER=ON -DCMAKE_C_COMPILER=clang

# 2. Build the fuzzers
cmake --build build

# 3. Run fuzzing (60 seconds per parser)
make fuzz-rpmspec  # Test rpmspec parser
make fuzz-rpmbash  # Test rpmbash parser
make fuzz          # Test both parsers
```

## Requirements

### Compiler
- **Clang** (version 10.0+) - libFuzzer is built into Clang
- GCC is **not supported** (libFuzzer is Clang-specific)

### Tools
- **Required**:
  - `clang` - C compiler with libFuzzer support
  - `cmake` - Build system (3.13+)
  - `python3` - For corpus extraction script

- **Optional** (for dictionary generation):
  - `jq` - JSON processor for extracting grammar tokens
  - `awk` - Pattern matching utility
  - `iconv` - Character encoding converter

  Dictionary generation gracefully degrades if these tools are missing.
  The fuzzer will still work, just with slightly reduced efficiency.

### Platform
- Linux (recommended)
- macOS (supported)
- Windows - **not supported** (libFuzzer limitation)

## Directory Structure

```
tests/fuzz/
├── README.md                   # This file
├── fuzzer.c                    # Generic tree-sitter libFuzzer driver
├── ignorelist.ini              # Sanitizer suppressions for tree-sitter
├── LICENSE.fuzzer              # MIT license from tree-sitter/fuzz-action
├── corpus/                     # Seed corpus for fuzzing
│   ├── rpmspec/                # ~200-300 .spec files from test suite
│   └── rpmbash/                # ~30-50 .sh files from test suite
└── artifacts/                  # Crash/timeout findings (gitignored)
```

## Seed Corpus

The seed corpus is extracted from the tree-sitter test suites using
`scripts/ts-extract-fuzz-corpus.py`:

- **rpmspec**: Extracted from `rpmspec/test/corpus/*.txt` (~300 files)
- **rpmbash**: Extracted from `rpmbash/test/corpus/*.txt` (~50 files)

To regenerate the corpus:

```bash
# Using the convenience wrapper:
./scripts/regenerate-fuzz-corpus.sh

# Or using the general-purpose script directly:
python3 scripts/ts-extract-fuzz-corpus.py \
  --grammar rpmspec:rpmspec/test/corpus:spec \
  --grammar rpmbash:rpmbash/test/corpus:sh
```

The `ts-extract-fuzz-corpus.py` script is general-purpose and works with any
tree-sitter project. See `scripts/ts-extract-fuzz-corpus.py --help` for usage
examples with single-grammar projects.

## Fuzzer Dictionaries

libFuzzer dictionaries contain grammar keywords and tokens to guide mutation
strategies. They are automatically generated from `grammar.json` during the
build process.

**Generation**: The `TSFuzzDictionary.cmake` module extracts STRING and ALIAS
tokens using `jq` and generates dictionaries at:

- `build/tests/fuzz/rpmspec.dict`
- `build/tests/fuzz/rpmbash.dict`

**Usage**: Dictionaries are automatically used by the `make fuzz-*` targets.
If dictionary generation fails (missing jq/grep/iconv), fuzzing continues
without them.

## Running the Fuzzers

### Basic Usage

```bash
# Fuzz rpmspec for 60 seconds (default)
make fuzz-rpmspec

# Fuzz rpmbash for 60 seconds (default)
make fuzz-rpmbash

# Fuzz both parsers
make fuzz
```

### Advanced Options

Run fuzzers directly with custom libFuzzer options:

```bash
# Run for 5 minutes with maximum input size of 4KB
build/tests/fuzz/fuzz-rpmspec tests/fuzz/corpus/rpmspec \
    -dict=build/tests/fuzz/rpmspec.dict \
    -max_total_time=300 \
    -max_len=4096

# Run with multiple jobs (parallel fuzzing)
build/tests/fuzz/fuzz-rpmspec tests/fuzz/corpus/rpmspec \
    -dict=build/tests/fuzz/rpmspec.dict \
    -jobs=8 -workers=8

# Minimize a crash artifact
build/tests/fuzz/fuzz-rpmspec \
    -minimize_crash=1 \
    tests/fuzz/artifacts/crash-xyz

# Reproduce a specific crash
build/tests/fuzz/fuzz-rpmspec tests/fuzz/artifacts/crash-xyz
```

### Useful libFuzzer Options

- `-max_total_time=N` - Stop after N seconds
- `-max_len=N` - Maximum input size (default: unlimited)
- `-jobs=N` - Number of fuzzing jobs (parallel execution)
- `-workers=N` - Number of worker processes
- `-dict=FILE` - Use mutation dictionary
- `-timeout=N` - Timeout for single input (default: 1200s)
- `-minimize_crash=1` - Minimize a crash testcase
- `-print_final_stats=1` - Print coverage statistics

See `build/tests/fuzz/fuzz-rpmspec -help=1` for all options.

## Sanitizers

The fuzzers are built with multiple sanitizers enabled:

- **AddressSanitizer (ASan)** - Detects memory errors (buffer overflows,
  use-after-free, etc.)
- **UndefinedBehaviorSanitizer (UBSan)** - Detects undefined behavior
  (integer overflow, null pointer dereference, etc.)
- **LeakSanitizer (LSan)** - Detects memory leaks

### Suppressions

`ignorelist.ini` contains sanitizer suppressions for known issues in
tree-sitter's generated code. This file is from the upstream
`tree-sitter/fuzz-action` project.

## Analyzing Results

### No Issues Found

```
#123456  DONE   cov: 1234 ft: 5678 corp: 234/5678Kb exec/s: 1234 rss: 128Mb
```

Success! The fuzzer explored the input space without finding crashes.

### Crash Detected

```
==12345==ERROR: AddressSanitizer: heap-buffer-overflow on address 0x...
    #0 0x... in ts_scanner_scan scanner.c:123
    #1 0x... in ts_lexer_advance ...
```

The fuzzer found a crash! Artifacts are saved to `tests/fuzz/artifacts/`.

**Next steps**:
1. Reproduce: `build/tests/fuzz/fuzz-rpmspec tests/fuzz/artifacts/crash-xyz`
2. Minimize: `build/tests/fuzz/fuzz-rpmspec -minimize_crash=1 tests/fuzz/artifacts/crash-xyz`
3. Debug: Run minimized input under GDB/LLDB
4. Fix the bug in `scanner.c` or `grammar.js`
5. Verify: Re-run fuzzer to confirm fix

### Timeout/Hang Detected

```
ALARM: working on the last Unit for 60 seconds
```

The fuzzer detected an input that causes the parser to hang. Similar workflow
as crashes - minimize and fix.

## Performance Tuning

### Corpus Size

- Larger corpus = better coverage, slower startup
- Remove duplicate/similar files to improve efficiency
- Use `-merge=1` to deduplicate corpus:

```bash
mkdir corpus-new
build/tests/fuzz/fuzz-rpmspec -merge=1 corpus-new tests/fuzz/corpus/rpmspec
```

### Dictionary Quality

- More relevant keywords = better fuzzing efficiency
- Manually add domain-specific tokens to `.dict` files
- Format: One entry per line, quoted strings (e.g., `"keyword"`)

### Parallel Fuzzing

Use `-jobs=N -workers=N` to run multiple fuzzing processes:

```bash
build/tests/fuzz/fuzz-rpmspec tests/fuzz/corpus/rpmspec \
    -dict=build/tests/fuzz/rpmspec.dict \
    -jobs=8 -workers=8 -max_total_time=3600
```

This is especially effective on multi-core systems for long fuzzing sessions.

## Continuous Integration

For CI workflows, use:

```bash
# Run with time limit and artifact collection
build/tests/fuzz/fuzz-rpmspec tests/fuzz/corpus/rpmspec \
    -dict=build/tests/fuzz/rpmspec.dict \
    -max_total_time=60 \
    -artifact_prefix=tests/fuzz/artifacts/

# Parse sanitizer output with annotator (for GitHub Actions)
python3 scripts/annotate-fuzzer-output.py < fuzzer.log
```

The annotator script converts ASan/UBSan output into GitHub Actions annotations
(`::error`, `::notice`).

## Troubleshooting

### "Fuzzer not built" error

```
Error: Fuzzer not built. Run: rm -rf build && cmake -B build -DENABLE_FUZZING=ON
```

**Solution**: Configure with `-DENABLE_FUZZING=ON`:

```bash
rm -rf build
cmake -B build -DENABLE_FUZZING=ON
cmake --build build
```

### "Fuzzing requires Clang compiler" error

**Solution**: Install Clang and set it as the compiler:

```bash
# Ubuntu/Debian
sudo apt-get install clang

# Fedora/RHEL
sudo dnf install clang

# macOS
brew install llvm

# Configure with Clang
CC=clang CXX=clang++ cmake -B build -DENABLE_FUZZING=ON
```

### Dictionary not found warnings

If jq/grep/iconv are missing, dictionary generation fails silently:

```bash
# Install missing tools (Ubuntu/Debian)
sudo apt-get install jq grep libc-bin

# Install missing tools (Fedora/RHEL)
sudo dnf install jq grep glibc-common

# Rebuild to regenerate dictionaries
cmake --build build
```

The fuzzer works without dictionaries, just less efficiently.

### Out of memory during fuzzing

Reduce the maximum input length:

```bash
build/tests/fuzz/fuzz-rpmspec tests/fuzz/corpus/rpmspec \
    -max_len=8192 -rss_limit_mb=2048
```

## References

- [libFuzzer Documentation](https://llvm.org/docs/LibFuzzer.html)
- [tree-sitter/fuzz-action](https://github.com/tree-sitter/fuzz-action) - Upstream fuzzing infrastructure
- [AddressSanitizer](https://github.com/google/sanitizers/wiki/AddressSanitizer)
- [UndefinedBehaviorSanitizer](https://clang.llvm.org/docs/UndefinedBehaviorSanitizer.html)

## License

The fuzzer driver (`fuzzer.c`) and suppressions (`ignorelist.ini`) are from
the [tree-sitter/fuzz-action](https://github.com/tree-sitter/fuzz-action)
project, licensed under MIT. See `LICENSE.fuzzer` for details.
