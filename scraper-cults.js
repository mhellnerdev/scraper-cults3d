const dotenv = require('dotenv');
const fs = require('fs');
const axios = require('axios');
const cheerio = require('cheerio');
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, QueryCommand, PutCommand } = require("@aws-sdk/lib-dynamodb");
const readline = require('readline');

// Determine environment and load the appropriate .env file
const args = process.argv.slice(2);
const collectionName = args[0]; // Example usage: node script.js latest dev
const environment = args[1]; // No default environment

if (!collectionName) {
    console.error('Please provide a collection name as an argument.');
    process.exit(1);
}

if (!environment) {
    console.error('Please provide an environment (prod or dev) as an argument.');
    process.exit(1);
}

const envFile = environment === 'dev' ? '.env-dev' : '.env';

if (fs.existsSync(envFile)) {
    console.log(`Loading environment variables from ${envFile}`);
    dotenv.config({ path: envFile });
} else {
    console.error(`Environment file ${envFile} not found. Exiting.`);
    process.exit(1);
}

// Load sensitive data from .env file based on collection name
const baseDomain = process.env[`${collectionName.toUpperCase()}_BASE_DOMAIN`];
const baseURL = process.env[`${collectionName.toUpperCase()}_BASE_URL`];
const queryParams = process.env[`${collectionName.toUpperCase()}_QUERY_PARAMS`];
const tableName = process.env.TABLE_NAME;

if (!baseDomain || !baseURL || !queryParams) {
    console.error('Invalid collection name or missing environment variables.');
    process.exit(1);
}

console.log(`Using table: ${tableName}`);
console.log(`Base URL: ${baseURL}`);

// Configuration variables
const autoStop = process.env.AUTO_STOP === 'true'; // Enable/disable auto stop
const autoStopPages = parseInt(process.env.AUTO_STOP_PAGES) || 2; // Number of consecutive pages with no new models to stop after

const httpDelayMs = parseInt(process.env.HTTP_DELAY_MS) || 3000; // HTTP delay between requests
const retryWaitMs = parseInt(process.env.RETRY_WAIT_MS) || 10000; // Wait time for HTTP 429 responses
const generalRetryCount = parseInt(process.env.GENERAL_RETRY_COUNT) || 3; // General retry count

const autoStopMessage = autoStop ? `[Auto Stop Enabled] - Pages with no new models to stop after: ${autoStopPages}` : '[Auto Stop Disabled]';
console.log(autoStopMessage);

const colors = {
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    red: '\x1b[31m',
    lightRed: '\x1b[91m',
    blue: '\x1b[36m',
    reset: '\x1b[0m'
};

const client = new DynamoDBClient({ region: process.env.AWS_REGION });
const dynamoDB = DynamoDBDocumentClient.from(client);

let allData = [];
let httpRequestCount = 0;
let dynamoDBReadCount = 0;
let dynamoDBWriteCount = 0;
let alreadyCollectedCount = 0;
let noNewModelsCount = 0;

const spinnerFrames = ['[|]', '[/]', '[-]', '[\\]'];
let spinnerIndex = 0;

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function updateStatusLine() {
    const frame = spinnerFrames[spinnerIndex];
    spinnerIndex = (spinnerIndex + 1) % spinnerFrames.length;
    const status = `${frame} HTTP requests: ${httpRequestCount} | DynamoDB reads: ${dynamoDBReadCount} | DynamoDB writes: ${dynamoDBWriteCount}`;
    readline.cursorTo(process.stdout, 0);
    process.stdout.write(status);
    readline.clearLine(process.stdout, 1);
}

function clearStatusLine() {
    readline.clearLine(process.stdout, 0);
    readline.cursorTo(process.stdout, 0);
    console.log(`${colors.green}| HTTP requests: ${httpRequestCount} | DynamoDB reads: ${dynamoDBReadCount} | DynamoDB writes: ${dynamoDBWriteCount}${colors.reset}`);
}

async function itemExists(modelURL) {
    const params = {
        TableName: tableName,
        KeyConditionExpression: 'ModelURL = :url',
        ExpressionAttributeValues: {
            ':url': modelURL
        }
    };

    try {
        dynamoDBReadCount++;
        updateStatusLine();
        const result = await dynamoDB.send(new QueryCommand(params));
        return result.Items && result.Items.length > 0;
    } catch (error) {
        readline.clearLine(process.stdout, 0);
        readline.cursorTo(process.stdout, 0);
        console.log(`${colors.red}[!!!] Error querying DynamoDB: ${error.message}${colors.reset}`);
        updateStatusLine();
        return false;
    }
}

async function insertIntoDynamoDB(item) {
    const params = {
        TableName: tableName,
        Item: item
    };

    try {
        dynamoDBWriteCount++;
        updateStatusLine();
        await dynamoDB.send(new PutCommand(params));
        readline.clearLine(process.stdout, 0);
        readline.cursorTo(process.stdout, 0);
        console.log(`${colors.green}[+] Successfully inserted to ${tableName}: ${item.ModelURL}${colors.reset}`);
        updateStatusLine();
    } catch (error) {
        readline.clearLine(process.stdout, 0);
        readline.cursorTo(process.stdout, 0);
        console.log(`${colors.red}[!!!] Error inserting data into DynamoDB: ${error.message}${colors.reset}`);
        updateStatusLine();
    }
}

