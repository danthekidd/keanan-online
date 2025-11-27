#!/bin/bash
cat /mnt/index.html > index.html
git add .
git status
git commit -m "new commit"
git push
