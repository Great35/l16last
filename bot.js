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
        const inactiveThreshold = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const inactiveUsers = await usersCollection.countDocuments({ lastSwipe: { $lt: inactiveThreshold } });

        let userListHtml = `
            <table class="user-table" id="user-table">
                <thead>
                    <tr>
                        <th>Name</th>
                        <th>Status</th>
                        <th>Swipes</th>
                        <th>Last Active</th>
                        <th>Joined</th>
                        <th>Banned</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
        `;
        allUsers.forEach(user => {
            userListHtml += `
                <tr>
                    <td>${user.name || 'No Name'}</td>
                    <td>${user.isSubscribed ? 'Premium ✨' : 'Free'}</td>
                    <td>${user.swipeCount ?? '0'}</td>
                    <td>${user.lastSwipe ? new Date(user.lastSwipe).toLocaleDateString() : 'Never'}</td>
                    <td>${user.joinDate ? new Date(user.joinDate).toLocaleDateString() : 'Unknown'}</td>
                    <td>${user.isBanned ? 'Yes' : 'No'}</td>
                    <td>
                        <button onclick="showUserDetails('${user.userId}')">View</button>
                        <button class="ban-btn" onclick="banUser('${user.userId}')">${user.isBanned ? 'Unban' : 'Ban'}</button>
                        <button class="delete-btn" onclick="deleteUser('${user.userId}')">Delete</button>
                        <button onclick="togglePremium('${user.userId}', ${user.isSubscribed})">${user.isSubscribed ? 'Remove Premium' : 'Make Premium'}</button>
                    </td>
                </tr>
            `;
        });
        userListHtml += '</tbody></table>';

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
                            <div class="stats-card inactive-users" data-tooltip="Users inactive for 30+ days">
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
                            }
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
    const matchesCount = matchesToday.length > 0 ? matchesToday[0].count / 2 : 0;
    const allUsers = await usersCollection.find({}).toArray();
    const inactiveThreshold = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const inactiveUsers = await usersCollection.countDocuments({ lastSwipe: { $lt: inactiveThreshold } });
    io.emit('update', { totalUsers, premiumUsers, freeUsers, matchesToday: matchesCount, allUsers, inactiveUsers });
}

// Log Action Function
async function logAction(userId, action) {
    await logsCollection.insertOne({ userId, action, timestamp: new Date() });
    io.emit('log', { userId, action, timestamp: new Date().toLocaleString() });
}

