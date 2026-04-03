const API_BASE = "https://ai-disclosure.onrender.com";
const ADMIN_KEY = "aidisclosure_admin_auth";

document.getElementById("adminLoginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = document.getElementById("adminEmail").value;
    const password = document.getElementById("adminPassword").value;
    const alertBox = document.getElementById("adminAlert");
    
    alertBox.classList.add("d-none");
    
    try {
    const res = await fetch(`${API_BASE}/api/admin/login`, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({ email, password })
    });

    const data = await res.json();

    if (!res.ok) {
        alertBox.textContent = data.detail;
        alertBox.classList.remove("d-none");
        return;
    }

    localStorage.setItem(ADMIN_KEY, JSON.stringify(data));

    window.location.href = "admin.html";
} catch {
    alertBox.textContent = "Server error";
    alertBox.classList.remove("d-none");
}
});