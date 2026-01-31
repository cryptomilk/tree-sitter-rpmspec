#!/usr/bin/env python3
"""
Extract fuzzing corpus from tree-sitter test files.

Tree-sitter test files have the format:
    ===== Test name =====
    <input>
    -----
    <expected tree>

This script extracts the <input> sections and writes them to individual files
for use as libFuzzer seed corpus.
"""

import argparse
import re
import sys
from pathlib import Path


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


def main():
    parser = argparse.ArgumentParser(
        description="Extract fuzzing corpus from tree-sitter test files"
    )
    parser.add_argument(
        "--rpmspec-tests",
        type=Path,
        default=Path("rpmspec/test/corpus"),
        help=(
            "Path to rpmspec test corpus directory "
            "(default: rpmspec/test/corpus)"
        ),
    )
    parser.add_argument(
        "--rpmbash-tests",
        type=Path,
        default=Path("rpmbash/test/corpus"),
        help=(
            "Path to rpmbash test corpus directory "
            "(default: rpmbash/test/corpus)"
        ),
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("tests/fuzz/corpus"),
        help=(
            "Output directory for fuzz corpus "
            "(default: tests/fuzz/corpus)"
        ),
    )
    parser.add_argument(
        "-v", "--verbose", action="store_true", help="Verbose output"
    )

    args = parser.parse_args()

    # Extract rpmspec corpus
    if args.rpmspec_tests.exists():
        rpmspec_output = args.output / "rpmspec"
        count = extract_corpus(
            args.rpmspec_tests,
            rpmspec_output,
            extension="spec",
            verbose=args.verbose,
        )
        print(f"Extracted {count} rpmspec test cases to {rpmspec_output}")
    else:
        print(f"Warning: {args.rpmspec_tests} not found", file=sys.stderr)

    # Extract rpmbash corpus
    if args.rpmbash_tests.exists():
        rpmbash_output = args.output / "rpmbash"
        count = extract_corpus(
            args.rpmbash_tests,
            rpmbash_output,
            extension="sh",
            verbose=args.verbose,
        )
        print(f"Extracted {count} rpmbash test cases to {rpmbash_output}")
    else:
        print(f"Warning: {args.rpmbash_tests} not found", file=sys.stderr)

    return 0


if __name__ == "__main__":
    sys.exit(main())
