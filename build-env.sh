#!/bin/bash
# Build environment setup for rust-ssh-agent
# Source this file before running cargo/tauri commands
# Usage: source build-env.sh

MSVC_VER="14.44.35207"
SDK_VER="10.0.26100.0"
MSVC_BASE="C:\\Program Files (x86)\\Microsoft Visual Studio\\2022\\BuildTools\\VC\\Tools\\MSVC\\${MSVC_VER}"
SDK_BASE="C:\\Program Files (x86)\\Windows Kits\\10"

export PATH="$HOME/.cargo/bin:$PATH"
export PATH="$HOME/AppData/Local/bin/NASM:$PATH"
export PATH="${MSVC_BASE}\\bin\\Hostx64\\x64:$PATH"
export PATH="${SDK_BASE}\\bin\\${SDK_VER}\\x64:$PATH"

export LIB="${MSVC_BASE}\\lib\\x64;${SDK_BASE}\\Lib\\${SDK_VER}\\ucrt\\x64;${SDK_BASE}\\Lib\\${SDK_VER}\\um\\x64"
export INCLUDE="${MSVC_BASE}\\include;${SDK_BASE}\\Include\\${SDK_VER}\\ucrt;${SDK_BASE}\\Include\\${SDK_VER}\\um;${SDK_BASE}\\Include\\${SDK_VER}\\shared"
