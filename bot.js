import dotenv from 'dotenv';
import { Telegraf, session, Markup } from 'telegraf';
import { MongoClient, ObjectId } from 'mongodb';
import express from 'express';
import cron from 'node-cron';
import { config } from './config.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { Server } from 'socket.io';
import http from 'http';
import multer from 'multer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const { botToken, mongoURI } = config;
if (!botToken || !mongoURI) {
    console.error('❌ Missing BOT_TOKEN or MONGO_URI in config or .env');
    process.exit(1);
}

// Express and Socket.IO Setup
const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';

// Multer Setup for File Uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'public/uploads/');
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});
const upload = multer({
    storage,
    fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        if (['.jpg', '.jpeg', '.png', '.gif'].includes(ext)) {
            cb(null, true);
        } else {
            cb(new Error('Only images (jpg, jpeg, png, gif) are allowed'), false);
        }
    },
    limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

// MongoDB Setup
const client = new MongoClient(mongoURI);
let db, usersCollection, logsCollection, messagesCollection;

async function initialize() {
    try {
        await client.connect();
        db = client.db('lemon16_db');
        usersCollection = db.collection('users');
        logsCollection = db.collection('logs');
        messagesCollection = db.collection('messages');
        await usersCollection.updateMany(
            { editAttempts: { $exists: false } },
            { $set: { editAttempts: 2, swipeCounter: 0 } }
        );
        console.log('✅ Connected to MongoDB');
    } catch (error) {
        console.error('❌ MongoDB Connection Error:', error);
        process.exit(1);
    }
}

// Middleware Setup
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Dashboard Route
app.get('/dashboard', async (req, res) => {
    try {
        const totalUsers = await usersCollection.countDocuments();
        const premiumUsers = await usersCollection.countDocuments({ isSubscribed: true });
        const freeUsers = totalUsers - premiumUsers;
        const today = new Date().setHours(0, 0, 0, 0);
        const matchesToday = await usersCollection.aggregate([
            { $match: { lastSwipe: { $gte: new Date(today), $exists: true }, likedUsers: { $exists: true, $ne: [] } } },
            { $unwind: { path: '$likedUsers', preserveNullAndEmptyArrays: true } },
            { $lookup: { from: 'users', localField: 'likedUsers', foreignField: 'userId', as: 'likedUserData' } },
            { $unwind: { path: '$likedUserData', preserveNullAndEmptyArrays: true } },
            { $match: { 'likedUserData.likedUsers': { $in: ['$userId'] } } },
            { $group: { _id: null, count: { $sum: 1 } } }
        ]).toArray();
        const matchesCount = matchesToday.length > 0 ? Math.floor(matchesToday[0].count / 2) : 0;
        const allUsers = await usersCollection.find({}).toArray();
        const recentLogs = await logsCollection.find({}).sort({ timestamp: -1 }).limit(10).toArray();
        const inactiveThreshold = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const inactiveUsers = await usersCollection.countDocuments({ lastSwipe: { $lt: inactiveThreshold } });
        const persistentMessages = await messagesCollection.find({ type: 'persistent' }).sort({ timestamp: -1 }).toArray();

        let userListHtml = `
            <table class="user-table" id="user-table">
                <thead>
                    <tr>
                        <th>Name</th>
                        <th>Username</th>
                        <th>Status</th>
                        <th>Swipes</th>
                        <th>Last Active</th>
                        <th>Joined</th>
                        <th>Banned</th>
                        <th>Edit Attempts</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
        `;
        allUsers.forEach(user => {
            userListHtml += `
                <tr>
                    <td data-label="Name">${user.name || 'No Name'}</td>
                    <td data-label="Username">${user.username ? `@${user.username}` : 'No Username'}</td>
                    <td data-label="Status">${user.isSubscribed ? 'Premium ✨' : 'Free'}</td>
                    <td data-label="Swipes">${user.swipeCount ?? '0'}</td>
                    <td data-label="Last Active">${user.lastSwipe ? new Date(user.lastSwipe).toLocaleDateString() : 'Never'}</td>
                    <td data-label="Joined">${user.joinDate ? new Date(user.joinDate).toLocaleDateString() : 'Unknown'}</td>
                    <td data-label="Banned">${user.isBanned ? 'Yes' : 'No'}</td>
                    <td data-label="Edit Attempts">${user.editAttempts ?? '0'}</td>
                    <td data-label="Actions">
                        <button onclick="showUserDetails('${user.userId}')">View</button>
                        <button class="ban-btn" onclick="banUser('${user.userId}')">${user.isBanned ? 'Unban' : 'Ban'}</button>
                        <button class="delete-btn" onclick="deleteUser('${user.userId}')">Delete</button>
                        <button onclick="togglePremium('${user.userId}', ${user.isSubscribed})">${user.isSubscribed ? 'Remove Premium' : 'Make Premium'}</button>
                    </td>
                </tr>
            `;
        });
        userListHtml += '</tbody></table>';

        let persistentMessagesHtml = `
            <section class="persistent-messages" aria-labelledby="persistent-messages-heading">
                <h2 id="persistent-messages-heading">Persistent Messages</h2>
                <table class="message-table" id="message-table">
                    <thead>
                        <tr>
                            <th>Message</th>
                            <th>Image</th>
                            <th>Type</th>
                            <th>Sent</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
        `;
        persistentMessages.forEach(msg => {
            persistentMessagesHtml += `
                <tr>
                    <td data-label="Message">${msg.text ? msg.text.substring(0, 50) + (msg.text.length > 50 ? '...' : '') : 'No Text'}</td>
                    <td data-label="Image">${msg.image ? `<img src="/uploads/${msg.image}" alt="Message Image" onerror="this.style.display='none';">` : 'None'}</td>
                    <td data-label="Type">${msg.type || 'General'}</td>
                    <td data-label="Sent">${new Date(msg.timestamp).toLocaleString()}</td>
                    <td data-label="Actions">
                        <button class="delete-btn" onclick="deleteMessage('${msg._id}')">Delete</button>
                    </td>
                </tr>
            `;
        });
        persistentMessagesHtml += '</tbody></table></section>';

        let logListHtml = '<ul id="log-list">';
        recentLogs.forEach(log => {
            logListHtml += `<li>[${new Date(log.timestamp).toLocaleString()}] User ${log.userId}: ${log.action}</li>`;
        });
        logListHtml += '</ul>';

        const html = `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <meta name="description" content="Lemon16 Bot Admin Dashboard - Manage users, track stats, and monitor activity in real-time.">
                <meta name="author" content="xAI">
                <title>Lemon16</title>
                <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
                <link rel="stylesheet" href="/styles.css">
                <link rel="icon" href="photo_5996864734789485764_x.jpg" type="image/x-icon">
            </head>
            <body>
                <div class="container">
                    <header class="dashboard-header">
                        <div class="logo">
                            <h1>Lemon16 bot</h1>
                        </div>
                        <nav class="header-actions"></nav>
                    </header>
                    <section class="stats" aria-labelledby="stats-heading">
                        <h2 id="stats-heading" class="sr-only">Statistics</h2>
                        <div class="stats-grid">
                            <div class="stats-card total-users" data-tooltip="Total number of users">
                                <i class="fas fa-users stats-icon"></i>
                                <strong>Total Users</strong>
                                <div class="stats-value" id="total-users">${totalUsers}</div>
                            </div>
                            <div class="stats-card premium-users" data-tooltip="Users with premium subscription">
                                <i class="fas fa-crown stats-icon"></i>
                                <strong>Premium Users</strong>
                                <div class="stats-value" id="premium-users">${premiumUsers}</div>
                            </div>
                            <div class="stats-card free-users" data-tooltip="Users on free plan">
                                <i class="fas fa-user stats-icon"></i>
                                <strong>Free Users</strong>
                                <div class="stats-value" id="free-users">${freeUsers}</div>
                            </div>
                            <div class="stats-card matches-today" data-tooltip="Matches made today">
                                <i class="fas fa-heart stats-icon"></i>
                                <strong>Matches Today</strong>
                                <div class="stats-value" id="matches-today">${matchesCount}</div>
                            </div>
                            <div class="stats-card inactive-users" data-tooltip="Users inactive for 7+ days">
                                <i class="fas fa-user-slash stats-icon"></i>
                                <strong>Inactive Users</strong>
                                <div class="stats-value" id="inactive-users">${inactiveUsers}</div>
                                <div class="inactive-actions">
                                    <button class="small-btn" onclick="messageInactive()">Message</button>
                                    <button class="small-btn delete-btn" onclick="deleteInactive()">Delete</button>
                                </div>
                            </div>
                        </div>
                    </section>
                    <section class="action-buttons" aria-labelledby="actions-heading">
                        <h2 class="sr-only" id="actions-heading">Quick Actions</h2>
                        <button class="reset-btn" onclick="resetSwipes()" aria-label="Reset free user swipes" title="Reset swipe counts for all free users">
                            <i class="fas fa-sync-alt"></i> Reset All Free User Swipes
                        </button>
                    </section>
                    <section class="message-users" aria-labelledby="message-heading">
                        <h2 id="message-heading">Send Message to Users</h2>
                        <form id="send-message-form" enctype="multipart/form-data">
                            <label for="message-text">Message:</label>
                            <textarea id="message-text" name="message-text" placeholder="Enter your message (e.g., ad or announcement)"></textarea>
                            <label for="message-image">Image (optional):</label>
                            <input type="file" id="message-image" name="message-image" accept="image/jpeg,image/png,image/gif">
                            <div class="message-type-options">
                                <label><input type="radio" name="message-type" value="General" checked> General</label>
                                <label><input type="radio" name="message-type" value="Premium"> Premium</label>
                                <label><input type="radio" name="message-type" value="Inactive"> Inactive</label>
                            </div>
                            <button type="submit" class="send-btn">Send Message</button>
                        </form>
                    </section>
                    ${persistentMessagesHtml}
                    <section class="users-section" aria-labelledby="users-heading">
                        <h2 id="users-heading">All Users</h2>
                        <div class="search-bar">
                            <input type="text" id="user-search" placeholder="Search users by name..." aria-label="Search users" onkeyup="searchUsers()">
                            <i class="fas fa-search search-icon"></i>
                        </div>
                        ${userListHtml}
                    </section>
                    <div id="user-details-modal" class="user-details-modal" role="dialog" aria-labelledby="modal-title" aria-hidden="true">
                        <div class="modal-content">
                            <button class="modal-close" aria-label="Close modal" onclick="closeModal()">
                                <i class="fas fa-times"></i>
                            </button>
                            <div id="user-details" class="user-details"></div>
                        </div>
                    </div>
                    <section class="activity-log" id="activity-log" aria-labelledby="log-heading">
                        <h2 id="log-heading">Activity Log</h2>
                        ${logListHtml}
                    </section>
                    <footer class="dashboard-footer">
                        <p>© ${new Date().getFullYear()} Lemon16 Bot. Powered by <a href="" target="_blank" rel="noopener noreferrer">luna</a>.</p>
                    </footer>
                </div>
                <script src="/socket.io/socket.io.js"></script>
                <script src="/dashboard.js"></script>
                <script>
                    function closeModal() {
                        document.getElementById('user-details-modal').classList.remove('show');
                        document.body.classList.remove('modal-open');
                    }
                    document.addEventListener('DOMContentLoaded', () => {
                        document.querySelectorAll('.user-table button[onclick^="showUserDetails"]').forEach(btn => {
                            btn.addEventListener('click', () => {
                                document.getElementById('user-details-modal').classList.add('show');
                                document.body.classList.add('modal-open');
                            });
                        });
                        document.getElementById('user-details-modal').addEventListener('click', (e) => {
                            if (e.target === e.currentTarget) closeModal();
                        });
                        document.addEventListener('keydown', (e) => {
                            if (e.key === 'Escape' && document.getElementById('user-details-modal').classList.contains('show')) {
                                closeModal();
                            });
                        });
                    });
                </script>
            </body>
            </html>
        `;
        console.log('Dashboard loaded successfully');
        res.send(html);
    } catch (error) {
        console.error('Dashboard error:', error);
        res.status(500).send('Error loading dashboard: ' + error.message);
    }
});

// Live Update Function
async function updateDashboard() {
    const totalUsers = await usersCollection.countDocuments();
    const premiumUsers = await usersCollection.countDocuments({ isSubscribed: true });
    const freeUsers = totalUsers - premiumUsers;
    const today = new Date().setHours(0, 0, 0, 0);
    const matchesToday = await usersCollection.aggregate([
        { $match: { lastSwipe: { $gte: new Date(today) } } },
        { $unwind: '$likedUsers' },
        { $lookup: { from: 'users', localField: 'likedUsers', foreignField: 'userId', as: 'likedUserData' } },
        { $unwind: '$likedUserData' },
        { $match: { 'likedUserData.likedUsers': { $in: ['$userId'] } } },
        { $group: { _id: null, count: { $sum: 1 } } }
    ]).toArray();
    const matchesCount = matchesToday.length > 0 ? Math.floor(matchesToday[0].count / 2) : 0;
    const allUsers = await usersCollection.find({}).toArray();
    const inactiveThreshold = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const inactiveUsers = await usersCollection.countDocuments({ lastSwipe: { $lt: inactiveThreshold } });
    const persistentMessages = await messagesCollection.find({}).sort({ timestamp: -1 }).toArray();
    io.emit('update', { totalUsers, premiumUsers, freeUsers, matchesToday: matchesCount, allUsers, inactiveUsers, persistentMessages });
}

// Log Action Function
async function logAction(userId, action) {
    await logsCollection.insertOne({ userId, action, timestamp: new Date() });
    io.emit('log', { userId, action, timestamp: new Date() });
}

// Routes for Button Actions
app.post('/reset-swipes', express.json(), async (req, res) => {
    try {
        await usersCollection.updateMany(
            { isSubscribed: false },
            { $set: { swipeCount: 20, swipeCounter: 0 } }
        );
        await updateDashboard();
        await logAction('Admin', 'Reset swipes for free users');
        res.json({ success: true, message: 'Swipes reset for free users' });
    } catch (error) {
        console.error('Swipe reset error:', error);
        res.status(500).json({ success: false, message: 'Failed to reset swipes' });
    }
});

app.get('/user/:userId', async (req, res) => {
    try {
        const userId = parseInt(req.params.userId);
        const user = await usersCollection.findOne({ userId });
        if (!user) return res.status(404).json({ error: 'User not found' });
        res.json(user);
    } catch (error) {
        console.error('User details error:', error);
        res.status(500).json({ error: `Failed to fetch user details: ${error.message}` });
    }
});

app.post('/ban-user/:userId', express.json(), async (req, res) => {
    try {
        const userId = parseInt(req.params.userId);
        const user = await usersCollection.findOne({ userId });
        if (!user) return res.status(404).json({ error: 'User not found' });
        const isBanned = !user.isBanned;
        await usersCollection.updateOne({ userId }, { $set: { isBanned } });
        if (isBanned) bot.telegram.sendMessage(userId, '🚫 You’ve been banned from Lemon16.');
        await updateDashboard();
        await logAction(userId, isBanned ? 'Banned' : 'Unbanned');
        res.json({ success: true, message: isBanned ? 'User banned' : 'User unbanned' });
    } catch (error) {
        console.error('Ban error:', error);
        res.status(500).json({ error: 'Failed to ban/unban user' });
    }
});

app.post('/delete-user/:userId', express.json(), async (req, res) => {
    try {
        const userId = parseInt(req.params.userId);
        const user = await usersCollection.findOne({ userId });
        if (!user) return res.status(404).json({ error: 'User not found' });
        await usersCollection.deleteOne({ userId });
        bot.telegram.sendMessage(userId, '🗑️ Your Lemon16 account has been deleted.');
        await updateDashboard();
        await logAction(userId, 'Deleted');
        res.json({ success: true, message: 'User deleted' });
    } catch (error) {
        console.error('Delete error:', error);
        res.status(500).json({ error: 'Failed to delete user' });
    }
});

app.post('/toggle-premium/:userId', express.json(), async (req, res) => {
    try {
        const userId = parseInt(req.params.userId);
        const user = await usersCollection.findOne({ userId });
        if (!user) return res.status(404).json({ error: 'User not found' });
        const isSubscribed = !user.isSubscribed;
        const subscriptionExpiry = isSubscribed ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) : null;
        await usersCollection.updateOne(
            { userId },
            { $set: { isSubscribed, subscriptionExpiry, swipeCount: isSubscribed ? 9999 : 20 } }
        );
        bot.telegram.sendMessage(userId, isSubscribed ? 
            '🎉 You’re now a Premium member!' : 
            '💔 Your Premium status was removed.');
        await updateDashboard();
        await logAction(userId, isSubscribed ? 'Made Premium' : 'Removed Premium');
        res.json({ success: true, message: isSubscribed ? 'User made premium' : 'Premium removed' });
    } catch (error) {
        console.error('Toggle premium error:', error);
        res.status(500).json({ error: 'Failed to toggle premium' });
    }
});

