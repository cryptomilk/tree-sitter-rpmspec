"""Smoke tests for the tree_sitter_rpmspec Python binding.

Run against the *installed* package (e.g. a wheel built from the sdist):

    python -m unittest discover -v -s bindings/python/tests
"""

from unittest import TestCase

from tree_sitter import Language, Parser

import tree_sitter_rpmspec


class TestLanguage(TestCase):
    def test_can_load_rpmspec_grammar(self):
        # Loading and parsing exercises the rpmspec external scanner symbols.
        parser = Parser(Language(tree_sitter_rpmspec.language()))
        tree = parser.parse(b"Name: foo\n")
        self.assertFalse(tree.root_node.has_error)

    def test_can_load_rpmbash_grammar(self):
        # Loading and parsing exercises the rpmbash external scanner symbols.
        parser = Parser(Language(tree_sitter_rpmspec.rpmbash()))
        tree = parser.parse(b"echo %{name}\n")
        self.assertFalse(tree.root_node.has_error)

    def test_language_is_rpmspec(self):
        # language() stays an alias of rpmspec() for backward compatibility.
        self.assertEqual(Language(tree_sitter_rpmspec.language()).name, "rpmspec")
