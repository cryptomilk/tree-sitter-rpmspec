#!/usr/bin/env python3
"""
Parse sanitizer output and generate CI annotations.

This script reads sanitizer (ASan/UBSan/LeakSanitizer/libFuzzer) output from
stdin and generates CI workflow annotations for GitHub Actions or GitLab CI.

Supports:
- GitHub Actions format (::error / ::notice)
- GitLab CI format (colored output with ANSI codes)
- Passthrough mode to preserve all output
- Error detection for non-zero exit codes

Based on tree-sitter/fuzz-action annotate.pl
"""

import argparse
import os
import re
import signal
import sys
from pathlib import Path
from typing import Optional

# ANSI color codes
RED = "\033[31m"
YELLOW = "\033[33m"
BOLD = "\033[1m"
RESET = "\033[0m"


def get_relative_path(file_path: str) -> str:
    """Convert absolute path to relative path from CI workspace."""
    # Try GitLab CI first, then GitHub Actions
    workspace = os.environ.get("CI_PROJECT_DIR") or os.environ.get(
        "GITHUB_WORKSPACE", ""
    )

    if not workspace:
        # Not running in GitHub Actions, return as-is
        return file_path

    try:
        abs_path = Path(file_path).resolve()
        workspace_path = Path(workspace).resolve()
        return str(abs_path.relative_to(workspace_path))
    except (ValueError, OSError):
        # Can't resolve or not relative to workspace
        return file_path


def parse_runtime_error(line: str, lines_iter) -> Optional[dict]:
    """Parse 'runtime error:' messages from UBSan."""
    # Format: file:line:col: runtime error: message
    match = re.match(
        r"(?P<file>[^:]+):(?P<line>\d+):(?P<col>\d+): runtime error: (?P<msg>.+)",
        line,
    )

    if match:
        return {
            "level": "notice",
            "file": get_relative_path(match.group("file")),
            "line": match.group("line"),
            "col": match.group("col"),
            "title": "Sanitizer",
            "message": match.group("msg"),
        }

    return None


def parse_asan_summary(line: str, lines_iter) -> Optional[dict]:
    """Parse AddressSanitizer SUMMARY line."""
    # Format: SUMMARY: AddressSanitizer: error-type file:line:col message
    match = re.match(
        r"SUMMARY: AddressSanitizer: (?P<id>[A-Za-z-]+) "
        r"(?P<file>[^:]+):(?P<line>\d+):(?P<col>\d+) (?P<msg>.+)",
        line,
    )

    if match:
        # Convert error-id from kebab-case to space-separated
        error_type = match.group("id").replace("-", " ")
        message = f"{error_type} {match.group('msg')}"

        return {
            "level": "error",
            "file": get_relative_path(match.group("file")),
            "line": match.group("line"),
            "col": match.group("col"),
            "title": "Sanitizer",
            "message": message,
        }

    return None


def parse_leak_sanitizer(line: str, lines_iter) -> Optional[dict]:
    """Parse LeakSanitizer error."""
    # Skip next 2 lines, then parse stack trace
    try:
        next(lines_iter)  # Skip blank line
        next(lines_iter)  # Skip another line
        stack_line = next(lines_iter)

        # Skip interceptor frames
        if "in __interceptor" in stack_line:
            stack_line = next(lines_iter)

        # Format: #1 0xaddr in function_name file:line:col
        match = re.match(
            r"#\d+ 0x[a-f0-9]+ (?P<msg>in [A-Za-z0-9_]+) "
            r"(?P<file>[^:]+):(?P<line>\d+):(?P<col>\d+)",
            stack_line,
        )

        if match:
            return {
                "level": "error",
                "file": get_relative_path(match.group("file")),
                "line": match.group("line"),
                "col": match.group("col"),
                "title": "Sanitizer",
                "message": f"detected memory leak {match.group('msg')}",
            }
    except StopIteration:
        pass

    return None


def parse_oom_error(line: str, lines_iter) -> Optional[dict]:
    """Parse libFuzzer out-of-memory error."""
    try:
        # Skip next 3 lines
        for _ in range(3):
            next(lines_iter)

        # Read until we find a non-fuzzer stack frame
        while True:
            stack_line = next(lines_iter)

            if "in __" in stack_line or "fuzzer" in stack_line:
                continue

            # Check if this is the "Live Heap Allocations" section
            if stack_line.startswith("Live Heap Allocations"):
                return {
                    "level": "error",
                    "file": "src/scanner.c",
                    "line": "1",
                    "col": "1",
                    "title": "Sanitizer",
                    "message": "out of memory (potential infinite loop)",
                }

            # Parse stack frame
            match = re.match(
                r"#\d+ 0x[a-f0-9]+ (?P<msg>in [A-Za-z0-9_]+) "
                r"(?P<file>[^:]+):(?P<line>\d+):(?P<col>\d+)",
                stack_line,
            )

            if match:
                return {
                    "level": "error",
                    "file": get_relative_path(match.group("file")),
                    "line": match.group("line"),
                    "col": match.group("col"),
                    "title": "Sanitizer",
                    "message": f"out of memory {match.group('msg')}",
                }

            break
    except StopIteration:
        pass

    return None


