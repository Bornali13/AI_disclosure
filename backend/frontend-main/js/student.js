const API_BASE = "https://ai-disclosure.onrender.com";
const AUTH_KEY = "aidisclosure_auth_v1";

let auth = null;

try {
  auth = JSON.parse(localStorage.getItem(AUTH_KEY) || "null");
} catch {
  auth = null;
}

const token = auth?.access_token;

document.addEventListener("DOMContentLoaded", () => {
  if (!auth || !token) {
    alert("Please log in first.");
    window.location.href = "index.html";
    return;
  }

  loadStudentProfile();
  loadSemesters();
});

let latestSubmissionId = null;
  // ---------------------------
  // Step 1 elements
  // ---------------------------
  const semesterSelect = document.getElementById("semesterSelect");
  const checkCourseCode = document.getElementById("checkCourseCode");
  const checkAssignmentNumber = document.getElementById("checkAssignmentNumber");
  const checkStatusBtn = document.getElementById("checkStatusBtn");
  const statusMessage = document.getElementById("statusMessage");

  // ---------------------------
  // Step 2 form elements
  // ---------------------------
  const submissionForm = document.getElementById("submissionForm");
  const submissionPortalWrap = document.getElementById("submissionPortalWrap");

  const studentName = document.getElementById("studentName");
  const studentId = document.getElementById("studentId");
  const studentEmail = document.getElementById("studentEmail");

  const selectedSemester = document.getElementById("selectedSemester");
  const selectedCourseText = document.getElementById("selectedCourseText");
  const selectedAssignmentText = document.getElementById("selectedAssignmentText");

  const courseCode = document.getElementById("courseCode");
  const assignmentId = document.getElementById("assignmentId");

  const aiUsedInputs = document.querySelectorAll('input[name="aiUsed"]');
  const aiOptions = document.getElementById("aiOptions");
  const usedRewrite = document.getElementById("usedRewrite");
  const usedResearch = document.getElementById("usedResearch");
  const usedComplete = document.getElementById("usedComplete");
  const evidenceWrap = document.getElementById("evidenceWrap");
  const evidenceText = document.getElementById("evidenceText");

  const draftInput = document.getElementById("draftFile");
  const finalInput = document.getElementById("finalFile");

  const draftPreview = document.getElementById("draftPreview");
  const finalPreview = document.getElementById("finalPreview");
  const draftWordCount = document.getElementById("draftWordCount");
  const finalWordCount = document.getElementById("finalWordCount");

  // ---------------------------
  // Action buttons
  // ---------------------------
  const btnCheck = document.getElementById("btnCheck");
  const btnFinalSubmit = document.getElementById("btnFinalSubmit");

  // ---------------------------
  // Loading elements
  // ---------------------------
  const loadingCard = document.getElementById("loadingCard");
  const loadingTitle = document.getElementById("loadingTitle");
  const loadingMessage = document.getElementById("loadingMessage");
  const loadingStage = document.getElementById("loadingStage");
  const loadingDraftStatus = document.getElementById("loadingDraftStatus");
  const loadingFinalStatus = document.getElementById("loadingFinalStatus");
  const analysisTimer = document.getElementById("analysisTimer");
  const progressBar = document.getElementById("progressBar");

  // ---------------------------
  // Result elements
  // ---------------------------
  const studentResult = document.getElementById("studentResult");
  const aiPctOut = document.getElementById("aiPctOut");
  const classificationOut = document.getElementById("classificationOut");
  const riskLevelOut = document.getElementById("riskLevelOut");
  const aiNoteOut = document.getElementById("aiNoteOut");
  const agentExplanation = document.getElementById("agentExplanation");
  
  const totalWordsAssessedOut = document.getElementById("totalWordsAssessedOut");
  const totalChunksAssessedOut = document.getElementById("totalChunksAssessedOut");
  const analysisTimeOut = document.getElementById("analysisTimeOut");

  // ---------------------------
  // State
  // ---------------------------
  let draftTextCache = "";
  let finalTextCache = "";
  let submissionChecked = false;
  let submissionAllowed = false;
  let locked = false;

  let timerInterval = null;
  let analysisStartTime = null;
  let latestAnalysisDuration = "00:00";

  // ---------------------------
  // Init
  // ---------------------------
  if (submissionPortalWrap) submissionPortalWrap.classList.add("d-none");
  if (studentResult) studentResult.classList.add("d-none");
  hideLoading();

  if (studentEmail && auth?.user?.email) {
    studentEmail.value = auth.user.email;
  } else if (studentEmail && auth?.email) {
    studentEmail.value = auth.email;
  }

  updateDisclosureUI();
  resetResult();

  // ---------------------------
  // Helpers
  // ---------------------------
  function getSelectedAiUsed() {
    const selected = document.querySelector('input[name="aiUsed"]:checked');
    return selected ? selected.value : "no";
  }

  function updateDisclosureUI() {
    const used = getSelectedAiUsed() === "yes";

    if (aiOptions) aiOptions.classList.toggle("d-none", !used);

    const anyOptionSelected =
      !!usedRewrite?.checked || !!usedResearch?.checked || !!usedComplete?.checked;

    if (evidenceWrap) {
      evidenceWrap.classList.toggle("d-none", !(used && anyOptionSelected));
    }

    if (!used) {
      if (usedRewrite) usedRewrite.checked = false;
      if (usedResearch) usedResearch.checked = false;
      if (usedComplete) usedComplete.checked = false;
      if (evidenceText) evidenceText.value = "";
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

  function escapeHtml(text) {
    return String(text || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  }

  function escapeRegExp(text) {
    return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function applyInlineHighlights(sectionText, matches = []) {
    let html = escapeHtml(sectionText || "");
    if (!matches || !matches.length) return html;
    
    const sorted = [...matches]
    .filter(m => m && m.text && String(m.text).trim())
    .sort((a, b) => String(b.text).length - String(a.text).length);

    for (const match of sorted) {
      const safeMatch = escapeHtml(match.text);
      const cls = getConfidenceClass(match.score);
      const regex = new RegExp(escapeRegExp(safeMatch), "g");
      
      html = html.replace(
        regex,
        `<mark class="suspicious-highlight ${cls}">$&</mark>`
      );
    }
    return html;
  }



  function getScorePercent(score) {
  const n = Number(score);
  if (Number.isNaN(n)) return null;

  // if backend sends 0-1
  if (n >= 0 && n <= 1) return n * 100;

  // if backend sends 0-100
  return n;
}

function getConfidenceClass(score) {
  const percent = getScorePercent(score);
  if (percent === null) return "confidence-neutral";
  if (percent >= 75) return "confidence-high";
  if (percent >= 40) return "confidence-medium";
  return "confidence-low";
}

function getConfidenceLabel(score) {
  const percent = getScorePercent(score);
  if (percent === null) return "Unknown";
  if (percent >= 75) return "High confidence";
  if (percent >= 40) return "Moderate confidence";
  return "Low confidence";
}

  function countWords(text) {
    return String(text || "").trim().split(/\s+/).filter(Boolean).length;
  }

  function formatSeconds(totalSeconds) {
    const mins = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
    const secs = String(totalSeconds % 60).padStart(2, "0");
    return `${mins}:${secs}`;
  }

  function startLoading(title = "Analyzing your assignment...") {
    analysisStartTime = Date.now();
    latestAnalysisDuration = "00:00";

    if (loadingCard) loadingCard.classList.remove("d-none");
    if (loadingTitle) loadingTitle.textContent = title;
    if (loadingMessage) {
      loadingMessage.textContent =
        "Please wait while the system extracts text, checks the file, and prepares the result.";
    }
    if (loadingStage) loadingStage.textContent = "Preparing files";
    if (loadingDraftStatus) {
      loadingDraftStatus.textContent = draftInput?.files?.[0] ? "Draft attached" : "No draft";
    }
    if (loadingFinalStatus) {
      loadingFinalStatus.textContent = finalInput?.files?.[0] ? "File ready" : "Waiting";
    }
    if (analysisTimer) analysisTimer.textContent = "00:00";

    if (progressBar) {
      progressBar.style.width = "10%";
      progressBar.setAttribute("aria-valuenow", "10");
    }

    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(() => {
      const elapsedSeconds = Math.floor((Date.now() - analysisStartTime) / 1000);
      latestAnalysisDuration = formatSeconds(elapsedSeconds);
      if (analysisTimer) analysisTimer.textContent = latestAnalysisDuration;
    }, 1000);
  }

  function updateLoading(stage, progress, message) {
    if (loadingStage && stage) loadingStage.textContent = stage;
    if (loadingMessage && message) loadingMessage.textContent = message;
    if (progressBar && typeof progress === "number") {
      const safeProgress = Math.max(0, Math.min(100, progress));
      progressBar.style.width = `${safeProgress}%`;
      progressBar.setAttribute("aria-valuenow", String(safeProgress));
    }
  }

  function hideLoading() {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
    if (loadingCard) loadingCard.classList.add("d-none");
  }

  function prettyLabel(label) {
    if (!label) return "Unknown";
    const text = String(label).toLowerCase();

    if (text.includes("high")) return "High AI likelihood";
    if (text.includes("moderate")) return "Moderate AI likelihood";
    if (text.includes("low")) return "Low AI likelihood";
    if (text === "ai") return "AI-generated";
    if (text === "human") return "Human-written";
    if (text === "mixed") return "Mixed (AI + Human)";

    return label;
  }

  function riskFromScore(score) {
    if (typeof score !== "number") return "-";
    if (score >= 0.75) return "High";
    if (score >= 0.4) return "Moderate";
    if (score >= 0.15) return "Low";
    return "Very Low";
  }

  function showStatus(message, type) {
    if (!statusMessage) return;
    statusMessage.textContent = message;
    statusMessage.className = `alert alert-${type} mt-3`;
  }

  function clearStatus() {
    if (!statusMessage) return;
    statusMessage.textContent = "";
    statusMessage.className = "alert d-none mt-3";
  }

  function resetResult() {
    if (studentResult) studentResult.classList.add("d-none");
    if (aiPctOut) aiPctOut.textContent = "-";
    if (classificationOut) classificationOut.textContent = "-";
    if (riskLevelOut) riskLevelOut.textContent = "-";
    if (aiNoteOut) aiNoteOut.textContent = "-";
    if (agentExplanation) agentExplanation.textContent = "-";
    
    if (totalWordsAssessedOut) totalWordsAssessedOut.textContent = "0";
    if (totalChunksAssessedOut) totalChunksAssessedOut.textContent = "0";
    if (analysisTimeOut) analysisTimeOut.textContent = "00:00";
  }

  function normalizeResult(apiData) {
    if (apiData?.receipt) {
      return {
        submission_id: apiData.receipt.submission_id,
        label: apiData.receipt.label,
        confidence: apiData.receipt.confidence,
        decision: apiData.receipt.decision,
        explanation: apiData.receipt.explanation,
        suspicious_sections: apiData.receipt.suspicious_sections || [],
        total_words_assessed: apiData.receipt.total_words_assessed ?? 0,
        total_chunks_assessed: apiData.receipt.total_chunks_assessed ?? 0
      };
    }

    if (apiData?.metrics) {
      return {
        label: apiData.metrics.label,
        confidence: apiData.metrics.confidence,
        decision: apiData.metrics.decision,
        explanation: apiData.metrics.explanation,
        suspicious_sections: apiData.metrics.suspicious_sections || [],
        total_words_assessed: apiData.metrics.total_words_assessed ?? 0,
        total_chunks_assessed: apiData.metrics.total_chunks_assessed ?? 0
      };
    }

    return {
      label: apiData?.label,
      confidence: apiData?.confidence,
      decision: apiData?.decision,
      explanation: apiData?.explanation,
      suspicious_sections: apiData?.suspicious_sections || [],
      total_words_assessed: apiData?.total_words_assessed ?? 0,
      total_chunks_assessed: apiData?.total_chunks_assessed ?? 0
    };
  }

  function showResult(result, mode = "analyze") {
    const confidence =
      typeof result.confidence === "number" ? result.confidence : null;

    if (aiPctOut) {
      const displayText = confidence !== null ? `${(confidence * 100).toFixed(2)}%` : "N/A";
      aiPctOut.textContent = displayText;
      
      aiPctOut.classList.remove("text-danger", "text-warning", "text-success");
      
      if (confidence !== null) {
        if (confidence >= 0.75) {
          aiPctOut.classList.add("text-danger");
        } else if (confidence >= 0.4) {
          aiPctOut.classList.add("text-warning");
        } else {
          aiPctOut.classList.add("text-success");
        }
      }
    }

    if (classificationOut) {
      classificationOut.textContent = prettyLabel(result.label);
    }

    if (riskLevelOut) {
      riskLevelOut.textContent = riskFromScore(result.confidence);
    }

    if (aiNoteOut) {
      aiNoteOut.textContent =
        result.decision ||
        (mode === "submit"
          ? "Final submission stored successfully."
          : "Analysis completed.");
    }

    if (agentExplanation) {
      agentExplanation.textContent =
        result.explanation ||
        (mode === "submit"
          ? "Explanation is not available."
          : "Analysis completed successfully.");
    }

    renderSuspiciousSections(result.suspicious_sections || []);

    if (totalWordsAssessedOut) {
      totalWordsAssessedOut.textContent = String(result.total_words_assessed ?? 0);
    }

    if (totalChunksAssessedOut) {
      totalChunksAssessedOut.textContent = String(result.total_chunks_assessed ?? 0);
    }

    if (analysisTimeOut) {
      analysisTimeOut.textContent = latestAnalysisDuration;
    }

    if (studentResult) {
      studentResult.classList.remove("d-none");
      studentResult.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

function renderSuspiciousSections(sections) {
  const container = document.getElementById("suspiciousSectionsContainer");
  if (!container) return;

  container.innerHTML = "";

  if (!sections || !sections.length) {
    container.innerHTML = `
      <div class="alert alert-success mb-0">
        No suspicious sections found.
      </div>
    `;
    return;
  }

  sections.forEach((section, index) => {
    let item = section;

    if (typeof item === "string") {
      try {
        item = JSON.parse(item);
      } catch {
        item = { section_text: section, matches: [], score: null };
      }
    }

    const sectionText =
      item.section_text ||
      item.preview ||
      item.text ||
      item.content ||
      "";

    if (!sectionText.trim()) return;

    const matches = Array.isArray(item.matches) ? item.matches : [];
    const rawScore = item.score;
    const percent = getScorePercent(rawScore);
    const scoreText = percent !== null ? `${percent.toFixed(2)}%` : "N/A";
    const confidenceClass = getConfidenceClass(rawScore);
    const confidenceLabel = getConfidenceLabel(rawScore);

    const fullHtml = applyInlineHighlights(sectionText, matches);

    const shortLimit = 350;
    const shortTextRaw =
      sectionText.length > shortLimit
        ? sectionText.slice(0, shortLimit) + "..."
        : sectionText;

    const shortHtml = applyInlineHighlights(shortTextRaw, matches);
    const needsToggle = sectionText.length > shortLimit;

    const fullId = `fullText_${index}`;
    const shortId = `shortText_${index}`;
    const btnId = `toggleBtn_${index}`;

    const card = document.createElement("div");
    card.className = "suspicious-card mb-3 shadow-sm";

    card.innerHTML = `
      <div class="card-body">
        <div class="d-flex justify-content-between align-items-start flex-wrap gap-2 mb-2">
          <h6 class="card-title fw-bold mb-0">Section ${index + 1}</h6>
          <span class="confidence-badge ${confidenceClass}">
            ${confidenceLabel}
          </span>
        </div>

        <div id="${shortId}" class="card-text mb-2">${shortHtml}</div>
        <div id="${fullId}" class="card-text mb-2 d-none">${fullHtml}</div>

        ${
          needsToggle
            ? `<button type="button" id="${btnId}" class="btn btn-sm btn-link p-0 mb-2">See more</button>`
            : ""
        }

        <div class="small text-muted">Confidence score: ${scoreText}</div>
      </div>
    `;

    container.appendChild(card);

    if (needsToggle) {
      const btn = document.getElementById(btnId);
      btn.addEventListener("click", () => {
        const shortEl = document.getElementById(shortId);
        const fullEl = document.getElementById(fullId);

        if (fullEl.classList.contains("d-none")) {
          fullEl.classList.remove("d-none");
          shortEl.classList.add("d-none");
          btn.textContent = "See less";
        } else {
          fullEl.classList.add("d-none");
          shortEl.classList.remove("d-none");
          btn.textContent = "See more";
        }
      });
    }
  });
}

  function validateBeforeRun() {
    if (!submissionChecked || !submissionAllowed) {
      alert("Please check submission status first.");
      return false;
    }

    if (!semesterSelect?.value?.trim()) {
      alert("Please select a semester.");
      return false;
    }

    if (!courseCode?.value?.trim() || !assignmentId?.value?.trim()) {
      alert("Course and assignment are not set.");
      return false;
    }

    if (!studentName?.value?.trim()) {
      alert("Student name is required.");
      return false;
    }

    if (!studentId?.value?.trim()) {
      alert("Student ID is required.");
      return false;
    }

    if (!finalInput?.files?.[0]) {
      alert("Please upload the final .docx file.");
      return false;
    }

    if (getSelectedAiUsed() === "yes") {
      const anySelected =
        !!usedRewrite?.checked || !!usedResearch?.checked || !!usedComplete?.checked;

      if (!anySelected) {
        alert("Please select how AI was used.");
        return false;
      }
    }

    return true;
  }

  async function readDocxFileToText(file) {
    if (!file) return "";
    if (!window.mammoth) return "";

    try {
      const arrayBuffer = await file.arrayBuffer();
      const result = await window.mammoth.extractRawText({ arrayBuffer });
      return result?.value?.trim() || "";
    } catch (err) {
      console.error("DOCX read failed:", err);
      return "";
    }
  }

  async function updateFilePreview(file, previewEl, countEl, emptyMessage) {
    if (!previewEl || !countEl) return "";

    if (!file) {
      previewEl.textContent = emptyMessage;
      previewEl.classList.add("text-muted");
      countEl.textContent = "Words: 0";
      return "";
    }

    previewEl.textContent = "Reading file preview...";
    previewEl.classList.add("text-muted");

    const text = await readDocxFileToText(file);
    const words = countWords(text);

    if (text.trim()) {
      previewEl.textContent = text;
      previewEl.classList.remove("text-muted");
    } else {
      previewEl.textContent = "Could not preview the file content.";
      previewEl.classList.add("text-muted");
    }

    countEl.textContent = `Words: ${words}`;
    return text;
  }

  async function ensureExtractedText() {
    if (!finalTextCache && finalInput?.files?.[0]) {
      finalTextCache = await readDocxFileToText(finalInput.files[0]);
    }
  }

  function fillSelectionSummary() {
    if (selectedSemester) {
      selectedSemester.value = semesterSelect?.value || "";
    }

    const selectedCourseOption =
      checkCourseCode?.options?.[checkCourseCode.selectedIndex]?.textContent || "";
    const selectedAssignmentOption =
      checkAssignmentNumber?.options?.[checkAssignmentNumber.selectedIndex]?.textContent || "";

    if (selectedCourseText) selectedCourseText.value = selectedCourseOption;
    if (selectedAssignmentText) selectedAssignmentText.value = selectedAssignmentOption;
  }

  // ---------------------------
  // API loaders
  // ---------------------------
  async function loadSemesters() {
  try {
    const res = await fetch(`${API_BASE}/api/semesters`, {
      headers: {
        "Authorization": `Bearer ${auth.access_token}`
      }
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.detail || "Failed to load semesters");
    }

    semesterSelect.innerHTML = `<option value="">Select Semester</option>`;

    data.forEach((item) => {
      const option = document.createElement("option");
      option.value = item.semester_name;
      option.textContent = item.semester_name;
      semesterSelect.appendChild(option);
    });
  } catch (err) {
    console.error("Failed to load semesters:", err);
    semesterSelect.innerHTML = `<option value="">Failed to load semesters</option>`;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  loadSemesters();
});

  async function loadStudentCourses(semesterName) {
    if (!checkCourseCode) return;

    checkCourseCode.innerHTML = `<option value="">Loading courses...</option>`;
    if (checkAssignmentNumber) {
      checkAssignmentNumber.innerHTML = `<option value="">Select Assignment</option>`;
    }

    try {
      const res = await fetch(
        `${API_BASE}/api/student/courses?semester_name=${encodeURIComponent(semesterName)}`,
        {
          headers: {
            Authorization: `Bearer ${token}`
          }
        }
      );

      const data = await res.json();
      const courses = Array.isArray(data) ? data : data.courses || [];

      setSelectOptions(
        checkCourseCode,
        courses,
        "Select Course",
        "course_code",
        (course) => `${course.course_code} - ${course.course_name}`
      );
    } catch (err) {
      console.error("Failed to load courses", err);
      checkCourseCode.innerHTML = `<option value="">Error loading courses</option>`;
    }
  }

  async function loadAssignments(courseCodeValue) {
    if (!checkAssignmentNumber) return;

    checkAssignmentNumber.innerHTML = `<option value="">Loading assignments...</option>`;

    try {
      const res = await fetch(
        `${API_BASE}/api/student/assignments?course_code=${encodeURIComponent(courseCodeValue)}`,
        {
          headers: {
            Authorization: `Bearer ${token}`
          }
        }
      );

      const data = await res.json();
      const assignments = Array.isArray(data) ? data : data.assignments || [];

      setSelectOptions(
        checkAssignmentNumber,
        assignments,
        "Select Assignment",
        "assignment_number",
        (a) => `${a.assignment_number} - ${a.assignment_title || ""}`
      );
    } catch (err) {
      console.error("Failed to load assignments", err);
      checkAssignmentNumber.innerHTML = `<option value="">Error loading assignments</option>`;
    }
  }

  async function analyzeOnly() {
    const response = await fetch(`${API_BASE}/analyze`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        text: finalTextCache || ""
      })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data?.detail || "Analysis failed");
    }

    return data;
  }

  async function submitAssignment() {
    const formData = new FormData();

    const draftFile = draftInput?.files?.[0];
    const finalFile = finalInput?.files?.[0];

    if (draftFile) {
      formData.append("draft_file", draftFile);
      formData.append("draft_text", draftTextCache || "");
    }

    if (!finalFile) {
      throw new Error("Final file is required");
    }

    formData.append("final_file", finalFile);
    formData.append("semester_name", semesterSelect?.value?.trim() || "");
    formData.append("course_code", checkCourseCode?.value?.trim() || "");
    formData.append("assignment_number", checkAssignmentNumber?.value?.trim() || "");
    formData.append("used_ai", getSelectedAiUsed() === "yes");
    formData.append("used_rewrite", !!usedRewrite?.checked);
    formData.append("used_research", !!usedResearch?.checked);
    formData.append("used_complete", !!usedComplete?.checked);
    formData.append("evidence_text", evidenceText?.value?.trim() || "");
    formData.append("final_text", finalTextCache || "");

    const response = await fetch(`${API_BASE}/api/submit`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`
      },
      body: formData
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data?.detail || "Submission failed");
    }

    return data;
  }

  async function loadStudentProfile() {
    try {
      const res = await fetch(`${API_BASE}/api/student/profile`, {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.detail || "Failed to load profile");
      }

      // Fill inputs
      const nameInput = document.getElementById("studentName");
      const idInput = document.getElementById("studentId");
      const emailInput = document.getElementById("studentEmail");

      if (nameInput) {
        nameInput.value = data.student_name;
        nameInput.readOnly = true;
      }

      if (idInput) {
        idInput.value = data.student_id;
        idInput.readOnly = true;
      }

      if (emailInput) {
        emailInput.value = data.email;
        emailInput.readOnly = true;
      }

      document.getElementById("studentName").value = data.student_name;
      document.getElementById("studentId").value = data.student_id;
      document.getElementById("studentEmail").value = data.email;

    } catch (err) {
      console.error("Failed to load student profile", err);
      alert("Failed to load student profile: " + err.message);}
    }


  // ---------------------------
  // Events - semester/course/assignment
  // ---------------------------
  if (semesterSelect) {
    semesterSelect.addEventListener("change", async () => {
      const semesterName = semesterSelect.value.trim();

      submissionChecked = false;
      submissionAllowed = false;
      clearStatus();
      resetResult();

      if (submissionPortalWrap) submissionPortalWrap.classList.add("d-none");

      if (!semesterName) {
        setSelectOptions(checkCourseCode, [], "Select Course", "course_code", (x) => x);
        setSelectOptions(checkAssignmentNumber, [], "Select Assignment", "assignment_number", (x) => x);
        return;
      }

      await loadStudentCourses(semesterName);
      fillSelectionSummary();
    });
  }

  if (checkCourseCode) {
    checkCourseCode.addEventListener("change", async () => {
      const selectedCourse = checkCourseCode.value.trim();

      submissionChecked = false;
      submissionAllowed = false;
      clearStatus();
      resetResult();

      if (submissionPortalWrap) submissionPortalWrap.classList.add("d-none");

      if (!selectedCourse) {
        setSelectOptions(checkAssignmentNumber, [], "Select Assignment", "assignment_number", (x) => x);
        fillSelectionSummary();
        return;
      }

      await loadAssignments(selectedCourse);
      fillSelectionSummary();
    });
  }

  if (checkAssignmentNumber) {
    checkAssignmentNumber.addEventListener("change", () => {
      submissionChecked = false;
      submissionAllowed = false;
      clearStatus();
      resetResult();

      if (submissionPortalWrap) submissionPortalWrap.classList.add("d-none");
      fillSelectionSummary();
    });
  }

  // ---------------------------
  // Events - disclosure
  // ---------------------------
  aiUsedInputs.forEach((el) => {
    el.addEventListener("change", updateDisclosureUI);
  });

  if (usedRewrite) usedRewrite.addEventListener("change", updateDisclosureUI);
  if (usedResearch) usedResearch.addEventListener("change", updateDisclosureUI);
  if (usedComplete) usedComplete.addEventListener("change", updateDisclosureUI);

  // ---------------------------
  // Events - file preview
  // ---------------------------
  if (draftInput) {
    draftInput.addEventListener("change", async () => {
      draftTextCache = await updateFilePreview(
        draftInput.files?.[0],
        draftPreview,
        draftWordCount,
        "No draft file uploaded yet."
      );
    });
  }

  if (finalInput) {
    finalInput.addEventListener("change", async () => {
      finalTextCache = "";
      finalTextCache = await updateFilePreview(
        finalInput.files?.[0],
        finalPreview,
        finalWordCount,
        "No final file uploaded yet."
      );
    });
  }

  // ---------------------------
  // Submission status check
  // ---------------------------
  if (checkStatusBtn) {
    checkStatusBtn.addEventListener("click", async () => {
      const semester_name = semesterSelect?.value?.trim();
      const course_code = checkCourseCode?.value?.trim();
      const assignment_number = checkAssignmentNumber?.value?.trim();

      clearStatus();
      resetResult();

      submissionChecked = false;
      submissionAllowed = false;

      if (submissionPortalWrap) submissionPortalWrap.classList.add("d-none");

      if (!semester_name || !course_code || !assignment_number) {
        showStatus("Please select semester, course, and assignment.", "danger");
        return;
      }

      try {
        checkStatusBtn.disabled = true;
        checkStatusBtn.textContent = "Checking...";

        const response = await fetch(
          `${API_BASE}/api/student/check-submission?semester_name=${encodeURIComponent(semester_name)}&course_code=${encodeURIComponent(course_code)}&assignment_number=${encodeURIComponent(assignment_number)}`,
          {
            headers: {
              Authorization: `Bearer ${token}`
            }
          }
        );

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data?.detail || "Failed to check submission");
        }

        submissionChecked = true;

        if (data.already_submitted) {
          submissionAllowed = false;
          showStatus(
            "Already submitted. Contact your teacher if resubmission is required.",
            "warning"
          );
          if (submissionForm) submissionForm.classList.add("d-none");
        } else {
          submissionAllowed = true;
          showStatus("You can proceed with submission.", "success");

          if (courseCode) courseCode.value = course_code;
          if (assignmentId) assignmentId.value = assignment_number;
          fillSelectionSummary();

          if (submissionForm) submissionForm.classList.remove("d-none");
          if (submissionPortalWrap) submissionPortalWrap.classList.remove("d-none");
        }
      } catch (err) {
        console.error(err);
        showStatus(err.message || "Server error while checking submission.", "danger");
      } finally {
        checkStatusBtn.disabled = false;
        checkStatusBtn.textContent = "Check Submission Status";
      }
    });
  }

  // ---------------------------
  // Analyze
  // ---------------------------
  if (btnCheck) {
    btnCheck.addEventListener("click", async () => {
      try {
        if (locked) return;
        if (!validateBeforeRun()) return;

        await ensureExtractedText();

        if (!finalTextCache.trim()) {
          alert("Could not extract text from the final file.");
          return;
        }

        btnCheck.disabled = true;
        btnCheck.textContent = "Analyzing...";

        startLoading("Analyzing your assignment...");
        updateLoading("Reading final text", 25, "The system is preparing your document for assessment.");
        await new Promise((resolve) => setTimeout(resolve, 300));

        updateLoading("Running AI assessment", 60, "The file is being checked for AI likelihood and writing patterns.");
        const apiResult = await analyzeOnly();

        updateLoading("Preparing result", 90, "The result is being finalized.");
        await new Promise((resolve) => setTimeout(resolve, 300));

        const result = normalizeResult(apiResult);
        updateLoading("Completed", 100, "Analysis completed successfully.");
        showResult(result, "analyze");
      } catch (err) {
        console.error("Analyze failed:", err);
        alert("Analyze failed: " + err.message);
      } finally {
        hideLoading();
        btnCheck.disabled = false;
        btnCheck.textContent = "Analyze";
      }
    });
  }

  // ---------------------------
  // Final submit
  // ---------------------------
  if (btnFinalSubmit) {
    btnFinalSubmit.addEventListener("click", async () => {
      try {
        if (locked) return;
        if (!validateBeforeRun()) return;

        await ensureExtractedText();

        if (!finalTextCache.trim()) {
          alert("Could not extract text from the final file.");
          return;
        }

        btnFinalSubmit.disabled = true;
        btnFinalSubmit.textContent = "Submitting...";

        startLoading("Submitting your assignment...");
        updateLoading("Checking files", 20, "Validating draft and final file details.");
        await new Promise((resolve) => setTimeout(resolve, 300));

        updateLoading("Saving submission", 55, "Your original Word file and analysis details are being stored.");
        const apiResult = await submitAssignment();

        updateLoading("Finishing", 90, "Submission completed. Preparing confirmation.");
        await new Promise((resolve) => setTimeout(resolve, 300));

        const result = normalizeResult(apiResult);

        // ✅ store submission ID
        latestSubmissionId = result.submission_id || apiResult.submission_id || null;

        showResult(result, "submit");

        // ✅ show download button AFTER submission
        const downloadBtn = document.getElementById("downloadReportBtn");
        if (downloadBtn && latestSubmissionId) {
          downloadBtn.classList.remove("d-none");
        }

        locked = true;
        alert("Final submission stored successfully.");
      } catch (err) {
        console.error("Final submit failed:", err);
        alert("Final submit failed: " + err.message);
      } finally {
        hideLoading();
        btnFinalSubmit.textContent = "Submit";
        btnFinalSubmit.disabled = locked;
      }
    });
  }

  const downloadBtn = document.getElementById("downloadReportBtn");
  if (downloadBtn) {
    downloadBtn.addEventListener("click", async () => {
      try {
        if (!latestSubmissionId) {
          alert("No report available yet.");
          return;
        }
        
        const response = await fetch(
          `${API_BASE}/api/student/submissions/${latestSubmissionId}/receipt-pdf`,
          {
            method: "GET",
            headers: {
              Authorization: `Bearer ${token}`
            }
          }
        );
        
        if (!response.ok) {
          const errorText = await response.text();
          console.error("Download error:", response.status, errorText);
          throw new Error(`Download failed (${response.status})`);
        }

          const blob = await response.blob();
          const url = window.URL.createObjectURL(blob);
          const link = document.createElement("a");
          link.href = url;
          link.download = `AI_Report_${latestSubmissionId}.pdf`;
          document.body.appendChild(link);
          link.click();
          link.remove();

          window.URL.revokeObjectURL(url);
        
        } catch (err) {
          console.error("PDF download failed:", err);
          alert("Failed to download report.");
        }
      });
    }