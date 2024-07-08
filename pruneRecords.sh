#!/bin/bash

TABLE_NAME="ScrapedModels"
COLLECTION="selected"
TIME_WINDOW=$(date -u -d '1 hour ago' +"%Y-%m-%dT%H:%M:%SZ")
AWS_REGION="us-east-1"

# Query DynamoDB for records with Collection type "selected" added in the last hour
ITEMS=$(aws dynamodb scan \
    --region $AWS_REGION \
    --table-name $TABLE_NAME \
    --filter-expression "#collection = :collection AND ScrapedAt >= :time_window" \
    --expression-attribute-names '{"#collection": "Collection"}' \
    --expression-attribute-values '{":collection":{"S":"'"$COLLECTION"'"}, ":time_window":{"S":"'"$TIME_WINDOW"'"}}' \
    --projection-expression "ModelURL, ScrapedAt")

# Extract ModelURLs and ScrapedAt from the query result
MODEL_URLS_AND_TIMES=$(echo $ITEMS | jq -r '.Items[] | {ModelURL: .ModelURL.S, ScrapedAt: .ScrapedAt.S}')

# Delete the records
for item in $(echo "${MODEL_URLS_AND_TIMES}" | jq -c '.'); do
    url=$(echo $item | jq -r '.ModelURL')
    time=$(echo $item | jq -r '.ScrapedAt')
    echo "Deleting item with ModelURL: $url and ScrapedAt: $time"
    aws dynamodb delete-item \
        --region $AWS_REGION \
        --table-name $TABLE_NAME \
        --key '{"ModelURL": {"S": "'"$url"'"}, "ScrapedAt": {"S": "'"$time"'"}}'
done

echo "Deleted records from the last hour with Collection type 'selected'."