async function scrapeModelData(modelURL, retries = generalRetryCount) {
    try {
        httpRequestCount++;
        updateStatusLine();
        const response = await axios.get(modelURL);
        const $ = cheerio.load(response.data);

        const modelName = $('.t0').text().trim();
        const author = $('.card__title--secondary').text().trim();
        let license = $('.link--strong.ml-0\\.25').first().text().trim();

        if (license.includes('\n')) {
            license = license.split('\n')[0].trim();
        }

        readline.clearLine(process.stdout, 0);
        readline.cursorTo(process.stdout, 0);
        console.log(`${colors.green}[+] Scraped model data: ${modelName}, ${author}, ${license}${colors.reset}`);
        updateStatusLine();

        const item = {
            ModelURL: modelURL,
            ModelName: modelName,
            Author: author,
            License: license,
            Collection: collectionName,
            Source: new URL(modelURL).hostname,
            ScrapedAt: new Date().toISOString()
        };

        return item;
    } catch (error) {
        readline.clearLine(process.stdout, 0);
        readline.cursorTo(process.stdout, 0);
        if (error.response && error.response.status === 429) {
            console.log(`${colors.lightRed}[!] HTTP 429 Too Many Requests: Waiting ${retryWaitMs / 1000} seconds before retrying${colors.reset}`);
            updateStatusLine();
            await delay(retryWaitMs);
            if (retries > 0) {
                return scrapeModelData(modelURL, retries - 1);
            }
        } else {
            console.log(`${colors.red}[!!!] Error scraping model data from ${modelURL}: ${error.message}${colors.reset}`);
        }
        updateStatusLine();
        return null;
    }
}

async function scrapeMainPage(pageNum) {
    try {
        const pageURL = `${baseURL}${pageNum}${queryParams}`;
        readline.clearLine(process.stdout, 0);
        readline.cursorTo(process.stdout, 0);
        console.log(`${colors.blue}[*] Fetching main page: ${pageURL}${colors.reset}`);
        httpRequestCount++;
        updateStatusLine();
        const response = await axios.get(pageURL);
        const $ = cheerio.load(response.data);

        const modelLinks = $('div.crea-group a').map((index, element) => {
            return $(element).attr('href');
        }).get().map(link => `${baseDomain}${link}`);

        readline.clearLine(process.stdout, 0);
        readline.cursorTo(process.stdout, 0);
        console.log(`${colors.blue}[*] Found ${modelLinks.length} model links on page ${pageNum}${colors.reset}`);
        updateStatusLine();

        const existingURLsSet = new Set();
        alreadyCollectedCount = 0;

        for (const link of modelLinks) {
            if (await itemExists(link)) {
                existingURLsSet.add(link);
                alreadyCollectedCount++;
            }
        }

        const newModelLinks = modelLinks.filter(url => !existingURLsSet.has(url));

        readline.clearLine(process.stdout, 0);
        readline.cursorTo(process.stdout, 0);
        console.log(`${colors.yellow}[!] ${alreadyCollectedCount} models already indexed${colors.reset}`);
        readline.clearLine(process.stdout, 0);
        readline.cursorTo(process.stdout, 0);
        console.log(`${colors.blue}[*] ${newModelLinks.length} new models to index${colors.reset}`);
        updateStatusLine();

        const pageData = [];

        for (const link of newModelLinks) {
            const modelData = await scrapeModelData(link);
            if (modelData) {
                pageData.push(modelData);
                await insertIntoDynamoDB(modelData);
                allData.push(modelData);
            }
            await delay(httpDelayMs);
            updateStatusLine();
        }

        if (newModelLinks.length === 0) {
            noNewModelsCount++;
        } else {
            noNewModelsCount = 0;
        }

        return pageData;
    } catch (error) {
        readline.clearLine(process.stdout, 0);
        readline.cursorTo(process.stdout, 0);
        console.log(`${colors.red}[!!!] Error scraping main page: ${error.message}${colors.reset}`);
        updateStatusLine();
        return [];
    }
}

async function scrapeMultiplePages(numPages) {
    const interval = setInterval(updateStatusLine, 100);
    for (let i = 1; i <= numPages; i++) {
        if (autoStop && noNewModelsCount >= autoStopPages) {
            readline.clearLine(process.stdout, 0);
            readline.cursorTo(process.stdout, 0);
            console.log(`${colors.blue}[*] No new models found on ${autoStopPages} consecutive pages. Stopping the script.${colors.reset}`);
            updateStatusLine();
            break;
        }
        const pageData = await scrapeMainPage(i);
        readline.clearLine(process.stdout, 0);
        readline.cursorTo(process.stdout, 0);
        console.log(`${colors.blue}[*] Page ${i} scraped. Total items collected: ${allData.length}${colors.reset}`);
        await delay(httpDelayMs);
        updateStatusLine();
    }
    clearInterval(interval);
    clearStatusLine();
}

async function handleProcessTermination() {
    clearStatusLine();
    console.log(`${colors.blue}[*] Process interrupted. Cleaning up...${colors.reset}`);
    console.log(`${colors.blue}[*] Total items collected: ${allData.length}${colors.reset}`);
    console.log(`${colors.blue}[*] Total HTTP requests: ${httpRequestCount}${colors.reset}`);
    console.log(`${colors.blue}[*] Total DynamoDB read requests: ${dynamoDBReadCount}${colors.reset}`);
    console.log(`${colors.blue}[*] Total DynamoDB write requests: ${dynamoDBWriteCount}${colors.reset}`);
    process.exit();
}

process.on('SIGINT', handleProcessTermination);
process.on('SIGTERM', handleProcessTermination);

const numPages = 10;
scrapeMultiplePages(numPages);