app.post('/edit-user/:userId', express.json(), async (req, res) => {
    try {
        const userId = parseInt(req.params.userId);
        const updates = req.body;
        const user = await usersCollection.findOne({ userId });
        if (!user) return res.status(404).json({ error: 'User not found' });
        await usersCollection.updateOne(
            { userId },
            { $set: { 
                name: updates.name || user.name,
                age: updates.age ? parseInt(updates.age) : user.age,
                swipeCount: updates.swipeCount ? parseInt(updates.swipeCount) : user.swipeCount
            } }
        );
        bot.telegram.sendMessage(userId, '✨ Your profile was updated by an admin!');
        await updateDashboard();
        await logAction(userId, 'Profile edited');
        res.json({ success: true, message: 'User updated' });
    } catch (error) {
        console.error('Edit user error:', error);
        res.status(500).json({ error: 'Failed to edit user' });
    }
});

app.post('/message-inactive', express.json(), async (req, res) => {
    try {
        const inactiveThreshold = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const inactiveUsers = await usersCollection.find({ lastSwipe: { $lt: inactiveThreshold } }).toArray();
        for (const user of inactiveUsers) {
            await bot.telegram.sendMessage(user.userId, '🌟 Miss us? Come back to Lemon16 for fun matches and exciting updates!');
            await logAction(user.userId, 'Sent inactive user message');
        }
        await updateDashboard();
        res.json({ success: true, message: `Sent messages to ${inactiveUsers.length} inactive users` });
    } catch (error) {
        console.error('Message inactive error:', error);
        res.status(500).json({ error: 'Failed to message inactive users' });
    }
});

