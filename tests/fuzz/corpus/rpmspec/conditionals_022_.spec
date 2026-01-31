%files passkey
/usr/bin/passkey

%if %{use_sssd_user}
%pre common
echo hello
%endif
