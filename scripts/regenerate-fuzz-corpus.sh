#!/bin/bash
#
# Regenerate fuzz corpus for tree-sitter-rpmspec.
#
# This is a convenience wrapper around ts-extract-fuzz-corpus.py
# for this multi-grammar project.
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

exec "${SCRIPT_DIR}/ts-extract-fuzz-corpus.py" \
	--grammar rpmspec:rpmspec/test/corpus:spec \
	--grammar rpmbash:rpmbash/test/corpus:sh \
	--output tests/fuzz/corpus \
	"$@"