app.post('/delete-inactive', express.json(), async (req, res) => {
    try {
        const inactiveThreshold = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const inactiveUsers = await usersCollection.find({ lastSwipe: { $lt: inactiveThreshold } }).toArray();
        for (const user of inactiveUsers) {
            await usersCollection.deleteOne({ userId: user.userId });
            await bot.telegram.sendMessage(user.userId, '🗑️ Your Lemon16 account was deleted due to inactivity.');
            await logAction(user.userId, 'Deleted due to inactivity');
        }
        await updateDashboard();
        res.json({ success: true, message: `Deleted ${inactiveUsers.length} inactive users` });
    } catch (error) {
        console.error('Delete inactive error:', error);
        res.status(500).json({ error: 'Failed to delete inactive users' });
    }
});

app.post('/send-message', upload.single('message-image'), async (req, res) => {
    try {
        const { 'message-text': text, 'message-type': type } = req.body;
        const image = req.file ? req.file.filename : null;

        // Allow message with either text or image
        if (!text && !image) {
            return res.status(400).json({ success: false, message: 'Please provide a message or an image' });
        }

        // Validate message type
        const validTypes = ['General', 'Premium', 'Inactive'];
        if (!validTypes.includes(type)) {
            return res.status(400).json({ success: false, message: 'Invalid message type' });
        }

        // Store message in database
        const message = {
            text: text || '',
            image,
            type,
            timestamp: new Date()
        };
        await messagesCollection.insertOne(message);

        // Notify users based on message type
        let targetUsers = [];
        if (type === 'General') {
            targetUsers = await usersCollection.find({}).toArray();
        } else if (type === 'Premium') {
            targetUsers = await usersCollection.find({ isSubscribed: true }).toArray();
        } else if (type === 'Inactive') {
            const inactiveThreshold = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
            targetUsers = await usersCollection.find({ lastSwipe: { $lt: inactiveThreshold } }).toArray();
        }

        for (const user of targetUsers) {
            try {
                if (image) {
                    await bot.telegram.sendPhoto(user.userId, { source: path.join(__dirname, 'public/uploads', image) }, {
                        caption: text || '',
                        reply_markup: mainMenuWithPremium.reply_markup
                    });
                } else {
                    await bot.telegram.sendMessage(user.userId, text, mainMenuWithPremium);
                }
            } catch (error) {
                console.error(`Failed to send message to user ${user.userId}:`, error);
            }
        }

        await logAction('Admin', `Sent ${type} message to ${targetUsers.length} users`);
        await updateDashboard();
        res.json({ success: true, message: `Message (${type}) sent to ${targetUsers.length} users` });
    } catch (error) {
        console.error('Send message error:', error);
        res.status(500).json({ success: false, message: 'Failed to send message' });
    }
});

