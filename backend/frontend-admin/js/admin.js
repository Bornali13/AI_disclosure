const API_BASE = "https://ai-disclosure.onrender.com";
const ADMIN_KEY = "aidisclosure_admin_auth";

let auth = null;
try {
  auth = JSON.parse(localStorage.getItem(ADMIN_KEY) || "null");
} catch {
  auth = null;
}

if (!auth || !auth.access_token) {
  window.location.href = "admin-login.html";
}

const headers = {
  Authorization: `Bearer ${auth.access_token}`,
};

const alertBox = document.getElementById("alertBox");
const successBox = document.getElementById("successBox");

function clearMessages() {
  if (alertBox) {
    alertBox.classList.add("d-none");
    alertBox.textContent = "";
  }
  if (successBox) {
    successBox.classList.add("d-none");
    successBox.textContent = "";
  }
}

function showError(message) {
  if (successBox) {
    successBox.classList.add("d-none");
    successBox.textContent = "";
  }
  if (alertBox) {
    alertBox.textContent = message;
    alertBox.classList.remove("d-none");
  }
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function showSuccess(message) {
  if (alertBox) {
    alertBox.classList.add("d-none");
    alertBox.textContent = "";
  }
  if (successBox) {
    successBox.textContent = message;
    successBox.classList.remove("d-none");
  }
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function parseResponse(res) {
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return await res.json();
  }
  return { detail: await res.text() };
}

async function apiJson(url, method, payload) {
  const res = await fetch(url, {
    method,
    headers: {
      ...headers,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = await parseResponse(res);

  if (!res.ok) {
    throw new Error(data.detail || data.message || "Request failed");
  }

  return data;
}

function setButtonLoading(button, loadingText) {
  if (!button) return;
  button.dataset.originalText = button.innerHTML;
  button.disabled = true;
  button.innerHTML = loadingText;
}

function resetButton(button) {
  if (!button) return;
  button.disabled = false;
  if (button.dataset.originalText) {
    button.innerHTML = button.dataset.originalText;
  }
}

function setSelectOptions(selectEl, items, placeholder, valueKey, textBuilder) {
  if (!selectEl) return;

  selectEl.innerHTML = `<option value="">${placeholder}</option>`;

  items.forEach((item) => {
    const option = document.createElement("option");
    option.value = item[valueKey];
    option.textContent = textBuilder(item);
    selectEl.appendChild(option);
  });
}

async function loadTeachers() {
  const teacherSelect = document.getElementById("assignTeacherEmail");
  if (!teacherSelect) return;

  try {
    const res = await fetch(`${API_BASE}/api/admin/teachers`, {
      headers: { ...headers },
    });

    const data = await parseResponse(res);
    if (!res.ok) {
      throw new Error(data.detail || "Failed to load teachers");
    }

    const teachers = Array.isArray(data) ? data : data.teachers || [];

    setSelectOptions(
      teacherSelect,
      teachers,
      "Select Teacher",
      "email",
      (item) => `${item.teacher_name} (${item.email})`
    );
  } catch (err) {
    console.error("Failed to load teachers:", err);
  }
}

async function loadCourses() {
  const courseSelects = [
    document.getElementById("assignCourseCode"),
    document.getElementById("assignSemesterCourseCode"),
    document.getElementById("assignmentCourseCode"),
  ].filter(Boolean);

  if (!courseSelects.length) return;

  try {
    const res = await fetch(`${API_BASE}/api/admin/courses`, {
      headers: { ...headers },
    });

    const data = await parseResponse(res);
    if (!res.ok) {
      throw new Error(data.detail || "Failed to load courses");
    }

    const courses = Array.isArray(data) ? data : data.courses || [];

    courseSelects.forEach((selectEl) => {
      const placeholder =
        selectEl.id === "assignmentCourseCode"
          ? "Select Course"
          : "Select Course";

      setSelectOptions(
        selectEl,
        courses,
        placeholder,
        "course_code",
        (item) => `${item.course_code} - ${item.course_name}`
      );
    });
  } catch (err) {
    console.error("Failed to load courses:", err);
  }
}

async function loadSemesters() {
  const semesterSelect = document.getElementById("assignSemesterName");
  if (!semesterSelect) return;

  try {
    const res = await fetch(`${API_BASE}/api/admin/semesters`, {
      headers: { ...headers },
    });

    const data = await parseResponse(res);
    if (!res.ok) {
      throw new Error(data.detail || "Failed to load semesters");
    }

    const semesters = Array.isArray(data) ? data : data.semesters || [];

    setSelectOptions(
      semesterSelect,
      semesters,
      "Select Semester",
      "semester_name",
      (item) => item.semester_name
    );
  } catch (err) {
    console.error("Failed to load semesters:", err);
  }
}

// Add teacher
document.getElementById("teacherForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearMessages();

  const form = e.currentTarget;
  const submitBtn = form.querySelector("button[type='submit']");

  const teacher_name = document.getElementById("tName")?.value.trim();
  const email = document.getElementById("tEmail")?.value.trim();

  if (!teacher_name || !email) {
    showError("Please complete all teacher fields.");
    return;
  }

  try {
    setButtonLoading(submitBtn, "Adding Teacher...");

    const data = await apiJson(`${API_BASE}/api/admin/create-teacher`, "POST", {
      teacher_name,
      email,
    });

    showSuccess(data.message || "Teacher added successfully.");
    form.reset();
    await loadTeachers();
  } catch (err) {
    showError(err.message || "Failed to add teacher.");
  } finally {
    resetButton(submitBtn);
  }
});

// Add student
document.getElementById("studentForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearMessages();

  const form = e.currentTarget;
  const submitBtn = form.querySelector("button[type='submit']");

  const student_name = document.getElementById("sName")?.value.trim();
  const email = document.getElementById("sEmail")?.value.trim();
  const student_id = document.getElementById("sId")?.value.trim();

  if (!student_name || !email || !student_id) {
    showError("Please complete all student fields.");
    return;
  }

  try {
    setButtonLoading(submitBtn, "Adding Student...");

    const data = await apiJson(`${API_BASE}/api/admin/create-student`, "POST", {
      student_name,
      email,
      student_id,
    });

    showSuccess(data.message || "Student added successfully.");
    form.reset();
  } catch (err) {
    showError(err.message || "Failed to add student.");
  } finally {
    resetButton(submitBtn);
  }
});

// Add semester
document.getElementById("semesterForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearMessages();

  const form = e.currentTarget;
  const submitBtn = form.querySelector("button[type='submit']");
  const semester_name = document.getElementById("semesterName")?.value.trim();

  if (!semester_name) {
    showError("Please enter a semester name.");
    return;
  }

  try {
    setButtonLoading(submitBtn, "Adding Semester...");

    const data = await apiJson(`${API_BASE}/api/admin/create-semester`, "POST", {
      semester_name,
    });

    showSuccess(data.message || "Semester added successfully.");
    form.reset();
    await loadSemesters();
  } catch (err) {
    showError(err.message || "Failed to add semester.");
  } finally {
    resetButton(submitBtn);
  }
});

// Add course
document.getElementById("courseForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearMessages();

  const form = e.currentTarget;
  const submitBtn = form.querySelector("button[type='submit']");
  const course_code = document.getElementById("courseCode")?.value.trim();
  const course_name = document.getElementById("courseName")?.value.trim();

  if (!course_code || !course_name) {
    showError("Please complete both course fields.");
    return;
  }

  try {
    setButtonLoading(submitBtn, "Adding Course...");

    const data = await apiJson(`${API_BASE}/api/admin/create-course`, "POST", {
      course_code,
      course_name,
    });

    showSuccess(data.message || "Course added successfully.");
    form.reset();
    await loadCourses();
  } catch (err) {
    showError(err.message || "Failed to add course.");
  } finally {
    resetButton(submitBtn);
  }
});

