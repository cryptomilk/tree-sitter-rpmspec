%{lua:
local name = rpm.expand("%{name}")
local version = rpm.expand("%{version}")
print(name .. "-" .. version)
}
