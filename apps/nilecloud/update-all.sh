#!/bin/bash
 
set -e
 
FOLDERS=(
  "$HOME/nilecloud-one"
  "$HOME/nilecloud-two"
  "$HOME/nilecloud-three"
)
 
for FOLDER in "${FOLDERS[@]}"; do
  echo ">>> $FOLDER"
  cd "$FOLDER"
  bash apps/nilecloud/update.sh
  echo ""
done