app.post('/delete-message/:messageId', express.json(), async (req, res) => {
    try {
        const messageId = req.params.messageId;
        const result = await messagesCollection.deleteOne({ _id: new ObjectId(messageId) });
        if (result.deletedCount === 0) {
            return res.status(404).json({ success: false, message: 'Message not found' });
        }
        await logAction('Admin', 'Deleted message');
        await updateDashboard();
        res.json({ success: true, message: 'Message deleted' });
    } catch (error) {
        console.error('Delete message error:', error);
        res.status(500).json({ success: false, message: 'Failed to delete message' });
    }
});

server.listen(PORT, HOST, () => {
    console.log(`Server running on ${HOST}:${PORT}`);
});

const bot = new Telegraf(botToken);
bot.use(session());

const mainMenu = Markup.keyboard([
    ['💘 Matches', '🔍 Find Match'],
    ['🔍 Profile', '💡 Help'],
    ['✏️ Edit Profile']
]).resize();

const premiumInline = Markup.inlineKeyboard([
    [Markup.button.url('💎 Premium', 'https://t.me/lemon16pay_bot')]
]);

const mainMenuWithPremium = {
    reply_markup: {
        ...mainMenu.reply_markup,
        inline_keyboard: premiumInline.reply_markup.inline_keyboard
    }
};

const checkSubscriptionExpiry = async () => {
    try {
        const expiredUsers = await usersCollection.find({
            subscriptionExpiry: { $lt: new Date() },
            isSubscribed: true
        }).toArray();
        for (const user of expiredUsers) {
            await usersCollection.updateOne(
                { userId: user.userId },
                { $set: { isSubscribed: false, swipeCount: 20 } }
            );
            await bot.telegram.sendMessage(
                user.userId,
                '⚠️ Uh-oh, sugar… your premium access just ran out! Don’t miss out—renew now! 💳',
                { reply_markup: Markup.inlineKeyboard([[Markup.button.url('💎 Renew Premium', 'https://t.me/lemon16pay_bot')]]).reply_markup }
            );
        }
        console.log('✅ Checked and updated expired subscriptions.');
    } catch (error) {
        console.error('❌ Error checking subscription expiry:', error);
    }
};

const resetDailySwipes = async () => {
    try {
        await usersCollection.updateMany(
            { isSubscribed: false },
            { $set: { swipeCount: 20, swipeCounter: 0 } }
        );
        console.log('✅ Daily swipes reset for all free users.');
    } catch (error) {
        console.error('❌ Error resetting daily swipes:', error);
    }
};

cron.schedule('0 0 * * *', checkSubscriptionExpiry);
cron.schedule('0 0 * * *', resetDailySwipes);

bot.start(async (ctx) => {
    if (!usersCollection) {
        return ctx.reply('⏳ Whoops! Our database is still waking up. Try again in a sec! ☕');
    }
    const userId = ctx.from.id;
    const existingUser = await usersCollection.findOne({ userId });
    if (existingUser) {
        return sendProfilePreview(ctx, existingUser);
    }
    ctx.session = { userId, onboarding: true };
    await ctx.reply(
        '👋 Welcome to Lemon16 Dating App 🍑\n\n' +
        'Meet classy, wealthy, and influential people 🌍. Chat 💬, Flirt 😍, Connect 💖...\n\n' +
        'Let’s get you set up! 🚀\n\n' +
        'What’s your name? 😉'
    );
});

async function sendAdminMessage(userId, swipeCounter) {
    if (swipeCounter < 10) return;
    try {
        let message;
        // First, try to find an instant message not seen by the user
        message = await messagesCollection.findOne(
            { type: 'instant', seenBy: { $nin: [userId] } },
            { sort: { timestamp: -1 } }
        );
        // If no suitable instant message, try persistent
        if (!message) {
            message = await messagesCollection.findOne(
                { type: 'persistent' },
                { sort: { timestamp: -1 } }
            );
        }
        if (!message) return;
        if (message.image) {
            await bot.telegram.sendPhoto(userId, { source: path.join(__dirname, 'public/uploads', message.image) }, {
                caption: message.text || '',
                reply_markup: mainMenuWithPremium.reply_markup
            });
        } else {
            await bot.telegram.sendMessage(userId, message.text, mainMenuWithPremium);
        }
        if (message.type === 'instant') {
            await messagesCollection.updateOne(
                { _id: message._id },
                { $addToSet: { seenBy: userId } }
            );
        }
        console.log(`Sent ${message.type} message to user ${userId}`);
    } catch (error) {
        console.error('❌ Error sending admin message:', error);
    }
}

