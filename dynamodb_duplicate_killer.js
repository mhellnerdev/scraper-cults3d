const { DynamoDBClient, ScanCommand, DeleteCommand } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, ScanCommand: DocScanCommand } = require('@aws-sdk/lib-dynamodb');

const client = new DynamoDBClient({ region: 'us-east-1' });
const dynamoDB = DynamoDBDocumentClient.from(client);
const tableName = 'ScrapedModels';

async function getItems() {
  const params = {
    TableName: tableName,
  };

  const items = [];
  let data;

  do {
    data = await dynamoDB.send(new DocScanCommand(params));
    items.push(...data.Items);
    params.ExclusiveStartKey = data.LastEvaluatedKey;
  } while (typeof data.LastEvaluatedKey !== 'undefined');

  return items;
}

function findDuplicates(items) {
  const partitionKey = 'ModelURL';
  const duplicates = new Map();

  for (const item of items) {
    const key = item[partitionKey];
    if (!key) {
      continue; // Skip items with undefined keys
    }
    if (!duplicates.has(key)) {
      duplicates.set(key, []);
    }
    duplicates.get(key).push(item);
  }

  // Filter out non-duplicates
  for (const [key, value] of duplicates) {
    if (value.length <= 1) {
      duplicates.delete(key);
    }
  }

  return duplicates;
}

async function promptToDelete(duplicates) {
  const { default: inquirer } = await import('inquirer');
  const toDelete = [];

  for (const [key, items] of duplicates) {
    console.log(`ModelURL: ${key}`);
    const choices = items.map((item, index) => ({
      name: `ModelName: ${item.ModelName} (ScrapedAt: ${item.ScrapedAt})`,
      value: index,
    }));
    const answer = await inquirer.prompt([
      {
        type: 'checkbox',
        name: 'selected',
        message: `Select duplicates to delete for ModelURL = ${key}:`,
        choices,
      },
    ]);

    for (const index of answer.selected) {
      toDelete.push(items[index]);
    }
  }

  return toDelete;
}

async function deleteItems(items) {
  for (const item of items) {
    const params = {
      TableName: tableName,
      Key: {
        ModelURL: item.ModelURL,
        ScrapedAt: item.ScrapedAt,
      },
    };

    await dynamoDB.send(new DeleteCommand(params));
    console.log(`Deleted item with ModelURL = ${item.ModelURL} and ScrapedAt = ${item.ScrapedAt}`);
  }
}

async function main() {
  try {
    const items = await getItems();
    console.log(`Retrieved ${items.length} items from the table.`);

    const duplicates = findDuplicates(items);
    console.log(`Found ${duplicates.size} duplicate items.`);

    if (duplicates.size > 0) {
      const toDelete = await promptToDelete(duplicates);
      if (toDelete.length > 0) {
        await deleteItems(toDelete);
        console.log('Selected duplicates have been deleted.');
      } else {
        console.log('No items were deleted.');
      }
    } else {
      console.log('No duplicates found.');
    }
  } catch (error) {
    console.error('Error:', error);
  }
}

main();
