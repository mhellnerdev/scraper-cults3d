#!/bin/bash

LOCKFILE="/tmp/scraper-selected.lock"

if [ -e $LOCKFILE ]; then
    echo "Script is already running."
    exit 1
else
    touch $LOCKFILE
    /home/rocky/.nvm/versions/node/v22.3.0/bin/node /home/rocky/projects/scraper-cults3d/scraper-selected.js
    rm $LOCKFILE
fi
