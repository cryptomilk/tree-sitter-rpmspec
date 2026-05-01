#include <napi.h>

typedef struct TSLanguage TSLanguage;

extern "C" TSLanguage *tree_sitter_rpmspec();
extern "C" TSLanguage *tree_sitter_rpmbash();

// "tree-sitter", "language" hashed with BLAKE2
const napi_type_tag LANGUAGE_TYPE_TAG = {
  0x8AF2E5212AD58ABF, 0xD5006CAD83ABBA16
};

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports["name"] = Napi::String::New(env, "rpmspec");

    auto rpmspec = Napi::External<TSLanguage>::New(env, tree_sitter_rpmspec());
    rpmspec.TypeTag(&LANGUAGE_TYPE_TAG);
    exports["rpmspec"] = rpmspec;

    auto rpmbash = Napi::External<TSLanguage>::New(env, tree_sitter_rpmbash());
    rpmbash.TypeTag(&LANGUAGE_TYPE_TAG);
    exports["rpmbash"] = rpmbash;

    // For backward compatibility
    exports["language"] = rpmspec;

    return exports;
}

NODE_API_MODULE(tree_sitter_rpmspec_binding, Init)
