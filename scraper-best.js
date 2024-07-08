const axios = require('axios');
const cheerio = require('cheerio');
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, QueryCommand, PutCommand } = require("@aws-sdk/lib-dynamodb");
const readline = require('readline');

const baseDomain = 'https://cults3d.com';
const baseURL = `${baseDomain}/en/guides/best-STL-files?page=`;
const queryParams = '';
const tableName = 'best-STL-files'; // Updated table name

// ANSI escape codes for colors
const colors = {
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    red: '\x1b[31m',
    blue: '\x1b[36m',
    reset: '\x1b[0m'
};

// Variable to store all scraped data
let allData = [];
let processedLinks = new Set();
let alreadyCollectedCount = 0; // Count of already collected models

// Counters for HTTP and DynamoDB requests
let httpRequestCount = 0;
let dynamoDBReadCount = 0;
let dynamoDBWriteCount = 0;

// Counter for consecutive pages with no new models
let noNewModelsCount = 0;
const autoStop = false; // Set this to false to disable auto-stop

// Spinner animation frames
const spinnerFrames = ['[|]', '[/]', '[-]', '[\\]'];
let spinnerIndex = 0;

// Create DynamoDB client
const client = new DynamoDBClient({ region: 'us-east-1' }); // Replace with your region
const dynamoDB = DynamoDBDocumentClient.from(client);

// Function to delay execution
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Function to update the persistent status line
function updateStatusLine() {
    const frame = spinnerFrames[spinnerIndex];
    spinnerIndex = (spinnerIndex + 1) % spinnerFrames.length;
    const status = `${colors.green}${frame} HTTP requests: ${httpRequestCount} | DynamoDB reads: ${dynamoDBReadCount} | DynamoDB writes: ${dynamoDBWriteCount}${colors.reset}`;
    readline.clearLine(process.stdout, 0);
    readline.cursorTo(process.stdout, 0);
    process.stdout.write(status);
    readline.clearLine(process.stdout, 1);
}

// Function to clear the status line and print final values
function clearStatusLine() {
    readline.clearLine(process.stdout, 0);
    readline.cursorTo(process.stdout, 0);
    console.log(`${colors.green}[${spinnerFrames[spinnerIndex % spinnerFrames.length]}] HTTP requests: ${httpRequestCount} | DynamoDB reads: ${dynamoDBReadCount} | DynamoDB writes: ${dynamoDBWriteCount}${colors.reset}`);
}

// Function to extract month and year from text and convert month to two-digit number
function extractMonthYear(text) {
    const months = {
        'january': '01', 'february': '02', 'march': '03', 'april': '04', 'may': '05', 'june': '06',
        'july': '07', 'august': '08', 'september': '09', 'october': '10', 'november': '11', 'december': '12'
    };
    const lowerText = text.toLowerCase();
    for (const [month, number] of Object.entries(months)) {
        if (lowerText.includes(month)) {
            const yearMatch = lowerText.match(/\b\d{4}\b/);
            if (yearMatch) {
                return {
                    month: number,
                    year: yearMatch[0]
                };
            }
        }
    }
    return null;
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
async function scrapeModelData(modelURL, subCollectionName, retries = 3) {
    if (await itemExists(modelURL)) {
        alreadyCollectedCount++;
        return null;
    }

    processedLinks.add(modelURL);

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
            Collection: 'best-stl',
            SubCollection: subCollectionName,
            Source: new URL(modelURL).hostname,
            ScrapedAt: new Date().toISOString()
        };

        await insertIntoDynamoDB(item);

        await delay(3000); // Delay before the next HTTP request

        return item;
    } catch (error) {
        readline.clearLine(process.stdout, 0);
        readline.cursorTo(process.stdout, 0);
        console.log(`${colors.red}[!!!] Error scraping model data from ${modelURL}: ${error.message}${colors.reset}`);
        updateStatusLine();
        if (retries > 0 && (error.code === 'ECONNRESET' || error.response && error.response.status === 429)) {
            await delay(10000); // Delay before retrying
            if (error.response && error.response.status === 429) {
                readline.clearLine(process.stdout, 0);
                readline.cursorTo(process.stdout, 0);
                console.log(`${colors.red}[!!!] 429 Too Many Requests. Pausing for 10 seconds...${colors.reset}`);
                updateStatusLine();
            }
            return scrapeModelData(modelURL, subCollectionName, retries - 1);
        }
        return null;
    }
}