// Routes for Button Actions
app.post('/reset-swipes', express.json(), async (req, res) => {
    try {
        await usersCollection.updateMany(
            { isSubscribed: false },
            { $set: { swipeCount: 20 } }
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
        const inactiveThreshold = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
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
        const inactiveThreshold = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
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

server.listen(PORT, HOST, () => {
    console.log(`Server running on ${HOST}:${PORT}`);
});

const bot = new Telegraf(botToken);
bot.use(session()); // Use in-memory session for now

// Define Main Menu Reply Keyboard
const mainMenu = Markup.keyboard([
    ['🔍 Profile', '💘 Matches'],
    ['💡 Help', '🔍 Find Match']
]).resize();

// Define Inline Premium Button
const premiumInline = Markup.inlineKeyboard([
    [Markup.button.url('💎 Premium', 'https://t.me/lemon16pay_bot')]
]);

// Combine Main Menu with Inline Premium
const mainMenuWithPremium = {
    reply_markup: {
        ...mainMenu.reply_markup,
        inline_keyboard: premiumInline.reply_markup.inline_keyboard
    }
};

// Initialize MongoDB


// Subscription and Swipe Management with Cron
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
            { $set: { swipeCount: 20 } }
        );
        console.log('✅ Daily swipes reset for all free users.');
    } catch (error) {
        console.error('❌ Error resetting daily swipes:', error);
    }
};

// Schedule daily tasks at midnight
cron.schedule('0 0 * * *', checkSubscriptionExpiry);
cron.schedule('0 0 * * *', resetDailySwipes);

// Start Command - Begin Onboarding
bot.start(async (ctx) => {
    if (!usersCollection) {
        return ctx.reply('⏳ Whoops! Our database is still waking up. Try again in a sec! ☕', mainMenuWithPremium);
    }

    const userId = ctx.from.id;
    const existingUser = await usersCollection.findOne({ userId });

    if (existingUser) {
        console.log('Existing user found:', existingUser);
        return sendProfilePreview(ctx, existingUser);
    }

    ctx.session = { userId, onboarding: true }; // Flag for onboarding
    await ctx.reply(
        '👋 Welcome to Lemon16 Dating App 🍑\n\n' +
        'Meet classy, wealthy, and influential people 🌍. Chat 💬, Flirt 😍, Connect 💖...\n\n' +
        'Let’s get you set up! 🚀\n\n' +
        'What’s your name? 😉',
        mainMenuWithPremium
    );
});

// Handle Text Input (Onboarding and Main Menu)
bot.on('text', async (ctx) => {
    if (!ctx.session || !ctx.session.userId) {
        ctx.session = { userId: ctx.from.id }; // Initialize session if missing
    }

    const text = ctx.message.text.trim(); // Remove extra spaces
    console.log('Text received:', text);

    // Handle Onboarding
    if (ctx.session.onboarding) {
        try {
            if (!ctx.session.name) {
                ctx.session.name = text;
                return ctx.reply(`Mmm, ${ctx.session.name}... I like it. 😏 Now, tell me your age? (18+ only! 🔥)`, mainMenuWithPremium);
            }

            if (!ctx.session.age) {
                const age = parseInt(text);
                if (isNaN(age) || age < 18) return ctx.reply('❌ Oh, honey… that doesn’t look right. Age must be 18+! 😉', mainMenuWithPremium);
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
                return ctx.reply('Tell me what turns you on… What are your interests? 🔥', mainMenuWithPremium);
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
            ctx.reply('❌ Oops! Something went wrong. Try again!', mainMenuWithPremium);
        }
        return; // Exit after onboarding handling
    }

    // Handle Main Menu Buttons
    switch (text) {
        case '🔍 Profile':
            console.log('Profile button clicked');
            await handleProfile(ctx);
            break;
        case '💘 Matches':
            console.log('Matches button clicked');
            await handleMatches(ctx);
            break;
        case '💡 Help':
            console.log('Help button clicked');
            await handleHelp(ctx);
            break;
        case '🔍 Find Match':
            console.log('Find Match button clicked');
            await handleFindMatch(ctx);
            break;
        default:
            console.log('Unhandled text:', text);
            break;
    }
});

// Handle Gender and Interest Selection
bot.action(/^gender_(.*)$/, async (ctx) => {
    try {
        ctx.session.gender = ctx.match[1];
        await ctx.answerCbQuery();
        return ctx.reply('📍 Hot! Where are you looking to find some fun? (your location 📍) 😘', mainMenuWithPremium);
    } catch (error) {
        console.error('❌ Gender selection error:', error);
        ctx.reply('❌ Oops! Something went wrong.', mainMenuWithPremium);
    }
});

bot.action(/^interest_(.*)$/, async (ctx) => {
    try {
        ctx.session.interest = ctx.match[1];
        await ctx.answerCbQuery();
        await ctx.reply('📸 Let’s see that cute profile pic! Show them what they’re missing. 😘', mainMenuWithPremium);
    } catch (error) {
        console.error('❌ Interest selection error:', error);
        ctx.reply('❌ Oops! Something went wrong.', mainMenuWithPremium);
    }
});

// Handle Profile Picture Upload
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
                likedUsers: [],
                dislikedUsers: [],
                subscriptionExpiry: null
            };
            await usersCollection.insertOne(userProfile);
            console.log('User saved:', userProfile);
            ctx.session.onboarding = false; // End onboarding
            await sendProfilePreview(ctx, userProfile);
            // Send a follow-up message to ensure keyboard opens
            await ctx.reply('🎉 You’re all set! What would you like to do?', mainMenuWithPremium);
        } else {
            await usersCollection.updateOne(
                { userId },
                { $set: { profilePic: fileId } }
            );
            const updatedUser = await usersCollection.findOne({ userId });
            await sendProfilePreview(ctx, updatedUser);
        }
    } catch (error) {
        console.error('❌ Photo upload error:', error);
        ctx.reply('❌ Failed to save your profile pic. Try again!', mainMenuWithPremium);
    }
});

// Send Profile Preview
async function sendProfilePreview(ctx, user) {
    try {
        if (!user) {
            return ctx.reply('❌ No profile found. Please complete setup with /start!', mainMenuWithPremium);
        }

        let profileText = `🔥 Your Profile:\n\n`;
        profileText += `📛 Name: ${user.name || 'Not set'}\n`;
        profileText += `🎂 Age: ${user.age || 'Not set'}\n`;
        profileText += `⚧ Gender: ${user.gender || 'Not set'}\n`;
        profileText += `📍 Location: ${user.location || 'Not set'}\n`;
        profileText += `💡 Turn-ons: ${user.interests || 'Not set'}\n`;
        profileText += `💘 Looking For: ${user.interestedIn || 'Not set'}\n`;
        profileText += `💎 Status: ${user.isSubscribed ? 'Premium ✨' : 'Free (Upgrade for more!)'}`;

        await ctx.replyWithPhoto(user.profilePic, {
            caption: profileText,
            reply_markup: Markup.inlineKeyboard([
                [Markup.button.callback('📸 Change Image', 'change_image'), Markup.button.callback('🔍 Find Matches', 'find_match')]
            ]).reply_markup
        }, mainMenuWithPremium);
    } catch (error) {
        console.error('❌ Profile preview error:', error);
        ctx.reply('❌ Couldn’t load your profile. Try again!', mainMenuWithPremium);
    }
}

