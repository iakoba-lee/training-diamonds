/* ============================================================
   Skill Portal — Dashboard Logic
   Handles auth, user picker, radar charts, sliders, and saving
   ============================================================ */

// --- State ---
let currentUserId = null;
let snapshotType = 'current'; // 'current' or 'aim'
let chartD1 = null;
let chartD2 = null;
let latestData = null;
let currentRole = null; // 'team' or 'manager'

// --- DOM Refs ---
const userSelect = document.getElementById('user-select');
const emptyState = document.getElementById('empty-state');
const dashboardContent = document.getElementById('dashboard-content');
const toggleCurrent = document.getElementById('toggle-current');
const toggleAim = document.getElementById('toggle-aim');
const btnSave = document.getElementById('btn-save');
const saveFeedback = document.getElementById('save-feedback');
const toastEl = document.getElementById('toast');
const updatePanel = document.getElementById('update-panel');
const navbarRole = document.getElementById('navbar-role');
const btnLogout = document.getElementById('btn-logout');

// --- Chart Configuration ---
const DIAMOND_LABELS = {
  1: ['Applications', 'OSs', 'Customer Service', 'Operations'],
  2: ['Security', 'AV', 'Network', 'Proj Mgmt /\nLeadership']
};

const CHART_OPTIONS = {
  responsive: true,
  maintainAspectRatio: true,
  plugins: {
    legend: { display: false }
  },
  scales: {
    r: {
      min: 0,
      max: 5,
      beginAtZero: true,
      ticks: {
        stepSize: 1,
        backdropColor: 'transparent',
        color: '#64748b',
        font: { size: 11 }
      },
      pointLabels: {
        color: '#94a3b8',
        font: { size: 12, weight: '500', family: 'Inter' }
      },
      grid: {
        color: 'rgba(255, 255, 255, 0.06)',
        circular: true
      },
      angleLines: {
        color: 'rgba(255, 255, 255, 0.06)'
      }
    }
  },
  elements: {
    line: { borderWidth: 2 },
    point: {
      radius: 4,
      hoverRadius: 6,
      borderWidth: 2,
      backgroundColor: '#111827'
    }
  }
};

function makeDatasets(currentData, aimData) {
  return [
    {
      label: 'Current',
      data: currentData || [0, 0, 0, 0],
      backgroundColor: 'rgba(239, 68, 68, 0.15)',
      borderColor: 'rgba(239, 68, 68, 0.9)',
      pointBackgroundColor: '#111827',
      pointBorderColor: '#ef4444',
      order: 1
    },
    {
      label: 'Aim',
      data: aimData || [0, 0, 0, 0],
      backgroundColor: 'rgba(59, 130, 246, 0.12)',
      borderColor: 'rgba(59, 130, 246, 0.9)',
      pointBackgroundColor: '#111827',
      pointBorderColor: '#3b82f6',
      order: 2
    }
  ];
}

// --- Init ---
document.addEventListener('DOMContentLoaded', () => {
  checkAuth();
});

// --- Auth Check ---
async function checkAuth() {
  try {
    const res = await fetch('/api/auth/me');
    if (!res.ok) {
      window.location.href = '/login';
      return;
    }
    const data = await res.json();
    currentRole = data.role;
    initDashboard();
  } catch (err) {
    window.location.href = '/login';
  }
}

// --- Initialize Dashboard after auth ---
function initDashboard() {
  // Set navbar role badge
  navbarRole.textContent = currentRole === 'manager' ? '⭐ Manager' : '👥 Team';
  navbarRole.className = `navbar-role role-${currentRole}`;

  // Hide update panel for team login (read-only)
  if (currentRole !== 'manager') {
    updatePanel.classList.add('hidden');
  }

  // Setup logout
  btnLogout.addEventListener('click', async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login';
  });

  loadUsers();

  // Only setup editing controls for manager
  if (currentRole === 'manager') {
    setupSliders();
    setupToggle();
    setupSave();
  }
}

