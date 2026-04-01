const fs = require('fs');
const path = require('path');
const axios = require('axios');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO = process.env.GITHUB_REPOSITORY; // e.g., "Expensify/App"
const WEBHOOK = process.env.GOOGLE_CHAT_WEBHOOK;

const LAST_ISSUE_FILE = path.resolve('./last_issue.json');

// Helper to get current timestamp
function now() {
    return new Date().toISOString().replace('T', ' ').split('.')[0];
}

// Load last sent issues
let sentIssues = [];
if (fs.existsSync(LAST_ISSUE_FILE)) {
    try {
        sentIssues = JSON.parse(fs.readFileSync(LAST_ISSUE_FILE, 'utf8'));
    } catch (e) {
        console.error('Failed to parse last_issue.json', e);
        sentIssues = [];
    }
}

// Save last sent issues
function saveSentIssues() {
    fs.writeFileSync(LAST_ISSUE_FILE, JSON.stringify(sentIssues, null, 2));
}

// Fetch open issues from GitHub
async function fetchOpenIssues() {
    const url = `https://api.github.com/repos/${REPO}/issues`;
    const params = {
        state: 'open',
        per_page: 50, // adjust if needed
        sort: 'created',
        direction: 'asc',
        // labels: 'DeployBlockerCash,Engineering' // optional filter
    };

    const headers = {
        Authorization: `token ${GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
    };

    const res = await axios.get(url, { params, headers });
    // Filter out pull requests (issues with "pull_request" key)
    return res.data.filter(issue => !issue.pull_request);
}

// Send a message to Google Chat
async function sendToChat(issue) {
    const labels = issue.labels.map(l => l.name).join(', ') || 'No Labels';
    const text = `New Issue Opened\n#${issue.number}: ${issue.title}\nID: ${issue.id}\nLabels: ${labels}\n${issue.html_url}`;
    await axios.post(WEBHOOK, { text });
}

// Main scheduler
async function checkIssues() {
    try {
        const issues = await fetchOpenIssues();

        // Filter new issues
        const lastSentId = sentIssues.slice(-1)[0]?.id || 0;
        const newIssues = issues.filter(issue => issue.id > lastSentId);

        if (newIssues.length === 0) {
            const lastSent = sentIssues.slice(-1)[0] || { number: "none", id: "none" };
            console.log(`[${now()}] Checked — no new issues. Last sent: Number: ${lastSent.number}, ID: ${lastSent.id}`);
            return;
        }

        for (const issue of newIssues) {
            console.log(`[${now()}] Sending Issue #${issue.number} with internal ID: ${issue.id}`);
            await sendToChat(issue);
            sentIssues.push({ number: issue.number, id: issue.id });
        }

        saveSentIssues();

    } catch (err) {
        console.error(`[${now()}] Error checking issues:`, err.message);
    }
}

// Run immediately, then every 5 minutes
checkIssues();
setInterval(checkIssues, 5 * 60 * 1000);