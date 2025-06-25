import express from 'express';
import puppeteer from 'puppeteer';

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Configuration
const CONFIG = {
  PORT: 3000,
  SELECTORS: {
    MORE_ACTIONS: '#description-inline-expander > #expand',
    MORE_ACTIONS_ALT: '#description-inline-expander',
    TRANSCRIPT_BUTTON: 'button[aria-label="Show transcript"]',
    VIDEO_PLAYER: '#movie_player',
    TITLE: '#title',
    VIDEO_TITLE: 'h1.ytd-video-primary-info-renderer, #title h1',
    CHANNEL_NAME: '#owner-name a, #channel-name a',
    CHANNEL_SUBSCRIBERS: '#owner-sub-count',
    VIEWS: '#count .view-count, #count span',
    POST_DATE: '#info-strings yt-formatted-string, #date yt-formatted-string'
  },
  TIMEOUTS: {
    NAVIGATION: 30000,
    ELEMENT_WAIT: 15000,
    METADATA: 10000
  },
  DELAYS: {
    AFTER_NAVIGATION: 2000,
    AFTER_CLICK: 1000,
    AFTER_SCROLL: 1000
  }
};

const app = express();
app.use(express.json());

// Browser management
let browser;

async function initializeBrowser() {
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    console.log('Browser initialized successfully');
  } catch (error) {
    console.error('Failed to initialize browser:', error);
    process.exit(1);
  }
}

async function cleanup() {
  if (browser) {
    await browser.close();
    console.log('Browser closed');
  }
}

// Metadata extraction
async function extractVideoMetadata(page) {
  try {
    await page.waitForSelector(CONFIG.SELECTORS.TITLE, { timeout: CONFIG.TIMEOUTS.METADATA });
    await sleep(CONFIG.DELAYS.AFTER_NAVIGATION);

    const metadata = await page.evaluate((selectors) => {
      const getText = (selector) => document.querySelector(selector)?.textContent?.trim() || '';

      return {
        video_title: getText(selectors.VIDEO_TITLE),
        channel_name: getText(selectors.CHANNEL_NAME),
        channel_subscribers: getText(selectors.CHANNEL_SUBSCRIBERS),
        views: getText(selectors.VIEWS),
        post_date: getText(selectors.POST_DATE)
      };
    }, CONFIG.SELECTORS);

    return metadata;
  } catch (error) {
    console.error('[extractVideoMetadata] Error:', error);
    try {
      const pageTitle = await page.title();
      return {
        video_title: pageTitle.replace(' - YouTube', ''),
        channel_name: '',
        channel_subscribers: '',
        views: '',
        post_date: ''
      };
    } catch (fallbackError) {
      return {
        video_title: '',
        channel_name: '',
        channel_subscribers: '',
        views: '',
        post_date: ''
      };
    }
  }
}

// Transcript extraction
function extractTranscriptFromJson(jsonData) {
  let fullTranscriptText = '';
  if (jsonData?.actions?.[0]?.updateEngagementPanelAction?.content?.transcriptRenderer?.content?.transcriptSearchPanelRenderer?.body?.transcriptSegmentListRenderer?.initialSegments) {
    const segments = jsonData.actions[0]?.updateEngagementPanelAction?.content?.transcriptRenderer?.content?.transcriptSearchPanelRenderer?.body?.transcriptSegmentListRenderer?.initialSegments;
    let completeSegment = segments.map(el => {
      const snippet = el?.transcriptSegmentRenderer?.snippet;
      const firstRunText = snippet?.runs?.[0]?.text;
      return firstRunText || '';
    });
    fullTranscriptText = completeSegment.join(' ');
    return fullTranscriptText.replaceAll('\n', ' ').trim();
  } else {
    console.warning('[extractTranscriptFromJson] Could not find transcript segments in the expected JSON structure.');
    return '';
  }
}

// Page interaction helpers
async function clickMoreActions(page) {
  try {
    await page.waitForSelector(CONFIG.SELECTORS.MORE_ACTIONS, {
      visible: true,
      timeout: CONFIG.TIMEOUTS.ELEMENT_WAIT
    });
    await page.click(CONFIG.SELECTORS.MORE_ACTIONS);
    console.log('[RequestHandler] Clicked "More actions" button.');
    await sleep(CONFIG.DELAYS.AFTER_CLICK);
  } catch (error) {
    console.warn('Could not find or click "More actions" button, trying alternative selector...');
    const altMoreActionsButton = await page.waitForSelector(CONFIG.SELECTORS.MORE_ACTIONS_ALT, {
      visible: true,
      timeout: CONFIG.TIMEOUTS.ELEMENT_WAIT
    });
    if (altMoreActionsButton) {
      await altMoreActionsButton.click();
      console.log('[RequestHandler] Clicked alternative "More actions" button.');
      await sleep(CONFIG.DELAYS.AFTER_CLICK);
    }
  }
}