bot.on('text', async (ctx) => {
    if (!ctx.session || !ctx.session.userId) {
        ctx.session = { userId: ctx.from.id };
    }
    const text = ctx.message.text.trim();
    if (ctx.session.editing && ctx.session.editStep) {
        try {
            const userId = ctx.from.id;
            const field = ctx.session.editStep;
            if (field === 'age') {
                const age = parseInt(text);
                if (isNaN(age) || age < 18) {
                    return ctx.reply('❌ Age must be 18+! Try again.');
                }
                await usersCollection.updateOne(
                    { userId },
                    { $set: { age } }
                );
            } else if (['name', 'location', 'interests'].includes(field)) {
                if (field === 'name' && (text.match(/^\d+$/) || text === userId.toString())) {
                    return ctx.reply('❌ Name cannot be a number or ID. Try a real name!');
                }
                await usersCollection.updateOne(
                    { userId },
                    { $set: { [field]: text } }
                );
            } else {
                return ctx.reply('❌ Invalid input for this field.');
            }
            await ctx.reply(`✅ ${field.charAt(0).toUpperCase() + field.slice(1)} updated! What else would you like to edit?`, Markup.inlineKeyboard([
                [Markup.button.callback('📛 Name', 'edit_name'), Markup.button.callback('🎂 Age', 'edit_age')],
                [Markup.button.callback('⚧ Gender', 'edit_gender'), Markup.button.callback('📍 Location', 'edit_location')],
                [Markup.button.callback('💡 Interests', 'edit_interests'), Markup.button.callback('💘 Interested In', 'edit_interestedIn')],
                [Markup.button.callback('📸 Profile Pic', 'edit_profilePic'), Markup.button.callback('✅ Done', 'edit_done')]
            ]));
        } catch (error) {
            console.error('❌ Edit text error:', error);
            ctx.reply('❌ Failed to update profile. Try again!', mainMenuWithPremium);
        }
        return;
    }
    if (ctx.session.onboarding) {
        try {
            if (!ctx.session.name) {
                if (text.match(/^\d+$/) || text === ctx.from.id.toString()) {
                    return ctx.reply('❌ Name cannot be a number or ID. Try a real name!');
                }
                ctx.session.name = text;
                return ctx.reply(`Mmm, ${ctx.session.name}... I like it. 😏 Now, tell me your age? (18+ only! 🔥)`);
            }
            if (!ctx.session.age) {
                const age = parseInt(text);
                if (isNaN(age) || age < 18) return ctx.reply('❌ Oh, honey… that doesn’t look right. Age must be 18+! 😉');
                ctx.session.age = age;
                return ctx.reply(
                    'Got it! What’s your gender, Love?',
                    Markup.inlineKeyboard([
                        [Markup.button.callback('🚹 Male', 'gender_male'), Markup.button.callback('🚺 Female', 'gender_female')],
                        [Markup.button.callback('⚧ Other', 'gender_other')]
                    ])
                );
            }
            if (!ctx.session.location) {
                ctx.session.location = text;
                return ctx.reply('Tell me what turns you on… What are your interests? 🔥');
            }
            if (!ctx.session.interests) {
                ctx.session.interests = text;
                return ctx.reply(
                    'Who are you craving today? 😏',
                    Markup.inlineKeyboard([
                        [Markup.button.callback('Men', 'interest_men'), Markup.button.callback('Women', 'interest_women')],
                        [Markup.button.callback('Everyone', 'interest_everyone')]
                    ])
                );
            }
        } catch (error) {
            console.error('❌ Onboarding text error:', error);
            ctx.reply('❌ Oops! Something went wrong. Try again!');
        }
        return;
    }
    switch (text) {
        case '💘 Matches':
            await handleMatches(ctx);
            break;
        case '🔍 Find Match':
            await handleFindMatch(ctx);
            break;
        case '🔍 Profile':
            await handleProfile(ctx);
            break;
        case '💡 Help':
            await handleHelp(ctx);
            break;
        case '✏️ Edit Profile':
            await handleEditProfile(ctx);
            break;
        default:
            break;
    }
});

bot.action(/^gender_(.*)$/, async (ctx) => {
    try {
        ctx.session.gender = ctx.match[1];
        await ctx.answerCbQuery();
        return ctx.reply('📍 Hot! Where are you looking to find some fun? (your location 📍) 😘');
    } catch (error) {
        console.error('❌ Gender selection error:', error);
        ctx.reply('❌ Oops! Something went wrong.', mainMenuWithPremium);
    }
});

bot.action(/^interest_(.*)$/, async (ctx) => {
    try {
        ctx.session.interest = ctx.match[1];
        await ctx.answerCbQuery();
        await ctx.reply('📸 Let’s see that cute profile pic! Show them what they’re missing. 😘');
    } catch (error) {
        console.error('❌ Interest selection error:', error);
        ctx.reply('❌ Oops! Something went wrong.', mainMenuWithPremium);
    }
});

bot.action(/^edit_(.*)$/, async (ctx) => {
    try {
        await ctx.answerCbQuery();
        const field = ctx.match[1];
        const userId = ctx.from.id;
        if (!ctx.session || !ctx.session.editing) {
            return ctx.reply('❌ Edit session expired. Use /editprofile to start again.', mainMenuWithPremium);
        }
        if (field === 'done') {
            ctx.session.editing = false;
            ctx.session.editStep = null;
            await usersCollection.updateOne(
                { userId },
                { $inc: { editAttempts: -1 } }
            );
            const updatedUser = await usersCollection.findOne({ userId });
            await sendProfilePreview(ctx, updatedUser);
            return ctx.reply(`✅ Profile updated! You have ${updatedUser.editAttempts} edit attempts left.`, mainMenuWithPremium);
        }
        ctx.session.editStep = field;
        const prompts = {
            name: '📛 What’s your new name?',
            age: '🎂 What’s your new age? (18+ only)',
            gender: '⚧ What’s your new gender?',
            location: '📍 What’s your new location?',
            interests: '💡 What are your new interests?',
            interestedIn: '💘 Who are you interested in?',
            profilePic: '📸 Upload a new profile picture!'
        };
        if (field === 'gender') {
            return ctx.reply(
                prompts[field],
                Markup.inlineKeyboard([
                    [Markup.button.callback('🚹 Male', 'edit_gender_male'), Markup.button.callback('🚺 Female', 'edit_gender_female')],
                    [Markup.button.callback('⚧ Other', 'edit_gender_other')]
                ])
            );
        } else if (field === 'interestedIn') {
            return ctx.reply(
                prompts[field],
                Markup.inlineKeyboard([
                    [Markup.button.callback('Men', 'edit_interest_men'), Markup.button.callback('Women', 'edit_interest_women')],
                    [Markup.button.callback('Everyone', 'edit_interest_everyone')]
                ])
            );
        } else {
            return ctx.reply(prompts[field]);
        }
    } catch (error) {
        console.error('❌ Edit action error:', error);
        ctx.reply('❌ Failed to process edit. Try again!', mainMenuWithPremium);
    }
});

