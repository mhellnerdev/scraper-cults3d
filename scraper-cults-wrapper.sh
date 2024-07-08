#!/bin/bash

BASE_DIR="/home/rocky/projects/scraper-cults3d"
NODE_BIN="/home/rocky/.nvm/versions/node/v22.3.0/bin/node"
SCRIPT_NAME="scraper-cults.js"

# Check if the correct number of arguments is passed
if [ "$#" -ne 2 ]; then
    echo "Usage: $0 <collection> <env>"
    exit 1
fi

COLLECTION=$1
ENV=$2

# Function to run the scraper script
run_scraper() {
    local collection=$1
    local env=$2
    local lockfile="/tmp/scraper-${collection}-${env}.lock"

    if [ -e $lockfile ]; then
        echo "Script for ${collection} in ${env} environment is already running."
        exit 1
    else
        touch $lockfile
        $NODE_BIN $BASE_DIR/$SCRIPT_NAME $collection $env
        rm $lockfile
    fi
}

# Run the scraper with the specified collection and environment
run_scraper $COLLECTION $ENV
