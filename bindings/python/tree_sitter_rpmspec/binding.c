#include <Python.h>

typedef struct TSLanguage TSLanguage;

TSLanguage *tree_sitter_rpmspec(void);
TSLanguage *tree_sitter_rpmbash(void);

static PyObject* _binding_language_rpmspec(PyObject *Py_UNUSED(self), PyObject *Py_UNUSED(args)) {
    return PyCapsule_New(tree_sitter_rpmspec(), "tree_sitter.Language", NULL);
}

static PyObject* _binding_language_rpmbash(PyObject *Py_UNUSED(self), PyObject *Py_UNUSED(args)) {
    return PyCapsule_New(tree_sitter_rpmbash(), "tree_sitter.Language", NULL);
}

static struct PyModuleDef_Slot slots[] = {
#ifdef Py_GIL_DISABLED
    {Py_mod_gil, Py_MOD_GIL_NOT_USED},
#endif
    {0, NULL}
};

static PyMethodDef methods[] = {
    {"rpmspec", _binding_language_rpmspec, METH_NOARGS,
     "Get the tree-sitter language for rpmspec."},
    {"rpmbash", _binding_language_rpmbash, METH_NOARGS,
     "Get the tree-sitter language for rpmbash."},
    {"language", _binding_language_rpmspec, METH_NOARGS,
     "Get the tree-sitter language for this grammar."},
    {NULL, NULL, 0, NULL}
};

static struct PyModuleDef module = {
    .m_base = PyModuleDef_HEAD_INIT,
    .m_name = "_binding",
    .m_doc = NULL,
    .m_size = 0,
    .m_methods = methods,
    .m_slots = slots,
};

PyMODINIT_FUNC PyInit__binding(void) {
    return PyModuleDef_Init(&module);
}
