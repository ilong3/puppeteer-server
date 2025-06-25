# Express Puppeteer Server

This is a simple Express server that uses Puppeteer for web scraping and returns JSON responses.

## Setup

1. Install dependencies:
```bash
npm install
```

2. Start the server:
```bash
node index.js
```

The server will start on http://localhost:3000

## Available Endpoints

### POST /scrape
Scrapes the provided URL and returns the page title and URL as a JSON response.

Request body:
```json
{
    "url": "https://example.com"
}
```

Example response:
```json
{
    "success": true,
    "data": {
        "title": "Example Domain",
        "url": "https://example.com",
        "timestamp": "2024-03-14T12:00:00.000Z"
    }
}
```

## Features

- Express server with JSON response handling
- Puppeteer integration for web scraping
- Dynamic URL handling through POST requests
- Proper browser instance management
- Error handling
- Clean shutdown handling

## Testing with Postman

1. Open Postman
2. Create a new POST request to `http://localhost:3000/scrape`
3. Set the request body to raw JSON
4. Add the following JSON:
```json
{
    "url": "https://example.com"
}
```
5. Send the request to get the scraped data 