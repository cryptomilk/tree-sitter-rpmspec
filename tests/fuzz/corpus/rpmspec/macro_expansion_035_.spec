%define compat() \
%if "%{name}" != "foo" \
Provides: %1 \
%endif
