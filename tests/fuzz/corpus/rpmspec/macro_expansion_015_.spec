%prep
%setup -q -n "package name with spaces"
%patch0 -p1 -b "file.bak"
