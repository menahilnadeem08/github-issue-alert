const axios = require("axios");
const express = require("express");
const fs = require("fs");
require("dotenv").config();
// --- CONFIG ---
const REPO = process.env.REPO;
const GOOGLE_CHAT_WEBHOOK = process.env.GOOGLE_CHAT_WEBHOOK;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

if (!REPO || !GOOGLE_CHAT_WEBHOOK) {
  console.error("Error: REPO or GOOGLE_CHAT_WEBHOOK not set.");
  process.exit(1);
}

const headers = {};
if (GITHUB_TOKEN) headers['Authorization'] = `token ${GITHUB_TOKEN}`;

// --- FILES ---
const SENT_FILE = "sent_issues.json";
const LABEL_FILE = "issue_labels.json";

let sentIssues = [];
let labelState = {};

// Pakistan time
function now() {
  return new Date().toLocaleString('en-PK', { hour12: false });
}

function saveSentIssues() {
  fs.writeFileSync(SENT_FILE, JSON.stringify(sentIssues, null, 2));
}

function saveLabelState() {
  fs.writeFileSync(LABEL_FILE, JSON.stringify(labelState, null, 2));
}

// --- INIT ---
async function initSentIssues() {
  try {
    if (fs.existsSync(SENT_FILE)) {
      sentIssues = JSON.parse(fs.readFileSync(SENT_FILE));
    }

    if (fs.existsSync(LABEL_FILE)) {
      labelState = JSON.parse(fs.readFileSync(LABEL_FILE));
    }

    // first run skip existing
    if (sentIssues.length === 0) {
      const res = await axios.get(
        `https://api.github.com/repos/${REPO}/issues?per_page=10&state=open&sort=created&direction=desc`,
        { headers }
      );

      const issues = res.data.filter(i => !i.pull_request);
      sentIssues = issues.map(i => i.id.toString());
      saveSentIssues();

      console.log(`[${now()}] Initialized sentIssues`);
    }

  } catch (err) {
    console.error(`[${now()}] Init error:`, err.message);
  }
}

// --- CHECK ---
let sending = false;

async function checkIssues() {
  if (sending) return;
  sending = true;

  try {
    const res = await axios.get(
      `https://api.github.com/repos/${REPO}/issues?per_page=10&state=open&sort=created&direction=desc`,
      { headers }
    );

    const issues = res.data.filter(i => !i.pull_request);

    // -------------------------
    // NEW ISSUE DETECTION
    // -------------------------
    const newIssues = issues.filter(
      issue => !sentIssues.includes(issue.id.toString())
    );

    for (const issue of newIssues.reverse()) {
      const labels = issue.labels.map(l => l.name).join(", ") || "No tags";

      await axios.post(GOOGLE_CHAT_WEBHOOK, {
        cards: [{
          header: {
            title: "New Issue Opened",
            subtitle: `Repo: ${REPO}`
          },
          sections: [{
            widgets: [
              { textParagraph: { text: `<b>Title:</b> ${issue.title}` } },
              { textParagraph: { text: `<b>URL:</b> <a href="${issue.html_url}">${issue.html_url}</a>` } },
              { textParagraph: { text: `<b>Tags:</b> ${labels}` } }
            ]
          }]
        }]
      });

      console.log(`[${now()}] Sent new issue #${issue.number}`);
      sentIssues.push(issue.id.toString());
    }

    // -------------------------
    // LABEL CHANGE DETECTION
    // -------------------------
    const watchLabels = ["help wanted", "external"];
    const issuesToCheck = issues; // keep monitoring all fetched issues

    for (const issue of issuesToCheck) {
      const id = issue.id.toString();
      const current = issue.labels.map(l => l.name);
      const previous = labelState[id] || [];

      // Normalize label comparisons to lowercase for stable matching
      const currentLower = current.map(l => l.toLowerCase());
      const previousLower = previous.map(l => l.toLowerCase());

      const added = current.filter(l => !previousLower.includes(l.toLowerCase()));
      const removed = previous.filter(l => !currentLower.includes(l.toLowerCase()));

      const addedWatch = added.filter(l => watchLabels.includes(l.toLowerCase()));
      const removedWatch = removed.filter(l => watchLabels.includes(l.toLowerCase()));

      if (addedWatch.length || removedWatch.length) {
        await axios.post(GOOGLE_CHAT_WEBHOOK, {
          cards: [{
            header: {
              title: "Label Change Detected",
              subtitle: `Repo: ${REPO}`
            },
            sections: [{
              widgets: [{
                textParagraph: {
                  text:
                    `<b>Issue:</b> <a href="${issue.html_url}">#${issue.number}</a><br>` +
                    `<b>Added:</b> ${addedWatch.join(", ") || "None"}<br>` +
                    `<b>Removed:</b> ${removedWatch.join(", ") || "None"}`
                }
              }]
            }]
          }]
        });

        console.log(`[${now()}] Label change on #${issue.number}`);
      }

      labelState[id] = current;
    }

    saveSentIssues();
    saveLabelState();

    if (newIssues.length === 0) {
      console.log(`[${now()}] Checked — no new issues`);
    }

  } catch (err) {
    console.error(`[${now()}] Error:`, err.message);
  } finally {
    sending = false;
  }
}

// --- SERVER ---
const app = express();

app.get("/run", async (req, res) => {
  console.log(`[${now()}] Triggered by UptimeRobot`);
  await checkIssues();
  res.send("checked");
});

app.get("/", (req, res) => {
  res.send("GitHub Issue Notifier Alive");
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Server running on ${port}`));

// --- SCHEDULED CHECK ---
// Runs immediately after startup, and then every 60 seconds.
(async () => {
  await initSentIssues();
  await checkIssues();
  setInterval(checkIssues, 60 * 1000);
})();