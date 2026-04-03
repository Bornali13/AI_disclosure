const AUTH_KEY = 'aidisclosure_auth_v1';
const API_BASE = "https://ai-disclosure.onrender.com";

const auth = JSON.parse(localStorage.getItem(AUTH_KEY) || 'null');

if (!auth || !auth.token) {
    window.location.href = 'index.html';
}

const alertBox = document.getElementById('changeAlert');
const successBox = document.getElementById('changeSuccess');

function showError(message) {
    successBox.classList.add('d-none');
    alertBox.textContent = message;
    alertBox.classList.remove('d-none');
}

function showSuccess(message) {
    alertBox.classList.add('d-none');
    successBox.textContent = message;
    successBox.classList.remove('d-none');
}

document.getElementById('changePasswordForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const current_password = document.getElementById('currentPassword').value.trim();
    const new_password = document.getElementById('newPassword').value.trim();
    const confirm_password = document.getElementById('confirmPassword').value.trim();
    
    if (new_password !== confirm_password) {
        showError('New passwords do not match');
        return;
    }

    try {
    const res = await fetch(`${API_BASE}/api/change-password`, {
        method: 'POST',
        headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${auth.token}`
        },
        body: JSON.stringify({ current_password, new_password, confirm_password })
    });

    const data = await res.json();

    if (!res.ok) {
        showError(data.detail || 'Password change failed');
        return;
    }

    showSuccess(data.message);

    setTimeout(() => {
        window.location.href = 'teacher.html';
    }, 1200);

    } catch (err) {
    showError('Server error while changing password');
}});