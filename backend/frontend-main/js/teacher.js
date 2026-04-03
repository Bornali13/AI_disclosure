document.addEventListener("DOMContentLoaded", () => {
  const API_BASE = "https://YOUR-BACKEND-URL.onrender.com";
  const AUTH_KEY = "aidisclosure_auth_v1";

  // -----------------------------
  // Auth
  // -----------------------------
  let auth = null;
  try {
    auth = JSON.parse(localStorage.getItem(AUTH_KEY) || "null");
  } catch {
    auth = null;
  }

  const token = auth?.access_token;
  const teacherEmail = auth?.user?.email || auth?.email || "";

  if (!auth || !token) {
    alert("Please log in first.");
    window.location.href = "index.html";
    return;
  }

  // -----------------------------
  // Elements
  // -----------------------------
  const teacherWhoami = document.getElementById("teacherWhoami");
  const logoutBtn = document.getElementById("logoutBtn");

  const alertBox = document.getElementById("alertBox");
  const successBox = document.getElementById("successBox");

  // Filters
  const semesterSelect = document.getElementById("semesterSelect");
  const courseSelect = document.getElementById("courseSelect");
  const assignmentSelect = document.getElementById("assignmentSelect");
  const studentSearch = document.getElementById("studentSearch");
  const loadSubmissionsBtn = document.getElementById("loadSubmissionsBtn");
  const exportCsvBtn = document.getElementById("exportCsvBtn");

  // Summary
  const summaryCourse = document.getElementById("summaryCourse");
  const summarySubmissionCount = document.getElementById("summarySubmissionCount");
  const summaryAvgAi = document.getElementById("summaryAvgAi");

  // Teacher AI Detection
  const teacherAiText = document.getElementById("teacherAiText");
  const teacherAiFile = document.getElementById("teacherAiFile");
  const teacherAiAnalyzeBtn = document.getElementById("teacherAiAnalyzeBtn");
  const teacherAiClearBtn = document.getElementById("teacherAiClearBtn");
  const teacherAiResult = document.getElementById("teacherAiResult");
  const teacherAiScore = document.getElementById("teacherAiScore");
  const teacherAiLabel = document.getElementById("teacherAiLabel");
  const teacherAiDecision = document.getElementById("teacherAiDecision");

  // Table
  const resultCount = document.getElementById("resultCount");
  const submissionsTableBody = document.querySelector("#submissionsTable tbody");

  // -----------------------------
  // Init
  // -----------------------------
  if (teacherWhoami) {
    teacherWhoami.textContent = teacherEmail ? `Logged in as ${teacherEmail}` : "Teacher";
  }

  resetSummary();
  renderEmptyRow("No submissions loaded yet.");
  loadSemesters();

  // -----------------------------
  // Helpers
  // -----------------------------
  function authHeaders(extra = {}) {
    return {
      Authorization: `Bearer ${token}`,
      ...extra
    };
  }

  function showAlert(message) {
    if (!alertBox) return;
    alertBox.textContent = message;
    alertBox.classList.remove("d-none");
    if (successBox) successBox.classList.add("d-none");
  }

  function showSuccess(message) {
    if (!successBox) return;
    successBox.textContent = message;
    successBox.classList.remove("d-none");
    if (alertBox) alertBox.classList.add("d-none");
  }

  function clearMessages() {
    if (alertBox) alertBox.classList.add("d-none");
    if (successBox) successBox.classList.add("d-none");
  }

  function setOptions(selectEl, items, placeholder, valueKey, labelFn) {
    if (!selectEl) return;
    selectEl.innerHTML = `<option value="">${placeholder}</option>`;

    items.forEach((item) => {
      const option = document.createElement("option");
      option.value = item[valueKey];
      option.textContent = labelFn(item);
      selectEl.appendChild(option);
    });
  }

  function escapeHtml(text) {
    return String(text || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  }

  function formatDateTime(value) {
    if (!value) return "-";
    try {
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return value;
      return date.toLocaleString();
    } catch {
      return value;
    }
  }

  function formatLabel(label) {
    if (!label) return "-";
    const value = String(label).trim().toLowerCase();
    if (value === "ai") return "AI";
    if (value === "human") return "Human";
    if (value === "mixed") return "Mixed";
    return label;
  }

  function decisionBadge(decision) {
    const text = String(decision || "-");
    const lower = text.toLowerCase();

    let cls = "decision-low";
    if (lower.includes("high")) cls = "decision-high";
    else if (lower.includes("moderate")) cls = "decision-moderate";

    return `<span class="decision-badge ${cls}">${escapeHtml(text)}</span>`;
  }

  function buildQuery(params) {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && String(value).trim() !== "") {
        qs.set(key, String(value).trim());
      }
    });
    return qs.toString();
  }

  function downloadBlob(blob, filename) {
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = filename;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();

    setTimeout(() => {
      URL.revokeObjectURL(blobUrl);
      a.remove();
    }, 1000);
  }

  function getSelectedFilters() {
    return {
      semester_name: semesterSelect?.value?.trim() || "",
      course_code: courseSelect?.value?.trim() || "",
      assignment_number: assignmentSelect?.value?.trim() || "",
      student_search: studentSearch?.value?.trim() || ""
    };
  }

  function getSelectedCourseText() {
    return courseSelect?.options?.[courseSelect.selectedIndex]?.textContent || "-";
  }

  function validateLoadFilters() {
    const { semester_name, course_code, assignment_number } = getSelectedFilters();

    if (!semester_name) {
      showAlert("Please select a semester.");
      return false;
    }
    if (!course_code) {
      showAlert("Please select a course.");
      return false;
    }
    if (!assignment_number) {
      showAlert("Please select an assignment.");
      return false;
    }
    return true;
  }

  function resetSummary() {
    if (summaryCourse) summaryCourse.textContent = "-";
    if (summarySubmissionCount) summarySubmissionCount.textContent = "0";
    if (summaryAvgAi) summaryAvgAi.textContent = "0%";
  }

  function updateTeacherSummary(rows) {
    if (summaryCourse) summaryCourse.textContent = getSelectedCourseText();

    if (summarySubmissionCount) {
      summarySubmissionCount.textContent = String(rows.length);
    }

    const validScores = rows
      .map((row) => Number(row.confidence))
      .filter((v) => !Number.isNaN(v));

    const avg = validScores.length
      ? (validScores.reduce((sum, v) => sum + v, 0) / validScores.length) * 100
      : 0;

    if (summaryAvgAi) {
      summaryAvgAi.textContent = `${avg.toFixed(2)}%`;
    }
  }

  function renderEmptyRow(message = "No submissions found.") {
    if (!submissionsTableBody) return;
    submissionsTableBody.innerHTML = `
      <tr>
        <td colspan="16" class="text-center text-muted py-4">${escapeHtml(message)}</td>
      </tr>
    `;
    if (resultCount) resultCount.textContent = "0 records";
  }

  function splitExplanation(text) {
    const value = String(text || "").trim();
    
    if (!value) {
      return { short: "-", full: "-", hasMore: false };
    }
  // Try sentence split
    const sentences = value.match(/[^.!?]+[.!?]?/g) || [];

  // If multiple sentences → use first sentence
    if (sentences.length > 1) {
      return {
        short: sentences[0].trim(),
        full: value,
        hasMore: true
      };
    }

    if (value.length > 120) {
      return {
        short: value.slice(0, 120) + "...",
        full: value,
        hasMore: true
      };
    }
    
    return {
      short: value,
      full: value,
      hasMore: false
    };
  }

  function toggleExplanation(id) {
    const shortEl = document.getElementById(`exp-short-${id}`);
    const fullEl = document.getElementById(`exp-full-${id}`);
    const btn = document.querySelector(`.btn-see-more[data-id="${id}"]`);

    if (!shortEl || !fullEl || !btn) return;

    if (fullEl.classList.contains("d-none")) {
      fullEl.classList.remove("d-none");
      shortEl.classList.add("d-none");
      btn.textContent = "See less";
    } else {
      fullEl.classList.add("d-none");
      shortEl.classList.remove("d-none");
      btn.textContent = "See more";
    }
  }

  // -----------------------------
  // API loaders
  // -----------------------------
  async function loadSemesters() {
    try {
      clearMessages();

      const res = await fetch(`${API_BASE}/api/semesters`, {
        headers: authHeaders()
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data?.detail || "Failed to load semesters");

      const semesters = Array.isArray(data) ? data : data.semesters || [];

      setOptions(
        semesterSelect,
        semesters,
        "Select Semester",
        "semester_name",
        (s) => s.semester_name
      );
    } catch (err) {
      console.error(err);
      showAlert(err.message || "Failed to load semesters.");
    }
  }

  async function loadTeacherCoursesForSemester(semesterName) {
    if (!courseSelect) return;

    courseSelect.innerHTML = `<option value="">Loading courses...</option>`;

    try {
      const qs = buildQuery({ semester_name: semesterName });
      const res = await fetch(`${API_BASE}/api/teacher/courses?${qs}`, {
        headers: authHeaders()
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data?.detail || "Failed to load courses");

      const courses = Array.isArray(data) ? data : data.courses || [];

      setOptions(
        courseSelect,
        courses,
        "Select Course",
        "course_code",
        (c) => `${c.course_code} - ${c.course_name}`
      );
    } catch (err) {
      console.error(err);
      courseSelect.innerHTML = `<option value="">Error loading courses</option>`;
      showAlert(err.message || "Failed to load courses.");
    }
  }

  async function loadAssignmentsForCourse(courseCodeValue) {
    if (!assignmentSelect) return;

    assignmentSelect.innerHTML = `<option value="">Loading assignments...</option>`;

    try {
      const qs = buildQuery({ course_code: courseCodeValue });
      const res = await fetch(`${API_BASE}/api/teacher/assignments?${qs}`, {
        headers: authHeaders()
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data?.detail || "Failed to load assignments");

      const assignments = Array.isArray(data) ? data : data.assignments || [];

      setOptions(
        assignmentSelect,
        assignments,
        "Select Assignment",
        "assignment_number",
        (a) => `${a.assignment_number} - ${a.assignment_title || ""}`
      );
    } catch (err) {
      console.error(err);
      assignmentSelect.innerHTML = `<option value="">Error loading assignments</option>`;
      showAlert(err.message || "Failed to load assignments.");
    }
  }

  async function fetchSubmissions() {
    const qs = buildQuery(getSelectedFilters());

    const res = await fetch(`${API_BASE}/api/teacher/submissions?${qs}`, {
      headers: authHeaders()
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data?.detail || "Failed to load submissions");

    return Array.isArray(data) ? data : data.submissions || [];
  }

  async function exportCsv(semesterName, courseCode, assignmentNumber, studentSearchValue = "") {
    if (!semesterName || !courseCode || !assignmentNumber) {
      throw new Error("Semester, course code, and assignment number are required.");
    }

    const url =
      `${API_BASE}/api/teacher/export-csv` +
      `?semester_name=${encodeURIComponent(semesterName)}` +
      `&course_code=${encodeURIComponent(courseCode)}` +
      `&assignment_number=${encodeURIComponent(assignmentNumber)}` +
      `&student_search=${encodeURIComponent(studentSearchValue || "")}`;

    const res = await fetch(url, {
      method: "GET",
      headers: authHeaders()
    });

    if (!res.ok) {
      let message = "CSV export failed";
      try {
        const err = await res.json();
        if (err?.detail) {
          message = typeof err.detail === "string" ? err.detail : JSON.stringify(err.detail);
        }
      } catch {
        const text = await res.text().catch(() => "");
        if (text) message = text;
      }
      throw new Error(message);
    }

    const blob = await res.blob();

    if (!blob || blob.size === 0) {
      throw new Error("CSV file was empty or not generated.");
    }

    const disposition = res.headers.get("Content-Disposition") || "";
    let filename = `${courseCode}_${assignmentNumber}_ai_results.csv`;

    const match = disposition.match(/filename="?([^"]+)"?/i);
    if (match && match[1]) {
      filename = match[1];
    }

    downloadBlob(blob, filename);
  }

  async function downloadOriginalFile(submissionId) {
    try {
      const res = await fetch(
        `${API_BASE}/api/teacher/submissions/${submissionId}/download-file`,
        { headers: authHeaders() }
      );

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "Original DOCX download failed");
      }

      const blob = await res.blob();

      const disposition = res.headers.get("Content-Disposition") || "";
      let filename = `submission_${submissionId}.docx`;

      const match = disposition.match(/filename="?([^"]+)"?/i);
      if (match && match[1]) {
        filename = match[1];
      }

      downloadBlob(blob, filename);
    } catch (err) {
      console.error(err);
      showAlert(err.message || "Original DOCX download failed.");
    }
  }

  async function downloadAiReport(submissionId) {
    try {
      const res = await fetch(
        `${API_BASE}/api/teacher/submissions/${submissionId}/download-report`,
        { headers: authHeaders() }
      );

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "AI report download failed");
      }

      const blob = await res.blob();

      const disposition = res.headers.get("Content-Disposition") || "";
      let filename = `AI_Report_${submissionId}.pdf`;

      const match = disposition.match(/filename="?([^"]+)"?/i);
      if (match && match[1]) {
        filename = match[1];
      }

      downloadBlob(blob, filename);
    } catch (err) {
      console.error(err);
      showAlert(err.message || "AI report download failed.");
    }
  }

  async function allowResubmission(submissionId) {
    const confirmed = window.confirm(
      "Allow this student to resubmit the selected assignment?"
    );
    if (!confirmed) return;

    try {
      clearMessages();

      const res = await fetch(
        `${API_BASE}/api/teacher/submissions/${submissionId}/allow-resubmission`,
        {
          method: "POST",
          headers: authHeaders()
        }
      );

      const data = await res.json();
      if (!res.ok) throw new Error(data?.detail || "Failed to allow resubmission");

      showSuccess(data?.message || "Resubmission allowed successfully.");
      await handleLoadSubmissions();
    } catch (err) {
      console.error(err);
      showAlert(err.message || "Failed to allow resubmission.");
    }
  }

  async function analyzeTeacherText(text) {
    const res = await fetch(`${API_BASE}/analyze`, {
      method: "POST",
      headers: authHeaders({
        "Content-Type": "application/json"
      }),
      body: JSON.stringify({ text })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data?.detail || "AI detection failed");

    return data;
  }

  // -----------------------------
  // Render table
  // -----------------------------
  function renderSubmissions(rows) {
    if (!submissionsTableBody) return;

    if (!rows.length) {
      renderEmptyRow("No matching submissions found.");
      resetSummary();
      return;
    }

    submissionsTableBody.innerHTML = rows
      .map((row) => {
        const confidencePct =
          row.confidence !== null && row.confidence !== undefined
            ? `${(Number(row.confidence) * 100).toFixed(2)}%`
            : "-";

        const explanation = splitExplanation(row.explanation || "-");
        const declarationYes = Number(row.used_ai) === 1;
        const declarationReason = String(row.evidence_text || "").trim();

        const declarationHtml = declarationYes
          ? `<div><strong>Yes</strong></div>
             <div class="small text-muted">${escapeHtml(declarationReason || "Reason not provided")}</div>`
          : `<div><strong>No</strong></div>`;

        const draftAvailable =
          !!row.draft_text || !!row.draft_file_name || !!row.has_draft || false;

        return `
          <tr>
            <td class="text-center align-middle">${escapeHtml(row.semester_name || "-")}</td>
            <td class="text-center align-middle">${escapeHtml(row.student_name || "-")}</td>
            <td class="text-center align-middle">${escapeHtml(row.student_id || "-")}</td>
            <td class="text-center align-middle">${escapeHtml(row.student_email || "-")}</td>
            <td class="text-center align-middle">${escapeHtml(row.course_code || "-")}</td>
            <td class="text-center align-middle">${escapeHtml(row.assignment_number || "-")}</td>
            <td class="text-center align-middle">${confidencePct}</td>
            <td class="text-center align-middle">${escapeHtml(formatLabel(row.label))}</td>
            <td class="text-center align-middle">${decisionBadge(row.decision || "-")}</td>
            <td class="text-center align-middle">${escapeHtml(formatDateTime(row.submitted_at))}</td>

            <td class="align-middle explanation-cell text-start">
              <div id="exp-short-${row.id}">${escapeHtml(explanation.short)}</div>
              <div id="exp-full-${row.id}" class="d-none">${escapeHtml(explanation.full)}</div>
              ${
                explanation.hasMore
                  ? `<button class="btn btn-sm btn-link p-0 mt-1 btn-see-more" data-id="${row.id}">See more</button>`
                  : ""
                }
            </td>
            <td class="align-middle" style="min-width: 190px;">${declarationHtml}</td>

            <td class="text-center align-middle action-col">
              <button class="btn btn-sm btn-outline-secondary" ${draftAvailable ? "" : "disabled"}>
                Draft
              </button>
            </td>

            <td class="text-center align-middle action-col">
              <button class="btn btn-sm btn-outline-secondary btn-download-report" data-id="${row.id}">
                AI Report
              </button>
            </td>

            <td class="text-center align-middle action-col">
              <button class="btn btn-sm btn-outline-primary btn-download-file" data-id="${row.id}">
                Original DOCX
              </button>
            </td>

            <td class="text-center align-middle action-col">
              <button class="btn btn-sm btn-outline-warning btn-allow-resubmit" data-id="${row.id}">
                Resubmission
              </button>
            </td>
          </tr>
        `;
      })
      .join("");

    if (resultCount) {
      resultCount.textContent = `${rows.length} record${rows.length > 1 ? "s" : ""}`;
    }

    updateTeacherSummary(rows);
  }

  // -----------------------------
  // Main actions
  // -----------------------------
  async function handleLoadSubmissions() {
    try {
      clearMessages();

      if (!validateLoadFilters()) return;

      loadSubmissionsBtn.disabled = true;
      loadSubmissionsBtn.innerHTML = `<span class="spinner-border spinner-border-sm me-2"></span>Loading`;

      const rows = await fetchSubmissions();
      renderSubmissions(rows);

      if (rows.length) {
        showSuccess("Submissions loaded successfully.");
      } else {
        showSuccess("No submissions found for the selected filters.");
      }
    } catch (err) {
      console.error(err);
      showAlert(err.message || "Failed to load submissions.");
      renderEmptyRow("Could not load submissions.");
      resetSummary();
    } finally {
      loadSubmissionsBtn.disabled = false;
      loadSubmissionsBtn.innerHTML = `<i class="bi bi-search me-1"></i>Load Submissions`;
    }
  }

  async function handleExportCsv() {
    try {
      clearMessages();

      if (!validateLoadFilters()) return;

      const { semester_name, course_code, assignment_number, student_search } = getSelectedFilters();
      await exportCsv(semester_name, course_code, assignment_number, student_search);

      showSuccess("CSV exported successfully.");
    } catch (err) {
      console.error(err);
      showAlert(err.message || "Failed to export CSV.");
    }
  }

  async function handleTeacherAiAnalyze() {
    try {
      clearMessages();

      let text = teacherAiText?.value?.trim() || "";

      if (!text && teacherAiFile?.files?.[0]) {
        const file = teacherAiFile.files[0];
        const arrayBuffer = await file.arrayBuffer();

        if (!window.mammoth) {
          throw new Error("DOCX reader is not available.");
        }

        const result = await window.mammoth.extractRawText({ arrayBuffer });
        text = result?.value?.trim() || "";
      }

      if (!text) {
        showAlert("Please paste text or upload a DOCX file.");
        return;
      }

      if (teacherAiAnalyzeBtn) {
        teacherAiAnalyzeBtn.disabled = true;
        teacherAiAnalyzeBtn.innerHTML = `<span class="spinner-border spinner-border-sm me-2"></span>Analyzing`;
      }

      const result = await analyzeTeacherText(text);

      if (teacherAiScore) {
        teacherAiScore.textContent =
          result.confidence != null ? `${(Number(result.confidence) * 100).toFixed(2)}%` : "-";
      }

      if (teacherAiLabel) {
        teacherAiLabel.textContent = formatLabel(result.label);
      }

      if (teacherAiDecision) {
        teacherAiDecision.textContent = result.decision || "-";
      }

      if (teacherAiResult) {
        teacherAiResult.classList.remove("d-none");
      }

      showSuccess("Teacher AI detection completed.");
    } catch (err) {
      console.error(err);
      showAlert(err.message || "AI detection failed.");
    } finally {
      if (teacherAiAnalyzeBtn) {
        teacherAiAnalyzeBtn.disabled = false;
        teacherAiAnalyzeBtn.innerHTML = `<i class="bi bi-activity me-1"></i>Analyze`;
      }
    }
  }

  function handleTeacherAiClear() {
    if (teacherAiText) teacherAiText.value = "";
    if (teacherAiFile) teacherAiFile.value = "";
    if (teacherAiScore) teacherAiScore.textContent = "-";
    if (teacherAiLabel) teacherAiLabel.textContent = "-";
    if (teacherAiDecision) teacherAiDecision.textContent = "-";
    if (teacherAiResult) teacherAiResult.classList.add("d-none");
    clearMessages();
  }

  // -----------------------------
  // Table click handlers
  // -----------------------------
  function handleTableClick(event) {
    const downloadFileBtn = event.target.closest(".btn-download-file");
    const downloadReportBtn = event.target.closest(".btn-download-report");
    const allowResubmitBtn = event.target.closest(".btn-allow-resubmit");
    const seeMoreBtn = event.target.closest(".btn-see-more");

    if (downloadFileBtn) {
      const id = downloadFileBtn.dataset.id;
      downloadOriginalFile(id);
      return;
    }

    if (downloadReportBtn) {
      const id = downloadReportBtn.dataset.id;
      downloadAiReport(id);
      return;
    }

    if (allowResubmitBtn) {
      const id = allowResubmitBtn.dataset.id;
      allowResubmission(id);
      return;
    }

    if (seeMoreBtn) {
      const id = seeMoreBtn.dataset.id;
      toggleExplanation(id);
    }
  }

  // -----------------------------
  // Events
  // -----------------------------
  if (logoutBtn) {
    logoutBtn.addEventListener("click", () => {
      localStorage.removeItem(AUTH_KEY);
      window.location.href = "index.html";
    });
  }

  if (semesterSelect) {
    semesterSelect.addEventListener("change", async () => {
      clearMessages();
      setOptions(courseSelect, [], "Select Course", "course_code", (x) => x);
      setOptions(assignmentSelect, [], "Select Assignment", "assignment_number", (x) => x);
      renderEmptyRow("No submissions loaded yet.");
      resetSummary();

      const semesterName = semesterSelect.value.trim();
      if (!semesterName) return;

      await loadTeacherCoursesForSemester(semesterName);
    });
  }

  if (courseSelect) {
    courseSelect.addEventListener("change", async () => {
      clearMessages();
      setOptions(assignmentSelect, [], "Select Assignment", "assignment_number", (x) => x);
      renderEmptyRow("No submissions loaded yet.");
      resetSummary();

      const courseCodeValue = courseSelect.value.trim();
      if (!courseCodeValue) return;

      await loadAssignmentsForCourse(courseCodeValue);
    });
  }

  if (loadSubmissionsBtn) {
    loadSubmissionsBtn.addEventListener("click", handleLoadSubmissions);
  }

  if (exportCsvBtn) {
    exportCsvBtn.addEventListener("click", handleExportCsv);
  }

  if (studentSearch) {
    studentSearch.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        handleLoadSubmissions();
      }
    });
  }

  if (teacherAiAnalyzeBtn) {
    teacherAiAnalyzeBtn.addEventListener("click", handleTeacherAiAnalyze);
  }

  if (teacherAiClearBtn) {
    teacherAiClearBtn.addEventListener("click", handleTeacherAiClear);
  }

  if (submissionsTableBody) {
    submissionsTableBody.addEventListener("click", handleTableClick);
  }
});