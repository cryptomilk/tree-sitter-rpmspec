%prep
%patch 0 -p 1 -b .backup -F 2 -E
%patch -P 2 -R -z .old