// Function to scrape data from the main page with retry logic
async function scrapeMainPage(pageNum, retries = 3) {
    try {
        const pageURL = `${baseURL}${pageNum}${queryParams}`;
        readline.clearLine(process.stdout, 0);
        readline.cursorTo(process.stdout, 0);
        console.log(`${colors.blue}[*] Fetching main page: ${pageURL}${colors.reset}`);
        httpRequestCount++; // Increment the counter
        updateStatusLine();
        const response = await axios.get(pageURL);
        const $ = cheerio.load(response.data);

        const pageData = [];
        let currentSubCollectionName = '';
        alreadyCollectedCount = 0; // Reset the counter for each page

        const elements = $('h2.t1, div.grid-cell, nav.pagination').toArray();
        const modelLinks = [];

        for (const element of elements) {
            if ($(element).is('h2.t1')) {
                const headerText = $(element).text().trim();
                const monthYear = extractMonthYear(headerText);
                if (monthYear) {
                    currentSubCollectionName = `${monthYear.year}-${monthYear.month}`;
                    readline.clearLine(process.stdout, 0);
                    readline.cursorTo(process.stdout, 0);
                    console.log(`${colors.blue}[*] Scraping models for: ${monthYear.month} ${monthYear.year}${colors.reset}`);
                    updateStatusLine();
                }
            } else if ($(element).is('div.grid-cell')) {
                const modelLink = $(element).find('a').attr('href');
                if (modelLink && modelLink.startsWith('/')) {
                    modelLinks.push(`${baseDomain}${modelLink}`);
                }
            } else if ($(element).is('nav.pagination')) {
                // Stop processing further elements on the page once we hit the pagination
                break;
            }
        }

        readline.clearLine(process.stdout, 0);
        readline.cursorTo(process.stdout, 0);
        console.log(`${colors.blue}[*] Found ${modelLinks.length} model links on page ${pageNum}${colors.reset}`);
        updateStatusLine();

        const newModelLinks = [];

        for (const link of modelLinks) {
            if (await itemExists(link)) {
                alreadyCollectedCount++;
            } else {
                newModelLinks.push(link);
            }
        }

        readline.clearLine(process.stdout, 0);
        readline.cursorTo(process.stdout, 0);
        console.log(`${colors.yellow}[!] ${alreadyCollectedCount} models already indexed${colors.reset}`);
        readline.clearLine(process.stdout, 0);
        readline.cursorTo(process.stdout, 0);
        console.log(`${colors.blue}[*] ${newModelLinks.length} new models to index${colors.reset}`);
        updateStatusLine();

        for (const link of newModelLinks) {
            const modelData = await scrapeModelData(link, currentSubCollectionName);
            if (modelData) {
                pageData.push(modelData);
                allData.push(modelData);
            }
        }

        // Update noNewModelsCount based on whether new models were found
        if (pageData.length === 0) {
            noNewModelsCount++;
        } else {
            noNewModelsCount = 0;
        }

        await delay(3000); // Delay before the next main page request

        return pageData;
    } catch (error) {
        readline.clearLine(process.stdout, 0);
        readline.cursorTo(process.stdout, 0);
        console.log(`${colors.red}[!!!] Error scraping main page: ${error.message}${colors.reset}`);
        updateStatusLine();
        if (retries > 0) {
            await delay(5000); // Delay before retrying
            return scrapeMainPage(pageNum, retries - 1);
        }
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
    process.exit();
}

// Setup signal handlers for 'ctrl-c'
process.on('SIGINT', handleProcessTermination);
process.on('SIGTERM', handleProcessTermination);

// Scrape the first 10 pages
const numPages = 10; // Change this number to scrape more pages
scrapeMultiplePages(numPages);
