%package udev
Summary: Test
License: MIT
Requires: foo
%if 0%{?fedora}
Requires: bar
%endif
Conflicts: baz
