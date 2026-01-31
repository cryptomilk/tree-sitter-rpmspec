%if 0%{?with_tests}
make %{?_smp_mflags} check
%endif
