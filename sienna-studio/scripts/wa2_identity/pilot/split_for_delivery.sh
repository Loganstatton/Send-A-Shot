#!/bin/bash
# Splits a verified checkpoint into parts under the 30 MB chat-upload limit, so the owner holds a copy outside the cloud.
# Writes <name>.partNN + <name>.sha256 + REASSEMBLE.txt, and proves the parts reassemble to the identical file before
# anything is sent. Usage: split_for_delivery.sh <file> <out_dir>
set -euo pipefail
F=$1; O=$2; N=$(basename "$F"); mkdir -p "$O"
(cd "$(dirname "$F")" && sha256sum "$N") > "$O/$N.sha256"
split -b 28M -d -a 2 "$F" "$O/$N.part"
cat "$O/$N".part* > "$O/.check_$N"
[ "$(sha256sum < "$O/.check_$N" | cut -d' ' -f1)" = "$(cut -d' ' -f1 "$O/$N.sha256")" ] || { echo "REASSEMBLY MISMATCH"; rm -f "$O/.check_$N"; exit 1; }
rm -f "$O/.check_$N"
cat > "$O/REASSEMBLE.txt" <<EOF
Rebuild $N from its parts (same folder):
  macOS / Linux:  cat $N.part* > $N && shasum -a 256 -c $N.sha256
  Windows (cmd):  copy /b $(ls "$O" | grep "^$N.part" | tr '\n' '+' | sed 's/+$//') $N
                  certutil -hashfile $N SHA256    (compare with $N.sha256)
EOF
echo "OK $(ls "$O"/$N.part* | wc -l) parts, reassembly verified"