// --- Load Users ---
async function loadUsers() {
  try {
    const res = await fetch('/api/users');
    const users = await res.json();

    userSelect.innerHTML = '<option value="">— Choose a user —</option>';
    users.forEach(u => {
      const opt = document.createElement('option');
      opt.value = u.id;
      opt.textContent = u.display_name + (u.role === 'manager' ? ' ⭐' : '');
      userSelect.appendChild(opt);
    });

    // Restore last selected user from localStorage
    const savedId = localStorage.getItem('selectedUserId');
    if (savedId) {
      userSelect.value = savedId;
      onUserSelected(savedId);
    }
  } catch (err) {
    showToast('Failed to load users', 'error');
  }

  userSelect.addEventListener('change', (e) => {
    const id = e.target.value;
    localStorage.setItem('selectedUserId', id);
    onUserSelected(id);
  });
}

// --- User Selected ---
async function onUserSelected(userId) {
  if (!userId) {
    currentUserId = null;
    emptyState.style.display = '';
    dashboardContent.style.display = 'none';
    return;
  }

  currentUserId = userId;
  emptyState.style.display = 'none';
  dashboardContent.style.display = '';

  await loadSkillData();
}

// --- Load Skill Data ---
async function loadSkillData() {
  if (!currentUserId) return;

  try {
    const res = await fetch(`/api/skills/${currentUserId}/latest`);
    latestData = await res.json();

    const d1Current = latestData.diamond1.current;
    const d1Aim = latestData.diamond1.aim;
    const d2Current = latestData.diamond2.current;
    const d2Aim = latestData.diamond2.aim;

    renderChart(1, d1Current, d1Aim);
    renderChart(2, d2Current, d2Aim);

    if (currentRole === 'manager') {
      populateSliders();
    }
  } catch (err) {
    showToast('Failed to load skill data', 'error');
  }
}

// --- Render Radar Chart ---
function renderChart(diamond, currentSnap, aimSnap) {
  const canvasId = diamond === 1 ? 'chart-diamond1' : 'chart-diamond2';
  const ctx = document.getElementById(canvasId).getContext('2d');

  const currentData = currentSnap
    ? [currentSnap.axis_1, currentSnap.axis_2, currentSnap.axis_3, currentSnap.axis_4]
    : [0, 0, 0, 0];

  const aimData = aimSnap
    ? [aimSnap.axis_1, aimSnap.axis_2, aimSnap.axis_3, aimSnap.axis_4]
    : [0, 0, 0, 0];

  const config = {
    type: 'radar',
    data: {
      labels: DIAMOND_LABELS[diamond],
      datasets: makeDatasets(currentData, aimData)
    },
    options: { ...CHART_OPTIONS }
  };

  if (diamond === 1) {
    if (chartD1) chartD1.destroy();
    chartD1 = new Chart(ctx, config);
  } else {
    if (chartD2) chartD2.destroy();
    chartD2 = new Chart(ctx, config);
  }
}

// --- Sliders (Manager only) ---
function setupSliders() {
  document.querySelectorAll('input[type="range"]').forEach(slider => {
    updateSliderFill(slider);
    slider.addEventListener('input', () => {
      const d = slider.dataset.diamond;
      const a = slider.dataset.axis;
      const val = slider.value;

      document.getElementById(`val-d${d}-axis${a}`).textContent = val;
      updateSliderFill(slider);
      updateChartLive(Number(d));
    });
  });
}

function updateSliderFill(slider) {
  const min = Number(slider.min);
  const max = Number(slider.max);
  const val = Number(slider.value);
  const pct = ((val - min) / (max - min)) * 100;
  slider.style.setProperty('--fill-percent', pct + '%');
}

