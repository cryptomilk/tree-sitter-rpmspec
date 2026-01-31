%check
make test

%if !%{with testsuite}
%post
%systemd_post samba.service
%endif
