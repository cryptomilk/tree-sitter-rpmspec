/// <reference types="node" />

/**
 * Smoke tests for the Node.js binding.
 *
 * Also run against the installed npm tarball in CI:
 *
 *   cd node_modules/tree-sitter-rpmspec
 *   node --test bindings/node/binding_test.js
 *
 * The cd is needed because the test runner skips paths containing
 * node_modules.
 */

const assert = require("node:assert");
const { test } = require("node:test");

const Parser = require("tree-sitter");
const binding = require(".");

test("can load rpmspec grammar", () => {
  // Parsing exercises the rpmspec external scanner symbols.
  const parser = new Parser();
  assert.doesNotThrow(() => parser.setLanguage(binding));
  assert.strictEqual(parser.parse("Name: foo\n").rootNode.hasError, false);
});

test("can load rpmbash grammar", () => {
  // Parsing exercises the rpmbash external scanner symbols.
  const parser = new Parser();
  const rpmbash = { name: "rpmbash", language: binding.rpmbash };
  assert.doesNotThrow(() => parser.setLanguage(rpmbash));
  assert.strictEqual(parser.parse("echo %{name}\n").rootNode.hasError, false);
});

test("ships node type info", () => {
  // index.js swallows a failed require, so a wrong path goes unnoticed.
  assert.ok(Array.isArray(binding.nodeTypeInfo));
});