// Handle Change Image Action
bot.action('change_image', async (ctx) => {
    try {
        await ctx.answerCbQuery();
        await ctx.reply('📸 Please upload a new profile picture!', mainMenuWithPremium);
    } catch (error) {
        console.error('❌ Change image error:', error);
        ctx.reply('❌ Failed to change image. Try again!', mainMenuWithPremium);
    }
});

// Find Match (Inline Button Handler)
bot.action('find_match', async (ctx) => {
    try {
        await ctx.answerCbQuery();
        await handleFindMatch(ctx);
    } catch (error) {
        console.error('❌ Find match action error:', error);
        ctx.reply('❌ Something went wrong while finding matches.', mainMenuWithPremium);
    }
});

// Find Match (Main Menu Handler)
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

// Send Match Profile
async function sendMatchProfile(ctx, user, match) {
    try {
        let profileText = `💘 Match Found:\n`;
        profileText += `📛 Name: ${match.name}\n`;
        profileText += `🎂 Age: ${match.age}\n`;
        profileText += `📍 Location: ${match.location}\n`;
        profileText += `💡 Turn-ons: ${match.interests}`;

        await ctx.replyWithPhoto(match.profilePic, {
            caption: profileText,
            reply_markup: Markup.inlineKeyboard([
                [Markup.button.callback('💚 Like', `like_${match.userId}`), Markup.button.callback('❌ Dislike', `dislike_${match.userId}`)]
            ]).reply_markup
        }, mainMenuWithPremium);
    } catch (error) {
        console.error('❌ Send match profile error:', error);
        ctx.reply('❌ Failed to show match profile.', mainMenuWithPremium);
    }
}

// Handle Like Action
bot.action(/^like_(.*)$/, async (ctx) => {
    try {
        console.log('Like action triggered:', ctx.match[0]); // Log the action trigger
        await ctx.answerCbQuery(); // Acknowledge the callback immediately

        const likedUserId = parseInt(ctx.match[1]);
        const userId = ctx.from.id;
        console.log('Processing like for userId:', userId, 'liking:', likedUserId);

        const currentUser = await usersCollection.findOne({ userId });
        const likedUser = await usersCollection.findOne({ userId: likedUserId });
        console.log('Fetched users - Current:', !!currentUser, 'Liked:', !!likedUser);

        if (!currentUser || !likedUser) {
            console.log('User not found');
            return ctx.reply('❌ Oops! Something went wrong.', mainMenuWithPremium);
        }

        if (currentUser.swipeCount <= 0 && !currentUser.isSubscribed) {
            console.log('Out of swipes for user:', userId);
            return ctx.reply(
                '🔒 Out of swipes! Upgrade for unlimited fun!',
                { reply_markup: Markup.inlineKeyboard([[Markup.button.url('💎 Upgrade Now', 'https://t.me/lemon16pay_bot')]]).reply_markup },
                mainMenuWithPremium
            );
        }

        console.log('Updating database for like');
        await usersCollection.updateOne(
            { userId },
            { $push: { likedUsers: likedUserId }, $inc: { swipeCount: currentUser.isSubscribed ? 0 : -1 } }
        );

        if (likedUser.likedUsers.includes(userId)) {
            console.log('Mutual like detected');
            let matchMessageForUser = `🎉 It’s a match! You and ${likedUser.name} like each other!`;
            let matchMessageForLikedUser = `🎉 It’s a match! You and ${currentUser.name} like each other!`;

            if (currentUser.isSubscribed) {
                matchMessageForUser += `\n\n🔗 Chat now: @${likedUser.username}`;
                console.log('Sending match message to current user (premium)');
                await ctx.telegram.sendPhoto(userId, likedUser.profilePic, {
                    caption: matchMessageForUser,
                    reply_markup: Markup.inlineKeyboard([[Markup.button.url('💬 Chat Now', `tg://user?id=${likedUser.userId}`)]]).reply_markup
                }, mainMenuWithPremium);
            } else {
                matchMessageForUser += `\n\n💎 Upgrade to premium to unlock usernames and chat!`;
                console.log('Sending match message to current user (free)');
                await ctx.telegram.sendPhoto(userId, likedUser.profilePic, {
                    caption: matchMessageForUser,
                    reply_markup: Markup.inlineKeyboard([[Markup.button.url('💎 Upgrade Now', 'https://t.me/lemon16pay_bot')]]).reply_markup
                }, mainMenuWithPremium);
            }

            if (likedUser.isSubscribed) {
                matchMessageForLikedUser += `\n\n🔗 Chat now: @${currentUser.username}`;
                console.log('Sending match message to liked user (premium)');
                await ctx.telegram.sendPhoto(likedUserId, currentUser.profilePic, {
                    caption: matchMessageForLikedUser,
                    reply_markup: Markup.inlineKeyboard([[Markup.button.url('💬 Chat Now', `tg://user?id=${userId}`)]]).reply_markup
                }, mainMenuWithPremium);
            } else {
                matchMessageForLikedUser += `\n\n💎 Upgrade to premium to unlock usernames and chat!`;
                console.log('Sending match message to liked user (free)');
                await ctx.telegram.sendPhoto(likedUserId, currentUser.profilePic, {
                    caption: matchMessageForLikedUser,
                    reply_markup: Markup.inlineKeyboard([[Markup.button.url('💎 Upgrade Now', 'https://t.me/lemon16pay_bot')]]).reply_markup
                }, mainMenuWithPremium);
            }
        }

        console.log('Sending next match prompt');
        await ctx.reply('🔍 Next match?', { reply_markup: Markup.inlineKeyboard([[Markup.button.callback('🔍 Find Matches', 'find_match')]]).reply_markup }, mainMenuWithPremium);
    } catch (error) {
        console.error('❌ Like action error:', error);
        await ctx.reply('❌ Failed to process your like.', mainMenuWithPremium);
    }
});

