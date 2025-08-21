const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const USERS_FILE = path.join(__dirname, 'data', 'users.json');

app.use(cors());
app.use(express.json());

// Helper function to read users from file
function readUsers() {
  try {
    if (!fs.existsSync(USERS_FILE)) {
        // If the directory doesn't exist, create it.
        const dir = path.dirname(USERS_FILE);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(USERS_FILE, '[]', 'utf8');
    }
    const data = fs.readFileSync(USERS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error("Error reading users file:", error);
    return [];
  }
}

// Helper function to write users to file
function writeUsers(users) {
  try {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
  } catch (error) {
    console.error("Error writing users file:", error);
  }
}

// --- AUTH ENDPOINTS ---

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const users = readUsers();
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

app.post('/api/register', (req, res) => {
  const { username, password } = req.body;
  let users = readUsers();

  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'Username and password are required.' });
  }

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
  writeUsers(users);

  res.status(201).json({ success: true, message: 'Account created! Awaiting admin approval.', user: newUser });
});


// --- ADMIN ENDPOINTS ---
// A real app would have proper admin authentication middleware here.

app.get('/api/users', (req, res) => {
    const users = readUsers();
    res.json(users);
});

app.get('/api/users/stats', (req, res) => {
    const users = readUsers();
    const totalUsers = users.length;
    const pendingCount = users.filter(u => u.status === 'pending').length;
    const approvedCount = users.filter(u => u.status === 'approved').length;
    const revokedCount = users.filter(u => u.status === 'revoked').length;
    res.json({ totalUsers, pendingCount, approvedCount, revokedCount });
});

app.post('/api/users', (req, res) => { // Create user
    const { username, password, status, role } = req.body;
    if (!username || !password) {
        return res.status(400).json({ success: false, message: 'Username and password are required.' });
    }
    let users = readUsers();
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
    writeUsers(users);
    res.status(201).json({ success: true, message: 'User created successfully.', user: newUser });
});

app.post('/api/users/:username/approve', (req, res) => {
    const { username } = req.params;
    let users = readUsers();
    const userIndex = users.findIndex(u => u.username === username);
    if (userIndex === -1) {
        return res.status(404).json({ success: false, message: 'User not found.' });
    }
    users[userIndex].status = 'approved';
    writeUsers(users);
    res.json({ success: true, message: `User ${username} approved.` });
});

app.post('/api/users/:username/revoke', (req, res) => {
    const { username } = req.params;
    const { reason } = req.body;
    if (username === 'DG143') {
        return res.status(400).json({ success: false, message: 'Cannot revoke the primary admin.' });
    }
    let users = readUsers();
    const userIndex = users.findIndex(u => u.username === username);
    if (userIndex === -1) {
        return res.status(404).json({ success: false, message: 'User not found.' });
    }
    users[userIndex].status = 'revoked';
    users[userIndex].revocationReason = reason || 'No reason provided.';
    users[userIndex].revokedAt = new Date().toISOString();
    writeUsers(users);
    res.json({ success: true, message: `User ${username} revoked.` });
});

app.post('/api/users/:username/restore', (req, res) => {
    const { username } = req.params;
    let users = readUsers();
    const userIndex = users.findIndex(u => u.username === username);
    if (userIndex === -1) {
        return res.status(404).json({ success: false, message: 'User not found.' });
    }
    users[userIndex].status = 'approved';
    delete users[userIndex].revocationReason;
    delete users[userIndex].revokedAt;
    writeUsers(users);
    res.json({ success: true, message: `User ${username} restored.` });
});

app.delete('/api/users/:username', (req, res) => {
    const { username } = req.params;
    if (username === 'DG143') {
        return res.status(400).json({ success: false, message: 'Cannot delete the primary admin.' });
    }
    let users = readUsers();
    const initialLength = users.length;
    users = users.filter(u => u.username !== username);
    if (users.length === initialLength) {
        return res.status(404).json({ success: false, message: 'User not found.' });
    }
    writeUsers(users);
    res.json({ success: true, message: `User ${username} has been removed.` });
});


app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});