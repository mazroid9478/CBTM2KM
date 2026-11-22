/**
 * ============================================================================
 * CBT ONLINE MAZRO — Core Application Logic (Vanilla ES6+ JavaScript)
 * ============================================================================
 * Fitur Utama:
 * - Manajemen Identitas Siswa & Sesi Ujian via Local Storage
 * - Mendukung 4 Jenis Soal: Pilihan Ganda (A-E), PG Kompleks (Checkbox),
 *   Isian Singkat (Angka), dan Benar/Salah
 * - Pengacakan Soal (Fisher-Yates), Navigasi Nomor, Flag Ragu-ragu, Auto-save
 * - Timer Hitung Mundur 120 Menit dengan Auto-submit saat waktu habis
 * - Penilaian Otomatis (Skor = Benar / Total * 100, KKM 75)
 * - Halaman Hasil dengan Diagram Batang Canvas, Ringkasan Jawaban, Cetak & PDF
 * - Portal Admin: Rekap Hasil Penilaian, Halaman Hasil Siswa, & CRUD Bank Soal
 * ============================================================================
 */

const STORAGE_KEYS = {
  STUDENT: 'cbt_mazro_student',
  QUESTIONS: 'cbt_mazro_questions',
  SESSION: 'cbt_mazro_session',
  RESULTS: 'cbt_mazro_results',
  USED_IDENTITIES: 'cbt_mazro_used_identities',
  MONITORING: 'cbt_mazro_monitoring',
  TOKEN: 'cbt_mazro_token',
  ADMIN_AUTH: 'cbt_mazro_admin_auth',
  SETTINGS: 'cbt_mazro_settings',
  STUDENT_QUESTIONS: 'cbt_mazro_student_questions',
};

const DEFAULT_SETTINGS = {
  subject: 'INFORMATIKA',
  mainTopic: 'Informatika & Ketrampilan Umum Serta Berpikir Komputasional',
  heroSubtitle: '',
  durationMinutes: 120,
  syllabusItems: [
    'Apa Itu Informatika dan delapan pilar keilmuannya',
    'Keterampilan Generik dalam kolaborasi dan komunikasi digital',
    'Fondasi Berpikir Komputasional: Dekomposisi, Pola, Abstraksi, Algoritma',
    'Algoritma Pencarian (Linear Search & Binary Search)',
    'Algoritma Pengurutan (Bubble, Insertion, dan Selection Sort)',
    'Struktur Data Tumpukan (Stack) dan Antrean (Queue)',
  ],
};

const EXAM_DURATION_MINUTES = 120;
const DEFAULT_STUDENT_QUESTION_COUNT = 50;
const PASSING_GRADE = 75;
const ADMIN_PIN = 'mazro123';

const TOPICS = [
  'Apa Itu Informatika?',
  'Apa itu Ketrampilan Generik?',
  'BERPIKIR KOMPUTASIONAL',
  'Mengenal Berpikir Komputasional',
  'Pencarian (Searching)',
  'Pengurutan (Sorting)',
  'Tumpukan (Stack) dan Antrean (Queue)',
];

const TYPE_LABELS = {
  pg: 'Pilihan Ganda',
  pg_kompleks: 'Pilihan Ganda Kompleks',
  isian: 'Isian Singkat',
  benar_salah: 'Benar atau Salah',
};

/* ==================== APPLICATION STATE ==================== */
const state = {
  questions: [],
  student: null,
  session: null,
  results: [],
  usedIdentities: [],
  monitoring: [],
  activeResult: null,
  lastSubmission: null,
  resultOpenedFromAdmin: false,
  resultFilter: 'all',
  currentView: 'login',
  adminTab: 'results',
  adminUnlocked: false,
  timerIntervalId: null,
  monitoringIntervalId: null,
  confirmCallback: null,
  pendingImportedQuestions: [],
  pendingBankImport: { questions: [], settings: null },
  settings: null,
  tokenConfig: null,
  draftSyllabusItems: [],
  studentQuestionConfig: null,
  draftStudentQuestionConfig: null,
  studentQMenuOpen: true,
  aiGenMenuOpen: true,
  aiGenerating: false,
  aiAbortController: null,
  previousQuestionsBeforeAi: null,
};

/* ==================== STORAGE HELPERS ==================== */
function readStorage(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    console.error('Gagal menyimpan ke Local Storage:', err);
  }
}

function removeStorage(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    // Abaikan jika gagal
  }
}

/* ==================== INITIALIZATION ==================== */
async function initApp() {
  state.student = readStorage(STORAGE_KEYS.STUDENT, null);
  state.session = readStorage(STORAGE_KEYS.SESSION, null);
  state.results = readStorage(STORAGE_KEYS.RESULTS, []);
  state.usedIdentities = readStorage(STORAGE_KEYS.USED_IDENTITIES, []);
  state.monitoring = readStorage(STORAGE_KEYS.MONITORING, []);
  state.adminUnlocked = readStorage(STORAGE_KEYS.ADMIN_AUTH, false) === true;
  loadExamSettings();
  loadTokenConfig();

  await loadQuestionBank();
  loadStudentQuestionConfig();
  syncTopicSelectElements();
  bindEvents();
  updateGlobalMetaCounts();
  renderLoginSyllabus();
  renderLoginTokenField();

  // Restore view logically
  if (state.session && state.student && state.session.studentNisn === state.student.nisn) {
    // Check if expired while away
    if (Date.now() >= state.session.endTime) {
      finishExam(true);
    } else {
      switchView('dashboard');
    }
  } else if (state.student) {
    switchView('dashboard');
  } else {
    switchView('login');
  }
}

async function loadQuestionBank(forceDefault = false) {
  if (!forceDefault) {
    const cached = readStorage(STORAGE_KEYS.QUESTIONS, null);
    const isLegacyDefaultBank65 =
      Array.isArray(cached) &&
      cached.length === 65 &&
      cached[0]?.id === 'Q001' &&
      cached[64]?.id === 'Q065';
    if (Array.isArray(cached) && cached.length > 0 && !isLegacyDefaultBank65) {
      state.questions = cached;
      return;
    }
  }

  try {
    const response = await fetch('/questions.json', { cache: 'no-store' });
    if (!response.ok) throw new Error('Gagal memuat questions.json');
    const data = await response.json();
    if (Array.isArray(data) && data.length > 0) {
      state.questions = data;
      writeStorage(STORAGE_KEYS.QUESTIONS, data);
    }
  } catch (error) {
    console.error('Error memuat bank soal:', error);
    showToast('Gagal memuat bank soal dari questions.json.', 'error');
  }
}

function loadExamSettings() {
  const saved = readStorage(STORAGE_KEYS.SETTINGS, null);
  state.settings = {
    subject: saved?.subject || DEFAULT_SETTINGS.subject,
    mainTopic: saved?.mainTopic || DEFAULT_SETTINGS.mainTopic,
    heroSubtitle: typeof saved?.heroSubtitle === 'string' ? saved.heroSubtitle : DEFAULT_SETTINGS.heroSubtitle,
    durationMinutes: Number(saved?.durationMinutes) > 0 ? Number(saved.durationMinutes) : DEFAULT_SETTINGS.durationMinutes,
    syllabusItems:
      Array.isArray(saved?.syllabusItems) && saved.syllabusItems.length > 0
        ? saved.syllabusItems
        : [...DEFAULT_SETTINGS.syllabusItems],
  };
}

function renderLoginSyllabus() {
  if (!state.settings) loadExamSettings();
  const listEl = document.getElementById('login-syllabus-list');
  if (listEl) {
    listEl.innerHTML = state.settings.syllabusItems
      .map((item) => `<li>${escapeHtml(item)}</li>`)
      .join('');
  }

  const subjectEl = document.getElementById('login-subject-label');
  if (subjectEl) subjectEl.textContent = state.settings.subject;

  const loginHeadingEl = document.getElementById('login-heading');
  if (loginHeadingEl) {
    loginHeadingEl.textContent = `Ujian Online ${state.settings.subject}`;
  }
}

function getDefaultStudentQuestionIds() {
  return state.questions
    .slice(0, Math.min(DEFAULT_STUDENT_QUESTION_COUNT, state.questions.length))
    .map((q) => q.id);
}

function loadStudentQuestionConfig() {
  const saved = readStorage(STORAGE_KEYS.STUDENT_QUESTIONS, null);
  const validIds = new Set(state.questions.map((q) => q.id));
  const defaultIds = getDefaultStudentQuestionIds();
  const isLegacyDefault = !saved || (saved.version !== 2 && !saved.userCustomized);

  if (isLegacyDefault) {
    state.studentQuestionConfig = {
      mode: 'preset50',
      selectedIds: defaultIds,
      orderMode: saved?.orderMode === 'ordered' ? 'ordered' : 'shuffle',
      version: 2,
      userCustomized: false,
      updatedAt: saved?.updatedAt || null,
    };
  } else {
    const mode = saved.mode === 'custom' || saved.mode === 'all' || saved.mode === 'preset50' ? saved.mode : 'preset50';
    let rawSelected = Array.isArray(saved.selectedIds)
      ? saved.selectedIds.filter((id) => validIds.has(id))
      : defaultIds;
    if (mode === 'preset50') {
      rawSelected = defaultIds;
    } else if (mode === 'all') {
      rawSelected = state.questions.map((q) => q.id);
    } else if (rawSelected.length === 0 && defaultIds.length > 0) {
      rawSelected = defaultIds;
    }

    state.studentQuestionConfig = {
      mode,
      selectedIds: rawSelected,
      orderMode: saved.orderMode === 'ordered' ? 'ordered' : 'shuffle',
      version: 2,
      userCustomized: Boolean(saved.userCustomized),
      updatedAt: saved.updatedAt || null,
    };
  }

  state.draftStudentQuestionConfig = {
    mode: state.studentQuestionConfig.mode,
    selectedIds: [...state.studentQuestionConfig.selectedIds],
    orderMode: state.studentQuestionConfig.orderMode,
  };
}

function getActiveStudentQuestions() {
  if (!state.studentQuestionConfig) loadStudentQuestionConfig();
  if (state.studentQuestionConfig.mode === 'all') {
    return [...state.questions];
  }
  if (state.studentQuestionConfig.mode === 'preset50') {
    return state.questions.slice(0, Math.min(DEFAULT_STUDENT_QUESTION_COUNT, state.questions.length));
  }
  const selectedSet = new Set(state.studentQuestionConfig.selectedIds || []);
  return state.questions.filter((q) => selectedSet.has(q.id));
}

function updateGlobalMetaCounts() {
  const total = getActiveStudentQuestions().length;
  const duration = state.settings?.durationMinutes || EXAM_DURATION_MINUTES;
  const loginCountEl = document.getElementById('login-question-count');
  if (loginCountEl) {
    loginCountEl.textContent = `${total} Butir Soal · ${duration} Menit`;
  }
}

function applySettingsToUI() {
  if (!state.settings) loadExamSettings();
  renderLoginSyllabus();
  updateGlobalMetaCounts();

  const dashSubject = document.getElementById('dash-subject');
  const dashTopic = document.getElementById('dash-main-topic');
  const dashDuration = document.getElementById('dash-duration');
  if (dashSubject) dashSubject.textContent = state.settings.subject;
  if (dashTopic) dashTopic.textContent = state.settings.mainTopic;
  if (dashDuration) dashDuration.textContent = `${state.settings.durationMinutes} Menit`;

  if (state.currentView === 'submitted') renderSubmittedView();
  if (state.currentView === 'result') renderResultView();
}

/* ==================== NAVIGATION & VIEW SWITCHING ==================== */
function switchView(viewName) {
  if (viewName === 'admin' && !state.adminUnlocked) {
    openAdminPortal();
    return;
  }
  if (viewName === 'result' && !state.adminUnlocked) {
    viewName = state.student ? 'dashboard' : 'login';
  }

  state.currentView = viewName;

  document.querySelectorAll('.view').forEach((el) => {
    el.classList.remove('active');
  });

  const target = document.getElementById(`view-${viewName}`);
  if (target) {
    target.classList.add('active');
  }

  // Stop timer if leaving exam view (timer timestamp stays accurate in localStorage)
  if (viewName !== 'exam' && state.timerIntervalId) {
    clearInterval(state.timerIntervalId);
    state.timerIntervalId = null;
  }

  // Stop monitoring refresh loop if leaving admin view
  if (viewName !== 'admin' && state.monitoringIntervalId) {
    clearInterval(state.monitoringIntervalId);
    state.monitoringIntervalId = null;
  }

  // Render view-specific data
  if (viewName === 'login') renderLoginTokenField();
  if (viewName === 'dashboard') renderDashboard();
  if (viewName === 'exam') renderExamView();
  if (viewName === 'submitted') renderSubmittedView();
  if (viewName === 'result') renderResultView();
  if (viewName === 'admin') {
    renderAdminView();
    startMonitoringRefreshLoop();
  }

  updateTopbar();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function updateTopbar() {
  const navLogin = document.getElementById('nav-login');
  const navDashboard = document.getElementById('nav-dashboard');
  const navExam = document.getElementById('nav-exam');
  const navAdmin = document.getElementById('nav-admin');
  const topbarBtn = document.getElementById('topbar-primary-btn');

  const hasStudent = Boolean(state.student);
  const hasSession = Boolean(state.session && state.student && state.session.studentNisn === state.student.nisn);

  navLogin.classList.toggle('hidden', hasStudent);
  navDashboard.classList.toggle('hidden', !hasStudent);
  navExam.classList.toggle('hidden', !hasSession);

  [navLogin, navDashboard, navExam, navAdmin].forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.nav === state.currentView);
  });

  if (state.currentView === 'admin' || state.currentView === 'result') {
    topbarBtn.textContent = 'Keluar Admin';
  } else if (hasStudent) {
    topbarBtn.textContent = 'Ganti Akun';
  } else {
    topbarBtn.textContent = 'Portal Admin';
  }
}

/* ==================== EVENT BINDINGS ==================== */
function bindEvents() {
  // Brand Home
  document.getElementById('brand-home-link').addEventListener('click', (e) => {
    e.preventDefault();
    if (state.currentView === 'exam') return;
    if (state.student) {
      switchView('dashboard');
    } else {
      switchView('login');
    }
  });

  // Topbar Nav Links
  document.querySelectorAll('.nav-link').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.nav;
      if (target === 'admin') {
        openAdminPortal();
      } else {
        switchView(target);
      }
    });
  });

  // Topbar Primary Action
  document.getElementById('topbar-primary-btn').addEventListener('click', () => {
    if (state.currentView === 'admin' || state.currentView === 'result') {
      exitAdmin();
    } else if (state.student) {
      logoutStudent();
    } else {
      openAdminPortal();
    }
  });

  // Login Form
  document.getElementById('login-form').addEventListener('submit', handleStudentLogin);
  document.getElementById('btn-open-admin-from-login').addEventListener('click', openAdminPortal);

  // Dashboard Actions
  document.getElementById('btn-logout-student').addEventListener('click', logoutStudent);
  document.getElementById('btn-start-exam').addEventListener('click', handleStartOrResumeExam);
  document.getElementById('btn-reset-session').addEventListener('click', () => {
    const durationMins = state.settings?.durationMinutes || EXAM_DURATION_MINUTES;
    openConfirmModal(
      'Mulai Ulang Sesi Baru?',
      `Progres ujian yang tersimpan sebelumnya akan dihapus dan soal akan diacak ulang dengan waktu ${durationMins} menit penuh.`,
      () => {
        removeStorage(STORAGE_KEYS.SESSION);
        state.session = null;
        startNewExamSession();
      }
    );
  });

  // Exam Controls
  document.getElementById('btn-prev-question').addEventListener('click', () => navigateQuestion(-1));
  document.getElementById('btn-next-question').addEventListener('click', () => navigateQuestion(1));
  document.getElementById('btn-flag-question').addEventListener('click', toggleFlagCurrentQuestion);
  document.getElementById('btn-finish-exam-top').addEventListener('click', promptFinishExam);
  document.getElementById('btn-finish-exam-sidebar').addEventListener('click', promptFinishExam);
  document.getElementById('btn-submit-exam-last').addEventListener('click', promptFinishExam);

  // Submitted Confirmation Controls
  document.getElementById('btn-submitted-dashboard').addEventListener('click', () => {
    switchView('dashboard');
  });
  document.getElementById('btn-submitted-logout').addEventListener('click', logoutStudent);

  // Result Controls (Admin)
  document.getElementById('btn-result-back-admin').addEventListener('click', () => {
    state.resultOpenedFromAdmin = false;
    switchView('admin');
  });
  document.getElementById('btn-print-result').addEventListener('click', () => window.print());
  document.getElementById('btn-download-pdf').addEventListener('click', handleDownloadPdf);
  document.getElementById('btn-retake-test').addEventListener('click', () => {
    const durationMins = state.settings?.durationMinutes || EXAM_DURATION_MINUTES;
    openConfirmModal(
      'Ulangi Tes Sekarang?',
      `Anda akan memulai tes baru dengan urutan soal acak dan timer ${durationMins} menit.`,
      () => {
        if (!state.student && state.activeResult) {
          state.student = {
            nama: state.activeResult.nama,
            username: state.activeResult.username,
            nisn: state.activeResult.nisn,
            absen: state.activeResult.absen || '-',
            loggedInAt: Date.now(),
          };
          writeStorage(STORAGE_KEYS.STUDENT, state.student);
        }
        startNewExamSession();
      }
    );
  });

  document.querySelectorAll('[data-res-filter]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.resultFilter = btn.dataset.resFilter;
      document.querySelectorAll('[data-res-filter]').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      renderResultSummaryList();
    });
  });

  // Admin Tabs & Actions
  document.querySelectorAll('[data-admin-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.adminTab = btn.dataset.adminTab;
      document.querySelectorAll('[data-admin-tab]').forEach((b) => {
        const isActive = b.dataset.adminTab === state.adminTab;
        b.classList.toggle('active', isActive);
        b.setAttribute('aria-selected', String(isActive));
      });
      document.getElementById('admin-panel-results').classList.toggle('active', state.adminTab === 'results');
      document.getElementById('admin-panel-monitoring').classList.toggle('active', state.adminTab === 'monitoring');
      document.getElementById('admin-panel-questions').classList.toggle('active', state.adminTab === 'questions');
      document.getElementById('admin-panel-syllabus').classList.toggle('active', state.adminTab === 'syllabus');
      document.getElementById('admin-panel-token').classList.toggle('active', state.adminTab === 'token');
      if (state.adminTab === 'monitoring') {
        renderAdminMonitoringTable();
      }
      if (state.adminTab === 'questions') {
        renderAiGeneratorPanel();
        renderAdminQuestionList();
      }
      if (state.adminTab === 'syllabus') {
        renderAdminSyllabusPanel();
      }
      if (state.adminTab === 'token') {
        renderAdminTokenPanel();
      }
    });
  });

  document.getElementById('btn-add-syllabus-item').addEventListener('click', handleAddSyllabusItem);
  document.getElementById('admin-new-syllabus-item').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddSyllabusItem();
    }
  });
  document.getElementById('admin-syllabus-form').addEventListener('submit', handleSaveSyllabus);
  document.getElementById('btn-save-syllabus').addEventListener('click', handleSaveSyllabus);
  document.getElementById('btn-cancel-syllabus-edit').addEventListener('click', handleCancelSyllabusEdit);
  ['admin-set-subject', 'admin-set-duration', 'admin-set-main-topic'].forEach((fieldId) => {
    document.getElementById(fieldId).addEventListener('input', updateSyllabusDirtyState);
  });
  document.getElementById('btn-reset-syllabus').addEventListener('click', () => {
    openConfirmModal(
      'Reset Cakupan Materi ke Default?',
      'Mata pelajaran, materi pokok, waktu ujian, dan daftar cakupan materi akan dikembalikan ke pengaturan awal.',
      () => {
        removeStorage(STORAGE_KEYS.SETTINGS);
        loadExamSettings();
        renderAdminSyllabusPanel();
        applySettingsToUI();
        showToast('Cakupan materi berhasil dikembalikan ke default.', 'success');
      }
    );
  });

  document.getElementById('btn-exit-admin').addEventListener('click', exitAdmin);
  document.getElementById('admin-result-search').addEventListener('input', renderAdminResultsTable);
  document.getElementById('btn-export-results-xls').addEventListener('click', exportResultsToExcel);
  document.getElementById('btn-export-results-csv').addEventListener('click', exportResultsToCsv);
  document.getElementById('btn-reset-login-locks').addEventListener('click', () => {
    openConfirmModal(
      'Reset Akses Login Peserta?',
      'Daftar identitas peserta yang sudah pernah login akan dibuka kembali sehingga siswa dapat melakukan login ulang jika diperlukan.',
      () => {
        state.usedIdentities = [];
        writeStorage(STORAGE_KEYS.USED_IDENTITIES, []);
        showToast('Akses login peserta berhasil direset.', 'success');
      }
    );
  });
  document.getElementById('btn-clear-results').addEventListener('click', () => {
    openConfirmModal(
      'Hapus Semua Hasil Penilaian?',
      'Seluruh riwayat nilai siswa, data monitoring pengerjaan, dan kunci akses login peserta yang tersimpan di perangkat ini akan dihapus permanen.',
      () => {
        state.results = [];
        state.usedIdentities = [];
        state.monitoring = [];
        writeStorage(STORAGE_KEYS.RESULTS, []);
        writeStorage(STORAGE_KEYS.USED_IDENTITIES, []);
        writeStorage(STORAGE_KEYS.MONITORING, []);
        renderAdminResultsTable();
        renderAdminMonitoringTable();
        renderAdminTokenPanel();
        showToast('Seluruh hasil penilaian, monitoring, dan akses login telah direset.', 'success');
      }
    );
  });

  // Admin Monitoring Filters & Refresh
  document.getElementById('admin-monitoring-search').addEventListener('input', renderAdminMonitoringTable);
  document.getElementById('admin-monitoring-filter-status').addEventListener('change', renderAdminMonitoringTable);
  document.getElementById('btn-refresh-monitoring').addEventListener('click', () => {
    renderAdminMonitoringTable();
    showToast('Data monitoring siswa diperbarui.', 'success');
  });

  // Admin Bank Soal Filters, Menu Perubahan Soal Siswa & CRUD
  document.getElementById('admin-q-search').addEventListener('input', renderAdminQuestionList);
  document.getElementById('admin-q-filter-type').addEventListener('change', renderAdminQuestionList);
  document.getElementById('admin-q-filter-topic').addEventListener('change', renderAdminQuestionList);
  document.getElementById('admin-q-filter-student-status').addEventListener('change', renderAdminQuestionList);
  document.getElementById('btn-toggle-ai-gen-menu').addEventListener('click', () => {
    state.aiGenMenuOpen = !state.aiGenMenuOpen;
    const panel = document.getElementById('ai-generate-menu-panel');
    if (panel) panel.classList.toggle('hidden', !state.aiGenMenuOpen);
  });
  document.getElementById('btn-ai-goto-syllabus').addEventListener('click', () => {
    const syllabusTabBtn = document.querySelector('[data-admin-tab="syllabus"]');
    if (syllabusTabBtn) syllabusTabBtn.click();
  });
  document.getElementById('ai-gen-target-mode').addEventListener('change', (e) => {
    const customBox = document.getElementById('ai-gen-custom-counts');
    if (customBox) customBox.classList.toggle('hidden', e.target.value !== 'custom');
  });
  document.getElementById('btn-run-ai-generate').addEventListener('click', promptGenerateAiQuestions);
  document.getElementById('btn-cancel-ai-gen').addEventListener('click', cancelAiQuestionGeneration);
  document.getElementById('btn-undo-ai-gen').addEventListener('click', undoAiQuestionGeneration);

  document.getElementById('btn-toggle-student-q-menu').addEventListener('click', () => {
    state.studentQMenuOpen = !state.studentQMenuOpen;
    const panel = document.getElementById('student-q-menu-panel');
    if (panel) panel.classList.toggle('hidden', !state.studentQMenuOpen);
  });
  document.querySelectorAll('input[name="student-q-mode"]').forEach((radio) => {
    radio.addEventListener('change', (e) => {
      if (!state.draftStudentQuestionConfig) loadStudentQuestionConfig();
      const val = e.target.value;
      const mode = val === 'custom' || val === 'all' ? val : 'preset50';
      state.draftStudentQuestionConfig.mode = mode;
      if (mode === 'preset50') {
        state.draftStudentQuestionConfig.selectedIds = getDefaultStudentQuestionIds();
      } else if (mode === 'all') {
        state.draftStudentQuestionConfig.selectedIds = state.questions.map((q) => q.id);
      } else if (state.draftStudentQuestionConfig.selectedIds.length === 0) {
        state.draftStudentQuestionConfig.selectedIds = getDefaultStudentQuestionIds();
      }
      renderStudentQuestionMenu();
      renderAdminQuestionList();
    });
  });
  document.getElementById('student-q-order-mode').addEventListener('change', (e) => {
    if (!state.draftStudentQuestionConfig) loadStudentQuestionConfig();
    state.draftStudentQuestionConfig.orderMode = e.target.value === 'ordered' ? 'ordered' : 'shuffle';
    updateStudentQuestionDirtyState();
  });
  document.getElementById('btn-student-q-random-pick').addEventListener('click', handleRandomPickStudentQuestions);
  document.getElementById('btn-student-q-preset-50').addEventListener('click', () => {
    if (!state.draftStudentQuestionConfig) loadStudentQuestionConfig();
    state.draftStudentQuestionConfig.mode = 'preset50';
    state.draftStudentQuestionConfig.selectedIds = getDefaultStudentQuestionIds();
    renderStudentQuestionMenu();
    renderAdminQuestionList();
  });
  document.getElementById('btn-student-q-select-all').addEventListener('click', () => {
    if (!state.draftStudentQuestionConfig) loadStudentQuestionConfig();
    state.draftStudentQuestionConfig.mode = 'all';
    state.draftStudentQuestionConfig.selectedIds = state.questions.map((q) => q.id);
    renderStudentQuestionMenu();
    renderAdminQuestionList();
  });
  document.getElementById('btn-student-q-select-filtered').addEventListener('click', () => {
    if (!state.draftStudentQuestionConfig) loadStudentQuestionConfig();
    const { list: filtered } = getFilteredAdminQuestions();
    state.draftStudentQuestionConfig.mode = 'custom';
    state.draftStudentQuestionConfig.selectedIds = filtered.map((q) => q.id);
    renderStudentQuestionMenu();
    renderAdminQuestionList();
    showToast(`${filtered.length} soal sesuai filter dipilih dalam draf. Klik Simpan Perubahan untuk menerapkan.`, 'default');
  });
  document.getElementById('btn-student-q-clear-all').addEventListener('click', () => {
    if (!state.draftStudentQuestionConfig) loadStudentQuestionConfig();
    state.draftStudentQuestionConfig.mode = 'custom';
    state.draftStudentQuestionConfig.selectedIds = [];
    renderStudentQuestionMenu();
    renderAdminQuestionList();
  });
  document.getElementById('btn-cancel-student-q').addEventListener('click', handleCancelStudentQuestionsConfig);
  document.getElementById('btn-save-student-q').addEventListener('click', handleSaveStudentQuestionsConfig);

  document.getElementById('btn-add-question').addEventListener('click', () => openQuestionEditorModal(null));
  document.getElementById('btn-shuffle-question-bank').addEventListener('click', promptShuffleQuestionBank);
  document.getElementById('btn-export-questions-pdf').addEventListener('click', exportQuestionBankToPdf);
  document.getElementById('btn-bank-export-import').addEventListener('click', openBankExportImportModal);
  document.getElementById('btn-export-bank-json').addEventListener('click', exportQuestionBankJson);
  document.getElementById('btn-export-bank-csv').addEventListener('click', exportQuestionBankCsv);
  document.getElementById('bank-import-file-input').addEventListener('change', handleBankImportFileSelect);
  document.getElementById('btn-confirm-bank-import').addEventListener('click', handleConfirmBankImport);
  document.getElementById('btn-pg-template').addEventListener('click', openPgTemplateModal);
  document.getElementById('btn-download-pg-csv').addEventListener('click', downloadPgCsvTemplate);
  document.getElementById('btn-download-pg-json').addEventListener('click', downloadPgJsonTemplate);
  document.getElementById('pg-template-file-input').addEventListener('change', handlePgTemplateFileSelect);
  document.getElementById('btn-import-pg-template').addEventListener('click', handleImportPgTemplate);
  document.getElementById('btn-apply-pg-template').addEventListener('click', applyQuickPgTemplate);
  document.getElementById('btn-reset-default-questions').addEventListener('click', () => {
    openConfirmModal(
      'Reset ke Bank Soal Default?',
      'Semua perubahan soal yang dibuat di Admin akan dikembalikan ke bank soal awal (100 soal) dengan paket ujian siswa default 50 soal.',
      async () => {
        await loadQuestionBank(true);
        resetStudentQuestionConfigToDefault();
        updateGlobalMetaCounts();
        renderStudentQuestionMenu();
        renderAdminQuestionList();
        showToast('Bank soal berhasil dikembalikan ke default (50 soal aktif untuk siswa).', 'success');
      }
    );
  });

  // Question Editor Type Change & Submit
  document.getElementById('edit-q-type').addEventListener('change', () => {
    const selectedType = document.getElementById('edit-q-type').value;
    const isNew = !document.getElementById('edit-q-id').value;
    document.getElementById('pg-quick-template-bar').classList.toggle('hidden', !isNew || selectedType !== 'pg');
    renderDynamicQuestionEditor(selectedType, null);
  });
  document.getElementById('question-editor-form').addEventListener('submit', handleSaveQuestion);

  // Admin Auth Form
  document.getElementById('admin-auth-form').addEventListener('submit', handleAdminLoginSubmit);

  // Token Login Input Uppercase Formatting
  document.getElementById('input-token').addEventListener('input', (e) => {
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  });

  // Admin Token Actions
  document.getElementById('btn-reset-token').addEventListener('click', handleResetExamToken);
  document.getElementById('btn-reactivate-token').addEventListener('click', handleReactivateExamToken);
  document.getElementById('btn-copy-token').addEventListener('click', handleCopyExamToken);
  document.getElementById('btn-save-custom-token').addEventListener('click', handleSaveCustomToken);
  document.getElementById('btn-save-token-target').addEventListener('click', handleSaveTokenTargetCount);
  document.getElementById('admin-token-required').addEventListener('change', handleTokenVisibilityOrRequiredChange);
  document.getElementById('admin-token-show-on-login').addEventListener('change', handleTokenVisibilityOrRequiredChange);
  document.getElementById('admin-token-auto-stop').addEventListener('change', handleTokenVisibilityOrRequiredChange);

  // Modal Close Buttons
  document.querySelectorAll('[data-close-modal]').forEach((btn) => {
    btn.addEventListener('click', () => closeModal(btn.dataset.closeModal));
  });

  // Confirm Modal Actions
  document.getElementById('btn-confirm-cancel').addEventListener('click', () => closeModal('modal-confirm'));
  document.getElementById('btn-confirm-ok').addEventListener('click', () => {
    const cb = state.confirmCallback;
    closeModal('modal-confirm');
    if (typeof cb === 'function') cb();
  });

  // Window resize redraw charts if in result view
  window.addEventListener('resize', () => {
    if (state.currentView === 'result' && state.activeResult) {
      drawResultCharts(state.activeResult);
    }
  });

  // Live cross-tab sync for Admin Monitoring, Results & Exam Settings
  window.addEventListener('storage', (e) => {
    if (
      e.key === STORAGE_KEYS.MONITORING ||
      e.key === STORAGE_KEYS.RESULTS ||
      e.key === STORAGE_KEYS.SESSION ||
      e.key === STORAGE_KEYS.USED_IDENTITIES ||
      e.key === STORAGE_KEYS.TOKEN ||
      e.key === STORAGE_KEYS.SETTINGS ||
      e.key === STORAGE_KEYS.QUESTIONS ||
      e.key === STORAGE_KEYS.STUDENT_QUESTIONS
    ) {
      state.results = readStorage(STORAGE_KEYS.RESULTS, []);
      state.usedIdentities = readStorage(STORAGE_KEYS.USED_IDENTITIES, []);
      state.monitoring = readStorage(STORAGE_KEYS.MONITORING, []);
      const cachedQ = readStorage(STORAGE_KEYS.QUESTIONS, null);
      if (Array.isArray(cachedQ) && cachedQ.length > 0) state.questions = cachedQ;
      loadExamSettings();
      loadStudentQuestionConfig();
      applySettingsToUI();
      loadTokenConfig();
      renderLoginTokenField();
      if (state.currentView === 'dashboard') {
        renderDashboard();
      }
      if (state.currentView === 'admin') {
        renderAdminResultsTable();
        renderAdminMonitoringTable();
        syncTopicSelectElements();
        renderAiGeneratorPanel();
        renderStudentQuestionMenu();
        renderAdminQuestionList();
        renderAdminSyllabusPanel();
        renderAdminTokenPanel();
      }
    }
  });
}

