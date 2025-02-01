# 🕷️ Scraper Cults3D ![Docker](https://img.shields.io/badge/Docker-✓-blue) ![Node.js](https://img.shields.io/badge/Node.js-18+-green)

Efficient web scraper for Cults3D platform with Docker support and AWS DynamoDB integration. Automates data collection and provides tools for database management.

## Features

- **Dockerized scraping** with two configurations: `latest` and `selected`
- AWS DynamoDB integration for data storage
- Duplicate record management and pruning utilities
- Environment-specific configurations (production/development)
- Automated scraping workflows via shell scripts

## Project Structure

```bash
├── Docker/              # Docker configurations
│   ├── Dockerfile.latest     # Full scrape of latest models
│   └── Dockerfile.selected   # Targeted scrape of specific models
├── scripts/            # Automation scripts
│   ├── pruneRecords.sh          # DynamoDB record maintenance
│   ├── scraper-*-wrapper.sh     # Scraper entrypoints
│   └── dynamodb_duplicate_killer.js  # Duplicate removal tool
├── src/                # Core scraper logic
│   ├── scraper-best.js        # Best-of scraping
│   ├── scraper-cults.js       # Main scraping logic
│   ├── scraper-latest.js      # Latest models scraper
│   └── scraper-selected.js    # Selected models scraper
├── .env                # Environment configurations
├── .env-dev            # Development environment
└── package.json        # Node.js dependencies
```

## 🚀 Getting Started

### Prerequisites

- Node.js 18+
- Docker Engine 20+
- AWS account with DynamoDB access

### Installation

```bash
git clone https://github.com/mhellnderdeb/scraper-cults3d.git
cd scraper-cults3d

# Install dependencies
npm install

# Copy environment template
cp .env-example .env
```

### Configuration

#### Environment Variables
Update `.env` with your credentials:
```ini
AWS_ACCESS_KEY_ID=your_key
AWS_SECRET_ACCESS_KEY=your_secret
AWS_REGION=us-west-1
DYNAMODB_TABLE=cults3d-data
SCRAPER_MODE=production
```

#### AWS Setup
1. Create DynamoDB table with name matching `DYNAMODB_TABLE`
2. Configure IAM user with DynamoDB read/write permissions

## Usage

### Scraper Modes

| Mode       | Command                     | Description                     |
|------------|-----------------------------|---------------------------------|
| Latest     | `./scraper-latest-wrapper.sh` | Scrape newest models           |
| Selected   | `./scraper-selected-wrapper.sh` | Scrape specific model IDs      |
| Best       | `./scraper-best-wrapper.sh`   | Scrape top-rated models        |

### Docker Operations

```bash
# Build both images
docker build -t cults3d-latest -f Dockerfile.latest .
docker build -t cults3d-selected -f Dockerfile.selected .

# Run latest scraper
docker run --env-file .env cults3d-latest
```

### Database Maintenance

```bash
# Remove duplicate records
node scripts/dynamodb_duplicate_killer.js

# Prune old records (30+ days)
./scripts/pruneRecords.sh
```

## 🤝 Contributing

1. Fork the repository
2. Create feature branch: `git checkout -b feature/new-scraper`
3. Commit changes: `git commit -am 'Add new scraper feature'`
4. Push branch: `git push origin feature/new-scraper`
5. Submit pull request

**Before contributing:**
- Run tests: `npm test`

> **Note:** Create a `models.list` file with target model IDs (one per line) before running the selected scraper.