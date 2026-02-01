#!/usr/bin/env python3
#
# Copyright (c) 2026 Andreas Schneider <asn@cryptomilk.org>
#
# Permission is hereby granted, free of charge, to any person obtaining a copy
# of this software and associated documentation files (the "Software"), to deal
# in the Software without restriction, including without limitation the rights
# to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
# copies of the Software, and to permit persons to whom the Software is
# furnished to do so, subject to the following conditions:
#
# The above copyright notice and this permission notice shall be included in
# all copies or substantial portions of the Software.
#
# THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
# IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
# FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
# AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
# LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
# OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
# THE SOFTWARE.
#
"""
Extract fuzzing corpus from tree-sitter test files.

Tree-sitter test files have the format:
    ===== Test name =====
    <input>
    -----
    <expected tree>

This script extracts the <input> sections and writes them to individual files
for use as libFuzzer seed corpus.

Works with any tree-sitter grammar project - single or multi-grammar.
"""

import argparse
import re
import sys
from pathlib import Path


EXAMPLES_TEXT = """
examples:
  # Auto-detect single grammar (requires --ext)
  %(prog)s --auto --ext sh

  # Single grammar with explicit paths
  %(prog)s --input test/corpus --ext py --output fuzz/corpus

  # Multi-grammar project (like tree-sitter-rpmspec)
  %(prog)s \\
    --grammar rpmspec:rpmspec/test/corpus:spec \\
    --grammar rpmbash:rpmbash/test/corpus:sh \\
    --output tests/fuzz/corpus

  # Override grammar name
  %(prog)s --input test/corpus --name mylang --ext txt

common use cases:
  tree-sitter-bash:
    %(prog)s --input test/corpus --ext sh

  tree-sitter-python:
    %(prog)s --input test/corpus --ext py

  tree-sitter-rpmspec (current project):
    %(prog)s \\
      --grammar rpmspec:rpmspec/test/corpus:spec \\
      --grammar rpmbash:rpmbash/test/corpus:sh

format:
  Tree-sitter test files must follow the standard format:
    ===== Test name =====
    <input>
    -----
    <expected tree>
"""


def parse_test_file(test_file: Path) -> list[tuple[str, str]]:
    """
    Parse a tree-sitter test file and extract test cases.

    Returns: List of (test_name, input_content) tuples
    """
    content = test_file.read_text(encoding="utf-8")

    # Split by test separator (=== lines)
    # Pattern: one or more '=' followed by test name, then more '='
    test_blocks = re.split(r"\n={3,}.*?={3,}\n", content)

    # Get test names
    test_names = re.findall(r"\n={3,}(.*?)={3,}\n", content)

    results = []

    # Skip first empty block
    for name, block in zip(test_names, test_blocks[1:]):
        # Split by output separator (--- lines)
        parts = re.split(r"\n-{3,}\n", block, maxsplit=1)

        if len(parts) < 2:
            # No separator found, skip
            continue

        input_content = parts[0].strip()

        if input_content:
            # Clean up test name for filename
            clean_name = name.strip()
            results.append((clean_name, input_content))

    return results


def sanitize_filename(name: str) -> str:
    """Convert test name to valid filename."""
    # Replace spaces and special chars with underscores
    name = re.sub(r"[^\w\s-]", "", name)
    name = re.sub(r"[-\s]+", "_", name)
    return name.lower()


def extract_corpus(
    test_dir: Path, output_dir: Path, extension: str, verbose: bool = False
) -> int:
    """
    Extract all test cases from test_dir to output_dir.

    Returns: Number of test cases extracted
    """
    output_dir.mkdir(parents=True, exist_ok=True)

    test_files = sorted(test_dir.glob("*.txt"))

    if not test_files:
        print(f"Warning: No test files found in {test_dir}", file=sys.stderr)
        return 0

    total_cases = 0

    for test_file in test_files:
        test_cases = parse_test_file(test_file)

        if verbose:
            print(f"Processing {test_file.name}: {len(test_cases)} test cases")

        for idx, (name, content) in enumerate(test_cases, start=1):
            # Create filename: testfile_number_testname.ext
            base_name = test_file.stem  # Remove .txt
            safe_name = sanitize_filename(name)
            filename = f"{base_name}_{idx:03d}_{safe_name}.{extension}"

            output_file = output_dir / filename
            output_file.write_text(content + "\n", encoding="utf-8")

            total_cases += 1

    return total_cases