/* ==================== LOGIN & DASHBOARD ==================== */
function normalizeIdentityVal(val) {
  return String(val || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function identityMatchesEntry(entry, candidate) {
  if (!entry || !candidate) return false;
  const eUser = normalizeIdentityVal(entry.username);
  const cUser = normalizeIdentityVal(candidate.username);
  const eNama = normalizeIdentityVal(entry.nama);
  const cNama = normalizeIdentityVal(candidate.nama);
  const eKelas = normalizeIdentityVal(entry.nisn);
  const cKelas = normalizeIdentityVal(candidate.nisn);
  const eAbsen = String(entry.absen || '').trim();
  const cAbsen = String(candidate.absen || '').trim();

  if (eUser && cUser && eUser === cUser) return true;
  if (eKelas && cKelas && eAbsen && cAbsen && eKelas === cKelas && eAbsen === cAbsen) return true;
  if (eNama && cNama && eKelas && cKelas && eNama === cNama && eKelas === cKelas) return true;
  return false;
}

function isStudentIdentityUsed(candidate) {
  const usedList = state.usedIdentities || [];
  const resultsList = state.results || [];
  return (
    usedList.some((entry) => identityMatchesEntry(entry, candidate)) ||
    resultsList.some((entry) => identityMatchesEntry(entry, candidate))
  );
}

function hasStudentCompletedExam(student) {
  if (!student) return false;
  return (state.results || []).some((entry) => identityMatchesEntry(entry, student));
}

function handleStudentLogin(e) {
  e.preventDefault();
  loadTokenConfig();

  const nama = document.getElementById('input-nama').value.trim();
  const username = document.getElementById('input-username').value.trim();
  const nisn = document.getElementById('input-nisn').value.trim();
  const absen = document.getElementById('input-absen').value.trim();
  const tokenInput = (document.getElementById('input-token')?.value || '').trim().toUpperCase();
  const errorEl = document.getElementById('login-error');

  if (!nama || !username || !nisn || !absen) {
    errorEl.textContent = 'Nama Lengkap Siswa, Username, Kelas, dan Nomor Absen Siswa wajib diisi lengkap.';
    errorEl.classList.remove('hidden');
    return;
  }

  if (username.length < 2) {
    errorEl.textContent = 'Username minimal 2 karakter.';
    errorEl.classList.remove('hidden');
    return;
  }

  if (nisn.length < 2) {
    errorEl.textContent = 'Kelas wajib diisi dengan benar (contoh: X-K).';
    errorEl.classList.remove('hidden');
    return;
  }

  const absenNum = Number(absen);
  if (!Number.isInteger(absenNum) || absenNum < 1 || absenNum > 999) {
    errorEl.textContent = 'Nomor Absen Siswa harus berupa angka bulat antara 1 sampai 999.';
    errorEl.classList.remove('hidden');
    return;
  }

  if (state.tokenConfig?.required) {
    if (state.tokenConfig.isActive === false) {
      errorEl.textContent =
        'Token Ujian telah dihentikan otomatis karena seluruh siswa telah selesai mengerjakan soal. Hubungi Admin untuk membuka sesi baru.';
      errorEl.classList.remove('hidden');
      showToast('Token Ujian telah dihentikan.', 'error');
      return;
    }
    if (!tokenInput) {
      errorEl.textContent = 'Token Ujian wajib diisi sebelum masuk ruang tes.';
      errorEl.classList.remove('hidden');
      return;
    }
    if (tokenInput !== state.tokenConfig.code) {
      errorEl.textContent = 'Token Ujian tidak sesuai atau sudah direset. Periksa kembali kode Token Ujian aktif.';
      errorEl.classList.remove('hidden');
      showToast('Token Ujian tidak valid.', 'error');
      return;
    }
  }

  const candidate = {
    nama,
    username,
    nisn,
    absen: String(absenNum),
  };

  if (isStudentIdentityUsed(candidate)) {
    errorEl.textContent =
      'Identitas peserta ini sudah melengkapi data sebelumnya dan telah tercatat masuk, sehingga tidak dapat login kembali.';
    errorEl.classList.remove('hidden');
    showToast('Peserta ini sudah pernah login dan tidak dapat masuk kembali.', 'error');
    return;
  }

  errorEl.classList.add('hidden');

  state.student = {
    ...candidate,
    loggedInAt: Date.now(),
  };
  writeStorage(STORAGE_KEYS.STUDENT, state.student);

  // Record identity permanently in Local Storage so this student cannot log in again
  state.usedIdentities = [
    ...(state.usedIdentities || []),
    {
      nama: state.student.nama,
      username: state.student.username,
      nisn: state.student.nisn,
      absen: state.student.absen,
      registeredAt: state.student.loggedInAt,
    },
  ];
  writeStorage(STORAGE_KEYS.USED_IDENTITIES, state.usedIdentities);

  // Clear previous session if belonged to different student
  if (
    state.session &&
    (state.session.studentNisn !== nisn || (state.session.studentAbsen && state.session.studentAbsen !== String(absenNum)))
  ) {
    state.session = null;
    removeStorage(STORAGE_KEYS.SESSION);
  }

  upsertMonitoringRecord(state.student, {
    status: 'Belum Mulai',
    answeredCount: 0,
    totalQuestions: getActiveStudentQuestions().length,
    percentage: 0,
    currentNumber: 0,
    flaggedCount: 0,
    lastActivityAt: Date.now(),
  });

  showToast(`Selamat datang, ${nama}.`, 'success');
  switchView('dashboard');
}

function logoutStudent() {
  if (state.currentView === 'exam') {
    openConfirmModal(
      'Keluar dari Ujian?',
      'Jawaban Anda sejauh ini tetap tersimpan sementara, namun identitas ini tidak dapat digunakan untuk login kembali.',
      () => {
        removeStorage(STORAGE_KEYS.STUDENT);
        state.student = null;
        document.getElementById('login-form').reset();
        switchView('login');
      }
    );
    return;
  }

  if (state.currentView === 'dashboard' && state.student && !hasStudentCompletedExam(state.student)) {
    openConfirmModal(
      'Keluar dari Akun Peserta?',
      'Identitas peserta ini sudah terdaftar dan tidak dapat digunakan untuk login kembali. Yakin ingin keluar?',
      () => {
        removeStorage(STORAGE_KEYS.STUDENT);
        state.student = null;
        document.getElementById('login-form').reset();
        switchView('login');
      }
    );
    return;
  }

  removeStorage(STORAGE_KEYS.STUDENT);
  state.student = null;
  document.getElementById('login-form').reset();
  switchView('login');
}

function renderDashboard() {
  if (!state.student) return switchView('login');

  document.getElementById('dash-nama').textContent = state.student.nama;
  document.getElementById('dash-nisn').textContent = state.student.nisn;
  document.getElementById('dash-absen').textContent = state.student.absen || '-';
  document.getElementById('dash-username').textContent = state.student.username;
  document.getElementById('dash-subject').textContent = state.settings?.subject || DEFAULT_SETTINGS.subject;
  document.getElementById('dash-main-topic').textContent = state.settings?.mainTopic || DEFAULT_SETTINGS.mainTopic;
  const activeQuestions = getActiveStudentQuestions();
  document.getElementById('dash-total-soal').textContent = activeQuestions.length;
  document.getElementById('dash-duration').textContent = `${state.settings?.durationMinutes || EXAM_DURATION_MINUTES} Menit`;

  // Type breakdown
  const counts = { pg: 0, pg_kompleks: 0, isian: 0, benar_salah: 0 };
  activeQuestions.forEach((q) => {
    if (counts[q.type] !== undefined) counts[q.type]++;
  });

  const breakdownEl = document.getElementById('dash-type-breakdown');
  breakdownEl.innerHTML = `
    <div class="type-box">
      <span class="type-box-count">${counts.pg}</span>
      <span class="type-box-label">Pilihan Ganda</span>
    </div>
    <div class="type-box">
      <span class="type-box-count">${counts.pg_kompleks}</span>
      <span class="type-box-label">PG Kompleks</span>
    </div>
    <div class="type-box">
      <span class="type-box-count">${counts.isian}</span>
      <span class="type-box-label">Isian Singkat</span>
    </div>
    <div class="type-box">
      <span class="type-box-count">${counts.benar_salah}</span>
      <span class="type-box-label">Benar / Salah</span>
    </div>
  `;

  const completedNotice = document.getElementById('dash-completed-notice');
  const resumeNotice = document.getElementById('dash-resume-notice');
  const startBtn = document.getElementById('btn-start-exam');
  const startLabel = document.getElementById('btn-start-exam-label');
  const resetBtn = document.getElementById('btn-reset-session');

  if (hasStudentCompletedExam(state.student)) {
    completedNotice.classList.remove('hidden');
    resumeNotice.classList.add('hidden');
    startBtn.classList.add('hidden');
    resetBtn.classList.add('hidden');
    return;
  }

  completedNotice.classList.add('hidden');
  startBtn.classList.remove('hidden');

  // Check active session
  const hasActiveSession = Boolean(
    state.session &&
      state.session.studentNisn === state.student.nisn &&
      Date.now() < state.session.endTime
  );

  if (hasActiveSession) {
    const answeredCount = countAnsweredQuestions(state.session);
    document.getElementById('dash-resume-answered').textContent = answeredCount;
    resumeNotice.classList.remove('hidden');
    startLabel.textContent = 'Lanjutkan Tes';
    resetBtn.classList.remove('hidden');
  } else {
    resumeNotice.classList.add('hidden');
    startLabel.textContent = 'Mulai Tes';
    resetBtn.classList.add('hidden');
  }
}

/* ==================== EXAM ENGINE ==================== */
function shuffleArray(arr) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function handleStartOrResumeExam() {
  if (hasStudentCompletedExam(state.student)) {
    showToast('Ujian untuk peserta ini sudah diselesaikan dan tidak dapat diulang.', 'error');
    return;
  }
  const activeQuestions = getActiveStudentQuestions();
  if (activeQuestions.length === 0) {
    showToast('Belum ada soal aktif untuk dikerjakan. Silakan hubungi Admin/Pengawas ujian.', 'error');
    return;
  }

  const hasValidSession = Boolean(
    state.session &&
      state.student &&
      state.session.studentNisn === state.student.nisn &&
      Date.now() < state.session.endTime
  );

  if (hasValidSession) {
    switchView('exam');
  } else {
    startNewExamSession();
  }
}

function startNewExamSession() {
  if (!state.student) return switchView('login');
  const activeQuestions = getActiveStudentQuestions();
  if (activeQuestions.length === 0) {
    showToast('Belum ada soal aktif untuk dikerjakan siswa.', 'error');
    return;
  }

  const orderMode = state.studentQuestionConfig?.orderMode || 'shuffle';
  const orderedIds =
    orderMode === 'ordered'
      ? activeQuestions.map((q) => q.id)
      : shuffleArray(activeQuestions.map((q) => q.id));
  const now = Date.now();
  const durationMinutes = state.settings?.durationMinutes || EXAM_DURATION_MINUTES;
  const durationMs = durationMinutes * 60 * 1000;

  state.session = {
    studentNama: state.student.nama,
    studentUsername: state.student.username,
    studentNisn: state.student.nisn,
    studentAbsen: state.student.absen || '-',
    questionOrder: orderedIds,
    answers: {},
    flagged: {},
    currentIndex: 0,
    startTime: now,
    endTime: now + durationMs,
  };

  writeStorage(STORAGE_KEYS.SESSION, state.session);
  syncSessionToMonitoring('Sedang Mengerjakan');
  switchView('exam');
}

function getSessionQuestions() {
  if (!state.session) return [];
  const mapById = new Map(state.questions.map((q) => [q.id, q]));
  return state.session.questionOrder.map((id) => mapById.get(id)).filter(Boolean);
}

function isQuestionAnswered(question, answerVal) {
  if (answerVal === undefined || answerVal === null) return false;
  if (question.type === 'pg_kompleks') {
    return Array.isArray(answerVal) && answerVal.length > 0;
  }
  if (question.type === 'isian') {
    return String(answerVal).trim() !== '';
  }
  return String(answerVal).trim() !== '';
}

function countAnsweredQuestions(session) {
  if (!session) return 0;
  const mapById = new Map(state.questions.map((q) => [q.id, q]));
  let count = 0;
  for (const qId of session.questionOrder) {
    const q = mapById.get(qId);
    if (q && isQuestionAnswered(q, session.answers[qId])) {
      count++;
    }
  }
  return count;
}

function renderExamView() {
  if (!state.student || !state.session) {
    return switchView('dashboard');
  }

  document.getElementById('exam-student-name').textContent = state.student.nama;
  document.getElementById('exam-student-nisn').textContent = `Kelas ${state.student.nisn} · Absen ${state.student.absen || '-'}`;

  startCountdownTimer();
  renderCurrentQuestion(false);
  renderNavigatorGrid();
  updateExamProgress();
}

function startCountdownTimer() {
  if (state.timerIntervalId) {
    clearInterval(state.timerIntervalId);
  }

  const updateTick = () => {
    if (!state.session) return;
    const remainingMs = state.session.endTime - Date.now();
    const timerBox = document.getElementById('exam-timer-box');
    const timerDisplay = document.getElementById('exam-timer-display');
    const timerStatus = document.getElementById('exam-timer-status');

    if (remainingMs <= 0) {
      timerDisplay.textContent = '00:00';
      clearInterval(state.timerIntervalId);
      state.timerIntervalId = null;
      finishExam(true);
      return;
    }

    const totalSec = Math.ceil(remainingMs / 1000);
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    timerDisplay.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

    timerBox.classList.remove('is-warning', 'is-danger');
    if (totalSec <= 300) {
      timerBox.classList.add('is-danger');
      timerStatus.textContent = 'Segera Habis';
    } else if (totalSec <= 900) {
      timerBox.classList.add('is-warning');
      timerStatus.textContent = 'Waktu Terbatas';
    } else {
      timerStatus.textContent = 'Sisa Waktu';
    }
  };

  updateTick();
  state.timerIntervalId = setInterval(updateTick, 1000);
}

function renderCurrentQuestion(animate = true) {
  const orderedQuestions = getSessionQuestions();
  if (orderedQuestions.length === 0) return;

  if (state.session.currentIndex >= orderedQuestions.length) {
    state.session.currentIndex = 0;
  }

  const idx = state.session.currentIndex;
  const q = orderedQuestions[idx];
  const total = orderedQuestions.length;

  document.getElementById('q-number-label').textContent = `Soal ${idx + 1} dari ${total}`;
  document.getElementById('q-type-label').textContent = TYPE_LABELS[q.type] || q.type;
  document.getElementById('q-topic-label').textContent = q.topic;

  // Instruction line for multi-select or numeric input
  const instructionEl = document.getElementById('q-instruction');
  if (q.type === 'pg_kompleks') {
    instructionEl.textContent = 'Pilih lebih dari satu jawaban yang menurut Anda benar (gunakan kotak centang).';
    instructionEl.classList.remove('hidden');
  } else if (q.type === 'isian') {
    instructionEl.textContent = 'Ketikkan jawaban berupa angka saja pada kolom di bawah ini.';
    instructionEl.classList.remove('hidden');
  } else if (q.type === 'benar_salah') {
    instructionEl.textContent = 'Tentukan apakah pernyataan berikut Benar atau Salah.';
    instructionEl.classList.remove('hidden');
  } else {
    instructionEl.classList.add('hidden');
  }

  // Flag state
  const isFlagged = Boolean(state.session.flagged[q.id]);
  const flagBtn = document.getElementById('btn-flag-question');
  flagBtn.classList.toggle('active', isFlagged);
  flagBtn.setAttribute('aria-pressed', String(isFlagged));

  // Question text & options
  document.getElementById('q-text').textContent = q.question;
  const answerArea = document.getElementById('q-answer-area');
  answerArea.innerHTML = '';

  const savedAns = state.session.answers[q.id];

  if (q.type === 'pg') {
    const keys = ['A', 'B', 'C', 'D', 'E'];
    keys.forEach((key) => {
      if (!q.options || !q.options[key]) return;
      const isSelected = savedAns === key;
      const label = document.createElement('label');
      label.className = `option-card${isSelected ? ' selected' : ''}`;
      label.innerHTML = `
        <input type="radio" name="q-${q.id}" value="${key}" ${isSelected ? 'checked' : ''} />
        <span class="option-key">${key}</span>
        <span class="option-label-text">${escapeHtml(q.options[key])}</span>
      `;
      label.querySelector('input').addEventListener('change', () => {
        saveQuestionAnswer(q.id, key);
        renderCurrentQuestion(false);
      });
      answerArea.appendChild(label);
    });
  } else if (q.type === 'pg_kompleks') {
    const selectedArr = Array.isArray(savedAns) ? savedAns : [];
    const keys = ['A', 'B', 'C', 'D', 'E'];
    keys.forEach((key) => {
      if (!q.options || !q.options[key]) return;
      const isSelected = selectedArr.includes(key);
      const label = document.createElement('label');
      label.className = `option-card${isSelected ? ' selected' : ''}`;
      label.innerHTML = `
        <input type="checkbox" name="q-${q.id}" value="${key}" ${isSelected ? 'checked' : ''} />
        <span class="option-checkbox-indicator" aria-hidden="true">
          ${isSelected ? '✓' : ''}
        </span>
        <span class="option-key">${key}</span>
        <span class="option-label-text">${escapeHtml(q.options[key])}</span>
      `;
      label.querySelector('input').addEventListener('change', (e) => {
        const current = Array.isArray(state.session.answers[q.id])
          ? [...state.session.answers[q.id]]
          : [];
        if (e.target.checked) {
          if (!current.includes(key)) current.push(key);
        } else {
          const pos = current.indexOf(key);
          if (pos !== -1) current.splice(pos, 1);
        }
        current.sort();
        saveQuestionAnswer(q.id, current);
        renderCurrentQuestion(false);
      });
      answerArea.appendChild(label);
    });
  } else if (q.type === 'isian') {
    const wrap = document.createElement('div');
    wrap.className = 'isian-input-wrap';
    wrap.innerHTML = `
      <label for="isian-field-${q.id}" class="form-label">Jawaban Angka</label>
      <input
        type="number"
        step="any"
        id="isian-field-${q.id}"
        class="form-input mono-input isian-input"
        placeholder="Masukkan angka..."
        value="${savedAns !== undefined && savedAns !== null ? escapeHtml(String(savedAns)) : ''}"
      />
    `;
    const inputEl = wrap.querySelector('input');
    inputEl.addEventListener('input', (e) => {
      saveQuestionAnswer(q.id, e.target.value);
    });
    answerArea.appendChild(wrap);
  } else if (q.type === 'benar_salah') {
    const grid = document.createElement('div');
    grid.className = 'tf-grid';
    ['Benar', 'Salah'].forEach((choice) => {
      const isSelected = savedAns === choice;
      const label = document.createElement('label');
      label.className = `option-card tf-card${isSelected ? ' selected' : ''}`;
      label.innerHTML = `
        <input type="radio" name="q-${q.id}" value="${choice}" ${isSelected ? 'checked' : ''} />
        <span>${choice}</span>
      `;
      label.querySelector('input').addEventListener('change', () => {
        saveQuestionAnswer(q.id, choice);
        renderCurrentQuestion(false);
      });
      grid.appendChild(label);
    });
    answerArea.appendChild(grid);
  }

  // Smooth transition animation
  if (animate) {
    const bodyEl = document.getElementById('question-animated-body');
    bodyEl.classList.remove('animating');
    void bodyEl.offsetWidth; // trigger reflow
    bodyEl.classList.add('animating');
  }

  // Navigation button states
  document.getElementById('btn-prev-question').disabled = idx === 0;
  const isLast = idx === total - 1;
  document.getElementById('btn-next-question').classList.toggle('hidden', isLast);
  document.getElementById('btn-submit-exam-last').classList.toggle('hidden', !isLast);

  renderNavigatorGrid();
}

function saveQuestionAnswer(qId, value) {
  if (!state.session) return;
  state.session.answers[qId] = value;
  writeStorage(STORAGE_KEYS.SESSION, state.session);
  syncSessionToMonitoring('Sedang Mengerjakan');
  updateExamProgress();
  renderNavigatorGrid();

  const hint = document.getElementById('autosave-hint');
  if (hint) {
    hint.textContent = 'Jawaban tersimpan';
    clearTimeout(hint._t);
    hint._t = setTimeout(() => {
      hint.textContent = 'Tersimpan otomatis';
    }, 1200);
  }
}

function navigateQuestion(delta) {
  if (!state.session) return;
  const ordered = getSessionQuestions();
  const nextIdx = state.session.currentIndex + delta;
  if (nextIdx >= 0 && nextIdx < ordered.length) {
    state.session.currentIndex = nextIdx;
    writeStorage(STORAGE_KEYS.SESSION, state.session);
    syncSessionToMonitoring('Sedang Mengerjakan');
    renderCurrentQuestion(true);
  }
}

function jumpToQuestion(index) {
  if (!state.session) return;
  state.session.currentIndex = index;
  writeStorage(STORAGE_KEYS.SESSION, state.session);
  syncSessionToMonitoring('Sedang Mengerjakan');
  renderCurrentQuestion(true);
}

function toggleFlagCurrentQuestion() {
  if (!state.session) return;
  const ordered = getSessionQuestions();
  const q = ordered[state.session.currentIndex];
  if (!q) return;

  if (state.session.flagged[q.id]) {
    delete state.session.flagged[q.id];
  } else {
    state.session.flagged[q.id] = true;
  }
  writeStorage(STORAGE_KEYS.SESSION, state.session);
  syncSessionToMonitoring('Sedang Mengerjakan');
  renderCurrentQuestion(false);
}

function updateExamProgress() {
  if (!state.session) return;
  const total = state.session.questionOrder.length;
  const answered = countAnsweredQuestions(state.session);
  const pct = total > 0 ? Math.round((answered / total) * 100) : 0;

  document.getElementById('exam-progress-text').textContent = `${answered} / ${total} Terjawab (${pct}%)`;
  document.getElementById('exam-progress-fill').style.width = `${pct}%`;
  document.getElementById('exam-progress-bar-wrap').setAttribute('aria-valuenow', String(pct));
  document.getElementById('nav-summary-count').textContent = `${answered}/${total}`;
}

function renderNavigatorGrid() {
  if (!state.session) return;
  const grid = document.getElementById('question-navigator-grid');
  const ordered = getSessionQuestions();

  grid.innerHTML = '';
  ordered.forEach((q, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'num-btn';
    btn.textContent = String(i + 1);
    btn.setAttribute('aria-label', `Nomor ${i + 1}`);

    const answered = isQuestionAnswered(q, state.session.answers[q.id]);
    const flagged = Boolean(state.session.flagged[q.id]);

    if (flagged) {
      btn.classList.add('is-flagged');
    } else if (answered) {
      btn.classList.add('is-answered');
    }

    if (i === state.session.currentIndex) {
      btn.classList.add('is-current');
    }

    btn.addEventListener('click', () => jumpToQuestion(i));
    grid.appendChild(btn);
  });
}

function promptFinishExam() {
  if (!state.session) return;
  const total = state.session.questionOrder.length;
  const answered = countAnsweredQuestions(state.session);
  const unanswered = total - answered;

  const message =
    unanswered > 0
      ? `Masih ada ${unanswered} soal yang belum terjawab dari total ${total} soal. Apakah Anda yakin ingin mengumpulkan ujian sekarang?`
      : `Seluruh ${total} soal telah terjawab. Kumpulkan ujian dan lihat hasil penilaian sekarang?`;

  openConfirmModal('Kumpulkan Jawaban Ujian?', message, () => finishExam(false));
}

/* ==================== GRADING & RESULT ENGINE ==================== */
function checkAnswerCorrectness(question, userAns) {
  if (!isQuestionAnswered(question, userAns)) return false;

  if (question.type === 'pg' || question.type === 'benar_salah') {
    return String(userAns).trim() === String(question.answer).trim();
  }

  if (question.type === 'pg_kompleks') {
    const userArr = Array.isArray(userAns) ? [...userAns].sort() : [];
    const keyArr = Array.isArray(question.answer) ? [...question.answer].sort() : [];
    if (userArr.length !== keyArr.length) return false;
    return userArr.every((val, i) => val === keyArr[i]);
  }

  if (question.type === 'isian') {
    const uNum = Number(String(userAns).trim());
    const kNum = Number(String(question.answer).trim());
    return !Number.isNaN(uNum) && !Number.isNaN(kNum) && uNum === kNum;
  }

  return false;
}

function formatAnswerDisplay(question, ans) {
  if (!isQuestionAnswered(question, ans)) return '(Tidak dijawab)';
  if (question.type === 'pg_kompleks') {
    return Array.isArray(ans) ? ans.join(', ') : String(ans);
  }
  return String(ans);
}

function finishExam(isAutoTimeout = false) {
  if (state.timerIntervalId) {
    clearInterval(state.timerIntervalId);
    state.timerIntervalId = null;
  }

  if (!state.session || !state.student) return;

  const orderedQuestions = getSessionQuestions();
  const totalQuestions = orderedQuestions.length;
  let correctCount = 0;

  const topicMap = {};
  TOPICS.forEach((t) => {
    topicMap[t] = { topic: t, correct: 0, total: 0 };
  });

  const details = orderedQuestions.map((q, idx) => {
    const userAns = state.session.answers[q.id];
    const isCorrect = checkAnswerCorrectness(q, userAns);
    if (isCorrect) correctCount++;

    if (!topicMap[q.topic]) {
      topicMap[q.topic] = { topic: q.topic, correct: 0, total: 0 };
    }
    topicMap[q.topic].total++;
    if (isCorrect) topicMap[q.topic].correct++;

    return {
      no: idx + 1,
      id: q.id,
      type: q.type,
      topic: q.topic,
      question: q.question,
      userAnswerText: formatAnswerDisplay(q, userAns),
      correctAnswerText: formatAnswerDisplay(q, q.answer),
      isCorrect,
      explanation: q.explanation || '',
    };
  });

  const wrongCount = totalQuestions - correctCount;
  const rawScore = totalQuestions > 0 ? (correctCount / totalQuestions) * 100 : 0;
  const score = Number.isInteger(rawScore) ? rawScore : Number(rawScore.toFixed(2));
  const percentage = totalQuestions > 0 ? Number(((correctCount / totalQuestions) * 100).toFixed(1)) : 0;
  const status = rawScore >= PASSING_GRADE ? 'Lulus' : 'Belum Lulus';

  const topicStats = Object.values(topicMap).filter((item) => item.total > 0);
  const nomorUrut = state.results.length + 1;

  const subject = state.settings?.subject || DEFAULT_SETTINGS.subject;
  const mainTopic = state.settings?.mainTopic || DEFAULT_SETTINGS.mainTopic;

  const resultRecord = {
    id: `RES-${Date.now()}`,
    nomorUrut,
    nama: state.student.nama,
    username: state.student.username,
    nisn: state.student.nisn,
    absen: state.student.absen || '-',
    subject,
    mainTopic,
    score,
    correctCount,
    wrongCount,
    totalQuestions,
    percentage,
    status,
    completedAt: new Date().toISOString(),
    topicStats,
    details,
  };

  const answeredCount = countAnsweredQuestions(state.session);
  resultRecord.answeredCount = answeredCount;

  state.results.push(resultRecord);
  writeStorage(STORAGE_KEYS.RESULTS, state.results);

  const completedPct = totalQuestions > 0 ? Math.round((answeredCount / totalQuestions) * 100) : 0;
  upsertMonitoringRecord(state.student, {
    status: 'Selesai',
    answeredCount,
    totalQuestions,
    percentage: completedPct,
    currentNumber: totalQuestions,
    flaggedCount: Object.keys(state.session.flagged || {}).length,
    completedAt: resultRecord.completedAt,
    lastActivityAt: Date.now(),
  });

  // Store non-grade submission summary for student confirmation screen
  state.lastSubmission = {
    nama: resultRecord.nama,
    nisn: resultRecord.nisn,
    absen: resultRecord.absen,
    subject: resultRecord.subject,
    mainTopic: resultRecord.mainTopic,
    nomorUrut: resultRecord.nomorUrut,
    answeredCount,
    totalQuestions: resultRecord.totalQuestions,
    completedAt: resultRecord.completedAt,
  };

  // Clear active exam session
  removeStorage(STORAGE_KEYS.SESSION);
  state.session = null;
  state.activeResult = null;
  state.resultOpenedFromAdmin = false;
  state.resultFilter = 'all';

  // Auto-stop token if all students have finished
  evaluateTokenAutoStop();

  if (isAutoTimeout) {
    showToast('Waktu ujian habis! Jawaban Anda berhasil dikirim ke Portal Admin.', 'error');
  } else {
    showToast('Ujian selesai! Jawaban Anda berhasil dikumpulkan.', 'success');
  }

  switchView('submitted');
}

function renderSubmittedView() {
  const sub = state.lastSubmission;
  if (!sub) return switchView('dashboard');

  const subject = sub.subject || state.settings?.subject || DEFAULT_SETTINGS.subject;
  const mainTopic = sub.mainTopic || state.settings?.mainTopic || DEFAULT_SETTINGS.mainTopic;

  document.getElementById('sub-nama').textContent = sub.nama;
  document.getElementById('sub-nisn').textContent = sub.nisn;
  document.getElementById('sub-absen').textContent = sub.absen || '-';
  document.getElementById('sub-nomor-urut').textContent = `#${sub.nomorUrut}`;
  document.getElementById('sub-subject').textContent = subject;
  document.getElementById('sub-main-topic').textContent = mainTopic;
  document.getElementById('sub-answered').textContent = `${sub.answeredCount} / ${sub.totalQuestions} Soal`;
  document.getElementById('sub-timestamp').textContent = formatDateTimeID(sub.completedAt);
}

/* ==================== RESULT PAGE & BAR CHARTS (ADMIN) ==================== */
function renderResultView() {
  const res = state.activeResult;
  if (!res || !state.adminUnlocked) return switchView('admin');

  const subject = res.subject || state.settings?.subject || DEFAULT_SETTINGS.subject;
  const mainTopic = res.mainTopic || state.settings?.mainTopic || DEFAULT_SETTINGS.mainTopic;

  document.getElementById('btn-result-back-admin').classList.toggle('hidden', !state.resultOpenedFromAdmin);
  document.getElementById('btn-retake-test').classList.toggle('hidden', state.resultOpenedFromAdmin);

  document.getElementById('result-heading').textContent = `Hasil Ujian ${subject}`;
  document.getElementById('res-nama').textContent = res.nama;
  document.getElementById('res-nisn').textContent = res.nisn;
  document.getElementById('res-absen').textContent = res.absen || '-';
  document.getElementById('res-nomor-urut').textContent = `#${res.nomorUrut}`;
  document.getElementById('res-subject').textContent = subject;
  document.getElementById('res-main-topic').textContent = mainTopic;
  document.getElementById('res-timestamp').textContent = formatDateTimeID(res.completedAt);

  document.getElementById('res-score').textContent = res.score;
  document.getElementById('res-correct').textContent = res.correctCount;
  document.getElementById('res-wrong').textContent = res.wrongCount;
  document.getElementById('res-percent').textContent = `${res.percentage}%`;

  const statusBox = document.getElementById('res-status-box');
  const statusText = document.getElementById('res-status-text');
  const isPass = res.score >= PASSING_GRADE;
  statusBox.classList.remove('is-pass', 'is-fail');
  statusBox.classList.add(isPass ? 'is-pass' : 'is-fail');
  statusText.textContent = isPass ? '✓ Lulus (≥ 75)' : '✕ Belum Lulus (< 75)';

  // Reset filter tabs
  document.querySelectorAll('[data-res-filter]').forEach((b) => {
    b.classList.toggle('active', b.dataset.resFilter === state.resultFilter);
  });

  renderResultSummaryList();
  requestAnimationFrame(() => drawResultCharts(res));
}

function renderResultSummaryList() {
  const res = state.activeResult;
  const container = document.getElementById('result-summary-list');
  if (!res || !Array.isArray(res.details)) {
    container.innerHTML = '<div class="empty-state">Tidak ada ringkasan jawaban.</div>';
    return;
  }

  const filtered = res.details.filter((d) => {
    if (state.resultFilter === 'correct') return d.isCorrect;
    if (state.resultFilter === 'wrong') return !d.isCorrect;
    return true;
  });

  if (filtered.length === 0) {
    container.innerHTML = '<div class="empty-state">Tidak ada butir soal untuk filter yang dipilih.</div>';
    return;
  }

  container.innerHTML = filtered
    .map(
      (item) => `
    <div class="summary-item">
      <div class="summary-item-top">
        <span class="meta-text">
          <strong>No. ${item.no}</strong> · ${escapeHtml(TYPE_LABELS[item.type] || item.type)} · ${escapeHtml(item.topic)}
        </span>
        <span class="summary-item-status ${item.isCorrect ? 'is-correct' : 'is-wrong'}">
          ${item.isCorrect ? '✓ Benar' : '✕ Salah'}
        </span>
      </div>
      <p class="summary-item-q">${escapeHtml(item.question)}</p>
      <div class="summary-item-answers">
        <div>
          <span class="meta-text">Jawaban Peserta:</span><br />
          <strong>${escapeHtml(item.userAnswerText)}</strong>
        </div>
        <div>
          <span class="meta-text">Kunci Jawaban:</span><br />
          <strong>${escapeHtml(item.correctAnswerText)}</strong>
        </div>
      </div>
      ${item.explanation ? `<p class="summary-item-exp">Pembahasan: ${escapeHtml(item.explanation)}</p>` : ''}
    </div>
  `
    )
    .join('');
}

function drawResultCharts(res) {
  drawSummaryBarChart(res);
  drawTopicsBarChart(res);
}

function setupHighDpiCanvas(canvas, logicalW, logicalH) {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = logicalW * dpr;
  canvas.height = logicalH * dpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

function drawSummaryBarChart(res) {
  const canvas = document.getElementById('chart-summary');
  if (!canvas) return;
  const W = 480;
  const H = 250;
  const ctx = setupHighDpiCanvas(canvas, W, H);

  ctx.clearRect(0, 0, W, H);

  const pad = { top: 28, right: 20, bottom: 44, left: 42 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;

  // Grid & Y-axis (0..100)
  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 1;
  ctx.font = '500 11px "JetBrains Mono", monospace';
  ctx.fillStyle = '#64748b';
  ctx.textAlign = 'right';

  [0, 25, 50, 75, 100].forEach((val) => {
    const y = pad.top + plotH - (val / 100) * plotH;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(W - pad.right, y);
    ctx.stroke();
    ctx.fillText(String(val), pad.left - 8, y + 4);
  });

  // Bars data
  const correctPct = res.totalQuestions > 0 ? (res.correctCount / res.totalQuestions) * 100 : 0;
  const wrongPct = res.totalQuestions > 0 ? (res.wrongCount / res.totalQuestions) * 100 : 0;
  const bars = [
    { label: 'Nilai Akhir', value: res.score, display: `${res.score}`, color: '#1d4ed8' },
    { label: 'KKM Lulus', value: PASSING_GRADE, display: `${PASSING_GRADE}`, color: '#94a3b8' },
    { label: 'Benar (%)', value: correctPct, display: `${correctPct.toFixed(0)}%`, color: '#059669' },
    { label: 'Salah (%)', value: wrongPct, display: `${wrongPct.toFixed(0)}%`, color: '#dc2626' },
  ];

  const slotW = plotW / bars.length;
  const barW = Math.min(48, slotW * 0.56);

  bars.forEach((b, idx) => {
    const x = pad.left + idx * slotW + (slotW - barW) / 2;
    const barH = Math.max(2, (b.value / 100) * plotH);
    const y = pad.top + plotH - barH;

    // Rounded top bar
    ctx.fillStyle = b.color;
    ctx.beginPath();
    ctx.roundRect(x, y, barW, barH, [6, 6, 0, 0]);
    ctx.fill();

    // Value label
    ctx.fillStyle = '#0f172a';
    ctx.font = '700 12px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText(b.display, x + barW / 2, y - 8);

    // X label
    ctx.fillStyle = '#475569';
    ctx.font = '600 11px "Plus Jakarta Sans", sans-serif';
    ctx.fillText(b.label, x + barW / 2, pad.top + plotH + 20);
  });

  // KKM dashed line
  const kkmY = pad.top + plotH - (PASSING_GRADE / 100) * plotH;
  ctx.save();
  ctx.setLineDash([5, 4]);
  ctx.strokeStyle = '#0284c7';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(pad.left, kkmY);
  ctx.lineTo(W - pad.right, kkmY);
  ctx.stroke();
  ctx.restore();
}

function drawTopicsBarChart(res) {
  const canvas = document.getElementById('chart-topics');
  if (!canvas) return;
  const stats = res.topicStats || [];
  const W = 560;
  const H = Math.max(250, stats.length * 36 + 32);
  const ctx = setupHighDpiCanvas(canvas, W, H);

  ctx.clearRect(0, 0, W, H);

  if (stats.length === 0) return;

  const pad = { top: 14, right: 54, bottom: 24, left: 205 };
  const plotW = W - pad.left - pad.right;
  const rowH = (H - pad.top - pad.bottom) / stats.length;
  const barH = Math.min(18, rowH * 0.56);

  // Vertical grid lines (0, 50, 100)
  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 1;
  [0, 50, 75, 100].forEach((val) => {
    const x = pad.left + (val / 100) * plotW;
    ctx.beginPath();
    ctx.moveTo(x, pad.top);
    ctx.lineTo(x, H - pad.bottom);
    ctx.stroke();

    ctx.fillStyle = '#64748b';
    ctx.font = '500 10px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`${val}%`, x, H - 8);
  });

  stats.forEach((item, idx) => {
    const pct = item.total > 0 ? Math.round((item.correct / item.total) * 100) : 0;
    const centerY = pad.top + idx * rowH + rowH / 2;
    const y = centerY - barH / 2;

    // Topic label (truncated cleanly)
    const shortTopic = item.topic.length > 27 ? item.topic.slice(0, 26) + '…' : item.topic;
    ctx.fillStyle = '#334155';
    ctx.font = '600 11px "Plus Jakarta Sans", sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(shortTopic, pad.left - 10, centerY + 4);

    // Track
    ctx.fillStyle = '#e2e8f0';
    ctx.beginPath();
    ctx.roundRect(pad.left, y, plotW, barH, 4);
    ctx.fill();

    // Fill
    const fillW = Math.max(4, (pct / 100) * plotW);
    ctx.fillStyle = pct >= PASSING_GRADE ? '#1d4ed8' : '#0284c7';
    ctx.beginPath();
    ctx.roundRect(pad.left, y, fillW, barH, 4);
    ctx.fill();

    // Value label
    ctx.fillStyle = '#0f172a';
    ctx.font = '700 11px "JetBrains Mono", monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`${pct}%`, pad.left + plotW + 8, centerY + 4);
  });
}

/* ==================== PURE JS PDF GENERATOR (NO CDN NEEDED) ==================== */
function sanitizePdfText(str) {
  return String(str || '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[^\x20-\x7E]/g, (ch) => {
      if (ch === '≥') return '>=';
      if (ch === '≤') return '<=';
      if (ch === '≠') return '!=';
      if (ch === '±') return '+/-';
      if (ch === '×') return 'x';
      if (ch === '÷') return '/';
      if (ch === '²') return '^2';
      if (ch === '³') return '^3';
      if (ch === '→') return '->';
      if (ch === '←') return '<-';
      if (ch === '✓') return '[BENAR]';
      if (ch === '✕') return '[SALAH]';
      if (ch === '·' || ch === '•') return '-';
      if (ch === '–' || ch === '—') return '-';
      if (ch === '…') return '...';
      if (ch === '“' || ch === '”') return '"';
      if (ch === '‘' || ch === '’') return "'";
      return ' ';
    })
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function wrapText(text, maxChars) {
  const words = String(text || '').split(/\s+/);
  const lines = [];
  let current = '';
  for (const w of words) {
    if ((current + ' ' + w).trim().length > maxChars) {
      if (current) lines.push(current);
      current = w;
    } else {
      current = (current + ' ' + w).trim();
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [''];
}

function generateResultPdfBlob(res) {
  // Page dimensions: A4 (595 x 842 pt)
  const pageStreams = [];
  let commands = [];
  let y = 785;

  const newPage = () => {
    if (commands.length > 0) pageStreams.push(commands.join('\n'));
    commands = [];
    y = 790;
  };

  const drawText = (x, yPos, text, font = 'F1', size = 10, color = '0.06 0.09 0.16') => {
    commands.push(`BT /${font} ${size} Tf ${color} rg ${x} ${yPos} Td (${sanitizePdfText(text)}) Tj ET`);
  };

  // Header Banner
  const pdfSubject = res.subject || state.settings?.subject || DEFAULT_SETTINGS.subject;
  const pdfMainTopic = res.mainTopic || state.settings?.mainTopic || DEFAULT_SETTINGS.mainTopic;
  commands.push('0.114 0.306 0.847 rg 40 755 515 56 re f');
  drawText(56, 786, 'CBT ONLINE MAZRO - LAPORAN HASIL UJIAN', 'F2', 14, '1 1 1');
  drawText(56, 768, `Mata Pelajaran: ${pdfSubject} | Materi: ${pdfMainTopic}`, 'F1', 9.5, '0.88 0.94 1');

  y = 732;
  // Student Identity Box
  commands.push('0.97 0.98 0.99 rg 40 626 515 92 re f');
  commands.push('0.88 0.91 0.94 RG 0.8 w 40 626 515 92 re S');

  drawText(54, 698, `Nama Siswa   : ${res.nama}`, 'F2', 10.5);
  drawText(54, 680, `Kelas / Absen: ${res.nisn} / No. ${res.absen || '-'}`, 'F1', 10);
  drawText(54, 662, `Nomor Urut   : #${res.nomorUrut}`, 'F1', 10);
  drawText(54, 644, `Waktu Selesai: ${formatDateTimeID(res.completedAt)}`, 'F1', 10);

  // Score Summary on right half of Identity Box
  drawText(340, 696, `NILAI AKHIR : ${res.score}`, 'F2', 14, '0.114 0.306 0.847');
  drawText(
    340,
    676,
    `Status      : ${res.status.toUpperCase()} (KKM ${PASSING_GRADE})`,
    'F2',
    10.5,
    res.score >= PASSING_GRADE ? '0.02 0.47 0.34' : '0.72 0.11 0.11'
  );
  drawText(340, 658, `Benar / Salah: ${res.correctCount} Benar / ${res.wrongCount} Salah`, 'F1', 10);
  drawText(340, 642, `Persentase  : ${res.percentage}% (${res.totalQuestions} Soal)`, 'F1', 10);

  // Topic Mastery Vector Bar Chart
  y = 602;
  drawText(40, y, 'DIAGRAM CAPAIAN PER MATERI (%)', 'F2', 11, '0.114 0.306 0.847');
  y -= 18;

  (res.topicStats || []).forEach((t) => {
    const pct = t.total > 0 ? Math.round((t.correct / t.total) * 100) : 0;
    const label = t.topic.length > 34 ? t.topic.slice(0, 33) + '...' : t.topic;
    drawText(40, y, label, 'F1', 9);
    // Bar track
    commands.push(`0.91 0.93 0.96 rg 245 ${y - 2} 250 10 re f`);
    // Bar fill
    const fillW = Math.max(2, (pct / 100) * 250);
    commands.push(`0.114 0.306 0.847 rg 245 ${y - 2} ${fillW.toFixed(1)} 10 re f`);
    drawText(505, y, `${pct}% (${t.correct}/${t.total})`, 'F2', 8.5);
    y -= 18;
  });

  // Answer Summary Section
  y -= 12;
  drawText(40, y, 'RINGKASAN JAWABAN PESERTA', 'F2', 11, '0.114 0.306 0.847');
  y -= 14;

  (res.details || []).forEach((item) => {
    const qLines = wrapText(`${item.no}. ${item.question}`, 84);
    const neededHeight = qLines.length * 12 + 24;
    if (y - neededHeight < 55) {
      newPage();
      drawText(40, y, 'RINGKASAN JAWABAN PESERTA (Lanjutan)', 'F2', 10, '0.114 0.306 0.847');
      y -= 18;
    }

    const statusTag = item.isCorrect ? 'BENAR' : 'SALAH';
    const statusColor = item.isCorrect ? '0.02 0.47 0.34' : '0.72 0.11 0.11';

    qLines.forEach((line) => {
      drawText(40, y, line, 'F1', 9);
      y -= 12;
    });

    drawText(
      52,
      y,
      `[${statusTag}] Jawaban: ${item.userAnswerText} | Kunci: ${item.correctAnswerText}`,
      'F2',
      8.5,
      statusColor
    );
    y -= 16;
  });

  if (commands.length > 0) pageStreams.push(commands.join('\n'));
  return buildPdfBlobFromPageStreams(pageStreams);
}

function buildPdfBlobFromPageStreams(pageStreams) {
  const objects = [];
  const addObj = (body) => {
    objects.push(body);
    return objects.length;
  };

  const font1Id = addObj('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const font2Id = addObj('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
  const pagesPlaceholderId = addObj(''); // filled later

  const pageIds = [];
  pageStreams.forEach((stream) => {
    const contentId = addObj(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    const pageId = addObj(
      `<< /Type /Page /Parent ${pagesPlaceholderId} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${font1Id} 0 R /F2 ${font2Id} 0 R >> >> /Contents ${contentId} 0 R >>`
    );
    pageIds.push(pageId);
  });

  objects[pagesPlaceholderId - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;
  const catalogId = addObj(`<< /Type /Catalog /Pages ${pagesPlaceholderId} 0 R >>`);

  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((body, idx) => {
    offsets.push(pdf.length);
    pdf += `${idx + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i < offsets.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

  return new Blob([pdf], { type: 'application/pdf' });
}

function handleDownloadPdf() {
  if (!state.activeResult) return;
  const blob = generateResultPdfBlob(state.activeResult);
  const url = URL.createObjectURL(blob);
  const safeName = state.activeResult.nama.replace(/[^a-zA-Z0-9]+/g, '_');
  const a = document.createElement('a');
  a.href = url;
  a.download = `Hasil_CBT_MAZRO_${safeName}_${state.activeResult.nisn}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast('File PDF hasil ujian berhasil diunduh.', 'success');
}

function formatCorrectAnswerWithDetail(q) {
  if (q.type === 'pg') {
    const key = String(q.answer || '').trim();
    const optText = q.options && q.options[key] ? q.options[key] : '';
    return optText ? `${key}. ${optText}` : key;
  }
  if (q.type === 'pg_kompleks') {
    const keys = Array.isArray(q.answer) ? q.answer : [];
    return keys
      .map((k) => {
        const optText = q.options && q.options[k] ? q.options[k] : '';
        return optText ? `${k} (${optText})` : k;
      })
      .join('; ');
  }
  if (q.type === 'isian') {
    return String(q.answer ?? '');
  }
  if (q.type === 'benar_salah') {
    return String(q.answer ?? '');
  }
  return formatAnswerDisplay(q, q.answer);
}

function generateQuestionBankPdfBlob(questionsList, filterMeta = {}) {
  const pageCommandLists = [];
  let commands = [];
  let y = 785;
  const bottomLimit = 56;

  const pushTextCmd = (target, x, yPos, text, font = 'F1', size = 9.5, color = '0.06 0.09 0.16') => {
    target.push(`BT /${font} ${size} Tf ${color} rg ${x} ${yPos} Td (${sanitizePdfText(text)}) Tj ET`);
  };

  const drawText = (x, yPos, text, font = 'F1', size = 9.5, color = '0.06 0.09 0.16') => {
    pushTextCmd(commands, x, yPos, text, font, size, color);
  };

  const startNewPage = () => {
    if (commands.length > 0) pageCommandLists.push(commands);
    commands = [];
    // Compact running header on continuation pages
    commands.push('0.96 0.98 1 rg 40 792 515 24 re f');
    commands.push('0.84 0.89 0.96 RG 0.6 w 40 792 515 24 re S');
    drawText(50, 800, 'CBT ONLINE MAZRO - BANK SOAL & KUNCI JAWABAN', 'F2', 9, '0.114 0.306 0.847');
    drawText(425, 800, state.settings?.subject || DEFAULT_SETTINGS.subject, 'F2', 8.5, '0.28 0.34 0.43');
    y = 772;
  };

  // Page 1 Header Banner
  const subject = state.settings?.subject || DEFAULT_SETTINGS.subject;
  const mainTopic = state.settings?.mainTopic || DEFAULT_SETTINGS.mainTopic;
  const duration = state.settings?.durationMinutes || EXAM_DURATION_MINUTES;

  commands.push('0.114 0.306 0.847 rg 40 754 515 58 re f');
  drawText(54, 788, 'CBT ONLINE MAZRO - BANK SOAL & KUNCI JAWABAN', 'F2', 13.5, '1 1 1');
  drawText(54, 770, `Mata Pelajaran: ${subject} | Materi: ${mainTopic}`, 'F1', 9, '0.88 0.94 1');

  // Summary Meta Box
  const counts = { pg: 0, pg_kompleks: 0, isian: 0, benar_salah: 0 };
  questionsList.forEach((q) => {
    if (counts[q.type] !== undefined) counts[q.type]++;
  });

  const hasFilter = Boolean(
    filterMeta.search ||
      (filterMeta.type && filterMeta.type !== 'all') ||
      (filterMeta.topic && filterMeta.topic !== 'all')
  );
  const boxHeight = hasFilter ? 68 : 54;
  const boxBottom = 742 - boxHeight;

  commands.push(`0.97 0.98 0.99 rg 40 ${boxBottom} 515 ${boxHeight} re f`);
  commands.push(`0.88 0.91 0.94 RG 0.8 w 40 ${boxBottom} 515 ${boxHeight} re S`);

  drawText(52, 725, `Jumlah Soal: ${questionsList.length} Butir | Durasi Ujian: ${duration} Menit`, 'F2', 9.5);
  drawText(340, 725, `Diekspor: ${formatDateTimeID(new Date().toISOString())}`, 'F1', 8.5, '0.33 0.39 0.48');
  drawText(
    52,
    708,
    `Komposisi: PG (${counts.pg}) | PG Kompleks (${counts.pg_kompleks}) | Isian (${counts.isian}) | Benar/Salah (${counts.benar_salah})`,
    'F1',
    8.8,
    '0.20 0.25 0.33'
  );

  if (hasFilter) {
    const filterParts = [];
    if (filterMeta.type && filterMeta.type !== 'all') filterParts.push(`Jenis: ${TYPE_LABELS[filterMeta.type] || filterMeta.type}`);
    if (filterMeta.topic && filterMeta.topic !== 'all') filterParts.push(`Materi: ${filterMeta.topic}`);
    if (filterMeta.search) filterParts.push(`Kata kunci: "${filterMeta.search}"`);
    drawText(52, 691, `Filter Aktif: ${filterParts.join(' | ')}`, 'F2', 8.3, '0.114 0.306 0.847');
  }

  y = boxBottom - 20;

  questionsList.forEach((q, idx) => {
    const typeLabel = TYPE_LABELS[q.type] || q.type;
    const headerText = `${idx + 1}. [${q.id}] ${typeLabel} - ${q.topic}`;
    const qLines = wrapText(q.question, 86);

    // Prepare options lines
    const optionEntries = [];
    if ((q.type === 'pg' || q.type === 'pg_kompleks') && q.options) {
      const keys = Object.keys(q.options);
      const correctKeys =
        q.type === 'pg'
          ? [String(q.answer || '').trim()]
          : Array.isArray(q.answer)
            ? q.answer
            : [];

      keys.forEach((key) => {
        const isCorrectOpt = correctKeys.includes(key);
        const prefix = isCorrectOpt ? `${key}. [KUNCI] ` : `${key}. `;
        const wrapped = wrapText(`${prefix}${q.options[key]}`, 80);
        optionEntries.push({ lines: wrapped, isCorrect: isCorrectOpt });
      });
    } else if (q.type === 'benar_salah') {
      const ansStr = String(q.answer || '').trim();
      optionEntries.push({
        lines: [`Opsi: Benar${ansStr === 'Benar' ? ' [KUNCI]' : ''}  /  Salah${ansStr === 'Salah' ? ' [KUNCI]' : ''}`],
        isCorrect: false,
      });
    }

    const answerLines = wrapText(`Kunci Jawaban Benar: ${formatCorrectAnswerWithDetail(q)}`, 82);
    const expLines = q.explanation ? wrapText(`Pembahasan: ${q.explanation}`, 84) : [];

    // Estimate exact height required for this question block
    let blockHeight = 14; // header line
    blockHeight += qLines.length * 12 + 3;
    optionEntries.forEach((opt) => {
      blockHeight += opt.lines.length * 11.5 + 1.5;
    });
    blockHeight += 4 + answerLines.length * 12;
    if (expLines.length > 0) {
      blockHeight += 2 + expLines.length * 11;
    }
    blockHeight += 14; // divider + spacing

    if (y - blockHeight < bottomLimit && y < 740) {
      startNewPage();
    }

    // Question metadata line
    drawText(40, y, headerText, 'F2', 8.8, '0.114 0.306 0.847');
    y -= 14;

    // Question body
    qLines.forEach((line) => {
      if (y < bottomLimit) startNewPage();
      drawText(40, y, line, 'F2', 9.5, '0.06 0.09 0.16');
      y -= 12;
    });
    y -= 3;

    // Options
    optionEntries.forEach((opt) => {
      opt.lines.forEach((line, lIdx) => {
        if (y < bottomLimit) startNewPage();
        drawText(
          lIdx === 0 ? 52 : 66,
          y,
          line,
          opt.isCorrect ? 'F2' : 'F1',
          9,
          opt.isCorrect ? '0.02 0.47 0.34' : '0.20 0.25 0.33'
        );
        y -= 11.5;
      });
      y -= 1.5;
    });

    y -= 3;
    // Correct Answer highlight bar
    answerLines.forEach((line) => {
      if (y < bottomLimit) startNewPage();
      drawText(48, y, line, 'F2', 9, '0.02 0.47 0.34');
      y -= 12;
    });

    // Explanation
    if (expLines.length > 0) {
      y -= 2;
      expLines.forEach((line) => {
        if (y < bottomLimit) startNewPage();
        drawText(48, y, line, 'F1', 8.5, '0.35 0.42 0.51');
        y -= 11;
      });
    }

    // Subtle divider line
    y -= 4;
    if (y >= bottomLimit) {
      commands.push(`0.88 0.91 0.94 RG 0.6 w 40 ${y} m 555 ${y} l S`);
      y -= 12;
    }
  });

  if (commands.length > 0) pageCommandLists.push(commands);

  const totalPages = pageCommandLists.length;
  const pageStreams = pageCommandLists.map((cmds, pIdx) => {
    const pageCmds = [...cmds];
    pageCmds.push('0.88 0.91 0.94 RG 0.6 w 40 38 m 555 38 l S');
    pushTextCmd(pageCmds, 40, 24, 'CBT ONLINE MAZRO - Bank Soal & Kunci Jawaban Resmi', 'F1', 8, '0.45 0.51 0.60');
    pushTextCmd(pageCmds, 488, 24, `Halaman ${pIdx + 1} dari ${totalPages}`, 'F1', 8, '0.45 0.51 0.60');
    return pageCmds.join('\n');
  });

  return buildPdfBlobFromPageStreams(pageStreams);
}

function exportQuestionBankToPdf() {
  const { list, meta } = getFilteredAdminQuestions();
  if (list.length === 0) {
    showToast('Tidak ada soal yang dapat diekspor ke PDF.', 'error');
    return;
  }

  const blob = generateQuestionBankPdfBlob(list, meta);
  const dateTag = new Date().toISOString().slice(0, 10);
  triggerFileDownload(blob, `Bank_Soal_dan_Kunci_CBT_MAZRO_${dateTag}.pdf`);
  showToast(`Berhasil mengekspor ${list.length} soal beserta kunci jawaban ke PDF.`, 'success');
}

/* ==================== ADMIN PORTAL & CRUD ==================== */
function openAdminPortal() {
  if (state.currentView === 'exam') {
    showToast('Selesaikan atau keluar dari sesi ujian aktif terlebih dahulu.', 'error');
    return;
  }

  if (state.adminUnlocked) {
    switchView('admin');
  } else {
    document.getElementById('admin-auth-error').classList.add('hidden');
    document.getElementById('input-admin-pin').value = '';
    openModal('modal-admin-auth');
    setTimeout(() => document.getElementById('input-admin-pin').focus(), 80);
  }
}

function handleAdminLoginSubmit(e) {
  e.preventDefault();
  const pin = document.getElementById('input-admin-pin').value.trim();
  const errEl = document.getElementById('admin-auth-error');

  if (pin !== ADMIN_PIN) {
    errEl.textContent = 'PIN Admin salah. Silakan periksa kembali dan coba lagi.';
    errEl.classList.remove('hidden');
    return;
  }

  errEl.classList.add('hidden');
  state.adminUnlocked = true;
  writeStorage(STORAGE_KEYS.ADMIN_AUTH, true);
  closeModal('modal-admin-auth');
  showToast('Berhasil masuk ke Portal Admin.', 'success');
  switchView('admin');
}

function exitAdmin() {
  state.adminUnlocked = false;
  removeStorage(STORAGE_KEYS.ADMIN_AUTH);
  if (state.student) {
    switchView('dashboard');
  } else {
    switchView('login');
  }
}

function renderAdminView() {
  renderAdminResultsTable();
  renderAdminMonitoringTable();
  syncTopicSelectElements();
  renderAiGeneratorPanel();
  renderAdminQuestionList();
  renderAdminSyllabusPanel();
  renderAdminTokenPanel();
}

/* ==================== TOKEN UJIAN & RESET TOKEN ==================== */
function generateRandomTokenCode(length = 6) {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < length; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function loadTokenConfig() {
  const saved = readStorage(STORAGE_KEYS.TOKEN, null);
  if (saved && typeof saved.code === 'string' && saved.code.trim().length >= 4) {
    state.tokenConfig = {
      code: saved.code.trim().toUpperCase(),
      required: saved.required !== false,
      showOnLogin: saved.showOnLogin !== false,
      isActive: saved.isActive !== false,
      autoStopOnAllFinished: saved.autoStopOnAllFinished !== false,
      targetParticipants: Math.max(0, Number(saved.targetParticipants) || 0),
      stoppedAt: saved.stoppedAt || null,
      stoppedReason: saved.stoppedReason || '',
      updatedAt: saved.updatedAt || new Date().toISOString(),
    };
  } else {
    state.tokenConfig = {
      code: generateRandomTokenCode(6),
      required: true,
      showOnLogin: true,
      isActive: true,
      autoStopOnAllFinished: true,
      targetParticipants: 0,
      stoppedAt: null,
      stoppedReason: '',
      updatedAt: new Date().toISOString(),
    };
    writeStorage(STORAGE_KEYS.TOKEN, state.tokenConfig);
  }
}

function getTokenCompletionStats() {
  const allItems = getMergedMonitoringRecords();
  const totalRegistered = allItems.length;
  const activeCount = allItems.filter((i) => i.status === 'Sedang Mengerjakan').length;
  const pendingCount = allItems.filter((i) => i.status === 'Belum Mulai').length;
  const doneCount = allItems.filter((i) => i.status === 'Selesai').length;
  return { totalRegistered, activeCount, pendingCount, doneCount };
}

function evaluateTokenAutoStop() {
  loadTokenConfig();
  if (!state.tokenConfig.autoStopOnAllFinished || state.tokenConfig.isActive === false) {
    return false;
  }

  const { totalRegistered, activeCount, pendingCount, doneCount } = getTokenCompletionStats();
  const target = Math.max(0, Number(state.tokenConfig.targetParticipants) || 0);

  const shouldStop =
    target > 0
      ? doneCount >= target && activeCount === 0
      : totalRegistered > 0 && activeCount === 0 && pendingCount === 0 && doneCount === totalRegistered;

  if (shouldStop) {
    state.tokenConfig = {
      ...state.tokenConfig,
      isActive: false,
      stoppedAt: new Date().toISOString(),
      stoppedReason: 'Seluruh siswa telah selesai mengerjakan soal',
    };
    writeStorage(STORAGE_KEYS.TOKEN, state.tokenConfig);
    renderLoginTokenField();
    if (state.currentView === 'admin') {
      renderAdminTokenPanel();
    }
    return true;
  }

  return false;
}

function renderLoginTokenField() {
  if (!state.tokenConfig) loadTokenConfig();
  const groupEl = document.getElementById('login-token-group');
  const hintEl = document.getElementById('login-token-hint');
  const inputEl = document.getElementById('input-token');
  const stoppedNoteEl = document.getElementById('login-token-stopped-note');
  if (!groupEl || !hintEl || !inputEl) return;

  const { code, required, showOnLogin, isActive } = state.tokenConfig;
  const shouldShowGroup = required || showOnLogin || isActive === false;
  groupEl.classList.toggle('hidden', !shouldShowGroup);
  inputEl.required = Boolean(required);

  if (isActive === false && required) {
    hintEl.textContent = 'Token Dihentikan (Selesai)';
    hintEl.classList.remove('hidden');
    hintEl.classList.add('is-stopped');
    inputEl.disabled = true;
    inputEl.value = '';
    inputEl.placeholder = 'Token dihentikan otomatis';
    if (stoppedNoteEl) {
      stoppedNoteEl.textContent =
        'Token otomatis berhenti karena seluruh siswa telah selesai mengerjakan soal.';
      stoppedNoteEl.classList.remove('hidden');
    }
    return;
  }

  hintEl.classList.remove('is-stopped');
  inputEl.disabled = false;
  inputEl.placeholder = 'Masukkan kode Token Ujian';
  if (stoppedNoteEl) stoppedNoteEl.classList.add('hidden');

  if (showOnLogin) {
    hintEl.textContent = `Token Aktif: ${code}`;
    hintEl.classList.remove('hidden');
  } else if (required) {
    hintEl.textContent = 'Minta token ke pengawas';
    hintEl.classList.remove('hidden');
  } else {
    hintEl.classList.add('hidden');
  }
}

function renderAdminTokenPanel() {
  if (!state.tokenConfig) loadTokenConfig();
  const showcaseEl = document.getElementById('admin-token-showcase');
  const displayEl = document.getElementById('admin-token-display');
  const updatedEl = document.getElementById('admin-token-updated-at');
  const statusEl = document.getElementById('admin-token-status-text');
  const progressEl = document.getElementById('admin-token-progress-text');
  const reactivateBtn = document.getElementById('btn-reactivate-token');
  const reqCheck = document.getElementById('admin-token-required');
  const showCheck = document.getElementById('admin-token-show-on-login');
  const autoStopCheck = document.getElementById('admin-token-auto-stop');
  const targetInput = document.getElementById('admin-token-target-count');
  const customInput = document.getElementById('admin-custom-token-input');

  if (!displayEl) return;

  const isStopped = state.tokenConfig.isActive === false;
  const { totalRegistered, activeCount, doneCount } = getTokenCompletionStats();
  const target = Math.max(0, Number(state.tokenConfig.targetParticipants) || 0);

  if (showcaseEl) showcaseEl.classList.toggle('is-stopped', isStopped);
  if (reactivateBtn) reactivateBtn.classList.toggle('hidden', !isStopped);

  displayEl.textContent = state.tokenConfig.code;
  updatedEl.textContent = isStopped && state.tokenConfig.stoppedAt
    ? `Dihentikan otomatis: ${formatDateTimeID(state.tokenConfig.stoppedAt)}`
    : `Diperbarui: ${formatDateTimeID(state.tokenConfig.updatedAt)}`;

  reqCheck.checked = Boolean(state.tokenConfig.required);
  showCheck.checked = Boolean(state.tokenConfig.showOnLogin);
  if (autoStopCheck) autoStopCheck.checked = Boolean(state.tokenConfig.autoStopOnAllFinished);
  if (targetInput && document.activeElement !== targetInput) {
    targetInput.value = String(target);
  }
  customInput.value = '';

  const reqText = state.tokenConfig.required ? 'Wajib Diisi' : 'Opsional';
  const visText = state.tokenConfig.showOnLogin ? 'Muncul di Layar Login' : 'Disembunyikan di Layar Login';

  if (isStopped) {
    statusEl.className = 'status-text-fail';
    statusEl.textContent = 'Dihentikan Otomatis (Seluruh Siswa Selesai)';
  } else {
    statusEl.className = 'status-text-pass';
    statusEl.textContent = `Aktif · ${reqText} · ${visText}`;
  }

  if (progressEl) {
    progressEl.textContent =
      target > 0
        ? `Progres Selesai: ${doneCount} / ${target} Target Siswa (${activeCount} sedang mengerjakan)`
        : `Progres Selesai: ${doneCount} / ${totalRegistered} Siswa Terdaftar (${activeCount} sedang mengerjakan)`;
  }
}

function handleResetExamToken() {
  openConfirmModal(
    'Reset Token Ujian Baru?',
    'Kode Token Ujian saat ini akan diganti dengan token acak yang baru dan langsung aktif kembali. Token lama tidak lagi berlaku untuk masuk ruang tes.',
    () => {
      state.tokenConfig = {
        ...(state.tokenConfig || {
          required: true,
          showOnLogin: true,
          autoStopOnAllFinished: true,
          targetParticipants: 0,
        }),
        code: generateRandomTokenCode(6),
        isActive: true,
        stoppedAt: null,
        stoppedReason: '',
        updatedAt: new Date().toISOString(),
      };
      writeStorage(STORAGE_KEYS.TOKEN, state.tokenConfig);
      renderAdminTokenPanel();
      renderLoginTokenField();
      showToast(`Token Ujian baru berhasil dibuat dan diaktifkan: ${state.tokenConfig.code}`, 'success');
    }
  );
}

function handleReactivateExamToken() {
  if (!state.tokenConfig) loadTokenConfig();
  state.tokenConfig = {
    ...state.tokenConfig,
    isActive: true,
    stoppedAt: null,
    stoppedReason: '',
    updatedAt: new Date().toISOString(),
  };
  writeStorage(STORAGE_KEYS.TOKEN, state.tokenConfig);
  renderAdminTokenPanel();
  renderLoginTokenField();
  showToast(`Token Ujian ${state.tokenConfig.code} diaktifkan kembali.`, 'success');
}

function handleSaveCustomToken() {
  const raw = document.getElementById('admin-custom-token-input').value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (raw.length < 4 || raw.length > 12) {
    showToast('Token manual harus terdiri dari 4 sampai 12 huruf/angka.', 'error');
    return;
  }

  state.tokenConfig = {
    ...(state.tokenConfig || {
      required: true,
      showOnLogin: true,
      autoStopOnAllFinished: true,
      targetParticipants: 0,
    }),
    code: raw,
    isActive: true,
    stoppedAt: null,
    stoppedReason: '',
    updatedAt: new Date().toISOString(),
  };
  writeStorage(STORAGE_KEYS.TOKEN, state.tokenConfig);
  renderAdminTokenPanel();
  renderLoginTokenField();
  showToast(`Token Ujian manual berhasil disimpan & diaktifkan: ${raw}`, 'success');
}

function handleSaveTokenTargetCount() {
  if (!state.tokenConfig) loadTokenConfig();
  const raw = Number(document.getElementById('admin-token-target-count').value);
  if (Number.isNaN(raw) || raw < 0 || raw > 2000 || !Number.isInteger(raw)) {
    showToast('Target jumlah siswa harus berupa bilangan bulat 0 sampai 2000.', 'error');
    return;
  }

  state.tokenConfig = {
    ...state.tokenConfig,
    targetParticipants: raw,
  };
  writeStorage(STORAGE_KEYS.TOKEN, state.tokenConfig);
  const stoppedNow = evaluateTokenAutoStop();
  renderAdminTokenPanel();
  renderLoginTokenField();
  if (stoppedNow) {
    showToast('Target terpenuhi! Token otomatis dihentikan.', 'success');
  } else {
    showToast(
      raw > 0
        ? `Target otomatis berhenti diatur ke ${raw} siswa selesai.`
        : 'Target otomatis berhenti mengikuti seluruh siswa terdaftar.',
      'success'
    );
  }
}

async function handleCopyExamToken() {
  if (!state.tokenConfig) loadTokenConfig();
  try {
    await navigator.clipboard.writeText(state.tokenConfig.code);
    showToast(`Token ${state.tokenConfig.code} berhasil disalin.`, 'success');
  } catch {
    showToast(`Token aktif: ${state.tokenConfig.code}`, 'success');
  }
}

function handleTokenVisibilityOrRequiredChange() {
  if (!state.tokenConfig) loadTokenConfig();
  const required = document.getElementById('admin-token-required').checked;
  const showOnLogin = document.getElementById('admin-token-show-on-login').checked;
  const autoStopOnAllFinished = document.getElementById('admin-token-auto-stop').checked;

  state.tokenConfig = {
    ...state.tokenConfig,
    required,
    showOnLogin,
    autoStopOnAllFinished,
    updatedAt: state.tokenConfig.updatedAt || new Date().toISOString(),
  };
  writeStorage(STORAGE_KEYS.TOKEN, state.tokenConfig);
  evaluateTokenAutoStop();
  renderAdminTokenPanel();
  renderLoginTokenField();
  showToast('Pengaturan Token Ujian disimpan.', 'success');
}

/* ==================== MONITORING PROGRES PER SISWA ==================== */
function upsertMonitoringRecord(student, patch = {}) {
  if (!student) return;
  const latestList = readStorage(STORAGE_KEYS.MONITORING, []);
  const list = Array.isArray(latestList) ? [...latestList] : [];

  const idx = list.findIndex((entry) => identityMatchesEntry(entry, student));
  const existing = idx >= 0 ? list[idx] : {};

  const updated = {
    ...existing,
    nama: student.nama || existing.nama || '-',
    username: student.username || existing.username || '-',
    nisn: student.nisn || existing.nisn || '-',
    absen: String(student.absen || existing.absen || '-'),
    ...patch,
    lastActivityAt: patch.lastActivityAt || Date.now(),
  };

  if (idx >= 0) {
    list[idx] = updated;
  } else {
    list.push(updated);
  }

  state.monitoring = list;
  writeStorage(STORAGE_KEYS.MONITORING, list);
}

function syncSessionToMonitoring(statusLabel = 'Sedang Mengerjakan') {
  if (!state.student || !state.session) return;
  const total = state.session.questionOrder.length;
  const answered = countAnsweredQuestions(state.session);
  const pct = total > 0 ? Math.round((answered / total) * 100) : 0;

  upsertMonitoringRecord(state.student, {
    status: statusLabel,
    answeredCount: answered,
    totalQuestions: total,
    percentage: pct,
    currentNumber: (state.session.currentIndex || 0) + 1,
    flaggedCount: Object.keys(state.session.flagged || {}).length,
    startTime: state.session.startTime,
    endTime: state.session.endTime,
    lastActivityAt: Date.now(),
  });
}

function startMonitoringRefreshLoop() {
  if (state.monitoringIntervalId) {
    clearInterval(state.monitoringIntervalId);
  }
  state.monitoringIntervalId = setInterval(() => {
    if (state.currentView === 'admin' && state.adminTab === 'monitoring') {
      renderAdminMonitoringTable();
    }
  }, 2000);
}

function getMergedMonitoringRecords() {
  const storedMonitoring = readStorage(STORAGE_KEYS.MONITORING, []);
  const resultsList = readStorage(STORAGE_KEYS.RESULTS, []);
  const usedList = readStorage(STORAGE_KEYS.USED_IDENTITIES, []);
  const activeSession = readStorage(STORAGE_KEYS.SESSION, null);
  const activeStudent = readStorage(STORAGE_KEYS.STUDENT, null);

  state.monitoring = Array.isArray(storedMonitoring) ? storedMonitoring : [];
  state.results = Array.isArray(resultsList) ? resultsList : [];
  state.usedIdentities = Array.isArray(usedList) ? usedList : [];

  const merged = [...state.monitoring];

  // Ensure all registered identities appear even if created prior to monitoring feature
  state.usedIdentities.forEach((u) => {
    const exists = merged.some((m) => identityMatchesEntry(m, u));
    if (!exists) {
      merged.push({
        nama: u.nama,
        username: u.username,
        nisn: u.nisn,
        absen: u.absen || '-',
        status: 'Belum Mulai',
        answeredCount: 0,
        totalQuestions: getActiveStudentQuestions().length,
        percentage: 0,
        currentNumber: 0,
        flaggedCount: 0,
        lastActivityAt: u.registeredAt || Date.now(),
      });
    }
  });

  // Ensure active session in storage reflects latest answered count
  if (activeSession && activeStudent) {
    const total = Array.isArray(activeSession.questionOrder) ? activeSession.questionOrder.length : state.questions.length;
    const answered = countAnsweredQuestions(activeSession);
    const pct = total > 0 ? Math.round((answered / total) * 100) : 0;
    const idx = merged.findIndex((m) => identityMatchesEntry(m, activeStudent));
    const sessionPatch = {
      nama: activeStudent.nama,
      username: activeStudent.username,
      nisn: activeStudent.nisn,
      absen: activeStudent.absen || '-',
      status: 'Sedang Mengerjakan',
      answeredCount: answered,
      totalQuestions: total,
      percentage: pct,
      currentNumber: (activeSession.currentIndex || 0) + 1,
      flaggedCount: Object.keys(activeSession.flagged || {}).length,
      startTime: activeSession.startTime,
      endTime: activeSession.endTime,
    };
    if (idx >= 0 && merged[idx].status !== 'Selesai') {
      merged[idx] = { ...merged[idx], ...sessionPatch };
    } else if (idx < 0) {
      merged.push({ ...sessionPatch, lastActivityAt: activeSession.startTime || Date.now() });
    }
  }

  // Ensure completed results always override status to 'Selesai'
  state.results.forEach((r) => {
    const total = r.totalQuestions || state.questions.length;
    const answered =
      typeof r.answeredCount === 'number'
        ? r.answeredCount
        : Array.isArray(r.details)
          ? r.details.filter((d) => d.userAnswerText && d.userAnswerText !== '(Tidak dijawab)').length
          : total;
    const pct = total > 0 ? Math.round((answered / total) * 100) : 0;

    const idx = merged.findIndex((m) => identityMatchesEntry(m, r));
    const donePatch = {
      nama: r.nama,
      username: r.username,
      nisn: r.nisn,
      absen: r.absen || '-',
      status: 'Selesai',
      answeredCount: answered,
      totalQuestions: total,
      percentage: pct,
      currentNumber: total,
      completedAt: r.completedAt,
      lastActivityAt: r.completedAt ? new Date(r.completedAt).getTime() : Date.now(),
    };

    if (idx >= 0) {
      merged[idx] = { ...merged[idx], ...donePatch };
    } else {
      merged.push(donePatch);
    }
  });

  return merged;
}

function formatRemainingTimeLabel(item) {
  if (item.status === 'Selesai') {
    return item.completedAt ? `Selesai (${formatDateTimeID(item.completedAt)})` : 'Sudah dikumpulkan';
  }
  if (item.status === 'Sedang Mengerjakan') {
    const posText = item.currentNumber ? `Soal #${item.currentNumber}` : 'Aktif';
    if (item.endTime) {
      const remMs = item.endTime - Date.now();
      if (remMs <= 0) return `${posText} · Waktu Habis`;
      const totalSec = Math.ceil(remMs / 1000);
      const mins = Math.floor(totalSec / 60);
      const secs = totalSec % 60;
      return `${posText} · Sisa ${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
    return posText;
  }
  return 'Di Dashboard (Belum Mulai)';
}

function renderAdminMonitoringTable() {
  const tbody = document.getElementById('admin-monitoring-tbody');
  if (!tbody) return;

  const allItems = getMergedMonitoringRecords();

  // KPIs
  const totalCount = allItems.length;
  const activeCount = allItems.filter((i) => i.status === 'Sedang Mengerjakan').length;
  const doneCount = allItems.filter((i) => i.status === 'Selesai').length;
  const avgPct =
    totalCount > 0
      ? Math.round(allItems.reduce((sum, i) => sum + Number(i.percentage || 0), 0) / totalCount)
      : 0;

  document.getElementById('mon-kpi-total').textContent = String(totalCount);
  document.getElementById('mon-kpi-active').textContent = String(activeCount);
  document.getElementById('mon-kpi-done').textContent = String(doneCount);
  document.getElementById('mon-kpi-avg-progress').textContent = `${avgPct}%`;

  const search = (document.getElementById('admin-monitoring-search')?.value || '').trim().toLowerCase();
  const statusFilter = document.getElementById('admin-monitoring-filter-status')?.value || 'all';

  const filtered = allItems.filter((item) => {
    const matchSearch =
      !search ||
      String(item.nama || '').toLowerCase().includes(search) ||
      String(item.nisn || '').toLowerCase().includes(search) ||
      String(item.absen || '').toLowerCase().includes(search) ||
      String(item.username || '').toLowerCase().includes(search);
    const matchStatus = statusFilter === 'all' || item.status === statusFilter;
    return matchSearch && matchStatus;
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="9" class="empty-state">
          Belum ada data monitoring siswa yang sesuai. Data muncul otomatis saat siswa masuk atau mengerjakan tes.
        </td>
      </tr>
    `;
    return;
  }

  // Sort: Sedang Mengerjakan first, then Belum Mulai, then Selesai; newest activity first
  const statusRank = { 'Sedang Mengerjakan': 0, 'Belum Mulai': 1, Selesai: 2 };
  const sorted = [...filtered].sort((a, b) => {
    const rankDiff = (statusRank[a.status] ?? 9) - (statusRank[b.status] ?? 9);
    if (rankDiff !== 0) return rankDiff;
    return Number(b.lastActivityAt || 0) - Number(a.lastActivityAt || 0);
  });

  tbody.innerHTML = sorted
    .map((item, idx) => {
      const answered = Number(item.answeredCount || 0);
      const total = Number(item.totalQuestions || state.questions.length || 0);
      const pct = Number(item.percentage || 0);

      let statusClass = 'status-text-pending';
      if (item.status === 'Selesai') statusClass = 'status-text-pass';
      else if (item.status === 'Sedang Mengerjakan') statusClass = 'status-text-active';

      const lastTime = item.lastActivityAt
        ? new Date(item.lastActivityAt).toLocaleTimeString('id-ID', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          })
        : '-';

      return `
        <tr>
          <td class="mono-text">${idx + 1}</td>
          <td>
            <strong>${escapeHtml(item.nama)}</strong>
            <span class="mon-student-sub">@${escapeHtml(item.username)}</span>
          </td>
          <td class="mono-text">${escapeHtml(item.nisn)}</td>
          <td class="mono-text">${escapeHtml(item.absen || '-')}</td>
          <td><span class="${statusClass}">${escapeHtml(item.status)}</span></td>
          <td class="mono-text"><strong>${answered}</strong> / ${total} Soal</td>
          <td>
            <div class="mon-progress-cell">
              <div class="mon-progress-track" aria-label="Progres ${pct}%">
                <div class="mon-progress-fill${item.status === 'Selesai' ? ' is-done' : ''}" style="width: ${Math.min(100, Math.max(0, pct))}%"></div>
              </div>
              <span class="mono-text mon-progress-pct">${pct}%</span>
            </div>
          </td>
          <td class="mono-text">${escapeHtml(formatRemainingTimeLabel(item))}</td>
          <td class="mono-text">${escapeHtml(lastTime)}</td>
        </tr>
      `;
    })
    .join('');
}

function renderAdminSyllabusPanel() {
  if (!state.settings) loadExamSettings();
  document.getElementById('admin-set-subject').value = state.settings.subject;
  document.getElementById('admin-set-main-topic').value = state.settings.mainTopic;
  document.getElementById('admin-set-duration').value = state.settings.durationMinutes;
  state.draftSyllabusItems = [...state.settings.syllabusItems];
  renderSyllabusSavedSummary();
  renderAdminSyllabusList();
  updateSyllabusDirtyState();
}

function renderSyllabusSavedSummary() {
  if (!state.settings) loadExamSettings();
  const savedSub = document.getElementById('syllabus-saved-subject');
  const savedDur = document.getElementById('syllabus-saved-duration');
  const savedTopic = document.getElementById('syllabus-saved-topic');
  if (savedSub) savedSub.textContent = state.settings.subject;
  if (savedDur) savedDur.textContent = `${state.settings.durationMinutes} Menit`;
  if (savedTopic) savedTopic.textContent = state.settings.mainTopic;
}

function isSyllabusDirty() {
  if (!state.settings) return false;
  const subjectVal = (document.getElementById('admin-set-subject')?.value || '').trim();
  const mainTopicVal = (document.getElementById('admin-set-main-topic')?.value || '').trim();
  const durationVal = Number(document.getElementById('admin-set-duration')?.value);
  const draftItems = state.draftSyllabusItems.map((s) => s.trim());
  const savedItems = state.settings.syllabusItems.map((s) => s.trim());

  if (subjectVal !== state.settings.subject) return true;
  if (mainTopicVal !== state.settings.mainTopic) return true;
  if (durationVal !== state.settings.durationMinutes) return true;
  if (draftItems.length !== savedItems.length) return true;
  return draftItems.some((item, idx) => item !== savedItems[idx]);
}

function updateSyllabusDirtyState() {
  const dirty = isSyllabusDirty();
  const badge = document.getElementById('syllabus-dirty-badge');
  const cancelBtn = document.getElementById('btn-cancel-syllabus-edit');
  if (badge) {
    badge.textContent = dirty ? 'Perubahan belum disimpan' : 'Tersimpan';
    badge.classList.toggle('is-dirty', dirty);
    badge.classList.toggle('is-saved', !dirty);
  }
  if (cancelBtn) {
    cancelBtn.classList.toggle('hidden', !dirty);
  }
}

function handleCancelSyllabusEdit() {
  renderAdminSyllabusPanel();
  showToast('Perubahan yang belum disimpan dibatalkan.', 'default');
}

function renderAdminSyllabusList() {
  const container = document.getElementById('admin-syllabus-list');
  if (!container) return;

  if (state.draftSyllabusItems.length === 0) {
    container.innerHTML = '<div class="empty-state">Belum ada butir cakupan materi. Tambahkan minimal satu poin di bawah ini.</div>';
    return;
  }

  container.innerHTML = state.draftSyllabusItems
    .map(
      (item, idx) => `
    <div class="syllabus-editor-row">
      <span class="syllabus-row-num">${idx + 1}.</span>
      <input
        type="text"
        class="form-input input-compact"
        data-syllabus-input="${idx}"
        value="${escapeHtml(item)}"
        aria-label="Poin cakupan materi ${idx + 1}"
      />
      <div class="syllabus-row-actions">
        <button type="button" class="btn btn-outline btn-sm" data-syllabus-up="${idx}" ${idx === 0 ? 'disabled' : ''} aria-label="Pindah ke atas">↑</button>
        <button type="button" class="btn btn-outline btn-sm" data-syllabus-down="${idx}" ${idx === state.draftSyllabusItems.length - 1 ? 'disabled' : ''} aria-label="Pindah ke bawah">↓</button>
        <button type="button" class="btn btn-outline btn-sm btn-danger-outline" data-syllabus-del="${idx}">Hapus</button>
      </div>
    </div>
  `
    )
    .join('');

  container.querySelectorAll('[data-syllabus-input]').forEach((input) => {
    input.addEventListener('input', (e) => {
      const idx = Number(e.target.dataset.syllabusInput);
      state.draftSyllabusItems[idx] = e.target.value;
      updateSyllabusDirtyState();
    });
  });

  container.querySelectorAll('[data-syllabus-up]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.syllabusUp);
      if (idx > 0) {
        [state.draftSyllabusItems[idx - 1], state.draftSyllabusItems[idx]] = [
          state.draftSyllabusItems[idx],
          state.draftSyllabusItems[idx - 1],
        ];
        renderAdminSyllabusList();
        updateSyllabusDirtyState();
      }
    });
  });

  container.querySelectorAll('[data-syllabus-down]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.syllabusDown);
      if (idx < state.draftSyllabusItems.length - 1) {
        [state.draftSyllabusItems[idx + 1], state.draftSyllabusItems[idx]] = [
          state.draftSyllabusItems[idx],
          state.draftSyllabusItems[idx + 1],
        ];
        renderAdminSyllabusList();
        updateSyllabusDirtyState();
      }
    });
  });

  container.querySelectorAll('[data-syllabus-del]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.syllabusDel);
      state.draftSyllabusItems.splice(idx, 1);
      renderAdminSyllabusList();
      updateSyllabusDirtyState();
    });
  });
}

function handleAddSyllabusItem() {
  const input = document.getElementById('admin-new-syllabus-item');
  const text = input.value.trim();
  if (!text) {
    showToast('Tuliskan poin cakupan materi terlebih dahulu.', 'error');
    return;
  }
  state.draftSyllabusItems.push(text);
  input.value = '';
  renderAdminSyllabusList();
  updateSyllabusDirtyState();
}

function handleSaveSyllabus(e) {
  if (e && typeof e.preventDefault === 'function') {
    e.preventDefault();
  }

  const subject = document.getElementById('admin-set-subject').value.trim();
  const mainTopic = document.getElementById('admin-set-main-topic').value.trim();
  const durationMinutes = Number(document.getElementById('admin-set-duration').value);
  const cleanedItems = state.draftSyllabusItems.map((s) => s.trim()).filter(Boolean);

  if (!subject || !mainTopic) {
    showToast('Mata Pelajaran dan Materi Pokok tidak boleh kosong.', 'error');
    return;
  }
  if (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 600) {
    showToast('Waktu Ujian harus berupa bilangan bulat antara 1 sampai 600 menit.', 'error');
    return;
  }
  if (cleanedItems.length === 0) {
    showToast('Minimal harus ada satu butir cakupan materi ujian.', 'error');
    return;
  }

  state.settings = {
    subject,
    mainTopic,
    durationMinutes,
    syllabusItems: cleanedItems,
  };
  writeStorage(STORAGE_KEYS.SETTINGS, state.settings);
  state.draftSyllabusItems = [...cleanedItems];

  renderSyllabusSavedSummary();
  renderAdminSyllabusList();
  updateSyllabusDirtyState();
  syncTopicSelectElements();
  renderAiGeneratorPanel();
  applySettingsToUI();
  showToast('Pengaturan Mata Pelajaran, Waktu Ujian, dan Materi Pokok berhasil disimpan.', 'success');
}

function getFilteredAdminResults() {
  const query = (document.getElementById('admin-result-search').value || '').trim().toLowerCase();
  const results = state.results || [];
  return results.filter(
    (r) =>
      r.nama.toLowerCase().includes(query) ||
      String(r.nisn).toLowerCase().includes(query) ||
      String(r.absen || '').toLowerCase().includes(query) ||
      String(r.nomorUrut).includes(query)
  );
}

function exportResultsToCsv() {
  const rowsData = getFilteredAdminResults();
  if (rowsData.length === 0) {
    showToast('Belum ada data hasil penilaian untuk diekspor.', 'error');
    return;
  }

  const headers = [
    'No. Urut',
    'Nama Lengkap Siswa',
    'Kelas',
    'Nomor Absen',
    'Username',
    'Mata Pelajaran',
    'Skor',
    'Jumlah Benar',
    'Jumlah Salah',
    'Total Soal',
    'Persentase (%)',
    'Status',
    'Waktu Selesai',
  ];

  const subject = state.settings?.subject || DEFAULT_SETTINGS.subject;
  const csvEscape = (val) => `"${String(val ?? '').replace(/"/g, '""')}"`;

  const lines = [
    headers.map(csvEscape).join(','),
    ...rowsData.map((r) =>
      [
        r.nomorUrut,
        r.nama,
        r.nisn,
        r.absen || '-',
        r.username || '-',
        subject,
        r.score,
        r.correctCount,
        r.wrongCount,
        r.totalQuestions,
        `${r.percentage}%`,
        r.status,
        formatDateTimeID(r.completedAt),
      ]
        .map(csvEscape)
        .join(',')
    ),
  ];

  const bom = '\uFEFF';
  const blob = new Blob([bom + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const dateTag = new Date().toISOString().slice(0, 10);
  triggerFileDownload(blob, `Hasil_Penilaian_CBT_MAZRO_${dateTag}.csv`);
  showToast(`Berhasil mengekspor ${rowsData.length} data hasil ke CSV (Spreadsheet).`, 'success');
}

function exportResultsToExcel() {
  const rowsData = getFilteredAdminResults();
  if (rowsData.length === 0) {
    showToast('Belum ada data hasil penilaian untuk diekspor.', 'error');
    return;
  }

  const subject = state.settings?.subject || DEFAULT_SETTINGS.subject;
  const mainTopic = state.settings?.mainTopic || DEFAULT_SETTINGS.mainTopic;
  const avgScore = (rowsData.reduce((s, r) => s + Number(r.score), 0) / rowsData.length).toFixed(2);
  const passCount = rowsData.filter((r) => r.score >= PASSING_GRADE).length;

  const tableRowsHtml = rowsData
    .map(
      (r) => `
      <tr>
        <td style="text-align:center;">${r.nomorUrut}</td>
        <td>${escapeHtml(r.nama)}</td>
        <td style="text-align:center; mso-number-format:'\\@';">${escapeHtml(r.nisn)}</td>
        <td style="text-align:center;">${escapeHtml(r.absen || '-')}</td>
        <td>${escapeHtml(r.username || '-')}</td>
        <td style="text-align:center; font-weight:bold;">${r.score}</td>
        <td style="text-align:center;">${r.correctCount}</td>
        <td style="text-align:center;">${r.wrongCount}</td>
        <td style="text-align:center;">${r.totalQuestions}</td>
        <td style="text-align:center;">${r.percentage}%</td>
        <td style="text-align:center; font-weight:bold; color:${r.score >= PASSING_GRADE ? '#047857' : '#b91c1c'};">${escapeHtml(r.status)}</td>
        <td>${escapeHtml(formatDateTimeID(r.completedAt))}</td>
      </tr>
    `
    )
    .join('');

  const excelHtml = `
    <html xmlns:o="urn:schemas-microsoft-com:office:office"
          xmlns:x="urn:schemas-microsoft-com:office:excel"
          xmlns="http://www.w3.org/TR/REC-html40">
      <head>
        <meta charset="UTF-8" />
        <style>
          body { font-family: Calibri, Arial, sans-serif; font-size: 11pt; }
          .title { font-size: 14pt; font-weight: bold; color: #1d4ed8; }
          .meta { font-size: 10pt; color: #334155; }
          table.report { border-collapse: collapse; width: 100%; margin-top: 10px; }
          table.report th {
            background-color: #1d4ed8;
            color: #ffffff;
            font-weight: bold;
            border: 1px solid #cbd5e1;
            padding: 8px 10px;
            text-align: center;
          }
          table.report td {
            border: 1px solid #cbd5e1;
            padding: 6px 10px;
          }
          .summary-row td {
            background-color: #eff6ff;
            font-weight: bold;
          }
        </style>
      </head>
      <body>
        <table>
          <tr><td colspan="12" class="title">CBT ONLINE MAZRO - LAPORAN HASIL PENILAIAN SISWA</td></tr>
          <tr><td colspan="12" class="meta">Mata Pelajaran: ${escapeHtml(subject)} | Materi: ${escapeHtml(mainTopic)}</td></tr>
          <tr><td colspan="12" class="meta">Tanggal Ekspor: ${escapeHtml(formatDateTimeID(new Date().toISOString()))} | Total Peserta: ${rowsData.length} | Lulus (≥75): ${passCount} | Rata-rata Nilai: ${avgScore}</td></tr>
        </table>
        <table class="report">
          <thead>
            <tr>
              <th>No. Urut</th>
              <th>Nama Lengkap Siswa</th>
              <th>Kelas</th>
              <th>Nomor Absen</th>
              <th>Username</th>
              <th>Skor</th>
              <th>Benar</th>
              <th>Salah</th>
              <th>Total Soal</th>
              <th>Persentase</th>
              <th>Status</th>
              <th>Waktu Selesai</th>
            </tr>
          </thead>
          <tbody>
            ${tableRowsHtml}
            <tr class="summary-row">
              <td colspan="5" style="text-align:right;">Rata-rata Nilai / Total Lulus:</td>
              <td style="text-align:center;">${avgScore}</td>
              <td colspan="4" style="text-align:center;">Lulus: ${passCount} dari ${rowsData.length} Peserta</td>
              <td colspan="2"></td>
            </tr>
          </tbody>
        </table>
      </body>
    </html>
  `;

  const blob = new Blob(['\uFEFF' + excelHtml], { type: 'application/vnd.ms-excel;charset=utf-8;' });
  const dateTag = new Date().toISOString().slice(0, 10);
  triggerFileDownload(blob, `Hasil_Penilaian_CBT_MAZRO_${dateTag}.xls`);
  showToast(`Berhasil mengekspor ${rowsData.length} data hasil ke Excel (.xls).`, 'success');
}

function renderAdminResultsTable() {
  const results = state.results || [];

  // KPIs
  const total = results.length;
  const avg = total > 0 ? (results.reduce((sum, r) => sum + Number(r.score), 0) / total).toFixed(1) : '0';
  const passCount = results.filter((r) => r.score >= PASSING_GRADE).length;
  const passRate = total > 0 ? `${Math.round((passCount / total) * 100)}%` : '0%';

  document.getElementById('kpi-total-peserta').textContent = String(total);
  document.getElementById('kpi-avg-score').textContent = String(avg);
  document.getElementById('kpi-pass-count').textContent = String(passCount);
  document.getElementById('kpi-pass-rate').textContent = passRate;

  const filtered = getFilteredAdminResults();

  const tbody = document.getElementById('admin-results-tbody');
  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="10" class="empty-state">
          Belum ada data hasil ujian siswa. Data otomatis muncul setelah siswa menyelesaikan tes.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = [...filtered]
    .reverse()
    .map(
      (r) => `
    <tr>
      <td class="mono-text">#${r.nomorUrut}</td>
      <td><strong>${escapeHtml(r.nama)}</strong></td>
      <td class="mono-text">${escapeHtml(r.nisn)}</td>
      <td class="mono-text">${escapeHtml(r.absen || '-')}</td>
      <td class="mono-text"><strong>${r.score}</strong></td>
      <td class="mono-text">${r.correctCount}</td>
      <td class="mono-text">${r.wrongCount}</td>
      <td class="mono-text">${r.percentage}%</td>
      <td>
        <span class="${r.score >= PASSING_GRADE ? 'status-text-pass' : 'status-text-fail'}">
          ${r.score >= PASSING_GRADE ? 'Lulus (≥75)' : 'Belum Lulus (<75)'}
        </span>
      </td>
      <td>
        <button type="button" class="btn btn-outline btn-sm" data-view-result="${r.id}">
          Lihat Halaman Hasil
        </button>
      </td>
    </tr>
  `
    )
    .join('');

  tbody.querySelectorAll('[data-view-result]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = state.results.find((r) => r.id === btn.dataset.viewResult);
      if (target) {
        state.activeResult = target;
        state.resultOpenedFromAdmin = true;
        state.resultFilter = 'all';
        switchView('result');
      }
    });
  });
}

function getDraftSelectedQuestionIdSet() {
  if (!state.draftStudentQuestionConfig) loadStudentQuestionConfig();
  if (state.draftStudentQuestionConfig.mode === 'all') {
    return new Set(state.questions.map((q) => q.id));
  }
  if (state.draftStudentQuestionConfig.mode === 'preset50') {
    return new Set(getDefaultStudentQuestionIds());
  }
  return new Set(state.draftStudentQuestionConfig.selectedIds || []);
}

function isStudentQuestionConfigDirty() {
  if (!state.studentQuestionConfig || !state.draftStudentQuestionConfig) return false;
  if (state.studentQuestionConfig.mode !== state.draftStudentQuestionConfig.mode) return true;
  if (state.studentQuestionConfig.orderMode !== state.draftStudentQuestionConfig.orderMode) return true;
  if (state.draftStudentQuestionConfig.mode === 'custom') {
    const savedSet = new Set(state.studentQuestionConfig.selectedIds || []);
    const draftSet = new Set(state.draftStudentQuestionConfig.selectedIds || []);
    if (savedSet.size !== draftSet.size) return true;
    for (const id of savedSet) {
      if (!draftSet.has(id)) return true;
    }
  }
  return false;
}

function updateStudentQuestionDirtyState() {
  const dirty = isStudentQuestionConfigDirty();
  const badge = document.getElementById('student-q-dirty-badge');
  const cancelBtn = document.getElementById('btn-cancel-student-q');
  if (badge) {
    badge.textContent = dirty ? 'Perubahan belum disimpan' : 'Tersimpan';
    badge.classList.toggle('is-dirty', dirty);
    badge.classList.toggle('is-saved', !dirty);
  }
  if (cancelBtn) {
    cancelBtn.classList.toggle('hidden', !dirty);
  }
}

function renderStudentQuestionMenu() {
  if (!state.studentQuestionConfig) loadStudentQuestionConfig();
  const draft = state.draftStudentQuestionConfig;
  const activeSet = getDraftSelectedQuestionIdSet();

  const countEl = document.getElementById('admin-student-q-count');
  const totalEl = document.getElementById('admin-student-q-total');
  const allCountEl = document.getElementById('student-q-all-count');
  if (countEl) countEl.textContent = String(activeSet.size);
  if (totalEl) totalEl.textContent = String(state.questions.length);
  if (allCountEl) allCountEl.textContent = String(state.questions.length);

  document.querySelectorAll('input[name="student-q-mode"]').forEach((radio) => {
    radio.checked = radio.value === draft.mode;
  });

  const orderSel = document.getElementById('student-q-order-mode');
  if (orderSel) orderSel.value = draft.orderMode || 'shuffle';

  const randomInput = document.getElementById('student-q-random-count');
  if (randomInput) {
    randomInput.max = String(Math.max(1, state.questions.length));
    if (!randomInput.value) {
      randomInput.value = String(Math.min(DEFAULT_STUDENT_QUESTION_COUNT, state.questions.length));
    }
  }

  updateStudentQuestionDirtyState();
}

function handleRandomPickStudentQuestions() {
  const input = document.getElementById('student-q-random-count');
  const count = Number(input?.value);
  const maxTotal = state.questions.length;
  if (!Number.isInteger(count) || count < 1 || count > maxTotal) {
    showToast(`Masukkan jumlah soal acak antara 1 sampai ${maxTotal}.`, 'error');
    return;
  }
  const picked = shuffleArray(state.questions.map((q) => q.id)).slice(0, count);
  state.draftStudentQuestionConfig.mode = 'custom';
  state.draftStudentQuestionConfig.selectedIds = picked;
  renderStudentQuestionMenu();
  renderAdminQuestionList();
  showToast(`${count} soal dipilih acak dalam draf. Klik Simpan Perubahan untuk menerapkan.`, 'default');
}

function handleCancelStudentQuestionsConfig() {
  if (!state.studentQuestionConfig) loadStudentQuestionConfig();
  state.draftStudentQuestionConfig = {
    mode: state.studentQuestionConfig.mode,
    selectedIds: [...(state.studentQuestionConfig.selectedIds || [])],
    orderMode: state.studentQuestionConfig.orderMode || 'shuffle',
  };
  renderStudentQuestionMenu();
  renderAdminQuestionList();
  showToast('Perubahan soal siswa yang belum disimpan dibatalkan.', 'default');
}

function handleSaveStudentQuestionsConfig() {
  if (!state.draftStudentQuestionConfig) loadStudentQuestionConfig();
  const validIds = new Set(state.questions.map((q) => q.id));
  const cleanedIds = (state.draftStudentQuestionConfig.selectedIds || []).filter((id) => validIds.has(id));
  const mode = state.draftStudentQuestionConfig.mode;

  if (mode === 'custom' && cleanedIds.length === 0) {
    showToast('Pilih minimal 1 soal yang akan dikerjakan oleh siswa sebelum menyimpan.', 'error');
    return;
  }

  let finalIds = cleanedIds;
  if (mode === 'all') {
    finalIds = state.questions.map((q) => q.id);
  } else if (mode === 'preset50') {
    finalIds = getDefaultStudentQuestionIds();
  }

  state.studentQuestionConfig = {
    mode,
    selectedIds: finalIds,
    orderMode: state.draftStudentQuestionConfig.orderMode === 'ordered' ? 'ordered' : 'shuffle',
    version: 2,
    userCustomized: true,
    updatedAt: new Date().toISOString(),
  };

  writeStorage(STORAGE_KEYS.STUDENT_QUESTIONS, state.studentQuestionConfig);
  state.draftStudentQuestionConfig = {
    mode: state.studentQuestionConfig.mode,
    selectedIds: [...state.studentQuestionConfig.selectedIds],
    orderMode: state.studentQuestionConfig.orderMode,
  };

  // Clear unfinished draft session so new question set takes effect cleanly
  if (state.session) {
    removeStorage(STORAGE_KEYS.SESSION);
    state.session = null;
  }

  renderStudentQuestionMenu();
  renderAdminQuestionList();
  updateGlobalMetaCounts();
  updateTopbar();

  const activeCount = getActiveStudentQuestions().length;
  showToast(`Perubahan soal untuk siswa berhasil disimpan (${activeCount} soal aktif).`, 'success');
}

function resetStudentQuestionConfigToDefault() {
  const defaultIds = getDefaultStudentQuestionIds();
  state.studentQuestionConfig = {
    mode: 'preset50',
    selectedIds: defaultIds,
    orderMode: state.studentQuestionConfig?.orderMode || 'shuffle',
    version: 2,
    userCustomized: false,
    updatedAt: new Date().toISOString(),
  };
  state.draftStudentQuestionConfig = {
    mode: 'preset50',
    selectedIds: [...defaultIds],
    orderMode: state.studentQuestionConfig.orderMode,
  };
  writeStorage(STORAGE_KEYS.STUDENT_QUESTIONS, state.studentQuestionConfig);
}

function getFilteredAdminQuestions() {
  const search = (document.getElementById('admin-q-search').value || '').trim().toLowerCase();
  const typeFilter = document.getElementById('admin-q-filter-type').value;
  const topicFilter = document.getElementById('admin-q-filter-topic').value;
  const statusFilter = document.getElementById('admin-q-filter-student-status')?.value || 'all';
  const activeSet = getDraftSelectedQuestionIdSet();

  const list = state.questions.filter((q) => {
    const matchSearch = !search || q.question.toLowerCase().includes(search) || q.id.toLowerCase().includes(search);
    const matchType = typeFilter === 'all' || q.type === typeFilter;
    const matchTopic = topicFilter === 'all' || q.topic === topicFilter;
    const isSelected = activeSet.has(q.id);
    const matchStatus =
      statusFilter === 'all' ||
      (statusFilter === 'active' && isSelected) ||
      (statusFilter === 'excluded' && !isSelected);
    return matchSearch && matchType && matchTopic && matchStatus;
  });

  return {
    list,
    meta: {
      search,
      type: typeFilter,
      topic: topicFilter,
    },
  };
}

function getAvailableTopics(extraTopic = '') {
  const seen = new Set();
  const list = [];
  const addTopic = (t) => {
    const cleaned = String(t || '').trim();
    if (cleaned && !seen.has(cleaned)) {
      seen.add(cleaned);
      list.push(cleaned);
    }
  };

  (state.settings?.syllabusItems || []).forEach(addTopic);
  (state.questions || []).forEach((q) => addTopic(q.topic));
  if (extraTopic) addTopic(extraTopic);
  if (list.length === 0) TOPICS.forEach(addTopic);
  return list;
}

function syncTopicSelectElements(extraTopic = '') {
  const available = getAvailableTopics(extraTopic);

  const filterSel = document.getElementById('admin-q-filter-topic');
  if (filterSel) {
    const prevVal = filterSel.value || 'all';
    filterSel.innerHTML = [
      '<option value="all">Semua Materi</option>',
      ...available.map((t) => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`),
    ].join('');
    filterSel.value = prevVal === 'all' || available.includes(prevVal) ? prevVal : 'all';
  }

  const editSel = document.getElementById('edit-q-topic');
  if (editSel) {
    const prevEditVal = editSel.value;
    editSel.innerHTML = available
      .map((t) => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`)
      .join('');
    if (prevEditVal && available.includes(prevEditVal)) {
      editSel.value = prevEditVal;
    }
  }
}

function renderAdminQuestionList() {
  document.getElementById('admin-q-count').textContent = String(state.questions.length);
  syncTopicSelectElements();
  renderStudentQuestionMenu();

  const { list: filtered } = getFilteredAdminQuestions();
  const activeSet = getDraftSelectedQuestionIdSet();

  const listEl = document.getElementById('admin-question-list');
  if (filtered.length === 0) {
    listEl.innerHTML = '<div class="empty-state">Tidak ada soal yang sesuai dengan filter pencarian.</div>';
    return;
  }

  listEl.innerHTML = filtered
    .map((q, index) => {
      const isSelected = activeSet.has(q.id);
      return `
    <div class="admin-q-item${isSelected ? '' : ' is-excluded'}">
      <div class="admin-q-content">
        <div class="admin-q-meta">
          <span class="mono-text"><strong>${escapeHtml(q.id)}</strong></span>
          <span>·</span>
          <span>No. ${index + 1}</span>
          <span>·</span>
          <span>${escapeHtml(TYPE_LABELS[q.type] || q.type)}</span>
          <span>·</span>
          <span>${escapeHtml(q.topic)}</span>
          ${isSelected ? '' : '<span class="q-excluded-tag">Tidak Diujikan</span>'}
        </div>
        <p class="admin-q-text">${escapeHtml(q.question)}</p>
        <div class="admin-q-answer">
          Kunci Jawaban: <span class="mono-text">${escapeHtml(formatCorrectAnswerWithDetail(q))}</span>
        </div>
      </div>
      <div class="admin-q-actions">
        <label class="q-student-toggle">
          <input type="checkbox" data-toggle-student-q="${escapeHtml(q.id)}" ${isSelected ? 'checked' : ''} />
          <span>Dikerjakan Siswa</span>
        </label>
        <button type="button" class="btn btn-outline btn-sm" data-edit-q="${escapeHtml(q.id)}">Edit Soal / Kunci</button>
        <button type="button" class="btn btn-outline btn-sm btn-danger-outline" data-delete-q="${escapeHtml(q.id)}">Hapus</button>
      </div>
    </div>
  `;
    })
    .join('');

  listEl.querySelectorAll('[data-toggle-student-q]').forEach((checkbox) => {
    checkbox.addEventListener('change', (e) => {
      const qId = e.target.dataset.toggleStudentQ;
      if (!state.draftStudentQuestionConfig) loadStudentQuestionConfig();

      if (state.draftStudentQuestionConfig.mode === 'all') {
        state.draftStudentQuestionConfig.mode = 'custom';
        state.draftStudentQuestionConfig.selectedIds = state.questions.map((q) => q.id);
      } else if (state.draftStudentQuestionConfig.mode === 'preset50') {
        state.draftStudentQuestionConfig.mode = 'custom';
        state.draftStudentQuestionConfig.selectedIds = getDefaultStudentQuestionIds();
      }

      const idSet = new Set(state.draftStudentQuestionConfig.selectedIds || []);
      if (e.target.checked) {
        idSet.add(qId);
      } else {
        idSet.delete(qId);
      }
      state.draftStudentQuestionConfig.selectedIds = Array.from(idSet);
      renderStudentQuestionMenu();
      renderAdminQuestionList();
    });
  });

  listEl.querySelectorAll('[data-edit-q]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const q = state.questions.find((item) => item.id === btn.dataset.editQ);
      if (q) openQuestionEditorModal(q);
    });
  });

  listEl.querySelectorAll('[data-delete-q]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const qId = btn.dataset.deleteQ;
      openConfirmModal(
        'Hapus Butir Soal?',
        `Soal dengan ID ${qId} akan dihapus permanen dari bank soal.`,
        () => {
          state.questions = state.questions.filter((item) => item.id !== qId);
          writeStorage(STORAGE_KEYS.QUESTIONS, state.questions);
          if (state.studentQuestionConfig?.mode === 'custom') {
            state.studentQuestionConfig.selectedIds = state.studentQuestionConfig.selectedIds.filter((id) => id !== qId);
            writeStorage(STORAGE_KEYS.STUDENT_QUESTIONS, state.studentQuestionConfig);
          }
          if (state.draftStudentQuestionConfig?.mode === 'custom') {
            state.draftStudentQuestionConfig.selectedIds = state.draftStudentQuestionConfig.selectedIds.filter((id) => id !== qId);
          }
          updateGlobalMetaCounts();
          renderAdminQuestionList();
          showToast(`Soal ${qId} berhasil dihapus.`, 'success');
        }
      );
    });
  });
}

