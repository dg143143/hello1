require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// GitHub configuration
const GITHUB_TOKEN = process.env.GITHUB_PAT;
const GITHUB_OWNER = process.env.GITHUB_OWNER || 'dg143143';
const GITHUB_REPO = process.env.GITHUB_REPO || 'dg143143';
const GITHUB_FILE_PATH = 'users.json';

let lastSha; // To store the SHA of the file for updates

app.use(cors());
app.use(express.json());

// Serve index.html for the root route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const githubApi = axios.create({
  baseURL: 'https://api.github.com',
  headers: {
    'Authorization': `token ${GITHUB_TOKEN}`,
    'Accept': 'application/vnd.github.v3+json',
  },
});

// Helper function to read users from GitHub
async function readUsers() {
  try {
    const response = await githubApi.get(`/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${GITHUB_FILE_PATH}`);
    lastSha = response.data.sha; // Cache the SHA
    const content = Buffer.from(response.data.content, 'base64').toString('utf8');
    return JSON.parse(content);
  } catch (error) {
    if (error.response && error.response.status === 404) {
      // If the file doesn't exist, create it with an empty array
      console.log('users.json not found, creating it...');
      await writeUsers([]);
      return [];
    }
    console.error("Error reading users file from GitHub:", error.response ? error.response.data : error.message);
    // Return an empty array as a fallback to prevent crashes
    return [];
  }
}

// Helper function to write users to GitHub
async function writeUsers(users) {
  try {
    const content = Buffer.from(JSON.stringify(users, null, 2)).toString('base64');

    // To create a new file, we omit the 'sha'.
    // To update a file, we must include the 'sha'.
    const payload = {
      message: 'Update users.json',
      content: content,
    };
    if (lastSha) {
      payload.sha = lastSha;
    }

    const response = await githubApi.put(`/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${GITHUB_FILE_PATH}`, payload);

    if (response.data.content && response.data.content.sha) {
        lastSha = response.data.content.sha; // Update the SHA with the new one
    }

  } catch (error) {
    console.error("Error writing users file to GitHub:", error.response ? error.response.data : error.message);
  }
}

// --- AUTH ENDPOINTS ---

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  const users = await readUsers();
  const user = users.find(u => u.username === username && u.password === password);

  if (user) {
    if (user.status === "pending") {
      return res.status(403).json({ success: false, message: 'Account pending approval.', status: 'pending' });
    }
    if (user.status === "revoked") {
      return res.status(403).json({ success: false, message: `Account revoked. Reason: ${user.revocationReason || 'No reason provided'}`, status: 'revoked', reason: user.revocationReason });
    }
    res.json({ success: true, message: 'Login successful!', isAdmin: user.isAdmin, username: user.username });
  } else {
    res.status(401).json({ success: false, message: 'Invalid credentials' });
  }
});

app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'Username and password are required.' });
  }

  let users = await readUsers();

  if (users.some(u => u.username === username)) {
    return res.status(409).json({ success: false, message: 'Username already exists.' });
  }

  const newUser = {
    username,
    password, // In a real app, hash this password!
    isAdmin: false,
    status: "pending",
    joined: new Date().toISOString()
  };

  users.push(newUser);
  await writeUsers(users);

  res.status(201).json({ success: true, message: 'Account created! Awaiting admin approval.', user: newUser });
});


// --- ADMIN ENDPOINTS ---
// A real app would have proper admin authentication middleware here.

app.get('/api/users', async (req, res) => {
    const users = await readUsers();
    res.json(users);
});

app.get('/api/users/stats', async (req, res) => {
    const users = await readUsers();
    const totalUsers = users.length;
    const pendingCount = users.filter(u => u.status === 'pending').length;
    const approvedCount = users.filter(u => u.status === 'approved').length;
    const revokedCount = users.filter(u => u.status === 'revoked').length;
    res.json({ totalUsers, pendingCount, approvedCount, revokedCount });
});

app.post('/api/users', async (req, res) => { // Create user
    const { username, password, status, role } = req.body;
    if (!username || !password) {
        return res.status(400).json({ success: false, message: 'Username and password are required.' });
    }
    let users = await readUsers();
    if (users.some(u => u.username === username)) {
        return res.status(409).json({ success: false, message: 'Username already exists.' });
    }
    const newUser = {
        username,
        password,
        isAdmin: role === 'admin',
        status: status || 'pending',
        joined: new Date().toISOString()
    };
    users.push(newUser);
    await writeUsers(users);
    res.status(201).json({ success: true, message: 'User created successfully.', user: newUser });
});

app.post('/api/users/:username/approve', async (req, res) => {
    const { username } = req.params;
    let users = await readUsers();
    const userIndex = users.findIndex(u => u.username === username);
    if (userIndex === -1) {
        return res.status(404).json({ success: false, message: 'User not found.' });
    }
    users[userIndex].status = 'approved';
    await writeUsers(users);
    res.json({ success: true, message: `User ${username} approved.` });
});

app.post('/api/users/:username/revoke', async (req, res) => {
    const { username } = req.params;
    const { reason } = req.body;
    if (username === 'DG143') {
        return res.status(400).json({ success: false, message: 'Cannot revoke the primary admin.' });
    }
    let users = await readUsers();
    const userIndex = users.findIndex(u => u.username === username);
    if (userIndex === -1) {
        return res.status(404).json({ success: false, message: 'User not found.' });
    }
    users[userIndex].status = 'revoked';
    users[userIndex].revocationReason = reason || 'No reason provided.';
    users[userIndex].revokedAt = new Date().toISOString();
    await writeUsers(users);
    res.json({ success: true, message: `User ${username} revoked.` });
});

app.post('/api/users/:username/restore', async (req, res) => {
    const { username } = req.params;
    let users = await readUsers();
    const userIndex = users.findIndex(u => u.username === username);
    if (userIndex === -1) {
        return res.status(404).json({ success: false, message: 'User not found.' });
    }
    users[userIndex].status = 'approved';
    delete users[userIndex].revocationReason;
    delete users[userIndex].revokedAt;
    await writeUsers(users);
    res.json({ success: true, message: `User ${username} restored.` });
});

app.delete('/api/users/:username', async (req, res) => {
    const { username } = req.params;
    if (username === 'DG143') {
        return res.status(400).json({ success: false, message: 'Cannot delete the primary admin.' });
    }
    let users = await readUsers();
    const initialLength = users.length;
    users = users.filter(u => u.username !== username);
    if (users.length === initialLength) {
        return res.status(404).json({ success: false, message: 'User not found.' });
    }
    await writeUsers(users);
    res.json({ success: true, message: `User ${username} has been removed.` });
});


app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});