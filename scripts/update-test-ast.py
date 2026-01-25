#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
# Copyright (c) 2025 Andreas Schneider <asn@cryptomilk.org>
"""
Update tree-sitter test files with actual parser AST output.

Usage:
    # Interactive mode - run tests and select failing ones to update
    ./scripts/update-test-ast.py -i

    # Update a specific test by name
    ./scripts/update-test-ast.py "Test Name"

    # Dry run - show AST without updating
    ./scripts/update-test-ast.py -n "Test Name"

The script finds the test by name, extracts its input, runs tree-sitter parse,
and updates the expected AST in the test file.
"""

import argparse
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path


def find_test_file(test_name, corpus_dir):
    """Find which corpus file contains the test."""
    for test_file in corpus_dir.glob("*.txt"):
        content = test_file.read_text()
        if test_name in content:
            return test_file, content
    return None


def parse_test_file(content):
    """Parse a test file into a list of test cases."""
    tests = []
    lines = content.split("\n")
    i = 0

    while i < len(lines):
        # Look for header
        if lines[i].startswith("=" * 10):
            # Next line is test name
            if i + 1 >= len(lines):
                break
            name = lines[i + 1]

            # Skip second header
            if i + 2 >= len(lines) or not lines[i + 2].startswith("=" * 10):
                i += 1
                continue

            # Find input (after empty line, before separator)
            i += 3
            if i < len(lines) and lines[i] == "":
                i += 1

            input_start = i
            while i < len(lines) and not lines[i].startswith("-" * 10):
                i += 1

            # Remove trailing empty line from input
            input_end = i
            while input_end > input_start and lines[input_end - 1] == "":
                input_end -= 1

            input_lines = lines[input_start:input_end]

            # Skip separator
            if i < len(lines) and lines[i].startswith("-" * 10):
                i += 1

            # Skip empty line after separator
            if i < len(lines) and lines[i] == "":
                i += 1

            # Find AST (until next header or end)
            ast_start = i
            while i < len(lines) and not lines[i].startswith("=" * 10):
                i += 1

            # Remove trailing empty lines from AST
            ast_end = i
            while ast_end > ast_start and lines[ast_end - 1] == "":
                ast_end -= 1

            ast_lines = lines[ast_start:ast_end]

            tests.append(
                {
                    "name": name,
                    "input": "\n".join(input_lines),
                    "ast": "\n".join(ast_lines),
                    "input_start": input_start,
                    "input_end": input_end,
                    "ast_start": ast_start,
                    "ast_end": ast_end,
                }
            )
        else:
            i += 1

    return tests


def get_ast_from_parser(input_text):
    """Run tree-sitter parse and extract the S-expression."""
    with tempfile.NamedTemporaryFile(
        mode="w", suffix=".spec", delete=False
    ) as f:
        f.write(input_text)
        if not input_text.endswith("\n"):
            f.write("\n")
        temp_path = f.name

    try:
        result = subprocess.run(
            ["tree-sitter", "parse", temp_path],
            capture_output=True,
            text=True,
        )

        output = result.stdout

        # The output format is:
        # (spec [0, 0] - [N, 0]
        #   (node [x, y] - [a, b]
        #     ...))
        # file.spec    Parse: ...

        # Remove position annotations [x, y] - [a, b]
        output = re.sub(r"\s*\[\d+, \d+\] - \[\d+, \d+\]", "", output)

        # Remove the trailing file info line
        lines = output.strip().split("\n")
        while lines and (
            lines[-1].strip().startswith(temp_path)
            or "Parse:" in lines[-1]
            or lines[-1].strip() == ""
        ):
            lines.pop()

        # Convert 2-space indentation (tree-sitter uses 2 spaces)
        ast = "\n".join(lines)

        return ast

    finally:
        os.unlink(temp_path)


def update_test_file(test_file, content, test, new_ast):
    """Update the test file with new AST."""
    lines = content.split("\n")

    # Replace AST lines
    new_lines = (
        lines[: test["ast_start"]]
        + new_ast.split("\n")
        + lines[test["ast_end"] :]
    )

    return "\n".join(new_lines)


def get_failing_tests():
    """Run tree-sitter test and return list of failing test names."""
    result = subprocess.run(
        ["tree-sitter", "test"],
        capture_output=True,
        text=True,
    )

    # Parse output to find failing tests
    # Format: "  123. ✗ Test Name" (with ANSI color codes)
    failing = []
    for line in result.stdout.split("\n") + result.stderr.split("\n"):
        # Strip ANSI codes first
        clean_line = re.sub(r"\x1b\[[0-9;]*m", "", line)
        # Match lines with ✗ (failure marker)
        match = re.search(r"\d+\.\s*✗\s+(.+)$", clean_line)
        if match:
            name = match.group(1).strip()
            if name and name not in failing:
                failing.append(name)

    return failing


