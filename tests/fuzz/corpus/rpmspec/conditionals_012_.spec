%if 0%{?fedora}
BuildRequires:  foo
%elif 0%{?rhel}
BuildRequires:  bar
%else
BuildRequires:  wurst
%endif
