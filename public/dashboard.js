const socket = io();

socket.on('connect', () => {
    console.log('Connected to Socket.IO server');
    showAlert('Connected to server', 'success');
});

socket.on('disconnect', () => {
    console.log('Disconnected from Socket.IO server');
    showAlert('Disconnected from server', 'error');
});

socket.on('update', (data) => {
    console.log('Received update:', data);
    try {
        // Update stats with fallback values
        document.getElementById('total-users').textContent = data.totalUsers ?? '0';
        document.getElementById('premium-users').textContent = data.premiumUsers ?? '0';
        document.getElementById('free-users').textContent = data.freeUsers ?? '0';
        document.getElementById('matches-today').textContent = data.matchesToday ?? '0';
        document.getElementById('inactive-users').textContent = data.inactiveUsers ?? '0';

        // Update user table
        const tbody = document.querySelector('#user-table tbody');
        if (!tbody) {
            console.error('User table body not found');
            return;
        }

        let userListHtml = '';
        if (data.allUsers && Array.isArray(data.allUsers)) {
            if (data.allUsers.length === 0) {
                userListHtml = '<tr><td colspan="7">No users found</td></tr>';
            } else {
                data.allUsers.forEach(user => {
                    const lastActive = user.lastSwipe ? new Date(user.lastSwipe).toLocaleString() : 'Never';
                    const joinDate = user.joinDate ? new Date(user.joinDate).toLocaleDateString() : 'Unknown';
                    userListHtml += `
                        <tr>
                            <td data-label="Name">${user.name || 'No Name'}</td>
                            <td data-label="Status">${user.isSubscribed ? 'Premium ✨' : 'Free'}</td>
                            <td data-label="Swipes">${user.swipeCount ?? '0'}</td>
                            <td data-label="Last Active">${lastActive}</td>
                            <td data-label="Joined">${joinDate}</td>
                            <td data-label="Banned">${user.isBanned ? 'Yes' : 'No'}</td>
                            <td data-label="Actions">
                                <button onclick="showUserDetails('${user.userId}')"><i class="fas fa-eye"></i> View</button>
                                <button class="ban-btn" onclick="banUser('${user.userId}')"><i class="fas fa-ban"></i> ${user.isBanned ? 'Unban' : 'Ban'}</button>
                                <button class="delete-btn" onclick="deleteUser('${user.userId}')"><i class="fas fa-trash"></i> Delete</button>
                                <button onclick="togglePremium('${user.userId}', ${user.isSubscribed})"><i class="fas fa-crown"></i> ${user.isSubscribed ? 'Remove Premium' : 'Make Premium'}</button>
                            </td>
                        </tr>
                    `;
                });
            }
            tbody.innerHTML = userListHtml;
        } else {
            console.warn('No valid user data received');
            tbody.innerHTML = '<tr><td colspan="7">No users found</td></tr>';
        }
    } catch (error) {
        console.error('Error updating dashboard:', error);
        showAlert('Failed to update dashboard', 'error');
    }
});

socket.on('log', (log) => {
    console.log('Received log:', log);
    const logList = document.getElementById('log-list');
    if (logList) {
        const li = document.createElement('li');
        li.textContent = `[${new Date(log.timestamp).toLocaleString()}] User ${log.userId}: ${log.action}`;
        li.classList.add('log-entry');
        logList.insertBefore(li, logList.firstChild);
        // Limit to 50 log entries to prevent overflow
        while (logList.children.length > 50) {
            logList.removeChild(logList.lastChild);
        }
    }
});

// Custom Alert Function
function showAlert(message, type = 'info') {
    const alertContainer = document.createElement('div');
    alertContainer.className = 'alert-container';
    if (!document.querySelector('.alert-container')) {
        document.body.appendChild(alertContainer);
    } else {
        alertContainer = document.querySelector('.alert-container');
    }

    const alert = document.createElement('div');
    alert.className = `alert ${type}`;
    alert.innerHTML = `
        <span>${message}</span>
        <button class="alert-close" aria-label="Close alert"><i class="fas fa-times"></i></button>
    `;
    alertContainer.prepend(alert);

    setTimeout(() => {
        alert.style.opacity = '0';
        setTimeout(() => alert.remove(), 300);
    }, 5000);

    alert.querySelector('.alert-close').addEventListener('click', () => {
        alert.style.opacity = '0';
        setTimeout(() => alert.remove(), 300);
    });
}