def interactive_mode(corpus_dir, dry_run=False):
    """Run tests, show failures, let user select which to update."""
    print("Running tree-sitter tests...")
    failing = get_failing_tests()

    if not failing:
        print("All tests pass!")
        return

    print(f"\n{len(failing)} failing test(s):\n")
    for i, name in enumerate(failing, 1):
        print(f"  {i}. {name}")

    print(
        "\nEnter number(s) to update (comma-separated), "
        "'a' for all, or 'q' to quit:"
    )
    try:
        choice = input("> ").strip().lower()
    except (KeyboardInterrupt, EOFError):
        print("\nCancelled.")
        return

    if choice == "q" or choice == "":
        return

    if choice == "a":
        selected = failing
    else:
        try:
            indices = [int(x.strip()) - 1 for x in choice.split(",")]
            selected = [failing[i] for i in indices if 0 <= i < len(failing)]
        except (ValueError, IndexError):
            print("Invalid selection.")
            return

    if not selected:
        print("No tests selected.")
        return

    # Update each selected test
    for test_name in selected:
        print(f"\nUpdating: {test_name}")

        result = find_test_file(test_name, corpus_dir)
        if not result:
            print("  Error: test file not found")
            continue

        test_file, content = result
        tests = parse_test_file(content)

        # Find exact match
        matching = [t for t in tests if t["name"] == test_name]
        if not matching:
            # Try partial match
            matching = [t for t in tests if test_name in t["name"]]

        if not matching:
            print(f"  Error: test not found in {test_file}")
            continue

        test = matching[0]

        # Get AST from parser
        new_ast = get_ast_from_parser(test["input"])
        if not new_ast:
            print("  Error: failed to get AST from parser")
            continue

        if dry_run:
            print(f"  Would update with:\n{new_ast}")
            continue

        # Update file
        new_content = update_test_file(test_file, content, test, new_ast)
        test_file.write_text(new_content)
        print(f"  Updated {test_file.name}")


def main():
    parser = argparse.ArgumentParser(
        description="Update test AST from parser output"
    )
    parser.add_argument(
        "test_name",
        nargs="?",
        help="Name of the test to update (partial match)",
    )
    parser.add_argument(
        "--file",
        "-f",
        help="Specific test file (default: search all corpus files)",
    )
    parser.add_argument(
        "--dry-run",
        "-n",
        action="store_true",
        help="Print AST without updating file",
    )
    parser.add_argument(
        "--interactive",
        "-i",
        action="store_true",
        help="Interactive mode: run tests and select failing ones to update",
    )
    args = parser.parse_args()

    # Find corpus directory
    script_dir = Path(__file__).parent
    corpus_dir = script_dir.parent / "test" / "corpus"

    if not corpus_dir.exists():
        print(
            f"Error: corpus directory not found: {corpus_dir}", file=sys.stderr
        )
        sys.exit(1)

    # Interactive mode
    if args.interactive:
        interactive_mode(corpus_dir, args.dry_run)
        return

    # Need test name if not interactive
    if not args.test_name:
        parser.print_help()
        sys.exit(1)

    # Find test file
    if args.file:
        test_file = Path(args.file)
        if not test_file.exists():
            print(f"Error: file not found: {test_file}", file=sys.stderr)
            sys.exit(1)
        content = test_file.read_text()
    else:
        result = find_test_file(args.test_name, corpus_dir)
        if not result:
            print(
                f"Error: test '{args.test_name}' not found in corpus",
                file=sys.stderr,
            )
            sys.exit(1)
        test_file, content = result

    # Parse tests
    tests = parse_test_file(content)

    # Find matching test
    matching = [
        t for t in tests if args.test_name.lower() in t["name"].lower()
    ]

    if not matching:
        print(
            f"Error: no test matching '{args.test_name}' found",
            file=sys.stderr,
        )
        sys.exit(1)

    if len(matching) > 1:
        print(f"Multiple tests match '{args.test_name}':", file=sys.stderr)
        for t in matching:
            print(f"  - {t['name']}", file=sys.stderr)
        sys.exit(1)

    test = matching[0]
    print(f"Found test: {test['name']}")
    print(f"File: {test_file}")

    # Get AST from parser
    new_ast = get_ast_from_parser(test["input"])
    if not new_ast:
        print("Error: failed to get AST from parser", file=sys.stderr)
        sys.exit(1)

    if args.dry_run:
        print("\nNew AST:")
        print(new_ast)
        return

    # Update file
    new_content = update_test_file(test_file, content, test, new_ast)
    test_file.write_text(new_content)
    print(f"Updated {test_file}")


if __name__ == "__main__":
    main()