bot.action(/^edit_gender_(.*)$/, async (ctx) => {
    try {
        await ctx.answerCbQuery();
        const gender = ctx.match[1];
        const userId = ctx.from.id;
        await usersCollection.updateOne(
            { userId },
            { $set: { gender } }
        );
        await ctx.reply('✅ Gender updated! What else would you like to edit?', Markup.inlineKeyboard([
            [Markup.button.callback('📛 Name', 'edit_name'), Markup.button.callback('🎂 Age', 'edit_age')],
            [Markup.button.callback('⚧ Gender', 'edit_gender'), Markup.button.callback('📍 Location', 'edit_location')],
            [Markup.button.callback('💡 Interests', 'edit_interests'), Markup.button.callback('💘 Interested In', 'edit_interestedIn')],
            [Markup.button.callback('📸 Profile Pic', 'edit_profilePic'), Markup.button.callback('✅ Done', 'edit_done')]
        ]));
    } catch (error) {
        console.error('❌ Edit gender error:', error);
        ctx.reply('❌ Failed to update gender. Try again!', mainMenuWithPremium);
    }
});

bot.action(/^edit_interest_(.*)$/, async (ctx) => {
    try {
        await ctx.answerCbQuery();
        const interestedIn = ctx.match[1];
        const userId = ctx.from.id;
        await usersCollection.updateOne(
            { userId },
            { $set: { interestedIn } }
        );
        await ctx.reply('✅ Interested In updated! What else would you like to edit?', Markup.inlineKeyboard([
            [Markup.button.callback('📛 Name', 'edit_name'), Markup.button.callback('🎂 Age', 'edit_age')],
            [Markup.button.callback('⚧ Gender', 'edit_gender'), Markup.button.callback('📍 Location', 'edit_location')],
            [Markup.button.callback('💡 Interests', 'edit_interests'), Markup.button.callback('💘 Interested In', 'edit_interestedIn')],
            [Markup.button.callback('📸 Profile Pic', 'edit_profilePic'), Markup.button.callback('✅ Done', 'edit_done')]
        ]));
    } catch (error) {
        console.error('❌ Edit interestedIn error:', error);
        ctx.reply('❌ Failed to update interest. Try again!', mainMenuWithPremium);
    }
});

bot.on('photo', async (ctx) => {
    if (!ctx.session || !ctx.session.userId) return;
    try {
        const fileId = ctx.message.photo[ctx.message.photo.length - 1].file_id;
        const userId = ctx.session.userId;
        if (ctx.session.onboarding) {
            ctx.session.profilePic = fileId;
            const userProfile = {
                userId,
                username: ctx.from.username || '',
                name: ctx.session.name,
                age: ctx.session.age,
                gender: ctx.session.gender,
                location: ctx.session.location,
                interests: ctx.session.interests,
                interestedIn: ctx.session.interest,
                profilePic: fileId,
                isSubscribed: false,
                swipeCount: 20,
                swipeCounter: 0,
                likedUsers: [],
                dislikedUsers: [],
                subscriptionExpiry: null,
                editAttempts: 2,
                joinDate: new Date()
            };
            if (!userProfile.name || userProfile.name.match(/^\d+$/) || userProfile.name === userId.toString()) {
                ctx.session.onboarding = true;
                ctx.session.profilePic = null;
                return ctx.reply('❌ Invalid name detected. Please provide a real name with /start.');
            }
            await usersCollection.insertOne(userProfile);
            ctx.session.onboarding = false;
            await sendProfilePreview(ctx, userProfile);
            let welcomeMessage = '🎉 You’re all set! You can edit your profile up to 2 times with /editprofile if you made any mistakes. What would you like to do?';
            if (!ctx.from.username) {
                welcomeMessage += '\n\nℹ️ Tip: Set a Telegram username in your settings to make chatting easier!';
            }
            await ctx.reply(welcomeMessage, mainMenuWithPremium);
        } else if (ctx.session.editing && ctx.session.editStep === 'profilePic') {
            await usersCollection.updateOne(
                { userId },
                { $set: { profilePic: fileId } }
            );
            await ctx.reply('✅ Profile picture updated! What else would you like to edit?', Markup.inlineKeyboard([
                [Markup.button.callback('📛 Name', 'edit_name'), Markup.button.callback('🎂 Age', 'edit_age')],
                [Markup.button.callback('⚧ Gender', 'edit_gender'), Markup.button.callback('📍 Location', 'edit_location')],
                [Markup.button.callback('💡 Interests', 'edit_interests'), Markup.button.callback('💘 Interested In', 'edit_interestedIn')],
                [Markup.button.callback('📸 Profile Pic', 'edit_profilePic'), Markup.button.callback('✅ Done', 'edit_done')]
            ]));
        } else {
            await ctx.reply('📸 Nice pic! Use /editprofile to update your profile picture.', mainMenuWithPremium);
        }
    } catch (error) {
        console.error('❌ Photo upload error:', error);
        ctx.reply('❌ Failed to save your photo. Try again!', mainMenuWithPremium);
    }
});

async function sendProfilePreview(ctx, user) {
    try {
        if (!user) {
            return ctx.reply('❌ No profile found. Please complete setup with /start!', mainMenuWithPremium);
        }
        let profileText = `🔥 Your Profile:\n\n`;
        profileText += `📛 Name: ${user.name || 'Not set'}\n`;
        profileText += `👤 Username: ${user.username ? `@${user.username}` : 'No Username'}\n`;
        profileText += `🎂 Age: ${user.age || 'Not set'}\n`;
        profileText += `⚧ Gender: ${user.gender || 'Not set'}\n`;
        profileText += `📍 Location: ${user.location || 'Not set'}\n`;
        profileText += `💡 Turn-ons: ${user.interests || 'Not set'}\n`;
        profileText += `💘 Looking For: ${user.interestedIn || 'Not set'}\n`;
        profileText += `💎 Status: ${user.isSubscribed ? 'Premium ✨' : 'Free (Upgrade for more!)'}`;
        profileText += `\n✏️ Edit Attempts Left: ${user.editAttempts || 0}`;
        await ctx.replyWithPhoto(user.profilePic, {
            caption: profileText,
            reply_markup: Markup.inlineKeyboard([
                [Markup.button.callback('📸 Change Image', 'change_image'), Markup.button.callback('🔍 Find Matches', 'find_match')]
            ]).reply_markup
        });
    } catch (error) {
        console.error('❌ Profile preview error:', error);
        ctx.reply('❌ Couldn’t load your profile. Try again!', mainMenuWithPremium);
    }
}

