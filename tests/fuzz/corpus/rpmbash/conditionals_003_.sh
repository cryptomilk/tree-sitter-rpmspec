%if 0%{?fedora}
echo fedora
%elif 0%{?rhel}
echo rhel
%else
echo other
%endif