function shuffleQuestionOptions(question) {
  if (!question || !question.options || (question.type !== 'pg' && question.type !== 'pg_kompleks')) {
    return { ...question };
  }

  const keys = Object.keys(question.options);
  if (keys.length <= 1) {
    return { ...question };
  }

  const correctKey = String(question.answer || '').trim();
  const correctKeys = Array.isArray(question.answer)
    ? question.answer.map((k) => String(k).trim())
    : [];

  const entries = keys.map((k) => ({
    text: question.options[k],
    isCorrect: question.type === 'pg' ? k === correctKey : correctKeys.includes(k),
  }));

  const shuffledEntries = shuffleArray(entries);
  const newOptions = {};
  const newCorrectKeys = [];

  keys.forEach((k, idx) => {
    newOptions[k] = shuffledEntries[idx].text;
    if (shuffledEntries[idx].isCorrect) {
      newCorrectKeys.push(k);
    }
  });

  return {
    ...question,
    options: newOptions,
    answer:
      question.type === 'pg'
        ? newCorrectKeys[0] || question.answer
        : newCorrectKeys,
  };
}

function promptShuffleQuestionBank() {
  if (!state.questions || state.questions.length === 0) {
    showToast('Bank soal masih kosong.', 'error');
    return;
  }

  openConfirmModal(
    'Acak Soal & Pilihan Jawaban?',
    `Urutan seluruh ${state.questions.length} butir soal serta posisi opsi jawaban (A–E) pada Pilihan Ganda dan PG Kompleks akan diacak. Kunci jawaban otomatis disesuaikan agar tetap akurat.`,
    () => {
      shuffleQuestionBankOrderAndOptions();
    }
  );
}

