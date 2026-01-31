%description
Main description text.
%if 0%{?stable}
Built from %(c=%version; echo "v${c%.*}-stable") branch.
%endif
