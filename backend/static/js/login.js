const AUTH_KEY = "aidisclosure_auth_v1";
const API_BASE = "http://127.0.0.1:8000";

function saveAuth(auth) {
  localStorage.setItem(AUTH_KEY, JSON.stringify(auth));
}

document.getElementById("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();

  const form = e.currentTarget;
  const alertBox = document.getElementById("loginAlert");
  const loginBtn = document.getElementById("loginBtn");

  alertBox.classList.add("d-none");
  alertBox.textContent = "";

  if (!form.checkValidity()) {
    e.stopPropagation();
    form.classList.add("was-validated");
    return;
  }

  const email = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value.trim();
  const role = document.getElementById("loginRole").value;

  loginBtn.disabled = true;
  loginBtn.innerHTML = "Signing in...";

  try {
    const res = await fetch(`${API_BASE}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, role })
    });

    const data = await res.json();

    if (!res.ok) {
      alertBox.textContent = data.detail || "Login failed";
      alertBox.classList.remove("d-none");
      loginBtn.disabled = false;
      loginBtn.innerHTML = '<i class="bi bi-box-arrow-in-right me-1"></i> Sign in';
      return;
    }

    saveAuth({
      access_token: data.access_token,
      user: data.user
    });

    if (data.must_change_password) {
      window.location.href = "change-password.html";
      return;
    }

    if (data.user.role === "teacher") {
      window.location.href = "teacher.html";
    } else {
      window.location.href = "student.html";
    }

  } catch (err) {
    alertBox.textContent = "Server error. Please try again.";
    alertBox.classList.remove("d-none");
    loginBtn.disabled = false;
    loginBtn.innerHTML = '<i class="bi bi-box-arrow-in-right me-1"></i> Sign in';
  }
});