// Assign course to semester
document.getElementById("assignSemesterCourseForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearMessages();

  const form = e.currentTarget;
  const submitBtn = form.querySelector("button[type='submit']");
  const semester_name = document.getElementById("assignSemesterName")?.value.trim();
  const course_code = document.getElementById("assignSemesterCourseCode")?.value.trim();

  if (!semester_name || !course_code) {
    showError("Please select both semester and course.");
    return;
  }

  try {
    setButtonLoading(submitBtn, "Assigning Course...");

    const data = await apiJson(`${API_BASE}/api/admin/assign-semester-course`, "POST", {
      semester_name,
      course_code,
    });

    showSuccess(data.message || "Course assigned to semester successfully.");
    form.reset();
  } catch (err) {
    showError(err.message || "Failed to assign course to semester.");
  } finally {
    resetButton(submitBtn);
  }
});

// Add assignment
document.getElementById("assignmentForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearMessages();

  const form = e.currentTarget;
  const submitBtn = form.querySelector("button[type='submit']");
  const course_code = document.getElementById("assignmentCourseCode")?.value.trim();
  const assignment_number = document.getElementById("assignmentNumber")?.value.trim();
  const assignment_title = document.getElementById("assignmentTitle")?.value.trim();

  if (!course_code || !assignment_number || !assignment_title) {
    showError("Please complete all assignment fields.");
    return;
  }

  try {
    setButtonLoading(submitBtn, "Adding Assignment...");

    const data = await apiJson(`${API_BASE}/api/admin/create-assignment`, "POST", {
      course_code,
      assignment_number,
      assignment_title,
    });

    showSuccess(data.message || "Assignment added successfully.");
    form.reset();
  } catch (err) {
    showError(err.message || "Failed to add assignment.");
  } finally {
    resetButton(submitBtn);
  }
});