async function clickTranscriptButton(page) {
  let transcriptButtonFound = false;
  let retryCount = 0;
  const maxRetries = 3;

  while (!transcriptButtonFound && retryCount < maxRetries) {
    try {
      await page.waitForSelector('button', { timeout: CONFIG.TIMEOUTS.ELEMENT_WAIT });
      await sleep(CONFIG.DELAYS.AFTER_CLICK);

      const buttons = await page.$$(CONFIG.SELECTORS.TRANSCRIPT_BUTTON);
      if (buttons && buttons.length > 0) {
        const button = buttons[0];
        await button.evaluate(btn => {
          btn.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
        await sleep(CONFIG.DELAYS.AFTER_SCROLL);

        try {
          await button.click();
        } catch (clickError) {
          await button.evaluate(btn => btn.click());
        }
        console.log('[RequestHandler] Clicked transcript button.');
        transcriptButtonFound = true;
      }
    } catch (error) {
      retryCount++;
      if (retryCount < maxRetries) {
        console.log(`Retry ${retryCount} for finding transcript button...`);
        await sleep(CONFIG.DELAYS.AFTER_CLICK);
      } else {
        throw error;
      }
    }
  }
}

// Main scraping endpoint
app.post('/scrape', async (req, res) => {
  let page;
  try {
    const { url } = req.body;

    if (!url) {
      return res.status(400).json({
        success: false,
        error: 'URL is required in request body'
      });
    }

    if (!browser) {
      return res.status(500).json({ error: 'Browser not initialized' });
    }

    page = await browser.newPage();
    await page.setRequestInterception(true);
    
    const blockPatterns = [
      "googlevideo.com/videoplayback?expire=",
      // Image formats
      ".jpg",
      ".jpeg",
      ".png",
      ".gif",
      ".webp",
      ".svg",
      ".ico",
      ".ytimg.com/vi",
      "s/gaming/emoji",
      "/yt3.ggpht.com/ytc",
      "data:image", 
      // Fonts
      ".woff",
      ".woff2",
      ".ttf",
      ".otf",
      ".eot",
      // Media files
      ".mp4",
      ".mp3",
      ".webm",
      ".avi",
      // Common ad, tracker, and analytics domains/paths
      "doubleclick.net",
      "google-analytics.com",
      "googlesyndication.com",
      "googleadservices.com",
      "googletagmanager.com",
      "youtube.com/api/stats/",
      "youtube.com/csi",
      "youtube.com/ptracking",
      "sentry.io",
      "newrelic.com",
      "facebook.com",
      "facebook.net",
      "fbcdn.net",
      "twitter.com",
      "pbs.twimg.com",
      "criteo.com",
      "criteo.net",
      "adnxs.com",
      "taboola.com",
      "outbrain.com",
      "contextual.media.net",
      "smartadserver.com",
      "creativecdn.com",
      "asalemedia",
      "ubiconproject",
      "3lift",
      "am-cell",
      "opera",
      "ds.yahoo",
      // Other non-essential paths/patterns
      "/static/",
      "fragment/fly-out",
      // Document types
      ".pdf",
      ".xlsx",
      ".doc",
      ".docx",
      "ytimg.com/log_event"
    ];

    // Create a Set for faster lookups
    const blockPatternsSet = new Set(blockPatterns);

    await page.on('request', (request) => {
      const url = request.url();
      const resourceType = request.resourceType();
      
      // Skip blocking for document and xhr requests as they're essential
      if (resourceType === 'document' || resourceType === 'xhr') {
        request.continue();
        return;
      }

      // Check if URL contains any blocked pattern
      const shouldBlock = Array.from(blockPatternsSet).some(pattern => url.includes(pattern));
      
      if (shouldBlock) {
        request.abort();
      } else {
        request.continue();
      }
    });

    // Set up transcript response listener
    const transcriptPromise = new Promise((resolve, reject) => {
      const responseListener = async (response) => {
        const request = response.request();
        if (response.url().includes('https://www.youtube.com/youtubei/v1/get_transcript') && request.method() === 'POST') {
          console.log('[getTranscript] Target transcript network request intercepted.');
          try {
            const jsonResponse = await response.json();
            console.log('[getTranscript] Successfully parsed transcript JSON.');

            const videoMetadata = await extractVideoMetadata(page);
            console.log('[getTranscript] Successfully extracted video metadata');

            const transcript_text = extractTranscriptFromJson(jsonResponse);

            resolve({
              metadata: videoMetadata,
              transcript_text: transcript_text
            });
          } catch (error) {
            console.error('[getTranscript] Error:', error);
            reject(error);
          }
        }
      };

      page.on('response', responseListener);

      setTimeout(() => {
        page.off('response', responseListener);
        reject(new Error('Timeout: Transcript data not received within 60 seconds.'));
      }, CONFIG.TIMEOUTS.NAVIGATION);
    });

    // Navigate to URL
    try {
      await page.goto(url, {
        waitUntil: ['domcontentloaded', 'networkidle0'],
        timeout: CONFIG.TIMEOUTS.NAVIGATION
      });
    } catch (navigationError) {
      console.error('Navigation error:', navigationError);
      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: CONFIG.TIMEOUTS.NAVIGATION
      });
    }

    await sleep(CONFIG.DELAYS.AFTER_NAVIGATION);

    // Wait for video player
    try {
      await page.waitForSelector(CONFIG.SELECTORS.VIDEO_PLAYER, { timeout: CONFIG.TIMEOUTS.ELEMENT_WAIT });
    } catch (error) {
      console.warn('Video player not found, but continuing...');
    }

    // Click buttons and get transcript
    await clickMoreActions(page);
    await clickTranscriptButton(page);

    const { metadata, transcript_text } = await transcriptPromise;

    res.json({
      success: true,
      data: {
        ...metadata,
        transcript_text,
        url: page.url(),
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('Error during scraping:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  } finally {
    if (page) {
      await page.close();
    }
  }
});

// Server startup
process.on('SIGINT', async () => {
  await cleanup();
  process.exit(0);
});

app.listen(CONFIG.PORT, async () => {
  console.log(`Server is running on http://localhost:${CONFIG.PORT}`);
  await initializeBrowser();
});