bot.action('change_image', async (ctx) => {
    try {
        await ctx.answerCbQuery();
        await ctx.reply('📸 Please upload a new profile picture!', mainMenuWithPremium);
    } catch (error) {
        console.error('❌ Change image error:', error);
        ctx.reply('❌ Failed to change image. Try again!', mainMenuWithPremium);
    }
});

bot.action('find_match', async (ctx) => {
    try {
        await ctx.answerCbQuery();
        await handleFindMatch(ctx);
    } catch (error) {
        console.error('❌ Find match action error:', error);
        ctx.reply('❌ Something went wrong while finding matches.', mainMenuWithPremium);
    }
});

async function handleEditProfile(ctx) {
    try {
        const userId = ctx.from.id;
        const user = await usersCollection.findOne({ userId });
        if (!user) {
            return ctx.reply('❌ No profile found. Use /start to create one!', mainMenuWithPremium);
        }
        if (user.editAttempts <= 0) {
            return ctx.reply('❌ You’ve used all your profile edit attempts!', mainMenuWithPremium);
        }
        ctx.session = ctx.session || {};
        ctx.session.editing = true;
        ctx.session.editStep = 'start';
        await ctx.reply(
            `✏️ You have ${user.editAttempts} edit attempts left.\n\n` +
            'Which field would you like to edit?',
            Markup.inlineKeyboard([
                [Markup.button.callback('📛 Name', 'edit_name'), Markup.button.callback('🎂 Age', 'edit_age')],
                [Markup.button.callback('⚧ Gender', 'edit_gender'), Markup.button.callback('📍 Location', 'edit_location')],
                [Markup.button.callback('💡 Interests', 'edit_interests'), Markup.button.callback('💘 Interested In', 'edit_interestedIn')],
                [Markup.button.callback('📸 Profile Pic', 'edit_profilePic'), Markup.button.callback('✅ Done', 'edit_done')]
            ])
        );
    } catch (error) {
        console.error('❌ Edit profile error:', error);
        ctx.reply('❌ Failed to start editing. Try again!', mainMenuWithPremium);
    }
}

async function handleFindMatch(ctx) {
    try {
        const user = await usersCollection.findOne({ userId: ctx.from.id });
        if (!user) return ctx.reply('❌ Complete your profile first! Use /start', mainMenuWithPremium);
        const potentialMatches = await usersCollection.find({
            userId: { $ne: user.userId },
            gender: user.interestedIn === 'everyone' ? { $in: ['male', 'female', 'other'] } : user.interestedIn,
            interestedIn: { $in: [user.gender, 'everyone'] },
            userId: { $nin: [...user.likedUsers, ...user.dislikedUsers] }
        }).toArray();
        if (potentialMatches.length === 0) {
            return ctx.reply('😢 No new matches right now. Check back later!', mainMenuWithPremium);
        }
        const match = potentialMatches[Math.floor(Math.random() * potentialMatches.length)];
        await sendMatchProfile(ctx, user, match);
    } catch (error) {
        console.error('❌ Find match error:', error);
        ctx.reply('❌ Something went wrong while finding matches.', mainMenuWithPremium);
    }
}

async function sendMatchProfile(ctx, user, match) {
    try {
        const displayName = (match.name && !match.name.match(/^\d+$/) && match.name !== match.userId.toString()) ? match.name : 'Unknown';
        let profileText;
        if (user.isSubscribed) {
            profileText = `💘 Match Found:\n`;
            profileText += `📛 Name: ${displayName}\n`;
            profileText += `🎂 Age: ${match.age || 'Not set'}\n`;
            profileText += `📍 Location: ${match.location || 'Not set'}\n`;
            profileText += `💡 Turn-ons: ${match.interests || 'Not set'}`;
        } else {
            profileText = `💘 Potential Match:\n`;
            profileText += `🎂 Age: ${match.age || 'Not set'}\n`;
            profileText += `📍 Location: ${match.location || 'Not set'}\n`;
            profileText += `💡 Turn-ons: ${match.interests || 'Not set'}\n`;
            profileText += `💎 Upgrade to premium to see full profiles!`;
        }
        await ctx.replyWithPhoto(match.profilePic, {
            caption: profileText,
            reply_markup: Markup.inlineKeyboard([
                [Markup.button.callback('💚 Like', `like_${match.userId}`), Markup.button.callback('❌ Dislike', `dislike_${match.userId}`)]
            ]).reply_markup
        });
        await sendAdminMessage(user.userId, user.swipeCounter);
    } catch (error) {
        console.error('❌ Send match profile error:', error);
        ctx.reply('❌ Failed to show match profile.', mainMenuWithPremium);
    }
}

