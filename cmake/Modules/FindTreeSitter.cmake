#[=======================================================================[.rst:
FindTreeSitter
--------------

Find the tree-sitter library.

This module uses pkg-config to find tree-sitter and defines:

Imported Targets
^^^^^^^^^^^^^^^^

This module defines the following :prop_tgt:`IMPORTED` targets:

``TreeSitter::TreeSitter``
  The tree-sitter library, if found.

Result Variables
^^^^^^^^^^^^^^^^

This module will set the following variables in your project:

``TreeSitter_FOUND``
  True if tree-sitter was found.

``TreeSitter_VERSION``
  The version of tree-sitter found.

``TreeSitter_INCLUDE_DIRS``
  Include directories needed to use tree-sitter.

``TreeSitter_LIBRARIES``
  Libraries needed to link to tree-sitter.

``TreeSitter_LIBRARY_DIRS``
  Library directories for tree-sitter.

Cache Variables
^^^^^^^^^^^^^^^

The following cache variables may also be set:

``TreeSitter_INCLUDE_DIR``
  The directory containing ``tree_sitter/api.h``.

``TreeSitter_LIBRARY``
  The path to the tree-sitter library.

#]=======================================================================]

find_package(PkgConfig QUIET)

if(PKG_CONFIG_FOUND)
    pkg_check_modules(PC_TreeSitter QUIET tree-sitter)
endif()

# Find the header file
find_path(TreeSitter_INCLUDE_DIR
    NAMES tree_sitter/api.h
    HINTS
        ${PC_TreeSitter_INCLUDE_DIRS}
        ${PC_TreeSitter_INCLUDEDIR}
    PATH_SUFFIXES include
)

# Find the library
find_library(TreeSitter_LIBRARY
    NAMES tree-sitter
    HINTS
        ${PC_TreeSitter_LIBRARY_DIRS}
        ${PC_TreeSitter_LIBDIR}
    PATH_SUFFIXES lib
)

# Extract version from pkg-config if available
if(PC_TreeSitter_VERSION)
    set(TreeSitter_VERSION ${PC_TreeSitter_VERSION})
endif()

# Handle standard arguments
include(FindPackageHandleStandardArgs)
find_package_handle_standard_args(TreeSitter
    REQUIRED_VARS
        TreeSitter_LIBRARY
        TreeSitter_INCLUDE_DIR
    VERSION_VAR TreeSitter_VERSION
)

# Set output variables
if(TreeSitter_FOUND)
    set(TreeSitter_LIBRARIES ${TreeSitter_LIBRARY})
    set(TreeSitter_INCLUDE_DIRS ${TreeSitter_INCLUDE_DIR})
    set(TreeSitter_LIBRARY_DIRS ${PC_TreeSitter_LIBRARY_DIRS})

    # Create imported target
    if(NOT TARGET TreeSitter::TreeSitter)
        add_library(TreeSitter::TreeSitter UNKNOWN IMPORTED)
        set_target_properties(TreeSitter::TreeSitter PROPERTIES
            IMPORTED_LOCATION "${TreeSitter_LIBRARY}"
            INTERFACE_INCLUDE_DIRECTORIES "${TreeSitter_INCLUDE_DIR}"
        )
    endif()
endif()

# Mark cache variables as advanced
mark_as_advanced(
    TreeSitter_INCLUDE_DIR
    TreeSitter_LIBRARY
)
