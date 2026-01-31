%build
if ! diff -u file1 file2; then
    echo "Different"
fi