// Handle Dislike Action
bot.action(/^dislike_(.*)$/, async (ctx) => {
    try {
        await ctx.answerCbQuery();
        const dislikedUserId = parseInt(ctx.match[1]);
        const userId = ctx.from.id;

        const currentUser = await usersCollection.findOne({ userId });
        if (!currentUser) return ctx.reply('❌ User not found. Try /start', mainMenuWithPremium);

        await usersCollection.updateOne(
            { userId },
            { $addToSet: { dislikedUsers: dislikedUserId } }
        );

        await ctx.reply(
            '👎 Disliked! Next match?',
            { reply_markup: Markup.inlineKeyboard([[Markup.button.callback('🔍 Find Matches', 'find_match')]]).reply_markup },
            mainMenuWithPremium
        );
    } catch (error) {
        console.error('❌ Dislike action error:', error);
        ctx.reply('❌ Failed to process your dislike.', mainMenuWithPremium);
    }
});

// Command Handlers
const handleProfile = async (ctx) => {
    try {
        const user = await usersCollection.findOne({ userId: ctx.from.id });
        console.log('Profile requested for userId:', ctx.from.id, 'Found:', user);
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
        console.log('Matches requested for userId:', ctx.from.id, 'Found:', user);
        if (!user) return ctx.reply('❌ No profile found. Use /start to create one!', mainMenuWithPremium);

        const matches = await usersCollection.find({
            userId: { $in: user.likedUsers },
            likedUsers: user.userId
        }).toArray();

        if (matches.length === 0) {
            return ctx.reply('😢 No matches yet! Keep swiping!', mainMenuWithPremium);
        }

        if (user.isSubscribed) {
            let matchList = '💘 Your Matches:\n\n';
            matches.forEach((match, index) => {
                matchList += `${index + 1}. @${match.username} - ${match.name}\n`;
            });
            await ctx.reply(matchList, mainMenuWithPremium);
        } else {
            await ctx.reply(
                '💘 You have matches! Upgrade to premium to see usernames and chat!',
                { reply_markup: Markup.inlineKeyboard([[Markup.button.url('💎 Upgrade Now', 'https://t.me/lemon16pay_bot')]]).reply_markup },
                mainMenuWithPremium
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

// Register Commands
bot.command('profile', handleProfile);
bot.command('matches', handleMatches);
bot.command('help', handleHelp);

// Launch Bot after Initialization
async function startBot() {
    await initialize(); // Wait for DB setup
    bot.launch().then(() => {
        console.log('🚀 Lemon16 is up and running!');
    }).catch((err) => {
        console.error('❌ Error starting bot:', err);
    });
}

startBot();

// Graceful Shutdown
process.once('SIGINT', async () => {
    console.log('Shutting down...');
    await client.close();
    bot.stop('SIGINT');
});
