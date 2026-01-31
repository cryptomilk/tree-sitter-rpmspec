%if %{defined with_foo} && %{undefined with_bar}
BuildRequires:  foo
%endif
