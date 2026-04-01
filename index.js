// github-issue-alert.js
const axios = require("axios");
const express = require("express");
const fs = require("fs");

// --- CONFIG ---
const REPO = process.env.REPO;                        
const WEBHOOK = process.env.GOOGLE_CHAT_WEBHOOK;      
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;        

if (!REPO || !WEBHOOK) {
  console.error("Error: REPO or GOOGLE_CHAT_WEBHOOK not set in environment variables.");
  process.exit(1);
}

const headers = {};
if (GITHUB_TOKEN) headers['Authorization'] = `token ${GITHUB_TOKEN}`;

// --- TRACK SENT ISSUES ---
const SENT_FILE = "sent_issues.json";
let sentIssues = [];

// Pakistan local time
function now() {
  return new Date().toLocaleString('en-PK', { hour12: false });
}

// Save sent issues
function saveSentIssues() {
  fs.writeFileSync(SENT_FILE, JSON.stringify(sentIssues, null, 2), "utf-8");
}

// --- INITIALIZE ON FIRST RUN ---
// Skip sending existing open issues
async function initSentIssues() {
  if (!fs.existsSync(SENT_FILE)) {
    try {
      const res = await axios.get(
        `https://api.github.com/repos/${REPO}/issues?per_page=10&state=open&sort=created&direction=desc`,
        { headers }
      );
      const issues = res.data.filter(i => !i.pull_request);
      sentIssues = issues.map(i => i.id.toString());
      saveSentIssues();
      console.log(`[${now()}] Initialized sentIssues — skipped existing open issues.`);
    } catch (err) {
      console.error(`[${now()}] Error initializing sent issues:`, err.message);
    }
  } else {
    sentIssues = JSON.parse(fs.readFileSync(SENT_FILE, "utf-8"));
  }
}

// --- CHECK FOR NEW ISSUES ---
let sending = false;

async function checkIssues() {
  if (sending) return;
  sending = true;

  try {
    const res = await axios.get(
      `https://api.github.com/repos/${REPO}/issues?per_page=10&state=open&sort=created&direction=desc`,
      { headers }
    );

    const issues = res.data.filter(item => !item.pull_request);

    // Logging each issue
    issues.forEach(issue => {
      console.log(`Detected Issue #${issue.number} with internal ID: ${issue.id}`);
    });

    // Filter new issues
    const newIssues = issues.filter(issue => !sentIssues.includes(issue.id.toString()));

    if (newIssues.length === 0) {
      const lastSentId = sentIssues.slice(-1)[0] || "none";
      let lastNumber = "none";
      if (lastSentId !== "none") {
        const lastIssue = issues.find(i => i.id.toString() === lastSentId);
        if (lastIssue) lastNumber = lastIssue.number;
      }
      console.log(`[${now()}] Checked — no new issues. Last sent: Number: ${lastNumber}, ID: ${lastSentId}`);
    }

    for (const issue of newIssues.reverse()) { // send oldest first
      const labels = issue.labels.map(l => l.name).join(", ") || "No tags";

      await axios.post(WEBHOOK, {
        cards: [
          {
            header: {
              title: `New Issue Opened`,
              subtitle: `Repo: ${REPO}`,
            },
            sections: [
              {
                widgets: [
                  { textParagraph: { text: `<b>Title:</b> ${issue.title}` } },
                  { textParagraph: { text: `<b>URL:</b> <a href="${issue.html_url}">${issue.html_url}</a>` } },
                  { textParagraph: { text: `<b>Tags:</b> ${labels}` } }
                ]
              }
            ]
          }
        ]
      });

      console.log(`[${now()}] Sent: ${issue.title} [Tags: ${labels}]`);
      sentIssues.push(issue.id.toString());
    }

    saveSentIssues();

  } catch (err) {
    console.error(`[${now()}] Error checking issues:`, err.message);
  } finally {
    sending = false;
  }
}

// --- EXPRESS SERVER FOR RENDER OR FLY.IO ---
const app = express();
app.get("/", (req, res) => res.send("GitHub Issue Notifier Alive"));
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Server running on port ${port}`));

// --- START ---
(async () => {
  await initSentIssues();
  checkIssues();                    // run immediately
  setInterval(checkIssues, 60*1000); // every 1 min
})();