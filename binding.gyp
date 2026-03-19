{
  "targets": [
    {
      "target_name": "tree_sitter_rpmspec_binding",
      "dependencies": [
        "<!(node -p \"require('node-addon-api').targets\"):node_addon_api_except",
      ],
      "include_dirs": [
        "rpmspec/src",
        "rpmbash/src",
      ],
      "sources": [
        "rpmspec/src/parser.c",
        "rpmspec/src/scanner.c",
        "rpmbash/src/parser.c",
        "rpmbash/src/scanner.c",
        "bindings/node/binding.cc",
        # NOTE: if your language has an external scanner, add it here.
      ],
      "cflags_c": [
        "-std=c11",
      ],
    }
  ]
}
