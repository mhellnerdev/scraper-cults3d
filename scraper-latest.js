const axios = require('axios');
const cheerio = require('cheerio');
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, QueryCommand, PutCommand } = require("@aws-sdk/lib-dynamodb");
const readline = require('readline');

const baseDomain = 'https://cults3d.com';
const collectionName = 'latest'; // Replace this with the desired collection name
const baseURL = `${baseDomain}/en/creations/${collectionName}/page/`;
const queryParams = '?only_free=true&sort=first_submitted_at';
const tableName = 'ScrapedModels'; // Replace with your table name

const autoStop = true; // Set to true to stop automatically when no new models are found on two consecutive pages

// ANSI escape codes for colors
const colors = {
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    red: '\x1b[31m',
    blue: '\x1b[36m',
    reset: '\x1b[0m'
};

// Create DynamoDB client
const client = new DynamoDBClient({ region: 'us-east-1' }); // Replace with your region
const dynamoDB = DynamoDBDocumentClient.from(client);

// Variable to store all scraped data
let allData = [];

// Counters for HTTP and DynamoDB requests
let httpRequestCount = 0;
let dynamoDBReadCount = 0;
let dynamoDBWriteCount = 0;
let alreadyCollectedCount = 0;

// Counter for consecutive pages with no new models
let noNewModelsCount = 0;

// Spinner animation frames
const spinnerFrames = ['|', '/', '-', '\\'];
let spinnerIndex = 0;

// Function to delay execution
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Function to update the persistent status line
function updateStatusLine() {
    const frame = spinnerFrames[spinnerIndex];
    spinnerIndex = (spinnerIndex + 1) % spinnerFrames.length;
    const status = `${frame} HTTP requests: ${httpRequestCount} | DynamoDB reads: ${dynamoDBReadCount} | DynamoDB writes: ${dynamoDBWriteCount}`;
    readline.cursorTo(process.stdout, 0);
    process.stdout.write(status);
    readline.clearLine(process.stdout, 1);
}

// Function to clear the status line and print final values
function clearStatusLine() {
    readline.clearLine(process.stdout, 0);
    readline.cursorTo(process.stdout, 0);
    console.log(`${colors.green}| HTTP requests: ${httpRequestCount} | DynamoDB reads: ${dynamoDBReadCount} | DynamoDB writes: ${dynamoDBWriteCount}${colors.reset}`);
}

// Function to check if an item exists in DynamoDB
async function itemExists(modelURL) {
    const params = {
        TableName: tableName,
        KeyConditionExpression: 'ModelURL = :url',
        ExpressionAttributeValues: {
            ':url': modelURL
        }
    };

    try {
        dynamoDBReadCount++; // Increment the read counter
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

// Function to insert data into DynamoDB
async function insertIntoDynamoDB(item) {
    const params = {
        TableName: tableName,
        Item: item
    };

    try {
        dynamoDBWriteCount++; // Increment the write counter
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

// Function to scrape data from each model page with retry logic
async function scrapeModelData(modelURL, retries = 3) {
    try {
        httpRequestCount++; // Increment the counter
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
        console.log(`${colors.red}[!!!] Error scraping model data from ${modelURL}: ${error.message}${colors.reset}`);
        updateStatusLine();
        if (retries > 0 && error.code === 'ECONNRESET') {
            await delay(4000);
            return scrapeModelData(modelURL, retries - 1);
        }
        return null;
    }
}

// Function to scrape data from the main page
async function scrapeMainPage(pageNum) {
    try {
        const pageURL = `${baseURL}${pageNum}${queryParams}`;
        readline.clearLine(process.stdout, 0);
        readline.cursorTo(process.stdout, 0);
        console.log(`${colors.blue}[*] Fetching main page: ${pageURL}${colors.reset}`);
        httpRequestCount++; // Increment the counter
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
        alreadyCollectedCount = 0; // Reset the counter for each page

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
            await delay(3000);
            updateStatusLine();
        }

        // Update noNewModelsCount based on whether new models were found
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

// Function to paginate and scrape multiple pages
async function scrapeMultiplePages(numPages) {
    const interval = setInterval(updateStatusLine, 100);
    for (let i = 1; i <= numPages; i++) {
        if (autoStop && noNewModelsCount >= 2) {
            readline.clearLine(process.stdout, 0);
            readline.cursorTo(process.stdout, 0);
            console.log(`${colors.blue}[*] No new models found on two consecutive pages. Stopping the script.${colors.reset}`);
            updateStatusLine();
            break;
        }
        const pageData = await scrapeMainPage(i);
        readline.clearLine(process.stdout, 0);
        readline.cursorTo(process.stdout, 0);
        console.log(`${colors.blue}[*] Page ${i} scraped. Total items collected: ${allData.length}${colors.reset}`);
        await delay(3000);
        updateStatusLine();
    }
    clearInterval(interval);
    clearStatusLine(); // Ensure final status update
}

// Function to handle process termination
async function handleProcessTermination() {
    clearStatusLine();
    console.log(`${colors.blue}[*] Process interrupted. Cleaning up...${colors.reset}`);
    console.log(`${colors.blue}[*] Total items collected: ${allData.length}${colors.reset}`);
    console.log(`${colors.blue}[*] Total HTTP requests: ${httpRequestCount}${colors.reset}`);
    console.log(`${colors.blue}[*] Total DynamoDB read requests: ${dynamoDBReadCount}${colors.reset}`);
    console.log(`${colors.blue}[*] Total DynamoDB write requests: ${dynamoDBWriteCount}${colors.reset}`);
    process.exit();
}

// Setup signal handlers for 'ctrl-c'
process.on('SIGINT', handleProcessTermination);
process.on('SIGTERM', handleProcessTermination);

// Scrape the first 10 pages
const numPages = 10; // Change this number to scrape more pages
scrapeMultiplePages(numPages);
