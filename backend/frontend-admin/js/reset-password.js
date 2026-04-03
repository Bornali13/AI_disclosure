const API_BASE = "https://YOUR-BACKEND-URL.onrender.com";

const alertBox = document.getElementById("alertBox");
const successBox = document.getElementById("successBox");

const requestSection = document.getElementById("requestSection");
const verifySection = document.getElementById("verifySection");
const passwordSection = document.getElementById("passwordSection");

const requestOtpForm = document.getElementById("requestOtpForm");
const verifyOtpForm = document.getElementById("verifyOtpForm");
const resetPasswordForm = document.getElementById("resetPasswordForm");

const emailInput = document.getElementById("email");
const verifyEmailInput = document.getElementById("verifyEmail");
const resetEmailInput = document.getElementById("resetEmail");

const otpInput = document.getElementById("otp");
const newPasswordInput = document.getElementById("newPassword");
const confirmPasswordInput = document.getElementById("confirmPassword");

const requestOtpBtn = document.getElementById("requestOtpBtn");
const verifyOtpBtn = document.getElementById("verifyOtpBtn");
const resetPasswordBtn = document.getElementById("resetPasswordBtn");

function hideMessages() {
  alertBox.classList.add("d-none");
  successBox.classList.add("d-none");
  alertBox.textContent = "";
  successBox.textContent = "";
}

function showError(msg) {
  successBox.classList.add("d-none");
  successBox.textContent = "";
  alertBox.textContent = msg;
  alertBox.classList.remove("d-none");
}

function showSuccess(msg) {
  alertBox.classList.add("d-none");
  alertBox.textContent = "";
  successBox.textContent = msg;
  successBox.classList.remove("d-none");
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
  if (verifyEmailInput) verifyEmailInput.value = email;
  if (verifySection) verifySection.classList.remove("d-none");
}

function showPasswordSection(email) {
  if (resetEmailInput) resetEmailInput.value = email;
  if (passwordSection) passwordSection.classList.remove("d-none");
}

// Step 1: Send OTP
requestOtpForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  hideMessages();

  const email = emailInput?.value?.trim();

  if (!email) {
    showError("Please enter your email address.");
    return;
  }

  try {
    setButtonLoading(requestOtpBtn, "Sending...", true);

    const res = await fetch(`${API_BASE}/api/reset/request-otp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email })
    });

    const data = await res.json();

    if (!res.ok) {
      showError(data.detail || "Failed to send OTP.");
      return;
    }

    showSuccess(data.message || "OTP sent successfully.");
    showVerifySection(email);

    if (passwordSection) passwordSection.classList.add("d-none");
    if (otpInput) otpInput.value = "";
  } catch (err) {
    showError("Server error while sending OTP.");
  } finally {
    setButtonLoading(requestOtpBtn, "Sending...", false);
  }
});

// Step 2: Verify OTP
verifyOtpForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  hideMessages();

  const email = verifyEmailInput?.value?.trim() || emailInput?.value?.trim();
  const otp = otpInput?.value?.trim();

  if (!email || !otp) {
    showError("Please enter the OTP.");
    return;
  }

  try {
    setButtonLoading(verifyOtpBtn, "Verifying...", true);

    const res = await fetch(`${API_BASE}/api/reset/verify-otp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, otp })
    });

    const data = await res.json();

    if (!res.ok) {
      showError(data.detail || "OTP verification failed.");
      return;
    }

    showSuccess(data.message || "OTP verified successfully.");
    showPasswordSection(email);

    if (newPasswordInput) newPasswordInput.value = "";
    if (confirmPasswordInput) confirmPasswordInput.value = "";
  } catch (err) {
    showError("Server error during OTP verification.");
  } finally {
    setButtonLoading(verifyOtpBtn, "Verifying...", false);
  }
});

// Step 3: Reset password
resetPasswordForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  hideMessages();

  const email = resetEmailInput?.value?.trim() || emailInput?.value?.trim();
  const new_password = newPasswordInput?.value?.trim();
  const confirm_password = confirmPasswordInput?.value?.trim();

  if (!email || !new_password || !confirm_password) {
    showError("Please fill all password fields.");
    return;
  }

  if (new_password.length < 6) {
    showError("Password must be at least 6 characters.");
    return;
  }

  if (new_password !== confirm_password) {
    showError("Passwords do not match.");
    return;
  }

  try {
    setButtonLoading(resetPasswordBtn, "Saving...", true);

    const res = await fetch(`${API_BASE}/api/reset/change-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, new_password, confirm_password })
    });

    const data = await res.json();

    if (!res.ok) {
      showError(data.detail || "Password reset failed.");
      return;
    }

    showSuccess(data.message || "Password reset successfully.");

    setTimeout(() => {
      window.location.href = "index.html";
    }, 1200);
  } catch (err) {
    showError("Server error while resetting password.");
  } finally {
    setButtonLoading(resetPasswordBtn, "Saving...", false);
  }
});