def emit_annotation(
    annotation: dict, format_type: str = "github", use_color: bool = False
) -> None:
    """Emit a CI annotation."""
    if format_type == "gitlab":
        emit_annotation_gitlab(annotation, use_color)
    else:
        emit_annotation_github(annotation)


def emit_annotation_github(annotation: dict) -> None:
    """Emit a GitHub Actions workflow command."""
    level = annotation["level"]
    file_path = annotation["file"]
    line = annotation["line"]
    col = annotation["col"]
    title = annotation["title"]
    message = annotation["message"]

    print(
        f"::{level} file={file_path},line={line},col={col},title={title}::{message}"
    )


def emit_annotation_gitlab(annotation: dict, use_color: bool = False) -> None:
    """Emit a GitLab CI formatted annotation with optional colors."""
    level = annotation["level"]
    file_path = annotation["file"]
    line = annotation["line"]
    col = annotation["col"]
    message = annotation["message"]

    if use_color:
        if level == "error":
            symbol = f"{RED}✗ ERROR:{RESET}"
            location = f"{BOLD}{file_path}:{line}:{col}{RESET}"
        else:  # notice
            symbol = f"{YELLOW}⚠ NOTICE:{RESET}"
            location = f"{BOLD}{file_path}:{line}:{col}{RESET}"
        print(f"{symbol} {location} - Sanitizer: {message}")
    else:
        if level == "error":
            symbol = "✗ ERROR:"
        else:
            symbol = "⚠ NOTICE:"
        print(f"{symbol} {file_path}:{line}:{col} - Sanitizer: {message}")


def signal_handler(signum, frame):
    """Handle Ctrl+C gracefully."""
    sys.exit(130)  # Standard exit code for SIGINT (128 + 2)


def main():
    """Process stdin and emit annotations."""
    # Set up signal handler for Ctrl+C
    signal.signal(signal.SIGINT, signal_handler)

    parser = argparse.ArgumentParser(
        description="Parse sanitizer output and generate CI annotations"
    )
    parser.add_argument(
        "--format",
        choices=["github", "gitlab"],
        default="gitlab",
        help="Output format (default: gitlab)",
    )
    parser.add_argument(
        "--color",
        action="store_true",
        default=True,
        help="Enable colored output (default: enabled)",
    )
    parser.add_argument(
        "--no-color",
        action="store_true",
        help="Disable colored output",
    )
    parser.add_argument(
        "--passthrough",
        action="store_true",
        help="Print all input lines (not just annotations)",
    )

    args = parser.parse_args()

    # Determine color usage
    if args.no_color:
        use_color = False
    elif args.color:
        use_color = True
    else:
        # Auto-detect: enable color if stdout is a TTY or in CI
        use_color = sys.stdout.isatty() or os.environ.get("CI") == "true"

    lines_iter = iter(sys.stdin)
    found_errors = False

    try:
        for line in lines_iter:
            line = line.rstrip("\n")
            annotation = None

            # Runtime error (UBSan)
            if "runtime error:" in line:
                annotation = parse_runtime_error(line, lines_iter)
                if annotation:
                    emit_annotation(annotation, args.format, use_color)
                    if annotation["level"] == "error":
                        found_errors = True

            # AddressSanitizer summary
            elif "SUMMARY: AddressSanitizer:" in line and not re.search(
                r"AddressSanitizer: \d", line
            ):
                annotation = parse_asan_summary(line, lines_iter)
                if annotation:
                    emit_annotation(annotation, args.format, use_color)
                    if annotation["level"] == "error":
                        found_errors = True

            # LeakSanitizer
            elif "ERROR: LeakSanitizer:" in line:
                annotation = parse_leak_sanitizer(line, lines_iter)
                if annotation:
                    emit_annotation(annotation, args.format, use_color)
                    if annotation["level"] == "error":
                        found_errors = True

            # libFuzzer out-of-memory
            elif "ERROR: libFuzzer: out-of-memory" in line:
                annotation = parse_oom_error(line, lines_iter)
                if annotation:
                    emit_annotation(annotation, args.format, use_color)
                    if annotation["level"] == "error":
                        found_errors = True

            # Passthrough mode: print all lines
            if args.passthrough:
                print(line)
    except KeyboardInterrupt:
        # Handle Ctrl+C gracefully (already set up signal handler)
        pass

    # Exit with error code if sanitizer errors were detected
    return 1 if found_errors else 0


if __name__ == "__main__":
    sys.exit(main())