def auto_detect_grammar() -> tuple[str, Path]:
    """
    Auto-detect grammar from current directory.

    Returns: (name, test_corpus_path)
    Raises: ValueError if detection fails
    """
    # 1. Find test corpus
    test_corpus = Path("test/corpus")
    if not test_corpus.exists():
        raise ValueError("Auto-detection failed: test/corpus not found")

    # 2. Detect grammar name from grammar.js
    grammar_file = Path("grammar.js")
    if grammar_file.exists():
        content = grammar_file.read_text()
        match = re.search(r"name:\s*['\"]([^'\"]+)['\"]", content)
        if match:
            name = match.group(1)
        else:
            # Fallback to directory name
            name = Path.cwd().name.replace("tree-sitter-", "")
    else:
        name = Path.cwd().name.replace("tree-sitter-", "")

    return (name, test_corpus)


def validate_and_normalize_args(
    args, parser: argparse.ArgumentParser
) -> list[tuple[str, Path, str]]:
    """
    Validate arguments and return list of (name, input_path, extension) tuples.

    Raises: SystemExit via parser.error() for invalid combinations
    """
    grammars = []

    # Auto mode
    if args.auto:
        if args.grammar or args.input:
            parser.error("--auto cannot be combined with --grammar or --input")
        if not args.ext:
            parser.error("--auto requires --ext to specify file extension")

        try:
            name, input_path = auto_detect_grammar()
        except ValueError as e:
            parser.error(str(e))

        grammars.append((name, input_path, args.ext))
        return grammars

    # Multi-grammar mode
    if args.grammar:
        for spec in args.grammar:
            parts = spec.split(":")
            if len(parts) != 3:
                parser.error(
                    f"Invalid grammar spec: {spec}. "
                    f"Expected format: NAME:INPUT:EXT"
                )
            name, input_path, ext = parts
            grammars.append((name.strip(), Path(input_path), ext.strip()))

    # Simple mode
    if args.input:
        if not args.ext:
            parser.error("--input requires --ext to specify file extension")
        name = args.name or Path.cwd().name.replace("tree-sitter-", "")
        grammars.append((name, args.input, args.ext))

    # No grammars specified - show help
    if not grammars:
        parser.error(
            "No grammars specified. Use --auto, --grammar, or --input/--ext"
        )

    return grammars


def main():
    parser = argparse.ArgumentParser(
        description="Extract fuzzing corpus from tree-sitter test files",
        epilog=EXAMPLES_TEXT,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )

    parser.add_argument(
        "--grammar",
        "-g",
        action="append",
        metavar="NAME:INPUT:EXT",
        help=(
            "Grammar to process (format: name:test_corpus_dir:file_extension). "
            "Can be specified multiple times for multi-grammar projects. "
            "Example: --grammar rpmspec:rpmspec/test/corpus:spec"
        ),
    )

    parser.add_argument(
        "--input",
        "-i",
        type=Path,
        metavar="DIR",
        help=(
            "Input test corpus directory (simple mode). "
            "Example: --input test/corpus"
        ),
    )

    parser.add_argument(
        "--output",
        "-o",
        type=Path,
        default=Path("tests/fuzz/corpus"),
        metavar="DIR",
        help="Output directory for fuzz corpus (default: tests/fuzz/corpus)",
    )

    parser.add_argument(
        "--ext",
        "-e",
        metavar="EXT",
        help=(
            "Output file extension (without leading dot). "
            "Required for --auto and --input modes. "
            "Example: --ext js"
        ),
    )

    parser.add_argument(
        "--name",
        "-n",
        metavar="NAME",
        help=(
            "Grammar name for simple mode (defaults to current directory name). "
            "Example: --name bash"
        ),
    )

    parser.add_argument(
        "--auto",
        "-a",
        action="store_true",
        help=(
            "Auto-detect single grammar from current directory. "
            "Looks for test/corpus and grammar.js. Requires --ext."
        ),
    )

    parser.add_argument(
        "--verbose",
        "-v",
        action="store_true",
        help="Verbose output showing each file processed",
    )

    args = parser.parse_args()

    # Validate and normalize arguments
    grammars = validate_and_normalize_args(args, parser)

    # Process each grammar
    total_extracted = 0
    for name, input_path, extension in grammars:
        if not input_path.exists():
            print(f"Warning: {input_path} not found", file=sys.stderr)
            continue

        output_path = args.output / name
        count = extract_corpus(
            input_path, output_path, extension, verbose=args.verbose
        )
        print(f"Extracted {count} {name} test cases to {output_path}")
        total_extracted += count

    if total_extracted == 0:
        print("Warning: No test cases extracted", file=sys.stderr)
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