function shuffleQuestionBankOrderAndOptions() {
  const shuffledQuestions = shuffleArray(state.questions).map((q) => shuffleQuestionOptions(q));
  state.questions = shuffledQuestions;
  writeStorage(STORAGE_KEYS.QUESTIONS, state.questions);

  // Clear any unfinished draft session so old option letters do not mismatch newly shuffled options
  if (state.session) {
    removeStorage(STORAGE_KEYS.SESSION);
    state.session = null;
  }

  updateGlobalMetaCounts();
  renderAdminQuestionList();
  updateTopbar();
  showToast(
    `Berhasil mengacak ${state.questions.length} soal beserta pilihan jawabannya (kunci jawaban otomatis disesuaikan).`,
    'success'
  );
}

function openQuestionEditorModal(question) {
  const errEl = document.getElementById('question-editor-error');
  errEl.classList.add('hidden');
  const quickBar = document.getElementById('pg-quick-template-bar');
  const availableTopics = getAvailableTopics(question?.topic || '');
  syncTopicSelectElements(question?.topic || '');

  if (question) {
    document.getElementById('modal-q-title').textContent = `Edit Soal & Kunci (${question.id})`;
    document.getElementById('edit-q-id').value = question.id;
    document.getElementById('edit-q-type').value = question.type;
    document.getElementById('edit-q-topic').value = question.topic || availableTopics[0] || TOPICS[0];
    document.getElementById('edit-q-text').value = question.question;
    document.getElementById('edit-q-explanation').value = question.explanation || '';
    quickBar.classList.add('hidden');
    renderDynamicQuestionEditor(question.type, question);
  } else {
    document.getElementById('modal-q-title').textContent = 'Tambah Soal Baru';
    document.getElementById('edit-q-id').value = '';
    document.getElementById('edit-q-type').value = 'pg';
    document.getElementById('edit-q-topic').value = availableTopics[0] || TOPICS[0];
    document.getElementById('edit-q-text').value = '';
    document.getElementById('edit-q-explanation').value = '';
    quickBar.classList.remove('hidden');
    renderDynamicQuestionEditor('pg', null);
  }

  openModal('modal-question-form');
}

