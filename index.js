const axios = require("axios");
const express = require("express");

// Environment variables
const REPO = process.env.REPO;                        // e.g., Expensify/App
const WEBHOOK = process.env.GOOGLE_CHAT_WEBHOOK;      // Google Chat webhook URL
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;        // optional, helps avoid 403 rate limit

if (!REPO || !WEBHOOK) {
  console.error("Error: REPO or GOOGLE_CHAT_WEBHOOK not set in environment variables.");
  process.exit(1);
}

// Optional headers for GitHub API
const headers = {};
if (GITHUB_TOKEN) {
  headers['Authorization'] = `token ${GITHUB_TOKEN}`;
}

let lastIssue = null;

// Get Pakistan local time in 24-hour format
function now() {
  return new Date().toLocaleString('en-PK', { hour12: false });
}

async function checkIssues() {
  try {
    const res = await axios.get(
      `https://api.github.com/repos/${REPO}/issues?per_page=5&state=open&sort=created&direction=desc`,
      { headers }
    );

    // Only real issues (exclude pull requests)
    const issues = res.data.filter(item => !item.pull_request);

    if (issues.length === 0) {
      console.log(`[${now()}] Checked — no issues found`);
      return;
    }

    const issue = issues[0];

    if (lastIssue !== issue.id) {
      lastIssue = issue.id;

      await axios.post(WEBHOOK, {
        text: `New Issue Opened\n${issue.title}\n${issue.html_url}`
      });

      console.log(`[${now()}] Sent: ${issue.title}`);
    } else {
      console.log(`[${now()}] Checked — no new issue`);
    }

  } catch (err) {
    console.log(`[${now()}] Error:`, err.message);
  }
}

// Run immediately, then every 60 seconds
checkIssues();
setInterval(checkIssues, 60000);

// Minimal HTTP server for Render port detection & free-tier ping
const app = express();
app.get("/", (req, res) => res.send("GitHub Issue Notifier Alive"));
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Server running on port ${port}`));