bot.action(/^like_(.*)$/, async (ctx) => {
    try {
        await ctx.answerCbQuery();
        const likedUserId = parseInt(ctx.match[1]);
        if (isNaN(likedUserId)) {
            return ctx.reply('❌ Invalid user. Try again!', mainMenuWithPremium);
        }
        const userId = ctx.from.id;
        const currentUser = await usersCollection.findOne({ userId });
        const likedUser = await usersCollection.findOne({ userId: likedUserId });
        if (!currentUser) {
            return ctx.reply('❌ Your profile not found. Use /start', mainMenuWithPremium);
        }
        if (!likedUser) {
            return ctx.reply('❌ Match not found. Try another!', mainMenuWithPremium);
        }
        if (currentUser.swipeCount <= 0 && !currentUser.isSubscribed) {
            return ctx.reply(
                '🔒 Out of swipes! Upgrade for unlimited fun!',
                { reply_markup: Markup.inlineKeyboard([[Markup.button.url('💎 Upgrade Now', 'https://t.me/lemon16pay_bot')]]).reply_markup }
            );
        }
        await usersCollection.updateOne(
            { userId },
            { 
                $push: { likedUsers: likedUserId }, 
                $inc: { 
                    swipeCount: currentUser.isSubscribed ? 0 : -1,
                    swipeCounter: 1
                },
                $set: { lastSwipe: new Date() }
            }
        );
        const updatedUser = await usersCollection.findOne({ userId });
        await sendAdminMessage(userId, updatedUser.swipeCounter);
        if (likedUser.likedUsers.includes(userId)) {
            const currentUserName = (currentUser.name && !currentUser.name.match(/^\d+$/) && currentUser.name !== currentUser.userId.toString()) ? currentUser.name : 'Someone';
            const likedUserName = (likedUser.name && !likedUser.name.match(/^\d+$/) && likedUser.name !== likedUser.userId.toString()) ? likedUser.name : 'Someone';
            if (currentUser.isSubscribed) {
                let matchMessageForUser = `🎉 It’s a match! You both like each other!`;
                if (likedUser.username) {
                    matchMessageForUser += `\n\n🔗 Chat now: @${likedUser.username}`;
                } else {
                    matchMessageForUser += `\n\n🔗 Chat now with ${likedUserName}`;
                }
                await ctx.telegram.sendPhoto(userId, likedUser.profilePic, {
                    caption: matchMessageForUser,
                    reply_markup: Markup.inlineKeyboard([
                        [Markup.button.url('💬 Chat Now', `tg://user?id=${likedUser.userId}`)]
                    ]).reply_markup
                });
            } else {
                await ctx.telegram.sendPhoto(userId, likedUser.profilePic, {
                    caption: `🎉 It’s a match! You both like each other!\n\n💎 Upgrade to premium to unlock chatting!`,
                    reply_markup: Markup.inlineKeyboard([
                        [Markup.button.url('💎 Upgrade Now', 'https://t.me/lemon16pay_bot')]
                    ]).reply_markup
                });
            }
            if (likedUser.isSubscribed) {
                let matchMessageForLikedUser = `🎉 It’s a match! You both like each other!`;
                if (currentUser.username) {
                    matchMessageForLikedUser += `\n\n🔗 Chat now: @${currentUser.username}`;
                } else {
                    matchMessageForLikedUser += `\n\n🔗 Chat now with ${currentUserName}`;
                }
                await ctx.telegram.sendPhoto(likedUserId, currentUser.profilePic, {
                    caption: matchMessageForLikedUser,
                    reply_markup: Markup.inlineKeyboard([
                        [Markup.button.url('💬 Chat Now', `tg://user?id=${userId}`)]
                    ]).reply_markup
                });
            } else {
                await ctx.telegram.sendPhoto(likedUserId, currentUser.profilePic, {
                    caption: `🎉 It’s a match! You both like each other!\n\n💎 Upgrade to premium to unlock chatting!`,
                    reply_markup: Markup.inlineKeyboard([
                        [Markup.button.url('💎 Upgrade Now', 'https://t.me/lemon16pay_bot')]
                    ]).reply_markup
                });
            }
        }
        await ctx.reply('🔍 Next match?', { 
            reply_markup: Markup.inlineKeyboard([
                [Markup.button.callback('🔍 Find Matches', 'find_match')]
            ]).reply_markup 
        });
    } catch (error) {
        console.error('❌ Like action error:', error);
        ctx.reply('❌ Failed to process your like. Try again!', mainMenuWithPremium);
    }
});

bot.action(/^dislike_(.*)$/, async (ctx) => {
    try {
        await ctx.answerCbQuery();
        const dislikedUserId = parseInt(ctx.match[1]);
        const userId = ctx.from.id;
        const currentUser = await usersCollection.findOne({ userId });
        if (!currentUser) return ctx.reply('❌ User not found. Try /start', mainMenuWithPremium);
        await usersCollection.updateOne(
            { userId },
            { 
                $addToSet: { dislikedUsers: dislikedUserId },
                $inc: { swipeCounter: 1 },
                $set: { lastSwipe: new Date() }
            }
        );
        const updatedUser = await usersCollection.findOne({ userId });
        await sendAdminMessage(userId, updatedUser.swipeCounter);
        await ctx.reply(
            '👎 Disliked! Next match?',
            { reply_markup: Markup.inlineKeyboard([[Markup.button.callback('🔍 Find Matches', 'find_match')]]).reply_markup }
        );
    } catch (error) {
        console.error('❌ Dislike action error:', error);
        ctx.reply('❌ Failed to process your dislike.', mainMenuWithPremium);
    }
});

const handleProfile = async (ctx) => {
    try {
        const user = await usersCollection.findOne({ userId: ctx.from.id });
        if (!user) return ctx.reply('❌ No profile found. Use /start to create one!', mainMenuWithPremium);
        await sendProfilePreview(ctx, user);
    } catch (error) {
        console.error('❌ Profile command error:', error);
        ctx.reply('❌ Failed to load profile.', mainMenuWithPremium);
    }
};

const handleMatches = async (ctx) => {
    try {
        const user = await usersCollection.findOne({ userId: ctx.from.id });
        if (!user) return ctx.reply('❌ No profile found. Use /start to create one!', mainMenuWithPremium);
        const matches = await usersCollection.find({
            userId: { $in: user.likedUsers },
            likedUsers: user.userId
        }).toArray();
        if (matches.length === 0) {
            return ctx.reply('😢 No matches yet! Keep swiping!', mainMenuWithPremium);
        }
        if (user.isSubscribed) {
            for (const match of matches) {
                const displayName = (match.name && !match.name.match(/^\d+$/) && match.name !== match.userId.toString()) ? match.name : 'Unknown';
                const usernameText = match.username ? `@${match.username}` : 'No Username';
                const matchText = `💘 Match:\n📛 Name: ${displayName}\n👤 Username: ${usernameText}\n🎂 Age: ${match.age || 'Not set'}`;
                await ctx.telegram.sendPhoto(user.userId, match.profilePic, {
                    caption: matchText,
                    reply_markup: Markup.inlineKeyboard([
                        [Markup.button.url('💬 Chat Now', `tg://user?id=${match.userId}`)]
                    ]).reply_markup
                });
            }
        } else {
            await ctx.reply(
                '💘 You have matches! Upgrade to premium to see who they are and start chatting!',
                { reply_markup: Markup.inlineKeyboard([[Markup.button.url('💎 Upgrade Now', 'https://t.me/lemon16pay_bot')]]).reply_markup }
            );
        }
    } catch (error) {
        console.error('❌ Matches command error:', error);
        ctx.reply('❌ Couldn’t load your matches. Try again!', mainMenuWithPremium);
    }
};

const handleHelp = async (ctx) => {
    try {
        await ctx.reply('💡 Need help? Contact us at: support@lemon16.com', mainMenuWithPremium);
    } catch (error) {
        console.error('❌ Help command error:', error);
        ctx.reply('❌ Failed to show help.', mainMenuWithPremium);
    }
};

bot.command('profile', handleProfile);
bot.command('matches', handleMatches);
bot.command('help', handleHelp);
bot.command('editprofile', handleEditProfile);

async function startBot() {
    await initialize();
    bot.launch().then(() => {
        console.log('🚀 Lemon16 is up and running!');
    }).catch((err) => {
        console.error('❌ Error starting bot:', err);
    });
}

startBot();

process.once('SIGINT', async () => {
    console.log('Shutting down...');
    await client.close();
    bot.stop('SIGINT');
});