// Custom Confirmation Modal
function showConfirm(message, onConfirm) {
    const confirmModal = document.createElement('div');
    confirmModal.className = 'confirm-modal';
    confirmModal.innerHTML = `
        <div class="confirm-modal-content">
            <p>${message}</p>
            <div class="confirm-buttons">
                <button class="confirm-btn">Yes</button>
                <button class="cancel-btn">No</button>
            </div>
        </div>
    `;
    document.body.appendChild(confirmModal);

    const confirmBtn = confirmModal.querySelector('.confirm-btn');
    const cancelBtn = confirmModal.querySelector('.cancel-btn');

    confirmBtn.addEventListener('click', () => {
        onConfirm();
        confirmModal.remove();
        document.body.classList.remove('modal-open');
    });

    cancelBtn.addEventListener('click', () => {
        confirmModal.remove();
        document.body.classList.remove('modal-open');
    });

    confirmModal.addEventListener('click', (e) => {
        if (e.target === confirmModal) {
            confirmModal.remove();
            document.body.classList.remove('modal-open');
        }
    });

    const onKeydown = (e) => {
        if (e.key === 'Escape') {
            confirmModal.remove();
            document.body.classList.remove('modal-open');
            document.removeEventListener('keydown', onKeydown);
        }
    };
    document.addEventListener('keydown', onKeydown);

    document.body.classList.add('modal-open');
}