function applyQuickPgTemplate() {
  const topic = document.getElementById('edit-q-topic').value || TOPICS[0];
  document.getElementById('edit-q-type').value = 'pg';
  document.getElementById('edit-q-text').value = `Berdasarkan konsep materi ${topic}, pernyataan berikut yang paling tepat adalah ...`;
  document.getElementById('edit-q-explanation').value = `Penjelasan singkat mengenai konsep ${topic}.`;

  renderDynamicQuestionEditor('pg', {
    type: 'pg',
    options: {
      A: 'Pilihan jawaban A (ubah sesuai materi)',
      B: 'Pilihan jawaban B (contoh kunci jawaban benar)',
      C: 'Pilihan jawaban C (pengecoh)',
      D: 'Pilihan jawaban D (pengecoh)',
      E: 'Pilihan jawaban E (pengecoh)',
    },
    answer: 'B',
  });
  showToast('Template Pilihan Ganda diisikan ke formulir.', 'success');
}

/* ==================== TEMPLATE SOAL PILIHAN GANDA (CSV & JSON) ==================== */
function openPgTemplateModal() {
  state.pendingImportedQuestions = [];
  document.getElementById('pg-template-file-input').value = '';
  document.getElementById('pg-import-preview').classList.add('hidden');
  document.getElementById('pg-import-preview').innerHTML = '';
  document.getElementById('pg-import-error').classList.add('hidden');
  document.getElementById('btn-import-pg-template').disabled = true;
  openModal('modal-pg-template');
}

