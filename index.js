const axios = require("axios");
const express = require("express");
const fs = require("fs");

// Environment variables
const REPO = process.env.REPO;                        
const WEBHOOK = process.env.GOOGLE_CHAT_WEBHOOK;      
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;        

if (!REPO || !WEBHOOK) {
  console.error("Error: REPO or GOOGLE_CHAT_WEBHOOK not set in environment variables.");
  process.exit(1);
}

// Optional GitHub headers
const headers = {};
if (GITHUB_TOKEN) headers['Authorization'] = `token ${GITHUB_TOKEN}`;

// Track sent issues to avoid duplicates
const SENT_FILE = "sent_issues.json";
let sentIssues = [];
if (fs.existsSync(SENT_FILE)) {
  sentIssues = JSON.parse(fs.readFileSync(SENT_FILE, "utf-8"));
}

// Lock to prevent concurrent sends
let sending = false;

// Pakistan local time
function now() {
  return new Date().toLocaleString('en-PK', { hour12: false });
}

// Save sent issues
function saveSentIssues() {
  fs.writeFileSync(SENT_FILE, JSON.stringify(sentIssues), "utf-8");
}

// Main check function
async function checkIssues() {
  if (sending) return;
  sending = true;

  try {
    const res = await axios.get(
      `https://api.github.com/repos/${REPO}/issues?per_page=10&state=open&sort=created&direction=desc`,
      { headers }
    );

    // Only real issues (exclude pull requests)
    const issues = res.data.filter(item => !item.pull_request);

    // Filter issues that haven't been sent
    const newIssues = issues.filter(issue => !sentIssues.includes(issue.id.toString()));

    if (newIssues.length === 0) {
      console.log(`[${now()}] Checked — no new issues`);
    }

    // Send each new issue
    for (const issue of newIssues.reverse()) { // reverse to send oldest first
      await axios.post(WEBHOOK, {
        text: `New Issue Opened\n${issue.title}\n${issue.html_url}`
      });
      console.log(`[${now()}] Sent: ${issue.title}`);
      sentIssues.push(issue.id.toString());
    }

    saveSentIssues();

  } catch (err) {
    console.log(`[${now()}] Error:`, err.message);
  } finally {
    sending = false;
  }
}

// Run immediately, then every minute
checkIssues();
setInterval(checkIssues, 60 * 1000);

// Minimal HTTP server for Render
const app = express();
app.get("/", (req, res) => res.send("GitHub Issue Notifier Alive"));
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Server running on port ${port}`));

// Self-ping to keep free-tier awake
// Self-ping to keep free-tier awake
setInterval(() => {
  axios.get(`http://localhost:${port}/`)
    .then(() => {
      console.log(`[${now()}] Self-ping successful — service is awake`);
    })
    .catch(() => {
      console.log(`[${now()}] Self-ping failed`);
    });
}, 5 * 60 * 1000); // every 5 minutes