// Action Functions
async function resetSwipes() {
    showConfirm('Reset swipes for all free users?', async () => {
        try {
            const response = await fetch('/reset-swipes', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
            const result = await response.json();
            showAlert(result.message || result.error || 'Swipes reset', result.error ? 'error' : 'success');
            socket.emit('request-update'); // Request fresh data
        } catch (error) {
            console.error('Reset swipes error:', error);
            showAlert('Failed to reset swipes', 'error');
        }
    });
}

async function showUserDetails(userId) {
    try {
        console.log(`Fetching details for user ${userId}`);
        const response = await fetch(`/user/${userId}`);
        if (!response.ok) throw new Error(`HTTP error: ${response.status}`);
        const user = await response.json();
        if (user.error) {
            showAlert(user.error, 'error');
            return;
        }
        console.log('User details:', user);
        const detailsDiv = document.getElementById('user-details');
        detailsDiv.innerHTML = `
            <h3>${user.name || 'No Name'}</h3>
            ${user.profilePic ? `<img src="https://api.telegram.org/file/botYOUR_BOT_TOKEN_HERE/${user.profilePic}" alt="Profile Pic" style="max-width: 200px; border-radius: 10px;" onerror="this.src=''; this.nextSibling.style.display='block';">` : '<p>No profile pic</p>'}
            <p style="display: none;">Image failed to load</p>
            <form id="edit-user-form">
                <p><strong>User ID:</strong> ${user.userId}</p>
                <p><strong>Name:</strong> <input type="text" name="name" value="${user.name || ''}"></p>
                <p><strong>Age:</strong> <input type="number" name="age" value="${user.age || ''}"></p>
                <p><strong>Swipe Count:</strong> <input type="number" name="swipeCount" value="${user.swipeCount ?? '0'}"></p>
                <p><strong>Gender:</strong> ${user.gender || 'Not set'}</p>
                <p><strong>Status:</strong> ${user.isSubscribed ? 'Premium ✨' : 'Free'}</p>
                <p><strong>Joined:</strong> ${user.joinDate ? new Date(user.joinDate).toLocaleString() : 'Unknown'}</p>
                <p><strong>Last Swipe:</strong> ${user.lastSwipe ? new Date(user.lastSwipe).toLocaleString() : 'Never'}</p>
                <p><strong>Banned:</strong> ${user.isBanned ? 'Yes' : 'No'}</p>
                <button type="submit">Save Changes</button>
            </form>
        `;
        document.getElementById('user-details-modal').classList.add('show');
        document.body.classList.add('modal-open');

        document.getElementById('edit-user-form').onsubmit = async (e) => {
            e.preventDefault();
            const formData = new FormData(e.target);
            const updates = {
                name: formData.get('name'),
                age: formData.get('age') ? parseInt(formData.get('age')) : null,
                swipeCount: formData.get('swipeCount') ? parseInt(formData.get('swipeCount')) : 0
            };
            try {
                const response = await fetch(`/edit-user/${userId}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(updates)
                });
                const result = await response.json();
                showAlert(result.message || result.error || 'User updated', result.error ? 'error' : 'success');
                if (result.success) {
                    showUserDetails(userId);
                    socket.emit('request-update');
                }
            } catch (error) {
                console.error('Edit user error:', error);
                showAlert('Failed to update user', 'error');
            }
        };
    } catch (error) {
        console.error('Error fetching user details:', error);
        showAlert(`Oops! Couldn’t load user details: ${error.message}`, 'error');
    }
}

async function banUser(userId) {
    showConfirm('Ban or unban this user?', async () => {
        try {
            const response = await fetch(`/ban-user/${userId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
            const result = await response.json();
            showAlert(result.message || result.error || 'Ban toggled', result.error ? 'error' : 'success');
            socket.emit('request-update');
        } catch (error) {
            console.error('Ban user error:', error);
            showAlert('Failed to ban/unban user', 'error');
        }
    });
}

async function deleteUser(userId) {
    showConfirm('Are you sure you want to delete this user?', async () => {
        try {
            const response = await fetch(`/delete-user/${userId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
            const result = await response.json();
            showAlert(result.message || result.error || 'User deleted', result.error ? 'error' : 'success');
            socket.emit('request-update');
        } catch (error) {
            console.error('Delete user error:', error);
            showAlert('Failed to delete user', 'error');
        }
    });
}

async function togglePremium(userId, isSubscribed) {
    showConfirm(isSubscribed ? 'Remove Premium?' : 'Make Premium?', async () => {
        try {
            const response = await fetch(`/toggle-premium/${userId}`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
            const result = await response.json();
            showAlert(result.message || result.error || 'Premium toggled', result.error ? 'error' : 'success');
            socket.emit('request-update');
        } catch (error) {
            console.error('Toggle premium error:', error);
            showAlert('Failed to toggle premium', 'error');
        }
    });
}

async function messageInactive() {
    showConfirm('Send a message to all inactive users (30+ days)?', async () => {
        try {
            const response = await fetch('/message-inactive', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
            const result = await response.json();
            showAlert(result.message || result.error || 'Messages sent', result.error ? 'error' : 'success');
            socket.emit('request-update');
        } catch (error) {
            console.error('Message inactive error:', error);
            showAlert('Failed to message inactive users', 'error');
        }
    });
}

async function deleteInactive() {
    showConfirm('Delete all inactive users (30+ days)? This cannot be undone!', async () => {
        try {
            const response = await fetch('/delete-inactive', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
            const result = await response.json();
            showAlert(result.message || result.error || 'Inactive users deleted', result.error ? 'error' : 'success');
            socket.emit('request-update');
        } catch (error) {
            console.error('Delete inactive error:', error);
            showAlert('Failed to delete inactive users', 'error');
        }
    });
}

function searchUsers() {
    try {
        const input = document.getElementById('user-search').value.toLowerCase();
        const table = document.getElementById('user-table');
        const rows = table.getElementsByTagName('tr');
        for (let i = 1; i < rows.length; i++) {
            const name = rows[i].getElementsByTagName('td')[0].textContent.toLowerCase();
            rows[i].style.display = name.includes(input) ? '' : 'none';
        }
    } catch (error) {
        console.error('Search users error:', error);
        showAlert('Failed to search users', 'error');
    }
}

// Theme Toggle
document.getElementById('theme-toggle').onclick = () => {
    document.body.classList.toggle('dark-mode');
    localStorage.setItem('theme', document.body.classList.contains('dark-mode') ? 'dark' : 'light');
    socket.emit('theme-changed', document.body.classList.contains('dark-mode') ? 'dark' : 'light');
};

if (localStorage.getItem('theme') === 'dark') document.body.classList.add('dark-mode');

// Initial check for dashboard load
window.onload = () => {
    console.log('Dashboard page loaded');
    if (!document.getElementById('total-users')) {
        console.error('Stats elements not found in HTML');
        showAlert('Dashboard elements missing', 'error');
    }
    socket.emit('request-update'); // Request initial data on load
};