function downloadPgCsvTemplate() {
  const headers = [
    'Materi',
    'Pertanyaan',
    'Opsi_A',
    'Opsi_B',
    'Opsi_C',
    'Opsi_D',
    'Opsi_E',
    'Kunci_Jawaban',
    'Pembahasan',
  ];
  const sampleRows = [
    [
      'Apa Itu Informatika?',
      'Ilmu yang mempelajari perancangan dan pembuatan sistem komputasi disebut ...',
      'Matematika Terapan',
      'Informatika',
      'Elektronika',
      'Statistika',
      'Teknik Sipil',
      'B',
      'Informatika mempelajari studi, perancangan, dan prinsip dasar sistem komputasi.',
    ],
    [
      'Pencarian (Searching)',
      'Algoritma pencarian yang mengharuskan data sudah terurut adalah ...',
      'Linear Search',
      'Sequential Search',
      'Binary Search',
      'Bubble Sort',
      'Stack Push',
      'C',
      'Binary Search bekerja dengan membagi dua rentang data yang sudah terurut.',
    ],
  ];

  const csvEscape = (cell) => `"${String(cell || '').replace(/"/g, '""')}"`;
  const lines = [headers.map(csvEscape).join(','), ...sampleRows.map((row) => row.map(csvEscape).join(','))];
  const bom = '\uFEFF';
  const blob = new Blob([bom + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  triggerFileDownload(blob, 'Template_Soal_PG_MAZRO.csv');
  showToast('Template CSV Pilihan Ganda berhasil diunduh.', 'success');
}

function downloadPgJsonTemplate() {
  const templateData = [
    {
      id: 'PG_TEMPLATE_01',
      type: 'pg',
      topic: 'Apa Itu Informatika?',
      question: 'Tuliskan pertanyaan pilihan ganda di sini ...',
      options: {
        A: 'Pilihan jawaban A',
        B: 'Pilihan jawaban B',
        C: 'Pilihan jawaban C',
        D: 'Pilihan jawaban D',
        E: 'Pilihan jawaban E',
      },
      answer: 'B',
      explanation: 'Pembahasan singkat mengapa B benar.',
    },
    {
      id: 'PG_TEMPLATE_02',
      type: 'pg',
      topic: 'BERPIKIR KOMPUTASIONAL',
      question: 'Memecah masalah besar menjadi bagian kecil yang mudah dikelola disebut ...',
      options: {
        A: 'Abstraksi',
        B: 'Pengenalan Pola',
        C: 'Dekomposisi',
        D: 'Algoritma',
        E: 'Iterasi',
      },
      answer: 'C',
      explanation: 'Dekomposisi membagi masalah kompleks menjadi sub-masalah kecil.',
    },
  ];
  const blob = new Blob([JSON.stringify(templateData, null, 2)], {
    type: 'application/json;charset=utf-8;',
  });
  triggerFileDownload(blob, 'Template_Soal_PG_MAZRO.json');
  showToast('Template JSON Pilihan Ganda berhasil diunduh.', 'success');
}

function triggerFileDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function parseCsvLine(line, delimiter) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

function parsePgCsvContent(text) {
  const cleanText = text.replace(/^\uFEFF/, '');
  const lines = cleanText.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length < 2) {
    throw new Error('File CSV harus memiliki baris header dan minimal 1 baris soal.');
  }

  // Auto-detect delimiter (comma or semicolon from Indonesian Excel)
  const headerLine = lines[0];
  const delimiter = headerLine.split(';').length > headerLine.split(',').length ? ';' : ',';
  const parsedRows = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i], delimiter);
    if (cols.length < 8) continue;

    const [topicRaw, questionText, optA, optB, optC, optD, optE, keyRaw, explanation] = cols;
    const answer = String(keyRaw || '').trim().toUpperCase();
    if (!questionText || !optA || !optB || !optC || !optD || !optE) continue;
    if (!['A', 'B', 'C', 'D', 'E'].includes(answer)) continue;

    parsedRows.push({
      id: `QPG-${Date.now().toString().slice(-4)}-${i}`,
      type: 'pg',
      topic: TOPICS.includes(topicRaw) ? topicRaw : topicRaw || TOPICS[0],
      question: questionText,
      options: { A: optA, B: optB, C: optC, D: optD, E: optE },
      answer,
      explanation: explanation || '',
    });
  }

  return parsedRows;
}