// Assign teacher to course
document.getElementById("assignTeacherForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearMessages();

  const form = e.currentTarget;
  const submitBtn = form.querySelector("button[type='submit']");
  const teacher_email = document.getElementById("assignTeacherEmail")?.value.trim();
  const course_code = document.getElementById("assignCourseCode")?.value.trim();

  if (!teacher_email || !course_code) {
    showError("Please select both teacher and course.");
    return;
  }

  try {
    setButtonLoading(submitBtn, "Assigning Teacher...");

    const data = await apiJson(`${API_BASE}/api/admin/assign-teacher-course`, "POST", {
      teacher_email,
      course_code,
    });

    showSuccess(data.message || "Teacher assigned successfully.");
    form.reset();
    await loadTeachers();
    await loadCourses();
  } catch (err) {
    showError(err.message || "Failed to assign teacher.");
  } finally {
    resetButton(submitBtn);
  }
});

// Send password reset email
document.getElementById("adminResetPasswordForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearMessages();

  const form = e.currentTarget;
  const submitBtn = form.querySelector("button[type='submit']");
  const role = document.getElementById("resetUserRole")?.value.trim();
  const email = document.getElementById("resetUserEmail")?.value.trim();

  if (!role || !email) {
    showError("Please select role and enter email.");
    return;
  }

  try {
    setButtonLoading(submitBtn, "Sending Reset Email...");

    const data = await apiJson(`${API_BASE}/api/admin/send-reset-email`, "POST", {
      role,
      email,
    });

    showSuccess(data.message || "Password reset email sent successfully.");
    form.reset();
  } catch (err) {
    showError(err.message || "Failed to send password reset email.");
  } finally {
    resetButton(submitBtn);
  }
});

// Logout
document.getElementById("logoutBtn")?.addEventListener("click", () => {
  localStorage.removeItem(ADMIN_KEY);
  window.location.href = "admin-login.html";
});

// Initial load
document.addEventListener("DOMContentLoaded", async () => {
  try {
    await Promise.all([
      loadTeachers(),
      loadCourses(),
      loadSemesters(),
    ]);
  } catch (err) {
    console.error("Initial admin data load failed:", err);
  }
});