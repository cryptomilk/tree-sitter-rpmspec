#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
# Copyright (c) 2025 Andreas Schneider <asn@cryptomilk.org>
"""
Update tree-sitter test files with actual parser AST output.

Usage:
    # Interactive mode - run tests and select failing ones to update
    ./scripts/update-test-ast.py -i

    # Update a specific test by name (uses regex matching)
    ./scripts/update-test-ast.py "Test Name"

    # Dry run - show AST without updating
    ./scripts/update-test-ast.py -n "Test Name"

This script wraps 'tree-sitter test --update' with additional features:
- Interactive selection of failing tests to update
- Dry-run mode to preview changes
- Partial name matching to find tests
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

        return "\n".join(lines)

    finally:
        os.unlink(temp_path)


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


def update_tests_with_tree_sitter(test_names):
    """Use tree-sitter test --update to update specific tests."""
    # Escape regex special characters and join with |
    patterns = [re.escape(name) for name in test_names]
    regex = "^(" + "|".join(patterns) + ")$"

    result = subprocess.run(
        ["tree-sitter", "test", "--update", "-i", regex],
        capture_output=True,
        text=True,
    )

    # Print output for user feedback
    if result.stdout:
        print(result.stdout)
    if result.stderr:
        print(result.stderr, file=sys.stderr)

    return result.returncode == 0


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

    if dry_run:
        # Show what would be updated
        for test_name in selected:
            print(f"\nWould update: {test_name}")
            result = find_test_file(test_name, corpus_dir)
            if result:
                test_file, content = result
                tests = parse_test_file(content)
                matching = [t for t in tests if t["name"] == test_name]
                if matching:
                    new_ast = get_ast_from_parser(matching[0]["input"])
                    print(f"  New AST:\n{new_ast}")
        return

    # Use tree-sitter test --update for the selected tests
    print(f"\nUpdating {len(selected)} test(s)...")
    update_tests_with_tree_sitter(selected)


def main():
    parser = argparse.ArgumentParser(
        description="Update test AST from parser output"
    )
    parser.add_argument(
        "test_name",
        nargs="?",
        help="Name of the test to update (regex pattern)",
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

    if args.dry_run:
        # Find and show AST for matching test
        result = find_test_file(args.test_name, corpus_dir)
        if not result:
            print(
                f"Error: test '{args.test_name}' not found in corpus",
                file=sys.stderr,
            )
            sys.exit(1)

        test_file, content = result
        tests = parse_test_file(content)
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
        new_ast = get_ast_from_parser(test["input"])
        print(f"\nNew AST:\n{new_ast}")
        return

    # Use tree-sitter test --update with the pattern
    # The pattern is passed directly as a regex to -i
    result = subprocess.run(
        ["tree-sitter", "test", "--update", "-i", args.test_name],
        text=True,
    )
    sys.exit(result.returncode)


if __name__ == "__main__":
    main()