function parsePgJsonContent(text) {
  const data = JSON.parse(text);
  if (!Array.isArray(data)) {
    throw new Error('Format JSON harus berupa array soal [ { ... } ].');
  }

  const validItems = [];
  data.forEach((item, idx) => {
    const type = item.type || 'pg';
    if (type !== 'pg') return;
    const opts = item.options || {};
    const ans = String(item.answer || '').trim().toUpperCase();
    if (!item.question || !opts.A || !opts.B || !opts.C || !opts.D || !opts.E) return;
    if (!['A', 'B', 'C', 'D', 'E'].includes(ans)) return;

    validItems.push({
      id: item.id || `QPG-${Date.now().toString().slice(-4)}-${idx + 1}`,
      type: 'pg',
      topic: item.topic || TOPICS[0],
      question: String(item.question).trim(),
      options: {
        A: String(opts.A).trim(),
        B: String(opts.B).trim(),
        C: String(opts.C).trim(),
        D: String(opts.D).trim(),
        E: String(opts.E).trim(),
      },
      answer: ans,
      explanation: String(item.explanation || '').trim(),
    });
  });

  return validItems;
}

async function handlePgTemplateFileSelect(e) {
  const file = e.target.files?.[0];
  const previewEl = document.getElementById('pg-import-preview');
  const errEl = document.getElementById('pg-import-error');
  const importBtn = document.getElementById('btn-import-pg-template');

  state.pendingImportedQuestions = [];
  importBtn.disabled = true;
  previewEl.classList.add('hidden');
  errEl.classList.add('hidden');

  if (!file) return;

  try {
    const content = await file.text();
    const isJson = file.name.toLowerCase().endsWith('.json');
    const parsed = isJson ? parsePgJsonContent(content) : parsePgCsvContent(content);

    if (parsed.length === 0) {
      throw new Error('Tidak ditemukan soal Pilihan Ganda yang valid (pastikan Opsi A–E terisi dan Kunci Jawaban A/B/C/D/E).');
    }

    state.pendingImportedQuestions = parsed;
    previewEl.innerHTML = `
      Terdeteksi <strong>${parsed.length} butir soal Pilihan Ganda</strong> valid dari file <strong>${escapeHtml(file.name)}</strong>. Klik "Impor ke Bank Soal" untuk menyimpan.
    `;
    previewEl.classList.remove('hidden');
    importBtn.disabled = false;
  } catch (err) {
    errEl.textContent = err.message || 'Gagal membaca file template.';
    errEl.classList.remove('hidden');
  }
}

function handleImportPgTemplate() {
  if (state.pendingImportedQuestions.length === 0) return;
  const mode = document.querySelector('input[name="pg-import-mode"]:checked')?.value || 'append';
  const imported = state.pendingImportedQuestions;

  if (mode === 'replace') {
    state.questions = imported;
  } else {
    // Ensure unique IDs when appending
    const existingIds = new Set(state.questions.map((q) => q.id));
    const uniqueImported = imported.map((q, idx) => {
      let id = q.id;
      if (existingIds.has(id)) {
        id = `Q${String(state.questions.length + idx + 1).padStart(3, '0')}-${Date.now().toString().slice(-3)}`;
      }
      existingIds.add(id);
      return { ...q, id };
    });
    state.questions = [...state.questions, ...uniqueImported];
  }

  writeStorage(STORAGE_KEYS.QUESTIONS, state.questions);
  if (mode === 'replace') {
    resetStudentQuestionConfigToDefault();
  }
  updateGlobalMetaCounts();
  renderAdminQuestionList();
  closeModal('modal-pg-template');
  showToast(`${imported.length} soal Pilihan Ganda berhasil diimpor.`, 'success');
}

/* ==================== EXPORT & IMPORT BANK SOAL UJIAN (ALL TYPES) ==================== */
function openBankExportImportModal() {
  state.pendingBankImport = { questions: [], settings: null };
  document.getElementById('bank-export-filtered-only').checked = false;
  document.getElementById('bank-import-file-input').value = '';
  document.getElementById('bank-import-preview').classList.add('hidden');
  document.getElementById('bank-import-preview').innerHTML = '';
  document.getElementById('bank-import-error').classList.add('hidden');
  document.getElementById('bank-import-settings-wrap').classList.add('hidden');
  document.getElementById('btn-confirm-bank-import').disabled = true;

  const counts = { pg: 0, pg_kompleks: 0, isian: 0, benar_salah: 0 };
  state.questions.forEach((q) => {
    if (counts[q.type] !== undefined) counts[q.type]++;
  });

  document.getElementById('bank-export-summary').textContent =
    `Total aktif saat ini: ${state.questions.length} soal (${counts.pg} PG, ${counts.pg_kompleks} PG Kompleks, ${counts.isian} Isian Singkat, ${counts.benar_salah} Benar/Salah).`;

  openModal('modal-bank-export-import');
}

function getQuestionsForBankExport() {
  const useFiltered = document.getElementById('bank-export-filtered-only')?.checked;
  if (useFiltered) {
    return getFilteredAdminQuestions().list;
  }
  return state.questions || [];
}

function exportQuestionBankJson() {
  const list = getQuestionsForBankExport();
  if (list.length === 0) {
    showToast('Tidak ada soal untuk diekspor.', 'error');
    return;
  }

  const payload = {
    app: 'CBT ONLINE MAZRO',
    version: 1,
    exportedAt: new Date().toISOString(),
    settings: state.settings || DEFAULT_SETTINGS,
    questions: list,
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json;charset=utf-8;',
  });
  const dateTag = new Date().toISOString().slice(0, 10);
  triggerFileDownload(blob, `Bank_Soal_CBT_MAZRO_${dateTag}.json`);
  showToast(`Berhasil mengexport ${list.length} soal ke arsip JSON.`, 'success');
}

