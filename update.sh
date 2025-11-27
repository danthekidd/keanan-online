#!/bin/bash
cat /mnt/index.html > index.html
cat /mnt/script.js > script.js
cat /mnt/styles.css > styles.css
git add .
git status
git commit -m "new commit"
git push
