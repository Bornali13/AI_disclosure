const API_BASE = "https://ai-disclosure.onrender.com";

const registerAlert = document.getElementById("registerAlert");
const registerSuccess = document.getElementById("registerSuccess");

const registerSection = document.getElementById("registerSection");
const verifySection = document.getElementById("verifySection");
const passwordSection = document.getElementById("passwordSection");

const registerForm = document.getElementById("registerForm");
const verifyForm = document.getElementById("verifyForm");
const setPasswordForm = document.getElementById("setPasswordForm");

const fullNameInput = document.getElementById("fullName");
const studentEmailInput = document.getElementById("studentEmail");
const studentIdInput = document.getElementById("studentId");

const verifyEmailInput = document.getElementById("verifyEmail");
const otpCodeInput = document.getElementById("otpCode");

const passwordEmailInput = document.getElementById("passwordEmail");
const newPasswordInput = document.getElementById("newPassword");
const confirmPasswordInput = document.getElementById("confirmPassword");

const registerBtn = document.getElementById("registerBtn");
const verifyBtn = document.getElementById("verifyBtn");
const setPasswordBtn = document.getElementById("setPasswordBtn");

function hideMessages() {
  registerAlert.classList.add("d-none");
  registerSuccess.classList.add("d-none");
  registerAlert.textContent = "";
  registerSuccess.textContent = "";
}

function showError(message) {
  registerSuccess.classList.add("d-none");
  registerSuccess.textContent = "";
  registerAlert.textContent = message;
  registerAlert.classList.remove("d-none");
}

function showSuccess(message) {
  registerAlert.classList.add("d-none");
  registerAlert.textContent = "";
  registerSuccess.textContent = message;
  registerSuccess.classList.remove("d-none");
}

function setButtonLoading(button, loadingText, isLoading) {
  if (!button) return;

  if (isLoading) {
    button.dataset.originalText = button.textContent;
    button.disabled = true;
    button.textContent = loadingText;
  } else {
    button.disabled = false;
    button.textContent = button.dataset.originalText || button.textContent;
  }
}

function showVerifySection(email) {
  verifyEmailInput.value = email;
  verifySection.classList.remove("d-none");
}

function showPasswordSection(email) {
  passwordEmailInput.value = email;
  passwordSection.classList.remove("d-none");
}

registerForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  hideMessages();

  const full_name = fullNameInput.value.trim();
  const email = studentEmailInput.value.trim();
  const student_id = studentIdInput.value.trim();

  if (!full_name || !email || !student_id) {
    showError("Please fill full name, email address, and student ID.");
    return;
  }

  try {
    setButtonLoading(registerBtn, "Sending...", true);

    const res = await fetch(`${API_BASE}/api/register/student`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ full_name, email, student_id })
    });

    const data = await res.json();

    if (!res.ok) {
      showError(data.detail || "Registration failed");
      return;
    }

    showSuccess(data.message || "Verification code sent successfully.");
    showVerifySection(email);
    passwordSection.classList.add("d-none");
    otpCodeInput.value = "";
  } catch (err) {
    showError("Server error during registration");
  } finally {
    setButtonLoading(registerBtn, "Sending...", false);
  }
});

verifyForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  hideMessages();

  const email = verifyEmailInput.value.trim();
  const otp_code = otpCodeInput.value.trim();

  if (!email || !otp_code) {
    showError("Please enter the verification code.");
    return;
  }

  try {
    setButtonLoading(verifyBtn, "Verifying...", true);

    const res = await fetch(`${API_BASE}/api/register/verify-otp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, otp_code })
    });

    const data = await res.json();

    if (!res.ok) {
      showError(data.detail || "Verification failed");
      return;
    }

    showSuccess(data.message || "Verification successful.");
    showPasswordSection(email);
    newPasswordInput.value = "";
    confirmPasswordInput.value = "";
  } catch (err) {
    showError("Server error during verification");
  } finally {
    setButtonLoading(verifyBtn, "Verifying...", false);
  }
});

setPasswordForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  hideMessages();

  const email = passwordEmailInput.value.trim();
  const password = newPasswordInput.value.trim();
  const confirm_password = confirmPasswordInput.value.trim();

  if (!email || !password || !confirm_password) {
    showError("Please fill all password fields.");
    return;
  }

  if (password.length < 6) {
    showError("Password must be at least 6 characters.");
    return;
  }

  if (password !== confirm_password) {
    showError("Passwords do not match");
    return;
  }

  try {
    setButtonLoading(setPasswordBtn, "Saving...", true);

    const res = await fetch(`${API_BASE}/api/register/set-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, confirm_password })
    });

    const data = await res.json();

    if (!res.ok) {
      showError(data.detail || "Password setup failed");
      return;
    }

    showSuccess(data.message || "Password set successfully.");

    setTimeout(() => {
      window.location.href = "index.html";
    }, 1200);
  } catch (err) {
    showError("Server error while setting password");
  } finally {
    setButtonLoading(setPasswordBtn, "Saving...", false);
  }
});