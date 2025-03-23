import bsky from "./bskyHandler";
import db from "./dbHandler";

let queue: QueueItems[] = [];
let rateLimited: boolean = false;
let queueRunning: boolean = false;
let queueSnapshot: QueueItems[] = [];

let config: Config = {
  string: "",
  publishEmbed: false,
  embedType: "card",
  languages: ["en"],
  truncate: true,
  runInterval: 60,
  dateField: "",
  publishDate: false,
  imageField: "",
  ogUserAgent: "bsky.rss/1.0 (Open Graph Scraper)",
  descriptionClearHTML: true,
  forceDescriptionEmbed: false,
  imageAlt: "",
  removeDuplicate: false,
  titleClearHTML: false,
};

async function start() {
  config = await db.initConfig();
  console.log(
    `[${new Date().toUTCString()}] - [bsky.rss QUEUE] Starting queue handler. Running every ${
      config.runInterval
    } seconds`
  );
  setInterval(function () {
    runQueue();
  }, config.runInterval * 1000);
}

async function createLimitTimer(timeoutSeconds: number = 30) {
  if (!rateLimited) return;
  rateLimited = true;
  setTimeout(() => {
    rateLimited = false;
    runQueue();
    console.log(
      `[${new Date().toUTCString()}] - [bsky.rss QUEUE] Post rate limit expired - resuming queue`
    );
  }, timeoutSeconds * 1000);
  return "";
}

async function runQueue() {
  if (queueRunning) return;
  queueSnapshot = [...queue];
  if (queueSnapshot.length === 0) return queueSnapshot;
  console.log(
    `[${new Date().toUTCString()}] - [bsky.rss QUEUE] Running queue with ${
      queueSnapshot.length
    } items`
  );
  if (rateLimited) return { ratelimit: true };
  if (queueSnapshot.length > 0) {
    queueRunning = true;
    for (let i = 0; i < queueSnapshot.length; i++) {
      let item = queueSnapshot[i] as QueueItems;
      queue.splice(i, 1);
      queueSnapshot.splice(i, 1);
      i--;
      let post = await bsky.post({
        content: item.content,
        embed: item.embed,
        languages: item.languages,
        date: config.publishDate ? new Date(item.date) : undefined
      });
      // @ts-ignore
      if (post.ratelimit) {
        queue.unshift(item);
        let timeoutSeconds: number = post.retryAfter ? post.retryAfter : 30;
        await createLimitTimer(timeoutSeconds);
        queueRunning = false;
        console.log(
          `[${new Date().toUTCString()}] - [bsky.rss POST] Post rate limit exceeded - process will resume after ${timeoutSeconds} seconds`
        );
        break;
      } else {
        console.log(
          `[${new Date().toUTCString()}] - [bsky.rss POST] Posting new item (${
            item.title
          })`
        );
        db.writeDate(parseRssDate(item.date));
        if (i === queueSnapshot.length - 1) {
          queueRunning = false;
          queueSnapshot = [];
          console.log(
            `[${new Date().toUTCString()}] - [bsky.rss QUEUE] Finished running queue. Next run in ${
              config.runInterval
            } seconds`
          );
          if (config.removeDuplicate) db.cleanupOldValues();
        }
      }
    }
    return queue;
  } else {
    return queue;
  }
}

async function writeQueue({
  content,
  embed,
  languages,
  title,
  date,
}: QueueItems) {
  console.log(
    `[${new Date().toUTCString()}] - [bsky.rss QUEUE] Queuing item (${title})`
  );
  queue.push({ content, embed, languages, title, date });
  return queue;
}

function parseRssDate(dateString: string): Date {
  // Try standard parsing first
  let date = new Date(dateString);
  
  // Check if the date is valid
  if (!isNaN(date.getTime())) {
    return date;
  }
  
  // Handle non-standard formats like "Sun, 03/23/2025 - 03:23"
  try {
    // Extract parts from format like "Sun, 03/23/2025 - 03:23"
    const match = dateString.match(/(\d{2})\/(\d{2})\/(\d{4}).*?(\d{2}):(\d{2})/);
    if (match) {
      const [, month, day, year, hours, minutes] = match;
      return new Date(`${year}-${month}-${day}T${hours}:${minutes}:00Z`);
    }
  } catch (error) {
    console.error(`Failed to parse date string: ${dateString}`, error);
  }
  
  // Return current date as fallback
  console.warn(`Using current date as fallback for invalid date: ${dateString}`);
  return new Date();
}

export default { writeQueue, start };
