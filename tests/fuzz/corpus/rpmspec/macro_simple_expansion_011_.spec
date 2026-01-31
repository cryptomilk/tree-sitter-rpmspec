%install
echo test
%make_install
find %{buildroot} -name foo

%files -n lib%{name}
%license LICENSE