function exportQuestionBankCsv() {
  const list = getQuestionsForBankExport();
  if (list.length === 0) {
    showToast('Tidak ada soal untuk diekspor.', 'error');
    return;
  }

  const headers = [
    'ID',
    'Jenis_Soal',
    'Materi',
    'Pertanyaan',
    'Opsi_A',
    'Opsi_B',
    'Opsi_C',
    'Opsi_D',
    'Opsi_E',
    'Kunci_Jawaban',
    'Pembahasan',
  ];

  const csvEscape = (cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`;

  const rows = list.map((q) => {
    const opts = q.options || {};
    const ansStr = q.type === 'pg_kompleks' && Array.isArray(q.answer) ? q.answer.join(';') : String(q.answer ?? '');
    return [
      q.id || '',
      q.type || 'pg',
      q.topic || TOPICS[0],
      q.question || '',
      opts.A || '',
      opts.B || '',
      opts.C || '',
      opts.D || '',
      opts.E || '',
      ansStr,
      q.explanation || '',
    ]
      .map(csvEscape)
      .join(',');
  });

  const bom = '\uFEFF';
  const blob = new Blob([bom + [headers.map(csvEscape).join(','), ...rows].join('\r\n')], {
    type: 'text/csv;charset=utf-8;',
  });
  const dateTag = new Date().toISOString().slice(0, 10);
  triggerFileDownload(blob, `Bank_Soal_CBT_MAZRO_${dateTag}.csv`);
  showToast(`Berhasil mengexport ${list.length} soal ke arsip CSV.`, 'success');
}

function normalizeImportedQuestion(item, idx) {
  if (!item || typeof item !== 'object') return null;
  const type = String(item.type || 'pg').trim().toLowerCase();
  const questionText = String(item.question || '').trim();
  const topic = String(item.topic || TOPICS[0]).trim() || TOPICS[0];
  const explanation = String(item.explanation || '').trim();
  const fallbackId = `QIMP-${Date.now().toString().slice(-4)}-${idx + 1}`;
  const id = String(item.id || fallbackId).trim() || fallbackId;

  if (!questionText) return null;

  if (type === 'pg') {
    const opts = item.options || {};
    const ans = String(item.answer || '').trim().toUpperCase();
    if (!opts.A || !opts.B || !opts.C || !opts.D || !opts.E) return null;
    if (!['A', 'B', 'C', 'D', 'E'].includes(ans)) return null;
    return {
      id,
      type: 'pg',
      topic,
      question: questionText,
      options: {
        A: String(opts.A).trim(),
        B: String(opts.B).trim(),
        C: String(opts.C).trim(),
        D: String(opts.D).trim(),
        E: String(opts.E).trim(),
      },
      answer: ans,
      explanation,
    };
  }

  if (type === 'pg_kompleks') {
    const opts = item.options || {};
    if (!opts.A || !opts.B || !opts.C || !opts.D || !opts.E) return null;
    const rawAns = Array.isArray(item.answer)
      ? item.answer
      : String(item.answer || '')
          .split(/[,;|\s]+/)
          .filter(Boolean);
    const validKeys = Array.from(
      new Set(
        rawAns
          .map((k) => String(k).trim().toUpperCase())
          .filter((k) => ['A', 'B', 'C', 'D', 'E'].includes(k))
      )
    ).sort();
    if (validKeys.length === 0) return null;

    return {
      id,
      type: 'pg_kompleks',
      topic,
      question: questionText,
      options: {
        A: String(opts.A).trim(),
        B: String(opts.B).trim(),
        C: String(opts.C).trim(),
        D: String(opts.D).trim(),
        E: String(opts.E).trim(),
      },
      answer: validKeys,
      explanation,
    };
  }

  if (type === 'isian') {
    const ans = String(item.answer ?? '').trim();
    if (ans === '' || Number.isNaN(Number(ans))) return null;
    return {
      id,
      type: 'isian',
      topic,
      question: questionText,
      answer: ans,
      explanation,
    };
  }

  if (type === 'benar_salah') {
    const lower = String(item.answer || '').trim().toLowerCase();
    if (lower !== 'benar' && lower !== 'salah') return null;
    return {
      id,
      type: 'benar_salah',
      topic,
      question: questionText,
      answer: lower === 'benar' ? 'Benar' : 'Salah',
      explanation,
    };
  }

  return null;
}

function parseFullQuestionBankJson(text) {
  const parsed = JSON.parse(text);
  let rawQuestions = null;
  let importedSettings = null;

  if (Array.isArray(parsed)) {
    rawQuestions = parsed;
  } else if (parsed && typeof parsed === 'object' && Array.isArray(parsed.questions)) {
    rawQuestions = parsed.questions;
    if (parsed.settings && typeof parsed.settings === 'object') {
      importedSettings = parsed.settings;
    }
  } else {
    throw new Error('Format JSON tidak dikenali. Gunakan file hasil Export Bank Soal (.json) atau array soal [ { ... } ].');
  }

  const validQuestions = rawQuestions.map((item, idx) => normalizeImportedQuestion(item, idx)).filter(Boolean);
  return { questions: validQuestions, settings: importedSettings };
}

function parseFullQuestionBankCsv(text) {
  const cleanText = text.replace(/^\uFEFF/, '');
  const lines = cleanText.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length < 2) {
    throw new Error('File CSV harus memiliki baris header dan minimal 1 baris soal.');
  }

  const headerLine = lines[0];
  const delimiter = headerLine.split(';').length > headerLine.split(',').length ? ';' : ',';
  const headers = parseCsvLine(headerLine, delimiter).map((h) => h.toLowerCase());

  // Check if full export CSV (contains Jenis_Soal) vs legacy PG template CSV
  const hasTypeCol = headers.includes('jenis_soal');
  const validQuestions = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i], delimiter);
    if (hasTypeCol) {
      if (cols.length < 10) continue;
      const [id, type, topic, question, optA, optB, optC, optD, optE, answer, explanation] = cols;
      const normalized = normalizeImportedQuestion(
        {
          id,
          type,
          topic,
          question,
          options: { A: optA, B: optB, C: optC, D: optD, E: optE },
          answer,
          explanation,
        },
        i
      );
      if (normalized) validQuestions.push(normalized);
    } else {
      if (cols.length < 8) continue;
      const [topic, question, optA, optB, optC, optD, optE, answer, explanation] = cols;
      const normalized = normalizeImportedQuestion(
        {
          type: 'pg',
          topic,
          question,
          options: { A: optA, B: optB, C: optC, D: optD, E: optE },
          answer,
          explanation,
        },
        i
      );
      if (normalized) validQuestions.push(normalized);
    }
  }

  return { questions: validQuestions, settings: null };
}

async function handleBankImportFileSelect(e) {
  const file = e.target.files?.[0];
  const previewEl = document.getElementById('bank-import-preview');
  const errEl = document.getElementById('bank-import-error');
  const settingsWrap = document.getElementById('bank-import-settings-wrap');
  const importBtn = document.getElementById('btn-confirm-bank-import');

  state.pendingBankImport = { questions: [], settings: null };
  importBtn.disabled = true;
  previewEl.classList.add('hidden');
  errEl.classList.add('hidden');
  settingsWrap.classList.add('hidden');

  if (!file) return;

  try {
    const content = await file.text();
    const isJson = file.name.toLowerCase().endsWith('.json');
    const result = isJson ? parseFullQuestionBankJson(content) : parseFullQuestionBankCsv(content);

    if (result.questions.length === 0) {
      throw new Error('Tidak ditemukan butir soal yang valid pada file ini.');
    }

    state.pendingBankImport = result;

    const counts = { pg: 0, pg_kompleks: 0, isian: 0, benar_salah: 0 };
    result.questions.forEach((q) => {
      if (counts[q.type] !== undefined) counts[q.type]++;
    });

    const settingsNote = result.settings
      ? ` · Termasuk pengaturan ujian (${escapeHtml(result.settings.subject || DEFAULT_SETTINGS.subject)})`
      : '';

    previewEl.innerHTML = `
      Terdeteksi <strong>${result.questions.length} butir soal valid</strong> dari <strong>${escapeHtml(file.name)}</strong>
      (${counts.pg} PG, ${counts.pg_kompleks} PG Kompleks, ${counts.isian} Isian, ${counts.benar_salah} Benar/Salah)${settingsNote}.
    `;
    previewEl.classList.remove('hidden');

    if (result.settings) {
      settingsWrap.classList.remove('hidden');
      document.getElementById('bank-import-apply-settings').checked = true;
    }

    importBtn.disabled = false;
  } catch (err) {
    errEl.textContent = err.message || 'Gagal membaca file bank soal.';
    errEl.classList.remove('hidden');
  }
}

function handleConfirmBankImport() {
  const { questions: imported, settings: importedSettings } = state.pendingBankImport;
  if (!imported || imported.length === 0) return;

  const mode = document.querySelector('input[name="bank-import-mode"]:checked')?.value || 'replace';

  if (mode === 'replace') {
    state.questions = imported;
  } else {
    const existingIds = new Set(state.questions.map((q) => q.id));
    const uniqueImported = imported.map((q, idx) => {
      let id = q.id;
      if (existingIds.has(id)) {
        id = `Q${String(state.questions.length + idx + 1).padStart(3, '0')}-${Date.now().toString().slice(-3)}`;
      }
      existingIds.add(id);
      return { ...q, id };
    });
    state.questions = [...state.questions, ...uniqueImported];
  }

  writeStorage(STORAGE_KEYS.QUESTIONS, state.questions);
  if (mode === 'replace') {
    resetStudentQuestionConfigToDefault();
  }

  // Clear unfinished active draft session to avoid stale question IDs
  if (state.session) {
    removeStorage(STORAGE_KEYS.SESSION);
    state.session = null;
  }

  const shouldApplySettings =
    importedSettings &&
    document.getElementById('bank-import-apply-settings')?.checked;

  if (shouldApplySettings) {
    state.settings = {
      subject: importedSettings.subject || state.settings?.subject || DEFAULT_SETTINGS.subject,
      mainTopic: importedSettings.mainTopic || state.settings?.mainTopic || DEFAULT_SETTINGS.mainTopic,
      heroSubtitle:
        typeof importedSettings.heroSubtitle === 'string'
          ? importedSettings.heroSubtitle
          : state.settings?.heroSubtitle || DEFAULT_SETTINGS.heroSubtitle,
      durationMinutes:
        Number(importedSettings.durationMinutes) > 0
          ? Number(importedSettings.durationMinutes)
          : state.settings?.durationMinutes || DEFAULT_SETTINGS.durationMinutes,
      syllabusItems:
        Array.isArray(importedSettings.syllabusItems) && importedSettings.syllabusItems.length > 0
          ? importedSettings.syllabusItems
          : state.settings?.syllabusItems || [...DEFAULT_SETTINGS.syllabusItems],
    };
    writeStorage(STORAGE_KEYS.SETTINGS, state.settings);
    renderAdminSyllabusPanel();
    applySettingsToUI();
  }

  updateGlobalMetaCounts();
  renderAdminQuestionList();
  updateTopbar();
  closeModal('modal-bank-export-import');
  showToast(
    `${imported.length} soal ujian berhasil diimpor (${mode === 'replace' ? 'menggantikan bank soal lama' : 'ditambahkan ke bank soal'}).`,
    'success'
  );
}

function renderDynamicQuestionEditor(type, existingQuestion) {
  const container = document.getElementById('edit-q-dynamic-area');
  const opts = existingQuestion?.options || { A: '', B: '', C: '', D: '', E: '' };
  const ans = existingQuestion?.answer;

  if (type === 'pg' || type === 'pg_kompleks') {
    const isMulti = type === 'pg_kompleks';
    const selectedKeys = isMulti ? (Array.isArray(ans) ? ans : []) : [ans || 'A'];

    container.innerHTML = `
      <span class="form-label">${
        isMulti
          ? 'Pilihan Jawaban (A–E) & Centang Kunci Jawaban Benar (>1)'
          : 'Pilihan Jawaban (A–E) & Pilih Satu Kunci Jawaban'
      }</span>
      ${['A', 'B', 'C', 'D', 'E']
        .map(
          (key) => `
        <div class="editor-option-row">
          <span class="editor-key-badge">${key}</span>
          <input
            type="text"
            class="form-input input-compact"
            id="editor-opt-${key}"
            placeholder="Isi pilihan ${key}..."
            value="${escapeHtml(opts[key] || '')}"
            required
          />
          <label class="editor-key-pick">
            <input
              type="${isMulti ? 'checkbox' : 'radio'}"
              name="editor-key-choice"
              value="${key}"
              ${selectedKeys.includes(key) ? 'checked' : ''}
            />
            <span>Kunci</span>
          </label>
        </div>
      `
        )
        .join('')}
    `;
  } else if (type === 'isian') {
    container.innerHTML = `
      <div class="form-group">
        <label for="editor-isian-key" class="form-label">Kunci Jawaban (Berupa Angka)</label>
        <input
          type="number"
          step="any"
          id="editor-isian-key"
          class="form-input mono-input"
          placeholder="Contoh: 25"
          value="${existingQuestion && existingQuestion.type === 'isian' ? escapeHtml(String(ans || '')) : ''}"
          required
        />
      </div>
    `;
  } else if (type === 'benar_salah') {
    const currentKey = existingQuestion && existingQuestion.type === 'benar_salah' ? ans : 'Benar';
    container.innerHTML = `
      <div class="form-group">
        <span class="form-label">Kunci Jawaban Benar / Salah</span>
        <div class="tf-grid">
          <label class="editor-key-pick">
            <input type="radio" name="editor-tf-key" value="Benar" ${currentKey === 'Benar' ? 'checked' : ''} />
            <span>Benar</span>
          </label>
          <label class="editor-key-pick">
            <input type="radio" name="editor-tf-key" value="Salah" ${currentKey === 'Salah' ? 'checked' : ''} />
            <span>Salah</span>
          </label>
        </div>
      </div>
    `;
  }
}

function handleSaveQuestion(e) {
  e.preventDefault();
  const id = document.getElementById('edit-q-id').value.trim();
  const type = document.getElementById('edit-q-type').value;
  const topic = document.getElementById('edit-q-topic').value;
  const questionText = document.getElementById('edit-q-text').value.trim();
  const explanation = document.getElementById('edit-q-explanation').value.trim();
  const errEl = document.getElementById('question-editor-error');

  if (!questionText) {
    errEl.textContent = 'Teks pertanyaan tidak boleh kosong.';
    errEl.classList.remove('hidden');
    return;
  }

  let options = undefined;
  let answer = null;

  if (type === 'pg' || type === 'pg_kompleks') {
    options = {};
    for (const key of ['A', 'B', 'C', 'D', 'E']) {
      const val = document.getElementById(`editor-opt-${key}`).value.trim();
      if (!val) {
        errEl.textContent = `Opsi pilihan ${key} wajib diisi.`;
        errEl.classList.remove('hidden');
        return;
      }
      options[key] = val;
    }

    const checkedInputs = Array.from(document.querySelectorAll('input[name="editor-key-choice"]:checked'));
    if (checkedInputs.length === 0) {
      errEl.textContent = 'Pilih minimal satu kunci jawaban yang benar.';
      errEl.classList.remove('hidden');
      return;
    }

    answer = type === 'pg' ? checkedInputs[0].value : checkedInputs.map((el) => el.value).sort();
  } else if (type === 'isian') {
    const numVal = document.getElementById('editor-isian-key').value.trim();
    if (numVal === '' || Number.isNaN(Number(numVal))) {
      errEl.textContent = 'Kunci jawaban isian singkat wajib berupa angka.';
      errEl.classList.remove('hidden');
      return;
    }
    answer = numVal;
  } else if (type === 'benar_salah') {
    const tfChecked = document.querySelector('input[name="editor-tf-key"]:checked');
    answer = tfChecked ? tfChecked.value : 'Benar';
  }

  errEl.classList.add('hidden');

  if (id) {
    const idx = state.questions.findIndex((q) => q.id === id);
    if (idx !== -1) {
      state.questions[idx] = {
        id,
        type,
        topic,
        question: questionText,
        ...(options ? { options } : {}),
        answer,
        explanation,
      };
    }
    showToast(`Soal ${id} berhasil diperbarui.`, 'success');
  } else {
    const nextNum = state.questions.length + 1;
    const newId = `Q${String(nextNum).padStart(3, '0')}-${Date.now().toString().slice(-3)}`;
    state.questions.push({
      id: newId,
      type,
      topic,
      question: questionText,
      ...(options ? { options } : {}),
      answer,
      explanation,
    });
    if (state.studentQuestionConfig?.mode === 'custom') {
      state.studentQuestionConfig.selectedIds.push(newId);
      writeStorage(STORAGE_KEYS.STUDENT_QUESTIONS, state.studentQuestionConfig);
    }
    if (state.draftStudentQuestionConfig?.mode === 'custom') {
      state.draftStudentQuestionConfig.selectedIds.push(newId);
    }
    showToast(`Soal baru ${newId} berhasil ditambahkan.`, 'success');
  }

  writeStorage(STORAGE_KEYS.QUESTIONS, state.questions);
  updateGlobalMetaCounts();
  closeModal('modal-question-form');
  renderAdminQuestionList();
}

/* ==================== MENU GENERATE AI SESUAI CAKUPAN MATERI ==================== */
function renderAiGeneratorPanel() {
  if (!state.settings) loadExamSettings();
  const panel = document.getElementById('ai-generate-menu-panel');
  if (panel) panel.classList.toggle('hidden', !state.aiGenMenuOpen);

  const subjectEl = document.getElementById('ai-ctx-subject');
  const topicEl = document.getElementById('ai-ctx-topic');
  const countEl = document.getElementById('ai-ctx-syllabus-count');
  const listEl = document.getElementById('ai-ctx-syllabus-list');

  if (subjectEl) subjectEl.textContent = state.settings.subject;
  if (topicEl) topicEl.textContent = state.settings.mainTopic;
  if (countEl) countEl.textContent = String(state.settings.syllabusItems.length);
  if (listEl) {
    listEl.innerHTML = state.settings.syllabusItems
      .map((item) => `<li>${escapeHtml(item)}</li>`)
      .join('');
  }

  const targetMode = document.getElementById('ai-gen-target-mode')?.value || 'bank100';
  const customBox = document.getElementById('ai-gen-custom-counts');
  if (customBox) customBox.classList.toggle('hidden', targetMode !== 'custom');

  const undoBtn = document.getElementById('btn-undo-ai-gen');
  if (undoBtn) {
    undoBtn.classList.toggle('hidden', !Array.isArray(state.previousQuestionsBeforeAi) || state.aiGenerating);
  }

  const statusNote = document.getElementById('ai-gen-status-note');
  if (statusNote) {
    statusNote.textContent = isSyllabusDirty()
      ? 'Catatan: Ada perubahan di Tab Cakupan Materi yang belum disimpan. Simpan terlebih dahulu agar digunakan AI.'
      : 'Menggunakan pengaturan Cakupan Materi terbaru yang tersimpan di Portal Admin.';
  }
}

function getAiGenerationTargetCounts() {
  const mode = document.getElementById('ai-gen-target-mode')?.value || 'bank100';
  if (mode === 'bank100') {
    return { pg: 70, pg_kompleks: 10, isian: 10, benar_salah: 10 };
  }
  if (mode === 'bank65') {
    return { pg: 50, pg_kompleks: 5, isian: 5, benar_salah: 5 };
  }
  if (mode === 'student50') {
    return { pg: 40, pg_kompleks: 4, isian: 3, benar_salah: 3 };
  }
  if (mode === 'pg50') {
    return { pg: 50, pg_kompleks: 0, isian: 0, benar_salah: 0 };
  }

  const pg = Math.max(0, Math.min(100, Number(document.getElementById('ai-count-pg')?.value || 0)));
  const pg_kompleks = Math.max(0, Math.min(25, Number(document.getElementById('ai-count-pgk')?.value || 0)));
  const isian = Math.max(0, Math.min(25, Number(document.getElementById('ai-count-isian')?.value || 0)));
  const benar_salah = Math.max(0, Math.min(25, Number(document.getElementById('ai-count-bs')?.value || 0)));
  return { pg, pg_kompleks, isian, benar_salah };
}

function buildAiGenerationBatches(counts) {
  const MAX_PER_BATCH = 17;
  const queue = [];
  (['pg', 'pg_kompleks', 'isian', 'benar_salah']).forEach((type) => {
    const count = Math.floor(Number(counts[type] || 0));
    if (count > 0) queue.push({ type, remaining: count });
  });

  const batches = [];
  let currentSpecs = [];
  let currentTotal = 0;

  for (const item of queue) {
    let rem = item.remaining;
    while (rem > 0) {
      const space = MAX_PER_BATCH - currentTotal;
      if (space <= 0) {
        batches.push(currentSpecs);
        currentSpecs = [];
        currentTotal = 0;
        continue;
      }
      const take = Math.min(rem, space);
      currentSpecs.push({ type: item.type, count: take });
      currentTotal += take;
      rem -= take;

      if (currentTotal >= MAX_PER_BATCH) {
        batches.push(currentSpecs);
        currentSpecs = [];
        currentTotal = 0;
      }
    }
  }

  if (currentSpecs.length > 0) {
    batches.push(currentSpecs);
  }
  return batches;
}

function promptGenerateAiQuestions() {
  if (state.aiGenerating) return;
  if (!state.settings) loadExamSettings();

  const errEl = document.getElementById('ai-gen-error');
  if (errEl) errEl.classList.add('hidden');

  const counts = getAiGenerationTargetCounts();
  const totalCount = counts.pg + counts.pg_kompleks + counts.isian + counts.benar_salah;

  if (!Number.isInteger(totalCount) || totalCount < 1 || totalCount > 100) {
    if (errEl) {
      errEl.textContent = 'Total jumlah soal yang digenerate harus antara 1 sampai 100 butir.';
      errEl.classList.remove('hidden');
    }
    return;
  }

  if (!state.settings.subject || !state.settings.mainTopic || state.settings.syllabusItems.length === 0) {
    if (errEl) {
      errEl.textContent = 'Mata Pelajaran, Materi Pokok, dan Cakupan Materi wajib terisi di Tab Cakupan Materi.';
      errEl.classList.remove('hidden');
    }
    return;
  }

  openConfirmModal(
    'Generate & Ubah Bank Soal dengan AI?',
    `AI akan menyusun ${totalCount} butir soal baru (${counts.pg} PG, ${counts.pg_kompleks} PG Kompleks, ${counts.isian} Isian, ${counts.benar_salah} Benar/Salah) sesuai Mata Pelajaran "${state.settings.subject}" dan Cakupan Materi aktif, lalu menggantikan isi Bank Soal saat ini.`,
    () => {
      executeAiQuestionGeneration(counts, totalCount);
    }
  );
}

function setAiGeneratingUiState(isRunning, progressPct = 0, progressLabel = '') {
  state.aiGenerating = isRunning;
  const runBtn = document.getElementById('btn-run-ai-generate');
  const cancelBtn = document.getElementById('btn-cancel-ai-gen');
  const undoBtn = document.getElementById('btn-undo-ai-gen');
  const progressBox = document.getElementById('ai-gen-progress-box');
  const progressFill = document.getElementById('ai-gen-progress-fill');
  const progressText = document.getElementById('ai-gen-progress-text');
  const progressPctEl = document.getElementById('ai-gen-progress-pct');

  if (runBtn) {
    runBtn.disabled = isRunning;
    runBtn.textContent = isRunning ? 'Sedang Menggenerate Soal...' : 'Generate & Ubah Soal AI';
  }
  if (cancelBtn) cancelBtn.classList.toggle('hidden', !isRunning);
  if (undoBtn) {
    undoBtn.classList.toggle('hidden', isRunning || !Array.isArray(state.previousQuestionsBeforeAi));
  }
  if (progressBox) progressBox.classList.toggle('hidden', !isRunning);
  if (progressFill) progressFill.style.width = `${Math.min(100, Math.max(0, progressPct))}%`;
  if (progressText && progressLabel) progressText.textContent = progressLabel;
  if (progressPctEl) progressPctEl.textContent = `${Math.round(progressPct)}%`;
}

function cancelAiQuestionGeneration() {
  if (state.aiAbortController) {
    state.aiAbortController.abort();
    state.aiAbortController = null;
  }
}

async function executeAiQuestionGeneration(counts, totalCount) {
  const errEl = document.getElementById('ai-gen-error');
  if (errEl) errEl.classList.add('hidden');

  const difficulty = document.getElementById('ai-gen-difficulty')?.value || 'standar';
  const customInstruction = (document.getElementById('ai-gen-custom-instruction')?.value || '').trim();
  const batches = buildAiGenerationBatches(counts);
  const abortController = new AbortController();
  state.aiAbortController = abortController;

  const collected = [];
  setAiGeneratingUiState(true, 4, `Menyiapkan ${batches.length} tahap generate AI (${totalCount} soal)...`);

  try {
    for (let i = 0; i < batches.length; i++) {
      const batchSpecs = batches[i];
      const batchSize = batchSpecs.reduce((sum, s) => sum + s.count, 0);
      const startPct = Math.round((i / batches.length) * 90) + 5;
      setAiGeneratingUiState(
        true,
        startPct,
        `Menghasilkan tahap ${i + 1} dari ${batches.length} (${collected.length + 1}–${Math.min(totalCount, collected.length + batchSize)} dari ${totalCount} soal)...`
      );

      const response = await fetch('/api/ai/generate-questions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'CBT-MAZRO-Admin',
        },
        signal: abortController.signal,
        body: JSON.stringify({
          subject: state.settings.subject,
          mainTopic: state.settings.mainTopic,
          syllabusItems: state.settings.syllabusItems,
          batchSpecs,
          difficulty,
          customInstruction,
          batchIndex: i + 1,
          totalBatches: batches.length,
          avoidSummaries: collected.map((q) => q.question.slice(0, 100)).slice(-45),
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || `Gagal memproses tahap ${i + 1} (HTTP ${response.status}).`);
      }
      if (!Array.isArray(data.questions) || data.questions.length === 0) {
        throw new Error(`AI tidak mengembalikan soal valid pada tahap ${i + 1}.`);
      }

      data.questions.forEach((q) => collected.push(q));
    }

    const finalQuestions = collected.map((q, idx) => ({
      id: `Q${String(idx + 1).padStart(3, '0')}`,
      type: q.type,
      topic: q.topic,
      question: q.question,
      ...(q.options ? { options: q.options } : {}),
      answer: q.answer,
      explanation: q.explanation || '',
    }));

    state.previousQuestionsBeforeAi = [...state.questions];
    state.questions = finalQuestions;
    writeStorage(STORAGE_KEYS.QUESTIONS, state.questions);

    resetStudentQuestionConfigToDefault();
    if (state.session) {
      removeStorage(STORAGE_KEYS.SESSION);
      state.session = null;
    }

    setAiGeneratingUiState(false, 100, 'Selesai!');
    state.aiAbortController = null;

    syncTopicSelectElements();
    updateGlobalMetaCounts();
    renderStudentQuestionMenu();
    renderAdminQuestionList();
    renderAiGeneratorPanel();
    updateTopbar();

    const activeCount = getActiveStudentQuestions().length;
    showToast(
      `Berhasil menggenerate ${finalQuestions.length} soal AI sesuai Cakupan Materi "${state.settings.subject}" (${activeCount} soal aktif untuk siswa).`,
      'success'
    );
  } catch (err) {
    state.aiAbortController = null;
    setAiGeneratingUiState(false, 0, '');
    if (err && err.name === 'AbortError') {
      showToast('Proses generate soal AI dihentikan. Bank soal sebelumnya tetap aman.', 'default');
      return;
    }
    const msg = err instanceof Error ? err.message : 'Terjadi kesalahan saat menggenerate soal AI.';
    if (errEl) {
      errEl.textContent = msg;
      errEl.classList.remove('hidden');
    }
    showToast(msg, 'error');
  }
}

function undoAiQuestionGeneration() {
  if (!Array.isArray(state.previousQuestionsBeforeAi) || state.previousQuestionsBeforeAi.length === 0) {
    return;
  }
  openConfirmModal(
    'Kembalikan Soal Sebelum Generate AI?',
    `Bank soal akan dikembalikan ke ${state.previousQuestionsBeforeAi.length} soal sebelumnya.`,
    () => {
      state.questions = [...state.previousQuestionsBeforeAi];
      state.previousQuestionsBeforeAi = null;
      writeStorage(STORAGE_KEYS.QUESTIONS, state.questions);
      resetStudentQuestionConfigToDefault();
      if (state.session) {
        removeStorage(STORAGE_KEYS.SESSION);
        state.session = null;
      }
      syncTopicSelectElements();
      updateGlobalMetaCounts();
      renderStudentQuestionMenu();
      renderAdminQuestionList();
      renderAiGeneratorPanel();
      updateTopbar();
      showToast('Bank soal berhasil dikembalikan ke kondisi sebelum generate AI.', 'success');
    }
  );
}

/* ==================== UI HELPERS (MODALS, TOAST, FORMAT) ==================== */
function openModal(modalId) {
  const el = document.getElementById(modalId);
  if (el) el.classList.remove('hidden');
}

function closeModal(modalId) {
  const el = document.getElementById(modalId);
  if (el) el.classList.add('hidden');
}

function openConfirmModal(title, message, onConfirm) {
  document.getElementById('modal-confirm-title').textContent = title;
  document.getElementById('modal-confirm-message').textContent = message;
  state.confirmCallback = onConfirm;
  openModal('modal-confirm');
}

function showToast(message, variant = 'default') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast${variant === 'success' ? ' is-success' : variant === 'error' ? ' is-error' : ''}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, 3200);
}

function formatDateTimeID(isoStr) {
  try {
    return new Intl.DateTimeFormat('id-ID', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(isoStr));
  } catch {
    return isoStr;
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ==================== BOOTSTRAP ==================== */
document.addEventListener('DOMContentLoaded', initApp);