function populateSliders() {
  if (!latestData) return;

  const type = snapshotType;

  const d1 = type === 'current' ? latestData.diamond1.current : latestData.diamond1.aim;
  setSlider(1, 1, d1 ? d1.axis_1 : 0);
  setSlider(1, 2, d1 ? d1.axis_2 : 0);
  setSlider(1, 3, d1 ? d1.axis_3 : 0);
  setSlider(1, 4, d1 ? d1.axis_4 : 0);

  const d2 = type === 'current' ? latestData.diamond2.current : latestData.diamond2.aim;
  setSlider(2, 1, d2 ? d2.axis_1 : 0);
  setSlider(2, 2, d2 ? d2.axis_2 : 0);
  setSlider(2, 3, d2 ? d2.axis_3 : 0);
  setSlider(2, 4, d2 ? d2.axis_4 : 0);

  updateSliderClasses();
}

function setSlider(diamond, axis, value) {
  const slider = document.getElementById(`slider-d${diamond}-axis${axis}`);
  const valEl = document.getElementById(`val-d${diamond}-axis${axis}`);
  slider.value = value;
  valEl.textContent = value;
  updateSliderFill(slider);
}

function getSliderValues(diamond) {
  return {
    axis_1: Number(document.getElementById(`slider-d${diamond}-axis1`).value),
    axis_2: Number(document.getElementById(`slider-d${diamond}-axis2`).value),
    axis_3: Number(document.getElementById(`slider-d${diamond}-axis3`).value),
    axis_4: Number(document.getElementById(`slider-d${diamond}-axis4`).value)
  };
}

function updateSliderClasses() {
  document.querySelectorAll('input[type="range"]').forEach(slider => {
    slider.classList.toggle('slider-current', snapshotType === 'current');
  });
}

// --- Live Chart Preview ---
function updateChartLive(diamond) {
  const vals = getSliderValues(diamond);
  const data = [vals.axis_1, vals.axis_2, vals.axis_3, vals.axis_4];

  const chart = diamond === 1 ? chartD1 : chartD2;
  if (!chart) return;

  const idx = snapshotType === 'current' ? 0 : 1;
  chart.data.datasets[idx].data = data;
  chart.update('none');
}

// --- Toggle Current / Aim ---
function setupToggle() {
  toggleCurrent.addEventListener('click', () => {
    snapshotType = 'current';
    toggleCurrent.className = 'active-current';
    toggleAim.className = '';
    populateSliders();
  });

  toggleAim.addEventListener('click', () => {
    snapshotType = 'aim';
    toggleAim.className = 'active-aim';
    toggleCurrent.className = '';
    populateSliders();
  });
}

// --- Save ---
function setupSave() {
  btnSave.addEventListener('click', async () => {
    if (!currentUserId) return;

    btnSave.disabled = true;
    btnSave.textContent = 'Saving...';

    try {
      const d1Vals = getSliderValues(1);
      const d2Vals = getSliderValues(2);

      const [res1, res2] = await Promise.all([
        fetch(`/api/skills/${currentUserId}/update`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ diamond: 1, ...d1Vals, snapshot_type: snapshotType })
        }),
        fetch(`/api/skills/${currentUserId}/update`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ diamond: 2, ...d2Vals, snapshot_type: snapshotType })
        })
      ]);

      if (!res1.ok || !res2.ok) {
        const err1 = !res1.ok ? await res1.json() : null;
        const err2 = !res2.ok ? await res2.json() : null;
        throw new Error((err1?.error || '') + ' ' + (err2?.error || ''));
      }

      await loadSkillData();

      saveFeedback.classList.add('visible');
      showToast(`${snapshotType === 'current' ? 'Current' : 'Aim'} snapshot saved!`, 'success');
      setTimeout(() => saveFeedback.classList.remove('visible'), 2000);
    } catch (err) {
      showToast('Failed to save: ' + err.message, 'error');
    } finally {
      btnSave.disabled = false;
      btnSave.textContent = '💾 Save Snapshot';
    }
  });
}

// --- Toast ---
function showToast(message, type = 'success') {
  toastEl.textContent = message;
  toastEl.className = `toast ${type} visible`;
  setTimeout(() => {
    toastEl.classList.remove('visible');
  }, 3000);
}
