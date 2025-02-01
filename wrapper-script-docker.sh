#!/bin/bash

BASE_DIR="/usr/src/app"
NODE_BIN="/usr/local/bin/node"
SCRIPT_NAME="scraper-cults.js"
ENV_FILE="$BASE_DIR/.env"

# Check if the correct number of arguments is passed
if [ "$#" -ne 2 ]; then
    echo "Usage: $0 <collection> <env>"
    exit 1
fi

COLLECTION=$1
ENV=$2

# Ensure log directory exists
LOG_DIR="$BASE_DIR/logs"
mkdir -p $LOG_DIR

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
        cd $BASE_DIR
        if [ -e $ENV_FILE ]; then
            $NODE_BIN $SCRIPT_NAME $collection $env
            if [ $? -ne 0 ]; then
                echo "Error running script for ${collection} in ${env} environment."
            fi
        else
            echo "Environment file $ENV_FILE not found. Exiting."
        fi
        rm $lockfile
    fi
}

# Run the scraper with the specified collection and environment
run_scraper $COLLECTION $ENV
